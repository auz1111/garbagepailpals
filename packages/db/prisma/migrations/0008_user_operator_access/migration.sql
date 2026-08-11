-- Admins can be granted operator access (view the operator dashboard).
ALTER TABLE "User" ADD COLUMN "operatorAccess" BOOLEAN NOT NULL DEFAULT false;
