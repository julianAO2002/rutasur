// Crea los seis topics del catalogo de eventos (idempotente). Corre una vez al levantar el entorno.
import { DEFINICION_TOPICS } from '../lib/config.js';
import { crearKafka } from '../lib/kafka.js';

const admin = crearKafka('init-topics').admin();
await admin.connect();
const existentes = new Set(await admin.listTopics());
const nuevos = DEFINICION_TOPICS.filter((t) => !existentes.has(t.topic));
if (nuevos.length > 0) {
  await admin.createTopics({ topics: nuevos.map((t) => ({ ...t, replicationFactor: 1 })), waitForLeaders: true });
}
for (const t of DEFINICION_TOPICS) {
  console.log(`${existentes.has(t.topic) ? 'existente' : 'creado   '} ${t.topic} (particiones=${t.numPartitions})`);
}
await admin.disconnect();
