// Monitor de SLA (CU3): cruza envios.estados con envios.promesas y emite alertas antes del
// vencimiento. Estado en memoria con respaldo en MongoDB para tolerar reinicios.
import { config, TOPICS } from '../lib/config.js';
import { crearKafka, crearProductor, consumir, validarODescartar, alTerminar } from '../lib/kafka.js';
import { conectarMongo, yaProcesado, marcarProcesado } from '../lib/mongo.js';
import { validarEstado, validarPromesa } from '../lib/esquema.js';
import { log } from '../lib/log.js';
import { estadoInicial, aplicarEvento, evaluar } from './reglas.js';

const GRUPO = 'monitor-sla';
const EVAL_INTERVALO_MS = Number(process.env.EVAL_INTERVALO_MS || 5000);
// Entre eventos el reloj simulado se extrapola con el factor de aceleracion, como maximo 5 s
// reales: si el simulador se pausa o se detiene, el reloj del monitor tambien se detiene.
const EXTRAPOLACION_MAX_MS = 5000;

const { client, db } = await conectarMongo();
const respaldo = db.collection('monitor_sla_estado');
const meta = db.collection('monitor_sla_meta');
await respaldo.createIndex({ shipmentId: 1 }, { unique: true });

// --- Reloj simulado: viaja en los eventos (ocurridoEn), no es el reloj de la maquina ----------
const relojGuardado = await meta.findOne({ _id: 'reloj' });
let relojEventos = relojGuardado?.ms ?? 0;
let realUltimoAvance = Date.now();
const reloj = () =>
  relojEventos === 0
    ? 0
    : relojEventos + Math.min(Date.now() - realUltimoAvance, EXTRAPOLACION_MAX_MS) * config.factorAceleracion;
const avanzarReloj = (iso) => {
  const ms = Date.parse(iso);
  if (ms > relojEventos) {
    relojEventos = ms;
    realUltimoAvance = Date.now();
  }
};

// --- Estado: tabla por envio, cargada desde el respaldo al arrancar ------------------------
const memoria = new Map();
for (const doc of await respaldo.find({ entregado: false }, { projection: { _id: 0 } }).toArray()) {
  memoria.set(doc.shipmentId, doc);
}
log(GRUPO, 'estado restaurado', { envios: memoria.size, reloj: relojEventos ? new Date(relojEventos).toISOString() : '-' });

async function obtenerEstado(shipmentId) {
  if (memoria.has(shipmentId)) return memoria.get(shipmentId);
  const doc = await respaldo.findOne({ shipmentId }, { projection: { _id: 0 } });
  const estado = doc ?? estadoInicial(shipmentId);
  memoria.set(shipmentId, estado);
  return estado;
}

const guardar = (estado, session) =>
  respaldo.replaceOne({ shipmentId: estado.shipmentId }, estado, { upsert: true, session });

const kafka = crearKafka(GRUPO);
const productor = await crearProductor(kafka);

async function publicarAlertas(eventos, datos = {}) {
  for (const alerta of eventos) {
    await productor.publicar(TOPICS.ALERTAS, alerta);
    log(GRUPO, alerta.tipo === 'ALERTA_ABIERTA' ? 'alerta emitida' : 'alerta cerrada', {
      ...datos,
      shipmentId: alerta.shipmentId,
      regla: alerta.regla,
      prioridad: alerta.prioridad,
    });
  }
}

const VALIDADORES = { [TOPICS.ESTADOS]: validarEstado, [TOPICS.PROMESAS]: validarPromesa };

const consumer = await consumir({
  kafka,
  grupo: GRUPO,
  topics: Object.keys(VALIDADORES),
  alRecibir: async (message, ctx) => {
    const evento = await validarODescartar({
      message,
      ctx,
      validar: VALIDADORES[ctx.topic],
      productor,
      consumidor: GRUPO,
    });
    if (!evento) return;
    const datos = { eventId: evento.eventId, partition: ctx.partition, offset: ctx.offset };
    if (await yaProcesado(db, GRUPO, evento.eventId)) return log(GRUPO, 'duplicado descartado', datos);
    avanzarReloj(evento.ocurridoEn);
    const estado = await obtenerEstado(evento.shipmentId);
    const cierres = aplicarEvento(estado, evento, ctx.topic === TOPICS.PROMESAS, reloj());
    const alertas = evaluar(estado, reloj());
    // Publicar primero y despues guardar: un reinicio en el medio vuelve a publicar los mismos
    // alertaId/eventId, que los consumidores descartan como duplicados.
    await publicarAlertas([...cierres, ...alertas], datos);
    await guardar(estado);
    await marcarProcesado(db, GRUPO, evento.eventId);
    if (estado.entregado) memoria.delete(estado.shipmentId);
  },
});

// Evaluacion periodica: la alerta nace de la ausencia de un evento, no de su llegada.
let evaluando = false;
const temporizador = setInterval(async () => {
  if (evaluando || relojEventos === 0) return;
  evaluando = true;
  try {
    const ahora = reloj();
    for (const estado of memoria.values()) {
      const alertas = evaluar(estado, ahora);
      if (alertas.length === 0) continue;
      await publicarAlertas(alertas, { evaluacion: 'periodica' });
      await guardar(estado);
    }
    await meta.updateOne({ _id: 'reloj' }, { $set: { ms: relojEventos } }, { upsert: true });
  } catch (e) {
    log(GRUPO, 'error en evaluacion periodica', { error: e.message });
  } finally {
    evaluando = false;
  }
}, EVAL_INTERVALO_MS);

log(GRUPO, 'consumiendo', { topics: Object.keys(VALIDADORES), evaluacionCadaMs: EVAL_INTERVALO_MS });
alTerminar(async () => {
  clearInterval(temporizador);
  await consumer.disconnect();
  await productor.desconectar();
  await client.close();
});
