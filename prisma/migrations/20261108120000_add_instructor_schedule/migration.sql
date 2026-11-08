-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "TimeOffType" AS ENUM ('VACATION', 'SICK_LEAVE', 'DAY_OFF', 'OTHER');

-- CreateTable
CREATE TABLE "instructor_working_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "day_of_week" "DayOfWeek" NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_time_offs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "type" "TimeOffType" NOT NULL DEFAULT 'DAY_OFF',
    "reason" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_time_offs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instructor_working_hours_instructor_id_day_of_week_idx" ON "instructor_working_hours"("instructor_id", "day_of_week");

-- CreateIndex
CREATE INDEX "instructor_working_hours_organization_id_idx" ON "instructor_working_hours"("organization_id");

-- CreateIndex
CREATE INDEX "instructor_time_offs_instructor_id_starts_at_idx" ON "instructor_time_offs"("instructor_id", "starts_at");

-- CreateIndex
CREATE INDEX "instructor_time_offs_organization_id_starts_at_idx" ON "instructor_time_offs"("organization_id", "starts_at");

-- CreateIndex
CREATE INDEX "instructor_time_offs_created_by_id_idx" ON "instructor_time_offs"("created_by_id");

-- AddForeignKey
ALTER TABLE "instructor_working_hours" ADD CONSTRAINT "instructor_working_hours_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_working_hours" ADD CONSTRAINT "instructor_working_hours_instructor_id_organization_id_fkey" FOREIGN KEY ("instructor_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_time_offs" ADD CONSTRAINT "instructor_time_offs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_time_offs" ADD CONSTRAINT "instructor_time_offs_instructor_id_organization_id_fkey" FOREIGN KEY ("instructor_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_time_offs" ADD CONSTRAINT "instructor_time_offs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Межі збігаються з MINUTES_PER_DAY у instructor-schedule.dto.ts. Prisma не описує CHECK у схемі.
-- end_minute = 1440 — робота до півночі. Неперетин інтервалів одного дня перевіряє сервіс.
ALTER TABLE "instructor_working_hours" ADD CONSTRAINT "instructor_working_hours_minutes_check"
  CHECK ("start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440);

-- Напіввідкритий інтервал [starts_at, ends_at): порожній чи перевернутий не має сенсу.
ALTER TABLE "instructor_time_offs" ADD CONSTRAINT "instructor_time_offs_interval_check"
  CHECK ("ends_at" > "starts_at");
