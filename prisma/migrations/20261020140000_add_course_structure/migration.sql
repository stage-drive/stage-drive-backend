-- CreateEnum
CREATE TYPE "CourseMaterialType" AS ENUM ('TEXT', 'LINK', 'VIDEO');

-- CreateTable
CREATE TABLE "course_chapters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "type" "CourseMaterialType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_chapters_id_course_id_key" ON "course_chapters"("id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_chapters_course_id_position_key" ON "course_chapters"("course_id", "position");

-- CreateIndex
CREATE INDEX "course_lessons_course_id_idx" ON "course_lessons"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_lessons_id_course_id_key" ON "course_lessons"("id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_lessons_chapter_id_position_key" ON "course_lessons"("chapter_id", "position");

-- CreateIndex
CREATE INDEX "course_materials_course_id_idx" ON "course_materials"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_materials_lesson_id_position_key" ON "course_materials"("lesson_id", "position");

-- AddForeignKey
ALTER TABLE "course_chapters" ADD CONSTRAINT "course_chapters_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_chapter_id_course_id_fkey" FOREIGN KEY ("chapter_id", "course_id") REFERENCES "course_chapters"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_lesson_id_course_id_fkey" FOREIGN KEY ("lesson_id", "course_id") REFERENCES "course_lessons"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;
