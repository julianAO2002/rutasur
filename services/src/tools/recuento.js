// Recuento manual: relee envios.estados desde el inicio con un grupo efimero, recalcula los
// tres indicadores sin pasar por el servicio de analitica y los compara con metricas_diarias.
// Correrlo con el flujo pausado y el lag de "analitica" en cero (ver README).
import { TOPICS } from '../lib/config.js';
import { crearKafka } from '../lib/kafka.js';
import { conectarMongo } from '../lib/mongo.js';
import { parsear, validarEstado } from '../lib/esquema.js';
import { incrementoPorEvento } from '../analitica/metricas.js';

const kafka = crearKafka('recuento');
const admin = kafka.admin();
await admin.connect();
const finales = await admin.fetchTopicOffsets(TOPICS.ESTADOS);
const lagAnalitica = await lagDe('analitica');
await admin.disconnect();
if (lagAnalitica > 0) console.warn(`ATENCION: el grupo analitica tiene lag ${lagAnalitica}; el recuento puede diferir.`);

const pendientes = new Map(finales.map((p) => [p.partition, BigInt(p.high)]));
const vistos = new Set();
const promesas = new Map();
const recuento = new Map();

const consumer = kafka.consumer({ groupId: `recuento-${Date.now()}` });
await consumer.connect();
await consumer.subscribe({ topic: TOPICS.ESTADOS, fromBeginning: true });
await new Promise((resolve) => {
  for (const [p, high] of pendientes) if (high === 0n) pendientes.delete(p);
  if (pendientes.size === 0) return resolve();
  consumer.run({
    eachMessage: async ({ partition, message }) => {
      const high = pendientes.get(partition);
      if (high === undefined || BigInt(message.offset) >= high) return;
      const { evento } = parsear(message.value);
      if (evento && validarEstado(evento).length === 0 && !vistos.has(evento.eventId)) {
        vistos.add(evento.eventId);
        if (evento.tipo === 'CREADO') promesas.set(evento.shipmentId, Date.parse(evento.promesa.venceEn));
        const inc = incrementoPorEvento(evento, promesas.get(evento.shipmentId));
        if (inc) {
          const clave = `${inc.filtro.fecha}|${inc.filtro.zonaId}|${inc.filtro.franja}`;
          const acumulado = recuento.get(clave) ?? {};
          for (const [campo, n] of Object.entries(inc.update.$inc)) acumulado[campo] = (acumulado[campo] ?? 0) + n;
          recuento.set(clave, acumulado);
        }
      }
      if (BigInt(message.offset) + 1n >= high) {
        pendientes.delete(partition);
        if (pendientes.size === 0) resolve();
      }
    },
  });
});
await consumer.disconnect();

const { client, db } = await conectarMongo();
const enMongo = await db.collection('metricas_diarias').find().toArray();
await client.close();

const aplanar = (o, prefijo = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? aplanar(v, `${prefijo}${k}.`) : [[`${prefijo}${k}`, v]],
  );
const CAMPOS = /^(entregados|fallidos|primerIntento\.|motivos\.|sla\.)/;
let diferencias = 0;
const claves = new Set([...recuento.keys(), ...enMongo.map((m) => `${m.fecha}|${m.zonaId}|${m.franja}`)]);
for (const clave of claves) {
  const [fecha, zonaId, franja] = clave.split('|');
  const doc = enMongo.find((m) => m.fecha === fecha && m.zonaId === zonaId && m.franja === franja) ?? {};
  const esperado = Object.fromEntries(Object.entries(recuento.get(clave) ?? {}));
  const obtenido = Object.fromEntries(aplanar(doc).filter(([k]) => CAMPOS.test(k)));
  for (const campo of new Set([...Object.keys(esperado), ...Object.keys(obtenido)])) {
    if ((esperado[campo] ?? 0) !== (obtenido[campo] ?? 0)) {
      diferencias += 1;
      console.log(`DIFERENCIA ${clave} ${campo}: recuento=${esperado[campo] ?? 0} metricas=${obtenido[campo] ?? 0}`);
    }
  }
}

const total = (campo) => [...recuento.values()].reduce((s, r) => s + (r[campo] ?? 0), 0);
const pct = (a, b) => (a + b === 0 ? '-' : `${((100 * a) / (a + b)).toFixed(1)} %`);
console.log(`Eventos unicos leidos: ${vistos.size} | celdas fecha/zona/franja: ${claves.size}`);
console.log(`Tasa de entrega en primer intento: ${pct(total('primerIntento.entregados'), total('primerIntento.fallidos'))}`);
console.log(
  `Motivos de fallo: ${['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE']
    .map((m) => `${m}=${total(`motivos.${m}`)}`)
    .join(' ')}`,
);
console.log(`Cumplimiento de SLA: ${pct(total('sla.cumplidos'), total('sla.incumplidos'))}`);
console.log(diferencias === 0 ? 'OK: los indicadores coinciden con el recuento manual' : `FALLO: ${diferencias} diferencias`);
process.exit(diferencias === 0 ? 0 : 1);

async function lagDe(grupo) {
  const [{ partitions }] = await admin.fetchOffsets({ groupId: grupo, topics: [TOPICS.ESTADOS] });
  return partitions.reduce((s, { partition, offset }) => {
    const fin = finales.find((f) => f.partition === partition);
    return s + Number(fin.high) - Math.max(Number(offset), Number(fin.low));
  }, 0);
}
