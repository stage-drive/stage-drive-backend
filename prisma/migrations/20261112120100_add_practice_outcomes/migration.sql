-- Результат практичного заняття (проведено / неявка) і коментар інструктора.

-- AlterTable
ALTER TABLE "driving_lessons" ADD COLUMN     "instructor_comment" VARCHAR(1000),
ADD COLUMN     "outcome_at" TIMESTAMP(3),
ADD COLUMN     "outcome_by_id" UUID;

-- CreateIndex
CREATE INDEX "driving_lessons_outcome_by_id_idx" ON "driving_lessons"("outcome_by_id");

-- AddForeignKey
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_outcome_by_id_fkey" FOREIGN KEY ("outcome_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Заняття, які вже мають status = COMPLETED (до цієї міграції код його не ставив), отримують момент результату.
UPDATE "driving_lessons" SET "outcome_at" = "updated_at" WHERE "status" = 'COMPLETED' AND "outcome_at" IS NULL;

-- Результат є тоді й лише тоді, коли заняття проведене чи зі неявкою, і лише в підтвердженого заняття
-- (запит, що чекає підтвердження, провести не можна). Prisma не описує CHECK у схемі.
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_outcome_check" CHECK (
  ("status" IN ('COMPLETED', 'NO_SHOW')) = ("outcome_at" IS NOT NULL)
  AND ("status" NOT IN ('COMPLETED', 'NO_SHOW') OR "confirmation_status" = 'CONFIRMED')
);

-- NO_SHOW — лише для практики: у теорії відвідування фіксує lesson_attendances.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_no_show_check" CHECK ("status" <> 'NO_SHOW');
