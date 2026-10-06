/**
 * Proveedor simulado, para desarrollo y para las pruebas de navegador.
 *
 * Existe por lo mismo que `PAYMENTS_PROVIDER=mock` y `MAIL_DRIVER=log`: el
 * recorrido completo —sacar la foto, esperar, ver el modelo colgado del plato—
 * tiene que poder ejercitarse sin contratar nada y sin gastar un centavo. Sin
 * esto, la unica forma de probar la pantalla seria con una clave de verdad, y
 * lo que no se puede probar gratis no se prueba.
 *
 * **Devuelve un cubo, y es a proposito.** Seria facil hacer que entregara uno
 * de los platos de ejemplo y que la demo se viera linda, pero entonces nadie
 * distinguiria un modelo generado de verdad de uno simulado —ni en una captura,
 * ni en una demostracion a un cliente—. Un cubo gris no se confunde con nada.
 *
 * Tarda unos segundos a proposito: la pantalla tiene una barra de progreso y un
 * estado "en curso", y si todo terminara al instante esos dos caminos no se
 * ejercitarian nunca.
 */
import type { EstadoRemoto, FotoDelPlato, ProveedorDe3D } from './proveedor.js';

/** Lo que tarda el trabajo simulado. Suficiente para ver la barra moverse. */
const DURACION_MS = 6000;

/** Un cubo de 10 cm, en GLB valido escrito a mano. */
function cuboGlb(): Buffer {
  const lado = 0.05;
  const caras: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];

  const posiciones: number[] = [];
  const normales: number[] = [];
  const indices: number[] = [];
  caras.forEach((cara, i) => {
    for (const vertice of cara.v) {
      posiciones.push(vertice[0] * lado, vertice[1] * lado + lado, vertice[2] * lado);
      normales.push(...cara.n);
    }
    const o = i * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });

  const pad4 = (n: number): number => (4 - (n % 4)) % 4;
  const pos = Buffer.from(new Float32Array(posiciones).buffer);
  const nrm = Buffer.from(new Float32Array(normales).buffer);
  const idx = Buffer.from(new Uint16Array(indices).buffer);
  const bin = Buffer.concat([pos, nrm, idx, Buffer.alloc(pad4(idx.byteLength))]);

  const gltf = {
    asset: { version: '2.0', generator: 'men3d-mock' },
    scene: 0,
    scenes: [{ nodes: [0], name: 'modelo simulado' }],
    nodes: [{ mesh: 0, name: 'modelo simulado' }],
    meshes: [
      {
        name: 'cubo',
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 },
        ],
      },
    ],
    materials: [
      {
        name: 'simulado',
        pbrMetallicRoughness: {
          baseColorFactor: [0.55, 0.55, 0.57, 1],
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: posiciones.length / 3,
        type: 'VEC3',
        min: [-lado, 0, -lado],
        max: [lado, lado * 2, lado],
      },
      { bufferView: 1, componentType: 5126, count: normales.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nrm.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: pos.byteLength + nrm.byteLength,
        byteLength: idx.byteLength,
        target: 34963,
      },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };

  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = Buffer.concat([json, Buffer.alloc(pad4(json.byteLength), 0x20)]);

  const cabecera = Buffer.alloc(12);
  cabecera.write('glTF', 0, 'ascii');
  cabecera.writeUInt32LE(2, 4);
  cabecera.writeUInt32LE(12 + 8 + jsonPad.byteLength + 8 + bin.byteLength, 8);

  const cabJson = Buffer.alloc(8);
  cabJson.writeUInt32LE(jsonPad.byteLength, 0);
  cabJson.writeUInt32LE(0x4e4f534a, 4);

  const cabBin = Buffer.alloc(8);
  cabBin.writeUInt32LE(bin.byteLength, 0);
  cabBin.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([cabecera, cabJson, jsonPad, cabBin, bin]);
}

export class MockProvider implements ProveedorDe3D {
  readonly nombre = 'mock';
  /** Cuando arranco cada trabajo, para simular el progreso. */
  private readonly arranques = new Map<string, number>();
  private contador = 0;

  async crear(fotos: FotoDelPlato[]): Promise<string> {
    if (!fotos[0] || fotos[0].bytes.byteLength === 0) {
      throw new Error('No se recibio ninguna foto');
    }
    this.contador += 1;
    const id = `mock-${Date.now()}-${this.contador}`;
    this.arranques.set(id, Date.now());
    return id;
  }

  async consultar(taskId: string): Promise<EstadoRemoto> {
    const desde = this.arranques.get(taskId);
    // Un trabajo que el proceso no recuerda —se reinicio la API— se da por
    // listo en vez de quedar colgado: es un simulador, no tiene que ser cruel.
    if (desde === undefined) {
      return { estado: 'READY', progreso: 100, glbUrl: 'mock://cubo.glb', creditos: 0 };
    }
    const pasado = Date.now() - desde;
    if (pasado < DURACION_MS) {
      return { estado: 'RUNNING', progreso: Math.round((pasado / DURACION_MS) * 100) };
    }
    return { estado: 'READY', progreso: 100, glbUrl: 'mock://cubo.glb', creditos: 0 };
  }

  async bajar(): Promise<Buffer> {
    return cuboGlb();
  }

  async comprobar(): Promise<{ ok: boolean; detalle: string }> {
    return {
      ok: true,
      detalle: 'proveedor SIMULADO: genera un cubo, no sirve para produccion',
    };
  }
}
