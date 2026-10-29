// Reprogramacion (CU2): decide el proximo intento tras una entrega fallida.
import { TOPICS } from '../lib/config.js';
import { crearKafka, crearProductor, consumir, validarODescartar, alTerminar } from '../lib/kafka.js';
import { conectarMongo, yaProcesado, marcarProcesado } from '../lib/mongo.js';
import { validarEstado } from '../lib/esquema.js';
import { log } from '../lib/log.js';
import { decidirReprogramacion } from './reglas.js';

const GRUPO = 'reprogramacion';

const { client, db } = await conectarMongo();
const kafka = crearKafka(GRUPO);
const productor = await crearProductor(kafka);

const consumer = await consumir({
  kafka,
  grupo: GRUPO,
  topics: [TOPICS.ESTADOS],
  alRecibir: async (message, ctx) => {
    const evento = await validarODescartar({ message, ctx, validar: validarEstado, productor, consumidor: GRUPO });
    if (!evento || evento.tipo !== 'ENTREGA_FALLIDA') return;
    const datos = { eventId: evento.eventId, partition: ctx.partition, offset: ctx.offset };
    if (await yaProcesado(db, GRUPO, evento.eventId)) {
      log(GRUPO, 'duplicado descartado', datos);
      return;
    }
    const decision = decidirReprogramacion(evento);
    await productor.publicar(TOPICS.REPROGRAMACIONES, decision);
    await marcarProcesado(db, GRUPO, evento.eventId);
    log(GRUPO, 'decision publicada', { ...datos, decision: decision.tipo, detalle: decision.detalle });
  },
});

log(GRUPO, 'consumiendo', { topics: [TOPICS.ESTADOS] });
alTerminar(async () => {
  await consumer.disconnect();
  await productor.desconectar();
  await client.close();
});
