// Cuarto indicador (reprocesamiento, CU4): tiempo medio entre INGRESADO_HUB y EN_REPARTO por hub.
// Es un grupo de consumidores NUEVO que se activa con el sistema en marcha y lee envios.estados
// desde el inicio del log: completa el historico sin tocar a los demas servicios.
import { TOPICS } from '../lib/config.js';
import { crearKafka, crearProductor, consumir, validarODescartar, alTerminar } from '../lib/kafka.js';
import { conectarMongo, procesarUnaVez } from '../lib/mongo.js';
import { validarEstado } from '../lib/esquema.js';
import { fechaLocal } from '../lib/dominio.js';
import { log } from '../lib/log.js';

const GRUPO = 'analitica-tiempos';

const { client, db } = await conectarMongo();
const ingresos = db.collection('tiempos_ingresos');
const metricas = db.collection('metricas_tiempos_hub');
await ingresos.createIndex({ shipmentId: 1 }, { unique: true });
await metricas.createIndex({ fecha: 1, hubId: 1 }, { unique: true });
const kafka = crearKafka(GRUPO);
const productor = await crearProductor(kafka);

const consumer = await consumir({
  kafka,
  grupo: GRUPO,
  topics: [TOPICS.ESTADOS],
  fromBeginning: true,
  alRecibir: async (message, ctx) => {
    const evento = await validarODescartar({ message, ctx, validar: validarEstado, productor, consumidor: GRUPO });
    if (!evento) return;
    const datos = { eventId: evento.eventId, partition: ctx.partition, offset: ctx.offset };
    if (evento.tipo === 'INGRESADO_HUB') {
      await ingresos.updateOne(
        { shipmentId: evento.shipmentId },
        { $min: { ingresoEn: Date.parse(evento.ocurridoEn) } },
        { upsert: true },
      );
      return;
    }
    if (evento.tipo !== 'EN_REPARTO' || evento.intento !== 1) return;
    const ingreso = await ingresos.findOne({ shipmentId: evento.shipmentId });
    if (!ingreso) return log(GRUPO, 'sin ingreso registrado', datos);
    const minutos = (Date.parse(evento.ocurridoEn) - ingreso.ingresoEn) / 60000;
    const aplicado = await procesarUnaVez(client, db, GRUPO, evento.eventId, (session) =>
      metricas.updateOne(
        { fecha: fechaLocal(evento.ocurridoEn), hubId: evento.hubId },
        { $inc: { sumaMinutos: minutos, cantidad: 1 } },
        { upsert: true, session },
      ),
    );
    if (aplicado) log(GRUPO, 'tiempo acumulado', { ...datos, hubId: evento.hubId, minutos: Math.round(minutos) });
  },
});

log(GRUPO, 'consumiendo desde el inicio del log', { topics: [TOPICS.ESTADOS] });
alTerminar(async () => {
  await consumer.disconnect();
  await productor.desconectar();
  await client.close();
});
