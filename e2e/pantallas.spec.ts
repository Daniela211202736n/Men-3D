/**
 * Dos cosas de las pantallas que solo se pueden comprobar en un navegador.
 *
 * Ninguna prueba de API ni de tipos las ve: una es una foto que se dibuja o no
 * se dibuja, y la otra es un numero que entra o no entra en su caja. Las dos
 * estuvieron rotas, y las dos se rompen en silencio —la pagina no falla, se ve
 * mal—, que es justo el fallo que nadie nota hasta que lo nota un cliente.
 */
import { expect, test, type Page } from '@playwright/test';

const SLUG = 'la-parrilla-de-don-pepe';
const PLATO = 'Milanesa napolitana con papas';
const DUENIO = { email: 'pepe@donpepe.demo', password: 'men3d-demo-2026' };

async function agregarAlCarrito(page: Page): Promise<void> {
  await page.goto(`/m/${SLUG}`);
  await page.getByRole('button', { name: new RegExp(PLATO, 'i') }).first().click();
  await page.getByRole('button', { name: 'Agregar al pedido' }).click();
  await page.getByRole('link', { name: /Pedido · 1/ }).click();
}

test.describe('carrito', () => {
  /**
   * El carrito es la ultima pantalla antes de pagar. Que el plato se vea en la
   * carta y desaparezca justo donde se confirma es perder lo unico que esta
   * aplicacion tiene para mostrar, y no rompe nada: simplemente deja de estar.
   */
  test('la linea del pedido muestra la foto del plato', async ({ page }) => {
    await agregarAlCarrito(page);

    const linea = page.locator('.linea-pedido').filter({ hasText: PLATO });
    await expect(linea).toHaveCount(1);

    const foto = linea.locator('img');
    await expect(foto, 'la linea del carrito no tiene foto').toHaveCount(1);

    // Que el `<img>` exista no alcanza: una URL rota tambien da un `<img>`.
    // Lo que se comprueba es que el navegador haya decodificado pixeles.
    const ancho = await foto.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(ancho, 'la foto del carrito no cargo').toBeGreaterThan(0);
  });
});

test.describe('panel', () => {
  /**
   * La facturacion de un mes en pesos argentinos son siete u ocho digitos. Con
   * un tamaño de letra fijo, "$ 3.216.418,37" no entraba en la tarjeta y se
   * cortaba contra el borde: el dueño leia "$ 3.216.418,3" y no tenia forma de
   * saber que le faltaba algo. Un numero cortado es peor que ningun numero.
   */
  test('los indicadores no se cortan contra el borde de su tarjeta', async ({ page }) => {
    await page.goto('/admin');
    await page.getByLabel('Email').fill(DUENIO.email);
    await page.getByLabel('Contraseña').fill(DUENIO.password);
    await page.getByRole('button', { name: /Entrar/ }).click();

    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    const valores = page.locator('.stat-valor');
    await expect(valores.first()).toBeVisible();

    const total = await valores.count();
    expect(total, 'no hay indicadores que revisar').toBeGreaterThan(0);

    for (let i = 0; i < total; i += 1) {
      const valor = valores.nth(i);
      const texto = (await valor.innerText()).trim();
      const desborde = await valor.evaluate((el) => ({
        contenido: el.scrollWidth,
        caja: el.clientWidth,
      }));
      expect(
        desborde.contenido,
        `"${texto}" mide ${desborde.contenido}px en una caja de ${desborde.caja}px`,
      ).toBeLessThanOrEqual(desborde.caja + 1);
    }
  });
});
