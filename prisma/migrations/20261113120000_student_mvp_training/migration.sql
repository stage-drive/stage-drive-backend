-- Навчальний статус NEW замість INVITED (INVITED лишається лише в UserStatus).
-- EXAM додається перед GRADUATED. Нові значення в цій міграції не використовуються в DML.

ALTER TYPE "TrainingStatus" RENAME VALUE 'INVITED' TO 'NEW';

ALTER TYPE "TrainingStatus" ADD VALUE 'EXAM' BEFORE 'GRADUATED';

ALTER TABLE "students" ALTER COLUMN "training_status" SET DEFAULT 'NEW';

-- Категорії ТЗ: один enum для студента і автомобіля.
ALTER TYPE "LicenseCategory" ADD VALUE 'A1' BEFORE 'A';
ALTER TYPE "LicenseCategory" ADD VALUE 'B1' BEFORE 'B';
ALTER TYPE "LicenseCategory" ADD VALUE 'BE' AFTER 'B';
ALTER TYPE "LicenseCategory" ADD VALUE 'C1' BEFORE 'C';
ALTER TYPE "LicenseCategory" ADD VALUE 'C1E' AFTER 'C1';
ALTER TYPE "LicenseCategory" ADD VALUE 'CE' AFTER 'C';
ALTER TYPE "LicenseCategory" ADD VALUE 'D1' BEFORE 'D';
ALTER TYPE "LicenseCategory" ADD VALUE 'D1E' AFTER 'D1';
ALTER TYPE "LicenseCategory" ADD VALUE 'DE' AFTER 'D';
ALTER TYPE "LicenseCategory" ADD VALUE 'T';

CREATE TYPE "TheoryTestStatus" AS ENUM ('PASSED', 'FAILED');

CREATE TABLE "theory_test_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "TheoryTestStatus" NOT NULL,
    "score" INTEGER,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theory_test_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "theory_test_results_student_id_course_id_key" ON "theory_test_results"("student_id", "course_id");
CREATE INDEX "theory_test_results_organization_id_idx" ON "theory_test_results"("organization_id");
CREATE INDEX "theory_test_results_course_id_idx" ON "theory_test_results"("course_id");

ALTER TABLE "theory_test_results" ADD CONSTRAINT "theory_test_results_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "theory_test_results" ADD CONSTRAINT "theory_test_results_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "theory_test_results" ADD CONSTRAINT "theory_test_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
