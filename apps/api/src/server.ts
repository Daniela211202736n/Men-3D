import { buildApp } from './app.js';
import { env } from './env.js';
import { prisma } from './prisma.js';

const app = await buildApp();

/** Cierre ordenado: deja de aceptar conexiones y recien despues suelta la base. */
async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} recibido, cerrando...`);
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'fallo el cierre ordenado');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Men-3D API escuchando en http://localhost:${env.PORT}`);
} catch (error) {
  app.log.error({ err: error }, 'no se pudo iniciar el servidor');
  process.exit(1);
}
