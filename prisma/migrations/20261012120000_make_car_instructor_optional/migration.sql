-- Призначення інструктору можна скасувати: автомобіль лишається в автошколі без інструктора.
ALTER TABLE "cars" ALTER COLUMN "instructor_id" DROP NOT NULL;
