// Tracking publico (destinatario): estado actual y fecha estimada, sin datos internos.
import Link from 'next/link';
import EnVivo from '@/components/EnVivo';
import { envio as buscarEnvio, situacion } from '@/lib/datos';
import { fmtFecha, fmtFechaHora, fmtDia, etiqueta } from '@/lib/formato';

export const dynamic = 'force-dynamic';

const PUBLICO = {
  CREADO: 'Recibimos tu envío',
  INGRESADO_HUB: 'Está en nuestro centro de distribución',
  CLASIFICADO: 'Lo estamos preparando para el reparto',
  EN_REPARTO: 'Está en camino',
  ENTREGADO: 'Entregado',
  ENTREGA_FALLIDA: 'No pudimos entregarlo',
  REPROGRAMADO: 'Reprogramamos la entrega',
  RETENIDO: 'Necesitamos que confirmes tu dirección',
  DEVOLUCION: 'Lo estamos devolviendo al comercio',
};
const PASOS = ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO'];

export default async function Tracking({ params }) {
  const { id } = await params;
  const codigo = decodeURIComponent(id);
  const envio = await buscarEnvio(codigo);

  if (!envio?.estado) {
    return (
      <section className="tarjeta" style={{ maxWidth: 620, margin: '24px auto' }}>
        <h1 className="mono">{codigo}</h1>
        <p className="vacio">No encontramos un envío con ese código (si recién lo creaste, esperá unos segundos).</p>
        <EnVivo shipmentId={codigo} />
        <p>
          <Link href="/tracking">Buscar otro código</Link>
        </p>
      </section>
    );
  }

  const sit = situacion(envio);
  const avance = Math.max(0, PASOS.indexOf(envio.estado === 'ENTREGA_FALLIDA' ? 'EN_REPARTO' : envio.estado));
  const proximo = sit === 'REPROGRAMADO' ? envio.ultimaDecision?.proximoIntento : null;

  return (
    <section className="tarjeta" style={{ maxWidth: 620, margin: '24px auto' }}>
      <div className="cabecera" style={{ marginBottom: 0 }}>
        <span className="tenue">
          Envío <span className="mono">{envio.shipmentId}</span>
        </span>
        <EnVivo shipmentId={envio.shipmentId} />
      </div>
      <div className={`tracking-estado c-${sit}`} style={{ color: 'var(--color, var(--texto))' }}>
        {PUBLICO[sit] ?? sit}
      </div>
      <div className="pasos" aria-label={`Paso ${avance + 1} de ${PASOS.length}`}>
        {PASOS.map((p, i) => (
          <span key={p} className={i <= avance ? 'hecho' : ''} title={etiqueta(p)} />
        ))}
      </div>
      <dl className="datos">
        <dt>Último movimiento</dt>
        <dd>{fmtFechaHora(envio.ultimoEventoEn)}</dd>
        {sit === 'ENTREGADO' ? null : proximo ? (
          <>
            <dt>Nuevo intento</dt>
            <dd>
              {fmtDia(proximo.fecha)}, por la {proximo.franja === 'MANANA' ? 'mañana' : 'tarde'}
            </dd>
          </>
        ) : (
          sit !== 'DEVOLUCION' && (
            <>
              <dt>Fecha estimada</dt>
              <dd>Antes del {fmtFecha(envio.promesa?.venceEn)}</dd>
            </>
          )
        )}
      </dl>
    </section>
  );
}
