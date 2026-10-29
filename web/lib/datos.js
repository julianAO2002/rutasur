// Consultas de lectura sobre las vistas que mantienen el proyector y la analitica.
import { db } from './mongo';

const ESTADO_VISIBLE = {
  $cond: [
    {
      $and: [{ $eq: ['$estado', 'ENTREGA_FALLIDA'] }, { $eq: ['$ultimaDecision.intento', '$intentos'] }],
    },
    '$ultimaDecision.tipo',
    '$estado',
  ],
};

/** Situacion de un envio: el estado, o la decision tomada tras su ultimo fallo. */
export function situacion(envio) {
  if (envio.estado === 'ENTREGA_FALLIDA' && envio.ultimaDecision?.intento === envio.intentos) {
    return envio.ultimaDecision.tipo;
  }
  return envio.estado ?? 'CREADO';
}

export async function contadores() {
  const filas = await (await db())
    .collection('envios')
    .aggregate([{ $match: { estado: { $exists: true } } }, { $group: { _id: ESTADO_VISIBLE, n: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(filas.map((f) => [f._id, f.n]));
}

export async function alertasAbiertas(limite = 25) {
  const col = (await db()).collection('alertas');
  const [lista, total, porPrioridad] = await Promise.all([
    col.find({ estado: 'ABIERTA' }).sort({ prioridadOrden: -1, abiertaEn: 1 }).limit(limite).toArray(),
    col.countDocuments({ estado: 'ABIERTA' }),
    col.aggregate([{ $match: { estado: 'ABIERTA' } }, { $group: { _id: '$prioridad', n: { $sum: 1 } } }]).toArray(),
  ]);
  return { lista, total, porPrioridad: Object.fromEntries(porPrioridad.map((p) => [p._id, p.n])) };
}

export async function ultimosEnvios(limite = 12) {
  return (await db())
    .collection('envios')
    .find({ estado: { $exists: true } }, { projection: { shipmentId: 1, estado: 1, zonaId: 1, ultimoEventoEn: 1 } })
    .sort({ ultimoEventoEn: -1 })
    .limit(limite)
    .toArray();
}

export async function envio(shipmentId) {
  const d = await db();
  const [doc, alertas, notificaciones] = await Promise.all([
    d.collection('envios').findOne({ shipmentId }),
    d.collection('alertas').find({ shipmentId }).sort({ abiertaEn: 1 }).toArray(),
    d.collection('notificaciones').find({ shipmentId }).sort({ enviadaEn: 1 }).toArray(),
  ]);
  return doc ? { ...doc, alertas, notificaciones } : null;
}

/** Indicadores de CU4 a partir de los agregados precalculados de metricas_diarias. */
export async function analitica({ zonaId, hubId, fecha }) {
  const d = await db();
  const filtro = {};
  if (zonaId) filtro.zonaId = zonaId;
  if (hubId) filtro.hubId = hubId;
  if (fecha) filtro.fecha = fecha;
  const col = d.collection('metricas_diarias');
  const suma = (campo) => ({ $sum: { $ifNull: [`$${campo}`, 0] } });
  const [primerIntento, motivos, sla, tiempos, fechas] = await Promise.all([
    col
      .aggregate([
        { $match: filtro },
        {
          $group: {
            _id: { zonaId: '$zonaId', franja: '$franja' },
            hubId: { $first: '$hubId' },
            entregados: suma('primerIntento.entregados'),
            fallidos: suma('primerIntento.fallidos'),
          },
        },
        { $sort: { '_id.zonaId': 1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: filtro },
        {
          $group: {
            _id: '$zonaId',
            AUSENTE: suma('motivos.AUSENTE'),
            DIRECCION_INCORRECTA: suma('motivos.DIRECCION_INCORRECTA'),
            RECHAZADO: suma('motivos.RECHAZADO'),
            ZONA_INACCESIBLE: suma('motivos.ZONA_INACCESIBLE'),
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: filtro },
        {
          $group: {
            _id: { hubId: '$hubId', fecha: '$fecha' },
            cumplidos: suma('sla.cumplidos'),
            incumplidos: suma('sla.incumplidos'),
          },
        },
        { $sort: { '_id.hubId': 1, '_id.fecha': 1 } },
      ])
      .toArray(),
    d
      .collection('metricas_tiempos_hub')
      .aggregate([
        { $match: { ...(hubId && { hubId }), ...(fecha && { fecha }) } },
        { $group: { _id: '$hubId', sumaMinutos: { $sum: '$sumaMinutos' }, cantidad: { $sum: '$cantidad' } } },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    col.distinct('fecha'),
  ]);
  return { primerIntento, motivos, sla, tiempos, fechas: fechas.sort() };
}
