-- Сповіщення користувачів автошколи (DF-16).
-- Рядок створює бекенд на погоджену бізнес-подію. Повтор тієї самої події
-- тому самому отримувачу ловить унікальний (organization_id, recipient_id, dedupe_key).
-- Складений FK не дає прив’язати сповіщення до людини іншої автошколи.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
    'SCHEDULE_CREATED',
    'SCHEDULE_RESCHEDULED',
    'SCHEDULE_CANCELLED',
    'PRACTICE_BOOKED',
    'PRACTICE_ASSIGNED',
    'PRACTICE_CONFIRMED',
    'PRACTICE_REJECTED',
    'PRACTICE_CANCELLED',
    'PRACTICE_RESCHEDULED',
    'PRACTICE_COMPLETED',
    'PRACTICE_NO_SHOW',
    'TEST_PUBLISHED',
    'TEST_PASSED',
    'TEST_FAILED',
    'PAYMENT_RECORDED',
    'PAYMENT_STATUS_CHANGED'
);

-- CreateEnum
CREATE TYPE "NotificationReadStatus" AS ENUM ('UNREAD', 'READ');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "read_status" "NotificationReadStatus" NOT NULL DEFAULT 'UNREAD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "dedupe_key" VARCHAR(200) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organization_id_recipient_id_dedupe_key_key"
    ON "notifications"("organization_id", "recipient_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_organization_id_recipient_id_created_at_idx"
    ON "notifications"("organization_id", "recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_status_idx"
    ON "notifications"("recipient_id", "read_status");

-- AddForeignKey
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_recipient_id_organization_id_fkey"
    FOREIGN KEY ("recipient_id", "organization_id") REFERENCES "users"("id", "organization_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_text_not_blank_check"
    CHECK (btrim("text") <> '');

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_read_status_read_at_check"
    CHECK (
        ("read_status" = 'UNREAD' AND "read_at" IS NULL)
        OR ("read_status" = 'READ' AND "read_at" IS NOT NULL)
    );
