-- CreateEnum
CREATE TYPE "Status" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "status" "Status" NOT NULL DEFAULT 'active';
