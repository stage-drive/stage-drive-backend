-- CreateTable
CREATE TABLE "practice_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "instructor_id" UUID NOT NULL,
    "car_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 60,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_slots_organization_id_scheduled_at_idx" ON "practice_slots"("organization_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "practice_slots_instructor_id_scheduled_at_idx" ON "practice_slots"("instructor_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "practice_slots_car_id_scheduled_at_idx" ON "practice_slots"("car_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "practice_slots_created_by_id_idx" ON "practice_slots"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_organization_id_key" ON "users"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "cars_id_organization_id_key" ON "cars"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "practice_slots" ADD CONSTRAINT "practice_slots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_slots" ADD CONSTRAINT "practice_slots_instructor_id_organization_id_fkey" FOREIGN KEY ("instructor_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_slots" ADD CONSTRAINT "practice_slots_car_id_organization_id_fkey" FOREIGN KEY ("car_id", "organization_id") REFERENCES "cars"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_slots" ADD CONSTRAINT "practice_slots_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Межі збігаються з LESSON_MIN_DURATION_MIN / LESSON_MAX_DURATION_MIN у lessons.dto.ts.
-- findSlotConflicts (candidateWindow) покладається на верхню межу. Prisma не описує CHECK у схемі.
ALTER TABLE "practice_slots" ADD CONSTRAINT "practice_slots_duration_min_check"
  CHECK ("duration_min" BETWEEN 15 AND 240);
