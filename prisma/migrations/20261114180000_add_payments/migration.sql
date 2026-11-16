-- Модуль 13. Оплати (MVP 2.1): записи про оплату студентів і журнал їх змін.
-- Актуальний статус студента — status останнього Payment; Student.current_payment_id вказує на нього.
-- Записи payments і payment_history не видаляються застосунком.

-- PaymentStatus: UNPAID → NOT_PAID, як у вимогах. Один enum і для Payment, і для знімка
-- driving_lessons.payment_status. Перейменування не чіпає наявні рядки (усі заняття — PAID).
ALTER TYPE "PaymentStatus" RENAME VALUE 'UNPAID' TO 'NOT_PAID';

-- CreateEnum
CREATE TYPE "PaymentHistoryAction" AS ENUM ('CREATED', 'STATUS_CHANGED', 'UPDATED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'UAH',
    "status" "PaymentStatus" NOT NULL,
    "paid_at" TIMESTAMP(3),
    "comment" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "action" "PaymentHistoryAction" NOT NULL,
    "previous_status" "PaymentStatus",
    "new_status" "PaymentStatus" NOT NULL,
    "changes" JSONB,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" VARCHAR(1000),

    CONSTRAINT "payment_history_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "students" ADD COLUMN "current_payment_id" UUID;

-- CreateIndex
CREATE INDEX "payments_organization_id_status_idx" ON "payments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "payments_organization_id_student_id_created_at_idx" ON "payments"("organization_id", "student_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_organization_id_paid_at_idx" ON "payments"("organization_id", "paid_at");

-- CreateIndex
CREATE INDEX "payments_created_by_id_idx" ON "payments"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_organization_id_key" ON "payments"("id", "organization_id");

-- CreateIndex
CREATE INDEX "payment_history_payment_id_changed_at_idx" ON "payment_history"("payment_id", "changed_at");

-- CreateIndex
CREATE INDEX "payment_history_organization_id_changed_at_idx" ON "payment_history"("organization_id", "changed_at");

-- CreateIndex
CREATE INDEX "payment_history_changed_by_id_idx" ON "payment_history"("changed_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_student_id_key" ON "payments"("id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_current_payment_id_key" ON "students"("current_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_current_payment_id_user_id_key" ON "students"("current_payment_id", "user_id");

-- AddForeignKey
-- Складений FK: актуальна оплата — завжди оплата цього самого студента. Поки current_payment_id
-- NULL, FK не перевіряється (MATCH SIMPLE). NO ACTION перевіряється в кінці запиту, тож каскадне
-- видалення автошколи (і студентів, і оплат) проходить.
ALTER TABLE "students" ADD CONSTRAINT "students_current_payment_id_user_id_fkey" FOREIGN KEY ("current_payment_id", "user_id") REFERENCES "payments"("id", "student_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_organization_id_fkey" FOREIGN KEY ("student_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_organization_id_fkey" FOREIGN KEY ("created_by_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_payment_id_organization_id_fkey" FOREIGN KEY ("payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_changed_by_id_organization_id_fkey" FOREIGN KEY ("changed_by_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Бізнес-правила оплати (Prisma не описує CHECK у схемі):
-- сума не від'ємна, а підтверджена оплата — більша за нуль;
-- paid_at є тоді й лише тоді, коли оплату підтверджено (PAID);
-- валюта — код ISO 4217 (три латинські літери у верхньому регістрі).
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK (
  "amount" >= 0 AND ("status" <> 'PAID' OR "amount" > 0)
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_paid_at_check" CHECK (
  ("status" = 'PAID') = ("paid_at" IS NOT NULL)
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK (
  "currency" ~ '^[A-Z]{3}$'
);

-- Журнал: попередній статус відсутній лише в події створення;
-- STATUS_CHANGED завжди змінює статус.
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_status_check" CHECK (
  ("action" = 'CREATED') = ("previous_status" IS NULL)
  AND ("action" <> 'STATUS_CHANGED' OR "previous_status" <> "new_status")
);
