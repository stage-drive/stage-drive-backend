-- Ліміт спроб тесту. null — без обмеження.
ALTER TABLE "theory_tests" ADD COLUMN "max_attempts" INTEGER;

ALTER TABLE "theory_tests" ADD CONSTRAINT "theory_tests_max_attempts_check" CHECK (
    "max_attempts" IS NULL OR "max_attempts" BETWEEN 1 AND 20
);

-- Актуальний результат курсу вказує на тест і спробу, з яких його пораховано.
-- Повторна перевірка оновлює той самий рядок: attempt_id унікальний.
ALTER TABLE "theory_test_results" ADD COLUMN "test_id" UUID;
ALTER TABLE "theory_test_results" ADD COLUMN "attempt_id" UUID;

CREATE UNIQUE INDEX "theory_test_results_attempt_id_key" ON "theory_test_results"("attempt_id");
CREATE INDEX "theory_test_results_test_id_idx" ON "theory_test_results"("test_id");

ALTER TABLE "theory_test_results" ADD CONSTRAINT "theory_test_results_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "theory_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "theory_test_results" ADD CONSTRAINT "theory_test_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "theory_test_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
