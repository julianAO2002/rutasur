// Conexion a MongoDB (replica set de un nodo), indices e idempotencia por consumidor.
import { MongoClient } from 'mongodb';
import { config } from './config.js';

const SIETE_DIAS_S = 7 * 24 * 60 * 60;

export async function conectarMongo() {
  const client = new MongoClient(config.mongoUrl);
  await client.connect();
  const db = client.db(config.mongoDb);
  await asegurarIndices(db);
  return { client, db };
}

/** Crea los indices del modelo de lectura (operacion idempotente). */
export async function asegurarIndices(db) {
  await Promise.all([
    db.collection('envios').createIndexes([
      { key: { shipmentId: 1 }, unique: true },
      { key: { estado: 1, zonaId: 1 } },
      { key: { 'promesa.venceEn': 1 } },
      { key: { ultimoEventoEn: -1 } },
    ]),
    db.collection('alertas').createIndexes([
      { key: { alertaId: 1 }, unique: true },
      { key: { estado: 1, prioridad: 1 } },
      { key: { shipmentId: 1 } },
    ]),
    db.collection('notificaciones').createIndexes([
      { key: { notificacionId: 1 }, unique: true },
      { key: { shipmentId: 1 } },
    ]),
    db.collection('metricas_diarias').createIndexes([{ key: { fecha: 1, zonaId: 1, franja: 1 }, unique: true }]),
    db.collection('eventos_procesados').createIndexes([
      { key: { consumidor: 1, eventId: 1 }, unique: true },
      { key: { procesadoEn: 1 }, expireAfterSeconds: SIETE_DIAS_S },
    ]),
  ]);
}

const esDuplicado = (e) => e?.code === 11000;

/** true si `consumidor` ya aplico el evento `eventId`. */
export async function yaProcesado(db, consumidor, eventId) {
  return (await db.collection('eventos_procesados').countDocuments({ consumidor, eventId }, { limit: 1 })) > 0;
}

export async function marcarProcesado(db, consumidor, eventId, session) {
  try {
    await db
      .collection('eventos_procesados')
      .insertOne({ consumidor, eventId, procesadoEn: new Date() }, { session });
  } catch (e) {
    if (!esDuplicado(e)) throw e;
  }
}

/**
 * Aplica `fn(session)` exactamente una vez por (consumidor, eventId): el registro en
 * eventos_procesados y los efectos van en la misma transaccion. Devuelve false si el
 * evento ya habia sido aplicado (duplicado).
 */
export async function procesarUnaVez(client, db, consumidor, eventId, fn) {
  if (await yaProcesado(db, consumidor, eventId)) return false;
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      try {
        await db
          .collection('eventos_procesados')
          .insertOne({ consumidor, eventId, procesadoEn: new Date() }, { session });
      } catch (e) {
        // Un error de escritura aborta la transaccion: se informa como duplicado.
        throw esDuplicado(e) ? new EventoDuplicado() : e;
      }
      await fn(session);
    });
    return true;
  } catch (e) {
    if (e instanceof EventoDuplicado) return false;
    throw e;
  } finally {
    await session.endSession();
  }
}

class EventoDuplicado extends Error {}
