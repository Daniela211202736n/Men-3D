/**
 * Portada de la plataforma (lo que se ve en la raiz del dominio).
 *
 * Cumple dos funciones: explicar la propuesta a un dueño de restaurante que
 * llega por una recomendacion, y dar acceso rapido a las cartas de demostracion.
 *
 * Y tiene comida. Durante mucho tiempo esta pagina vendia "ver el plato antes
 * de pedirlo" sin mostrar un solo plato: tres parrafos sobre gris. Los renders
 * de los modelos de ejemplo salen con fondo transparente, asi que apilados con
 * su sombra arman una escena y no un collage de recortes. Si no estuvieran
 * —un despliegue sin `models:sample`— cada imagen se esconde sola y la portada
 * sigue funcionando.
 */
import { useState, type ReactNode } from 'react';
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

/** Los tres de la escena: uno alto, uno ancho y uno chico, para que no se tapen. */
const ESCENA = [
  { src: '/models/milanesa-napolitana.png', alt: 'Milanesa napolitana en 3D' },
  { src: '/models/malbec-copa.png', alt: 'Copa de Malbec en 3D' },
  { src: '/models/flan-casero.png', alt: 'Flan casero en 3D' },
];

const FEATURES = [
  ['Ver el plato en 3D y en RA', 'El comensal gira el plato y lo apoya en su mesa a escala real antes de pedirlo.'],
  ['Filtros de alergenos y dietas', 'Celiacos, veganos o alergicos ven solo lo que pueden comer.'],
  ['Pedido y pago desde el celular', 'El pedido entra directo a la pantalla de cocina, sin mozo de intermediario.'],
  ['QR por mesa en PDF', 'Se imprime y se pone en la mesa; cada escaneo queda medido.'],
  ['Carta en varios idiomas', 'Traduccion automatica para zonas turisticas.'],
  ['Metricas de interes visual', 'Que platos se miran mucho y se piden poco, el dato que no da ningun menu de papel.'],
];

/** Una foto que no esta no deja un hueco ni un icono roto: se va. */
function FotoEscena({ src, alt }: { src: string; alt: string }): ReactNode {
  const [rota, setRota] = useState(false);
  if (rota) return null;
  return (
    <img
      className="escena-foto"
      src={src}
      alt={alt}
      width={320}
      height={320}
      decoding="async"
      onError={() => setRota(true)}
    />
  );
}

export function LandingPage(): ReactNode {
  return (
    <div className="container stack stack-6" style={{ padding: '32px 16px 56px' }}>
      <header className="hero">
        <div className="stack stack-4 hero-texto">
          <span className="badge badge-3d" style={{ alignSelf: 'flex-start' }}>
            Men-3D
          </span>
          <h1 className="hero-titulo">
            ¿Y si pudieras ver el plato en 3D antes de pedirlo?
          </h1>
          <p className="secondary hero-bajada">
            Carta digital en 3D y realidad aumentada para restaurantes. Funciona en el
            navegador del celular, sin que el comensal instale nada.
          </p>
          <div className="row wrap" style={{ gap: 10 }}>
            <Link to={`/m/${DEMOS[0]!.slug}`} className="btn btn-primary">
              Ver una carta de ejemplo
            </Link>
            <Link to="/admin" className="btn">
              Entrar al panel
            </Link>
          </div>
        </div>
        <div className="escena">
          {ESCENA.map((foto) => (
            <FotoEscena key={foto.src} src={foto.src} alt={foto.alt} />
          ))}
        </div>
      </header>

      <section className="stack stack-3">
        <h2>Probar una carta</h2>
        {DEMOS.map((demo) => (
          <Link key={demo.slug} to={`/m/${demo.slug}`} className="card card-pad row-between tarjeta-enlace">
            <span className="stack" style={{ gap: 2 }}>
              <span className="bold">{demo.name}</span>
              <span className="tiny muted">{demo.detail}</span>
            </span>
            <span className="flecha" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>

      <section className="stack stack-3">
        <h2>Que incluye</h2>
        <ul className="rejilla-features">
          {FEATURES.map(([title, body]) => (
            <li key={title} className="feature">
              <span className="feature-titulo">{title}</span>
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

      {/* La Res. 424/2020 pide "acceso facil y directo desde la pagina de
          inicio", en "lugar destacado en cuanto a visibilidad y tamaño". Por eso
          va como boton y con el nombre exacto que usa la norma, y no como un
          enlace chico perdido entre los otros tres de abajo. Si alguna vez se
          rediseña la portada, esto no se puede achicar. */}
      <Link
        to="/arrepentimiento"
        className="btn"
        style={{ alignSelf: 'flex-start' }}
      >
        BOTÓN DE ARREPENTIMIENTO
      </Link>

      {/* Los textos legales se alcanzan desde la portada, que es donde los
          busca cualquiera —y donde la normativa de comercio electronico espera
          encontrarlos. Ver docs/legal/README.md. */}
      <footer
        className="row tiny muted"
        style={{ flexWrap: 'wrap', gap: 14, borderTop: '1px solid var(--border)', paddingTop: 20 }}
      >
        <Link to="/legal/privacidad" className="tiny muted">
          Politica de privacidad
        </Link>
        <Link to="/legal/terminos" className="tiny muted">
          Terminos del servicio
        </Link>
        <Link to="/legal/terminos-comensal" className="tiny muted">
          Terminos para el comensal
        </Link>
      </footer>
    </div>
  );
}
