/**
 * Genera los modelos 3D de ejemplo (GLB) que usa la carta de demostracion.
 *
 * Son GLB validos escritos a mano: un plato de verdad se escanea o se modela,
 * pero para que `npm run setup` deje el visor 3D y la RA funcionando sin bajar
 * assets de ningun lado, alcanza con geometria generada.
 *
 * Formato (glTF 2.0 binario): cabecera de 12 bytes + chunk JSON + chunk BIN,
 * cada uno alineado a 4 bytes. Especificacion:
 * https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout
 *
 * Tres cosas hacen que esto no parezca plastico, y conviene saber por que estan:
 *
 *  1. **Superficies parametricas con orientacion correcta.** Toda la malla sale
 *     de `superficie()`, que recorre (u, v) y arma los triangulos de forma que
 *     la normal geometrica apunte para afuera. El devanado al reves es invisible
 *     en el codigo y obvio en la pantalla: se ve el interior del objeto.
 *  2. **Relieve por ruido.** Una elipsoide perfecta lee como plastico moldeado.
 *     `relieve` desplaza cada vertice sobre su normal con ruido determinista y
 *     ademas **corrige la normal** con el gradiente del mismo campo, que es lo
 *     que hace que la luz se rompa como en una superficie real.
 *  3. **Color por vertice.** Un `baseColorFactor` plano no existe en la comida.
 *     Los materiales con `variacion` llevan un COLOR_0 que modula el color con
 *     el mismo ruido: pan mas dorado de un lado, queso tostado, carne veteada.
 *
 * Todo el ruido viene de un hash entero, asi que la salida es la misma byte a
 * byte en cada corrida. Eso importa: las imagenes que se versionan se renderizan
 * a partir de estos archivos.
 *
 * Uso: node scripts/generate-sample-models.mjs [directorio-destino]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, '../apps/web/public/models'));

const DEG = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* -------------------------------------------------------------------- ruido */

/**
 * Hash entero -> [0, 1). Sin dependencias y sin estado: el mismo (i, j, k, s)
 * da siempre el mismo numero, en cualquier maquina y en cualquier version de
 * Node. De eso depende que los GLB —y las imagenes que salen de ellos— sean
 * reproducibles.
 */
function hash01(i, j, k, seed) {
  let h =
    Math.imul(i | 0, 374761393) ^
    Math.imul(j | 0, 668265263) ^
    Math.imul(k | 0, 1442695041) ^
    Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const suave = (t) => t * t * (3 - 2 * t);
const mezcla = (a, b, t) => a + (b - a) * t;

/** Ruido de valor en 3D, interpolado suave sobre la grilla entera. */
function ruido3(x, y, z, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = suave(x - xi);
  const yf = suave(y - yi);
  const zf = suave(z - zi);
  const c = (dx, dy, dz) => hash01(xi + dx, yi + dy, zi + dz, seed);
  return mezcla(
    mezcla(mezcla(c(0, 0, 0), c(1, 0, 0), xf), mezcla(c(0, 1, 0), c(1, 1, 0), xf), yf),
    mezcla(mezcla(c(0, 0, 1), c(1, 0, 1), xf), mezcla(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
}

/** Varias octavas: bultos grandes y grano fino en el mismo campo. */
function fbm(x, y, z, seed = 0, octavas = 3) {
  let suma = 0;
  let amp = 1;
  let norma = 0;
  let f = 1;
  for (let o = 0; o < octavas; o += 1) {
    suma += amp * ruido3(x * f, y * f, z * f, seed + o * 101);
    norma += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return suma / norma;
}

/**
 * Relieve: desplaza el punto sobre su normal con ruido y corrige la normal.
 *
 * Lo segundo es lo que importa. Desplazar sin tocar la normal da una silueta
 * irregular con sombreado liso —sigue pareciendo plastico, ahora abollado—.
 * La normal se inclina con el gradiente del campo proyectado sobre el plano
 * tangente, que es el mismo truco que un mapa de relieve, pero resuelto en el
 * vertice porque aca no hay texturas.
 */
function relievePunto([x, y, z], [nx, ny, nz], { amp, freq, octavas = 3, seed = 0, bump = 4 }) {
  const f = (a, b, c) => fbm(a * freq, b * freq, c * freq, seed, octavas) - 0.5;
  const d = f(x, y, z);
  const e = 0.35 / freq;
  const gx = (f(x + e, y, z) - f(x - e, y, z)) / (2 * e);
  const gy = (f(x, y + e, z) - f(x, y - e, z)) / (2 * e);
  const gz = (f(x, y, z + e) - f(x, y, z - e)) / (2 * e);
  // Componente del gradiente tangente a la superficie.
  const dot = gx * nx + gy * ny + gz * nz;
  const tx = gx - dot * nx;
  const ty = gy - dot * ny;
  const tz = gz - dot * nz;
  // La ganancia del sombreado va aparte del desplazamiento: mover el vertice
  // 2 mm cambia la silueta, pero lo que rompe la luz —y lo que saca a la pieza
  // de parecer plastico— es la inclinacion de la normal, y necesita mas.
  const g = amp * bump;
  const mx = nx - g * tx;
  const my = ny - g * ty;
  const mz = nz - g * tz;
  const len = Math.hypot(mx, my, mz) || 1;
  return {
    p: [x + nx * amp * d, y + ny * amp * d, z + nz * amp * d],
    n: [mx / len, my / len, mz / len],
  };
}

function aplicarRelieve(positions, normals, capas) {
  if (!capas || capas.length === 0) return;
  for (let i = 0; i < positions.length; i += 3) {
    let p = [positions[i], positions[i + 1], positions[i + 2]];
    let n = [normals[i], normals[i + 1], normals[i + 2]];
    for (const capa of capas) ({ p, n } = relievePunto(p, n, capa));
    positions[i] = p[0];
    positions[i + 1] = p[1];
    positions[i + 2] = p[2];
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
}

/* --------------------------------------------------------------- transformes */

/** Euler XYZ. Se aplica X, despues Y, despues Z. */
function rotar([x, y, z], r) {
  if (!r) return [x, y, z];
  let [px, py, pz] = [x, y, z];
  if (r[0]) {
    const c = Math.cos(r[0]);
    const s = Math.sin(r[0]);
    [py, pz] = [py * c - pz * s, py * s + pz * c];
  }
  if (r[1]) {
    const c = Math.cos(r[1]);
    const s = Math.sin(r[1]);
    [px, pz] = [px * c + pz * s, -px * s + pz * c];
  }
  if (r[2]) {
    const c = Math.cos(r[2]);
    const s = Math.sin(r[2]);
    [px, py] = [px * c - py * s, px * s + py * c];
  }
  return [px, py, pz];
}

/**
 * Escala, rota, traslada; y si hay `fuera`, rota y traslada otra vez.
 *
 * El segundo nivel existe para las piezas compuestas: el repulgue de la
 * empanada se dibuja en el marco de la empanada y despues se mueve con ella.
 * Componer angulos de Euler sumandolos da mal; encadenar transformes, no.
 */
function puntoMundo(p, { t = [0, 0, 0], s = [1, 1, 1], rot = null, fuera = null }) {
  let q = rotar([p[0] * s[0], p[1] * s[1], p[2] * s[2]], rot);
  q = [q[0] + t[0], q[1] + t[1], q[2] + t[2]];
  if (fuera) {
    q = rotar(q, fuera.rot);
    const ft = fuera.t ?? [0, 0, 0];
    q = [q[0] + ft[0], q[1] + ft[1], q[2] + ft[2]];
  }
  return q;
}

/** La normal escala con el inverso de la escala y rota igual que el punto. */
function normalMundo(n, { s = [1, 1, 1], rot = null, fuera = null }) {
  let q = rotar([n[0] / s[0], n[1] / s[1], n[2] / s[2]], rot);
  if (fuera) q = rotar(q, fuera.rot);
  const len = Math.hypot(q[0], q[1], q[2]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len];
}

/* ---------------------------------------------------------------- geometria */

/**
 * Color por vertice.
 *
 * COLOR_0 multiplica el `baseColorFactor`, asi que alcanza con un valor cerca
 * de 1 que sube y baja con el ruido. `calidez` ademas corre el tono hacia el
 * rojo donde el ruido es alto: es lo que separa un pan dorado de un pan beige.
 */
function colorear(positions, normals, { variacion = 0, grano = 90, calidez = 0, tostado = 0, semillaColor = 7 }) {
  const colors = [];
  for (let i = 0; i < positions.length; i += 3) {
    const n =
      fbm(
        positions[i] * grano,
        positions[i + 1] * grano,
        positions[i + 2] * grano,
        semillaColor,
        3,
      ) - 0.5;
    const k = 1 + variacion * n * 2;
    const w = calidez * n * 2;
    // Tueste: solo las caras que miran para arriba, y solo en las manchas donde
    // el ruido es alto. Es lo que diferencia un queso derretido de uno crudo y
    // una empanada horneada de una cruda, y no cuesta ni un byte de textura.
    const arriba = Math.max(0, normals[i + 1]);
    const q = tostado * arriba * Math.max(0, n * 2);
    colors.push(clamp01(k + w - q * 0.9), clamp01(k - q * 1.5), clamp01(k - w - q * 2.2));
  }
  return colors;
}

/** Una pieza de geometria con su material; las coordenadas ya vienen en mundo. */
const pieza = (positions, normals, indices, material) => ({
  positions,
  normals,
  indices,
  material,
  colors: material.variacion || material.tostado ? colorear(positions, normals, material) : null,
});

/**
 * Malla parametrica.
 *
 * `en(u, v)` devuelve punto y normal en coordenadas de objeto. Los triangulos
 * se arman de modo que `du x dv` apunte para afuera: cada primitiva de abajo
 * elige sus parametros para que eso se cumpla, y el comentario de cada una dice
 * cual es cual. Esto es lo que antes estaba invertido en el cilindro y en la
 * esfera, y se notaba: la copa mostraba su cara interna.
 */
function superficie({ nu, nv, en, material, relief, saltar, ...tr }) {
  const positions = [];
  const normals = [];
  const indices = [];
  const paso = nv + 1;

  for (let i = 0; i <= nu; i += 1) {
    for (let j = 0; j <= nv; j += 1) {
      const { p, n } = en(i / nu, j / nv, i, j);
      positions.push(...puntoMundo(p, tr));
      normals.push(...normalMundo(n, tr));
    }
  }
  for (let i = 0; i < nu; i += 1) {
    if (saltar && saltar(i)) continue;
    for (let j = 0; j < nv; j += 1) {
      const a = i * paso + j;
      const b = (i + 1) * paso + j;
      const c = (i + 1) * paso + j + 1;
      const d = i * paso + j + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  aplicarRelieve(positions, normals, relief);
  return pieza(positions, normals, indices, material);
}

/**
 * Solido de revolucion a partir de un perfil `[[radio, altura], ...]`.
 *
 * El perfil se recorre **en sentido antihorario en el semiplano (r, y)** —por
 * abajo hacia afuera, por el canto hacia arriba, y de vuelta por arriba hacia el
 * eje—, y la normal de cada tramo es su tangente girada: con esa convencion
 * apunta siempre para afuera y las tapas salen gratis, sin codigo aparte.
 *
 * Repetir un punto del perfil crea una arista viva: el tramo degenerado no
 * emite triangulos y corta el promediado de normales. Asi se marca el canto de
 * un plato sin perder la curva del ala.
 */
function torno({ profile, segments = 44, material, relief, ...tr }) {
  const n = profile.length;
  // Normal 2D de cada tramo; los tramos de largo cero quedan en null.
  const normalTramo = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dr = profile[i + 1][0] - profile[i][0];
    const dy = profile[i + 1][1] - profile[i][1];
    const len = Math.hypot(dr, dy);
    normalTramo.push(len < 1e-9 ? null : [dy / len, -dr / len]);
  }
  // Normal de cada punto: promedio de los tramos vivos que lo tocan.
  const normalPunto = profile.map((_, i) => {
    const vecinos = [normalTramo[i - 1], normalTramo[i]].filter(Boolean);
    const sr = vecinos.reduce((a, v) => a + v[0], 0);
    const sy = vecinos.reduce((a, v) => a + v[1], 0);
    const len = Math.hypot(sr, sy) || 1;
    return [sr / len, sy / len];
  });

  return superficie({
    nu: n - 1,
    nv: segments,
    saltar: (i) => normalTramo[i] === null,
    en: (_u, v, i) => {
      const a = v * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const [r, y] = profile[i];
      const [nr, ny] = normalPunto[i];
      return { p: [cos * r, y, sin * r], n: [cos * nr, ny, sin * nr] };
    },
    material,
    relief,
    ...tr,
  });
}

/** Cilindro o cono truncado, como torno. `rTop === 0` da un cono. */
function cilindro({ rTop = 1, rBottom = 1, height = 1, canto = 0, ...resto }) {
  const hh = height / 2;
  const c = Math.min(canto, hh * 0.9);
  const profile = [[0, -hh]];
  if (c > 0) {
    profile.push([rBottom - c, -hh], [rBottom, -hh + c], [rTop, hh - c], [rTop - c, hh]);
  } else {
    profile.push([rBottom, -hh], [rBottom, -hh], [rTop, hh], [rTop, hh]);
  }
  profile.push([0, hh]);
  return torno({ profile, ...resto });
}

/**
 * Esfera o elipsoide.
 *
 * u sube (phi de pi a 0) y v gira: con ese orden la normal queda hacia afuera.
 */
function esfera({ r = 1, segments = 28, rings = 18, material, relief, ...tr }) {
  return superficie({
    nu: rings,
    nv: segments,
    en: (u, v) => {
      const phi = (1 - u) * Math.PI;
      const theta = v * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      return { p: [nx * r, ny * r, nz * r], n: [nx, ny, nz] };
    },
    material,
    relief,
    ...tr,
  });
}

/** Arco de toro: el asa de la taza, el aro de cebolla. */
function arcoToro({
  R = 0.03,
  r = 0.006,
  arco = Math.PI * 2,
  desde = 0,
  segments = 32,
  rings = 14,
  material,
  relief,
  ...tr
}) {
  return superficie({
    nu: segments,
    nv: rings,
    en: (u, v) => {
      const a = desde + u * arco;
      const b = v * Math.PI * 2;
      const n1 = [Math.cos(a), Math.sin(a), 0];
      const n2 = [0, 0, 1];
      const nx = Math.cos(b) * n1[0] + Math.sin(b) * n2[0];
      const ny = Math.cos(b) * n1[1] + Math.sin(b) * n2[1];
      const nz = Math.cos(b) * n1[2] + Math.sin(b) * n2[2];
      return {
        p: [R * n1[0] + r * nx, R * n1[1] + r * ny, r * nz],
        n: [nx, ny, nz],
      };
    },
    material,
    relief,
    ...tr,
  });
}

/**
 * Lamina teselada en el plano XZ, de una sola cara.
 *
 * Una feta de queso o una hoja de lechuga son laminas: lo que las hace creibles
 * no es el grosor sino la ondulacion, y para ondular hace falta que tengan
 * vertices en el medio. El material va `doubleSided` para que se vean de los
 * dos lados.
 */
function lamina({ w = 0.1, d = 0.1, nw = 10, nd = 10, comba = 0, material, relief, ...tr }) {
  return superficie({
    nu: nd,
    nv: nw,
    // u sobre +z, v sobre +x: du x dv = +y, que es la cara visible.
    en: (u, v) => {
      const x = (v - 0.5) * w;
      const z = (u - 0.5) * d;
      const rad = Math.hypot(x / (w / 2), z / (d / 2));
      const y = comba * rad * rad;
      // Normal de la parabola de revolucion que define la comba.
      const k = comba * 2;
      const nx = (-k * x) / (w / 2) ** 2;
      const nz = (-k * z) / (d / 2) ** 2;
      const len = Math.hypot(nx, 1, nz);
      return { p: [x, y, z], n: [nx / len, 1 / len, nz / len] };
    },
    material,
    relief,
    ...tr,
  });
}

/**
 * Hoja: disco radial de contorno lobulado y caido.
 *
 * Una hoja de lechuga no es un cuadrado. El contorno se modula con dos senos
 * periodicos en el angulo —periodicos para que la costura cierre— y la comba la
 * hace caer en los bordes; el relieve despues la arruga. Es la diferencia entre
 * una ensalada y unos papeles verdes.
 *
 * u gira y v va del centro al borde: con ese orden la cara visible mira arriba.
 */
function hoja({ R = 0.04, lobulos = 5, fase = 0, comba = 0.012, nseg = 36, nrad = 8, material, relief, ...tr }) {
  const borde = (th) =>
    R * (1 + 0.2 * Math.sin(lobulos * th + fase) + 0.1 * Math.sin(2 * lobulos * th + fase * 1.7));
  return superficie({
    nu: nseg,
    nv: nrad,
    en: (u, v) => {
      const th = u * Math.PI * 2;
      const rad = borde(th) * v;
      const x = Math.cos(th) * rad;
      const z = Math.sin(th) * rad;
      const y = -comba * v * v;
      // Normal de la parabola de revolucion que define la caida.
      const k = (2 * comba * v) / (borde(th) || 1);
      const len = Math.hypot(k * Math.cos(th), 1, k * Math.sin(th));
      return { p: [x, y, z], n: [(k * Math.cos(th)) / len, 1 / len, (k * Math.sin(th)) / len] };
    },
    material,
    relief,
    ...tr,
  });
}

/** Caja con normales planas (24 vertices: cada cara con su propia normal). */
function box({ size = [1, 1, 1], material, relief, ...tr }) {
  const [w, h, d] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const faces = [
    { n: [0, 0, 1], v: [[-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]] },
    { n: [0, 0, -1], v: [[w, -h, -d], [-w, -h, -d], [-w, h, -d], [w, h, -d]] },
    { n: [1, 0, 0], v: [[w, -h, d], [w, -h, -d], [w, h, -d], [w, h, d]] },
    { n: [-1, 0, 0], v: [[-w, -h, -d], [-w, -h, d], [-w, h, d], [-w, h, -d]] },
    { n: [0, 1, 0], v: [[-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d]] },
    { n: [0, -1, 0], v: [[-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d]] },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, fi) => {
    face.v.forEach((vertex) => {
      positions.push(...puntoMundo(vertex, tr));
      normals.push(...normalMundo(face.n, tr));
    });
    const o = fi * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  aplicarRelieve(positions, normals, relief);
  return pieza(positions, normals, indices, material);
}

/* -------------------------------------------------------------- empaque GLB */

const pad4 = (n) => (4 - (n % 4)) % 4;

/**
 * sRGB -> lineal.
 *
 * glTF define `baseColorFactor` en espacio **lineal**, no en sRGB. Escribir ahi
 * el valor que uno elegiria en un selector de color sube el tono casi medio
 * paso: por eso los platos salian lavados, con el pan rallado color durazno y
 * la muzzarella casi blanca. Los colores de `M` se escriben en sRGB —que es
 * como se piensan— y se convierten aca.
 */
const aLineal = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const colorLineal = (c) => [aLineal(c[0]), aLineal(c[1]), aLineal(c[2]), c[3] ?? 1];

/** Lo que viaja al archivo; el resto de las claves del material son para aca. */
function materialGltf(m) {
  const opaco = (m.color[3] ?? 1) >= 1;
  const out = {
    name: m.name,
    doubleSided: m.doubleSided ?? false,
    pbrMetallicRoughness: {
      baseColorFactor: colorLineal(m.color),
      metallicFactor: m.metallic ?? 0.0,
      roughnessFactor: m.roughness ?? 0.6,
    },
  };
  // Sin esto el alfa se ignora y el vidrio sale opaco: era el otro motivo por
  // el que la copa de Malbec no se parecia a una copa.
  if (!opaco) out.alphaMode = 'BLEND';
  if (m.emissive) out.emissiveFactor = colorLineal(m.emissive).slice(0, 3);
  return out;
}

/**
 * Junta en una sola malla las piezas que comparten material.
 *
 * Una empanada son 12 piezas de masa y el plato tiene tres: sin fusionar, el
 * telefono dibuja 37 veces lo que puede dibujar dos. No cambia un pixel de lo
 * que se ve; cambia cuantas llamadas de dibujo cuesta verlo.
 */
function fusionar(pieces) {
  const grupos = new Map();
  for (const p of pieces) {
    const key = JSON.stringify(p.material);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(p);
  }
  return [...grupos.values()].map((grupo) => {
    if (grupo.length === 1) return grupo[0];
    const positions = [];
    const normals = [];
    const indices = [];
    const colors = grupo[0].colors ? [] : null;
    let base = 0;
    for (const p of grupo) {
      for (const v of p.positions) positions.push(v);
      for (const v of p.normals) normals.push(v);
      if (colors) for (const v of p.colors) colors.push(v);
      for (const i of p.indices) indices.push(i + base);
      base += p.positions.length / 3;
    }
    return { positions, normals, indices, colors, material: grupo[0].material };
  });
}

function buildGlb(piezasSueltas, { name }) {
  const pieces = fusionar(piezasSueltas);
  const materials = [];
  const materialIndex = new Map();
  for (const p of pieces) {
    const key = JSON.stringify(p.material);
    if (!materialIndex.has(key)) {
      materialIndex.set(key, materials.length);
      materials.push(materialGltf(p.material));
    }
  }

  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  let offset = 0;

  const pushView = (data, target) => {
    // Cada bufferView arranca alineado: lo exige la especificacion.
    const padding = pad4(offset);
    if (padding) {
      buffers.push(Buffer.alloc(padding));
      offset += padding;
    }
    buffers.push(data);
    const view = { buffer: 0, byteOffset: offset, byteLength: data.byteLength };
    if (target) view.target = target;
    bufferViews.push(view);
    offset += data.byteLength;
    return bufferViews.length - 1;
  };

  const minMax = (values, components) => {
    const min = new Array(components).fill(Infinity);
    const max = new Array(components).fill(-Infinity);
    for (let i = 0; i < values.length; i += components) {
      for (let c = 0; c < components; c += 1) {
        min[c] = Math.min(min[c], values[i + c]);
        max[c] = Math.max(max[c], values[i + c]);
      }
    }
    return { min, max };
  };

  for (const p of pieces) {
    const vertices = p.positions.length / 3;
    const posData = Buffer.from(new Float32Array(p.positions).buffer);
    const nrmData = Buffer.from(new Float32Array(p.normals).buffer);
    // Indices de 16 bits cuando entran: es la mitad del archivo en mallas asi.
    const corto = vertices <= 65535;
    const idxArray = corto ? new Uint16Array(p.indices) : new Uint32Array(p.indices);
    const idxData = Buffer.from(idxArray.buffer);

    const posView = pushView(posData, 34962);
    const nrmView = pushView(nrmData, 34962);
    const idxView = pushView(idxData, 34963);

    const { min, max } = minMax(p.positions, 3);
    const posAcc = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: vertices,
      type: 'VEC3',
      min,
      max,
    });
    const nrmAcc = accessors.length;
    accessors.push({
      bufferView: nrmView,
      componentType: 5126,
      count: vertices,
      type: 'VEC3',
    });
    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: corto ? 5123 : 5125, // UNSIGNED_SHORT / UNSIGNED_INT
      count: p.indices.length,
      type: 'SCALAR',
    });

    const attributes = { POSITION: posAcc, NORMAL: nrmAcc };

    if (p.colors) {
      // RGBA de un byte, normalizado. VEC3 no sirve: la especificacion pide que
      // cada elemento de un atributo quede alineado a 4 bytes, y 3 bytes no lo
      // esta. Con VEC4 son 4 bytes por vertice en vez de 12.
      const bytes = Buffer.alloc(vertices * 4);
      for (let v = 0; v < vertices; v += 1) {
        bytes[v * 4] = Math.round(p.colors[v * 3] * 255);
        bytes[v * 4 + 1] = Math.round(p.colors[v * 3 + 1] * 255);
        bytes[v * 4 + 2] = Math.round(p.colors[v * 3 + 2] * 255);
        bytes[v * 4 + 3] = 255;
      }
      const colView = pushView(bytes, 34962);
      attributes.COLOR_0 = accessors.length;
      accessors.push({
        bufferView: colView,
        componentType: 5121, // UNSIGNED_BYTE
        normalized: true,
        count: vertices,
        type: 'VEC4',
      });
    }

    primitives.push({
      attributes,
      indices: idxAcc,
      material: materialIndex.get(JSON.stringify(p.material)),
      mode: 4, // TRIANGLES
    });
  }

  const binary = Buffer.concat(buffers);
  const gltf = {
    asset: { version: '2.0', generator: 'men3d-sample-models' },
    scene: 0,
    scenes: [{ nodes: [0], name }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.byteLength }],
  };

  const jsonBuffer = Buffer.from(JSON.stringify(gltf), 'utf8');
  // El chunk JSON se rellena con espacios y el BIN con ceros.
  const jsonPadded = Buffer.concat([
    jsonBuffer,
    Buffer.alloc(pad4(jsonBuffer.byteLength), 0x20),
  ]);
  const binPadded = Buffer.concat([
    binary,
    Buffer.alloc(pad4(binary.byteLength), 0x00),
  ]);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.byteLength + 8 + binPadded.byteLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.byteLength, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.byteLength, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]);
}

/* --------------------------------------------------------------- materiales */

/**
 * `variacion` y `calidez` activan el color por vertice; `grano` es la escala
 * del ruido en ciclos por metro (90 = un detalle cada centimetro).
 */
const M = {
  plate: { name: 'porcelana', color: [0.96, 0.955, 0.94, 1], roughness: 0.18, variacion: 0.03, grano: 30 },
  plateRim: { name: 'filete', color: [0.55, 0.47, 0.38, 1], roughness: 0.3, metallic: 0.3 },
  skillet: { name: 'hierro', color: [0.24, 0.225, 0.21, 1], metallic: 0.55, roughness: 0.62, variacion: 0.22, grano: 110 },
  wood: { name: 'madera', color: [0.33, 0.21, 0.12, 1], roughness: 0.65, variacion: 0.14, calidez: 0.05, grano: 70 },
  breaded: { name: 'pan rallado', color: [0.80, 0.55, 0.24, 1], roughness: 0.88, variacion: 0.22, calidez: 0.08, tostado: 0.30, grano: 150 },
  meat: { name: 'carne', color: [0.40, 0.17, 0.12, 1], roughness: 0.62, variacion: 0.24, calidez: 0.07, grano: 110 },
  ham: { name: 'jamon', color: [0.80, 0.42, 0.38, 1], roughness: 0.6, variacion: 0.12, grano: 130 },
  cheese: { name: 'muzzarella', color: [0.97, 0.84, 0.45, 1], roughness: 0.42, variacion: 0.16, calidez: 0.08, tostado: 0.55, grano: 90 },
  cheeseSlice: { name: 'cheddar', color: [0.93, 0.62, 0.17, 1], roughness: 0.45, doubleSided: true, variacion: 0.08, grano: 60 },
  provolone: { name: 'provolone', color: [0.96, 0.86, 0.55, 1], roughness: 0.38, variacion: 0.20, calidez: 0.10, tostado: 0.70, grano: 60 },
  bun: { name: 'pan', color: [0.79, 0.56, 0.28, 1], roughness: 0.82, variacion: 0.14, calidez: 0.07, tostado: 0.34, grano: 65 },
  crumb: { name: 'miga', color: [0.88, 0.78, 0.62, 1], roughness: 0.9, variacion: 0.10, grano: 140 },
  sesame: { name: 'sesamo', color: [0.97, 0.93, 0.80, 1], roughness: 0.45 },
  lettuce: { name: 'lechuga', color: [0.46, 0.62, 0.28, 1], roughness: 0.56, doubleSided: true, variacion: 0.26, calidez: 0.06, grano: 70 },
  herb: { name: 'oregano', color: [0.26, 0.38, 0.14, 1], roughness: 0.75 },
  onion: { name: 'cebolla', color: [0.66, 0.50, 0.64, 1], roughness: 0.46, doubleSided: true, variacion: 0.14, grano: 110 },
  tomato: { name: 'tomate', color: [0.70, 0.17, 0.12, 1], roughness: 0.34, variacion: 0.14, grano: 100 },
  sauce: { name: 'salsa', color: [0.62, 0.14, 0.08, 1], roughness: 0.34, variacion: 0.18, calidez: 0.05, grano: 95 },
  olive: { name: 'aceituna', color: [0.16, 0.14, 0.10, 1], roughness: 0.3, variacion: 0.12, grano: 160 },
  feta: { name: 'feta', color: [0.97, 0.96, 0.93, 1], roughness: 0.78, variacion: 0.06, grano: 90 },
  sugar: { name: 'azucar', color: [0.90, 0.88, 0.84, 1], roughness: 0.9, variacion: 0.08, grano: 400 },
  potato: { name: 'papa', color: [0.90, 0.72, 0.31, 1], roughness: 0.72, variacion: 0.18, calidez: 0.06, tostado: 0.30, grano: 130 },
  lemon: { name: 'limon', color: [0.92, 0.85, 0.28, 1], roughness: 0.42, variacion: 0.08, grano: 180 },
  lemonPulp: { name: 'pulpa', color: [0.96, 0.92, 0.55, 1], roughness: 0.3, variacion: 0.12, grano: 220 },
  glass: { name: 'cristal', color: [0.88, 0.92, 0.94, 0.28], roughness: 0.04, metallic: 0.0, doubleSided: true },
  wine: { name: 'malbec', color: [0.32, 0.03, 0.09, 0.88], roughness: 0.08 },
  caramel: { name: 'caramelo', color: [0.42, 0.21, 0.06, 1], roughness: 0.14, variacion: 0.16, calidez: 0.06, grano: 60 },
  custard: { name: 'flan', color: [0.96, 0.86, 0.60, 1], roughness: 0.3, variacion: 0.07, grano: 55 },
  dough: { name: 'masa', color: [0.86, 0.68, 0.40, 1], roughness: 0.74, variacion: 0.18, calidez: 0.09, tostado: 0.52, grano: 55 },
  coffee: { name: 'cafe', color: [0.14, 0.07, 0.04, 1], roughness: 0.18 },
  crema: { name: 'crema', color: [0.78, 0.60, 0.38, 1], roughness: 0.42, variacion: 0.16, calidez: 0.05, grano: 160 },
  cream: { name: 'nata', color: [0.98, 0.95, 0.89, 1], roughness: 0.38, variacion: 0.06, grano: 120 },
};

/* ------------------------------------------------------------ piezas comunes */

/** Numero pseudoaleatorio reproducible para colocar piezas sueltas. */
const az = (i, k, semilla) => hash01(i, k, 0, semilla);

/**
 * Plato de loza con ala y canto.
 *
 * El perfil sube desde el pie, se abre en el ala y vuelve por arriba hasta el
 * pozo. Los puntos repetidos marcan el canto. Es lo que distingue un plato de
 * un disco, y es casi todo lo que se ve de el en la miniatura.
 */
const ALTO_PLATO = 0.0058;
const plato = ({ R = 0.14, material = M.plate, t = [0, 0, 0] } = {}) =>
  torno({
    profile: [
      [0, 0],
      [R * 0.36, 0],
      [R * 0.42, 0.0012],
      [R * 0.46, 0.0032],
      [R * 0.70, 0.0095],
      [R * 0.90, 0.0165],
      [R * 0.98, 0.0225],
      [R, 0.0245],
      [R, 0.0245],
      [R * 0.985, 0.0268],
      [R * 0.90, 0.0238],
      [R * 0.70, 0.017],
      [R * 0.48, 0.0098],
      [R * 0.42, 0.0072],
      [R * 0.36, 0.0062],
      [0, ALTO_PLATO],
    ],
    segments: 52,
    material,
    t,
  });

/** Monton de papas baston, cada una con su angulo. */
const papas = ({ n = 10, centro, semilla = 4100 }) =>
  Array.from({ length: n }, (_, i) => {
    const fila = Math.floor(i / 4);
    return box({
      size: [0.0105, 0.0105, 0.058 + az(i, 1, semilla) * 0.024],
      t: [
        centro[0] + (az(i, 2, semilla) - 0.5) * 0.034,
        centro[1] + fila * 0.0102 + az(i, 3, semilla) * 0.002,
        centro[2] + (az(i, 4, semilla) - 0.5) * 0.052,
      ],
      rot: [
        (az(i, 5, semilla) - 0.5) * 24 * DEG,
        (az(i, 6, semilla) - 0.5) * 110 * DEG,
        (az(i, 7, semilla) - 0.5) * 20 * DEG,
      ],
      material: M.potato,
      relief: [{ amp: 0.0008, freq: 160, octavas: 2, seed: 71 + i }],
    });
  });

/** Rodaja de limon: cascara y pulpa, parada contra el borde del plato. */
const rodajaLimon = ({ t, rot }) => [
  cilindro({ rTop: 0.026, rBottom: 0.026, height: 0.009, canto: 0.002, segments: 36, t, rot, material: M.lemon }),
  cilindro({ rTop: 0.0225, rBottom: 0.0225, height: 0.0098, segments: 36, t, rot, material: M.lemonPulp }),
];

/** Semillas de sesamo sobre una cupula. */
const sesamo = ({ n, centro, radio, alto, semilla = 900 }) =>
  Array.from({ length: n }, (_, i) => {
    const a = az(i, 1, semilla) * Math.PI * 2;
    const d = 0.25 + az(i, 2, semilla) * 0.7;
    const x = Math.cos(a) * radio * d;
    const z = Math.sin(a) * radio * d;
    const y = alto * Math.sqrt(Math.max(0, 1 - d * d * 0.96));
    return esfera({
      r: 1,
      s: [0.0042, 0.0016, 0.0029],
      segments: 12,
      rings: 8,
      t: [centro[0] + x, centro[1] + y, centro[2] + z],
      rot: [0, a, 0],
      material: M.sesame,
    });
  });

/* ------------------------------------------------------------------ modelos */

const MODELS = {};

{
  const y = ALTO_PLATO;
  MODELS['milanesa-napolitana'] = [
    plato({ R: 0.145 }),
    // La milanesa. El ruido de baja frecuencia le rompe la elipse del borde y
    // el de alta le da el grano del pan rallado: sin eso es una pastilla.
    esfera({
      r: 1,
      s: [0.1, 0.019, 0.07],
      t: [-0.024, y + 0.015, 0.002],
      rot: [0, 7 * DEG, 0],
      segments: 52,
      rings: 28,
      material: M.breaded,
      relief: [
        { amp: 0.009, freq: 18, octavas: 3, seed: 3 },
        { amp: 0.0018, freq: 135, octavas: 2, seed: 11 },
      ],
    }),
    // Jamon, salsa y muzzarella gratinada: tres capas que asoman una sobre otra.
    esfera({
      r: 1, s: [0.083, 0.005, 0.056], t: [-0.024, y + 0.029, 0.002],
      segments: 40, rings: 16, material: M.ham,
      relief: [{ amp: 0.0022, freq: 38, seed: 5 }],
    }),
    esfera({
      r: 1, s: [0.077, 0.006, 0.051], t: [-0.024, y + 0.032, 0.002],
      segments: 40, rings: 16, material: M.sauce,
      relief: [{ amp: 0.0026, freq: 33, seed: 7 }],
    }),
    esfera({
      r: 1, s: [0.069, 0.009, 0.046], t: [-0.024, y + 0.0355, 0.002],
      segments: 44, rings: 20, material: M.cheese,
      relief: [
        { amp: 0.0042, freq: 40, seed: 13 },
        { amp: 0.0012, freq: 165, octavas: 2, seed: 17 },
      ],
    }),
    ...papas({ n: 10, centro: [0.082, y + 0.007, -0.004] }),
    ...rodajaLimon({ t: [0.008, y + 0.0235, 0.079], rot: [62 * DEG, 24 * DEG, 0] }),
  ];
}

{
  const y = ALTO_PLATO;
  const base = y + 0.0195;
  MODELS['hamburguesa-clasica'] = [
    plato({ R: 0.135 }),
    // Pan de abajo, con su cara cortada de miga.
    torno({
      profile: [
        [0, 0], [0.040, 0.0006], [0.0495, 0.0042], [0.0545, 0.0112], [0.0545, 0.0112],
        [0.0525, 0.0168], [0.030, 0.0190], [0, 0.0195],
      ],
      segments: 48, t: [0, y, 0], material: M.bun,
      relief: [{ amp: 0.0012, freq: 85, seed: 23 }],
    }),
    cilindro({ rTop: 0.0515, rBottom: 0.052, height: 0.0022, segments: 44, t: [0, base + 0.0005, 0], material: M.crumb }),
    // El medallon: borde redondeado y mucho relieve, que es lo que lo saca de
    // parecer un disco de goma.
    cilindro({
      rTop: 0.0565, rBottom: 0.0585, height: 0.017, canto: 0.005, segments: 48,
      t: [0, base + 0.010, 0], material: M.meat,
      relief: [
        { amp: 0.0032, freq: 36, seed: 29 },
        { amp: 0.0011, freq: 150, octavas: 2, seed: 31 },
      ],
    }),
    // El cheddar: una feta cuadrada que se cae por los costados.
    lamina({
      w: 0.096, d: 0.096, nw: 16, nd: 16, comba: -0.021,
      t: [0, base + 0.0225, 0], rot: [0, 24 * DEG, 0], material: M.cheeseSlice,
      relief: [{ amp: 0.0024, freq: 44, seed: 37 }],
    }),
    // Lechuga: tres hojas lobuladas, no tres cuadrados verdes.
    ...Array.from({ length: 3 }, (_, i) =>
      hoja({
        R: 0.062, lobulos: 5 + i, fase: i * 1.3, comba: 0.013, nseg: 44, nrad: 9,
        t: [0, base + 0.0282 + i * 0.0035, 0], rot: [0, (i * 115 - 40) * DEG, 0],
        material: M.lettuce,
        relief: [{ amp: 0.0062, freq: 32, seed: 41 + i * 5 }],
      }),
    ),
    cilindro({
      rTop: 0.047, rBottom: 0.047, height: 0.0062, canto: 0.0015, segments: 40,
      t: [0, base + 0.0375, 0], material: M.tomato,
      relief: [{ amp: 0.0006, freq: 120, octavas: 2, seed: 47 }],
    }),
    arcoToro({
      R: 0.038, r: 0.0042, segments: 44, rings: 12,
      rot: [90 * DEG, 0, 0], t: [0, base + 0.0435, 0], material: M.onion,
    }),
    // Pan de arriba: cupula.
    torno({
      profile: [
        [0, 0], [0.050, 0], [0.0555, 0.0035], [0.0555, 0.0035],
        [0.0545, 0.0115], [0.0512, 0.0205], [0.0432, 0.0288],
        [0.0312, 0.0348], [0.0164, 0.0382], [0, 0.0392],
      ],
      segments: 52, t: [0, base + 0.0465, 0], material: M.bun,
      relief: [{ amp: 0.0014, freq: 80, seed: 53 }],
    }),
    ...sesamo({ n: 13, centro: [0, base + 0.0505, 0], radio: 0.048, alto: 0.0355 }),
  ];
}

MODELS['provoleta-a-la-parrilla'] = [
  // Sarten de hierro: pared gruesa, labio marcado y mango conico.
  torno({
    profile: [
      [0, 0], [0.078, 0], [0.090, 0.0045], [0.0965, 0.013],
      [0.1, 0.028], [0.1, 0.028],
      [0.0952, 0.0296], [0.0952, 0.0296],
      [0.0912, 0.014], [0.0852, 0.0076], [0.070, 0.0063], [0, 0.0062],
    ],
    segments: 56, material: M.skillet,
    relief: [{ amp: 0.0006, freq: 180, octavas: 2, seed: 59 }],
  }),
  cilindro({
    rTop: 0.0085, rBottom: 0.0135, height: 0.082, canto: 0.004, segments: 24,
    rot: [0, 0, -90 * DEG], t: [0.138, 0.021, 0], material: M.skillet,
  }),
  // El queso derretido. El relieve de baja frecuencia es el derrame y el de
  // alta, las ampollas de la parrilla; la variacion de color, lo tostado.
  torno({
    profile: [
      [0, 0], [0.058, 0], [0.067, 0.0045], [0.0705, 0.0125], [0.0705, 0.0125],
      [0.0665, 0.0205], [0.0605, 0.0232], [0.0530, 0.0246], [0.0445, 0.0255],
      [0.0355, 0.0260], [0.0265, 0.0263], [0.0175, 0.0265], [0.0088, 0.0266], [0, 0.0266],
    ],
    segments: 56, t: [0, 0.0063, 0], material: M.provolone,
    relief: [
      { amp: 0.0055, freq: 29, seed: 61 },
      { amp: 0.0022, freq: 108, octavas: 2, seed: 67 },
    ],
  }),
  ...Array.from({ length: 16 }, (_, i) => {
    const a = az(i, 1, 310) * Math.PI * 2;
    const d = az(i, 2, 310) * 0.062;
    return box({
      size: [0.0042, 0.0009, 0.0032],
      t: [Math.cos(a) * d, 0.0335 + az(i, 3, 310) * 0.002, Math.sin(a) * d],
      rot: [0, a * 2, 0],
      material: M.herb,
    });
  }),
];

{
  // Bol hondo: el perfil sube por fuera, da la vuelta en el labio y baja por
  // dentro, asi que se ve la pared interna donde la ensalada no la tapa.
  MODELS['ensalada-mediterranea'] = [
    torno({
      profile: [
        [0, 0], [0.038, 0], [0.045, 0.003], [0.045, 0.003],
        [0.060, 0.019], [0.083, 0.044], [0.099, 0.067], [0.1035, 0.080], [0.1035, 0.080],
        [0.0985, 0.0808], [0.0985, 0.0808],
        [0.0935, 0.067], [0.0775, 0.044], [0.0545, 0.019], [0.038, 0.009], [0, 0.0082],
      ],
      segments: 56, material: M.plate,
    }),
    // Un monton de verde debajo: sin masa, la ensalada son cinco tomates
    // flotando. La cupula arranca por encima de la pared del bol —a esa altura
    // el radio interior es 0,081— asi que no la atraviesa, que es lo que pasaba
    // cuando las hojas salian por los costados.
    torno({
      profile: [
        [0, 0.048], [0.078, 0.048], [0.080, 0.054],
        [0.074, 0.068], [0.062, 0.080], [0.044, 0.090], [0.022, 0.096], [0, 0.098],
      ],
      segments: 56, material: M.lettuce,
      relief: [
        { amp: 0.009, freq: 26, seed: 601 },
        { amp: 0.003, freq: 90, octavas: 2, seed: 607 },
      ],
    }),
    // Y hojas sueltas encima, caidas hacia afuera.
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const d = 0.026 + az(i, 1, 520) * 0.024;
      return hoja({
        R: 0.036 + az(i, 2, 520) * 0.010,
        lobulos: 4 + (i % 3),
        fase: i * 0.9,
        comba: 0.012,
        nseg: 34,
        nrad: 8,
        t: [Math.cos(a) * d, 0.088 + az(i, 3, 520) * 0.014, Math.sin(a) * d],
        rot: [(18 + az(i, 4, 520) * 26) * DEG, a + 1.1, (az(i, 5, 520) - 0.5) * 40 * DEG],
        material: M.lettuce,
        relief: [{ amp: 0.0068, freq: 31, seed: 101 + i }],
      });
    }),
    ...Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + 0.9;
      return esfera({
        r: 0.0132, segments: 26, rings: 16,
        t: [Math.cos(a) * 0.044, 0.098 + az(i, 1, 530) * 0.006, Math.sin(a) * 0.044],
        material: M.tomato,
        relief: [{ amp: 0.0005, freq: 90, seed: 110 + i }],
      });
    }),
    ...Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + 2.4;
      return esfera({
        r: 1, s: [0.0072, 0.0072, 0.0105], segments: 20, rings: 14,
        t: [Math.cos(a) * 0.028, 0.100 + az(i, 1, 540) * 0.008, Math.sin(a) * 0.028],
        rot: [0, a + 0.7, 0], material: M.olive,
      });
    }),
    ...Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + 1.7;
      return box({
        size: [0.015, 0.014, 0.015],
        t: [Math.cos(a) * 0.020, 0.102 + az(i, 1, 550) * 0.009, Math.sin(a) * 0.020],
        rot: [(az(i, 2, 550) - 0.5) * 60 * DEG, az(i, 3, 550) * Math.PI, (az(i, 4, 550) - 0.5) * 60 * DEG],
        material: M.feta,
      });
    }),
    // Pluma de cebolla morada: un arco fino, que es exactamente su forma.
    ...Array.from({ length: 4 }, (_, i) => {
      const a = (i / 4) * Math.PI * 2 + 0.45;
      return arcoToro({
        R: 0.020, r: 0.0024, arco: 2.1, desde: 0.4, segments: 24, rings: 8,
        t: [Math.cos(a) * 0.036, 0.104 + az(i, 1, 560) * 0.005, Math.sin(a) * 0.036],
        rot: [74 * DEG, a, 0], material: M.onion,
      });
    }),
  ];
}

// Copa de Malbec: el perfil es el de una copa de verdad —suela, tallo, panza
// ancha y boca cerrada— y la pared tiene espesor, asi que al bajar por dentro
// se ve el cristal doble. Con `alphaMode` en BLEND, que es lo que faltaba.
MODELS['malbec-copa'] = [
  torno({
    profile: [
      [0, 0], [0.036, 0], [0.0395, 0.0018], [0.0395, 0.0018],
      [0.0365, 0.0046], [0.0215, 0.0078], [0.0105, 0.0135],
      [0.0078, 0.030], [0.0070, 0.052], [0.0098, 0.070],
      [0.0215, 0.0855], [0.0355, 0.1065], [0.0432, 0.1335], [0.0445, 0.158],
      [0.0408, 0.1815], [0.0376, 0.196], [0.0376, 0.196],
      [0.0368, 0.196], [0.0368, 0.196],
      [0.0398, 0.1815], [0.0433, 0.158], [0.0420, 0.1335], [0.0340, 0.1065],
      [0.0198, 0.0855], [0.0088, 0.0735], [0, 0.0715],
    ],
    segments: 64, material: M.glass,
  }),
  torno({
    profile: [
      [0, 0.0718], [0.0090, 0.0738], [0.0200, 0.0858], [0.0342, 0.1068],
      [0.0404, 0.1245], [0.0412, 0.1285], [0, 0.1285],
    ],
    segments: 64, material: M.wine,
  }),
];

{
  const y = ALTO_PLATO;
  MODELS['flan-casero'] = [
    plato({ R: 0.105 }),
    // El charco de caramelo: un disco finito con el borde comido por el ruido.
    torno({
      profile: [[0, 0], [0.068, 0], [0.0705, 0.0012], [0.0685, 0.0024], [0, 0.0022]],
      segments: 56, t: [0, y, 0], material: M.caramel,
      relief: [{ amp: 0.0022, freq: 26, seed: 71 }],
    }),
    // El flan: cono truncado con el canto de arriba redondeado y la cara
    // ligeramente hundida, que es como sale del molde.
    torno({
      profile: [
        [0, 0], [0.0405, 0], [0.0442, 0.0022], [0.0442, 0.0022],
        [0.0408, 0.0125], [0.0352, 0.0262], [0.0322, 0.0345],
        [0.0300, 0.0392], [0.0252, 0.0418], [0.0150, 0.0428], [0, 0.0424],
      ],
      segments: 56, t: [0, y + 0.0018, 0], material: M.custard,
      relief: [{ amp: 0.0008, freq: 48, seed: 73 }],
    }),
    torno({
      profile: [[0, 0], [0.0255, 0.0004], [0.0300, 0.0026], [0.0286, 0.0040], [0.0145, 0.0048], [0, 0.0046]],
      segments: 48, t: [0, y + 0.0412, 0], material: M.caramel,
      relief: [{ amp: 0.0009, freq: 55, seed: 79 }],
    }),
    // Dos hilos de caramelo cayendo por el costado.
    ...Array.from({ length: 3 }, (_, i) => {
      const a = (i / 3) * Math.PI * 2 + 0.8;
      return esfera({
        r: 1, s: [0.0035, 0.016, 0.0035], segments: 14, rings: 12,
        t: [Math.cos(a) * 0.0345, y + 0.030, Math.sin(a) * 0.0345],
        rot: [0, a, 7 * DEG], material: M.caramel,
      });
    }),
    // Una cucharada de nata al costado.
    esfera({
      r: 1, s: [0.0265, 0.0155, 0.0185], segments: 30, rings: 20,
      t: [0.058, y + 0.0135, 0.024], rot: [0, 34 * DEG, 0], material: M.cream,
      relief: [{ amp: 0.0016, freq: 70, seed: 83 }],
    }),
  ];
}

{
  const y = ALTO_PLATO;
  // El repulgue es lo que hace que una elipsoide dorada sea una empanada: una
  // fila de pliegues sobre el borde, cada uno girado para seguir la curva.
  const empanada = (i, angulo) => {
    const fuera = { rot: [0, angulo, 0], t: [Math.cos(angulo) * 0.050, y, Math.sin(angulo) * 0.050] };
    const cuerpo = esfera({
      r: 1, s: [0.050, 0.0215, 0.033], segments: 40, rings: 24,
      t: [0, 0.0175, 0], fuera, material: M.dough,
      relief: [
        { amp: 0.0028, freq: 34, seed: 201 + i * 7 },
        { amp: 0.0009, freq: 150, octavas: 2, seed: 211 + i * 7 },
      ],
    });
    const pliegues = Array.from({ length: 11 }, (_, k) => {
      const th = (18 + (k / 10) * 144) * DEG;
      return esfera({
        r: 1, s: [0.0042, 0.0062, 0.0088], segments: 10, rings: 8,
        t: [Math.cos(th) * 0.0475, 0.0175, Math.sin(th) * 0.0315 + 0.0035],
        rot: [0, -th + Math.PI / 2, (k % 2 ? 1 : -1) * 16 * DEG],
        fuera, material: M.dough,
        relief: [{ amp: 0.0006, freq: 170, octavas: 2, seed: 221 + k }],
      });
    });
    return [cuerpo, ...pliegues];
  };
  MODELS['empanadas-carne'] = [
    plato({ R: 0.135 }),
    ...empanada(0, 0.35),
    ...empanada(1, 0.35 + (Math.PI * 2) / 3),
    ...empanada(2, 0.35 + (Math.PI * 4) / 3),
  ];
}

{
  const y = ALTO_PLATO;
  MODELS['cafe-cortado'] = [
    plato({ R: 0.075 }),
    // Taza con espesor de pared: por dentro se ve el borde, no una tapa.
    torno({
      profile: [
        [0, 0], [0.0215, 0], [0.0255, 0.0028], [0.0255, 0.0028],
        [0.0292, 0.012], [0.0338, 0.030], [0.0352, 0.0468], [0.0352, 0.0468],
        [0.0330, 0.0474], [0.0330, 0.0474],
        [0.0318, 0.030], [0.0270, 0.012], [0.0210, 0.0042], [0, 0.0038],
      ],
      segments: 52, t: [0, y, 0], material: M.plate,
    }),
    arcoToro({
      R: 0.0175, r: 0.0036, arco: 250 * DEG, desde: -125 * DEG, segments: 36, rings: 14,
      t: [0.0315, y + 0.028, 0], material: M.plate,
    }),
    // El liquido sigue la pared interna de la taza: un cilindro recto la
    // atravesaba y se veia un anillo negro por fuera.
    torno({
      profile: [[0, 0.013], [0.0268, 0.013], [0.0316, 0.030], [0.0328, 0.0425], [0, 0.0425]],
      segments: 48, t: [0, y, 0], material: M.coffee,
    }),
    // La capa de leche, con su remolino.
    torno({
      profile: [[0, 0], [0.0300, 0.0004], [0.0314, 0.0016], [0.0296, 0.0026], [0.0148, 0.0032], [0, 0.0030]],
      segments: 48, t: [0, y + 0.0422, 0], material: M.crema,
      relief: [{ amp: 0.0011, freq: 95, seed: 89 }],
    }),
    // Dos terrones de azucar sobre el ala del plato.
    ...Array.from({ length: 2 }, (_, i) =>
      box({
        size: [0.0105, 0.008, 0.0105],
        t: [-0.0405 + i * 0.0015, y + 0.0092 + i * 0.008, 0.0285 + i * 0.0018],
        rot: [0, (12 + i * 28) * DEG, 0],
        material: M.sugar,
      }),
    ),
  ];
}

/* --------------------------------------------------- comprobacion de caras */

/**
 * Volumen con signo de una malla cerrada.
 *
 * La suma de v0 . (v1 x v2) / 6 sobre todos sus triangulos da el volumen que
 * encierra, con signo **positivo si las caras miran para afuera** y negativo si
 * miran para adentro.
 *
 * Esto esta aca porque el error existio: el cilindro y la esfera estuvieron
 * devanados al reves, y como el motor descarta las caras traseras, lo que se
 * veia era el interior de la pieza —la copa de Malbec mostraba su cara interna
 * y la milanesa parecia un cuenco—. En el codigo no se nota: un indice en otro
 * orden. En pantalla tampoco, si uno no sabe que mirar. Asi se nota al generar.
 */
function volumenConSigno({ positions, indices }) {
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const cx = positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1];
    const cy = positions[b + 2] * positions[c] - positions[b] * positions[c + 2];
    const cz = positions[b] * positions[c + 1] - positions[b + 1] * positions[c];
    v += positions[a] * cx + positions[a + 1] * cy + positions[a + 2] * cz;
  }
  return v / 6;
}

/** Las laminas y las hojas son abiertas: se declaran `doubleSided` y no aplica. */
function revisarCaras(nombre, pieces) {
  const mal = pieces.filter(
    (p) => !p.material.doubleSided && volumenConSigno(p) <= 0,
  );
  if (mal.length > 0) {
    const cuales = [...new Set(mal.map((p) => p.material.name))].join(', ');
    throw new Error(
      `${nombre}: ${mal.length} pieza(s) con las caras para adentro (${cuales}). ` +
        'Se veria el interior del objeto. Revisa el orden de los indices.',
    );
  }
}

/* --------------------------------------------------------------------- main */

await mkdir(outDir, { recursive: true });

let total = 0;
for (const [name, pieces] of Object.entries(MODELS)) {
  revisarCaras(name, pieces);
  const glb = buildGlb(pieces, { name });
  await writeFile(join(outDir, `${name}.glb`), glb);
  total += glb.byteLength;
  const vertices = pieces.reduce((a, p) => a + p.positions.length / 3, 0);
  console.log(
    `  ${name}.glb  ${(glb.byteLength / 1024).toFixed(1)} KB  ` +
      `(${pieces.length} piezas, ${vertices.toLocaleString('es-AR')} vertices)`,
  );
}

console.log(
  `\n${Object.keys(MODELS).length} modelos escritos en ${outDir} ` +
    `(${(total / 1024).toFixed(1)} KB en total)`,
);
