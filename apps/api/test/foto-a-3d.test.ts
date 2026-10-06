/**
 * De la foto al modelo 3D.
 *
 * Hay una prueba aca que vale mas que las otras: **un plato no puede generar
 * dos modelos a la vez**. Cada modelo generado consume creditos de un proveedor
 * externo que se pagan con plata de verdad, y el boton esta en un celular, en
 * un restaurante, con una mano que cocina. Dos toques seguidos, una pestaña
 * duplicada o un reintento del navegador no pueden costar el doble. Por eso el
 * guard es un indice unico parcial en la base y no un `if` en el servicio: el
 * `if` pierde la carrera, el indice no.
 *
 * Las demas son las que impiden que esto ensucie la carta de un cliente:
 *
 *  - Lo que devuelve el proveedor **se valida antes de guardarse**. Un tercero
 *    que responde cualquier cosa no puede terminar colgado de una carta como
 *    si fuera un modelo.
 *  - Un fallo del proveedor deja el trabajo en FAILED **con el motivo escrito**
 *    y libera el plato. Un trabajo colgado bloquearia el plato para siempre.
 *  - El plato de otro restaurante no existe para esta sesion.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { setProveedor3D } from '../src/modules/modelado/index.js';
import type {
  EstadoRemoto,
  FotoDelPlato,
  ProveedorDe3D,
} from '../src/modules/modelado/proveedor.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';
import { prisma } from '../src/prisma.js';

const SUFFIX = Date.now();
const SLUG = `foto3d-${SUFFIX}`;
const EMAIL = `foto3d-${SUFFIX}@prueba.demo`;
const OTRO_SLUG = `foto3d-otro-${SUFFIX}`;
const OTRO_EMAIL = `foto3d-otro-${SUFFIX}@prueba.demo`;
const PASSWORD = 'foto-a-3d-2026';

/** Un JPEG de verdad: los tres bytes de firma y nada mas que haga falta. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

/** Un GLB minimo pero con la firma correcta. */
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60, 0)]);

/**
 * El proveedor simulado.
 *
 * Deja fijar que va a contestar, y cuenta cuantas veces le pidieron generar:
 * ese contador es lo que prueba que no se gasta dos veces.
 */
class ProveedorFalso implements ProveedorDe3D {
  readonly nombre = 'falso';
  creaciones = 0;
  siguiente: EstadoRemoto = { estado: 'READY', progreso: 100, glbUrl: 'https://falso/x.glb', creditos: 25 };
  glb: Buffer = GLB;
  fallaAlCrear: string | null = null;

  async crear(fotos: FotoDelPlato[]): Promise<string> {
    this.creaciones += 1;
    if (this.fallaAlCrear) throw new Error(this.fallaAlCrear);
    assert.ok(fotos[0]!.bytes.byteLength > 0, 'la foto llego vacia al proveedor');
    return `tarea-${this.creaciones}`;
  }

  async consultar(): Promise<EstadoRemoto> {
    return this.siguiente;
  }

  async bajar(): Promise<Buffer> {
    return this.glb;
  }

  async comprobar(): Promise<{ ok: boolean; detalle: string }> {
    return { ok: true, detalle: 'simulado' };
  }
}

let app: FastifyInstance;
let tenantId: string;
let otroTenantId: string;
let dishId: string;
let otroDishId: string;
let token: string;
let otroToken: string;
const proveedor = new ProveedorFalso();

/** Arma un cuerpo multipart a mano: es lo que manda el navegador. */
function multipart(campo: string, nombre: string, tipo: string, contenido: Buffer) {
  const boundary = '----men3dprueba';
  const cabecera = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${campo}"; filename="${nombre}"\r\n` +
      `Content-Type: ${tipo}\r\n\r\n`,
  );
  const cierre = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([cabecera, contenido, cierre]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function crearRestaurante(slug: string, email: string) {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { tier: 'PRO' } });
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: 'Foto a 3D',
      defaultLocale: 'es',
      currency: 'ARS',
      branding: { create: {} },
      subscription: { create: { planId: plan.id, status: 'ACTIVE' } },
      users: {
        create: {
          email,
          name: 'Dueño',
          role: 'OWNER',
          passwordHash: await bcrypt.hash(PASSWORD, 10),
        },
      },
      categories: { create: { name: 'Principales', position: 0 } },
    },
    include: { categories: true },
  });
  const dish = await prisma.dish.create({
    data: {
      tenantId: tenant.id,
      categoryId: tenant.categories[0]!.id,
      name: 'Plato de prueba',
      priceCents: 100000,
      position: 0,
    },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  return { tenantId: tenant.id, dishId: dish.id, token: login.json().token as string };
}

before(async () => {
  app = await buildApp();
  setProveedor3D(proveedor);

  ({ tenantId, dishId, token } = await crearRestaurante(SLUG, EMAIL));
  ({ tenantId: otroTenantId, dishId: otroDishId, token: otroToken } =
    await crearRestaurante(OTRO_SLUG, OTRO_EMAIL));
});

beforeEach(async () => {
  await prisma.modelJob.deleteMany({ where: { tenantId: { in: [tenantId, otroTenantId] } } });
  await prisma.dish.updateMany({
    where: { id: { in: [dishId, otroDishId] } },
    data: { modelGlbUrl: null, imageUrl: null },
  });
  proveedor.creaciones = 0;
  proveedor.fallaAlCrear = null;
  proveedor.glb = GLB;
  proveedor.siguiente = {
    estado: 'READY',
    progreso: 100,
    glbUrl: 'https://falso/x.glb',
    creditos: 25,
  };
});

after(async () => {
  setProveedor3D(null);
  await prisma.modelJob.deleteMany({ where: { tenantId: { in: [tenantId, otroTenantId] } } });
  await deleteTenantsBySlug([SLUG, OTRO_SLUG]);
  await app.close();
  await prisma.$disconnect();
});

function mandarFoto(conToken = token, plato = dishId, foto = JPEG, tipo = 'image/jpeg') {
  const { payload, headers } = multipart('foto', 'plato.jpg', tipo, foto);
  return app.inject({
    method: 'POST',
    url: `/api/admin/dishes/${plato}/modelo-desde-foto`,
    headers: { authorization: `Bearer ${conToken}`, ...headers },
    payload,
  });
}

describe('foto a 3D', () => {
  it('la foto arranca un trabajo y queda como imagen del plato', async () => {
    const respuesta = await mandarFoto();
    assert.equal(respuesta.statusCode, 202, respuesta.body);

    const trabajo = respuesta.json();
    assert.equal(trabajo.status, 'RUNNING');
    assert.ok(trabajo.photoUrl, 'la foto no quedo guardada');

    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishId } });
    assert.equal(dish.imageUrl, trabajo.photoUrl, 'la foto no quedo como imagen del plato');
  });

  /**
   * La prueba que justifica el indice unico parcial.
   *
   * Si esto falla, el restaurante paga dos veces por el mismo plato, y se entera
   * cuando le llega la factura del proveedor.
   */
  it('un plato no puede generar dos modelos a la vez', async () => {
    proveedor.siguiente = { estado: 'RUNNING', progreso: 10 };

    const primera = await mandarFoto();
    assert.equal(primera.statusCode, 202, primera.body);

    const segunda = await mandarFoto();
    assert.equal(segunda.statusCode, 409, `la segunda foto tendria que rebotar: ${segunda.body}`);
    assert.match(segunda.json().error.message, /creditos|generandose/i);

    assert.equal(
      proveedor.creaciones,
      1,
      `se le pidio ${proveedor.creaciones} veces al proveedor: se pago de mas`,
    );
  });

  it('cuando termina, el modelo queda colgado del plato', async () => {
    const creada = await mandarFoto();
    const jobId = creada.json().id as string;

    const consulta = await app.inject({
      method: 'GET',
      url: `/api/admin/model-jobs/${jobId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const trabajo = consulta.json();
    assert.equal(trabajo.status, 'READY', consulta.body);
    assert.ok(trabajo.glbUrl, 'no quedo la URL del modelo');

    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishId } });
    assert.equal(dish.modelGlbUrl, trabajo.glbUrl, 'el modelo no se colgo del plato');

    // Y la URL es nuestra, no la del proveedor: la suya caduca a los dias.
    assert.ok(
      !trabajo.glbUrl.startsWith('https://falso/'),
      'se guardo la URL del proveedor, que caduca',
    );

    const fila = await prisma.modelJob.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(fila.credits, 25, 'no quedo registrado lo que se gasto');
  });

  /**
   * Lo que devuelve un tercero se trata como lo que manda un cliente.
   */
  it('si el proveedor devuelve algo que no es un GLB, no se guarda', async () => {
    proveedor.glb = Buffer.from('<html>error 500</html>');

    const creada = await mandarFoto();
    const jobId = creada.json().id as string;
    const consulta = await app.inject({
      method: 'GET',
      url: `/api/admin/model-jobs/${jobId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(consulta.json().status, 'FAILED', consulta.body);
    assert.match(consulta.json().error, /GLB/i);

    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishId } });
    assert.equal(dish.modelGlbUrl, null, 'se colgo basura del plato');
  });

  it('un fallo del proveedor deja el motivo escrito y libera el plato', async () => {
    proveedor.fallaAlCrear = 'sin creditos en la cuenta';

    const primera = await mandarFoto();
    assert.equal(primera.statusCode, 202, primera.body);
    assert.equal(primera.json().status, 'FAILED');
    assert.match(primera.json().error, /sin creditos/);

    // Y se puede volver a intentar: el trabajo fallido no bloquea el plato.
    proveedor.fallaAlCrear = null;
    const segunda = await mandarFoto();
    assert.equal(segunda.statusCode, 202, `el plato quedo bloqueado: ${segunda.body}`);
    assert.equal(segunda.json().status, 'RUNNING');
  });

  it('una foto que no es una foto no se manda a ningun lado', async () => {
    const respuesta = await mandarFoto(token, dishId, Buffer.from('MZ ejecutable'), 'image/jpeg');
    assert.equal(respuesta.statusCode, 400, respuesta.body);
    assert.equal(proveedor.creaciones, 0, 'se le mando un archivo invalido al proveedor');
  });

  /**
   * El defecto que encontro la prueba de navegador, y que no era de esta
   * funcion sino de todas.
   *
   * Con `STORAGE_DRIVER=local` —el valor por defecto, el que usa cualquiera que
   * esta empezando— el servidor devuelve `/media/<nombre>`. El esquema exigia
   * una URL absoluta, asi que **el panel no podia guardar un plato despues de
   * subirle una foto o un modelo**: la subida andaba, el campo se llenaba, y
   * "Guardar" devolvia 422. Con `s3` no se notaba, porque ahi la URL es
   * absoluta.
   *
   * Y el limite tiene que seguir estando: esto termina en el `src` de una
   * imagen o de un `<model-viewer>` en la carta de un comensal.
   */
  it('el plato se puede guardar con la URL que devuelve el almacenamiento', async () => {
    const dish = await prisma.dish.findUniqueOrThrow({ where: { id: dishId } });
    const patch = (modelGlbUrl: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/admin/dishes/${dishId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          categoryId: dish.categoryId,
          name: dish.name,
          priceCents: dish.priceCents,
          modelGlbUrl,
        },
      });

    const relativa = await patch('/media/abc0123456789abcdef0123456789abc.glb');
    assert.equal(
      relativa.statusCode,
      200,
      `no se pudo guardar la URL del driver local: ${relativa.body}`,
    );

    const absoluta = await patch('https://cdn.ejemplo.com/x.glb');
    assert.equal(absoluta.statusCode, 200, absoluta.body);

    // Y lo que no puede pasar, por mas que parezca una ruta local.
    for (const veneno of ['//otro.com/x.glb', '/\\otro.com/x.glb', 'javascript:alert(1)']) {
      const r = await patch(veneno);
      assert.equal(r.statusCode, 422, `se acepto "${veneno}": ${r.body}`);
    }
  });

  it('el plato de otro restaurante no existe para esta sesion', async () => {
    const respuesta = await mandarFoto(token, otroDishId);
    assert.equal(respuesta.statusCode, 404, respuesta.body);

    const creada = await mandarFoto(otroToken, otroDishId);
    const ajeno = creada.json().id as string;
    const espiada = await app.inject({
      method: 'GET',
      url: `/api/admin/model-jobs/${ajeno}`,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(espiada.statusCode, 404, 'se pudo ver el trabajo de otro restaurante');
  });
});
