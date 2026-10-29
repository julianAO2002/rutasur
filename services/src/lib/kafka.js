// Cliente Kafka compartido: productor, consumidor con commit manual y envio a la DLQ.
import { Kafka, Partitioners, logLevel } from 'kafkajs';
import { config, TOPICS } from './config.js';
import { parsear } from './esquema.js';
import { log } from './log.js';

export function crearKafka(clientId) {
  return new Kafka({
    clientId,
    brokers: config.kafkaBrokers,
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 15 },
  });
}

/** Productor idempotente. La clave de particion es siempre el shipmentId. */
export async function crearProductor(kafka) {
  const producer = kafka.producer({
    createPartitioner: Partitioners.DefaultPartitioner,
    idempotent: true,
    maxInFlightRequests: 1,
    // El productor idempotente reintenta sin limite de cantidad (acotado por tiempo).
    retry: { retries: Number.MAX_SAFE_INTEGER, maxRetryTime: 30000 },
  });
  await producer.connect();
  return {
    publicar: (topic, evento) =>
      producer.send({ topic, messages: [{ key: evento.shipmentId, value: JSON.stringify(evento) }] }),
    publicarLote: (topic, messages) => producer.send({ topic, messages }),
    publicarCrudo: (topic, key, value) => producer.send({ topic, messages: [{ key, value }] }),
    desconectar: () => producer.disconnect(),
  };
}

/**
 * Consume `topics` en el grupo `grupo` con confirmacion manual de offsets:
 * el offset se confirma solo despues de que `alRecibir` termina (es decir, despues de
 * escribir en MongoDB). Si `alRecibir` falla, el mensaje se vuelve a entregar.
 */
export async function consumir({ kafka, grupo, topics, alRecibir, fromBeginning = true }) {
  const consumer = kafka.consumer({ groupId: grupo, sessionTimeout: 15000, heartbeatInterval: 3000 });
  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning });
  await consumer.run({
    autoCommit: false,
    partitionsConsumedConcurrently: 3,
    eachMessage: async ({ topic, partition, message }) => {
      const ctx = {
        topic,
        partition,
        offset: message.offset,
        key: message.key?.toString(),
        kafkaTs: new Date(Number(message.timestamp)).toISOString(),
      };
      await alRecibir(message, ctx);
      await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
    },
  });
  return consumer;
}

/**
 * Parsea y valida un mensaje. Si es invalido lo publica en la DLQ con el motivo y
 * devuelve null para que el consumo continue; si es valido devuelve el evento.
 */
export async function validarODescartar({ message, ctx, validar, productor, consumidor }) {
  const { evento, error } = parsear(message.value);
  const errores = error ? [error] : validar(evento);
  if (errores.length === 0) return evento;
  const motivo = errores.join('; ');
  await productor.publicarCrudo(
    TOPICS.DLQ,
    ctx.key || evento?.shipmentId || 'desconocido',
    JSON.stringify({
      motivo,
      consumidor,
      origen: { topic: ctx.topic, partition: ctx.partition, offset: ctx.offset },
      valorOriginal: message.value?.toString() ?? null,
      detectadoEn: new Date().toISOString(),
    }),
  );
  log(consumidor, 'evento invalido enviado a DLQ', { partition: ctx.partition, offset: ctx.offset, motivo });
  return null;
}

/** Cierra ordenadamente al recibir SIGTERM/SIGINT (docker compose stop). */
export function alTerminar(cerrar) {
  let cerrando = false;
  const salir = async (senal) => {
    if (cerrando) return;
    cerrando = true;
    console.log(`recibida ${senal}, cerrando...`);
    try {
      await cerrar();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => salir('SIGTERM'));
  process.on('SIGINT', () => salir('SIGINT'));
}
