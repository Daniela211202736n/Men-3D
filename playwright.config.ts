/**
 * End-to-end del camino del dinero: escanear → ver en 3D → pedir → pagar.
 *
 * Es el unico recorrido que ninguna prueba de integracion cubre entero, porque
 * la mitad vive en el navegador: el visor 3D, el carrito que sobrevive a una
 * recarga, el seguimiento que se actualiza solo. Las pruebas de la API dicen
 * que el servidor hace lo correcto; esta dice que el comensal puede pedir.
 *
 * Levanta la API y la PWA por su cuenta (`webServer`), asi que corre con un
 * solo comando y en CI sin pasos aparte.
 */
import { existsSync, globSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/**
 * El build de produccion servido por `vite preview`: lo que recibe el comensal.
 *
 * Se probo tambien correr las pruebas de hidratacion contra el servidor de
 * desarrollo, que activa StrictMode y monta los componentes dos veces —fue asi
 * como se descubrio en su momento que el carrito se perdia al recargar. Se
 * descarto: al romper a proposito la hidratacion, el build de produccion la
 * detecta igual, y no se encontro ningun fallo que solo apareciera en
 * desarrollo. Un servidor mas y medio minuto mas de CI por un beneficio que no
 * se pudo demostrar no se sostienen. Si alguna vez aparece un bug que solo se
 * ve con StrictMode, esto es lo que hay que reconsiderar.
 */
const WEB = 'http://localhost:4173';
const API = 'http://localhost:4100';

/**
 * Chromium ya instalado en la maquina, si lo hay.
 *
 * Algunos entornos traen un Chromium de una version distinta a la que espera
 * este Playwright y no pueden descargar otro. Usar el que esta es mejor que no
 * poder correr las pruebas; en CI no hay ninguno en esa ruta y Playwright usa
 * el suyo, que es lo correcto ahi.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` lo fuerza a mano si hiciera falta.
 */
function chromiumDelSistema(): string | undefined {
  const explicito = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicito && existsSync(explicito)) return explicito;

  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!raiz || !existsSync(raiz)) return undefined;

  const candidatos = globSync(`${raiz}/chromium-*/chrome-linux/chrome`).sort();
  return candidatos.at(-1);
}

const ejecutable = chromiumDelSistema();

export default defineConfig({
  testDir: './e2e',
  // En CI un fallo real no se distingue de uno intermitente si se reintenta
  // para siempre: un reintento alcanza para descartar un arranque lento.
  retries: process.env.CI ? 1 : 0,
  // Un solo worker: las pruebas comparten la misma base sembrada.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: WEB,
    // El comensal llega desde un celular. Probarlo en un escritorio de 1280px
    // esconde justo los problemas que importan.
    ...devices['Pixel 7'],
    locale: 'es-AR',
    // El canal "chromium" (y no el headless shell) es el que existe cuando se
    // reutiliza el navegador del sistema.
    ...(ejecutable ? { launchOptions: { executablePath: ejecutable } } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: [
    {
      command: 'npm run dev -w @men3d/api',
      url: `${API}/api/public/la-parrilla-de-don-pepe/menu`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: '4100',
        // Puertos propios para no pelear con el `npm run dev` de todos los dias.
        PUBLIC_WEB_URL: WEB,
        PUBLIC_API_URL: API,
        CORS_ORIGIN: WEB,
        // El recorrido hace varios logins; el limite normal es para internet.
        AUTH_RATE_LIMIT_MAX: '500',
      },
    },
    {
      command: 'npm run preview -w @men3d/web -- --port 4173 --strictPort',
      url: WEB,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_API_URL: API },
    },
  ],
});
