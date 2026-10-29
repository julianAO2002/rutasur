// Analitica (gerencia): los indicadores de CU4 sobre metricas_diarias, con filtros.
import { analitica } from '@/lib/datos';
import { etiqueta, fmtDia, fmtPct, pct } from '@/lib/formato';

export const dynamic = 'force-dynamic';

const HUBS = { 'HUB-NORTE': ['Z-CENTRO', 'Z-PUERTO', 'Z-ESTE'], 'HUB-SUR': ['Z-QUINTAS', 'Z-RUTA14', 'Z-BALNEARIO'], 'HUB-OESTE': ['Z-COLONIA', 'Z-PARQUE', 'Z-TERMAS'] };
const MOTIVOS = ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'];

// Color de la celda: rojo cuanto menor es la tasa de entrega en primer intento.
const fondoTasa = (v) =>
  v === null ? 'transparent' : `color-mix(in srgb, var(--critica) ${Math.round(Math.min(1, (100 - v) / 40) * 55)}%, transparent)`;

export default async function Analitica({ searchParams }) {
  const { zonaId = '', hubId = '', fecha = '' } = await searchParams;
  const datos = await analitica({ zonaId, hubId, fecha });

  const zonas = [...new Set(datos.primerIntento.map((f) => f._id.zonaId))].sort();
  const celda = (z, franja) => datos.primerIntento.find((f) => f._id.zonaId === z && f._id.franja === franja);
  const tasa = (f) => (f ? pct(f.entregados, f.fallidos) : null);
  const peor = datos.primerIntento
    .filter((f) => f.entregados + f.fallidos >= 10)
    .map((f) => ({ ...f, tasa: tasa(f) }))
    .sort((a, b) => a.tasa - b.tasa)[0];
  const maxMotivos = Math.max(1, ...datos.motivos.map((m) => MOTIVOS.reduce((s, k) => s + m[k], 0)));
  const maxTiempo = Math.max(1, ...datos.tiempos.map((t) => t.sumaMinutos / t.cantidad));

  return (
    <>
      <h1>Analítica de mejora</h1>
      <p className="subtitulo">Agregados incrementales de metricas_diarias (se calcula al cargar la página).</p>

      <form className="filtros" method="get">
        <label>
          Hub
          <select name="hubId" defaultValue={hubId}>
            <option value="">Todos</option>
            {Object.keys(HUBS).map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
        </label>
        <label>
          Zona
          <select name="zonaId" defaultValue={zonaId}>
            <option value="">Todas</option>
            {Object.values(HUBS)
              .flat()
              .map((z) => (
                <option key={z}>{z}</option>
              ))}
          </select>
        </label>
        <label>
          Fecha
          <select name="fecha" defaultValue={fecha}>
            <option value="">Todas</option>
            {datos.fechas.map((f) => (
              <option key={f} value={f}>
                {fmtDia(f)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="primario">
          Aplicar
        </button>
      </form>

      {peor && (
        <section className="tarjeta destacado" style={{ marginBottom: 16 }}>
          <strong>
            Dónde fallamos más: {peor._id.zonaId} por la {peor._id.franja === 'MANANA' ? 'mañana' : 'tarde'} (
            {fmtPct(peor.tasa)} de entrega en primer intento).
          </strong>{' '}
          {peor._id.franja === 'MANANA'
            ? `Propuesta: ofrecer la franja vespertina por defecto en ${peor._id.zonaId}.`
            : `Propuesta: revisar la capacidad de reparto vespertina en ${peor._id.zonaId}.`}
        </section>
      )}

      <div className="grilla" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))' }}>
        <section className="tarjeta">
          <h2>1 · Tasa de entrega en primer intento</h2>
          <p className="tenue">¿Dónde y cuándo fallamos más? Por zona y franja horaria.</p>
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Zona</th>
                  <th className="num">Mañana</th>
                  <th className="num">Tarde</th>
                  <th className="num">Intentos</th>
                </tr>
              </thead>
              <tbody>
                {zonas.length === 0 && (
                  <tr>
                    <td colSpan={4} className="vacio">
                      Sin datos todavía.
                    </td>
                  </tr>
                )}
                {zonas.map((z) => {
                  const m = celda(z, 'MANANA');
                  const t = celda(z, 'TARDE');
                  const n = (f) => (f ? f.entregados + f.fallidos : 0);
                  return (
                    <tr key={z}>
                      <td>{z}</td>
                      {[m, t].map((f, i) => (
                        <td key={i} className="celda-tasa" style={{ background: fondoTasa(tasa(f)) }}>
                          {fmtPct(tasa(f))}
                        </td>
                      ))}
                      <td className="num tenue">{n(m) + n(t)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tarjeta">
          <h2>2 · Distribución de motivos de fallo</h2>
          <p className="tenue">¿Por qué fallamos? Por zona y motivo.</p>
          <div className="leyenda">
            {MOTIVOS.map((m) => (
              <span key={m}>
                <i className={`m-${m}`} />
                {etiqueta(m)}
              </span>
            ))}
          </div>
          <div className="tabla-scroll">
            <table>
              <tbody>
                {datos.motivos.map((m) => {
                  const total = MOTIVOS.reduce((s, k) => s + m[k], 0);
                  return (
                    <tr key={m._id}>
                      <td>{m._id}</td>
                      <td style={{ width: '100%' }}>
                        <div className="barra-apilada" style={{ width: `${(100 * total) / maxMotivos}%` }}>
                          {MOTIVOS.map((k) => (
                            <span
                              key={k}
                              className={`m-${k}`}
                              style={{ width: `${total ? (100 * m[k]) / total : 0}%` }}
                              title={`${etiqueta(k)}: ${m[k]}`}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="num">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tarjeta">
          <h2>3 · Cumplimiento de SLA</h2>
          <p className="tenue">¿Qué hub llega tarde? Entregas dentro de la promesa, por hub y día.</p>
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Hub</th>
                  <th>Día</th>
                  <th className="num">A tiempo</th>
                  <th className="num">Tarde</th>
                  <th className="num">Cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {datos.sla.map((s) => (
                  <tr key={`${s._id.hubId}-${s._id.fecha}`}>
                    <td>{s._id.hubId}</td>
                    <td className="tenue">{fmtDia(s._id.fecha)}</td>
                    <td className="num">{s.cumplidos}</td>
                    <td className="num">{s.incumplidos}</td>
                    <td className="num">
                      <strong>{fmtPct(pct(s.cumplidos, s.incumplidos))}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tarjeta">
          <h2>4 · Tiempo medio en el hub (reprocesamiento)</h2>
          <p className="tenue">Minutos entre INGRESADO_HUB y EN_REPARTO, por hub.</p>
          {datos.tiempos.length === 0 ? (
            <p className="vacio">
              Indicador no activado. Se agrega con el sistema en marcha:{' '}
              <code className="mono">docker compose --profile replay up -d analitica-tiempos</code>
            </p>
          ) : (
            <table>
              <tbody>
                {datos.tiempos.map((t) => {
                  const medio = t.sumaMinutos / t.cantidad;
                  return (
                    <tr key={t._id}>
                      <td>{t._id}</td>
                      <td style={{ width: '100%' }}>
                        <div className="barra-simple" style={{ width: `${(100 * medio) / maxTiempo}%` }} />
                      </td>
                      <td className="num">{Math.round(medio)} min</td>
                      <td className="num tenue">{t.cantidad} envíos</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
