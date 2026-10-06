/**
 * Pruebas A/B de carta, en un navegador de verdad.
 *
 * **Lo que solo se puede verificar acá.** Las pruebas de API confirman que, con
 * un `guestId`, la carta y el pedido resuelven la misma variante. Lo que no
 * pueden confirmar es que **el cliente mande ese guestId al pedir la carta**.
 *
 * Y ese olvido es el peor fallo posible de esta funcion, porque es invisible: si
 * la PWA no lo manda al leer la carta pero si al confirmar el pedido —que es lo
 * que hace, para los puntos de fidelidad— entonces el comensal ve el precio de
 * control y se le cobra el de la variante. Las 243 pruebas de API pasan, la
 * pantalla se ve bien, y el restaurante le cobra de mas a un cliente.
 *
 * Asi que esta prueba lee el `guestId` que el navegador se genero, le pregunta
 * a la API que precio le corresponde a ESE dispositivo, hace el pedido por la
 * interfaz como un comensal, y compara con lo que quedo cobrado.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const SLUG = 'la-parrilla-de-don-pepe';
const PLATO = 'Milanesa napolitana con papas';
const DUENIO = { email: 'pepe@donpepe.demo', password: 'men3d-demo-2026' };
/** Un precio inconfundible para la variante B: $9.999. */
const PRECIO_B = 999900;

/** Donde la PWA guarda el identificador del dispositivo. */
const GUEST_KEY = 'men3d.guestId';

/**
 * Busca un dispositivo al que la prueba le sirva la variante pedida.
 *
 * Le pregunta a la API en vez de replicar la funcion de hash: el servidor
 * informa en `experiments` que variante sirvio, asi que es su propia respuesta
 * la que decide. Si mañana cambia la forma de asignar, esta prueba sigue
 * funcionando sin tocarla.
 *
 * Esto es lo que vuelve determinista la prueba: sin forzar la variante, la
 * mitad de las corridas no ejercitaria el camino nuevo y pasaria igual.
 */
async function guestIdEnVariante(
  request: APIRequestContext,
  dishId: string,
  buscada: 'A' | 'B',
): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const candidato = `g-e2e${Date.now()}${i.toString().padStart(4, '0')}`;
    const r = await request.get(`/api/public/${SLUG}/menu`, {
      params: { guestId: candidato },
    });
    const dto = (await r.json()) as { experiments: Record<string, string> };
    if (dto.experiments[dishId] === buscada) return candidato;
  }
  throw new Error(`no encontre un dispositivo en la variante ${buscada}`);
}

async function tokenDelDuenio(request: APIRequestContext): Promise<string> {
  const r = await request.post('/api/auth/login', { data: DUENIO });
  expect(r.ok(), `el login del dueño fallo: ${r.status()}`).toBeTruthy();
  return (await r.json()).token as string;
}

/** El id del plato de la demo, por su nombre. */
async function idDelPlato(request: APIRequestContext): Promise<string> {
  const r = await request.get(`/api/public/${SLUG}/menu`);
  const menu = (await r.json()) as { dishes: { id: string; name: string }[] };
  const plato = menu.dishes.find((d) => d.name === PLATO);
  expect(plato, `no encontre "${PLATO}" en la carta de la demo`).toBeTruthy();
  return plato!.id;
}

test.describe('pruebas A/B', () => {
  test('el comensal paga el precio que la pantalla le mostro', async ({
    page,
    request,
  }) => {
    const token = await tokenDelDuenio(request);
    const auth = { authorization: `Bearer ${token}` };
    const dishId = await idDelPlato(request);

    // --- se arranca una prueba de precio sobre ese plato ---
    const creada = await request.post('/api/admin/experiments', {
      headers: auth,
      data: { dishId, field: 'PRICE', valueB: String(PRECIO_B) },
    });
    expect(creada.status(), await creada.text()).toBe(201);
    const experimentId = (await creada.json()).id as string;

    try {
      // --- el comensal entra con un dispositivo que cae en la variante B ---
      const guestId = await guestIdEnVariante(request, dishId, 'B');
      await page.addInitScript(
        ([clave, valor]) => window.localStorage.setItem(clave!, valor!),
        [GUEST_KEY, guestId],
      );

      await page.goto(`/m/${SLUG}`);
      await expect(page.getByRole('heading', { name: 'Entradas' })).toBeVisible();

      // --- que precio le corresponde a ESE dispositivo, segun la API ---
      const suCarta = await request.get(`/api/public/${SLUG}/menu`, {
        params: { guestId },
      });
      const dto = (await suCarta.json()) as {
        dishes: { id: string; priceCents: number }[];
        experiments: Record<string, string>;
      };
      const precioQueLeToca = dto.dishes.find((d) => d.id === dishId)!.priceCents;
      expect(dto.experiments[dishId], 'la carta no sirvio la variante B').toBe('B');
      expect(precioQueLeToca, 'B tendria que valer el precio alternativo').toBe(PRECIO_B);

      // Y la pantalla tiene que estar mostrando ESE precio, no el de control.
      // Se busca el numero y no "$ 9.999": el formateador de es-AR mete un
      // espacio duro entre el signo y la cifra, y eso no se ve al leer el test.
      await expect(page.getByText(/9\.999/).first()).toBeVisible();

      // --- y pide por la interfaz, como un comensal ---
      await page.getByRole('button', { name: new RegExp(PLATO, 'i') }).first().click();
      await expect(page.getByRole('button', { name: 'Agregar al pedido' })).toBeVisible();
      await page.getByRole('button', { name: 'Agregar al pedido' }).click();
      await page.getByRole('link', { name: /Pedido · 1/ }).click();
      await page.getByRole('button', { name: 'Pagar y enviar a cocina' }).click();
      await page.waitForURL(/\/pedido\//, { timeout: 30_000 });

      const codigo = page.url().split('/pedido/')[1]!.split('?')[0]!;
      const pedido = await request.get(`/api/public/${SLUG}/orders/${codigo}`, {
        params: { guestId },
      });
      const { items } = (await pedido.json()) as {
        items: { dishId: string; unitPriceCents: number }[];
      };
      const linea = items.find((i) => i.dishId === dishId);
      expect(linea, 'el pedido no tiene la linea del plato').toBeTruthy();

      // La afirmacion que justifica toda la prueba.
      expect(
        linea!.unitPriceCents,
        `vio ${precioQueLeToca} (variante B) y se le cobro ${linea!.unitPriceCents}`,
      ).toBe(precioQueLeToca);
    } finally {
      await request.post(`/api/admin/experiments/${experimentId}/stop`, {
        headers: auth,
        data: {},
      });
    }
  });

  test('el panel no deja decidir con ruido', async ({ page, request }) => {
    const token = await tokenDelDuenio(request);
    const dishId = await idDelPlato(request);
    const creada = await request.post('/api/admin/experiments', {
      headers: { authorization: `Bearer ${token}` },
      data: { dishId, field: 'DESCRIPTION', valueB: 'Otra descripcion para probar' },
    });
    expect(creada.status(), await creada.text()).toBe(201);
    const experimentId = (await creada.json()).id as string;

    try {
      await page.goto('/admin');
      await page.getByLabel('Email').fill(DUENIO.email);
      await page.getByLabel('Contraseña').fill(DUENIO.password);
      await page.getByRole('button', { name: /Entrar/ }).click();

      await page.getByRole('link', { name: 'Pruebas A/B' }).click();
      await expect(page.getByRole('heading', { name: 'Pruebas A/B de carta' })).toBeVisible();

      // Recien creada: sin datos. El veredicto tiene que decirlo y NO tiene que
      // haber un boton para adoptar nada.
      await expect(page.getByTestId('veredicto-sin-datos').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Adoptar B y cerrar' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Cerrar sin decidir' }).first()).toBeVisible();
    } finally {
      await request.post(`/api/admin/experiments/${experimentId}/stop`, {
        headers: { authorization: `Bearer ${token}` },
        data: {},
      });
    }
  });
});
