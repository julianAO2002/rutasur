// Verificacion de punta a punta contra el entorno levantado con Docker Compose.
// Dispara escenarios en el simulador y comprueba los criterios de aceptacion en MongoDB y Kafka.
//   docker compose exec simulador node src/tools/verificar.js [--con-demorado]
import { TOPICS } from '../lib/config.js';
import { crearKafka } from '../lib/kafka.js';
import { conectarMongo } from '../lib/mongo.js';

const SIMULADOR = process.env.SIMULADOR_URL || 'http://localhost:4000';
const conDemorado = process.argv.includes('--con-demorado');
const { client, db } = await conectarMongo();
const envios = db.collection('envios');
let fallos = 0;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
function comprobar(condicion, descripcion, detalle = '') {
  console.log(`${condicion ? 'OK   ' : 'FALLO'} ${descripcion}${detalle ? ` (${detalle})` : ''}`);
  if (!condicion) fallos += 1;
}
async function disparar(escenario) {
  const res = await fetch(`${SIMULADOR}/escenarios/${escenario}`, { method: 'POST' });
  const { shipmentIds } = await res.json();
  return shipmentIds[0];
}
async function esperar(descripcion, fn, timeoutMs = 120000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const r = await fn();
    if (r) return r;
    await pausa(1000);
  }
  throw new Error(`timeout esperando: ${descripcion}`);
}
const situacion = (id) => envios.findOne({ shipmentId: id });
const notificacionesDe = (id) => db.collection('notificaciones').countDocuments({ shipmentId: id });

console.log('== CU1: ciclo de vida');
const feliz = await disparar('feliz');
const t0 = Date.now();
await esperar('envio creado', async () => (await situacion(feliz))?.estado);
console.log(`      primer evento visible en MongoDB a los ${((Date.now() - t0) / 1000).toFixed(1)} s del disparo`);
const docFeliz = await esperar('ENTREGADO', async () => {
  const d = await situacion(feliz);
  return d?.estado === 'ENTREGADO' && d;
});
comprobar(
  docFeliz.historial.map((h) => h.tipo).join('>') === 'CREADO>INGRESADO_HUB>CLASIFICADO>EN_REPARTO>ENTREGADO',
  'envio feliz recorre todos los estados',
  feliz,
);

const [dupHistorial] = await envios
  .aggregate([
    { $unwind: '$historial' },
    { $group: { _id: { s: '$shipmentId', e: '$historial.eventId' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'n' },
  ])
  .toArray();
comprobar(!dupHistorial, 'ningun historial tiene un eventId repetido', `repetidos=${dupHistorial?.n ?? 0}`);

const retrocesos = await envios.countDocuments({
  $expr: {
    $let: {
      vars: {
        maxSec: {
          $max: { $map: { input: { $ifNull: ['$historial', []] }, as: 'h', in: { $ifNull: ['$$h.secuencia', 0] } } },
        },
      },
      in: { $and: [{ $gt: ['$$maxSec', 0] }, { $ne: ['$ultimaSecuencia', '$$maxSec'] }] },
    },
  },
});
comprobar(retrocesos === 0, 'ningun estado retrocede por eventos fuera de orden', `retrocesos=${retrocesos}`);

const invalido = await disparar('invalido');
const dlq = await buscarEnDlq(invalido);
comprobar(Boolean(dlq?.motivo), 'el evento malformado termina en la DLQ con su motivo', dlq?.motivo);

console.log('== CU2: entrega fallida');
const ausente = await disparar('ausente');
const docAusente = await esperar('decision de reprogramacion', async () => {
  const d = await situacion(ausente);
  return d?.ultimaDecision && (await notificacionesDe(ausente)) > 0 && d;
});
await pausa(3000);
comprobar((await notificacionesDe(ausente)) === 1, 'un ENTREGA_FALLIDA genera exactamente una notificacion');
comprobar(
  docAusente.ultimaDecision.tipo === 'REPROGRAMADO' && docAusente.historial.filter((h) => h.tipo === 'REPROGRAMADO').length === 1,
  'AUSENTE se reprograma una sola vez en la franja opuesta',
  docAusente.ultimaDecision.detalle,
);

const tercero = await disparar('tercer-fallo');
const docTercero = await esperar(
  'devolucion',
  async () => {
    const d = await situacion(tercero);
    return d?.ultimaDecision?.tipo === 'DEVOLUCION' && d;
  },
  180000,
);
comprobar(docTercero.ultimaDecision.intento === 3, 'el tercer fallo marca el envio para devolucion');
comprobar((await notificacionesDe(tercero)) === 3, 'cada fallo genero exactamente un aviso', `avisos=${await notificacionesDe(tercero)}`);

const decisiones = await envios.distinct('ultimaDecision.tipo');
console.log(`      decisiones observadas en el flujo continuo: ${decisiones.join(', ')}`);

console.log('== CU3: riesgo de SLA');
const alertasRepetidas = await db
  .collection('alertas')
  .aggregate([{ $group: { _id: { s: '$shipmentId', r: '$regla' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])
  .toArray();
comprobar(alertasRepetidas.length === 0, 'una misma regla no alerta dos veces sobre el mismo envio');
const porRegla = await db
  .collection('alertas')
  .aggregate([{ $group: { _id: { r: '$regla', p: '$prioridad' }, n: { $sum: 1 } } }])
  .toArray();
console.log(`      alertas por regla: ${porRegla.map((a) => `${a._id.r}/${a._id.p}=${a.n}`).join(' ') || '(todavia ninguna)'}`);
const entregadasAbiertas = await db.collection('alertas').countDocuments({
  estado: 'ABIERTA',
  shipmentId: { $in: await envios.distinct('shipmentId', { estado: 'ENTREGADO' }) },
});
comprobar(entregadasAbiertas === 0, 'las alertas de envios entregados estan cerradas', `abiertas=${entregadasAbiertas}`);

if (conDemorado) {
  const demorado = await disparar('demorado');
  const alerta = await esperar(
    'alerta SIN_SALIDA',
    () => db.collection('alertas').findOne({ shipmentId: demorado, regla: 'SIN_SALIDA' }),
    300000,
  );
  comprobar(alerta.prioridad === 'ALTA', 'el envio demorado genera alerta SIN_SALIDA de prioridad alta', demorado);
  const cerrada = await esperar(
    'cierre de la alerta',
    () => db.collection('alertas').findOne({ shipmentId: demorado, regla: 'SIN_SALIDA', estado: 'CERRADA' }),
    300000,
  );
  comprobar(Boolean(cerrada), 'la alerta se cierra cuando el envio se entrega');
}

console.log('== CU4: analitica');
const celdas = await db.collection('metricas_diarias').countDocuments();
comprobar(celdas > 0, 'metricas_diarias tiene agregados', `celdas=${celdas}`);

await client.close();
console.log(fallos === 0 ? '\nTodas las verificaciones pasaron.' : `\n${fallos} verificaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);

async function buscarEnDlq(shipmentId) {
  const kafka = crearKafka('verificar-dlq');
  const consumer = kafka.consumer({ groupId: `verificar-dlq-${Date.now()}` });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPICS.DLQ, fromBeginning: true });
  let encontrado = null;
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (message.key?.toString() === shipmentId) encontrado ??= JSON.parse(message.value.toString());
    },
  });
  try {
    await esperar('mensaje en la DLQ', () => encontrado, 60000);
  } finally {
    await consumer.disconnect();
  }
  return encontrado;
}
