/**
 * Botón de arrepentimiento (Res. 424/2020 SCI).
 *
 * La resolución es específica sobre esta pantalla, y conviene tener presente
 * cada exigencia al tocarla:
 *
 *  - **Nada de registro ni de "cualquier otro trámite".** No hay login, no hay
 *    que buscar un número de factura, y los únicos campos obligatorios son el
 *    nombre y el correo —el correo porque es por donde se le informa el código.
 *    Si alguna vez alguien agrega un campo obligatorio más, hay que preguntarse
 *    si no es el trámite que la norma prohíbe pedir.
 *  - **Informarle el código dentro de las 24 horas, por el mismo medio.** Se le
 *    muestra acá en el acto, grande y copiable, y además se le manda por correo.
 *
 * El tono es deliberado: alguien que se arrepiente no tiene que sentir que está
 * peleando con un formulario. Nada de "¿estás seguro?", nada de ofrecerle un
 * descuento para que se quede, nada de pedirle el motivo como obligatorio.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, publicApi } from '../../lib/api.js';

interface Resultado {
  code: string;
  createdAt: string;
  mensaje: string;
}

export function RevocationPage(): ReactNode {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const enviar = async (evento: React.FormEvent<HTMLFormElement>): Promise<void> => {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const texto = (clave: string): string | undefined => {
      const valor = String(datos.get(clave) ?? '').trim();
      return valor === '' ? undefined : valor;
    };

    setEnviando(true);
    setError(null);
    try {
      setResultado(
        await publicApi.revocacion({
          name: String(datos.get('name') ?? '').trim(),
          email: String(datos.get('email') ?? '').trim(),
          phone: texto('phone'),
          reference: texto('reference'),
          detail: texto('detail'),
        }),
      );
    } catch (capturado) {
      setError(
        capturado instanceof ApiError
          ? capturado.message
          : 'No pudimos registrar el pedido. Probá de nuevo en un momento.',
      );
    } finally {
      setEnviando(false);
    }
  };

  if (resultado) {
    return (
      <div className="container stack stack-4" style={{ padding: '40px 16px 56px' }}>
        <h1 style={{ fontSize: '1.5rem' }}>Pedido registrado</h1>

        <div className="card card-pad stack stack-3" data-testid="codigo-de-revocacion">
          <span className="tiny muted">Tu código de identificación</span>
          <strong style={{ fontSize: '1.6rem', letterSpacing: '0.04em' }}>
            {resultado.code}
          </strong>
          <span className="tiny muted">
            Registrado el {new Date(resultado.createdAt).toLocaleString('es-AR')}
          </span>
        </div>

        <p className="small secondary">{resultado.mensaje}</p>

        <Link to="/" className="tiny muted">
          ← Volver
        </Link>
      </div>
    );
  }

  return (
    <div className="container stack stack-4" style={{ padding: '40px 16px 56px' }}>
      <h1 style={{ fontSize: '1.5rem' }}>Botón de arrepentimiento</h1>

      <p className="small secondary">
        Si contrataste Men-3D y querés dar marcha atrás, completá esto y listo. No
        hace falta registrarse ni buscar ningún número: con tu nombre y tu correo
        alcanza.
      </p>

      <p className="small secondary">
        Te devolvemos un código de identificación en el momento, y también te lo
        mandamos por correo. Ese código es tu comprobante, con la fecha.
      </p>

      <form className="stack stack-3" onSubmit={(e) => void enviar(e)}>
        <label className="stack stack-2">
          <span className="small bold">Tu nombre</span>
          <input name="name" required minLength={2} maxLength={120} autoComplete="name" />
        </label>

        <label className="stack stack-2">
          <span className="small bold">Tu correo</span>
          <input name="email" type="email" required autoComplete="email" />
          <span className="tiny muted">Ahí te llega el código.</span>
        </label>

        <label className="stack stack-2">
          <span className="small bold">
            Teléfono <span className="muted">(opcional)</span>
          </span>
          <input name="phone" maxLength={40} autoComplete="tel" />
        </label>

        <label className="stack stack-2">
          <span className="small bold">
            Algo que identifique la contratación <span className="muted">(opcional)</span>
          </span>
          <input name="reference" maxLength={200} />
          <span className="tiny muted">
            El correo con el que abriste la cuenta, un CUIT, un número de operación.
            Si no lo tenés a mano, dejalo vacío: lo buscamos nosotros.
          </span>
        </label>

        <label className="stack stack-2">
          <span className="small bold">
            Querés contarnos algo <span className="muted">(opcional)</span>
          </span>
          <textarea name="detail" rows={3} maxLength={2000} />
        </label>

        {error && <p className="small" style={{ color: 'var(--critical)' }}>{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Registrando…' : 'Registrar mi arrepentimiento'}
        </button>
      </form>

      <p className="tiny muted">
        Esto deja registrado tu pedido de revocación. La baja del servicio y, si
        corresponde, el reintegro, los procesamos por el mismo medio de pago.
      </p>

      <Link to="/legal/terminos" className="tiny muted">
        Términos del servicio
      </Link>
    </div>
  );
}
