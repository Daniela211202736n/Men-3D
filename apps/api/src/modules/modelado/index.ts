import { env } from '../../env.js';
import { MeshyProvider } from './meshy.js';
import { MockProvider } from './mock.js';
import { SinProveedor, type ProveedorDe3D } from './proveedor.js';

let instancia: ProveedorDe3D | null = null;

/** El proveedor configurado. Se construye una sola vez. */
export function getProveedor3D(): ProveedorDe3D {
  if (!instancia) {
    if (env.MODEL3D_PROVIDER === 'meshy' && env.MESHY_API_KEY) {
      instancia = new MeshyProvider(env.MESHY_API_KEY);
    } else if (env.MODEL3D_PROVIDER === 'mock') {
      instancia = new MockProvider();
    } else {
      instancia = new SinProveedor();
    }
  }
  return instancia;
}

/**
 * Si esta instalacion puede convertir una foto en un modelo.
 *
 * Se pregunta por el proveedor construido y no por la variable de entorno:
 * asi hay una sola fuente de verdad, y las pruebas que enchufan un proveedor
 * simulado ejercitan el mismo camino que la produccion.
 */
export function modelado3dDisponible(): boolean {
  return getProveedor3D().nombre !== 'none';
}

/** Solo para las pruebas: cambia el proveedor por uno simulado. */
export function setProveedor3D(proveedor: ProveedorDe3D | null): void {
  instancia = proveedor;
}

export * from './proveedor.js';
