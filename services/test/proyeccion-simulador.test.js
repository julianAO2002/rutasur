import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proyectarEstado, proyectarReprogramacion, proyectarAlerta } from '../src/proyector/proyeccion.js';
import { planificarEnvio, tasasDeFalloPorZona } from '../src/simulador/plan.js';
import { crearRng } from '../src/simulador/rng.js';
import { validarEstado } from '../src/lib/esquema.js';
import { instanteLocal } from '../src/lib/dominio.js';

const params = (rng) => ({
  probDemoraHub: 0.1,
  probDuplicado: 0.02,
  probFueraDeOrden: 0.02,
  distribucionMotivos: { AUSENTE: 60, DIRECCION_INCORRECTA: 20, RECHAZADO: 15, ZONA_INACCESIBLE: 5 },
  tasaFalloZona: tasasDeFalloPorZona(rng),
});

test('proyector: el filtro solo acepta secuencias mayores a la aplicada', () => {
  const { filtro, update } = proyectarEstado({
    eventId: 'x-3',
    shipmentId: 'x',
    tipo: 'CLASIFICADO',
    secuencia: 3,
    ocurridoEn: '2026-10-29T13:00:00.000Z',
    hubId: 'HUB-SUR',
    zonaId: 'Z-QUINTAS',
    version: 1,
  });
  assert.deepEqual(filtro.$or[0], { ultimaSecuencia: { $lt: 3 } });
  assert.equal(update.$set.estado, 'CLASIFICADO');
  assert.equal(update.$push.historial.eventId, 'x-3');
});

test('proyector: una reprogramacion no se agrega dos veces al historial', () => {
  const { filtro } = proyectarReprogramacion({ eventId: 'rpg-x-6', shipmentId: 'x', tipo: 'REPROGRAMADO', intento: 1 });
  assert.deepEqual(filtro['historial.eventId'], { $ne: 'rpg-x-6' });
});

test('proyector: la alerta abierta se inserta una sola vez y la cerrada cambia el estado', () => {
  const base = { alertaId: 'x-VENCIDO', shipmentId: 'x', regla: 'VENCIDO', prioridad: 'CRITICA', ocurridoEn: '2026-10-29T13:00:00Z' };
  assert.equal(proyectarAlerta({ ...base, tipo: 'ALERTA_ABIERTA' }).update.$setOnInsert.prioridadOrden, 3);
  assert.equal(proyectarAlerta({ ...base, tipo: 'ALERTA_CERRADA' }).update.$set.estado, 'CERRADA');
});

test('simulador: misma semilla, misma corrida', () => {
  const plan = () => {
    const rng = crearRng(42);
    const p = params(rng);
    return Array.from({ length: 50 }, (_, i) =>
      planificarEnvio({ rng, shipmentId: `S${i}`, creadoMs: instanteLocal('2026-10-29', 9), params: p }),
    );
  };
  assert.deepEqual(plan(), plan());
});

test('simulador: eventos validos, secuencia creciente y a lo sumo tres intentos', () => {
  const rng = crearRng(7);
  const p = { ...params(rng), probDuplicado: 0, probFueraDeOrden: 0 };
  for (let i = 0; i < 300; i++) {
    const { estados } = planificarEnvio({ rng, shipmentId: `S${i}`, creadoMs: instanteLocal('2026-10-29', 9), params: p });
    estados.forEach(({ evento }, j) => {
      assert.deepEqual(validarEstado(evento), [], `${evento.eventId}`);
      assert.equal(evento.secuencia, j + 1);
    });
    const tiempos = estados.map((e) => e.simMs);
    assert.deepEqual(tiempos, [...tiempos].sort((a, b) => a - b), 'los eventos salen en orden temporal');
    assert.ok(estados.filter((e) => e.evento.tipo === 'EN_REPARTO').length <= 3);
  }
});

test('simulador: escenario tercer fallo agota tres intentos', () => {
  const rng = crearRng(1);
  const { estados } = planificarEnvio({
    rng,
    shipmentId: 'E1',
    creadoMs: instanteLocal('2026-10-29', 9),
    params: params(rng),
    guion: { compacto: true, resultados: ['AUSENTE', 'AUSENTE', 'AUSENTE'] },
  });
  const fallos = estados.filter((e) => e.evento.tipo === 'ENTREGA_FALLIDA').map((e) => e.evento.intento);
  assert.deepEqual(fallos, [1, 2, 3]);
  assert.ok(!estados.some((e) => e.evento.tipo === 'ENTREGADO'));
});
