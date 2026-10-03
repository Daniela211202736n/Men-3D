-- CreateTable
CREATE TABLE "RevocationRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "reference" TEXT,
    "detail" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevocationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevocationRequest_code_key" ON "RevocationRequest"("code");

-- CreateIndex
CREATE INDEX "RevocationRequest_createdAt_idx" ON "RevocationRequest"("createdAt");
