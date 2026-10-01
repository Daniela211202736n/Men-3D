import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('../../', import.meta.url)), '');
  const apiUrl = env.VITE_API_URL ?? 'http://localhost:4000';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Men-3D — Menu en 3D y realidad aumentada',
          short_name: 'Men-3D',
          description:
            'Carta digital interactiva: mira el plato en 3D y en realidad aumentada antes de pedirlo.',
          theme_color: '#2a78d6',
          background_color: '#fcfcfb',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          // `model-viewer` pesa ~300 KB comprimido y solo hace falta al abrir un
          // plato. Precargarlo le costaria esos datos a quien solo mira la lista,
          // asi que se excluye del precache y se guarda la primera vez que se usa.
          globIgnores: ['**/model-viewer-*.js', '**/*.map'],
          runtimeCaching: [
            {
              urlPattern: /model-viewer-[\w-]+\.js$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'men3d-viewer-lib',
                expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 90 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Los modelos no cambian nunca (nombre con hash): cache primero,
              // asi la segunda visita al plato abre al instante con mala señal.
              urlPattern: /\.(?:glb|usdz)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'men3d-models',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // La carta se sirve de red primero (los precios cambian), con el
              // cache como red de contencion si el celular pierde señal.
              urlPattern: /\/api\/public\/.*\/menu/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'men3d-menu',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 6 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        // En desarrollo la PWA habla con la API por el mismo origen: sin CORS y
        // sin configurar nada en el navegador.
        '/api': { target: apiUrl, changeOrigin: true },
        // Medios subidos desde el backoffice con el driver `local`.
        '/media': { target: apiUrl, changeOrigin: true },
        '/upload': { target: apiUrl, changeOrigin: true },
      },
    },
    build: { target: 'es2022', sourcemap: true },
  };
});
