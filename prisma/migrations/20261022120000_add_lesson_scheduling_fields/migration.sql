-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
-- Автомобіль практичного заняття: без нього не перевірити, чи вільне авто.
ALTER TABLE "driving_lessons" ADD COLUMN     "car_id" UUID,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "driving_lessons_car_id_idx" ON "driving_lessons"("car_id");

-- AddForeignKey
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_car_id_fkey" FOREIGN KEY ("car_id") REFERENCES "cars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Наявні заняття отримують авто, призначене студенту під час допуску до практики.
UPDATE "driving_lessons" AS dl
SET "car_id" = s."car_id"
FROM "students" AS s
WHERE s."user_id" = dl."student_id" AND s."car_id" IS NOT NULL;

-- Межі збігаються з LESSON_MIN_DURATION_MIN / LESSON_MAX_DURATION_MIN у lessons.dto.ts.
-- Пошук конфліктів покладається на верхню межу. Prisma не описує CHECK у схемі.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_duration_min_check"
  CHECK ("duration_min" BETWEEN 15 AND 240);
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_duration_min_check"
  CHECK ("duration_min" BETWEEN 15 AND 240);
