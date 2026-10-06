/**
 * `draco3dgltf` no publica tipos.
 *
 * Se declara solo lo que usamos —los dos constructores de modulo— en lugar de
 * silenciar el error con `any`: si la libreria cambia de forma, el compilador
 * lo dice en vez de fallar al generar el modelo de un restaurante.
 *
 * Hay una copia de esto en la PWA. No se comparte a proposito: son dos
 * compilaciones con `types` distintos y un `.d.ts` suelto en un paquete no se
 * ve desde el otro. Si alguna vez cambia, hay que cambiar las dos —y el
 * compilador de cada lado avisa—.
 */
declare module 'draco3dgltf' {
  const draco3d: {
    createEncoderModule(): Promise<unknown>;
    createDecoderModule(): Promise<unknown>;
  };
  export default draco3d;
}
