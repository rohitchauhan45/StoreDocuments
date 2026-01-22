/*
  Warnings:

  - You are about to drop the column `folderId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `selectedFolderName` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `selectedFolderType` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "folderId",
DROP COLUMN "selectedFolderName",
DROP COLUMN "selectedFolderType";
