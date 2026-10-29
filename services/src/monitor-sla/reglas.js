// Reglas de riesgo de SLA (CU3). Funciones puras sobre el estado de un envio.
import { HORA_MS, VERSION_ESQUEMA, fechaLocal } from '../lib/dominio.js';

export const REGLAS = {
  SIN_INGRESO: { prioridad: 'MEDIA', causa: 'Faltan menos de 10 h para el vencimiento y no ingreso al hub' },
  SIN_SALIDA: { prioridad: 'ALTA', causa: 'Faltan menos de 4 h y no esta en reparto' },
  FALLO_DIA_LIMITE: { prioridad: 'ALTA', causa: 'Entrega fallida el mismo dia en que vence la promesa' },
  VENCIDO: { prioridad: 'CRITICA', causa: 'Paso el vencimiento sin ENTREGADO' },
};

const INGRESADO = ['INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'];
const SALIO = ['EN_REPARTO', 'ENTREGADO'];

export const estadoInicial = (shipmentId) => ({
  shipmentId,
  venceEn: null,
  hubId: null,
  zonaId: null,
  ultimaSecuencia: 0,
  ultimoTipo: null,
  ultimoFalloEn: null,
  ingresado: false,
  entregado: false,
  reglas: [],
  abiertas: [],
});

/**
 * Incorpora un evento de envios.estados o envios.promesas al estado del envio.
 * Devuelve los eventos de cierre a publicar (cuando llega ENTREGADO).
 */
export function aplicarEvento(estado, evento, esPromesa, relojMs) {
  estado.hubId ??= evento.hubId;
  estado.zonaId ??= evento.zonaId;
  if (esPromesa) {
    estado.venceEn = Date.parse(evento.venceEn);
    return [];
  }
  if (evento.tipo === 'CREADO' && !estado.venceEn) estado.venceEn = Date.parse(evento.promesa.venceEn);
  if (INGRESADO.includes(evento.tipo)) estado.ingresado = true;
  if (evento.secuencia > estado.ultimaSecuencia) {
    estado.ultimaSecuencia = evento.secuencia;
    estado.ultimoTipo = evento.tipo;
    if (evento.tipo === 'ENTREGA_FALLIDA') estado.ultimoFalloEn = evento.ocurridoEn;
  }
  if (evento.tipo === 'ENTREGADO' && !estado.entregado) {
    estado.entregado = true;
    const cierres = estado.abiertas.map((regla) => eventoAlerta(estado, regla, 'ALERTA_CERRADA', relojMs));
    estado.abiertas = [];
    return cierres;
  }
  return [];
}

/**
 * Evalua las cuatro reglas contra el reloj simulado. Cada regla alerta a lo sumo una vez por
 * envio: la regla queda registrada en `estado.reglas` antes de publicar.
 */
export function evaluar(estado, relojMs) {
  if (estado.entregado || !estado.venceEn) return [];
  const restante = estado.venceEn - relojMs;
  const disparadas = [];
  if (restante <= 0) disparadas.push('VENCIDO');
  if (restante > 0 && restante < 10 * HORA_MS && !estado.ingresado) disparadas.push('SIN_INGRESO');
  if (restante > 0 && restante < 4 * HORA_MS && !SALIO.includes(estado.ultimoTipo)) disparadas.push('SIN_SALIDA');
  if (
    estado.ultimoTipo === 'ENTREGA_FALLIDA' &&
    estado.ultimoFalloEn &&
    fechaLocal(estado.ultimoFalloEn) === fechaLocal(estado.venceEn)
  ) {
    disparadas.push('FALLO_DIA_LIMITE');
  }
  const nuevas = disparadas.filter((r) => !estado.reglas.includes(r));
  estado.reglas.push(...nuevas);
  estado.abiertas.push(...nuevas);
  return nuevas.map((regla) => eventoAlerta(estado, regla, 'ALERTA_ABIERTA', relojMs));
}

/** Evento de alertas.sla con identificadores deterministicos (reintentos idempotentes). */
export function eventoAlerta(estado, regla, tipo, relojMs) {
  const sufijo = tipo === 'ALERTA_ABIERTA' ? 'abierta' : 'cerrada';
  return {
    eventId: `alr-${estado.shipmentId}-${regla}-${sufijo}`,
    alertaId: `${estado.shipmentId}-${regla}`,
    tipo,
    shipmentId: estado.shipmentId,
    regla,
    prioridad: REGLAS[regla].prioridad,
    causa: REGLAS[regla].causa,
    venceEn: estado.venceEn ? new Date(estado.venceEn).toISOString() : undefined,
    hubId: estado.hubId,
    zonaId: estado.zonaId,
    ocurridoEn: new Date(relojMs).toISOString(),
    version: VERSION_ESQUEMA,
  };
}
