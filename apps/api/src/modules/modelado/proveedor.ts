/**
 * De una foto a un modelo 3D, detras de una interfaz.
 *
 * **Por que no lo hacemos nosotros.** Reconstruir una malla texturada desde una
 * sola foto es un modelo de red neuronal corriendo en una GPU. No es una
 * libreria de npm ni entra en el servidor que aloja esta API: es un servicio
 * que se contrata, se paga por uso y tarda minutos. Lo que si es nuestro es
 * todo lo que lo rodea —validar la foto, no gastar dos veces, bajar el
 * resultado antes de que caduque, comprimirlo y atarlo al plato—, y eso es
 * exactamente lo que queda de este lado de la interfaz.
 *
 * **Por que una interfaz y no una llamada suelta.** Este mercado se mueve: hoy
 * hay media docena de proveedores y el que mejor resuelve un plato de comida en
 * seis meses puede ser otro. Cambiarlo tiene que ser escribir un archivo nuevo
 * al lado de `meshy.ts`, no tocar el servicio ni el panel.
 */

/** La foto que saco el restaurante, ya validada. */
export interface FotoDelPlato {
  bytes: Buffer;
  /** `image/jpeg`, `image/png` o `image/webp`. */
  contentType: string;
}

/** Lo que el proveedor dice de un trabajo cuando se le pregunta. */
export interface EstadoRemoto {
  estado: 'RUNNING' | 'READY' | 'FAILED';
  /** 0 a 100. */
  progreso: number;
  /** Solo con `READY`: de donde bajar el GLB. */
  glbUrl?: string;
  /** Lo que informa haber cobrado. Se guarda para poder discutir una factura. */
  creditos?: number;
  /** Solo con `FAILED`: el motivo, para mostrarselo al dueño del local. */
  error?: string;
}

export interface ProveedorDe3D {
  readonly nombre: string;

  /**
   * Manda la foto y devuelve el identificador del trabajo del proveedor.
   *
   * Recibe una lista porque varias vistas del mismo plato dan un modelo mucho
   * mejor que una sola, y es a donde esto va. El adaptador decide que hace con
   * las que no sabe usar.
   */
  crear(fotos: FotoDelPlato[]): Promise<string>;

  consultar(taskId: string): Promise<EstadoRemoto>;

  /** Baja el GLB terminado. Lo hace el adaptador porque la URL es suya. */
  bajar(url: string): Promise<Buffer>;

  /**
   * Comprueba que la credencial sirva, sin generar nada.
   *
   * Lo usa `verificar-credenciales`: una clave que no anda tiene que aparecer
   * en la puesta en marcha, no la primera vez que un restaurante saca una foto.
   */
  comprobar(): Promise<{ ok: boolean; detalle: string }>;
}

/**
 * El proveedor apagado.
 *
 * `MODEL3D_PROVIDER=none` es el valor por defecto, y es el estado correcto para
 * quien todavia no contrato nada: la funcion aparece desactivada y explicada,
 * en vez de fallar con un error de red cuando alguien la toca. Subir un GLB a
 * mano sigue funcionando igual, que es el camino gratis.
 */
export class SinProveedor implements ProveedorDe3D {
  readonly nombre = 'none';

  private no(): never {
    throw new Error(
      'La generacion de modelos 3D desde una foto no esta configurada. ' +
        'Hace falta MODEL3D_PROVIDER y la clave del proveedor (ver docs/DEPLOY.md). ' +
        'Mientras tanto se puede subir el GLB a mano desde el editor del plato.',
    );
  }

  crear(): Promise<string> {
    return this.no();
  }

  consultar(): Promise<EstadoRemoto> {
    return this.no();
  }

  bajar(): Promise<Buffer> {
    return this.no();
  }

  async comprobar(): Promise<{ ok: boolean; detalle: string }> {
    return {
      ok: false,
      detalle:
        'Sin proveedor de 3D (MODEL3D_PROVIDER=none). Los platos se pueden ' +
        'cargar con un GLB hecho aparte; la foto no se convierte sola.',
    };
  }
}
