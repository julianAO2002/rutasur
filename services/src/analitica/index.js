// Analitica (CU2/CU4): suma cada entrega y cada fallo a metricas_diarias con incrementos
// atomicos. El incremento y el registro del eventId van en la misma transaccion.
import { TOPICS } from '../lib/config.js';
import { crearKafka, crearProductor, consumir, validarODescartar, alTerminar } from '../lib/kafka.js';
import { conectarMongo, procesarUnaVez } from '../lib/mongo.js';
import { validarEstado } from '../lib/esquema.js';
import { log } from '../lib/log.js';
import { incrementoPorEvento } from './metricas.js';

const GRUPO = 'analitica';

const { client, db } = await conectarMongo();
const promesas = db.collection('analitica_promesas');
await promesas.createIndex({ shipmentId: 1 }, { unique: true });
const kafka = crearKafka(GRUPO);
const productor = await crearProductor(kafka);

const consumer = await consumir({
  kafka,
  grupo: GRUPO,
  topics: [TOPICS.ESTADOS],
  alRecibir: async (message, ctx) => {
    const evento = await validarODescartar({ message, ctx, validar: validarEstado, productor, consumidor: GRUPO });
    if (!evento) return;
    const datos = { eventId: evento.eventId, partition: ctx.partition, offset: ctx.offset };
    if (evento.tipo === 'CREADO') {
      // La promesa viaja en CREADO; se guarda para medir el cumplimiento de SLA al entregar.
      await promesas.updateOne(
        { shipmentId: evento.shipmentId },
        { $setOnInsert: { venceEn: Date.parse(evento.promesa.venceEn), hubId: evento.hubId } },
        { upsert: true },
      );
      return;
    }
    if (!['ENTREGADO', 'ENTREGA_FALLIDA'].includes(evento.tipo)) return;
    const promesa = await promesas.findOne({ shipmentId: evento.shipmentId });
    const { filtro, update } = incrementoPorEvento(evento, promesa?.venceEn);
    const aplicado = await procesarUnaVez(client, db, GRUPO, evento.eventId, (session) =>
      db.collection('metricas_diarias').updateOne(filtro, update, { upsert: true, session }),
    );
    log(GRUPO, aplicado ? 'metrica incrementada' : 'duplicado descartado', { ...datos, ...filtro, tipo: evento.tipo });
  },
});

log(GRUPO, 'consumiendo', { topics: [TOPICS.ESTADOS] });
alTerminar(async () => {
  await consumer.disconnect();
  await productor.desconectar();
  await client.close();
});
