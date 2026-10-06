/**
 * Los textos legales: privacidad y terminos.
 *
 * El texto vive en apps/web/src/legal como Markdown, no aca. Asi un abogado
 * puede leerlo y marcarlo sin abrir un archivo de React, y cada cambio queda en
 * el historial del repositorio con su fecha y su motivo —que es justamente lo
 * que una politica de privacidad promete en la clausula de cambios.
 *
 * Mientras falten datos por completar, la pagina lo dice arriba y en pantalla.
 * No publica en silencio un documento con «FALTA: RAZON_SOCIAL» en el medio:
 * una politica a medio llenar es peor que ninguna, porque parece una.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { cantidadPendiente, completar, faltanCompletar } from '../../legal/empresa.js';
import privacidadMd from '../../legal/privacidad.md?raw';
import terminosComensalMd from '../../legal/terminos-comensal.md?raw';
import terminosMd from '../../legal/terminos.md?raw';
import { renderizarMarkdown } from '../../lib/markdown.js';

export type DocumentoLegal = 'privacidad' | 'terminos' | 'terminos-comensal';

const FUENTES: Record<DocumentoLegal, string> = {
  privacidad: privacidadMd,
  terminos: terminosMd,
  'terminos-comensal': terminosComensalMd,
};

const NAVEGACION: { id: DocumentoLegal; titulo: string }[] = [
  { id: 'privacidad', titulo: 'Privacidad' },
  { id: 'terminos', titulo: 'Términos del servicio' },
  { id: 'terminos-comensal', titulo: 'Términos para el comensal' },
];

/** Aviso de borrador: solo aparece mientras queden marcadores sin completar. */
function AvisoDeBorrador(): ReactNode {
  const faltan = faltanCompletar();
  const total = cantidadPendiente();
  if (total === 0) return null;

  const lineas: [string, string[]][] = [
    ['Los completa el dueño del producto', faltan.negocio],
    ['Los tiene que revisar un abogado', faltan.abogado],
    ['Salen del código', faltan.codigo],
  ];

  return (
    <aside
      className="card card-pad stack stack-2"
      style={{
        background: 'var(--warning-soft)',
        borderColor: 'var(--warning)',
      }}
      data-testid="aviso-borrador-legal"
    >
      <span className="bold">
        Borrador: faltan {total} datos por completar antes de publicar esto.
      </span>
      <p className="small secondary" style={{ margin: 0 }}>
        Donde falta un dato, el texto dice «FALTA: NOMBRE» en vez de inventarlo. Se
        completan en <code>apps/web/src/legal/empresa.ts</code>; qué poner en cada
        uno está en <code>docs/legal/README.md</code>.
      </p>
      {lineas.map(([titulo, claves]) =>
        claves.length === 0 ? null : (
          <span key={titulo} className="tiny muted">
            <span className="bold">{titulo}:</span> {claves.join(', ')}
          </span>
        ),
      )}
    </aside>
  );
}

export function LegalPage({ documento }: { documento: DocumentoLegal }): ReactNode {
  const texto = completar(FUENTES[documento]);

  return (
    <div className="container stack stack-5" style={{ padding: '32px 16px 56px' }}>
      <Link to="/" className="tiny muted">
        ← Men-3D
      </Link>

      <AvisoDeBorrador />

      <nav className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {NAVEGACION.map((item) =>
          item.id === documento ? (
            <span key={item.id} className="badge">
              {item.titulo}
            </span>
          ) : (
            <Link key={item.id} to={`/legal/${item.id}`} className="tiny">
              {item.titulo}
            </Link>
          ),
        )}
      </nav>

      <article className="legal-prose">{renderizarMarkdown(texto)}</article>
    </div>
  );
}
