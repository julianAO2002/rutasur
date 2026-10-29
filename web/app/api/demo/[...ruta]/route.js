// Proxy del panel de demo hacia el simulador (no es parte del modelo de lectura).
export const dynamic = 'force-dynamic';

const SIMULADOR = process.env.SIMULADOR_URL || 'http://localhost:4000';
const PERMITIDAS = /^(estado|lag|flujo|pausa|escenarios\/[a-z-]+)$/;

async function reenviar(request, { params }) {
  const ruta = (await params).ruta.join('/');
  if (!PERMITIDAS.test(ruta)) return Response.json({ error: 'ruta no permitida' }, { status: 404 });
  const { search } = new URL(request.url);
  try {
    const res = await fetch(`${SIMULADOR}/${ruta}${search}`, { method: request.method, cache: 'no-store' });
    return Response.json(await res.json(), { status: res.status });
  } catch (e) {
    return Response.json({ error: `simulador no disponible: ${e.message}` }, { status: 503 });
  }
}

export { reenviar as GET, reenviar as POST };
