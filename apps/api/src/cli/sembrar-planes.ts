/**
 * Aplica solo el catalogo de planes, sin datos de demostracion.
 *
 *   npm run db:plans        # desde el fuente, con tsx
 *   npm run db:plans:prod   # desde dist, que es lo que hay en la imagen
 *
 * Es lo que corre un despliegue despues de las migraciones, y lo que corre la
 * integracion continua antes de las pruebas.
 */
import { PrismaClient } from '@prisma/client';

import { sembrarPlanes } from '../modules/plans/catalogo.js';

const prisma = new PrismaClient();

sembrarPlanes(prisma)
  .then((cantidad) => {
    console.log(`Planes aplicados: ${cantidad}`);
  })
  .catch((error) => {
    console.error('\nFallo el catalogo de planes:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
