-- Hand-written migration: Prisma's diff engine refuses to auto-generate a
-- TEXT -> UUID column type change (it only offers drop+recreate, which is
-- lossy). This migration instead uses explicit `USING column::uuid` casts
-- to preserve existing data.

-- Drop FK constraints that reference columns whose type is about to change.
-- PostgreSQL disallows altering the type of a column used in a FK constraint.
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_fkey";
ALTER TABLE "oauth_accounts" DROP CONSTRAINT "oauth_accounts_user_id_fkey";
ALTER TABLE "oauth_authorizations" DROP CONSTRAINT "oauth_authorizations_user_id_fkey";
ALTER TABLE "refresh_token" DROP CONSTRAINT "refresh_token_user_id_fkey";
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_fkey";

-- organizations: native UUID id with a DB-level default, bounded string columns
ALTER TABLE "organizations"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "name" TYPE VARCHAR(255),
  ALTER COLUMN "slug" TYPE VARCHAR(100),
  ALTER COLUMN "email" TYPE VARCHAR(255),
  ALTER COLUMN "phone" TYPE VARCHAR(20),
  ALTER COLUMN "address" TYPE VARCHAR(255),
  ALTER COLUMN "logo_url" TYPE VARCHAR(2048),
  ALTER COLUMN "timezone" TYPE VARCHAR(64);

-- users
ALTER TABLE "users"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "organization_id" TYPE UUID USING "organization_id"::uuid,
  ALTER COLUMN "email" TYPE VARCHAR(255),
  ALTER COLUMN "password_hash" TYPE VARCHAR(255),
  ALTER COLUMN "first_name" TYPE VARCHAR(100),
  ALTER COLUMN "last_name" TYPE VARCHAR(100),
  ALTER COLUMN "phone" TYPE VARCHAR(20),
  ALTER COLUMN "avatar_url" TYPE VARCHAR(2048);

-- oauth_accounts
ALTER TABLE "oauth_accounts"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "user_id" TYPE UUID USING "user_id"::uuid,
  ALTER COLUMN "provider_account_id" TYPE VARCHAR(255),
  ALTER COLUMN "email" TYPE VARCHAR(255);

-- oauth_authorizations
ALTER TABLE "oauth_authorizations"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "user_id" TYPE UUID USING "user_id"::uuid,
  ALTER COLUMN "state" TYPE VARCHAR(255),
  ALTER COLUMN "nonce" TYPE VARCHAR(255),
  ALTER COLUMN "code_verifier" TYPE VARCHAR(255);

-- refresh_token
ALTER TABLE "refresh_token"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "user_id" TYPE UUID USING "user_id"::uuid,
  ALTER COLUMN "token_hash" TYPE VARCHAR(128),
  ALTER COLUMN "ip_address" TYPE VARCHAR(45),
  ALTER COLUMN "user_agent" TYPE VARCHAR(512);

-- password_reset_tokens
ALTER TABLE "password_reset_tokens"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "user_id" TYPE UUID USING "user_id"::uuid,
  ALTER COLUMN "token_hash" TYPE VARCHAR(128);

-- Re-add FK constraints now that both sides are UUID again
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorizations" ADD CONSTRAINT "oauth_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Missing index on the FK column users.organization_id (Postgres does not
-- auto-index the referencing side of a foreign key)
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
