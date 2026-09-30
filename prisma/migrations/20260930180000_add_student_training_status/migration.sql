-- CreateEnum
CREATE TYPE "TrainingStatus" AS ENUM ('INVITED', 'ACTIVE', 'GRADUATED', 'DROPPED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "students" ADD COLUMN "training_status" "TrainingStatus" NOT NULL DEFAULT 'INVITED';

-- Backfill from the account and the latest enrollment outcome.
UPDATE "students" AS s
SET "training_status" = 'ACTIVE'
FROM "users" AS u
WHERE u.id = s.user_id
  AND u.status IN ('ACTIVE', 'BLOCKED');

UPDATE "students" AS s
SET "training_status" = 'DROPPED'
WHERE EXISTS (
  SELECT 1
  FROM "enrollments" AS e
  WHERE e.student_id = s.user_id
    AND e.status = 'DROPPED'
)
AND NOT EXISTS (
  SELECT 1
  FROM "enrollments" AS e
  WHERE e.student_id = s.user_id
    AND e.status = 'COMPLETED'
);

UPDATE "students" AS s
SET "training_status" = 'GRADUATED'
WHERE EXISTS (
  SELECT 1
  FROM "enrollments" AS e
  WHERE e.student_id = s.user_id
    AND e.status = 'COMPLETED'
);

UPDATE "students" AS s
SET "training_status" = 'ARCHIVED'
FROM "users" AS u
WHERE u.id = s.user_id
  AND u.status = 'ARCHIVED';
