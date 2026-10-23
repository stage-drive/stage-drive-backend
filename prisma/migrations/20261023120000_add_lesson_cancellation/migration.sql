-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "cancellation_reason" VARCHAR(500),
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_id" UUID;

-- AlterTable
ALTER TABLE "driving_lessons" ADD COLUMN     "cancellation_reason" VARCHAR(500),
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_id" UUID;

-- CreateIndex
CREATE INDEX "lessons_cancelled_by_id_idx" ON "lessons"("cancelled_by_id");

-- CreateIndex
CREATE INDEX "driving_lessons_cancelled_by_id_idx" ON "driving_lessons"("cancelled_by_id");

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Наявні скасовані заняття (закриття групи): точний час невідомий, updated_at — найближче наближення.
UPDATE "lessons" SET "cancelled_at" = "updated_at" WHERE "status" = 'CANCELLED';
UPDATE "driving_lessons" SET "cancelled_at" = "updated_at" WHERE "status" = 'CANCELLED';

-- cancelled_at є тоді й лише тоді, коли заняття скасоване; причина буває лише в скасованого.
-- Prisma не описує CHECK у схемі.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_cancellation_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  AND ("cancellation_reason" IS NULL OR "status" = 'CANCELLED')
);
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_cancellation_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  AND ("cancellation_reason" IS NULL OR "status" = 'CANCELLED')
);
