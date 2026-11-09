-- Підтвердження бронювання практики і заглушка оплати.
-- Наявні заняття створювали ADMIN чи INSTRUCTOR напряму, тож вони вважаються підтвердженими (CONFIRMED)
-- і оплаченими (PAID, заглушка до появи оплат).

-- CreateEnum
CREATE TYPE "BookingConfirmation" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- AlterTable
ALTER TABLE "driving_lessons" ADD COLUMN     "confirmation_status" "BookingConfirmation" NOT NULL DEFAULT 'CONFIRMED',
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_by_id" UUID,
ADD COLUMN     "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PAID';

-- CreateIndex
CREATE INDEX "driving_lessons_confirmed_by_id_idx" ON "driving_lessons"("confirmed_by_id");

-- CreateIndex
CREATE INDEX "driving_lessons_confirmation_status_scheduled_at_idx" ON "driving_lessons"("confirmation_status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Наявні підтверджені заняття отримують момент підтвердження — момент створення.
UPDATE "driving_lessons" SET "confirmed_at" = "created_at" WHERE "confirmed_at" IS NULL;

-- Узгодженість підтвердження зі статусом заняття (Prisma не описує CHECK у схемі):
-- REJECTED — лише разом зі скасуванням; PENDING — ще без моменту підтвердження і не проведене.
-- confirmed_at для CONFIRMED заповнюють сервіси; CHECK його не вимагає, щоб вставка з @default
-- (CONFIRMED) без confirmed_at — у тестах чи імпорті — лишалася можливою.
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_confirmation_check" CHECK (
  ("confirmation_status" <> 'REJECTED' OR "status" = 'CANCELLED')
  AND ("confirmation_status" <> 'PENDING' OR ("confirmed_at" IS NULL AND "status" <> 'COMPLETED'))
);
