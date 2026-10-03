/**
 * Pruebas del almacenamiento de modelos 3D e imagenes.
 *
 * El driver `s3` se ejercita contra un doble minimo que habla HTTP como un
 * bucket: alcanza para comprobar *nuestro* cableado —que la URL firmada apunte
 * al objeto correcto, que el PUT lo deposite, que la URL publica sea la del
 * CDN—, que es lo que podemos romper nosotros. La correccion de la firma de
 * AWS la garantiza su SDK, y la integracion real solo la prueba un bucket real.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { ASSET_KEY, LocalStorage, S3Storage } from '../src/modules/storage/index.js';
import type { S3StorageConfig } from '../src/modules/storage/s3.js';

/* ------------------------------------------------- doble de bucket S3 */

interface StoredObject {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

const objetos = new Map<string, StoredObject>();
let server: Server;
let puerto = 0;

before(async () => {
  server = createServer((req, res) => {
    // Con `forcePathStyle` la ruta es /<bucket>/<key>.
    const url = new URL(req.url ?? '/', 'http://localhost');
    const partes = url.pathname.split('/').filter(Boolean);
    const key = partes.slice(1).join('/');

    if (req.method === 'PUT') {
      const trozos: Buffer[] = [];
      req.on('data', (t: Buffer) => trozos.push(t));
      req.on('end', () => {
        objetos.set(key, {
          body: Buffer.concat(trozos),
          contentType: String(req.headers['content-type'] ?? ''),
          cacheControl: String(req.headers['cache-control'] ?? ''),
        });
        res.writeHead(200).end();
      });
      return;
    }

    if (req.method === 'GET') {
      const objeto = objetos.get(key);
      if (!objeto) return void res.writeHead(404).end();
      res
        .writeHead(200, {
          'content-type': objeto.contentType,
          'content-length': objeto.body.byteLength,
        })
        .end(objeto.body);
      return;
    }

    if (req.method === 'DELETE') {
      objetos.delete(key);
      return void res.writeHead(204).end();
    }

    res.writeHead(405).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      puerto = (server.address() as { port: number }).port;
      resolve();
    });
  });

});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Driver apuntado al bucket de prueba. */
function nuevoS3(extra: Partial<S3StorageConfig> = {}): S3Storage {
  return new S3Storage({
    bucket: 'men3d-test',
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${puerto}`,
    accessKeyId: 'llave-de-prueba',
    secretAccessKey: 'secreto-de-prueba',
    forcePathStyle: true,
    cdnPublicUrl: undefined,
    ...extra,
  });
}

/* ------------------------------------------------------------- pruebas */

describe('nombres de asset', () => {
  it('acepta solo los que genera el servidor', () => {
    assert.ok(ASSET_KEY.test('0123456789abcdef0123456789abcdef.glb'));
    assert.ok(ASSET_KEY.test('0123456789abcdef0123456789abcdef.png'));
  });

  it('rechaza cualquier intento de salir del almacenamiento', () => {
    for (const malo of [
      '../../../etc/passwd',
      '..%2F..%2Fetc%2Fpasswd',
      'archivo.glb',
      '0123456789abcdef0123456789abcdef.exe',
      '0123456789abcdef0123456789abcde.glb', // 31 caracteres
      '/0123456789abcdef0123456789abcdef.glb',
      '0123456789ABCDEF0123456789abcdef.glb', // mayusculas
    ]) {
      assert.equal(ASSET_KEY.test(malo), false, `deberia rechazar: ${malo}`);
    }
  });
});

describe('driver local', () => {
  const storage = new LocalStorage();

  it('emite un permiso de subida directo a la API', async () => {
    const ticket = await storage.createUploadTicket({
      extension: 'glb',
      contentType: 'model/gltf-binary',
    });
    assert.equal(ticket.kind, 'direct');
    assert.equal(ticket.uploadUrl, '/upload');
    assert.ok(ASSET_KEY.test(ticket.key));
    assert.equal(ticket.publicUrl, `/media/${ticket.key}`);
  });

  it('guarda, lee y borra', async () => {
    const ticket = await storage.createUploadTicket({
      extension: 'glb',
      contentType: 'model/gltf-binary',
    });
    const contenido = Buffer.from('glTF-contenido-de-prueba');
    await storage.save(ticket.key, contenido, 'model/gltf-binary');

    const leido = await storage.read(ticket.key);
    assert.ok(leido, 'el objeto se lee');
    assert.equal(leido.contentType, 'model/gltf-binary');

    await storage.remove(ticket.key);
    assert.equal(await storage.read(ticket.key), null);
  });

  it('no lee un nombre fuera de formato', async () => {
    assert.equal(await storage.read('../../../etc/passwd'), null);
  });

  it('se niega a guardar con un nombre inventado', async () => {
    await assert.rejects(
      () => storage.save('../fuera.glb', Buffer.from('x'), 'model/gltf-binary'),
      /invalido/,
    );
  });
});

describe('driver s3', () => {
  it('firma una URL que apunta al bucket y al objeto', async () => {
    const storage = nuevoS3();
    const ticket = await storage.createUploadTicket({
      extension: 'glb',
      contentType: 'model/gltf-binary',
    });

    assert.equal(ticket.kind, 'presigned');
    assert.ok(ASSET_KEY.test(ticket.key));
    const url = new URL(ticket.uploadUrl);
    assert.equal(url.pathname, `/men3d-test/${ticket.key}`);
    // Debe venir firmada, no ser una URL cualquiera.
    assert.ok(url.searchParams.get('X-Amz-Signature'), 'la URL lleva firma');
    assert.ok(url.searchParams.get('X-Amz-Expires'), 'la URL expira');
  });

  it('el PUT a la URL firmada deposita el objeto en el bucket', async () => {
    const storage = nuevoS3();
    const ticket = await storage.createUploadTicket({
      extension: 'glb',
      contentType: 'model/gltf-binary',
    });

    const contenido = Buffer.from('glTF-subido-con-url-firmada');
    const respuesta = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: contenido,
    });

    assert.equal(respuesta.status, 200);
    const guardado = objetos.get(ticket.key);
    assert.ok(guardado, 'el objeto llego al bucket');
    assert.equal(guardado.body.toString(), contenido.toString());
    assert.equal(guardado.contentType, 'model/gltf-binary');
    // Un año de cache: el nombre es un hash y nunca se reutiliza.
    assert.match(guardado.cacheControl, /immutable/);
  });

  it('guarda y lee por el camino directo', async () => {
    const storage = nuevoS3();
    const ticket = await storage.createUploadTicket({
      extension: 'png',
      contentType: 'image/png',
    });
    await storage.save(ticket.key, Buffer.from('png-de-prueba'), 'image/png');

    const leido = await storage.read(ticket.key);
    assert.ok(leido, 'el objeto se lee de vuelta');
    assert.equal(leido.contentType, 'image/png');
  });

  it('borra un objeto', async () => {
    const storage = nuevoS3();
    const ticket = await storage.createUploadTicket({
      extension: 'png',
      contentType: 'image/png',
    });
    await storage.save(ticket.key, Buffer.from('x'), 'image/png');
    await storage.remove(ticket.key);
    assert.equal(objetos.has(ticket.key), false);
  });

  it('un objeto inexistente devuelve null y no lanza', async () => {
    const storage = nuevoS3();
    assert.equal(
      await storage.read('ffffffffffffffffffffffffffffffff.glb'),
      null,
    );
  });

  it('la URL publica usa el CDN cuando esta configurado', async () => {
    const storage = nuevoS3({ cdnPublicUrl: 'https://cdn.men3d.app' });
    const url = storage.publicUrlFor('0123456789abcdef0123456789abcdef.glb');
    assert.equal(url, 'https://cdn.men3d.app/0123456789abcdef0123456789abcdef.glb');
  });

  it('tolera una barra final en la URL del CDN', async () => {
    const storage = nuevoS3({ cdnPublicUrl: 'https://cdn.men3d.app/' });
    assert.equal(
      storage.publicUrlFor('0123456789abcdef0123456789abcdef.glb'),
      'https://cdn.men3d.app/0123456789abcdef0123456789abcdef.glb',
    );
  });

  it('sin CDN cae a la URL del bucket', async () => {
    const storage = nuevoS3({ cdnPublicUrl: undefined });
    const url = storage.publicUrlFor('0123456789abcdef0123456789abcdef.glb');
    assert.match(url, /men3d-test\/0123456789abcdef0123456789abcdef\.glb$/);
  });
});
