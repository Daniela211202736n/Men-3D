/**
 * Markdown, pero solo el que usan los textos legales.
 *
 * NO es un renderizador de Markdown de proposito general y no hay que usarlo
 * como tal. Entiende exactamente lo que escribimos en apps/web/src/legal:
 * titulos de tres niveles, parrafos, listas con viñeta, citas, separadores,
 * tablas simples y, dentro de la linea, negrita, cursiva, codigo y enlaces.
 *
 * Por que a mano y no una libreria: los textos los escribimos nosotros, no son
 * entrada de nadie, asi que el subconjunto es fijo y chico. Una libreria de
 * Markdown con tablas pesa decenas de kilobytes en una PWA que un comensal
 * abre con datos moviles, y este proyecto se tomo el trabajo de comprimir los
 * modelos 3D justamente por eso.
 *
 * Nunca genera HTML: construye elementos de React. No hay `innerHTML` por
 * ningun lado, asi que no hay por donde inyectar nada.
 */
import type { ReactNode } from 'react';

/** Negrita, cursiva, codigo y enlaces dentro de una linea. */
function enLinea(texto: string, claveBase: string): ReactNode[] {
  const partes: ReactNode[] = [];
  const patron = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let ultimo = 0;
  let n = 0;

  for (const encontrado of texto.matchAll(patron)) {
    const inicio = encontrado.index;
    if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
    const token = encontrado[0];
    const clave = `${claveBase}-${(n += 1)}`;

    if (token.startsWith('**')) {
      partes.push(<strong key={clave}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      partes.push(<code key={clave}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const corte = token.indexOf('](');
      const texto2 = token.slice(1, corte);
      const url = token.slice(corte + 2, -1);
      partes.push(
        <a key={clave} href={url}>
          {texto2}
        </a>,
      );
    } else {
      partes.push(<em key={clave}>{token.slice(1, -1)}</em>);
    }
    ultimo = inicio + token.length;
  }

  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}

/** Parte una fila de tabla `| a | b |` en sus celdas. */
function celdas(linea: string): string[] {
  return linea
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

const esSeparadorDeTabla = (linea: string): boolean => /^\|[\s|:-]+\|$/.test(linea.trim());

/**
 * Convierte el texto en elementos de React.
 *
 * Recorre las lineas una vez y va cerrando el bloque abierto cuando cambia el
 * tipo de linea. No construye un arbol intermedio: para este subconjunto no
 * hace falta y se lee mejor.
 */
export function renderizarMarkdown(fuente: string): ReactNode[] {
  const lineas = fuente.replace(/\r\n/g, '\n').split('\n');
  const bloques: ReactNode[] = [];

  let parrafo: string[] = [];
  let lista: string[] = [];
  let cita: string[] = [];
  let n = 0;
  const clave = (): string => `b${(n += 1)}`;

  const cerrarParrafo = (): void => {
    if (parrafo.length === 0) return;
    const k = clave();
    bloques.push(<p key={k}>{enLinea(parrafo.join(' '), k)}</p>);
    parrafo = [];
  };

  const cerrarLista = (): void => {
    if (lista.length === 0) return;
    const k = clave();
    bloques.push(
      <ul key={k}>
        {lista.map((item, i) => (
          // eslint-disable-next-line react/no-array-index-key -- texto fijo
          <li key={`${k}-${i}`}>{enLinea(item, `${k}-${i}`)}</li>
        ))}
      </ul>,
    );
    lista = [];
  };

  const cerrarCita = (): void => {
    if (cita.length === 0) return;
    const k = clave();
    bloques.push(<blockquote key={k}>{enLinea(cita.join(' '), k)}</blockquote>);
    cita = [];
  };

  const cerrarTodo = (): void => {
    cerrarParrafo();
    cerrarLista();
    cerrarCita();
  };

  for (let i = 0; i < lineas.length; i += 1) {
    const linea = lineas[i]!;
    const limpia = linea.trim();

    if (limpia === '') {
      cerrarTodo();
      continue;
    }

    // Tabla: encabezado, separador y filas. Sin separador no es tabla.
    if (limpia.startsWith('|') && esSeparadorDeTabla(lineas[i + 1] ?? '')) {
      cerrarTodo();
      const encabezado = celdas(limpia);
      const filas: string[][] = [];
      i += 2;
      while (i < lineas.length && lineas[i]!.trim().startsWith('|')) {
        filas.push(celdas(lineas[i]!));
        i += 1;
      }
      i -= 1;
      const k = clave();
      bloques.push(
        <table key={k}>
          <thead>
            <tr>
              {encabezado.map((c, j) => (
                <th key={`${k}-h${j}`}>{enLinea(c, `${k}-h${j}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, f) => (
              <tr key={`${k}-f${f}`}>
                {fila.map((c, j) => (
                  <td key={`${k}-f${f}-${j}`}>{enLinea(c, `${k}-f${f}-${j}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    if (limpia === '---') {
      cerrarTodo();
      bloques.push(<hr key={clave()} />);
      continue;
    }

    const titulo = /^(#{1,3})\s+(.*)$/.exec(limpia);
    if (titulo) {
      cerrarTodo();
      const nivel = titulo[1]!.length;
      const contenido = titulo[2]!;
      const k = clave();
      const Etiqueta = (['h1', 'h2', 'h3'] as const)[nivel - 1]!;
      bloques.push(<Etiqueta key={k}>{enLinea(contenido, k)}</Etiqueta>);
      continue;
    }

    if (limpia.startsWith('> ')) {
      cerrarParrafo();
      cerrarLista();
      cita.push(limpia.slice(2));
      continue;
    }

    if (limpia.startsWith('- ')) {
      cerrarParrafo();
      cerrarCita();
      lista.push(limpia.slice(2));
      continue;
    }

    // Continuacion de un item de lista: la linea de abajo, indentada.
    if (lista.length > 0 && linea.startsWith('  ')) {
      lista[lista.length - 1] = `${lista[lista.length - 1]!} ${limpia}`;
      continue;
    }

    cerrarCita();
    parrafo.push(limpia);
  }

  cerrarTodo();
  return bloques;
}
