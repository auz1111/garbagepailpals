-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('ASSIGNED', 'ACCEPTED');

-- CreateTable
CREATE TABLE "DailyRoute" (
    "id" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "operatorId" TEXT NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'ASSIGNED',
    "label" TEXT,
    "neighborhoodId" TEXT,
    "startLabel" TEXT,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "endLabel" TEXT,
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,
    "distanceMeters" INTEGER,
    "durationSeconds" INTEGER,
    "geometry" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "serviceAddressId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "jobTypes" TEXT NOT NULL,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyRoute_serviceDate_idx" ON "DailyRoute"("serviceDate");

-- CreateIndex
CREATE INDEX "DailyRoute_operatorId_serviceDate_idx" ON "DailyRoute"("operatorId", "serviceDate");

-- CreateIndex
CREATE INDEX "RouteStop_routeId_idx" ON "RouteStop"("routeId");

-- CreateIndex
CREATE INDEX "RouteStop_serviceAddressId_routeId_idx" ON "RouteStop"("serviceAddressId", "routeId");

-- AddForeignKey
ALTER TABLE "DailyRoute" ADD CONSTRAINT "DailyRoute_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "DailyRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_serviceAddressId_fkey" FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
