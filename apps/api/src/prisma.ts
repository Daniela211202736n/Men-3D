import { PrismaClient } from '@prisma/client';

import { env, isProduction } from './env.js';

/**
 * Cliente unico. En desarrollo se guarda en `globalThis` para que el recarga
 * en caliente de tsx no abra una conexion nueva por cada archivo tocado.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!isProduction) globalForPrisma.prisma = prisma;

export type { PrismaClient };
export { env };
