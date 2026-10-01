/**
 * Genera los modelos 3D de ejemplo (GLB) que usa la carta de demostracion.
 *
 * Son GLB validos escritos a mano: un plato de verdad se escanea o se modela,
 * pero para que `npm run setup` deje el visor 3D y la RA funcionando sin bajar
 * assets de ningun lado, alcanza con geometria primitiva bien proporcionada.
 *
 * Formato (glTF 2.0 binario): cabecera de 12 bytes + chunk JSON + chunk BIN,
 * cada uno alineado a 4 bytes. Especificacion:
 * https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-gltf-layout
 *
 * Uso: node scripts/generate-sample-models.mjs [directorio-destino]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, '../apps/web/public/models'));

/* ---------------------------------------------------------------- geometria */

/** Una pieza de geometria con su material; las coordenadas ya vienen en mundo. */
const piece = (positions, normals, indices, material) => ({
  positions,
  normals,
  indices,
  material,
});

function transformPoint([x, y, z], { t = [0, 0, 0], s = [1, 1, 1] }) {
  return [x * s[0] + t[0], y * s[1] + t[1], z * s[2] + t[2]];
}

/** Caja con normales planas (24 vertices: cada cara con su propia normal). */
function box({ size = [1, 1, 1], t = [0, 0, 0], material }) {
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
      positions.push(...transformPoint(vertex, { t }));
      normals.push(...face.n);
    });
    const o = fi * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return piece(positions, normals, indices, material);
}

/** Cilindro/cono truncado con tapas. `rTop === 0` da un cono. */
function cylinder({
  rTop = 1,
  rBottom = 1,
  height = 1,
  segments = 28,
  t = [0, 0, 0],
  material,
}) {
  const positions = [];
  const normals = [];
  const indices = [];
  const hh = height / 2;

  // Pared lateral.
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Normal inclinada segun la pendiente de la pared.
    const slope = (rBottom - rTop) / height;
    const len = Math.hypot(1, slope);
    positions.push(...transformPoint([cos * rTop, hh, sin * rTop], { t }));
    normals.push(cos / len, slope / len, sin / len);
    positions.push(...transformPoint([cos * rBottom, -hh, sin * rBottom], { t }));
    normals.push(cos / len, slope / len, sin / len);
  }
  for (let i = 0; i < segments; i += 1) {
    const o = i * 2;
    indices.push(o, o + 1, o + 3, o, o + 3, o + 2);
  }

  // Tapas (centro + abanico).
  for (const [y, r, ny] of [
    [hh, rTop, 1],
    [-hh, rBottom, -1],
  ]) {
    if (r <= 0) continue;
    const center = positions.length / 3;
    positions.push(...transformPoint([0, y, 0], { t }));
    normals.push(0, ny, 0);
    for (let i = 0; i <= segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(
        ...transformPoint([Math.cos(a) * r, y, Math.sin(a) * r], { t }),
      );
      normals.push(0, ny, 0);
    }
    for (let i = 0; i < segments; i += 1) {
      if (ny > 0) indices.push(center, center + i + 1, center + i + 2);
      else indices.push(center, center + i + 2, center + i + 1);
    }
  }
  return piece(positions, normals, indices, material);
}

/** Esfera escalable: con `s` distinto en cada eje da un elipsoide. */
function sphere({ r = 1, segments = 24, rings = 16, t = [0, 0, 0], s = [1, 1, 1], material }) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    for (let seg = 0; seg <= segments; seg += 1) {
      const theta = (seg / segments) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      positions.push(...transformPoint([nx * r, ny * r, nz * r], { t, s }));
      // La normal de un elipsoide escala con el inverso de la escala.
      const inv = [1 / s[0], 1 / s[1], 1 / s[2]];
      const len = Math.hypot(nx * inv[0], ny * inv[1], nz * inv[2]) || 1;
      normals.push((nx * inv[0]) / len, (ny * inv[1]) / len, (nz * inv[2]) / len);
    }
  }
  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let seg = 0; seg < segments; seg += 1) {
      const a = ring * stride + seg;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  return piece(positions, normals, indices, material);
}

/* ---------------------------------------------------------------- empaque GLB */

const pad4 = (n) => (4 - (n % 4)) % 4;

function buildGlb(pieces, { name }) {
  const materials = [];
  const materialIndex = new Map();
  for (const p of pieces) {
    const key = JSON.stringify(p.material);
    if (!materialIndex.has(key)) {
      materialIndex.set(key, materials.length);
      materials.push({
        name: p.material.name,
        doubleSided: false,
        pbrMetallicRoughness: {
          baseColorFactor: p.material.color,
          metallicFactor: p.material.metallic ?? 0.0,
          roughnessFactor: p.material.roughness ?? 0.6,
        },
      });
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
    const posData = Buffer.from(new Float32Array(p.positions).buffer);
    const nrmData = Buffer.from(new Float32Array(p.normals).buffer);
    const idxData = Buffer.from(new Uint32Array(p.indices).buffer);

    const posView = pushView(posData, 34962);
    const nrmView = pushView(nrmData, 34962);
    const idxView = pushView(idxData, 34963);

    const { min, max } = minMax(p.positions, 3);
    accessors.push({
      bufferView: posView,
      componentType: 5126, // FLOAT
      count: p.positions.length / 3,
      type: 'VEC3',
      min,
      max,
    });
    accessors.push({
      bufferView: nrmView,
      componentType: 5126,
      count: p.normals.length / 3,
      type: 'VEC3',
    });
    accessors.push({
      bufferView: idxView,
      componentType: 5125, // UNSIGNED_INT
      count: p.indices.length,
      type: 'SCALAR',
    });

    primitives.push({
      attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 },
      indices: accessors.length - 1,
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

/* -------------------------------------------------------------- materiales */

const M = {
  plate: { name: 'porcelana', color: [0.95, 0.95, 0.93, 1], roughness: 0.25 },
  skillet: { name: 'hierro', color: [0.16, 0.15, 0.14, 1], metallic: 0.6, roughness: 0.5 },
  breaded: { name: 'pan rallado', color: [0.78, 0.52, 0.22, 1], roughness: 0.85 },
  meat: { name: 'carne', color: [0.42, 0.18, 0.14, 1], roughness: 0.7 },
  cheese: { name: 'queso', color: [0.96, 0.82, 0.38, 1], roughness: 0.55 },
  bun: { name: 'pan', color: [0.75, 0.52, 0.28, 1], roughness: 0.8 },
  lettuce: { name: 'verde', color: [0.3, 0.55, 0.22, 1], roughness: 0.65 },
  tomato: { name: 'tomate', color: [0.74, 0.16, 0.12, 1], roughness: 0.45 },
  potato: { name: 'papa', color: [0.9, 0.72, 0.3, 1], roughness: 0.8 },
  lemon: { name: 'limon', color: [0.93, 0.85, 0.25, 1], roughness: 0.5 },
  glass: { name: 'vidrio', color: [0.86, 0.9, 0.92, 0.45], roughness: 0.08 },
  wine: { name: 'vino', color: [0.35, 0.05, 0.12, 1], roughness: 0.2 },
  caramel: { name: 'caramelo', color: [0.45, 0.24, 0.08, 1], roughness: 0.3 },
  custard: { name: 'flan', color: [0.95, 0.85, 0.6, 1], roughness: 0.4 },
  dough: { name: 'masa', color: [0.85, 0.68, 0.42, 1], roughness: 0.8 },
  coffee: { name: 'cafe', color: [0.18, 0.09, 0.05, 1], roughness: 0.25 },
  cream: { name: 'crema', color: [0.97, 0.93, 0.85, 1], roughness: 0.5 },
};

/** Plato base reutilizable (en metros: un plato de 26 cm). */
const plate = (r = 0.13) => [
  cylinder({ rTop: r, rBottom: r * 0.72, height: 0.018, t: [0, 0.009, 0], material: M.plate }),
];

/* ------------------------------------------------------------------ modelos */

const MODELS = {
  'milanesa-napolitana': [
    ...plate(0.14),
    // Milanesa: elipsoide muy achatado.
    sphere({ r: 1, s: [0.105, 0.016, 0.075], t: [-0.015, 0.034, 0], material: M.breaded }),
    // Salsa y queso gratinado encima.
    sphere({ r: 1, s: [0.08, 0.009, 0.055], t: [-0.015, 0.047, 0], material: M.tomato }),
    sphere({ r: 1, s: [0.07, 0.008, 0.047], t: [-0.015, 0.053, 0], material: M.cheese }),
    // Guarnicion de papas bastón.
    ...Array.from({ length: 7 }, (_, i) =>
      box({
        size: [0.012, 0.012, 0.075],
        t: [0.075 + (i % 3) * 0.014, 0.026 + Math.floor(i / 3) * 0.013, -0.03 + (i % 4) * 0.018],
        material: M.potato,
      }),
    ),
    cylinder({ rTop: 0.022, rBottom: 0.022, height: 0.012, t: [0.02, 0.025, 0.085], material: M.lemon }),
  ],

  'hamburguesa-clasica': [
    ...plate(0.13),
    cylinder({ rTop: 0.052, rBottom: 0.05, height: 0.022, t: [0, 0.03, 0], material: M.bun }),
    cylinder({ rTop: 0.055, rBottom: 0.055, height: 0.02, t: [0, 0.051, 0], material: M.meat }),
    box({ size: [0.1, 0.004, 0.1], t: [0, 0.064, 0], material: M.cheese }),
    sphere({ r: 1, s: [0.055, 0.006, 0.055], t: [0, 0.072, 0], material: M.lettuce }),
    cylinder({ rTop: 0.046, rBottom: 0.05, height: 0.008, t: [0, 0.08, 0], material: M.tomato }),
    // Pan superior: media esfera.
    sphere({ r: 1, s: [0.053, 0.038, 0.053], t: [0, 0.086, 0], rings: 12, material: M.bun }),
  ],

  'provoleta-a-la-parrilla': [
    cylinder({ rTop: 0.1, rBottom: 0.095, height: 0.02, t: [0, 0.01, 0], material: M.skillet }),
    cylinder({ rTop: 0.082, rBottom: 0.085, height: 0.022, t: [0, 0.031, 0], material: M.cheese }),
    sphere({ r: 1, s: [0.078, 0.006, 0.078], t: [0, 0.043, 0], material: M.lettuce }),
  ],

  'ensalada-mediterranea': [
    cylinder({ rTop: 0.115, rBottom: 0.07, height: 0.055, t: [0, 0.028, 0], material: M.plate }),
    ...Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2;
      return sphere({
        r: 1,
        s: [0.035, 0.014, 0.035],
        t: [Math.cos(a) * 0.045, 0.055 + (i % 3) * 0.012, Math.sin(a) * 0.045],
        rings: 10,
        segments: 14,
        material: M.lettuce,
      });
    }),
    ...Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      return sphere({
        r: 0.016,
        t: [Math.cos(a) * 0.05, 0.078, Math.sin(a) * 0.05],
        rings: 12,
        segments: 16,
        material: M.tomato,
      });
    }),
    ...Array.from({ length: 4 }, (_, i) =>
      box({
        size: [0.018, 0.018, 0.018],
        t: [-0.02 + i * 0.016, 0.082, 0.01 - i * 0.012],
        material: M.cheese,
      }),
    ),
  ],

  'malbec-copa': [
    // Base, tallo y caliz de la copa.
    cylinder({ rTop: 0.035, rBottom: 0.038, height: 0.006, t: [0, 0.003, 0], material: M.glass }),
    cylinder({ rTop: 0.006, rBottom: 0.007, height: 0.07, t: [0, 0.041, 0], material: M.glass }),
    cylinder({ rTop: 0.042, rBottom: 0.012, height: 0.085, t: [0, 0.118, 0], material: M.glass }),
    cylinder({ rTop: 0.034, rBottom: 0.013, height: 0.042, t: [0, 0.098, 0], material: M.wine }),
  ],

  'flan-casero': [
    ...plate(0.1),
    cylinder({ rTop: 0.042, rBottom: 0.055, height: 0.038, t: [0, 0.037, 0], material: M.custard }),
    cylinder({ rTop: 0.044, rBottom: 0.044, height: 0.004, t: [0, 0.058, 0], material: M.caramel }),
    sphere({ r: 1, s: [0.026, 0.02, 0.026], t: [0.055, 0.03, 0.02], rings: 12, material: M.cream }),
  ],

  'empanadas-carne': [
    ...plate(0.13),
    ...Array.from({ length: 3 }, (_, i) => {
      const a = (i / 3) * Math.PI * 2;
      return sphere({
        r: 1,
        s: [0.052, 0.019, 0.032],
        t: [Math.cos(a) * 0.05, 0.036, Math.sin(a) * 0.05],
        rings: 14,
        material: M.dough,
      });
    }),
  ],

  'cafe-cortado': [
    cylinder({ rTop: 0.07, rBottom: 0.05, height: 0.01, t: [0, 0.005, 0], material: M.plate }),
    cylinder({ rTop: 0.036, rBottom: 0.028, height: 0.055, t: [0, 0.038, 0], material: M.plate }),
    cylinder({ rTop: 0.032, rBottom: 0.026, height: 0.006, t: [0, 0.06, 0], material: M.coffee }),
    sphere({ r: 1, s: [0.03, 0.004, 0.03], t: [0, 0.064, 0], rings: 10, material: M.cream }),
  ],
};

/* --------------------------------------------------------------------- main */

await mkdir(outDir, { recursive: true });

let total = 0;
for (const [name, pieces] of Object.entries(MODELS)) {
  const glb = buildGlb(pieces, { name });
  await writeFile(join(outDir, `${name}.glb`), glb);
  total += glb.byteLength;
  console.log(
    `  ${name}.glb  ${(glb.byteLength / 1024).toFixed(1)} KB  ` +
      `(${pieces.length} piezas)`,
  );
}

console.log(
  `\n${Object.keys(MODELS).length} modelos escritos en ${outDir} ` +
    `(${(total / 1024).toFixed(1)} KB en total)`,
);
