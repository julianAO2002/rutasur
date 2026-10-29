// Reglas de reprogramacion tras una entrega fallida. Funcion pura.
import { VERSION_ESQUEMA, diaHabilSiguiente, franjaDe, franjaOpuesta } from '../lib/dominio.js';

export const MAX_INTENTOS = 3;

/**
 * Decide el proximo paso de un envio con ENTREGA_FALLIDA:
 * - AUSENTE (y ZONA_INACCESIBLE, supuesto del caso): nuevo intento al dia habil siguiente,
 *   en la franja opuesta a la del fallo.
 * - DIRECCION_INCORRECTA: retenido hasta una correccion; no se reprograma solo.
 * - RECHAZADO: devolucion al comercio.
 * - Tercer intento fallido, cualquiera sea el motivo: devolucion al comercio.
 */
export function decidirReprogramacion(evento) {
  const base = {
    eventId: `rpg-${evento.eventId}`,
    shipmentId: evento.shipmentId,
    ocurridoEn: evento.ocurridoEn,
    intento: evento.intento,
    motivo: evento.motivo,
    hubId: evento.hubId,
    zonaId: evento.zonaId,
    version: VERSION_ESQUEMA,
    origenEventId: evento.eventId,
  };
  if (evento.intento >= MAX_INTENTOS) {
    return { ...base, tipo: 'DEVOLUCION', detalle: `Tercer intento fallido (${evento.motivo}): devolucion al comercio` };
  }
  switch (evento.motivo) {
    case 'DIRECCION_INCORRECTA':
      return { ...base, tipo: 'RETENIDO', detalle: 'Retenido en el hub hasta que se corrija la direccion' };
    case 'RECHAZADO':
      return { ...base, tipo: 'DEVOLUCION', detalle: 'Rechazado por el destinatario: devolucion al comercio' };
    default: {
      const franja = franjaOpuesta(franjaDe(evento.ocurridoEn));
      const fecha = diaHabilSiguiente(evento.ocurridoEn);
      return {
        ...base,
        tipo: 'REPROGRAMADO',
        proximoIntento: { numero: evento.intento + 1, fecha, franja },
        detalle: `Intento ${evento.intento + 1} el ${fecha} por la ${franja === 'MANANA' ? 'manana' : 'tarde'}`,
      };
    }
  }
}
