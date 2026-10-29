// Notificaciones (CU2/CU3): registra un aviso al destinatario ante fallos y alertas.
// No envia correos ni SMS reales: publica el aviso en notificaciones.enviadas.
import { TOPICS } from '../lib/config.js';
import { crearKafka, crearProductor, consumir, validarODescartar, alTerminar } from '../lib/kafka.js';
import { conectarMongo, yaProcesado, marcarProcesado } from '../lib/mongo.js';
import { validarEstado, validarAlerta } from '../lib/esquema.js';
import { log } from '../lib/log.js';
import { construirNotificacion } from './reglas.js';

const GRUPO = 'notificaciones';
const VALIDADORES = { [TOPICS.ESTADOS]: validarEstado, [TOPICS.ALERTAS]: validarAlerta };

const { client, db } = await conectarMongo();
const kafka = crearKafka(GRUPO);
const productor = await crearProductor(kafka);

const consumer = await consumir({
  kafka,
  grupo: GRUPO,
  topics: Object.keys(VALIDADORES),
  alRecibir: async (message, ctx) => {
    const evento = await validarODescartar({
      message,
      ctx,
      validar: VALIDADORES[ctx.topic],
      productor,
      consumidor: GRUPO,
    });
    if (!evento) return;
    const notificacion = construirNotificacion(evento, ctx.topic);
    if (!notificacion) return;
    const datos = { eventId: evento.eventId, partition: ctx.partition, offset: ctx.offset };
    if (await yaProcesado(db, GRUPO, evento.eventId)) {
      log(GRUPO, 'duplicado descartado', datos);
      return;
    }
    // Primero se publica y despues se marca: si el proceso cae en el medio, el reintento
    // publica el mismo notificacionId y el proyector lo ignora.
    await productor.publicar(TOPICS.NOTIFICACIONES, notificacion);
    await marcarProcesado(db, GRUPO, evento.eventId);
    log(GRUPO, 'aviso registrado', { ...datos, origen: notificacion.origen, shipmentId: evento.shipmentId });
  },
});

log(GRUPO, 'consumiendo', { topics: Object.keys(VALIDADORES) });
alTerminar(async () => {
  await consumer.disconnect();
  await productor.desconectar();
  await client.close();
});
