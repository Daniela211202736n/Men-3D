/**
 * Portada de la plataforma (lo que se ve en la raiz del dominio).
 *
 * Cumple dos funciones: explicar la propuesta a un dueño de restaurante que
 * llega por una recomendacion, y dar acceso rapido a las cartas de demostracion.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const DEMOS = [
  {
    slug: 'la-parrilla-de-don-pepe',
    name: 'La Parrilla de Don Pepe',
    detail: 'Plan Pro — carta completa en 3D, pedidos y metricas',
  },
  {
    slug: 'verde-bowl',
    name: 'Verde Bowl',
    detail: 'Plan Starter — sin pedido online ni analitica avanzada',
  },
];

const FEATURES = [
  ['Ver el plato en 3D y en RA', 'El comensal gira el plato y lo apoya en su mesa a escala real antes de pedirlo.'],
  ['Filtros de alergenos y dietas', 'Celiacos, veganos o alergicos ven solo lo que pueden comer.'],
  ['Pedido y pago desde el celular', 'El pedido entra directo a la pantalla de cocina, sin mozo de intermediario.'],
  ['QR por mesa en PDF', 'Se imprime y se pone en la mesa; cada escaneo queda medido.'],
  ['Carta en varios idiomas', 'Traduccion automatica para zonas turisticas.'],
  ['Metricas de interes visual', 'Que platos se miran mucho y se piden poco, el dato que no da ningun menu de papel.'],
];

export function LandingPage(): ReactNode {
  return (
    <div className="container stack stack-6" style={{ padding: '40px 16px 56px' }}>
      <header className="stack stack-4">
        <span className="badge badge-3d" style={{ alignSelf: 'flex-start' }}>
          Men-3D
        </span>
        <h1 style={{ fontSize: '2rem' }}>
          ¿Y si pudieras ver el plato en 3D antes de pedirlo?
        </h1>
        <p className="secondary">
          Carta digital en 3D y realidad aumentada para restaurantes. Funciona en el
          navegador del celular, sin que el comensal instale nada.
        </p>
      </header>

      <section className="stack stack-3">
        <h2>Probar una carta</h2>
        {DEMOS.map((demo) => (
          <Link key={demo.slug} to={`/m/${demo.slug}`} className="card card-pad row-between">
            <span className="stack" style={{ gap: 2 }}>
              <span className="bold">{demo.name}</span>
              <span className="tiny muted">{demo.detail}</span>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </section>

      <section className="stack stack-3">
        <h2>Que incluye</h2>
        <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {FEATURES.map(([title, body]) => (
            <li key={title} className="stack" style={{ gap: 2 }}>
              <span className="bold small">{title}</span>
              <span className="small secondary">{body}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-pad stack stack-3">
        <h2>Para el restaurante</h2>
        <p className="small secondary">
          El backoffice permite cargar y dar de baja platos, cambiar precios en el
          momento, reordenar la carta, generar los QR, personalizar colores y logo, y
          seguir los pedidos en la pantalla de cocina.
        </p>
        <Link to="/admin" className="btn btn-primary">
          Entrar al panel
        </Link>
      </section>
    </div>
  );
}
