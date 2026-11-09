-- Слоти практики більше не зберігаються: вільний час рахується з робочого графіка інструктора
-- (instructor_working_hours) мінус недоступність і заплановані заняття. На practice_slots ніщо
-- не посилається (slot_id так і не з'явився), тож історія занять не втрачається.
-- Унікальний індекс cars(id, organization_id) лишається: це ціль для майбутніх складених FK.

-- DropForeignKey
ALTER TABLE "practice_slots" DROP CONSTRAINT "practice_slots_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "practice_slots" DROP CONSTRAINT "practice_slots_instructor_id_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "practice_slots" DROP CONSTRAINT "practice_slots_car_id_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "practice_slots" DROP CONSTRAINT "practice_slots_created_by_id_fkey";

-- DropTable (разом з CHECK practice_slots_duration_min_check та індексами)
DROP TABLE "practice_slots";

-- Практичне заняття триває 120 хвилин; збігається з PRACTICE_DEFAULT_DURATION_MIN у lessons.dto.ts.
ALTER TABLE "driving_lessons" ALTER COLUMN "duration_min" SET DEFAULT 120;
