// Detalle del envio (supervisor): linea de tiempo, intentos, alertas y notificaciones.
import Link from 'next/link';
import EnVivo from '@/components/EnVivo';
import { envio as buscarEnvio, situacion } from '@/lib/datos';
import { etiqueta, fmtFechaHora, fmtDia } from '@/lib/formato';

export const dynamic = 'force-dynamic';

export default async function DetalleEnvio({ params }) {
  const { id } = await params;
  const envio = await buscarEnvio(decodeURIComponent(id));
  if (!envio) {
    return (
      <>
        <h1 className="mono">{decodeURIComponent(id)}</h1>
        <p className="vacio">Todavía no hay eventos proyectados para este envío.</p>
        <EnVivo shipmentId={decodeURIComponent(id)} />
      </>
    );
  }
  const historial = [...(envio.historial ?? [])].sort(
    (a, b) => new Date(a.ocurridoEn) - new Date(b.ocurridoEn) || (a.secuencia ?? 99) - (b.secuencia ?? 99),
  );
  const sit = situacion(envio);
  const decision = envio.ultimaDecision;

  return (
    <>
      <div className="cabecera">
        <div>
          <h1 className="mono">{envio.shipmentId}</h1>
          <p className="subtitulo">
            <span className={`chip chip-${sit}`}>{etiqueta(sit)}</span>{' '}
            <Link href={`/tracking/${envio.shipmentId}`}>ver tracking público</Link>
          </p>
        </div>
        <EnVivo shipmentId={envio.shipmentId} />
      </div>

      <div className="grilla dos-columnas">
        <section className="tarjeta">
          <h2>Línea de tiempo</h2>
          <ol className="linea-tiempo">
            {historial.map((h) => (
              <li key={h.eventId} className={`c-${h.tipo}`}>
                <strong>{etiqueta(h.tipo)}</strong>
                {h.intento && <span className="tenue"> · intento {h.intento}</span>}
                {h.motivo && <span className="tenue"> · {etiqueta(h.motivo)}</span>}
                <div className="detalle">
                  {fmtFechaHora(h.ocurridoEn)} · <span className="mono">{h.eventId}</span>
                  {h.secuencia && ` · secuencia ${h.secuencia}`}
                </div>
                {h.detalle && <div className="detalle">{h.detalle}</div>}
              </li>
            ))}
          </ol>
        </section>

        <div className="grilla">
          <section className="tarjeta">
            <h2>Datos del envío</h2>
            <dl className="datos">
              <dt>Hub / zona</dt>
              <dd>
                {envio.hubId} · {envio.zonaId}
              </dd>
              <dt>Repartidor</dt>
              <dd className="mono">{envio.repartidorId}</dd>
              <dt>Promesa</dt>
              <dd>{fmtFechaHora(envio.promesa?.venceEn)}</dd>
              <dt>Intentos</dt>
              <dd>{envio.intentos ?? 0} de 3</dd>
              <dt>Última secuencia</dt>
              <dd>{envio.ultimaSecuencia}</dd>
              {decision && (
                <>
                  <dt>Decisión</dt>
                  <dd>
                    <span className={`chip chip-${decision.tipo}`}>{etiqueta(decision.tipo)}</span> {decision.detalle}
                    {decision.proximoIntento && (
                      <div className="tenue">
                        Próximo intento: {fmtDia(decision.proximoIntento.fecha)}, {etiqueta(decision.proximoIntento.franja)}
                      </div>
                    )}
                  </dd>
                </>
              )}
            </dl>
          </section>

          <section className="tarjeta">
            <h2>Alertas de SLA</h2>
            {envio.alertas.length === 0 ? (
              <p className="vacio">Sin alertas.</p>
            ) : (
              <ul className="feed">
                {envio.alertas.map((a) => (
                  <li key={a.alertaId}>
                    <span className={`chip chip-${a.estado === 'CERRADA' ? 'CERRADA' : a.prioridad}`}>
                      {a.estado === 'CERRADA' ? 'cerrada' : a.prioridad}
                    </span>
                    <span>{etiqueta(a.regla)}</span>
                    <span className="tenue">
                      {fmtFechaHora(a.abiertaEn)}
                      {a.cerradaEn && ` → ${fmtFechaHora(a.cerradaEn)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="tarjeta">
            <h2>Notificaciones al destinatario</h2>
            {envio.notificaciones.length === 0 ? (
              <p className="vacio">Sin avisos.</p>
            ) : (
              <ul className="feed">
                {envio.notificaciones.map((n) => (
                  <li key={n.notificacionId} style={{ display: 'block' }}>
                    <div>
                      <span className="chip chip-notificaciones">{n.canal}</span>{' '}
                      <span className="tenue">{fmtFechaHora(n.enviadaEn)}</span>
                    </div>
                    <div>{n.mensaje}</div>
                    {n.opciones?.length > 0 && <div className="tenue">Opciones: {n.opciones.join(' · ')}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
