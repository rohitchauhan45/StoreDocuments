/*
  Warnings:

  - You are about to drop the column `createdAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `password` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `fileName` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `googleDriveId` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `googleDriveLink` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `mimeType` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `phoneNumber` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the `GoogleCredential` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "createdAt",
DROP COLUMN "email",
DROP COLUMN "password";

-- AlterTable
ALTER TABLE "UserDocument" DROP COLUMN "createdAt",
DROP COLUMN "fileName",
DROP COLUMN "googleDriveId",
DROP COLUMN "googleDriveLink",
DROP COLUMN "metadata",
DROP COLUMN "mimeType",
DROP COLUMN "phoneNumber",
DROP COLUMN "updatedAt";

-- DropTable
DROP TABLE "GoogleCredential";

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);
