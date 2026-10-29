import { redirect } from 'next/navigation';

export default function BuscarTracking() {
  async function buscar(formData) {
    'use server';
    const codigo = String(formData.get('codigo') ?? '').trim().toUpperCase();
    if (codigo) redirect(`/tracking/${encodeURIComponent(codigo)}`);
  }

  return (
    <section className="tarjeta" style={{ maxWidth: 520, margin: '40px auto' }}>
      <h1>Seguí tu envío</h1>
      <p className="subtitulo">Ingresá el código que te envió el comercio.</p>
      <form action={buscar} className="filtros">
        <label style={{ flex: 1 }}>
          Código de seguimiento
          <input name="codigo" placeholder="RS-ABC-000123" required autoComplete="off" />
        </label>
        <button className="primario" type="submit">
          Buscar
        </button>
      </form>
    </section>
  );
}
