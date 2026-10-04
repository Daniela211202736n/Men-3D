-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN     "variant" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "variant" TEXT;

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "valueB" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "winner" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Experiment_tenantId_status_idx" ON "Experiment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Experiment_dishId_idx" ON "Experiment"("dishId");

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE CASCADE ON UPDATE CASCADE;
