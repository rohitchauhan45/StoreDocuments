/*
  Warnings:

  - A unique constraint covering the columns `[googleMail]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleMail" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleMail_key" ON "User"("googleMail");
