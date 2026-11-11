-- Теоретичне заняття групи може посилатися на урок курсу цієї групи.
ALTER TABLE "lessons" ADD COLUMN "course_lesson_id" UUID;

CREATE INDEX "lessons_course_lesson_id_idx" ON "lessons"("course_lesson_id");

-- Скасоване заняття не займає урок: його можна призначити наступному заняттю групи.
CREATE UNIQUE INDEX "lessons_group_course_lesson_open_key"
ON "lessons" ("group_id", "course_lesson_id")
WHERE "course_lesson_id" IS NOT NULL AND "status" <> 'CANCELLED';

ALTER TABLE "lessons"
ADD CONSTRAINT "lessons_course_lesson_id_fkey"
FOREIGN KEY ("course_lesson_id") REFERENCES "course_lessons"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
