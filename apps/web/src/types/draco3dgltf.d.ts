/**
 * `draco3dgltf` no publica tipos.
 *
 * Se declara solo lo que usamos —los dos constructores de modulo— en lugar de
 * silenciar el error con `any`: si la libreria cambia de forma, el compilador
 * lo dice en vez de fallar en el navegador del restaurante.
 */
declare module 'draco3dgltf' {
  const draco3d: {
    createEncoderModule(): Promise<unknown>;
    createDecoderModule(): Promise<unknown>;
  };
  export default draco3d;
}
