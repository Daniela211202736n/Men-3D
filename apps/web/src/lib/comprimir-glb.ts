/**
 * Compresion Draco del modelo 3D, en el navegador, antes de subirlo.
 *
 * **Por que en el navegador y no en el servidor.** Con `STORAGE_DRIVER=s3` el
 * archivo viaja directo del backoffice al bucket con una URL firmada: la API
 * nunca ve los bytes, y eso es a proposito —un modelo de 20 MB no puede ocupar
 * un proceso de la API durante toda la transferencia—. Comprimir del lado del
 * servidor obligaria a deshacer esa decision, o a bajarlo del bucket, cambiarlo
 * y volver a subirlo con un trabajo en segundo plano. En el navegador el
 * archivo ya esta en la mano.
 *
 * **Por que importa.** El GLB lo descarga el celular del comensal, muchas veces
 * con 4G, y cada plato que abre es una descarga. Draco comprime la malla: en
 * los modelos tipicos de un plato baja bastante, y es la diferencia entre un
 * visor que aparece y uno que se siente roto.
 *
 * **Nunca empeora.** Draco sobre una malla ya optimizada, o muy simple, puede
 * dar un archivo mas grande. Si pasa, se sube el original: la regla es que
 * comprimir no puede dejar al restaurante peor de lo que estaba.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco } from '@gltf-transform/functions';

export interface ResultadoCompresion {
  archivo: File;
  bytesAntes: number;
  bytesDespues: number;
  /** `false` si se devolvio el original: no comprimio, o quedo mas grande. */
  comprimido: boolean;
}

/** El codificador es WebAssembly y pesa: se carga recien cuando se usa. */
async function cargarIO(): Promise<NodeIO> {
  const { default: draco3d } = await import('draco3dgltf');
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule(),
      'draco3d.decoder': await draco3d.createDecoderModule(),
    });
}

export async function comprimirGlb(file: File): Promise<ResultadoCompresion> {
  const bytesAntes = file.size;
  const original: ResultadoCompresion = {
    archivo: file,
    bytesAntes,
    bytesDespues: bytesAntes,
    comprimido: false,
  };

  try {
    const io = await cargarIO();
    const documento: Document = await io.readBinary(
      new Uint8Array(await file.arrayBuffer()),
    );
    await documento.transform(draco());
    const salida = await io.writeBinary(documento);

    // Si no mejoro, se queda el original. Comprimir no puede empeorar.
    if (salida.byteLength >= bytesAntes) return original;

    return {
      archivo: new File([salida as BlobPart], file.name, {
        type: 'model/gltf-binary',
      }),
      bytesAntes,
      bytesDespues: salida.byteLength,
      comprimido: true,
    };
  } catch {
    // Un GLB que esta libreria no sabe leer no puede impedir que el
    // restaurante cargue su plato: se sube tal cual.
    return original;
  }
}
