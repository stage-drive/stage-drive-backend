-- CreateEnum
CREATE TYPE "InvitationEmailStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "invitation_email_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invitation_id" UUID NOT NULL,
    "token" VARCHAR(128),
    "token_hash" VARCHAR(128) NOT NULL,
    "status" "InvitationEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "provider_message_id" VARCHAR(512),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitation_email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invitation_email_jobs_status_next_attempt_at_idx" ON "invitation_email_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "invitation_email_jobs_invitation_id_created_at_idx" ON "invitation_email_jobs"("invitation_id", "created_at");

-- AddForeignKey
ALTER TABLE "invitation_email_jobs" ADD CONSTRAINT "invitation_email_jobs_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
