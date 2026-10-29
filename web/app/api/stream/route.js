// Server-Sent Events: reenvia al navegador los cambios de los change streams de MongoDB.
import { cambios } from '@/lib/mongo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const shipmentId = new URL(request.url).searchParams.get('shipmentId');
  const emisor = cambios();
  const codificador = new TextEncoder();
  let liberar = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const enviar = (texto) => {
        try {
          controller.enqueue(codificador.encode(texto));
        } catch {
          liberar();
        }
      };
      const oyente = (cambio) => {
        if (!shipmentId || cambio.shipmentId === shipmentId) enviar(`data: ${JSON.stringify(cambio)}\n\n`);
      };
      const latido = setInterval(() => enviar(': latido\n\n'), 15000);
      emisor.on('cambio', oyente);
      liberar = () => {
        clearInterval(latido);
        emisor.off('cambio', oyente);
      };
      request.signal.addEventListener('abort', () => {
        liberar();
        try {
          controller.close();
        } catch {}
      });
      enviar('retry: 2000\n\n');
    },
    cancel() {
      liberar();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
