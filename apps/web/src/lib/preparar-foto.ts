/**
 * Deja la foto del celular en condiciones de viajar.
 *
 * Una foto de un telefono actual son 3 a 8 MB y 4000 px de lado. Nada de eso
 * sirve: el generador de 3D reconstruye el plato desde una sola vista y a
 * partir de cierto detalle no mejora, pero la foto **viaja dos veces** —al
 * servidor y de ahi al proveedor, codificada en base64, que la agranda un
 * tercio—. Mandarla tal cual es pagar varios segundos de subida en el wifi de
 * un restaurante a cambio de nada.
 *
 * 1280 px en el lado largo y JPEG de calidad 0,86 deja un archivo de unos
 * 300 kB con el plato perfectamente legible.
 *
 * Tambien normaliza el tipo: un celular puede entregar HEIC, PNG o WEBP, y del
 * otro lado se aceptan JPG, PNG y WEBP. Pasa todo por JPEG y el problema
 * desaparece.
 *
 * Si algo falla —un formato que el navegador no sabe decodificar— devuelve el
 * archivo original: que la subida sea mas pesada es mejor que no poder subir.
 */
const LADO_MAXIMO = 1280;
const CALIDAD = 0.86;

export async function prepararFoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const contexto = lienzo.getContext('2d');
    if (!contexto) return file;
    contexto.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, 'image/jpeg', CALIDAD),
    );
    if (!blob) return file;

    return new File([blob], 'plato.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
