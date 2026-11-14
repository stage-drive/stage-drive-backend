-- Оплати: призначення платежу та ідемпотентне створення.

-- Призначення платежу обов'язкове. Наявні записи (якщо вони вже є) отримують загальне
-- призначення, після чого default прибирається: нові записи мусять передати своє.
ALTER TABLE "payments" ADD COLUMN "purpose" VARCHAR(255) NOT NULL DEFAULT 'Оплата навчання';
ALTER TABLE "payments" ALTER COLUMN "purpose" DROP DEFAULT;

-- Ключ ідемпотентності з заголовка Idempotency-Key і SHA-256 тіла запиту створення.
ALTER TABLE "payments" ADD COLUMN "idempotency_key" VARCHAR(128),
ADD COLUMN "request_hash" CHAR(64);

-- CreateIndex
-- Унікальний у межах автошколи. Записи без ключа (NULL) між собою не конфліктують.
CREATE UNIQUE INDEX "payments_organization_id_idempotency_key_key" ON "payments"("organization_id", "idempotency_key");

-- Призначення не з самих пробілів; ключ і хеш тіла — разом або жодного.
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_check" CHECK (
  length(btrim("purpose")) > 0
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_idempotency_check" CHECK (
  ("idempotency_key" IS NULL) = ("request_hash" IS NULL)
);
