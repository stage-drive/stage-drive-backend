-- CreateTable
CREATE TABLE "course_lesson_completions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_lesson_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "completed_lesson_count" INTEGER NOT NULL,
    "total_lesson_count" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_lesson_completions_organization_id_idx" ON "course_lesson_completions"("organization_id");

-- CreateIndex
CREATE INDEX "course_lesson_completions_course_id_student_id_idx" ON "course_lesson_completions"("course_id", "student_id");

-- CreateIndex
CREATE INDEX "course_lesson_completions_lesson_id_idx" ON "course_lesson_completions"("lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_lesson_completions_student_id_lesson_id_key" ON "course_lesson_completions"("student_id", "lesson_id");

-- CreateIndex
CREATE INDEX "course_progress_organization_id_idx" ON "course_progress"("organization_id");

-- CreateIndex
CREATE INDEX "course_progress_course_id_idx" ON "course_progress"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_progress_student_id_course_id_key" ON "course_progress"("student_id", "course_id");

-- AddForeignKey
ALTER TABLE "course_lesson_completions" ADD CONSTRAINT "course_lesson_completions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_lesson_completions" ADD CONSTRAINT "course_lesson_completions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_lesson_completions" ADD CONSTRAINT "course_lesson_completions_lesson_id_course_id_fkey" FOREIGN KEY ("lesson_id", "course_id") REFERENCES "course_lessons"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_lesson_completions" ADD CONSTRAINT "course_lesson_completions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma не описує CHECK у схемі.
ALTER TABLE "course_progress" ADD CONSTRAINT "course_progress_counts_check" CHECK (
    "completed_lesson_count" >= 0
    AND "total_lesson_count" >= 0
    AND "completed_lesson_count" <= "total_lesson_count"
    AND "percent" BETWEEN 0 AND 100
);
