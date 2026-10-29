// Agregados incrementales de metricas_diarias (CU4). Funcion pura.
import { fechaLocal, franjaDe } from '../lib/dominio.js';

/**
 * Devuelve el incremento atomico que un evento aporta a metricas_diarias, o null.
 * Clave: fecha + zonaId + franja (la zona determina el hub).
 *  - Tasa de entrega en primer intento: primerIntento.entregados / (entregados + fallidos)
 *  - Distribucion de motivos: motivos.<MOTIVO>
 *  - Cumplimiento de SLA: sla.cumplidos / (cumplidos + incumplidos), sobre los ENTREGADO
 */
export function incrementoPorEvento(evento, venceEnMs) {
  if (!['ENTREGADO', 'ENTREGA_FALLIDA'].includes(evento.tipo)) return null;
  const inc = {};
  if (evento.tipo === 'ENTREGADO') {
    inc.entregados = 1;
    if (evento.intento === 1) inc['primerIntento.entregados'] = 1;
    if (venceEnMs === undefined || venceEnMs === null) inc['sla.sinPromesa'] = 1;
    else if (Date.parse(evento.ocurridoEn) <= venceEnMs) inc['sla.cumplidos'] = 1;
    else inc['sla.incumplidos'] = 1;
  } else {
    inc.fallidos = 1;
    inc[`motivos.${evento.motivo}`] = 1;
    if (evento.intento === 1) inc['primerIntento.fallidos'] = 1;
  }
  return {
    filtro: { fecha: fechaLocal(evento.ocurridoEn), zonaId: evento.zonaId, franja: franjaDe(evento.ocurridoEn) },
    update: { $inc: inc, $setOnInsert: { hubId: evento.hubId } },
  };
}
