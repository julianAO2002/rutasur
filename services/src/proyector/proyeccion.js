// Traduccion pura de eventos a operaciones sobre las vistas de lectura (CQRS).
// Nada depende del reloj de la maquina: reprocesar el log produce el mismo resultado.
import { PRIORIDADES } from '../lib/dominio.js';

const fecha = (iso) => (iso ? new Date(iso) : undefined);
const sinIndefinidos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Cambio de estado -> upsert condicional del envio. El filtro solo coincide si la secuencia
 * es mayor a la ultima aplicada; si no coincide, el upsert choca con el indice unico de
 * shipmentId (E11000) y el evento se descarta por llegar fuera de orden.
 */
export function proyectarEstado(e) {
  const filtro = {
    shipmentId: e.shipmentId,
    $or: [{ ultimaSecuencia: { $lt: e.secuencia } }, { ultimaSecuencia: { $exists: false } }],
  };
  const set = {
    estado: e.tipo,
    motivo: e.tipo === 'ENTREGA_FALLIDA' ? e.motivo : null,
    ultimaSecuencia: e.secuencia,
    hubId: e.hubId,
    zonaId: e.zonaId,
    repartidorId: e.repartidorId,
    ultimoEventoEn: fecha(e.ocurridoEn),
  };
  if (e.tipo === 'CREADO') {
    set.creadoEn = fecha(e.ocurridoEn);
    set.promesa = { venceEn: fecha(e.promesa.venceEn) };
  }
  const update = {
    $set: set,
    $setOnInsert: { shipmentId: e.shipmentId },
    $push: {
      historial: sinIndefinidos({
        eventId: e.eventId,
        tipo: e.tipo,
        ocurridoEn: fecha(e.ocurridoEn),
        secuencia: e.secuencia,
        intento: e.intento,
        motivo: e.motivo,
      }),
    },
  };
  if (e.intento) update.$max = { intentos: e.intento };
  return { filtro, update };
}

/** Decision de reprogramacion -> ultima decision e historial del envio. */
export function proyectarReprogramacion(e) {
  const decision = sinIndefinidos({
    tipo: e.tipo,
    intento: e.intento,
    motivo: e.motivo,
    proximoIntento: e.proximoIntento ? { fecha: e.proximoIntento.fecha, franja: e.proximoIntento.franja } : undefined,
    detalle: e.detalle,
    decididoEn: fecha(e.ocurridoEn),
  });
  return {
    filtro: { shipmentId: e.shipmentId, 'historial.eventId': { $ne: e.eventId } },
    update: {
      $set: { ultimaDecision: decision },
      $setOnInsert: { shipmentId: e.shipmentId },
      $push: {
        historial: sinIndefinidos({
          eventId: e.eventId,
          tipo: e.tipo,
          ocurridoEn: fecha(e.ocurridoEn),
          intento: e.intento,
          detalle: e.detalle,
        }),
      },
    },
  };
}

/** Alerta de SLA abierta o cerrada -> coleccion alertas. */
export function proyectarAlerta(e) {
  const base = {
    alertaId: e.alertaId,
    shipmentId: e.shipmentId,
    regla: e.regla,
    prioridad: e.prioridad,
    prioridadOrden: PRIORIDADES[e.prioridad] ?? 0,
    causa: e.causa,
    hubId: e.hubId,
    zonaId: e.zonaId,
    venceEn: fecha(e.venceEn),
  };
  if (e.tipo === 'ALERTA_ABIERTA') {
    return {
      filtro: { alertaId: e.alertaId },
      update: { $setOnInsert: { ...sinIndefinidos(base), estado: 'ABIERTA', abiertaEn: fecha(e.ocurridoEn) } },
    };
  }
  return {
    filtro: { alertaId: e.alertaId },
    update: {
      $set: { estado: 'CERRADA', cerradaEn: fecha(e.ocurridoEn) },
      $setOnInsert: { ...sinIndefinidos(base), abiertaEn: fecha(e.ocurridoEn) },
    },
  };
}

/** Notificacion simulada -> coleccion notificaciones. */
export function proyectarNotificacion(e) {
  return {
    filtro: { notificacionId: e.notificacionId },
    update: {
      $setOnInsert: sinIndefinidos({
        notificacionId: e.notificacionId,
        shipmentId: e.shipmentId,
        canal: e.canal,
        origen: e.origen,
        mensaje: e.mensaje,
        opciones: e.opciones,
        enviadaEn: fecha(e.ocurridoEn),
      }),
    },
  };
}
