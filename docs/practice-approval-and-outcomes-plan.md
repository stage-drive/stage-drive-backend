# Практика: підтвердження бронювання, заглушка оплати, допуск після теорії, результати занять

План трьох наступних PR після обчислених слотів і бронювання (#82–#84). Стан: **PR 1 реалізовано**
(підтвердження бронювання, заглушка оплати, виправлення); PR 2 і PR 3 — ще план.
Загальний опис практики — [practice-scheduling-overview.md](practice-scheduling-overview.md).

## Навіщо

Порівняння з вимогами до практики (3.1, ролі, 4.1) і тікетом на бронювання показує прогалини:

- **Підтвердження.** Бронювання студента одразу стає запланованим заняттям. Потрібно, щоб інструктор підтверджував
  чи відхиляв запит, а статус бронювання зберігався в БД.
- **Оплата.** Її немає зовсім. Поки що — жорстко «оплачено».
- **Допуск.** Допуск до практики не вимагає завершеної теорії. Без допуску студент отримує `409` з іншим текстом, ніж у
  вимогах. Студент скасовує заняття за 24 години, а за вимогами — за 2.
- **Після заняття.** Немає «заняття проведено», неявки, коментаря інструктора і практичного прогресу.

## Прийняті рішення

| Питання | Рішення |
|---|---|
| Завершення теорії | новий `TrainingStatus.THEORY_COMPLETED`; ставить ADMIN вручну; обов'язковий перед `PRACTICE`. Зарахування в групу при цьому стає `COMPLETED` |
| Авто слота | лишається авто, яке ADMIN закріпив за студентом під час допуску |
| Прогрес | лише лічильники (без відсотка й норми) |
| Коментар інструктора | бачить і студент |
| Інструктор не відповів на запит | автоматичне відхилення за 2 години до початку; бронювати — щонайменше за 3 години |
| Оплата | поле `paymentStatus` на занятті, поки завжди `PAID`; ставить один сервіс-заглушка |

## Як зробити ідеї кращими

**Підтвердження інструктором** — так, з такими доповненнями (усе в PR 1):

1. **Запит, що чекає підтвердження, тримає час.** Інакше два студенти просять ту саму годину, інструктор підтверджує
   обидва, і друге підтвердження падає на конфлікті. Це нічого не коштує: такий запит лишається
   `status = SCHEDULED`, тож усі наявні перевірки конфліктів, правило «одне заняття» і `409` недоступності вже бачать
   його як зайнятий час.
2. **Дедлайн,** щоб мовчазний інструктор не блокував години: запит відхиляється автоматично за 2 години до початку,
   а бронювати можна щонайменше за 3 години. Так в інструктора завжди є хоча б година на відповідь.
3. **ADMIN теж підтверджує й відхиляє** — коли інструктор захворів чи не відповідає. Заняття, які створює ADMIN,
   одразу підтверджені.
4. **Студент відкликає запит у будь-який момент до початку.** Правило 2 годин діє лише для підтвердженого заняття.
5. **Один статус для клієнтів:**
   `bookingStatus: PENDING | CONFIRMED | REJECTED | CANCELLED | COMPLETED (| NO_SHOW після PR 3)`. Фронтенду не треба
   складати його з кількох полів.
6. **Поза скоупом:** лист інструктору про новий запит (`MailService` уже є). Поки що «вхідні» інструктора —
   `GET /lessons/practice?confirmationStatus=PENDING`.

**Оплата.** Заглушка — одне місце, а не літерали по коду. `PracticePaymentService.resolveForBooking()` сьогодні
повертає `PAID`. Пізніше він перевірятиме пакет чи рахунок і повертатиме `UNPAID` або кидатиме `409 PAYMENT_REQUIRED`.
Заняття зберігає `paymentStatus`, тож поле вже є в API і майбутніх звітах.

## Порядок PR

1. **PR 1 (наступний):** підтвердження бронювання, заглушка оплати, виправлення бронювання.
2. **PR 2:** `THEORY_COMPLETED` і допуск лише після теорії.
3. **PR 3:** результати занять (проведено, неявка, коментар) і практичний прогрес.

Кожен PR — з тестами сервісів і DTO, інтеграційними тестами та оновленням
[practice-scheduling-overview.md](practice-scheduling-overview.md).

---

## PR 1: підтвердження бронювання + заглушка оплати + виправлення ✅

Відхилення від плану під час реалізації:
- CHECK не вимагає `confirmed_at` для `CONFIRMED`: інакше ламалася б вставка з `@default` (тести, імпорт). Сервіси
  завжди заповнюють `confirmed_at`, наявні рядки — з міграції (`confirmed_at = created_at`).
- Дашборд студента показує лише теорію, тож `bookingStatus` додано тільки дашборду інструктора.
- Метод заглушки оплати — `PracticePaymentService.resolveForLesson` (його викликає і бронювання, і створення адміном).

### Схема (`prisma/schema.prisma`, міграція `add_booking_confirmation`)

```prisma
enum BookingConfirmation { PENDING CONFIRMED REJECTED }
enum PaymentStatus { UNPAID PAID }

model DrivingLesson {
  // …наявні поля
  confirmationStatus BookingConfirmation @default(CONFIRMED) @map("confirmation_status")
  confirmedAt        DateTime?           @map("confirmed_at")
  confirmedById      String?             @map("confirmed_by_id") @db.Uuid
  confirmedBy        User?               @relation("ConfirmedDrivingLessons", fields: [confirmedById], references: [id], onDelete: SetNull)
  /// Заглушка оплати: поки завжди PAID (PracticePaymentService).
  paymentStatus      PaymentStatus       @default(PAID) @map("payment_status")
  @@index([confirmationStatus, scheduledAt])   // «вхідні» інструктора і фонове відхилення
}
```

- **Міграція:** для наявних рядків `confirmed_at = created_at`.
- **CHECK** (вручну, як CHECK скасування в `harden_lesson_schema`):
  - `REJECTED → status = 'CANCELLED'`;
  - `PENDING → confirmed_at IS NULL AND status <> 'COMPLETED'`;
  - `CONFIRMED → confirmed_at IS NOT NULL`.
- **Зворотний зв'язок:** `User.confirmedDrivingLessons`.

### Поведінка

- **Бронювання** (`PracticeLessonsService.book`): заняття створюється з `confirmationStatus: PENDING` і
  `paymentStatus` від `PracticePaymentService`. Початок — щонайменше за `BOOKING_MIN_LEAD_HOURS = 3` (інакше `409`).
  `GET /lessons/practice/available` не показує слоти раніше за `now + 3 год`.
- **Створення адміном** (`LessonsService.createPractice`): одразу `CONFIRMED`, `confirmedAt = now`,
  `confirmedById = admin`; `paymentStatus` — від тієї самої заглушки.
- **Новий `PracticeLessonWorkflowService`** для дій над заняттям, щоб не розростався `lessons.service.ts` (~930 рядків).
  `practiceLessonSelect` і `lockPracticeForChange` переїжджають з `LessonsService` у спільний `practice-lesson-row.ts`:
  обидва сервіси блокують заняття (`FOR UPDATE`) і дають `404`/`403` однаково.
  - **`POST /lessons/practice/:id/confirm`** (інструктор заняття, ADMIN):
    1. Заблокувати рядок.
    2. Заняття `SCHEDULED + PENDING`, інакше `409` з `currentStatus`.
    3. `now < початок − 2 год`, інакше `409` «Запит прострочено».
    4. Ще раз `requireInstructor` і `requirePracticeCar` з `practice-rules.ts`.
    5. Записати `CONFIRMED`, `confirmedAt`, `confirmedById`.
  - **`POST /lessons/practice/:id/reject { reason? }`** (інструктор заняття, ADMIN): лише `SCHEDULED + PENDING`.
    `status = CANCELLED`, `REJECTED` і поля аудиту скасування. Причина за замовчуванням —
    «Інструктор відхилив запит».
  - **Маршрути** — у `PracticeLessonsController` (`/lessons/practice`); з `practice/:id/cancel` у `LessonsController`
    вони не конфліктують.
- **Фонове відхилення — новий `PracticeRequestExpiryJob`.** За зразком `InvitationEmailQueue`
  ([invitation-email.queue.ts](../src/modules/invitations/invitation-email.queue.ts)): `setInterval` раз на 60 с,
  `unref`, захист від повторного входу. Кожен запуск — один атомарний `UPDATE … RETURNING id`: рядки з
  `confirmation_status = 'PENDING' AND status = 'SCHEDULED' AND scheduled_at <= now() + interval '2 hours'` стають
  `CANCELLED/REJECTED` з причиною «Інструктор не підтвердив запит вчасно» і `cancelled_by_id = NULL`.
  - Безпечно для кількох екземплярів застосунку: блокування рядка і повторна перевірка `WHERE`.
  - Гонка з підтвердженням: хто першим заблокував рядок, той і виграв; інший отримує `409` чи пропускає рядок.
- **Скасування студентом** (`LessonsService.cancelPractice`): `PENDING` — у будь-який момент до початку;
  `CONFIRMED` — не пізніше ніж за `STUDENT_CANCEL_MIN_HOURS = 2` години (було 24).
- **Скасування інструктором без причини** зберігає «Не можу провести заняття» (вимога 3.1).
- **Без допуску — `403`** на `available` і `book`, коли `trainingStatus !== PRACTICE`, з повідомленням
  «Немає доступу. Пройдіть курс теорії та отримайте допуск до практики.» Створення адміном лишає `409`.
- **`GET /lessons/practice`** відкривається для INSTRUCTOR (лише свої заняття; чужий `instructorId` — `403`) і
  отримує фільтр `confirmationStatus`. Це «вхідні» запити інструктора.

### Відповіді API

- **`PracticeLessonDto`:** + `confirmationStatus`, `paymentStatus`, `confirmedAt` і похідний `bookingStatus`. DTO
  будує `toPracticeLessonDto` ([lesson-view.ts](../src/modules/lessons/lesson-view.ts)) з `practiceLessonViewSelect`,
  тож поля отримають заняття, `/lessons/me`, список для ADMIN і бронювання.
- **Дашборди:** `bookingStatus` у `InstructorDashboardLessonDto` і `StudentDashboardLessonDto`, плюс лічильник
  `pendingRequests` на дашборді інструктора.
- **Swagger:** нові ендпоінти й усі `409`.

### Файли

- **Нові:** `practice-lesson-workflow.service.ts`, `practice-lesson-row.ts`, `practice-payment.service.ts`,
  `practice-request-expiry.job.ts` і їхні тести.
- **Змінені:** `lessons.service.ts`, `practice-lessons.service.ts`, `practice-lessons.controller.ts`,
  `practice-lessons.dto.ts`, `lessons.dto.ts`, `lesson-view.ts`, `lessons.module.ts`, DTO і сервіс дашбордів, схема
  й міграція.

---

## PR 2: `THEORY_COMPLETED`

- **Enum:** `THEORY_COMPLETED` у `TrainingStatus` (міграція `ALTER TYPE … ADD VALUE`).
- **Переходи** (`TRAINING_STATUS_TRANSITIONS` у [students.service.ts](../src/modules/students/students.service.ts)):
  - `ACTIVE → THEORY_COMPLETED` через наявний `PATCH /students/:id/status` (ADMIN);
  - `THEORY_COMPLETED → GRADUATED | DROPPED | ARCHIVED`;
  - `→ PRACTICE` лише через `PATCH /students/:id/practice-access`, як і зараз.
- **`isEligibleForPractice`:** приймає `THEORY_COMPLETED` (або `PRACTICE` — для переприв'язки інструктора чи авто)
  замість `ACTIVE`. Нове повідомлення: «Допуск до практики — лише після завершення теорії (THEORY_COMPLETED).»
- **`enrollmentStatusForTraining(THEORY_COMPLETED)` → `COMPLETED`:** майбутня теорія групи зникає з розкладу студента
  й перестає блокувати його практичні слоти.
- **Вичерпні мапи:** виправити кожен `Record<TrainingStatus, …>`, на який вкаже компілятор (students, users,
  invitations, cars, приклади в DTO).
- **Дані:** студентів у `ACTIVE`, які чекають на практику, ADMIN має перевести в `THEORY_COMPLETED`. Студентів у
  `PRACTICE` це не зачіпає.

---

## PR 3: результати занять + практичний прогрес

- **Схема:**
  - `NO_SHOW` у `LessonStatus` з `CHECK` на `lessons`, щоб теорія його не використовувала;
  - `completedAt`, `completedById` і `instructorComment VarChar(1000)` у `driving_lessons`.
- **`POST /lessons/practice/:id/complete { comment? }`** (інструктор заняття, ADMIN): лише `SCHEDULED + CONFIRMED`, і
  заняття вже почалося. Статус стає `COMPLETED`.
- **`POST /lessons/practice/:id/no-show { comment? }`:** ті самі правила, статус `NO_SHOW`.
- **`PATCH /lessons/practice/:id/comment { comment }`** (інструктор заняття, ADMIN). Коментар є в
  `PracticeLessonDto`, тож його бачить і студент.
- **Прогрес, лише лічильники:**
  - `GET /lessons/practice/progress/me` (STUDENT) і `GET /students/:id/practice-progress` (ADMIN);
  - повертає `completedLessons`, `completedMinutes`, `noShows`, `cancelled`, `upcoming` (очікують + підтверджені),
    `lastCompletedAt`;
  - один `groupBy` по `driving_lessons`.
- **Без змін:** перевірки конфліктів і зайнятості дивляться лише на `SCHEDULED`, тож проведені заняття й неявки час
  не блокують.

---

## Перевірка (для кожного PR)

- **Unit:** `npx jest` для нових і змінених тестів сервісів, DTO й контролерів.
  - PR 1: межа рівно на «початок − 2 год»; відкликання запиту проти скасування підтвердженого заняття за 2 години;
    текст `403`; фільтр «вхідних» інструктора.
- **Інтеграційні:** `npm run test:integration` (testcontainers), розширення
  [lesson-schedule.integration-spec.ts](../test/integration/lesson-schedule.integration-spec.ts):
  - запит, що чекає підтвердження, блокує час для іншого студента;
  - гонка підтвердження й фонового відхилення: виграє рівно одне;
  - фонове відхилення зачіпає лише прострочені запити;
  - CHECK відхиляють `REJECTED + SCHEDULED` і `PENDING + COMPLETED`;
  - відхилення звільняє час;
  - PR 2: допуск для `ACTIVE` відхиляється, для `THEORY_COMPLETED` — проходить, зарахування стає `COMPLETED`.
- **Збірка й лінт:** `npm run build`, eslint і prettier на змінених файлах.
- **Swagger для PR 1:**
  1. Студент бронює → `bookingStatus: PENDING`.
  2. Інструктор бачить запит у `GET /lessons/practice?confirmationStatus=PENDING`.
  3. Інструктор підтверджує → `CONFIRMED`.
  4. Інше бронювання без відповіді стає `REJECTED` протягом хвилини після «початок − 2 год».
