/**
 * Consentimiento y datos del comensal.
 *
 * La prueba que justifica todo el modulo: **si el comensal dice que no, no
 * sale ni un evento.** Un aviso que informa y mide igual no es un aviso, es un
 * cartel —y es lo que vuelve ilegal a la mayoria de las implementaciones. Acá
 * se comprueba contando las peticiones de analitica que salen del navegador,
 * no leyendo el codigo.
 */
import { expect, test, type Page } from '@playwright/test';

const SLUG = 'la-parrilla-de-don-pepe';
const PLATO = 'Milanesa napolitana con papas';

/** Cuenta las peticiones de analitica que salen de verdad. */
function contarEventos(page: Page): { total: () => number } {
  let total = 0;
  page.on('request', (req) => {
    if (req.url().includes('/analytics/events') || req.url().includes('/events')) total += 1;
  });
  return { total: () => total };
}

/** Pasea por la carta generando eventos: abrir un plato, girar, buscar. */
async function usarLaCarta(page: Page): Promise<void> {
  await page.goto(`/m/${SLUG}`);
  await expect(page.getByText('La Parrilla de Don Pepe')).toBeVisible();
  await page.locator('.search-bar input').first().fill('milanesa');
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: new RegExp(PLATO, 'i') }).first().click();
  await page.waitForTimeout(2500);
  // El lote sale cada dos segundos o al ocultarse la pestaña.
  await page.waitForTimeout(2500);
}

test.describe('consentimiento', () => {
  test('el aviso aparece sin tapar la carta', async ({ page }) => {
    await page.goto(`/m/${SLUG}`);
    // La carta tiene que estar a la vista antes que el aviso.
    await expect(page.getByRole('heading', { name: 'Entradas' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Medicion de uso' })).toBeVisible();
  });

  test('rechazar y aceptar pesan lo mismo', async ({ page }) => {
    // Si rechazar cuesta mas que aceptar, el consentimiento no es libre.
    await page.goto(`/m/${SLUG}`);
    const aviso = page.getByRole('region', { name: 'Medicion de uso' });
    await expect(aviso).toBeVisible();

    const no = await aviso.getByRole('button', { name: 'No, gracias' }).boundingBox();
    const si = await aviso.getByRole('button', { name: 'Esta bien' }).boundingBox();
    expect(no, 'falta el boton de rechazar').toBeTruthy();
    expect(si).toBeTruthy();
    // Mismo alto y ancho parecido: ninguno es el boton chiquito gris.
    expect(Math.abs(no!.height - si!.height)).toBeLessThan(2);
    expect(Math.abs(no!.width - si!.width)).toBeLessThan(8);
  });

  test('sin responder no se mide', async ({ page }) => {
    // El silencio no es un si.
    const contador = contarEventos(page);
    await usarLaCarta(page);
    expect(contador.total(), 'se midio sin que nadie aceptara').toBe(0);
  });

  test('si rechaza, no sale ni un evento', async ({ page }) => {
    const contador = contarEventos(page);
    await page.goto(`/m/${SLUG}`);
    await page.getByRole('button', { name: 'No, gracias' }).click();

    await usarLaCarta(page);
    expect(contador.total(), 'dijo que no y se midio igual').toBe(0);
  });

  test('si acepta, se mide', async ({ page }) => {
    // El contrapunto: sin esto, la prueba de arriba pasaria con la analitica
    // rota del todo y no probaria nada.
    const contador = contarEventos(page);
    await page.goto(`/m/${SLUG}`);
    await page.getByRole('button', { name: 'Esta bien' }).click();

    await usarLaCarta(page);
    expect(contador.total(), 'acepto y no se midio nada').toBeGreaterThan(0);
  });
});

test.describe('tus datos', () => {
  test('se llega desde la carta y explica que se guarda', async ({ page }) => {
    await page.goto(`/m/${SLUG}`);
    await page.getByRole('link', { name: /Tus datos y privacidad/i }).click();

    await expect(page.getByRole('heading', { name: 'Tus datos' })).toBeVisible();
    const texto = await page.locator('body').innerText();
    // Lo que puede sorprender se dice antes de que toque borrar, no despues.
    expect(texto).toContain('comprobante de la venta');
  });

  test('se puede cambiar de opinion desde ahi', async ({ page }) => {
    await page.goto(`/m/${SLUG}`);
    await page.getByRole('button', { name: 'No, gracias' }).click();
    await page.goto(`/m/${SLUG}/privacidad`);

    await expect(page.getByText(/rechazada — no se registra nada/)).toBeVisible();
    await page.getByRole('button', { name: 'Permitir' }).click();
    await expect(page.getByText(/Estado:\s*aceptada/)).toBeVisible();
  });

  test('muestra lo que hay y deja descargarlo', async ({ page }) => {
    await page.goto(`/m/${SLUG}/privacidad`);
    await page.getByRole('button', { name: 'Ver todo lo que hay' }).click();

    await expect(page.getByRole('button', { name: 'Descargarlo en un archivo' })).toBeVisible();
    const descarga = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargarlo en un archivo' }).click();
    const archivo = await descarga;
    expect(archivo.suggestedFilename()).toContain(SLUG);
  });
});
