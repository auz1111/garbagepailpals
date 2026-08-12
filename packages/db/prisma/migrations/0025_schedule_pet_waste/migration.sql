-- Optional pet waste removal per pickup day; 0 = off, otherwise the number of dogs.
ALTER TABLE "ServiceSchedule" ADD COLUMN IF NOT EXISTS "petWasteDogs" INTEGER NOT NULL DEFAULT 0;
