'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const ESCENARIOS = [
  { id: 'feliz', titulo: 'Envío feliz', texto: 'Recorre todos los estados sin incidentes (≈ 40 s).' },
  { id: 'ausente', titulo: 'Ausente', texto: 'Falla por ausencia: aviso, reprogramación y analítica a la vez.' },
  { id: 'demorado', titulo: 'Demorado', texto: 'Queda detenido en el hub hasta generar la alerta Sin salida (≈ 3 min).' },
  { id: 'tercer-fallo', titulo: 'Tercer fallo', texto: 'Agota sus tres intentos y pasa a devolución (≈ 2 min).' },
  { id: 'rafaga', titulo: 'Ráfaga', texto: '500 envíos de golpe: acumulación y recuperación del lag.' },
  { id: 'invalido', titulo: 'Evento inválido', texto: 'Inyecta un evento malformado: termina en la DLQ.' },
];

const json = async (url, opciones) => {
  const res = await fetch(url, { cache: 'no-store', ...opciones });
  return res.json();
};

export default function PanelDemo() {
  const [disparados, setDisparados] = useState([]);
  const [ocupado, setOcupado] = useState(null);
  const [lag, setLag] = useState([]);
  const [estado, setEstado] = useState(null);

  useEffect(() => {
    let activo = true;
    const actualizar = async () => {
      try {
        const [l, e] = await Promise.all([json('/api/demo/lag'), json('/api/demo/estado')]);
        if (!activo) return;
        if (Array.isArray(l)) setLag(l);
        setEstado(e);
      } catch {
        /* el simulador puede estar reiniciando */
      }
    };
    actualizar();
    const id = setInterval(actualizar, 2000);
    return () => {
      activo = false;
      clearInterval(id);
    };
  }, []);

  async function disparar(escenario) {
    setOcupado(escenario);
    try {
      const r = await json(`/api/demo/escenarios/${escenario}`, { method: 'POST' });
      setDisparados((d) => [{ escenario, ids: r.shipmentIds ?? [], error: r.error, en: new Date() }, ...d].slice(0, 10));
    } finally {
      setOcupado(null);
    }
  }

  async function pausar(activa) {
    await json(`/api/demo/pausa?activa=${activa}`, { method: 'POST' });
    setEstado(await json('/api/demo/estado'));
  }

  return (
    <div className="grilla">
      <section className="tarjeta">
        <h2>Escenarios</h2>
        <div className="botones">
          {ESCENARIOS.map((e) => (
            <button key={e.id} className="boton-escenario" disabled={ocupado !== null} onClick={() => disparar(e.id)}>
              {e.titulo}
              <small>{e.texto}</small>
            </button>
          ))}
        </div>
        {disparados.length > 0 && (
          <ul className="feed" style={{ marginTop: 14 }}>
            {disparados.map((d, i) => (
              <li key={i}>
                <strong>{d.escenario}</strong>
                {d.error && <span className="chip chip-CRITICA">{d.error}</span>}
                {d.ids.map((id) =>
                  id.includes('..') ? (
                    <span key={id} className="mono">
                      {id}
                    </span>
                  ) : (
                    <span key={id}>
                      <Link href={`/envios/${id}`} className="mono">
                        {id}
                      </Link>{' '}
                      · <Link href={`/tracking/${id}`}>tracking</Link>
                    </span>
                  ),
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grilla dos-columnas">
        <section className="tarjeta">
          <h2>Lag por grupo de consumidores</h2>
          <table>
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Estado</th>
                <th className="num">Consumidores</th>
                <th className="num">Lag</th>
              </tr>
            </thead>
            <tbody>
              {lag.map((g) => (
                <tr key={g.grupo}>
                  <td className="mono">{g.grupo}</td>
                  <td>
                    <span className={`chip ${g.miembros > 0 ? 'chip-ENTREGADO' : 'chip-CRITICA'}`}>
                      {g.miembros > 0 ? 'activo' : g.conOffsets ? 'detenido' : 'sin iniciar'}
                    </span>
                  </td>
                  <td className="num">{g.miembros}</td>
                  <td className="num">
                    <strong>{g.lag.toLocaleString('es-AR')}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tenue">
            Detalle de topics, mensajes y DLQ en <a href="http://localhost:8080">Kafka UI</a>.
          </p>
        </section>

        <section className="tarjeta">
          <h2>Simulador</h2>
          {estado?.error ? (
            <p className="vacio">{estado.error}</p>
          ) : (
            estado && (
              <dl className="datos">
                <dt>Reloj simulado</dt>
                <dd>{new Date(estado.simAhora).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</dd>
                <dt>Aceleración</dt>
                <dd>1 h simulada = {3600 / estado.factorAceleracion} s</dd>
                <dt>Corrida / semilla</dt>
                <dd className="mono">
                  {estado.corrida} / {estado.semilla}
                </dd>
                <dt>Envíos creados</dt>
                <dd>{estado.enviosCreados}</dd>
                <dt>Eventos agendados</dt>
                <dd>{estado.eventosPendientes}</dd>
                <dt>Simulación</dt>
                <dd>
                  {estado.pausado ? 'pausada (reloj detenido)' : 'en marcha'}{' '}
                  <button onClick={() => pausar(!estado.pausado)}>{estado.pausado ? 'Reanudar' : 'Pausar'}</button>
                </dd>
              </dl>
            )
          )}
        </section>
      </div>
    </div>
  );
}
