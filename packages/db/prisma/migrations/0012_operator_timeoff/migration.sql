-- CreateEnum
CREATE TYPE "TimeOffStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

-- CreateTable
CREATE TABLE "OperatorTimeOff" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "TimeOffStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatorTimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperatorTimeOff_date_idx" ON "OperatorTimeOff"("date");

-- CreateIndex
CREATE INDEX "OperatorTimeOff_operatorId_date_idx" ON "OperatorTimeOff"("operatorId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorTimeOff_operatorId_date_key" ON "OperatorTimeOff"("operatorId", "date");

-- AddForeignKey
ALTER TABLE "OperatorTimeOff" ADD CONSTRAINT "OperatorTimeOff_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
