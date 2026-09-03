-- AlterTable: add nullable columns first so existing rows can be backfilled
ALTER TABLE "refresh_token" ADD COLUMN     "family_id" UUID,
ADD COLUMN     "used_at" TIMESTAMP(3);

-- Backfill: pre-existing rows predate token persistence/rotation and can
-- never be redeemed again (new tokens are opaque random values, not the old
-- signed strings these hashes were computed from), so each becomes its own
-- revoked, single-member family instead of being left in a NULL/live state.
UPDATE "refresh_token" SET "family_id" = "id"::uuid, "revoked_at" = COALESCE("revoked_at", now()) WHERE "family_id" IS NULL;

-- AlterTable: now enforce NOT NULL
ALTER TABLE "refresh_token" ALTER COLUMN "family_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");
