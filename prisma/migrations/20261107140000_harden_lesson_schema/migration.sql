-- 1. Один enum статусу для теорії й практики: DrivingLessonStatus мав ті самі значення, що LessonStatus.
-- CHECK скасування містить приведення до старого типу, тож він знімається на час зміни типу
-- і повертається з тим самим текстом.
ALTER TABLE "driving_lessons" DROP CONSTRAINT "driving_lessons_cancellation_check";
ALTER TABLE "driving_lessons" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "driving_lessons"
  ALTER COLUMN "status" TYPE "LessonStatus" USING ("status"::text::"LessonStatus");
ALTER TABLE "driving_lessons" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED';
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_cancellation_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  AND ("cancellation_reason" IS NULL OR "status" = 'CANCELLED')
);
DROP TYPE "DrivingLessonStatus";

-- 2. Автошкола теоретичного заняття. Значення береться з групи, а складений FK
-- (group_id, organization_id) → groups(id, organization_id) гарантує, що вони не розійдуться.
ALTER TABLE "lessons" ADD COLUMN "organization_id" UUID;

UPDATE "lessons" AS l
SET "organization_id" = g."organization_id"
FROM "groups" AS g
WHERE g."id" = l."group_id";

ALTER TABLE "lessons" ALTER COLUMN "organization_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "groups_id_organization_id_key" ON "groups"("id", "organization_id");

-- DropForeignKey
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_group_id_fkey";

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "groups"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Складені індекси під пошук конфліктів і розклад: ресурс + вікно scheduled_at.
-- Одноколонкові індекси з тією ж першою колонкою стають зайвими; глобальний індекс
-- scheduled_at охоплював усі автошколи.
DROP INDEX "lessons_group_id_idx";
DROP INDEX "lessons_scheduled_at_idx";
DROP INDEX "driving_lessons_organization_id_idx";
DROP INDEX "driving_lessons_instructor_id_idx";
DROP INDEX "driving_lessons_student_id_idx";
DROP INDEX "driving_lessons_car_id_idx";
DROP INDEX "driving_lessons_scheduled_at_idx";

-- CreateIndex
CREATE INDEX "lessons_organization_id_scheduled_at_idx" ON "lessons"("organization_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "lessons_group_id_scheduled_at_idx" ON "lessons"("group_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "driving_lessons_organization_id_scheduled_at_idx" ON "driving_lessons"("organization_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "driving_lessons_instructor_id_scheduled_at_idx" ON "driving_lessons"("instructor_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "driving_lessons_student_id_scheduled_at_idx" ON "driving_lessons"("student_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "driving_lessons_car_id_scheduled_at_idx" ON "driving_lessons"("car_id", "scheduled_at");

-- 4. Видалення людини не стирає історію навчання.
-- RESTRICT перевіряється після всіх каскадів інструкції, тож видалення всієї автошколи
-- (organizations → users і organizations → driving_lessons/groups) і далі працює.
ALTER TABLE "driving_lessons" DROP CONSTRAINT "driving_lessons_instructor_id_fkey";
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "driving_lessons" DROP CONSTRAINT "driving_lessons_student_id_fkey";
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Каскад з викладача видаляв групу разом із заняттями, зарахуваннями й відвідуванням.
ALTER TABLE "groups" DROP CONSTRAINT "groups_teacher_id_fkey";
ALTER TABLE "groups" ADD CONSTRAINT "groups_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- instructor_id у cars необов'язковий: авто лишається без інструктора, а не видаляється.
ALTER TABLE "cars" DROP CONSTRAINT "cars_instructor_id_fkey";
ALTER TABLE "cars" ADD CONSTRAINT "cars_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
