/**
 * Los datos que los textos legales no pueden inventar.
 *
 * Los tres documentos de esta carpeta estan escritos con marcadores `{{ASI}}`
 * y se completan desde aca. Hay un solo lugar para cambiarlos, y mientras
 * queden sin completar la pagina legal lo muestra en pantalla en vez de
 * publicar un texto con agujeros: un "{{RAZON_SOCIAL}}" en una politica de
 * privacidad es peor que no tenerla, porque parece una.
 *
 * Tres categorias, y conviene no mezclarlas:
 *
 *  - **Del codigo**: ya estan completas, salen de como funciona el sistema. Si
 *    cambia el codigo, cambian aca.
 *  - **Del negocio**: las sabe el dueño del producto. Son datos (CUIT,
 *    domicilio) y decisiones (cuanto se conservan los registros).
 *  - **Del abogado**: parrafos enteros que fijan responsabilidad. No los
 *    escribe un programador y no los escribe un modelo de lenguaje: estan
 *    vacios a proposito y en docs/legal/README.md esta que hay que resolver en
 *    cada uno.
 */

/** Marcador sin completar. Se distingue de un valor vacio legitimo. */
export const PENDIENTE = '';

export interface DatoLegal {
  valor: string;
  /** Quien lo completa. Decide como se muestra lo que falta. */
  origen: 'codigo' | 'negocio' | 'abogado';
}

export const DATOS_LEGALES: Record<string, DatoLegal> = {
  // --- del codigo -----------------------------------------------------------
  /** `DIAS_DE_GRACIA` en apps/api/src/modules/billing/service.ts. */
  DIAS_GRACIA: { valor: '7', origen: 'codigo' },
  /** apps/api/src/modules/mail/resend.ts. */
  PROVEEDOR_CORREO: { valor: 'Resend', origen: 'codigo' },

  // --- del negocio ----------------------------------------------------------
  RAZON_SOCIAL: { valor: PENDIENTE, origen: 'negocio' },
  CUIT: { valor: PENDIENTE, origen: 'negocio' },
  DOMICILIO: { valor: PENDIENTE, origen: 'negocio' },
  EMAIL_PRIVACIDAD: { valor: PENDIENTE, origen: 'negocio' },
  EMAIL_LEGAL: { valor: PENDIENTE, origen: 'negocio' },
  FECHA_VIGENCIA: { valor: PENDIENTE, origen: 'negocio' },
  VERSION: { valor: PENDIENTE, origen: 'negocio' },
  /** El proveedor S3 que quede configurado en STORAGE_DRIVER=s3. */
  PROVEEDOR_ALMACENAMIENTO: { valor: PENDIENTE, origen: 'negocio' },
  /**
   * El generador de modelos 3D que quede en MODEL3D_PROVIDER.
   *
   * Queda vacio a proposito aunque el codigo traiga un adaptador: el valor por
   * defecto es no tener ninguno, y nombrar en una politica de privacidad a un
   * tercero que no recibe nada es tan falso como omitir a uno que si. Se
   * completa cuando se contrata.
   */
  PROVEEDOR_3D: { valor: PENDIENTE, origen: 'negocio' },
  /** Decisiones de conservacion. La de pedidos la condiciona la AFIP. */
  PLAZO_PEDIDOS: { valor: PENDIENTE, origen: 'negocio' },
  PLAZO_ANALITICA: { valor: PENDIENTE, origen: 'negocio' },
  PLAZO_CUENTA: { valor: PENDIENTE, origen: 'negocio' },
  PLAZO_LOGS: { valor: PENDIENTE, origen: 'negocio' },
  /** Pedidos del boton de arrepentimiento: comprobante de un derecho ejercido. */
  PLAZO_REVOCACIONES: { valor: PENDIENTE, origen: 'negocio' },
  PREAVISO_PRECIO: { valor: PENDIENTE, origen: 'negocio' },
  PREAVISO_TERMINOS: { valor: PENDIENTE, origen: 'negocio' },

  // --- del abogado ----------------------------------------------------------
  /** Art. 12 Ley 25.326: proveedores fuera del pais. */
  TRANSFERENCIAS_INTERNACIONALES: { valor: PENDIENTE, origen: 'abogado' },
  /** Si los precios publicados llevan IVA incluido o no. */
  IMPUESTOS: { valor: PENDIENTE, origen: 'abogado' },
  REEMBOLSOS: { valor: PENDIENTE, origen: 'abogado' },
  SLA: { valor: PENDIENTE, origen: 'abogado' },
  LIMITACION_RESPONSABILIDAD: { valor: PENDIENTE, origen: 'abogado' },
  JURISDICCION: { valor: PENDIENTE, origen: 'abogado' },
  /** Art. 40 Ley 24.240: responsabilidad solidaria en la cadena. */
  RESPONSABILIDAD_CADENA: { valor: PENDIENTE, origen: 'abogado' },
};

/** Los marcadores que todavia no tienen valor, agrupados por quien los completa. */
export function faltanCompletar(): Record<DatoLegal['origen'], string[]> {
  const faltan: Record<DatoLegal['origen'], string[]> = {
    codigo: [],
    negocio: [],
    abogado: [],
  };
  for (const [clave, dato] of Object.entries(DATOS_LEGALES)) {
    if (dato.valor === PENDIENTE) faltan[dato.origen].push(clave);
  }
  return faltan;
}

/** Cuantos marcadores faltan en total. Cero significa listo para publicar. */
export function cantidadPendiente(): number {
  const faltan = faltanCompletar();
  return faltan.codigo.length + faltan.negocio.length + faltan.abogado.length;
}

/**
 * Reemplaza los `{{MARCADORES}}` por su valor.
 *
 * Lo que falta NO se borra ni se deja como estaba: se marca con `«FALTA: X»`,
 * que es imposible de confundir con texto legal y facil de encontrar en
 * pantalla. Un marcador desconocido se deja igual, para que se note que
 * alguien escribio un nombre que no existe aca.
 */
export function completar(texto: string): string {
  return texto.replace(/\{\{([A-Z_]+)\}\}/g, (original, clave: string) => {
    const dato = DATOS_LEGALES[clave];
    if (!dato) return original;
    return dato.valor === PENDIENTE ? `«FALTA: ${clave}»` : dato.valor;
  });
}
