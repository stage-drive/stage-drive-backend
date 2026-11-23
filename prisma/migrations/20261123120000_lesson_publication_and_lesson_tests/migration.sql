-- Статус уроку теорії, типи матеріалів PDF/IMAGE/FILE і тест, прив’язаний до уроку.
-- Наявні уроки лишаються PUBLISHED: студенти вже бачили їх через публікацію курсу.
-- Нові уроки за замовчуванням DRAFT.

-- CreateEnum
CREATE TYPE "CourseLessonPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "course_lessons"
  ADD COLUMN "publication_status" "CourseLessonPublicationStatus" NOT NULL DEFAULT 'PUBLISHED';

ALTER TABLE "course_lessons"
  ALTER COLUMN "publication_status" SET DEFAULT 'DRAFT';

-- AlterEnum
ALTER TYPE "CourseMaterialType" ADD VALUE 'PDF';
ALTER TYPE "CourseMaterialType" ADD VALUE 'IMAGE';
ALTER TYPE "CourseMaterialType" ADD VALUE 'FILE';

-- AlterTable
ALTER TABLE "theory_tests" ADD COLUMN "course_lesson_id" UUID;

-- AddForeignKey
ALTER TABLE "theory_tests"
  ADD CONSTRAINT "theory_tests_course_lesson_id_course_id_fkey"
  FOREIGN KEY ("course_lesson_id", "course_id")
  REFERENCES "course_lessons"("id", "course_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "theory_tests_course_lesson_id_key" ON "theory_tests"("course_lesson_id");
