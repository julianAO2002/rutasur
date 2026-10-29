// Que aviso recibe el destinatario ante un fallo o una alerta. Funcion pura.
import { VERSION_ESQUEMA } from '../lib/dominio.js';

const OPCIONES_POR_MOTIVO = {
  AUSENTE: ['Reprogramar en la otra franja', 'Retirar en el centro de distribucion', 'Autorizar a un vecino'],
  ZONA_INACCESIBLE: ['Reprogramar en la otra franja', 'Retirar en el centro de distribucion'],
  DIRECCION_INCORRECTA: ['Corregir la direccion', 'Retirar en el centro de distribucion'],
  RECHAZADO: ['Contactar al comercio'],
};

const TEXTO_MOTIVO = {
  AUSENTE: 'no habia nadie en el domicilio',
  ZONA_INACCESIBLE: 'la zona estaba inaccesible',
  DIRECCION_INCORRECTA: 'la direccion es incorrecta',
  RECHAZADO: 'el paquete fue rechazado',
};

/**
 * Devuelve el evento de notificaciones.enviadas que corresponde a `evento`, o null si no
 * hay que avisar. El notificacionId y el eventId derivan del evento de origen, de modo que
 * reprocesarlo nunca genera un segundo aviso.
 */
export function construirNotificacion(evento, topicOrigen) {
  const base = {
    notificacionId: `ntf-${evento.eventId}`,
    eventId: `ntf-${evento.eventId}`,
    shipmentId: evento.shipmentId,
    ocurridoEn: evento.ocurridoEn,
    canal: 'SMS',
    version: VERSION_ESQUEMA,
    origenEventId: evento.eventId,
  };
  if (topicOrigen === 'envios.estados' && evento.tipo === 'ENTREGA_FALLIDA') {
    return {
      ...base,
      origen: 'ENTREGA_FALLIDA',
      mensaje: `RutaSur: no pudimos entregar tu envio ${evento.shipmentId} porque ${TEXTO_MOTIVO[evento.motivo]}. Elegi como seguimos.`,
      opciones: OPCIONES_POR_MOTIVO[evento.motivo],
    };
  }
  if (topicOrigen === 'alertas.sla' && evento.tipo === 'ALERTA_ABIERTA' && ['ALTA', 'CRITICA'].includes(evento.prioridad)) {
    return {
      ...base,
      origen: 'ALERTA_SLA',
      mensaje:
        evento.prioridad === 'CRITICA'
          ? `RutaSur: tu envio ${evento.shipmentId} esta demorado. Te pedimos disculpas, ya estamos priorizandolo.`
          : `RutaSur: tu envio ${evento.shipmentId} podria demorarse. Te avisaremos cuando salga a reparto.`,
      opciones: [],
    };
  }
  return null;
}
