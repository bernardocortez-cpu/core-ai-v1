-- CreateEnum
CREATE TYPE "BetaUserRole" AS ENUM ('ADMIN', 'TEAM', 'TESTER');

-- CreateTable
CREATE TABLE "beta_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "BetaUserRole" NOT NULL DEFAULT 'TESTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beta_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "beta_users_email_key" ON "beta_users"("email");

-- CreateIndex
CREATE INDEX "beta_users_email_idx" ON "beta_users"("email");
