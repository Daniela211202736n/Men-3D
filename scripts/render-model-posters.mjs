/**
 * Renderiza una imagen de cada modelo 3D.
 *
 * Un plato sin foto se ve como un cuadrado gris, y una carta de comida sin
 * comida no la mira nadie. Pero todo plato que tiene modelo 3D ya tiene, de
 * hecho, su imagen: falta sacarle una foto.
 *
 * Eso hace esto. Abre cada GLB en `<model-viewer>` dentro de un Chromium sin
 * ventana —el mismo que usan las pruebas de navegador— y guarda un PNG con
 * fondo transparente, para que la miniatura funcione igual en modo claro y en
 * oscuro sin recortar nada.
 *
 * Es parte de `npm run models:sample` y la salida va a la misma carpeta
 * ignorada que los GLB: son archivos generados, no se versionan.
 *
 * Por que un navegador y no una libreria de Node: renderizar glTF con sus
 * materiales y su iluminacion fuera de un motor de verdad es reimplementar
 * medio three.js. El navegador ya esta instalado para las pruebas.
 */
import { createReadStream } from 'node:fs';
import { readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODELOS = join(RAIZ, 'apps/web/public/models');
const VIEWER = join(
  RAIZ,
  'node_modules/@google/model-viewer/dist/model-viewer-umd.min.js',
);

/**
 * Lado del PNG.
 *
 * 512 y no mas: la miniatura de la carta mide 112 px, asi que 512 ya son 4,5x
 * —de sobra en cualquier pantalla— y a 720 cada archivo pesaba el doble sin que
 * se note la diferencia. Estas imagenes se versionan (ver el README del
 * script), y un binario versionado que pesa de mas lo paga todo el que clone.
 */
const LADO = 512;

const TIPOS = {
  '.glb': 'model/gltf-binary',
  '.js': 'text/javascript',
  '.html': 'text/html; charset=utf-8',
};

/** La pagina que monta el visor. El fondo queda transparente a proposito. */
const PAGINA = `<!doctype html>
<html>
  <head><meta charset="utf-8"><script src="/viewer.js"></script></head>
  <body style="margin:0;background:transparent">
    <model-viewer
      id="v"
      style="width:${LADO}px;height:${LADO}px;background:transparent"
      camera-orbit="25deg 68deg 88%"
      shadow-intensity="0.9"
      shadow-softness="0.8"
      exposure="1.05"
      environment-image="neutral"
      disable-zoom
      interaction-prompt="none"
    ></model-viewer>
  </body>
</html>`;

/** Servidor minimo: la pagina, el bundle del visor y los GLB. */
function servir() {
  return new Promise((listo) => {
    const server = createServer((req, res) => {
      const ruta = req.url.split('?')[0];
      if (ruta === '/') {
        res.writeHead(200, { 'content-type': TIPOS['.html'] }).end(PAGINA);
        return;
      }
      const archivo =
        ruta === '/viewer.js' ? VIEWER : join(MODELOS, ruta.replace('/models/', ''));
      createReadStream(archivo)
        .on('open', function abrio() {
          res.writeHead(200, {
            'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
          });
          this.pipe(res);
        })
        .on('error', () => res.writeHead(404).end());
    });
    server.listen(0, '127.0.0.1', () => listo(server));
  });
}

const server = await servir();
const puerto = server.address().port;

const glbs = (await readdir(MODELOS)).filter((f) => f.endsWith('.glb'));
if (glbs.length === 0) {
  console.error('No hay modelos que renderizar. Corre primero generate-sample-models.mjs.');
  server.close();
  process.exit(1);
}

await mkdir(MODELOS, { recursive: true });

/**
 * El Chromium a usar.
 *
 * Se respeta `CHROMIUM_PATH` si esta: algunos entornos traen el navegador
 * preinstalado en otro lado y `playwright install` no corre. Sin la variable se
 * usa el que Playwright haya descargado.
 */
/**
 * Sin navegador no se renderiza, pero tampoco se rompe la compilacion.
 *
 * Las imagenes son una comodidad —la carta funciona sin ellas, con el icono de
 * plato— y este script corre dentro de `models:sample`, que es un paso de
 * build. Tumbar un despliegue entero porque falta un Chromium seria cambiar un
 * problema cosmetico por uno real. Avisa y sigue.
 */
let navegador;
try {
  navegador = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    // El lienzo 3D necesita GL; en un contenedor sin GPU va por software.
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
} catch (error) {
  console.warn(
    `\nSin navegador: no se renderizaron las imagenes de los platos.\n  ${error.message.split('\n')[0]}\n` +
      '  La carta funciona igual; los platos se ven con el icono de plato.\n' +
      '  Para tenerlas: npx playwright install chromium\n',
  );
  server.close();
  process.exit(0);
}
const pagina = await navegador.newPage({
  viewport: { width: LADO, height: LADO },
  deviceScaleFactor: 1,
});

let hechos = 0;
for (const glb of glbs) {
  const salida = join(MODELOS, glb.replace(/\.glb$/, '.png'));
  await pagina.goto(`http://127.0.0.1:${puerto}/`);

  // Se espera el evento `load` del propio visor: sin eso se fotografia un
  // lienzo vacio, que es el error clasico al automatizar esto.
  const cargo = await pagina.evaluate(
    ([nombre]) =>
      new Promise((resolver) => {
        const v = document.getElementById('v');
        v.addEventListener('load', () => resolver(true), { once: true });
        v.addEventListener('error', () => resolver(false), { once: true });
        v.src = `/models/${nombre}`;
        setTimeout(() => resolver(false), 20000);
      }),
    [glb],
  );

  if (!cargo) {
    console.error(`  no pude cargar ${glb}`);
    continue;
  }

  // Un respiro para que termine de pintar sombras y exposicion.
  await pagina.waitForTimeout(350);
  await pagina.locator('#v').screenshot({ path: salida, omitBackground: true });
  hechos += 1;
  console.log(`  ${glb.replace(/\.glb$/, '.png')}`);
}

await navegador.close();
server.close();

console.log(`\n${hechos} imagen(es) renderizada(s) en ${MODELOS}`);
if (hechos !== glbs.length) process.exit(1);
