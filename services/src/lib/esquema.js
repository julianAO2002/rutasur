// Validacion de esquema de los eventos (JSON validado en cada consumidor).
import { ESTADOS, MOTIVOS, VERSION_ESQUEMA } from './dominio.js';

const esTexto = (v) => typeof v === 'string' && v.trim() !== '';
const esFecha = (v) => esTexto(v) && !Number.isNaN(Date.parse(v));

/** Interpreta el valor crudo de un mensaje. Devuelve { evento } o { error }. */
export function parsear(buffer) {
  if (!buffer) return { error: 'mensaje sin valor' };
  try {
    const evento = JSON.parse(buffer.toString());
    if (evento === null || typeof evento !== 'object' || Array.isArray(evento)) {
      return { error: 'el evento no es un objeto JSON' };
    }
    return { evento };
  } catch (e) {
    return { error: `JSON invalido: ${e.message}` };
  }
}

function camposComunes(e, errores) {
  if (!esTexto(e.eventId)) errores.push('eventId requerido');
  if (!esTexto(e.shipmentId)) errores.push('shipmentId requerido');
  if (!esFecha(e.ocurridoEn)) errores.push('ocurridoEn debe ser una fecha ISO');
  if (e.version !== VERSION_ESQUEMA) errores.push(`version debe ser ${VERSION_ESQUEMA}`);
}

/** Valida un evento de envios.estados. Devuelve la lista de errores (vacia si es valido). */
export function validarEstado(e) {
  const errores = [];
  camposComunes(e, errores);
  if (!ESTADOS.includes(e.tipo)) errores.push(`tipo desconocido: ${JSON.stringify(e.tipo)}`);
  if (!Number.isInteger(e.secuencia) || e.secuencia < 1) errores.push('secuencia debe ser un entero positivo');
  for (const campo of ['hubId', 'zonaId']) {
    if (!esTexto(e[campo])) errores.push(`${campo} requerido`);
  }
  if (e.tipo === 'ENTREGA_FALLIDA' && !MOTIVOS.includes(e.motivo)) {
    errores.push(`ENTREGA_FALLIDA requiere motivo valido (${MOTIVOS.join(', ')})`);
  }
  if (['EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'].includes(e.tipo) && !(Number.isInteger(e.intento) && e.intento >= 1)) {
    errores.push(`${e.tipo} requiere intento >= 1`);
  }
  if (e.tipo === 'CREADO' && !esFecha(e.promesa?.venceEn)) errores.push('CREADO requiere promesa.venceEn');
  return errores;
}

/** Valida un evento de envios.promesas. */
export function validarPromesa(e) {
  const errores = [];
  camposComunes(e, errores);
  if (!esFecha(e.venceEn)) errores.push('venceEn debe ser una fecha ISO');
  return errores;
}

/** Valida un evento de envios.reprogramaciones. */
export function validarReprogramacion(e) {
  const errores = [];
  camposComunes(e, errores);
  if (!['REPROGRAMADO', 'RETENIDO', 'DEVOLUCION'].includes(e.tipo)) errores.push(`tipo desconocido: ${e.tipo}`);
  if (!Number.isInteger(e.intento)) errores.push('intento requerido');
  return errores;
}

/** Valida un evento de alertas.sla. */
export function validarAlerta(e) {
  const errores = [];
  camposComunes(e, errores);
  if (!['ALERTA_ABIERTA', 'ALERTA_CERRADA'].includes(e.tipo)) errores.push(`tipo desconocido: ${e.tipo}`);
  if (!esTexto(e.alertaId)) errores.push('alertaId requerido');
  return errores;
}

/** Valida un evento de notificaciones.enviadas. */
export function validarNotificacion(e) {
  const errores = [];
  camposComunes(e, errores);
  if (!esTexto(e.notificacionId)) errores.push('notificacionId requerido');
  return errores;
}
