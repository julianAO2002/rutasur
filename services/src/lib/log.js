// Log de una linea por evento: cada servicio registra eventId, particion y offset.
export function log(servicio, mensaje, datos = {}) {
  const extra = Object.entries(datos)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  console.log(`${new Date().toISOString()} [${servicio}] ${mensaje}${extra ? ` ${extra}` : ''}`);
}
