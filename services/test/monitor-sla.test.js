import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HORA_MS, instanteLocal } from '../src/lib/dominio.js';
import { estadoInicial, aplicarEvento, evaluar } from '../src/monitor-sla/reglas.js';

const VENCE = instanteLocal('2026-10-30', 20);
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const ev = (tipo, ms, extra = {}) => ({
  eventId: `e${++seq}`,
  shipmentId: 'RS-T-1',
  tipo,
  secuencia: seq,
  ocurridoEn: iso(ms),
  hubId: 'HUB-SUR',
  zonaId: 'Z-QUINTAS',
  promesa: { venceEn: iso(VENCE) },
  ...extra,
});
const reglas = (alertas) => alertas.map((a) => `${a.regla}/${a.prioridad}`);

test('sin ingreso: media cuando faltan menos de 10 h y no ingreso al hub', () => {
  const s = estadoInicial('RS-T-1');
  aplicarEvento(s, ev('CREADO', VENCE - 20 * HORA_MS), false, 0);
  assert.deepEqual(evaluar(s, VENCE - 11 * HORA_MS), []);
  assert.deepEqual(reglas(evaluar(s, VENCE - 9 * HORA_MS)), ['SIN_INGRESO/MEDIA']);
});

test('sin salida: alta cuando faltan menos de 4 h y no esta en reparto; no se repite', () => {
  const s = estadoInicial('RS-T-1');
  aplicarEvento(s, ev('CREADO', VENCE - 20 * HORA_MS), false, 0);
  aplicarEvento(s, ev('INGRESADO_HUB', VENCE - 19 * HORA_MS), false, 0);
  assert.deepEqual(reglas(evaluar(s, VENCE - 3 * HORA_MS)), ['SIN_SALIDA/ALTA']);
  assert.deepEqual(evaluar(s, VENCE - 2 * HORA_MS), [], 'la misma regla no vuelve a alertar');
});

test('fallo en el dia limite: alta al recibir ENTREGA_FALLIDA el dia del vencimiento', () => {
  const s = estadoInicial('RS-T-1');
  aplicarEvento(s, ev('CREADO', VENCE - 20 * HORA_MS), false, 0);
  aplicarEvento(s, ev('EN_REPARTO', VENCE - 10 * HORA_MS, { intento: 1 }), false, 0);
  const t = VENCE - 6 * HORA_MS;
  aplicarEvento(s, ev('ENTREGA_FALLIDA', t, { intento: 1, motivo: 'AUSENTE' }), false, t);
  assert.deepEqual(reglas(evaluar(s, t)), ['FALLO_DIA_LIMITE/ALTA']);
});

test('vencido: critica; ENTREGADO cierra todas las alertas abiertas y deja de evaluar', () => {
  const s = estadoInicial('RS-T-1');
  aplicarEvento(s, ev('CREADO', VENCE - 20 * HORA_MS), false, 0);
  assert.deepEqual(reglas(evaluar(s, VENCE + HORA_MS)), ['VENCIDO/CRITICA']);
  const cierres = aplicarEvento(s, ev('ENTREGADO', VENCE + 2 * HORA_MS, { intento: 1 }), false, VENCE + 2 * HORA_MS);
  assert.deepEqual(
    cierres.map((c) => `${c.tipo}:${c.regla}`),
    ['ALERTA_CERRADA:VENCIDO'],
  );
  assert.deepEqual(evaluar(s, VENCE + 5 * HORA_MS), []);
});

test('reinicio: el estado serializado no vuelve a alertar la misma regla', () => {
  const s = estadoInicial('RS-T-1');
  aplicarEvento(s, ev('CREADO', VENCE - 20 * HORA_MS), false, 0);
  const primera = evaluar(s, VENCE - 9 * HORA_MS);
  const restaurado = JSON.parse(JSON.stringify(s));
  assert.equal(primera.length, 1);
  assert.deepEqual(evaluar(restaurado, VENCE - 8 * HORA_MS), []);
  assert.equal(primera[0].eventId, 'alr-RS-T-1-SIN_INGRESO-abierta');
});

test('evento fuera de orden no hace retroceder el ultimo estado del monitor', () => {
  const s = estadoInicial('RS-T-1');
  const clasificado = ev('CLASIFICADO', VENCE - 18 * HORA_MS, { secuencia: 3 });
  const ingreso = ev('INGRESADO_HUB', VENCE - 19 * HORA_MS, { secuencia: 2 });
  aplicarEvento(s, clasificado, false, 0);
  aplicarEvento(s, ingreso, false, 0);
  assert.equal(s.ultimoTipo, 'CLASIFICADO');
});
