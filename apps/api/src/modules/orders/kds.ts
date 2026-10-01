/**
 * Bus en memoria que empuja los cambios de pedido al KDS por SSE.
 *
 * En memoria alcanza mientras la API corra en un solo proceso. Con varias
 * instancias hay que reemplazarlo por Redis pub/sub: el resto del codigo no
 * cambia porque solo conoce `publish` y `subscribe`.
 */
import { EventEmitter } from 'node:events';

import type { OrderDto } from '@men3d/shared';

export type KdsEvent =
  | { type: 'order.created'; order: OrderDto }
  | { type: 'order.updated'; order: OrderDto };

class KdsHub {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Un tenant con muchas pantallas de cocina abiertas no deberia disparar la
    // advertencia de "possible memory leak" de Node.
    this.emitter.setMaxListeners(100);
  }

  publish(tenantId: string, event: KdsEvent): void {
    this.emitter.emit(tenantId, event);
  }

  /** Devuelve la funcion para darse de baja. */
  subscribe(tenantId: string, listener: (event: KdsEvent) => void): () => void {
    this.emitter.on(tenantId, listener);
    return () => this.emitter.off(tenantId, listener);
  }
}

export const kdsHub = new KdsHub();
