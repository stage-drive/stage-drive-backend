-- CreateEnum
CREATE TYPE "DrivingLessonStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "driving_lessons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 60,
    "status" "DrivingLessonStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driving_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driving_lessons_organization_id_idx" ON "driving_lessons"("organization_id");

-- CreateIndex
CREATE INDEX "driving_lessons_instructor_id_idx" ON "driving_lessons"("instructor_id");

-- CreateIndex
CREATE INDEX "driving_lessons_student_id_idx" ON "driving_lessons"("student_id");

-- CreateIndex
CREATE INDEX "driving_lessons_scheduled_at_idx" ON "driving_lessons"("scheduled_at");

-- AddForeignKey
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
