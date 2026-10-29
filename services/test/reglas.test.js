import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarEstado } from '../src/lib/esquema.js';
import { diaHabilSiguiente, franjaDe, instanteLocal } from '../src/lib/dominio.js';
import { decidirReprogramacion } from '../src/reprogramacion/reglas.js';
import { construirNotificacion } from '../src/notificaciones/reglas.js';
import { incrementoPorEvento } from '../src/analitica/metricas.js';

const evento = (extra = {}) => ({
  eventId: 'RS-T-1-6',
  shipmentId: 'RS-T-1',
  tipo: 'ENTREGA_FALLIDA',
  motivo: 'AUSENTE',
  intento: 1,
  ocurridoEn: new Date(instanteLocal('2026-10-29', 10)).toISOString(), // jueves 10:00
  secuencia: 6,
  hubId: 'HUB-NORTE',
  zonaId: 'Z-CENTRO',
  repartidorId: 'R-CEN-01',
  version: 1,
  ...extra,
});

test('esquema: un evento valido no tiene errores', () => {
  assert.deepEqual(validarEstado(evento()), []);
});

test('esquema: ENTREGA_FALLIDA sin motivo y tipo desconocido son invalidos', () => {
  assert.match(validarEstado(evento({ motivo: undefined })).join(), /requiere motivo/);
  assert.match(validarEstado(evento({ tipo: 'TELETRANSPORTADO' })).join(), /tipo desconocido/);
  assert.match(validarEstado(evento({ secuencia: 0 })).join(), /secuencia/);
});

test('dominio: franja y dia habil siguiente (viernes -> lunes)', () => {
  assert.equal(franjaDe(instanteLocal('2026-10-29', 13, 59)), 'MANANA');
  assert.equal(franjaDe(instanteLocal('2026-10-29', 14)), 'TARDE');
  assert.equal(diaHabilSiguiente(instanteLocal('2026-10-30', 10)), '2026-11-02');
});

test('reprogramacion: AUSENTE -> dia habil siguiente en la franja opuesta', () => {
  const d = decidirReprogramacion(evento());
  assert.equal(d.tipo, 'REPROGRAMADO');
  assert.deepEqual(d.proximoIntento, { numero: 2, fecha: '2026-10-30', franja: 'TARDE' });
  assert.equal(d.eventId, 'rpg-RS-T-1-6');
});

test('reprogramacion: DIRECCION_INCORRECTA retiene, RECHAZADO devuelve', () => {
  assert.equal(decidirReprogramacion(evento({ motivo: 'DIRECCION_INCORRECTA' })).tipo, 'RETENIDO');
  assert.equal(decidirReprogramacion(evento({ motivo: 'RECHAZADO' })).tipo, 'DEVOLUCION');
});

test('reprogramacion: tercer intento fallido -> devolucion, cualquiera sea el motivo', () => {
  assert.equal(decidirReprogramacion(evento({ intento: 3 })).tipo, 'DEVOLUCION');
  assert.equal(decidirReprogramacion(evento({ intento: 3, motivo: 'DIRECCION_INCORRECTA' })).tipo, 'DEVOLUCION');
});

test('notificaciones: un aviso por fallo con id derivado del evento; nada ante ENTREGADO', () => {
  const n = construirNotificacion(evento(), 'envios.estados');
  assert.equal(n.notificacionId, 'ntf-RS-T-1-6');
  assert.equal(n.origen, 'ENTREGA_FALLIDA');
  assert.ok(n.opciones.length > 0);
  assert.equal(construirNotificacion(evento({ tipo: 'ENTREGADO' }), 'envios.estados'), null);
});

test('notificaciones: alerta MEDIA no avisa, ALTA si', () => {
  const alerta = { eventId: 'a1', shipmentId: 'RS-T-1', tipo: 'ALERTA_ABIERTA', ocurridoEn: evento().ocurridoEn };
  assert.equal(construirNotificacion({ ...alerta, prioridad: 'MEDIA' }, 'alertas.sla'), null);
  assert.equal(construirNotificacion({ ...alerta, prioridad: 'ALTA' }, 'alertas.sla').origen, 'ALERTA_SLA');
});

test('analitica: fallo en primer intento suma motivo y fallo de primer intento', () => {
  const { filtro, update } = incrementoPorEvento(evento());
  assert.deepEqual(filtro, { fecha: '2026-10-29', zonaId: 'Z-CENTRO', franja: 'MANANA' });
  assert.deepEqual(update.$inc, { fallidos: 1, 'motivos.AUSENTE': 1, 'primerIntento.fallidos': 1 });
});

test('analitica: entrega a tiempo y tarde contra la promesa', () => {
  const entregado = evento({ tipo: 'ENTREGADO', motivo: undefined, intento: 2 });
  const ms = Date.parse(entregado.ocurridoEn);
  assert.deepEqual(incrementoPorEvento(entregado, ms + 1).update.$inc, { entregados: 1, 'sla.cumplidos': 1 });
  assert.deepEqual(incrementoPorEvento(entregado, ms - 1).update.$inc, { entregados: 1, 'sla.incumplidos': 1 });
  assert.equal(incrementoPorEvento(evento({ tipo: 'CLASIFICADO' })), null);
});
