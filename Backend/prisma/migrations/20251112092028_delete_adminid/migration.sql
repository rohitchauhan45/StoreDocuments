/*
  Warnings:

  - You are about to drop the column `adminId` on the `User` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_adminId_fkey";

-- DropIndex
DROP INDEX "User_adminId_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "adminId";
