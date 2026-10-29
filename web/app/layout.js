import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: 'RutaSur · Torre de control',
  description: 'Seguimiento de envíos en tiempo real orientado a eventos (TP7 Programación Avanzada)',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <header className="barra">
          <Link href="/" className="marca">
            <span className="logo" aria-hidden>
              ▲
            </span>
            RutaSur
          </Link>
          <nav>
            <Link href="/">Torre de control</Link>
            <Link href="/tracking">Tracking</Link>
            <Link href="/analitica">Analítica</Link>
            <Link href="/demo">Demo</Link>
          </nav>
        </header>
        <main className="contenido">{children}</main>
      </body>
    </html>
  );
}
