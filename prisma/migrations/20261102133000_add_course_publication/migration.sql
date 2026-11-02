-- Публікація теоретичного курсу. Наявні курси лишаються чернетками:
-- студенти не бачать контент, доки ADMIN не виставить PUBLISHED.

-- CreateEnum
CREATE TYPE "CoursePublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "courses" ADD COLUMN "publication_status" "CoursePublicationStatus" NOT NULL DEFAULT 'DRAFT';
