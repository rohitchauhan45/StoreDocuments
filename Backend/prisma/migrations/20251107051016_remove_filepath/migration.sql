/*
  Warnings:

  - You are about to drop the column `filePath` on the `UserDocument` table. All the data in the column will be lost.
  - You are about to drop the column `mediaId` on the `UserDocument` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "UserDocument" DROP COLUMN "filePath",
DROP COLUMN "mediaId";
