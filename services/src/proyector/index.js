// Proyector (CU1): mantiene envios, alertas y notificaciones en MongoDB a partir del log.
import { TOPICS } from '../lib/config.js';
import { crearKafka, crearProductor, consumir, validarODescartar, alTerminar } from '../lib/kafka.js';
import { conectarMongo, procesarUnaVez } from '../lib/mongo.js';
import { validarEstado, validarReprogramacion, validarAlerta, validarNotificacion } from '../lib/esquema.js';
import { log } from '../lib/log.js';
import { proyectarEstado, proyectarReprogramacion, proyectarAlerta, proyectarNotificacion } from './proyeccion.js';

const GRUPO = 'proyector';

const RUTAS = {
  [TOPICS.ESTADOS]: { validar: validarEstado, coleccion: 'envios', proyectar: proyectarEstado },
  [TOPICS.REPROGRAMACIONES]: { validar: validarReprogramacion, coleccion: 'envios', proyectar: proyectarReprogramacion },
  [TOPICS.ALERTAS]: { validar: validarAlerta, coleccion: 'alertas', proyectar: proyectarAlerta },
  [TOPICS.NOTIFICACIONES]: { validar: validarNotificacion, coleccion: 'notificaciones', proyectar: proyectarNotificacion },
};

const { client, db } = await conectarMongo();
const kafka = crearKafka(GRUPO);
const productor = await crearProductor(kafka);

const consumer = await consumir({
  kafka,
  grupo: GRUPO,
  topics: Object.keys(RUTAS),
  alRecibir: async (message, ctx) => {
    const ruta = RUTAS[ctx.topic];
    const evento = await validarODescartar({ message, ctx, validar: ruta.validar, productor, consumidor: GRUPO });
    if (!evento) return;
    const datos = { eventId: evento.eventId, tipo: evento.tipo, topic: ctx.topic, partition: ctx.partition, offset: ctx.offset };
    const { filtro, update } = ruta.proyectar(evento);
    try {
      const aplicado = await procesarUnaVez(client, db, GRUPO, evento.eventId, (session) =>
        db.collection(ruta.coleccion).updateOne(filtro, update, { upsert: true, session }),
      );
      log(GRUPO, aplicado ? 'aplicado' : 'duplicado descartado', datos);
    } catch (e) {
      // El filtro no coincidio y el upsert choco con el indice unico: secuencia ya superada
      // (estados) o reprogramacion ya registrada en el historial.
      if (e?.code !== 11000) throw e;
      log(GRUPO, 'fuera de orden descartado', { ...datos, secuencia: evento.secuencia });
    }
  },
});

log(GRUPO, 'consumiendo', { topics: Object.keys(RUTAS) });
alTerminar(async () => {
  await consumer.disconnect();
  await productor.desconectar();
  await client.close();
});
