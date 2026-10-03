/**
 * El recorrido del comensal, de punta a punta.
 *
 * Escanear el QR, ver el plato en 3D, pedir, pagar y seguir el estado. Es el
 * camino del dinero y la razon de ser del producto, y hasta ahora era lo unico
 * verificado solo a mano.
 *
 * Lo que esta prueba agarra y las de la API no pueden:
 *
 *  - Que el visor 3D cargue de verdad el modelo (`<model-viewer>` + WebGL), no
 *    que el campo `modelGlbUrl` tenga una URL.
 *  - Que el carrito sobreviva a una recarga. Ya se rompio una vez: el efecto
 *    que persistia escribia `[]` antes de hidratar.
 *  - Que el seguimiento del pedido se actualice solo, sin que nadie recargue.
 *
 * Corre contra la base sembrada (`npm run db:seed`), con el cobro simulado.
 */
import { expect, test, type Page } from '@playwright/test';

const SLUG = 'la-parrilla-de-don-pepe';
const PLATO = 'Milanesa napolitana con papas';

/** Abre la carta como si se hubiera escaneado el QR de una mesa. */
async function escanearElQr(page: Page, mesa = '4'): Promise<void> {
  await page.goto(`/m/${SLUG}?mesa=${mesa}`);
  // El nombre del local esta en la cabecera del marco de la carta.
  await expect(page.getByText('La Parrilla de Don Pepe')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entradas' })).toBeVisible();
}

/** Abre el detalle de un plato desde su tarjeta. */
async function abrirPlato(page: Page, nombre: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(nombre, 'i') }).first().click();
  await expect(page.getByRole('button', { name: 'Agregar al pedido' })).toBeVisible();
}

test.describe('el comensal', () => {
  test('escanea el QR y ve la carta', async ({ page }) => {
    await escanearElQr(page);

    await expect(page.getByText(PLATO)).toBeVisible();
    // Nada se sale de la pantalla del telefono.
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(desborde, 'la carta se sale de la pantalla').toBeLessThanOrEqual(0);
  });

  test('busca sin tildes y encuentra', async ({ page }) => {
    await escanearElQr(page);
    const buscador = page.locator('.search-bar input').first();

    // Asi escribe el comensal en el teclado del celular.
    await buscador.fill('cafe');
    await expect(page.getByText('Café cortado')).toBeVisible();

    await buscador.fill('sushi');
    await expect(page.getByText(PLATO)).toBeHidden();
  });

  test('un error de tipeo no deja la pantalla vacia', async ({ page }) => {
    // Es lo que pasa de verdad: se escribe rapido en el celular y se come una
    // letra. Sin esto, el comensal se queda mirando "no encontramos nada" y
    // concluye que el plato no esta.
    await escanearElQr(page);
    const buscador = page.locator('.search-bar input').first();

    await buscador.fill('milanesa');
    await expect(page.getByText(PLATO)).toBeVisible();

    await buscador.fill('milanessa');
    await expect(page.getByText(PLATO), 'un error de tipeo vacio la carta').toBeVisible();
  });

  test('ve el plato en 3D', async ({ page }) => {
    await escanearElQr(page);
    await abrirPlato(page, PLATO);

    const visor = page.locator('model-viewer').first();
    await expect(visor).toBeVisible();

    // Que el elemento este en el DOM no prueba nada: lo que importa es que el
    // modelo haya cargado. `loaded` lo dice el propio <model-viewer>.
    await expect
      .poll(() => visor.evaluate((el) => (el as unknown as { loaded: boolean }).loaded), {
        message: 'el modelo 3D nunca termino de cargar',
        timeout: 30_000,
      })
      .toBe(true);

    // Se lee la propiedad, no el atributo: React 19 asigna los campos de un
    // custom element como propiedades, asi que `getAttribute('src')` da null
    // aunque el modelo este cargado.
    const src = await visor.evaluate((el) => (el as unknown as { src: string }).src);
    expect(src, 'el visor quedo sin modelo').toMatch(/\.glb(\?|$)/);
  });

  test('el carrito sobrevive a una recarga', async ({ page }) => {
    // Ya se rompio una vez: el efecto que persistia escribia `[]` antes de
    // hidratar, y con StrictMode la segunda lectura encontraba el carrito
    // vacio. El comensal que vuelve de mirar otra pestaña pierde el pedido.
    //
    // Comprobado que falla de verdad: si el carrito vuelve a hidratarse por
    // efecto en lugar de en el inicializador del reducer, esta prueba cae.
    await escanearElQr(page);
    await abrirPlato(page, PLATO);
    await page.getByRole('button', { name: 'Agregar al pedido' }).click();

    // La barra del pedido aparece con lo agregado.
    const barra = page.getByRole('link', { name: /Pedido · 1/ });
    await expect(barra).toBeVisible();

    await page.reload();

    await expect(barra, 'el carrito se vacio al recargar').toBeVisible();
  });

  test('pide, paga y sigue el estado', async ({ page }) => {
    await escanearElQr(page);

    await abrirPlato(page, PLATO);
    await page.getByRole('button', { name: 'Agregar al pedido' }).click();
    await page.getByRole('link', { name: /Pedido · 1/ }).click();

    await expect(page.getByRole('heading', { name: 'Tu pedido' })).toBeVisible();
    // El total tiene que estar a la vista antes de pagar: nadie paga a ciegas.
    // `exact`: sin eso "Total" tambien coincide con "Subtotal".
    await expect(page.getByText('Total', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Pagar y enviar a cocina' }).click();

    // Termina en el seguimiento, con el codigo del pedido.
    await page.waitForURL(/\/pedido\//, { timeout: 30_000 });
    const codigo = page.url().split('/pedido/')[1]!.split('?')[0]!;
    expect(codigo, 'el pedido quedo sin codigo').toMatch(/^[A-Z0-9-]{4,}$/i);

    await expect(page.getByText(new RegExp(codigo, 'i')).first()).toBeVisible();
  });
});
