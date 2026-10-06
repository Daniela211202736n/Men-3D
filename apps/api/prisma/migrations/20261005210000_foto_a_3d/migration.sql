-- Trabajos de "foto a 3D".
CREATE TABLE "ModelJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "providerTaskId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "photoUrl" TEXT,
    "glbUrl" TEXT,
    "error" TEXT,
    "credits" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ModelJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModelJob_tenantId_status_idx" ON "ModelJob"("tenantId", "status");
CREATE INDEX "ModelJob_dishId_createdAt_idx" ON "ModelJob"("dishId", "createdAt");

ALTER TABLE "ModelJob" ADD CONSTRAINT "ModelJob_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelJob" ADD CONSTRAINT "ModelJob_dishId_fkey"
  FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un plato puede tener UN trabajo en curso a la vez.
--
-- Va a mano porque es un indice unico PARCIAL y Prisma no sabe expresarlos: un
-- `@@unique([dishId, status])` tambien impediria conservar el historial de
-- trabajos terminados sobre el mismo plato, que es justo lo que uno quiere
-- guardar.
--
-- Aca ademas es un guard de plata. Cada trabajo consume creditos del proveedor,
-- que se pagan de verdad: sin esto, dos toques seguidos en el boton —o una
-- pestania duplicada— generan dos modelos del mismo plato y cobran dos veces.
-- El segundo intento tiene que rebotar contra la base, no contra un `if` que
-- pierde la carrera.
CREATE UNIQUE INDEX "ModelJob_uno_en_curso_por_plato"
  ON "ModelJob" ("dishId")
  WHERE "status" IN ('QUEUED', 'RUNNING');
