-- CreateEnum
CREATE TYPE "TheoryTestAttemptStatus" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "theory_test_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "TheoryTestAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "format" "TheoryTestFormat" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "score" INTEGER,
    "passing_score" INTEGER NOT NULL,
    "time_limit_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theory_test_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theory_test_attempt_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "source_question_id" UUID NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "theory_test_attempt_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theory_test_attempt_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID NOT NULL,
    "source_option_id" UUID NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "theory_test_attempt_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theory_test_attempt_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,

    CONSTRAINT "theory_test_attempt_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theory_test_attempt_selections" (
    "answer_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "theory_test_attempt_selections_pkey" PRIMARY KEY ("answer_id", "option_id")
);

-- CreateIndex
CREATE INDEX "theory_test_attempts_organization_id_idx" ON "theory_test_attempts"("organization_id");

-- CreateIndex
CREATE INDEX "theory_test_attempts_student_id_test_id_status_idx" ON "theory_test_attempts"("student_id", "test_id", "status");

-- CreateIndex
CREATE INDEX "theory_test_attempts_test_id_idx" ON "theory_test_attempts"("test_id");

-- CreateIndex
CREATE INDEX "theory_test_attempts_course_id_idx" ON "theory_test_attempts"("course_id");

-- Одна відкрита спроба на студента і тест. Повторний старт не створює другу IN_PROGRESS.
CREATE UNIQUE INDEX "theory_test_attempts_one_in_progress_idx"
ON "theory_test_attempts" ("student_id", "test_id")
WHERE "status" = 'IN_PROGRESS';

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_questions_id_attempt_id_key" ON "theory_test_attempt_questions"("id", "attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_questions_attempt_id_source_question_id_key" ON "theory_test_attempt_questions"("attempt_id", "source_question_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_questions_attempt_id_position_key" ON "theory_test_attempt_questions"("attempt_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_options_id_question_id_key" ON "theory_test_attempt_options"("id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_options_question_id_source_option_id_key" ON "theory_test_attempt_options"("question_id", "source_option_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_options_question_id_position_key" ON "theory_test_attempt_options"("question_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_answers_id_question_id_key" ON "theory_test_attempt_answers"("id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_test_attempt_answers_attempt_id_question_id_key" ON "theory_test_attempt_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "theory_test_attempt_selections_option_id_idx" ON "theory_test_attempt_selections"("option_id");

-- AddForeignKey
ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "courses"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_test_id_organization_id_fkey" FOREIGN KEY ("test_id", "organization_id") REFERENCES "theory_tests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_student_id_organization_id_fkey" FOREIGN KEY ("student_id", "organization_id") REFERENCES "users"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempt_questions" ADD CONSTRAINT "theory_test_attempt_questions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "theory_test_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempt_options" ADD CONSTRAINT "theory_test_attempt_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "theory_test_attempt_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempt_answers" ADD CONSTRAINT "theory_test_attempt_answers_question_id_attempt_id_fkey" FOREIGN KEY ("question_id", "attempt_id") REFERENCES "theory_test_attempt_questions"("id", "attempt_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempt_selections" ADD CONSTRAINT "theory_test_attempt_selections_answer_id_question_id_fkey" FOREIGN KEY ("answer_id", "question_id") REFERENCES "theory_test_attempt_answers"("id", "question_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_test_attempt_selections" ADD CONSTRAINT "theory_test_attempt_selections_option_id_question_id_fkey" FOREIGN KEY ("option_id", "question_id") REFERENCES "theory_test_attempt_options"("id", "question_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_score_check" CHECK (
    "score" IS NULL OR "score" BETWEEN 0 AND 100
);

ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_passing_score_check" CHECK (
    "passing_score" BETWEEN 1 AND 100
);

ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_time_limit_check" CHECK (
    "time_limit_minutes" IS NULL OR "time_limit_minutes" BETWEEN 1 AND 240
);

ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_deadline_check" CHECK (
    ("time_limit_minutes" IS NULL AND "expires_at" IS NULL)
    OR ("time_limit_minutes" IS NOT NULL AND "expires_at" IS NOT NULL)
);

ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_status_check" CHECK (
    (
        "status" = 'IN_PROGRESS'
        AND "submitted_at" IS NULL
        AND "score" IS NULL
    )
    OR (
        "status" = 'EXPIRED'
        AND "submitted_at" IS NOT NULL
        AND "score" IS NULL
    )
    OR (
        "status" IN ('PASSED', 'FAILED')
        AND "submitted_at" IS NOT NULL
        AND "score" IS NOT NULL
    )
);
