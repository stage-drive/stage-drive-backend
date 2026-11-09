-- Навчальний статус «теорію завершено»: ставить ADMIN, і лише з нього можна надати допуск до практики.
-- BEFORE 'PRACTICE' — щоб порядок значень у БД збігався з порядком у schema.prisma (ORDER BY за статусом).
-- Нове значення в цій міграції не використовується, тож ADD VALUE безпечний і всередині транзакції.

-- AlterEnum
ALTER TYPE "TrainingStatus" ADD VALUE 'THEORY_COMPLETED' BEFORE 'PRACTICE';
