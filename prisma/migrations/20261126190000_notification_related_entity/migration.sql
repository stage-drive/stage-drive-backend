-- Посилання сповіщення на сутність, з якої його створено (DF-16).
-- Пара entity_type + entity_id або є повністю, або її немає.
-- Зовнішнього ключа немає: видалена сутність не стирає сповіщення,
-- а перехід відповідає 404.

CREATE TYPE "NotificationEntityType" AS ENUM (
    'THEORY_LESSON',
    'PRACTICE_LESSON',
    'TEST',
    'TEST_ATTEMPT',
    'PAYMENT'
);

ALTER TABLE "notifications"
    ADD COLUMN "entity_type" "NotificationEntityType",
    ADD COLUMN "entity_id" UUID;

-- Уже збережені сповіщення несуть id сутності в dedupe_key.
UPDATE "notifications"
SET "entity_type" = 'THEORY_LESSON',
    "entity_id" = substring("dedupe_key" from '^schedule:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid
WHERE "entity_type" IS NULL
  AND "dedupe_key" ~ '^schedule:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

UPDATE "notifications"
SET "entity_type" = 'PRACTICE_LESSON',
    "entity_id" = substring("dedupe_key" from '^practice:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid
WHERE "entity_type" IS NULL
  AND "dedupe_key" ~ '^practice:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

UPDATE "notifications"
SET "entity_type" = 'TEST',
    "entity_id" = substring("dedupe_key" from '^test:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid
WHERE "entity_type" IS NULL
  AND "dedupe_key" ~ '^test:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

UPDATE "notifications"
SET "entity_type" = 'TEST_ATTEMPT',
    "entity_id" = substring("dedupe_key" from '^attempt:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid
WHERE "entity_type" IS NULL
  AND "dedupe_key" ~ '^attempt:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

UPDATE "notifications"
SET "entity_type" = 'PAYMENT',
    "entity_id" = substring("dedupe_key" from '^payment:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid
WHERE "entity_type" IS NULL
  AND "dedupe_key" ~ '^payment:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_entity_pair_check"
    CHECK (
        ("entity_type" IS NULL AND "entity_id" IS NULL)
        OR ("entity_type" IS NOT NULL AND "entity_id" IS NOT NULL)
    );
