-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateTable
CREATE TABLE "lesson_attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "marked_by_id" UUID,
    "marked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_attendances_student_id_idx" ON "lesson_attendances"("student_id");

-- CreateIndex
CREATE INDEX "lesson_attendances_marked_by_id_idx" ON "lesson_attendances"("marked_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_attendances_lesson_id_student_id_key" ON "lesson_attendances"("lesson_id", "student_id");

-- AddForeignKey
ALTER TABLE "lesson_attendances" ADD CONSTRAINT "lesson_attendances_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_attendances" ADD CONSTRAINT "lesson_attendances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_attendances" ADD CONSTRAINT "lesson_attendances_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
