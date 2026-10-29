// Simulador: reemplaza a los sistemas de origen. Genera envios, promesas y cambios de estado
// con un reloj acelerado, y expone por HTTP los escenarios de la demo y el lag de cada grupo.
import http from 'node:http';
import { config, TOPICS, GRUPOS } from '../lib/config.js';
import { crearKafka, crearProductor, alTerminar } from '../lib/kafka.js';
import { fechaLocal, instanteLocal, HORA_MS } from '../lib/dominio.js';
import { log } from '../lib/log.js';
import { crearRng } from './rng.js';
import { planificarEnvio, tasasDeFalloPorZona, eventoMalformado } from './plan.js';

const num = (nombre, defecto) => (process.env[nombre] ? Number(process.env[nombre]) : defecto);

const SEMILLA = num('SEMILLA', 2026);
const params = {
  enviosPorMinuto: num('ENVIOS_POR_MINUTO', 20),
  probDemoraHub: num('PROB_DEMORA_HUB', 0.1),
  probDuplicado: num('PROB_DUPLICADO', 0.02),
  probFueraDeOrden: num('PROB_FUERA_DE_ORDEN', 0.02),
  probMalformado: num('PROB_MALFORMADO', 0.01),
  distribucionMotivos: { AUSENTE: 60, DIRECCION_INCORRECTA: 20, RECHAZADO: 15, ZONA_INACCESIBLE: 5 },
};
const rng = crearRng(SEMILLA);
const rngEscenarios = crearRng(SEMILLA + 1);
params.tasaFalloZona = tasasDeFalloPorZona(rng);

// Etiqueta de corrida: evita que dos corridas generen los mismos shipmentId.
const CORRIDA = process.env.CORRIDA || Date.now().toString(36).slice(-3).toUpperCase();
const PUERTO = num('PUERTO', 4000);
const TICK_MS = 250;

// Reloj simulado: arranca hoy a las 07:00 (hora local) y avanza `factorAceleracion` veces mas rapido.
const realInicio = Date.now();
const simInicio = process.env.SIM_INICIO ? Date.parse(process.env.SIM_INICIO) : instanteLocal(fechaLocal(realInicio), 7);
// La pausa congela el reloj: no se crean envios ni se publican eventos hasta reanudar.
let pausadoDesde = null;
let pausadoAcumulado = 0;
const simAhora = () =>
  simInicio + ((pausadoDesde ?? Date.now()) - realInicio - pausadoAcumulado) * config.factorAceleracion;
function pausar(pausa) {
  if (pausa && pausadoDesde === null) pausadoDesde = Date.now();
  if (!pausa && pausadoDesde !== null) {
    pausadoAcumulado += Date.now() - pausadoDesde;
    pausadoDesde = null;
  }
}

const pendientes = []; // { simMs, topic, evento? , crudo?, key }
let creados = 0;
let escenarios = 0;
let flujoActivo = process.env.FLUJO_CONTINUO !== 'false';
let creadosEsperados = 0;

const kafka = crearKafka('simulador');
const productor = await crearProductor(kafka);
const admin = kafka.admin();
await admin.connect();

function agendarEnvio(shipmentId, creadoMs, generador, guion) {
  const { estados, promesa } = planificarEnvio({ rng: generador, shipmentId, creadoMs, params, guion });
  pendientes.push({ simMs: promesa.simMs, topic: TOPICS.PROMESAS, evento: promesa.evento });
  for (const e of estados) pendientes.push({ simMs: e.simMs, topic: TOPICS.ESTADOS, evento: e.evento });
  if (!guion && generador.siguiente() < params.probMalformado) {
    const simMs = creadoMs + generador.entre(0.1, 3) * HORA_MS;
    pendientes.push({ simMs, topic: TOPICS.ESTADOS, key: shipmentId, crudo: eventoMalformado(generador, shipmentId, simMs) });
  }
  return shipmentId;
}

const nuevoId = () => `RS-${CORRIDA}-${String(++creados).padStart(6, '0')}`;
const nuevoIdEscenario = () => `RS-${CORRIDA}-E${String(++escenarios).padStart(3, '0')}`;

async function tick() {
  if (pausadoDesde !== null) return;
  const ahora = simAhora();
  if (flujoActivo) {
    creadosEsperados += (params.enviosPorMinuto * TICK_MS) / 60000;
    while (creadosEsperados >= 1) {
      creadosEsperados -= 1;
      agendarEnvio(nuevoId(), ahora, rng);
    }
  }
  const vencidos = [];
  for (let i = pendientes.length - 1; i >= 0; i--) {
    if (pendientes[i].simMs <= ahora) vencidos.push(...pendientes.splice(i, 1));
  }
  if (vencidos.length === 0) return;
  vencidos.sort((a, b) => a.simMs - b.simMs);
  const porTopic = new Map();
  for (const p of vencidos) {
    if (!porTopic.has(p.topic)) porTopic.set(p.topic, []);
    porTopic.get(p.topic).push(
      p.crudo ? { key: p.key, value: p.crudo } : { key: p.evento.shipmentId, value: JSON.stringify(p.evento) },
    );
  }
  // Un lote por topic: dentro de cada particion Kafka respeta el orden del lote.
  try {
    for (const [topic, messages] of porTopic) await productor.publicarLote(topic, messages);
  } catch (e) {
    // Se reintenta en el proximo tick (un lote parcial puede repetirse: los consumidores son idempotentes).
    pendientes.push(...vencidos);
    throw e;
  }
}

let enTick = false;
const reloj = setInterval(async () => {
  if (enTick) return;
  enTick = true;
  try {
    await tick();
  } catch (e) {
    log('simulador', 'error publicando', { error: e.message });
  } finally {
    enTick = false;
  }
}, TICK_MS);

// --- Escenarios de la demo -------------------------------------------------------------
const ESCENARIOS = {
  feliz: () => [agendarEnvio(nuevoIdEscenario(), simAhora(), rngEscenarios, { compacto: true, resultados: ['ENTREGADO'] })],
  ausente: () => [
    agendarEnvio(nuevoIdEscenario(), simAhora(), rngEscenarios, { compacto: true, resultados: ['AUSENTE', 'ENTREGADO'] }),
  ],
  demorado: () => {
    // Queda detenido en el hub: sale a reparto 8 h despues de creado, con vencimiento a las 10,5 h.
    const ahora = simAhora();
    return [
      agendarEnvio(nuevoIdEscenario(), ahora, rngEscenarios, {
        compacto: true,
        resultados: ['ENTREGADO'],
        venceEnMs: ahora + 10.5 * HORA_MS,
        salidaEnMs: ahora + 8 * HORA_MS,
      }),
    ];
  },
  'tercer-fallo': () => [
    agendarEnvio(nuevoIdEscenario(), simAhora(), rngEscenarios, {
      compacto: true,
      resultados: ['AUSENTE', 'AUSENTE', 'AUSENTE'],
    }),
  ],
  rafaga: () => {
    const ahora = simAhora();
    const ids = [];
    for (let i = 0; i < 500; i++) ids.push(agendarEnvio(nuevoId(), ahora, rng));
    return [`${ids[0]} .. ${ids.at(-1)}`];
  },
  invalido: () => {
    const shipmentId = nuevoIdEscenario();
    pendientes.push({
      simMs: simAhora(),
      topic: TOPICS.ESTADOS,
      key: shipmentId,
      crudo: JSON.stringify({ eventId: `${shipmentId}-mal`, shipmentId, tipo: 'ENTREGA_FALLIDA', version: 1 }),
    });
    return [shipmentId];
  },
};

async function lagPorGrupo() {
  const finales = new Map();
  for (const topic of Object.values(TOPICS)) {
    finales.set(topic, await admin.fetchTopicOffsets(topic));
  }
  const { groups } = await admin.describeGroups(Object.keys(GRUPOS));
  const resultado = [];
  for (const [grupo, topics] of Object.entries(GRUPOS)) {
    const confirmados = await admin.fetchOffsets({ groupId: grupo, topics });
    let lag = 0;
    let conOffsets = false;
    for (const { topic, partitions } of confirmados) {
      for (const { partition, offset } of partitions) {
        const fin = finales.get(topic).find((p) => p.partition === partition);
        const desde = Number(offset) >= 0 ? Number(offset) : Number(fin.low);
        if (Number(offset) >= 0) conOffsets = true;
        lag += Number(fin.high) - desde;
      }
    }
    const info = groups.find((g) => g.groupId === grupo);
    resultado.push({ grupo, lag, estado: info?.state ?? 'Unknown', miembros: info?.members.length ?? 0, conOffsets });
  }
  return resultado;
}

function responder(res, status, cuerpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/estado') {
      return responder(res, 200, {
        corrida: CORRIDA,
        semilla: SEMILLA,
        simAhora: new Date(simAhora()).toISOString(),
        factorAceleracion: config.factorAceleracion,
        flujoActivo,
        pausado: pausadoDesde !== null,
        enviosCreados: creados,
        eventosPendientes: pendientes.length,
        tasaFalloZona: params.tasaFalloZona,
      });
    }
    if (req.method === 'GET' && url.pathname === '/lag') return responder(res, 200, await lagPorGrupo());
    if (req.method === 'POST' && url.pathname === '/flujo') {
      flujoActivo = url.searchParams.get('activo') !== 'false';
      return responder(res, 200, { flujoActivo });
    }
    if (req.method === 'POST' && url.pathname === '/pausa') {
      pausar(url.searchParams.get('activa') !== 'false');
      log('simulador', pausadoDesde !== null ? 'simulacion pausada' : 'simulacion reanudada');
      return responder(res, 200, { pausado: pausadoDesde !== null });
    }
    const escenario = url.pathname.match(/^\/escenarios\/([a-z-]+)$/)?.[1];
    if (req.method === 'POST' && escenario) {
      if (!ESCENARIOS[escenario]) return responder(res, 404, { error: `escenario desconocido: ${escenario}` });
      const shipmentIds = ESCENARIOS[escenario]();
      log('simulador', 'escenario disparado', { escenario, shipmentIds });
      return responder(res, 202, { escenario, shipmentIds });
    }
    responder(res, 404, { error: 'ruta inexistente' });
  } catch (e) {
    responder(res, 500, { error: e.message });
  }
});
servidor.listen(PUERTO, () =>
  log('simulador', 'listo', {
    corrida: CORRIDA,
    semilla: SEMILLA,
    enviosPorMinuto: params.enviosPorMinuto,
    factor: config.factorAceleracion,
    simInicio: new Date(simInicio).toISOString(),
    puerto: PUERTO,
  }),
);

alTerminar(async () => {
  clearInterval(reloj);
  servidor.close();
  await admin.disconnect();
  await productor.desconectar();
});
