// Torre de control (supervisor): contadores por estado, cola de alertas priorizada y ultimos eventos.
import Link from 'next/link';
import EnVivo from '@/components/EnVivo';
import { contadores, alertasAbiertas, ultimosEnvios } from '@/lib/datos';
import { ORDEN_SITUACION, etiqueta, fmtFechaHora } from '@/lib/formato';

export const dynamic = 'force-dynamic';

export default async function TorreDeControl() {
  const [porEstado, alertas, ultimos] = await Promise.all([contadores(), alertasAbiertas(), ultimosEnvios()]);
  const total = Object.values(porEstado).reduce((s, n) => s + n, 0);
  const inicial = ultimos.map((e) => ({
    clave: e.shipmentId,
    coleccion: 'envios',
    shipmentId: e.shipmentId,
    estado: e.estado,
    zonaId: e.zonaId,
  }));

  return (
    <>
      <div className="cabecera">
        <div>
          <h1>Torre de control</h1>
          <p className="subtitulo">{total.toLocaleString('es-AR')} envíos proyectados desde el log de eventos</p>
        </div>
      </div>

      <section className="contadores" aria-label="Envíos por estado">
        {ORDEN_SITUACION.map((estado) => (
          <div key={estado} className={`contador c-${estado}`}>
            <div className="valor">{(porEstado[estado] ?? 0).toLocaleString('es-AR')}</div>
            <div className="nombre">{etiqueta(estado)}</div>
          </div>
        ))}
      </section>

      <div className="grilla dos-columnas">
        <section className="tarjeta">
          <h2>
            Cola de alertas de SLA · {alertas.total} abiertas{' '}
            <span className="tenue">
              ({['CRITICA', 'ALTA', 'MEDIA'].map((p) => `${alertas.porPrioridad[p] ?? 0} ${p.toLowerCase()}`).join(', ')})
            </span>
          </h2>
          {alertas.lista.length === 0 ? (
            <p className="vacio">Sin alertas abiertas.</p>
          ) : (
            <div className="tabla-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Prioridad</th>
                    <th>Envío</th>
                    <th>Regla</th>
                    <th>Vence</th>
                    <th>Zona</th>
                  </tr>
                </thead>
                <tbody>
                  {alertas.lista.map((a) => (
                    <tr key={a.alertaId}>
                      <td>
                        <span className={`chip chip-${a.prioridad}`}>{a.prioridad}</span>
                      </td>
                      <td>
                        <Link className="mono" href={`/envios/${a.shipmentId}`}>
                          {a.shipmentId}
                        </Link>
                      </td>
                      <td title={a.causa}>{etiqueta(a.regla)}</td>
                      <td>{fmtFechaHora(a.venceEn)}</td>
                      <td className="tenue">{a.zonaId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="tarjeta">
          <EnVivo feed inicial={inicial} />
        </section>
      </div>
    </>
  );
}
