'use client';
// Escucha el SSE y aplica los cambios: refresca los datos renderizados en el servidor
// (con un tope de un refresco cada 700 ms) y, si se pide, mantiene un feed de eventos.
import { useEffect, useRef, useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { etiqueta } from '@/lib/formato';

const ESPERA_MS = 700;

export default function EnVivo({ shipmentId, feed = false, inicial = [] }) {
  const router = useRouter();
  const [estado, setEstado] = useState('conectando');
  const [items, setItems] = useState(inicial);
  const temporizador = useRef(null);
  const ultimo = useRef(0);

  useEffect(() => {
    const url = `/api/stream${shipmentId ? `?shipmentId=${encodeURIComponent(shipmentId)}` : ''}`;
    const fuente = new EventSource(url);
    const refrescar = () => {
      if (temporizador.current) return;
      const espera = Math.max(0, ESPERA_MS - (Date.now() - ultimo.current));
      temporizador.current = setTimeout(() => {
        temporizador.current = null;
        ultimo.current = Date.now();
        startTransition(() => router.refresh());
      }, espera);
    };
    fuente.onopen = () => setEstado('en vivo');
    fuente.onerror = () => setEstado('reconectando');
    fuente.onmessage = (m) => {
      const cambio = JSON.parse(m.data);
      refrescar();
      if (feed) {
        const item = { ...cambio, clave: `${Date.now()}-${Math.random()}` };
        setItems((previos) => [item, ...previos].slice(0, 14));
      }
    };
    return () => {
      fuente.close();
      clearTimeout(temporizador.current);
      temporizador.current = null;
    };
  }, [shipmentId, feed, router]);

  const indicador = (
    <span className="envivo" data-estado={estado}>
      <span className="punto" aria-hidden /> {estado}
    </span>
  );
  if (!feed) return indicador;
  return (
    <div>
      <div className="feed-cabecera">
        <h2>Últimos eventos</h2>
        {indicador}
      </div>
      <ul className="feed">
        {items.length === 0 && <li className="vacio">Esperando eventos…</li>}
        {items.map((i) => (
          <li key={i.clave ?? i._id}>
            <Link href={`/envios/${i.shipmentId}`} className="mono">
              {i.shipmentId}
            </Link>
            <span className={`chip chip-${(i.coleccion ?? 'envios') === 'envios' ? i.estado : i.coleccion}`}>
              {describir(i)}
            </span>
            {i.zonaId && <span className="tenue">{i.zonaId}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function describir(i) {
  if (i.coleccion === 'alertas') return `Alerta ${etiqueta(i.regla)} · ${i.estado === 'CERRADA' ? 'cerrada' : i.prioridad}`;
  if (i.coleccion === 'notificaciones') return `Aviso al destinatario (${i.origen === 'ALERTA_SLA' ? 'demora' : 'fallo'})`;
  return etiqueta(i.estado);
}
