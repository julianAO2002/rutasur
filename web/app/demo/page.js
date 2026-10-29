import PanelDemo from '@/components/PanelDemo';

export const metadata = { title: 'RutaSur · Panel de demo' };

export default function Demo() {
  return (
    <>
      <h1>Panel de demo</h1>
      <p className="subtitulo">
        Dispara los escenarios del simulador y muestra el lag de cada grupo de consumidores. Para la caída de un
        servicio: <code className="mono">docker compose stop notificaciones</code> y luego{' '}
        <code className="mono">docker compose start notificaciones</code>.
      </p>
      <PanelDemo />
    </>
  );
}
