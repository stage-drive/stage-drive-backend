-- Тест уроку (MVP 2.1): тип кожного питання, цикли спроб, лічильники результату
-- і один актуальний (не ARCHIVED) тест на урок.

-- 1. Тип питання. Раніше формат задавав увесь тест. Наявні питання успадковують format тесту,
--    знімки питань у спробах беруть format спроби. Нові питання задають type самі.
ALTER TABLE "theory_questions" ADD COLUMN "type" "TheoryTestFormat";

UPDATE "theory_questions" AS q
SET "type" = t."format"
FROM "theory_tests" AS t
WHERE t."id" = q."test_id";

ALTER TABLE "theory_questions" ALTER COLUMN "type" SET NOT NULL;

ALTER TABLE "theory_test_attempt_questions" ADD COLUMN "type" "TheoryTestFormat";

UPDATE "theory_test_attempt_questions" AS q
SET "type" = a."format"
FROM "theory_test_attempts" AS a
WHERE a."id" = q."attempt_id";

ALTER TABLE "theory_test_attempt_questions" ALTER COLUMN "type" SET NOT NULL;

-- 2. Спроба: цикл, номер у циклі і лічильники перевіреного результату.
--    cycle — «підхід» до тесту: після вичерпаних спроб і повторного проходження уроку
--    починається новий цикл з новими спробами, стара історія лишається.
ALTER TABLE "theory_test_attempts"
    ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "correct_count" INTEGER,
    ADD COLUMN "total_questions" INTEGER;

-- Наявні спроби: усі в першому циклі, номер за порядком старту.
UPDATE "theory_test_attempts" AS a
SET "attempt_number" = ranked."rn"
FROM (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "student_id", "test_id"
            ORDER BY "started_at", "id"
        ) AS "rn"
    FROM "theory_test_attempts"
) AS ranked
WHERE ranked."id" = a."id";

-- Перевірені спроби: скільки питань у знімку і скільки відповіли точно
-- (обрана множина варіантів збігається з множиною правильних).
UPDATE "theory_test_attempts" AS a
SET
    "total_questions" = counted."total",
    "correct_count" = counted."correct"
FROM (
    SELECT
        q."attempt_id",
        COUNT(*) AS "total",
        COUNT(*) FILTER (
            WHERE NOT EXISTS (
                SELECT 1
                FROM "theory_test_attempt_options" AS o
                WHERE o."question_id" = q."id"
                  AND o."is_correct" IS DISTINCT FROM EXISTS (
                      SELECT 1
                      FROM "theory_test_attempt_selections" AS s
                      WHERE s."option_id" = o."id"
                  )
            )
        ) AS "correct"
    FROM "theory_test_attempt_questions" AS q
    GROUP BY q."attempt_id"
) AS counted
WHERE counted."attempt_id" = a."id"
  AND a."status" IN ('PASSED', 'FAILED');

ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_cycle_check" CHECK (
    "cycle" >= 1 AND "attempt_number" >= 1
);

ALTER TABLE "theory_test_attempts" ADD CONSTRAINT "theory_test_attempts_counts_check" CHECK (
    ("correct_count" IS NULL AND "total_questions" IS NULL)
    OR (
        "correct_count" IS NOT NULL
        AND "total_questions" IS NOT NULL
        AND "correct_count" BETWEEN 0 AND "total_questions"
    )
);

-- 3. Поточний цикл спроб тесту уроку для студента. Новий цикл відкриває повторне проходження уроку,
--    коли всі спроби поточного циклу витрачено.
ALTER TABLE "course_lesson_completions" ADD COLUMN "test_cycle" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "course_lesson_completions" ADD CONSTRAINT "course_lesson_completions_test_cycle_check" CHECK (
    "test_cycle" >= 1
);

-- 4. Один актуальний тест на урок. Архівні тести не рахуються, тож уроку можна створити новий тест.
DROP INDEX "theory_tests_course_lesson_id_key";

CREATE INDEX "theory_tests_course_lesson_id_idx" ON "theory_tests"("course_lesson_id");

CREATE UNIQUE INDEX "theory_tests_one_active_per_lesson_idx"
ON "theory_tests" ("course_lesson_id")
WHERE "course_lesson_id" IS NOT NULL AND "publication_status" <> 'ARCHIVED';
