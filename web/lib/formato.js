// Formatos y vocabulario de la interfaz.
const zona = 'America/Argentina/Buenos_Aires';
const fechaHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: zona,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const soloFecha = new Intl.DateTimeFormat('es-AR', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long' });

export const fmtFechaHora = (f) => (f ? fechaHora.format(new Date(f)) : '—');
export const fmtFecha = (f) => (f ? soloFecha.format(new Date(f)) : '—');
/** Fecha calendario YYYY-MM-DD (sin hora): se ancla al mediodia para no correrse de dia. */
export const fmtDia = (ymd) => (ymd ? soloFecha.format(new Date(`${ymd}T15:00:00Z`)) : '—');
export const pct = (a, b) => (a + b === 0 ? null : (100 * a) / (a + b));
export const fmtPct = (v) => (v === null ? '—' : `${v.toFixed(1)} %`);

export const ETIQUETA = {
  CREADO: 'Creado',
  INGRESADO_HUB: 'En el hub',
  CLASIFICADO: 'Clasificado',
  EN_REPARTO: 'En reparto',
  ENTREGADO: 'Entregado',
  ENTREGA_FALLIDA: 'Entrega fallida',
  REPROGRAMADO: 'Reprogramado',
  RETENIDO: 'Retenido',
  DEVOLUCION: 'Devolución',
  AUSENTE: 'Ausente',
  DIRECCION_INCORRECTA: 'Dirección incorrecta',
  RECHAZADO: 'Rechazado',
  ZONA_INACCESIBLE: 'Zona inaccesible',
  SIN_INGRESO: 'Sin ingreso',
  SIN_SALIDA: 'Sin salida',
  FALLO_DIA_LIMITE: 'Fallo en el día límite',
  VENCIDO: 'Vencido',
  MANANA: 'Mañana',
  TARDE: 'Tarde',
};
export const etiqueta = (v) => ETIQUETA[v] ?? v;

export const ORDEN_SITUACION = [
  'CREADO',
  'INGRESADO_HUB',
  'CLASIFICADO',
  'EN_REPARTO',
  'ENTREGADO',
  'ENTREGA_FALLIDA',
  'REPROGRAMADO',
  'RETENIDO',
  'DEVOLUCION',
];
