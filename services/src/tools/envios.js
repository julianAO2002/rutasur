// Reconstruccion de la vista "envios" (requisito: borrar y reprocesar deja el mismo estado).
//   node src/tools/envios.js huella       -> SHA-256 de la coleccion normalizada
//   node src/tools/envios.js reconstruir  -> borra envios y rebobina el grupo "proyector"
//                                            (el proyector debe estar detenido)
import { createHash } from 'node:crypto';
import { GRUPOS } from '../lib/config.js';
import { crearKafka } from '../lib/kafka.js';
import { conectarMongo } from '../lib/mongo.js';

const comando = process.argv[2];
const { client, db } = await conectarMongo();
const envios = db.collection('envios');

if (comando === 'huella') {
  const docs = await envios.find({}, { projection: { _id: 0 } }).sort({ shipmentId: 1 }).toArray();
  const hash = createHash('sha256');
  for (const doc of docs) {
    // El historial se ordena porque estados y reprogramaciones llegan por topics distintos.
    doc.historial?.sort((a, b) => a.eventId.localeCompare(b.eventId));
    hash.update(JSON.stringify(doc));
  }
  console.log(`envios=${docs.length} huella=${hash.digest('hex')}`);
} else if (comando === 'reconstruir') {
  const admin = crearKafka('reconstruir').admin();
  await admin.connect();
  const { groups } = await admin.describeGroups(['proyector']);
  if (groups[0]?.members.length > 0) {
    console.error('El proyector sigue activo: ejecutar "docker compose stop proyector" primero.');
    process.exit(1);
  }
  await envios.drop().catch(() => {});
  await db.collection('eventos_procesados').deleteMany({ consumidor: 'proyector' });
  for (const topic of GRUPOS.proyector) await admin.resetOffsets({ groupId: 'proyector', topic, earliest: true });
  await admin.disconnect();
  console.log('envios borrada y grupo "proyector" rebobinado. Ejecutar "docker compose start proyector".');
} else {
  console.error('uso: node src/tools/envios.js huella|reconstruir');
  process.exitCode = 1;
}
await client.close();
