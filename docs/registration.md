# Реєстрація автошколи (Module 1) — що реалізовано

`POST /api/auth/register` створює `Organization` + `User` (роль `OWNER`) атомарно, без запрошень і активації. Деталі бізнес-правил — у [CLAUDE.md](../CLAUDE.md).

## Що додано

### 1. Схема БД (`prisma/schema.prisma`)

Оригінальна схема не покривала специфікацію з CLAUDE.md, тому додано:

- `Organization`: `slug` (унікальний), `email`, `phone`, `address`, `status`
- `User`: `status`
- `UserRole`: додано `ADMIN`, `TEACHER` (було лише `OWNER`, `INSTRUCTOR`, `STUDENT`)

Міграція: `prisma/migrations/20260822161102_add_registration_fields/`.

### 2. `RegisterDto` / `RegisterResponseDto` — [auth.dto.ts](../src/modules/auth/auth.dto.ts)

Вхідний payload точно за специфікацією (`organizationName`, `firstName`, `lastName`, `email`, `phone?`, `password`, `passwordConfirmation`, `termsAccepted`). **Поля `role` немає навмисно** — CLAUDE.md вимагає, щоб роль неможливо було передати ззовні; спроба надіслати `role` у тілі запиту відхиляється на рівні `ValidationPipe` (`forbidNonWhitelisted`).

Відповідь:
```json
{
  "user": { "id", "firstName", "lastName", "email", "role", "status", "organizationId" },
  "accessToken": "...",
  "refreshToken": "..."
}
```

### 3. Валідація — `class-validator` / `class-transformer`

Раніше в проєкті не було валідації запитів взагалі. Додано:

- Пакети `class-validator`, `class-transformer`.
- Глобальний `ValidationPipe` у [configure-app.ts](../src/configure-app.ts): `whitelist`, `forbidNonWhitelisted`, `transform`, `stopAtFirstError`.
- Декоратори на **всіх** DTO проєкту (`auth.dto.ts`, `organization.dto.ts`, `users.dto.ts`), не лише на реєстрації — для узгодженості формату помилок в усьому API.
- Кастомний декоратор [`@Match`](../src/common/validators/match.decorator.ts) — звіряє `passwordConfirmation` з `password` (у `class-validator` немає вбудованого «поле A = поле B»).

**Важливий нюанс:** легасі TS-декоратори на властивостях реєструються знизу вгору (bottom-to-top), тобто нижній у списку декоратор валідується першим. Тому декоратор «обов'язкове поле» (`@IsNotEmpty`) свідомо розміщений найнижче (найближче до імені поля) — інакше при порожньому значенні спрацьовувало б повідомлення про формат (`@IsEmail`, `@MaxLength`), а не про «поле не заповнене».

### 4. Формат помилок валідації — [field-error.ts](../src/common/validation/field-error.ts)

За замовчуванням Nest повертає помилки масивом рядків, без прив'язки до конкретного поля форми. Замінено на `exceptionFactory`, що перетворює помилки в:
```json
{ "statusCode": 400, "errors": [{ "field": "email", "message": "Введіть коректний email." }] }
```
Це відповідає вимозі «На формі: …» — фронтенд може напряму мапити `field` на конкретний input.

### 5. Помилки реєстрації (REG-E01…E05)

| Код | Умова | HTTP | Повідомлення |
|---|---|---|---|
| REG-E01 | email вже існує | 409 | «Користувач з таким email уже існує.» |
| REG-E02 | некоректний email | 400 | «Введіть коректний email.» |
| REG-E03 | паролі не співпадають | 400 | «Паролі не співпадають.» |
| REG-E04 | не заповнене обов'язкове поле | 400 | «Заповніть обов'язкове поле.» |
| REG-E05 | помилка створення OWNER | — | `Organization` і `User` створюються в одній `prisma.$transaction` — якщо `User.create` падає, `Organization` теж не зберігається (Prisma сама відкочує транзакцію) |

REG-E01 виявляється через `P2002` (унікальне порушення на `email`) — [auth.service.ts](../src/modules/auth/auth.service.ts). У Prisma 7 з `@prisma/adapter-pg` назва поля-порушника лежить не в класичному `meta.target`, а в `meta.driverAdapterError.cause.constraint.fields` — `uniqueConstraintFields()` враховує обидва варіанти.

### 6. `slug` організації — [slug.ts](../src/modules/auth/slug.ts)

`organizationName` довільний (кирилиця, пробіли), а `slug` має бути унікальним URL-friendly рядком. `slugify()` транслітерує кирилицю в латиницю і прибирає все, крім `a-z0-9-`. При колізії `slug` (`P2002` на полі `slug`) `register()` повторює спробу з випадковим суфіксом (`randomSlugSuffix()`), до 5 разів.

### 7. Токени — [token.ts](../src/modules/auth/token.ts)

Раніше існував лише один тип токена. Додано розрізнення `type: 'access' | 'refresh'`, зашите у payload і перевірене при верифікації:
- `accessToken` — TTL 7 днів (без змін), перевіряється `AuthGuard` для захищених ендпоінтів.
- `refreshToken` — TTL 30 днів, поки виключно повертається клієнту; ендпоінта `/auth/refresh` для його обміну ще немає.

Без розрізнення типу довгоживучий `refreshToken` можна було б підставити в `Authorization: Bearer` і використовувати як `accessToken` — тепер `AuthGuard` це відхилить.

## Що свідомо не робили (поза межами задачі)

- Немає `/auth/refresh` ендпоінта (тільки видача токена).
- Ручні перевірки в `AuthService.register()` (обов'язкові поля, довжина пароля, збіг підтвердження) прибрані — тепер це повністю відповідальність `RegisterDto` + `ValidationPipe`.
- Логін (`/auth/login`) поза Module 1 за CLAUDE.md, тому не чіпали, крім сумісності з новим форматом токенів.
