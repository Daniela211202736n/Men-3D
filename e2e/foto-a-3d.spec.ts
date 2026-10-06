/**
 * "Sacale una foto al plato", en un navegador de verdad.
 *
 * **Lo que solo se puede verificar aca.** Las pruebas de API confirman que el
 * trabajo termina y que el modelo queda escrito en el plato. Lo que no pueden
 * confirmar es que el **formulario abierto** se entere.
 *
 * Y ese olvido es el peor fallo posible de esta funcion, porque es invisible y
 * destructivo a la vez: la API escribe `modelGlbUrl` directo en la base, pero
 * el editor tiene en memoria el estado del plato de *antes*, con ese campo
 * vacio. Si el dueño toca "Guardar" despues de generar —que es exactamente lo
 * que va a hacer, porque acaba de cargar el plato—, el formulario pisa con
 * vacio el modelo recien generado. Las pruebas de API pasan, la pantalla dice
 * "listo", y el restaurante pierde el modelo que acaba de pagar.
 *
 * Asi que esta prueba hace el recorrido entero: saca la foto, espera el modelo,
 * **guarda el plato**, recarga desde cero y comprueba que el modelo sigue ahi.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

const DUENIO = { email: 'pepe@donpepe.demo', password: 'men3d-demo-2026' };

/** Un JPEG minimo y valido: lo que importa es la firma, no la imagen. */
const FOTO = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(256, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

async function tokenDelDuenio(request: APIRequestContext): Promise<string> {
  const r = await request.post('/api/auth/login', { data: DUENIO });
  expect(r.ok(), `el login del dueño fallo: ${r.status()}`).toBeTruthy();
  return (await r.json()).token as string;
}

test.describe('foto a 3D', () => {
  test('el modelo generado sobrevive a guardar el plato', async ({ page, request }) => {
    const token = await tokenDelDuenio(request);
    const auth = { authorization: `Bearer ${token}` };

    // Un plato propio y descartable: generar sobre uno de la demo le cambiaria
    // el modelo a las otras pruebas.
    const categorias = await request.get('/api/admin/categories', { headers: auth });
    const categoryId = (await categorias.json())[0].id as string;
    const creado = await request.post('/api/admin/dishes', {
      headers: auth,
      data: {
        categoryId,
        name: `Plato de prueba 3D ${Date.now()}`,
        priceCents: 100000,
        allergens: [],
        dietTags: [],
        ingredients: [],
      },
    });
    expect(creado.status(), await creado.text()).toBe(201);
    const dish = await creado.json();

    try {
      await page.goto('/admin');
      await page.getByLabel('Email').fill(DUENIO.email);
      await page.getByLabel('Contraseña').fill(DUENIO.password);
      await page.getByRole('button', { name: /Entrar/ }).click();
      // Esperar al panel antes de navegar: si no, el `goto` corre contra el
      // login y la pantalla que se abre es la de entrar, no la del plato.
      await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();

      await page.goto(`/admin/carta/${dish.id}`);
      await expect(
        page.getByRole('button', { name: 'Sacarle una foto al plato' }),
      ).toBeVisible();

      // La entrada esta oculta a proposito —en un celular la abre la camara—,
      // asi que el archivo se pone directamente sobre ella.
      await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'plato.jpg',
        mimeType: 'image/jpeg',
        buffer: FOTO,
      });

      // El proveedor simulado tarda unos segundos a proposito: asi se ejercita
      // el estado "en curso" y no solo el final feliz.
      await expect(page.getByText('Generando el modelo…')).toBeVisible();
      await expect(page.getByText(/el modelo quedo cargado en este plato/i)).toBeVisible({
        timeout: 60_000,
      });

      // --- la afirmacion que justifica toda la prueba ---
      //
      // Se espera la peticion de guardado en vez de la navegacion: lo que hay
      // que comprobar es que el PATCH **salio y trajo lo que el formulario
      // tenia**. Preguntarle a la API antes de eso devuelve lo que escribio la
      // generacion, y la prueba pasaria aunque el formulario lo hubiera pisado
      // —que es exactamente el fallo que esta prueba existe para encontrar—.
      const guardadoEnVuelo = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/admin/dishes/${dish.id}`) &&
          r.request().method() === 'PATCH',
        { timeout: 30_000 },
      );
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      const respuesta = await guardadoEnVuelo;
      expect(
        respuesta.ok(),
        `el guardado fallo: ${respuesta.status()} ${await respuesta.text()}`,
      ).toBeTruthy();

      const despues = await request.get(`/api/admin/dishes`, { headers: auth });
      const guardado = (await despues.json()).find(
        (d: { id: string }) => d.id === dish.id,
      ) as { modelGlbUrl: string | null };

      expect(
        guardado.modelGlbUrl,
        'guardar el plato borro el modelo que se acababa de generar',
      ).toBeTruthy();

      // Y el archivo existe de verdad donde dice: una URL guardada que no sirve
      // es un plato con el visor roto.
      const glb = await request.get(guardado.modelGlbUrl!);
      expect(glb.ok(), `el modelo no se puede descargar: ${glb.status()}`).toBeTruthy();
      const bytes = await glb.body();
      expect(bytes.subarray(0, 4).toString()).toBe('glTF');
    } finally {
      await request.delete(`/api/admin/dishes/${dish.id}`, { headers: auth });
    }
  });
});
