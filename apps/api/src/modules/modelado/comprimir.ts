/**
 * Compresion Draco del GLB generado, en el servidor.
 *
 * **Por que aca y no en el navegador, como la subida a mano.** La subida a mano
 * se comprime en el navegador a proposito: con `STORAGE_DRIVER=s3` el archivo
 * viaja del backoffice directo al bucket y la API nunca ve los bytes, asi que
 * comprimir del lado del servidor obligaria a bajarlo y volver a subirlo. Aca
 * la situacion es la inversa: el GLB lo genera un tercero y **ya pasa por la
 * API**, que tiene que bajarlo igual para guardarlo antes de que caduque. Los
 * bytes estan en la mano; no comprimirlos seria dejar pasar la oportunidad.
 *
 * **Por que importa.** Lo que devuelve un generador de 3D no esta pensado para
 * un celular con 4G: viene con la malla sin comprimir. Cada plato que abre un
 * comensal es una descarga.
 *
 * **Nunca empeora.** Draco sobre una malla ya optimizada puede dar un archivo
 * mas grande; si pasa, se guarda el original. Y si la compresion falla —un GLB
 * con algo que la libreria no entiende— tambien: un modelo sin comprimir es
 * mucho mejor que ningun modelo.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';

export interface ResultadoCompresion {
  bytes: Buffer;
  bytesAntes: number;
  bytesDespues: number;
  comprimido: boolean;
}

/** El codificador es WebAssembly y pesa: se carga recien cuando se usa. */
async function cargarIO(): Promise<NodeIO> {
  const { default: draco3d } = await import('draco3dgltf');
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });
}

export async function comprimirGlb(original: Buffer): Promise<ResultadoCompresion> {
  const bytesAntes = original.byteLength;
  const sinTocar: ResultadoCompresion = {
    bytes: original,
    bytesAntes,
    bytesDespues: bytesAntes,
    comprimido: false,
  };

  try {
    const io = await cargarIO();
    const documento = await io.readBinary(new Uint8Array(original));
    await documento.transform(draco());
    const salida = Buffer.from(await io.writeBinary(documento));
    if (salida.byteLength >= bytesAntes) return sinTocar;
    return {
      bytes: salida,
      bytesAntes,
      bytesDespues: salida.byteLength,
      comprimido: true,
    };
  } catch {
    return sinTocar;
  }
}
