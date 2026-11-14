# Модуль 13. Оплати (MVP 2.1)

## Мета

ADMIN веде облік оплат студентів своєї автошколи, студент бачить власний статус. Це не платіжна система: без
еквайрингу, банків і рахунків. Кожна оплата — окремий запис; історія не перезаписується і не видаляється.
Теорію проходять і з `NOT_PAID`, а **практику записують лише з актуальним статусом `PAID`**, інакше
`422 «Немає доступу до практики. Очікується оплата.»`.

## Рішення

| Питання | Рішення |
|---|---|
| Хто веде оплати | OWNER і ADMIN своєї автошколи. TEACHER та INSTRUCTOR оплат не бачать (і в списку та картці студента — `null`). STUDENT — лише власні |
| Актуальний статус | `status` останнього `Payment` студента за `createdAt`; без оплат — `NOT_PAID`. Вказівник — `Student.currentPaymentId` |
| Переходи статусу | лише `NOT_PAID → PAID`; `PAID` фінальний (`409`). Помилку в підтвердженій оплаті виправляють новим записом — він стає актуальним |
| `Payment.studentId` | id **користувача**-студента, як у `DrivingLesson`, `Enrollment` і `/students/:id` (у PRD — `Student.id`) |
| Статуси | один enum `PaymentStatus { NOT_PAID, PAID }` — і для `Payment`, і для знімка `DrivingLesson.paymentStatus`. `UNPAID` перейменовано на `NOT_PAID` |
| Журнал | `PaymentHistory` з `action`: `CREATED`, `STATUS_CHANGED`, `UPDATED` (+ `changes` «було → стало» для суми, валюти, дати, призначення, коментаря) |
| Призначення платежу | `purpose` — обовʼязковий текст до 255 символів («Курс теорії», «Практика, 10 годин»); бачить і студент. `comment` — службова примітка ADMIN, студенту не повертається |
| Повторні запити | `POST /payments` приймає заголовок `Idempotency-Key`: повтор з тим самим ключем і даними повертає ту саму оплату, з іншими даними — `409`. Ключ унікальний у межах автошколи |
| Сума | `DECIMAL(12,2)`; в API приймається числом (до 2 знаків), повертається рядком `"5000.00"` |
| Дата оплати | `paidAt` — лише для `PAID`; не в майбутньому за календарем автошколи (`Organization.timezone`) і не раніше 2000-01-01 |
| Розгортання | перевірка оплати діє одразу: студенти без оплат не записуються на практику, доки ADMIN не внесе оплату |

## Модель даних

- **`payments`**: `organization_id`, `student_id`, `amount`, `currency` (ISO 4217, за замовчуванням `UAH`), `status`,
  `paid_at`, `purpose`, `comment`, `created_by_id`, `idempotency_key`, `request_hash`, `created_at`, `updated_at`.
- **`payment_history`**: `payment_id`, `action`, `previous_status`, `new_status`, `changes` (JSONB), `changed_by_id`,
  `changed_at`, `comment`.
- **`students.current_payment_id`** — остання оплата студента.

Цілісність у БД (міграції `20261114180000_add_payments` і `20261114200000_payment_purpose_idempotency`):

- Складені FK `(student_id | created_by_id | changed_by_id, organization_id) → users(id, organization_id)` і
  `(payment_id, organization_id) → payments(id, organization_id)`: запис не прив'язати до іншої автошколи.
- Складений FK `(current_payment_id, user_id) → payments(id, student_id)`: вказівник веде лише на оплату свого
  студента. Тому код не перевіряє вказівник вручну.
- CHECK: `amount >= 0`, для `PAID` — `amount > 0`; `paid_at` є тоді й лише тоді, коли `status = PAID`; `currency` —
  три латинські літери; `purpose` не з самих пробілів; `idempotency_key` і `request_hash` — разом або жодного; у журналі
  `previous_status` порожній лише для `CREATED`, а `STATUS_CHANGED` завжди змінює статус.
- Унікальний індекс `(organization_id, idempotency_key)`; записи без ключа між собою не конфліктують.
- Друга міграція заповнює `purpose` наявних записів значенням «Оплата навчання» і прибирає default.
- Люди — `RESTRICT` (студента з оплатами не видалити), автошкола — `CASCADE`.

## API

| Метод | Шлях | Ролі | Опис |
|---|---|---|---|
| GET | `/api/payments` | OWNER, ADMIN | Студенти з актуальним статусом і останньою оплатою (UC-001). `search`, `status`, `groupId`, `sortBy` (`lastName`, `firstName`, `paidAt`, `createdAt`), `sortOrder`, `page`, `limit` |
| GET | `/api/payments/records` | OWNER, ADMIN | Окремі записи оплат зі студентом і `isCurrent`. `studentId`, `status` (статус запису), `groupId`, `search`, `[paidFrom, paidTo)`, `sortBy` (`createdAt`, `paidAt`, `amount`), `sortOrder`, `page`, `limit` |
| GET | `/api/payments/history` | OWNER, ADMIN | Журнал змін: `studentId`, `paymentId`, `action`, `[from, to)` |
| GET | `/api/payments/{id}` | OWNER, ADMIN | Оплата, студент і журнал цієї оплати |
| POST | `/api/payments` | OWNER, ADMIN | Нова оплата (`purpose` обовʼязкове; за замовчуванням `PAID`, `UAH`); необовʼязковий заголовок `Idempotency-Key` |
| PATCH | `/api/payments/{id}` | OWNER, ADMIN | Сума, валюта, дата, призначення, коментар |
| PATCH | `/api/payments/{id}/status` | OWNER, ADMIN | `NOT_PAID → PAID` (`paidAt` за замовчуванням — зараз) |
| GET | `/api/students/{id}/payments` | OWNER, ADMIN | Статус, остання оплата, суми `PAID` за валютами, історія (UC-006) |
| GET | `/api/me/payments` | STUDENT | Те саме для себе, без службового коментаря (UC-004) |

Також: `GET /api/students` — `paymentStatus` у рядку і фільтр `paymentStatus` (`NOT_PAID` включає студентів без
оплат; для TEACHER/INSTRUCTOR фільтр — `403`); `GET /api/students/{id}` і `/students/me` — розділ `payments` у тому
самому форматі, що й `/students/{id}/payments`.

Чужа автошкола — `404`, як в інших модулях. `organizationId` завжди береться з токена; у тілі — `400`.

## Перевірка під час запису практики

`PracticePaymentService.resolveForLesson` — єдине місце рішення. Його викликають бронювання студента
(`POST /lessons/practice/book`) і створення заняття адміном (`POST /lessons/practice`) — в тій самій транзакції,
**після** advisory-ключів практики і **до** пошуку конфліктів: студент без оплати бачить `422`, а не `409`.

Усі записи оплат беруть ключ `student:<id>` — той самий, що бронювання. Тому статус не зміниться між перевіркою і
створенням заняття (інтеграційний тест «waits for a booking that holds the student lock»).

## Ідемпотентне створення

Фронтенд генерує новий ключ (UUID) на кожну нову оплату й передає його в `Idempotency-Key`; при повторі (подвійний
клік, повтор після обриву мережі) — той самий ключ. Сервер зберігає ключ і SHA-256 нормалізованого тіла
(`5000` і `5000.00`, `2026-08-10` і `2026-08-10T00:00:00Z` — той самий запит):

- ключ уже є і тіло те саме — `201` з уже створеною оплатою, без нового запису й події в журналі;
- ключ уже є, тіло інше — `409`;
- ключ некоректний (не 8–128 символів `[A-Za-z0-9_.:-]`) — `400` з `field: "Idempotency-Key"`;
- без заголовка — звичайне створення.

Паралельні повтори для того самого студента серіалізуються блокуванням студента. Той самий ключ одночасно для різних
студентів ловить унікальний індекс: один запит створює оплату, другий отримує `409`.

## Логування

`Payment created | updated | status changed | create replayed` з paymentId, studentId, статусами, полями, actorId,
organizationId; повторне використання ключа з іншими даними — `warn`.
Невдалі спроби: `RolesGuard` пише `Access denied method= path= userId= role= organizationId=` для всіх модулів,
сервіс — `Payment access denied reason=role|not_found|student_not_found`.

## Seed

`student@example.com` має оплату `PAID` (після допуску до практики може бронювати), `grouped-student@example.com` —
запис `NOT_PAID` (бронювання → `422`), решта — без оплат. Повторний seed не дублює записи.

## Поза скоупом

Сповіщення студента про зміну статусу (модуля сповіщень ще немає) · повторна перевірка оплати, коли інструктор
підтверджує запит `PENDING` · `PARTIALLY_PAID`, `REFUNDED`, `CANCELLED` · видалення знімка `DrivingLesson.paymentStatus`
(разом з `paidHours`, які досі рахуються з нього).

## Тести

- Юніт: `payments.dto.spec.ts`, `payments.service.spec.ts`, `payments.controller.spec.ts`,
  `payment-idempotency.spec.ts`, `practice-payment.service.spec.ts`, оновлені специфікації студентів, занять і `RolesGuard`.
- Інтеграційні (`test/integration/payments.integration-spec.ts`, справжній Postgres): CHECK і FK з міграції, журнал,
  конкурентні записи, фільтри й сортування за останньою оплатою, список записів, ідемпотентні повтори (зокрема гонка
  одного ключа для двох студентів), `422` до оплати й успіх після, серіалізація з бронюванням.
