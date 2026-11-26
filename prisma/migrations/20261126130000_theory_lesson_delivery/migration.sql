-- Теоретичне заняття: офлайн в аудиторії або онлайн-урок на YouTube.
-- Старі рядки лишаються CLASSROOM без аудиторії і без посилання.
CREATE TYPE "TheoryDelivery" AS ENUM ('CLASSROOM', 'ONLINE');

ALTER TABLE "lessons" ADD COLUMN "delivery" "TheoryDelivery" NOT NULL DEFAULT 'CLASSROOM';
ALTER TABLE "lessons" ADD COLUMN "classroom" VARCHAR(120);
ALTER TABLE "lessons" ADD COLUMN "online_link" VARCHAR(500);

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_delivery_check" CHECK (
  (
    "delivery" = 'CLASSROOM'
    AND "online_link" IS NULL
    AND ("classroom" IS NULL OR char_length("classroom") > 0)
  )
  OR (
    "delivery" = 'ONLINE'
    AND "classroom" IS NULL
    AND "online_link" IS NOT NULL
    AND char_length("online_link") > 0
  )
);
