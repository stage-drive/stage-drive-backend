-- CreateEnum
CREATE TYPE "TheoryTestFormat" AS ENUM ('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "TheoryTestPublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- Ціль складеного FK: тест не прив’язати до курсу іншої автошколи.
CREATE UNIQUE INDEX "courses_id_organization_id_key" ON "courses"("id", "organization_id");

-- CreateTable
CREATE TABLE "theory_tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "format" "TheoryTestFormat" NOT NULL,
    "passing_score" INTEGER NOT NULL,
    "time_limit_minutes" INTEGER,
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "publication_status" "TheoryTestPublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theory_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theory_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theory_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theory_answer_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID NOT NULL,
    "test_id" UUID NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "theory_answer_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "theory_tests_id_organization_id_key" ON "theory_tests"("id", "organization_id");

-- CreateIndex
CREATE INDEX "theory_tests_organization_id_idx" ON "theory_tests"("organization_id");

-- CreateIndex
CREATE INDEX "theory_tests_course_id_idx" ON "theory_tests"("course_id");

-- CreateIndex
CREATE INDEX "theory_questions_organization_id_idx" ON "theory_questions"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_questions_id_test_id_key" ON "theory_questions"("id", "test_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_questions_test_id_position_key" ON "theory_questions"("test_id", "position");

-- CreateIndex
CREATE INDEX "theory_answer_options_test_id_idx" ON "theory_answer_options"("test_id");

-- CreateIndex
CREATE UNIQUE INDEX "theory_answer_options_question_id_position_key" ON "theory_answer_options"("question_id", "position");

-- AddForeignKey
ALTER TABLE "theory_tests" ADD CONSTRAINT "theory_tests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_tests" ADD CONSTRAINT "theory_tests_course_id_organization_id_fkey" FOREIGN KEY ("course_id", "organization_id") REFERENCES "courses"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_questions" ADD CONSTRAINT "theory_questions_test_id_organization_id_fkey" FOREIGN KEY ("test_id", "organization_id") REFERENCES "theory_tests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "theory_answer_options" ADD CONSTRAINT "theory_answer_options_question_id_test_id_fkey" FOREIGN KEY ("question_id", "test_id") REFERENCES "theory_questions"("id", "test_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "theory_tests" ADD CONSTRAINT "theory_tests_passing_score_check" CHECK (
    "passing_score" BETWEEN 1 AND 100
);

ALTER TABLE "theory_tests" ADD CONSTRAINT "theory_tests_time_limit_check" CHECK (
    "time_limit_minutes" IS NULL OR "time_limit_minutes" BETWEEN 1 AND 240
);
