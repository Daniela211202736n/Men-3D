/**
 * Los textos legales.
 *
 * Dos cosas se comprueban acá, y las dos importan por el mismo motivo: un
 * documento legal que no se puede leer, o que se publica a medio llenar, es
 * peor que no tenerlo.
 *
 *  - **Que se llegue.** Desde la portada y desde la pantalla de datos del
 *    comensal, que es donde los busca una persona y donde los espera encontrar
 *    la normativa de comercio electronico.
 *  - **Que mientras falten datos, se vea.** El aviso de borrador y los
 *    marcadores «FALTA: X» tienen que estar a la vista. El dia que alguien
 *    complete apps/web/src/legal/empresa.ts, estas dos afirmaciones se dan
 *    vuelta solas y hay que venir a actualizarlas: eso es la señal de que el
 *    texto quedo listo para publicar.
 */
import { expect, test } from '@playwright/test';

const SLUG = 'la-parrilla-de-don-pepe';

test.describe('textos legales', () => {
  test('se llega a la privacidad desde la portada', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Politica de privacidad' }).click();
    await expect(page.getByRole('heading', { name: 'Política de privacidad' })).toBeVisible();
  });

  test('los tres documentos se navegan entre si', async ({ page }) => {
    // Acotado a la navegacion a proposito: los textos tambien se enlazan entre
    // si en el cuerpo —un termino que remite al otro— asi que el mismo nombre
    // aparece dos veces en la pagina, y las dos veces esta bien que aparezca.
    await page.goto('/legal/privacidad');
    const nav = page.getByRole('navigation');

    await nav.getByRole('link', { name: 'Términos del servicio' }).click();
    await expect(page.getByRole('heading', { name: 'Términos del servicio' })).toBeVisible();

    await nav.getByRole('link', { name: 'Términos para el comensal' }).click();
    await expect(page.getByRole('heading', { name: 'Términos para el comensal' })).toBeVisible();

    await nav.getByRole('link', { name: 'Privacidad' }).click();
    await expect(page.getByRole('heading', { name: 'Política de privacidad' })).toBeVisible();
  });

  test('/legal lleva a la privacidad', async ({ page }) => {
    await page.goto('/legal');
    await expect(page).toHaveURL(/\/legal\/privacidad$/);
  });

  test('el comensal llega desde su pantalla de datos', async ({ page }) => {
    await page.goto(`/m/${SLUG}/privacidad`);
    await page.getByRole('link', { name: 'Términos para el comensal' }).click();
    await expect(page.getByRole('heading', { name: 'Términos para el comensal' })).toBeVisible();
  });

  test('la tabla de terceros se renderiza como tabla', async ({ page }) => {
    // El renderizador de Markdown es nuestro y la tabla es su parte mas fragil.
    // Si se rompe, la lista de con quien se comparten datos sale como un
    // pegote de barras verticales, que es justo lo que nadie va a leer.
    await page.goto('/legal/privacidad');
    const tabla = page.locator('.legal-prose table').first();
    await expect(tabla).toBeVisible();
    await expect(tabla.locator('th').first()).toHaveText('Quién');
    await expect(tabla.getByRole('cell', { name: /MercadoPago/ })).toBeVisible();
    // El texto en negrita dentro de una celda tambien tiene que salir bien.
    await expect(tabla.locator('td strong').first()).toBeVisible();
  });

  test('las citas y el codigo salen con su formato', async ({ page }) => {
    await page.goto('/legal/privacidad');
    await expect(page.locator('.legal-prose blockquote')).toContainText(
      'Agencia de Acceso a la Información Pública',
    );
    await expect(page.locator('.legal-prose code').first()).toBeVisible();
  });

  test('mientras falten datos, el borrador lo dice', async ({ page }) => {
    await page.goto('/legal/privacidad');
    const aviso = page.getByTestId('aviso-borrador-legal');
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Borrador');
    // Y los marcadores sin completar se ven en el cuerpo, no se esconden.
    await expect(page.locator('.legal-prose')).toContainText('«FALTA: RAZON_SOCIAL»');
  });
});

/**
 * El boton de arrepentimiento.
 *
 * Las dos cosas que la Res. 424/2020 exige y que se pueden romper sin darse
 * cuenta: que se llegue desde la portada en un solo clic, y que no haya que
 * registrarse ni buscar ningun numero para usarlo.
 */
test.describe('boton de arrepentimiento', () => {
  test('se llega desde la portada en un clic', async ({ page }) => {
    await page.goto('/');
    // Con el nombre exacto que usa la norma.
    await page.getByRole('link', { name: 'BOTÓN DE ARREPENTIMIENTO' }).click();
    await expect(
      page.getByRole('heading', { name: 'Botón de arrepentimiento' }),
    ).toBeVisible();
  });

  test('no pide registrarse y devuelve el codigo en el acto', async ({ page }) => {
    await page.goto('/arrepentimiento');

    // Sin login: se completa y se manda. Solo los dos campos obligatorios, que
    // es todo lo que la norma permite exigir.
    await page.getByLabel('Tu nombre').fill('Ana Arrepentida');
    await page.getByLabel('Tu correo').fill(`e2e-${Date.now()}@prueba.demo`);
    await page.getByRole('button', { name: /Registrar mi arrepentimiento/ }).click();

    // El codigo sale en pantalla: mismo medio, y dentro del plazo de 24 h con
    // muchisimo margen.
    const tarjeta = page.getByTestId('codigo-de-revocacion');
    await expect(tarjeta).toBeVisible();
    // Contra el <strong>, no contra la tarjeta: ahi vive el codigo solo, y asi
    // el patron ancla de verdad en vez de contra el texto de todo el bloque.
    await expect(tarjeta.locator('strong')).toHaveText(
      /^ARR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/,
    );
  });
});
