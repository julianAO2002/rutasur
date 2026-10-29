// Planificacion de la vida completa de un envio: devuelve los eventos que el simulador
// publicara, cada uno con el instante simulado en que debe salir. Funcion pura.
import {
  ZONAS,
  HORA_MS,
  VERSION_ESQUEMA,
  HORA_INICIO_FRANJA,
  diaHabilSiguiente,
  fechaLocal,
  franjaDe,
  franjaOpuesta,
  instanteLocal,
  proximoHorarioReparto,
} from '../lib/dominio.js';

const MIN_MS = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const REINTENTABLES = ['AUSENTE', 'ZONA_INACCESIBLE'];
export const MAX_INTENTOS = 3;

/** Tasa de fallo por zona entre 5 % y 30 %, repartida segun la semilla. */
export function tasasDeFalloPorZona(rng) {
  const tasas = [0.05, 0.08, 0.11, 0.14, 0.17, 0.2, 0.23, 0.27, 0.3];
  for (let i = tasas.length - 1; i > 0; i--) {
    const j = Math.floor(rng.siguiente() * (i + 1));
    [tasas[i], tasas[j]] = [tasas[j], tasas[i]];
  }
  return Object.fromEntries(ZONAS.map((z, i) => [z.zonaId, tasas[i]]));
}

/**
 * @param {object} o
 * @param {object} o.rng            generador con semilla
 * @param {string} o.shipmentId
 * @param {number} o.creadoMs       instante simulado de creacion
 * @param {object} o.params         parametros del simulador
 * @param {object} [o.guion]        escenario forzado: { zonaId, resultados, venceEnMs, salidaEnMs, compacto }
 * @returns {{ estados: Array<{simMs:number, evento:object}>, promesa: {simMs:number, evento:object} }}
 */
export function planificarEnvio({ rng, shipmentId, creadoMs, params, guion }) {
  const { zonaId, hubId } = guion?.zonaId ? ZONAS.find((z) => z.zonaId === guion.zonaId) : rng.elegir(ZONAS);
  const repartidorId = `R-${zonaId.slice(2, 5)}-${String(rng.entero(1, 13)).padStart(2, '0')}`;
  const venceEnMs = guion?.venceEnMs ?? instanteLocal(diaHabilSiguiente(creadoMs), 20);
  const compacto = Boolean(guion?.compacto);
  const paso = (minH, maxH) => (compacto ? rng.entre(5, 15) * MIN_MS : rng.entre(minH, maxH) * HORA_MS);

  const estados = [];
  let secuencia = 0;
  const emitir = (tipo, simMs, extra = {}) => {
    secuencia += 1;
    const evento = {
      eventId: `${shipmentId}-${secuencia}`,
      shipmentId,
      tipo,
      ocurridoEn: iso(simMs),
      secuencia,
      hubId,
      zonaId,
      repartidorId,
      version: VERSION_ESQUEMA,
      ...extra,
    };
    estados.push({ simMs, evento });
    return evento;
  };

  let t = creadoMs;
  emitir('CREADO', t, { promesa: { venceEn: iso(venceEnMs) } });
  t += paso(0.5, 2);
  if (!guion && rng.siguiente() < params.probDemoraHub) t += rng.entre(12, 20) * HORA_MS;
  emitir('INGRESADO_HUB', t);
  t += paso(0.3, 1);
  emitir('CLASIFICADO', t);

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    let reparto;
    let resultado;
    if (compacto) {
      reparto = intento === 1 && guion?.salidaEnMs ? guion.salidaEnMs : t + paso();
      resultado = reparto + paso();
    } else if (intento === 1) {
      reparto = proximoHorarioReparto(t + paso(0.3, 1.5));
      const franja = franjaDe(reparto);
      const finFranja = instanteLocal(fechaLocal(reparto), franja === 'MANANA' ? 14 : 20);
      resultado = reparto + rng.entre(0.3, 0.9) * (finFranja - reparto);
    } else {
      reparto = t;
      resultado = reparto + rng.entre(0.5, 5) * HORA_MS;
    }

    emitir('EN_REPARTO', reparto, { intento });
    const motivo = decidirResultado({ rng, params, guion, zonaId, intento, franja: franjaDe(resultado) });
    if (!motivo) {
      emitir('ENTREGADO', resultado, { intento });
      break;
    }
    emitir('ENTREGA_FALLIDA', resultado, { intento, motivo });
    if (!REINTENTABLES.includes(motivo) || intento === MAX_INTENTOS) break;

    // El mundo simulado reintenta igual que la regla de reprogramacion: dia habil siguiente,
    // franja opuesta. Los escenarios compactos reintentan a la hora para que la demo sea breve.
    if (compacto) {
      t = resultado + HORA_MS;
    } else {
      const franja = franjaOpuesta(franjaDe(resultado));
      t = instanteLocal(diaHabilSiguiente(resultado), HORA_INICIO_FRANJA[franja]) + rng.entre(0, 0.5) * HORA_MS;
    }
    emitir('CLASIFICADO', t - (compacto ? paso() : 0.5 * HORA_MS));
  }

  if (!guion) aplicarAnomalias({ rng, params, estados });

  const promesa = {
    simMs: creadoMs,
    evento: {
      eventId: `${shipmentId}-promesa`,
      shipmentId,
      tipo: 'PROMESA',
      ocurridoEn: iso(creadoMs),
      venceEn: iso(venceEnMs),
      hubId,
      zonaId,
      version: VERSION_ESQUEMA,
    },
  };
  return { estados, promesa };
}

function decidirResultado({ rng, params, guion, zonaId, intento, franja }) {
  if (guion) {
    const r = guion.resultados[intento - 1] ?? 'ENTREGADO';
    return r === 'ENTREGADO' ? null : r;
  }
  // La manana falla mas que la tarde: es la diferencia que el panel analitico debe mostrar.
  const base = params.tasaFalloZona[zonaId];
  const tasa = Math.min(0.9, base * (franja === 'MANANA' ? 1.4 : 0.6));
  return rng.siguiente() < tasa ? rng.ponderado(params.distribucionMotivos) : null;
}

/** Inyecta duplicados y eventos fuera de orden para probar idempotencia y la regla de secuencia. */
function aplicarAnomalias({ rng, params, estados }) {
  if (rng.siguiente() < params.probFueraDeOrden) {
    // CLASIFICADO sale antes que INGRESADO_HUB: el proyector debe descartar el atrasado.
    const ingreso = estados.find((e) => e.evento.tipo === 'INGRESADO_HUB');
    const clasificado = estados.find((e) => e.evento.tipo === 'CLASIFICADO');
    [ingreso.simMs, clasificado.simMs] = [clasificado.simMs + MIN_MS, ingreso.simMs];
  }
  for (const e of [...estados]) {
    if (rng.siguiente() < params.probDuplicado) {
      estados.push({ simMs: e.simMs + rng.entre(1, 10) * MIN_MS, evento: { ...e.evento } });
    }
  }
}

/** Evento que no cumple el esquema (para la demo de la DLQ). */
export function eventoMalformado(rng, shipmentId, simMs) {
  const variantes = [
    () => `{"eventId":"${shipmentId}-mal","shipmentId":"${shipmentId}","tipo":"ENTREG`,
    () => JSON.stringify({ eventId: `${shipmentId}-mal`, shipmentId, ocurridoEn: iso(simMs), version: 1 }),
    () =>
      JSON.stringify({
        eventId: `${shipmentId}-mal`,
        shipmentId,
        tipo: 'ENTREGA_FALLIDA',
        ocurridoEn: iso(simMs),
        secuencia: 99,
        hubId: 'HUB-NORTE',
        zonaId: 'Z-CENTRO',
        intento: 1,
        version: 1,
      }),
    () => JSON.stringify({ eventId: `${shipmentId}-mal`, shipmentId, tipo: 'TELETRANSPORTADO', ocurridoEn: 'ayer', version: 1 }),
  ];
  return rng.elegir(variantes)();
}
