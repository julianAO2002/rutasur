// Cliente MongoDB unico por proceso. La interfaz solo LEE de MongoDB: nunca consume Kafka.
import { MongoClient } from 'mongodb';
import { EventEmitter } from 'node:events';

const url = process.env.MONGO_URL || 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true';
const nombreDb = process.env.MONGO_DB || 'rutasur';

const global_ = globalThis;
global_.__rutasur ??= {};

export async function db() {
  global_.__rutasur.cliente ??= new MongoClient(url).connect().catch((e) => {
    global_.__rutasur.cliente = undefined;
    throw e;
  });
  return (await global_.__rutasur.cliente).db(nombreDb);
}

/**
 * Un unico change stream sobre envios, alertas y notificaciones, compartido por todas las
 * conexiones SSE. Requiere MongoDB en modo replica set.
 */
export function cambios() {
  if (global_.__rutasur.cambios) return global_.__rutasur.cambios;
  const emisor = new EventEmitter();
  emisor.setMaxListeners(0);
  global_.__rutasur.cambios = emisor;

  const abrir = async () => {
    try {
      const stream = (await db()).watch(
        [
          { $match: { 'ns.coll': { $in: ['envios', 'alertas', 'notificaciones'] } } },
          {
            $project: {
              ns: 1,
              operationType: 1,
              'fullDocument.shipmentId': 1,
              'fullDocument.estado': 1,
              'fullDocument.zonaId': 1,
              'fullDocument.ultimoEventoEn': 1,
              'fullDocument.regla': 1,
              'fullDocument.prioridad': 1,
              'fullDocument.origen': 1,
            },
          },
        ],
        { fullDocument: 'updateLookup' },
      );
      stream.on('change', (c) => {
        const d = c.fullDocument ?? {};
        emisor.emit('cambio', { coleccion: c.ns.coll, operacion: c.operationType, ...d });
      });
      stream.on('error', (e) => {
        console.error('change stream:', e.message);
        stream.close().catch(() => {});
        setTimeout(abrir, 2000);
      });
    } catch (e) {
      console.error('no se pudo abrir el change stream:', e.message);
      setTimeout(abrir, 2000);
    }
  };
  abrir();
  return emisor;
}
