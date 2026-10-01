/**
 * Tareas periodicas de mantenimiento.
 *
 * Son dos barridos baratos que, si no corren, dejan el sistema mintiendo:
 * suscripciones que dicen "en gracia" cuando la gracia vencio hace una semana,
 * y enlaces de recuperacion vencidos acumulandose para siempre.
 *
 * Va con `setInterval` y no con un planificador aparte porque es lo que
 * corresponde al tamaño del problema: dos consultas por hora. Si se corren
 * varias instancias de la API, las dos tareas son idempotentes —un
 * `updateMany` y un `deleteMany` sobre filas que ya cumplen la condicion— asi
 * que correrlas de mas no hace daño. Cuando haga falta un planificador de
 * verdad (reintentos, bitacora, tareas que no toleren repetirse), esto se
 * reemplaza sin tocar nada mas.
 */
import type { FastifyInstance } from 'fastify';

import { limpiarTokensVencidos } from '../auth/password-reset.js';
import { suspenderVencidas } from './service.js';

/** Una hora: la gracia se mide en dias, no hace falta mirar mas seguido. */
const CADA_MS = 60 * 60_000;

export function iniciarTareas(app: FastifyInstance): void {
  async function pasada(): Promise<void> {
    try {
      const suspendidas = await suspenderVencidas();
      if (suspendidas > 0) {
        app.log.info({ suspendidas }, 'suscripciones suspendidas por impago');
      }
      const tokens = await limpiarTokensVencidos();
      if (tokens > 0) app.log.info({ tokens }, 'tokens de recuperacion vencidos borrados');
    } catch (error) {
      // Que falle una pasada no puede tumbar la API: se reintenta en la
      // siguiente, dentro de una hora.
      app.log.error({ err: error }, 'fallo una pasada de mantenimiento');
    }
  }

  const timer = setInterval(() => void pasada(), CADA_MS);
  // `unref` para que el temporizador no impida que el proceso termine: sin
  // esto, las pruebas quedan colgadas una hora esperando al reloj.
  timer.unref();

  // Una pasada al arrancar: si la API estuvo caida un dia, lo primero que hace
  // al volver es ponerse al dia.
  void pasada();

  app.addHook('onClose', () => {
    clearInterval(timer);
  });
}
