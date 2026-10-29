// Configuracion compartida por todos los servicios, leida de variables de entorno.

const num = (nombre, defecto) => {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') return defecto;
  const n = Number(valor);
  if (Number.isNaN(n)) throw new Error(`${nombre} debe ser numerico (recibido "${valor}")`);
  return n;
};

export const config = {
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9094').split(','),
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/?replicaSet=rs0&directConnection=true',
  mongoDb: process.env.MONGO_DB || 'rutasur',
  // 1 hora simulada = 30 segundos reales => factor 120
  factorAceleracion: num('FACTOR_ACELERACION', 120),
};

export const TOPICS = {
  ESTADOS: 'envios.estados',
  PROMESAS: 'envios.promesas',
  REPROGRAMACIONES: 'envios.reprogramaciones',
  ALERTAS: 'alertas.sla',
  NOTIFICACIONES: 'notificaciones.enviadas',
  DLQ: 'envios.estados.dlq',
};

// Grupos de consumidores y los topics que lee cada uno (para consultar el lag).
export const GRUPOS = {
  proyector: [TOPICS.ESTADOS, TOPICS.REPROGRAMACIONES, TOPICS.ALERTAS, TOPICS.NOTIFICACIONES],
  notificaciones: [TOPICS.ESTADOS, TOPICS.ALERTAS],
  reprogramacion: [TOPICS.ESTADOS],
  'monitor-sla': [TOPICS.ESTADOS, TOPICS.PROMESAS],
  analitica: [TOPICS.ESTADOS],
  'analitica-tiempos': [TOPICS.ESTADOS],
};

const DIA_MS = 24 * 60 * 60 * 1000;

// Definicion de topics: particiones y retencion segun el catalogo de eventos.
export const DEFINICION_TOPICS = [
  { topic: TOPICS.ESTADOS, numPartitions: 3, configEntries: [{ name: 'retention.ms', value: String(30 * DIA_MS) }] },
  { topic: TOPICS.PROMESAS, numPartitions: 3, configEntries: [{ name: 'cleanup.policy', value: 'compact' }] },
  { topic: TOPICS.REPROGRAMACIONES, numPartitions: 3, configEntries: [{ name: 'retention.ms', value: String(30 * DIA_MS) }] },
  { topic: TOPICS.ALERTAS, numPartitions: 3, configEntries: [{ name: 'retention.ms', value: String(7 * DIA_MS) }] },
  { topic: TOPICS.NOTIFICACIONES, numPartitions: 3, configEntries: [{ name: 'retention.ms', value: String(7 * DIA_MS) }] },
  { topic: TOPICS.DLQ, numPartitions: 1, configEntries: [{ name: 'retention.ms', value: String(30 * DIA_MS) }] },
];
