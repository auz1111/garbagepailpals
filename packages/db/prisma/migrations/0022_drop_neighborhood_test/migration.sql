-- The "test" flag now lives on Zone; drop the orphaned neighborhood column.
ALTER TABLE "Neighborhood" DROP COLUMN IF EXISTS "isTest";
