// Vocabulario del dominio y utilidades de tiempo compartidas.

export const ESTADOS = ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO', 'ENTREGA_FALLIDA'];
export const MOTIVOS = ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'];
export const PRIORIDADES = { MEDIA: 1, ALTA: 2, CRITICA: 3 };
export const VERSION_ESQUEMA = 1;

// Tres centros de distribucion, cada uno con sus zonas.
export const HUBS = [
  { hubId: 'HUB-NORTE', zonas: ['Z-CENTRO', 'Z-PUERTO', 'Z-ESTE'] },
  { hubId: 'HUB-SUR', zonas: ['Z-QUINTAS', 'Z-RUTA14', 'Z-BALNEARIO'] },
  { hubId: 'HUB-OESTE', zonas: ['Z-COLONIA', 'Z-PARQUE', 'Z-TERMAS'] },
];
export const ZONAS = HUBS.flatMap((h) => h.zonas.map((zonaId) => ({ zonaId, hubId: h.hubId })));
export const hubDeZona = (zonaId) => ZONAS.find((z) => z.zonaId === zonaId)?.hubId;

export const HORA_MS = 60 * 60 * 1000;
export const DIA_MS = 24 * HORA_MS;

// El caso transcurre en Argentina (UTC-3, sin horario de verano).
const OFFSET_MS = -3 * HORA_MS;
const local = (ms) => new Date(ms + OFFSET_MS);

/** Fecha local (YYYY-MM-DD) de un instante. */
export const fechaLocal = (fecha) => local(new Date(fecha).getTime()).toISOString().slice(0, 10);

/** Hora local (0-23) de un instante. */
export const horaLocal = (fecha) => local(new Date(fecha).getTime()).getUTCHours();

/** Franja horaria de reparto: MANANA (antes de las 14) o TARDE. */
export const franjaDe = (fecha) => (horaLocal(fecha) < 14 ? 'MANANA' : 'TARDE');
export const franjaOpuesta = (franja) => (franja === 'MANANA' ? 'TARDE' : 'MANANA');
export const HORA_INICIO_FRANJA = { MANANA: 8, TARDE: 14 };

/** Instante (ms) de una fecha local YYYY-MM-DD a una hora local dada. */
export const instanteLocal = (fechaYmd, hora, minutos = 0) =>
  Date.parse(`${fechaYmd}T00:00:00.000Z`) - OFFSET_MS + hora * HORA_MS + minutos * 60000;

const esHabil = (fechaYmd) => {
  const dia = new Date(`${fechaYmd}T12:00:00Z`).getUTCDay();
  return dia !== 0 && dia !== 6;
};

/** Primer dia habil estrictamente posterior a la fecha del instante dado (YYYY-MM-DD). */
export const diaHabilSiguiente = (fecha) => {
  let ms = Date.parse(`${fechaLocal(fecha)}T12:00:00Z`);
  do {
    ms += DIA_MS;
  } while (!esHabil(new Date(ms).toISOString().slice(0, 10)));
  return new Date(ms).toISOString().slice(0, 10);
};

/** Primer instante habil de reparto (lunes a viernes, 8 a 19 h) a partir de `ms`. */
export const proximoHorarioReparto = (ms) => {
  const fecha = fechaLocal(ms);
  const hora = horaLocal(ms);
  if (esHabil(fecha) && hora >= 8 && hora < 19) return ms;
  if (esHabil(fecha) && hora < 8) return instanteLocal(fecha, 8);
  return instanteLocal(diaHabilSiguiente(ms), 8);
};
