# Practice Slots: план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [lessons-create-implementation.md](lessons-create-implementation.md) і
[lessons-edit-reschedule-implementation.md](lessons-edit-reschedule-implementation.md), перш ніж імплементувати або
рев'ювати цю задачу.

Цей PR додає слот практики — час, який `ADMIN` відкриває для запису: інструктор + авто + інтервал. `ADMIN` створює,
змінює й видаляє слоти, `INSTRUCTOR` переглядає свої. При створенні й зміні сервер перевіряє інструктора, авто,
конфлікти з іншими слотами й заняттями та належність усього до однієї організації. Пошук конфліктів,
advisory-блокування, перевірки інструктора й авто та формат дати-часу вже є й перевикористовуються.

**Потрібна міграція:** таблиця `practice_slots` і унікальні індекси `(id, organization_id)` на `users` і `cars` для
складених FK.

**Що не входить у цей PR** (див. «Наступні PR»): робочий графік і недоступність інструктора, список доступних слотів
для студента, бронювання і переробка ендпоінтів практичних занять. Наявні ендпоінти занять цей PR не змінює.

## Задача

Реалізувати backend API для отримання доступних часових слотів практичних занять з урахуванням розкладу, доступності
інструктора, автомобіля та правил доступу студента.

Acceptance Criteria:

1. реалізовано отримання списку доступних слотів;
2. повертаються актуальні дата та час;
3. враховується доступність інструктора;
4. враховується доступність автомобіля;
5. враховуються зайняті та вже заброньовані слоти;
6. недоступні слоти не повертаються як доступні;
7. враховується доступ студента до практичних занять;
8. реалізована перевірка Authentication + RBAC;
9. дані обмежені відповідною Organization;
10. API повертає коректну структуру даних та error responses.

Тікет закривається кількома PR. Цей PR — перший: без слотів студенту нічого показувати. Що закрито тут, а що далі —
у «Покриття AC».

## Рішення продукту

Зафіксовані під час обговорення задачі. План їх не переглядає.

1. Слоти вручну створює `ADMIN`.
2. При створенні слоту backend перевіряє доступність інструктора й авто, відсутність конфліктів і належність усього до
   однієї організації. Перевірку робочого графіка й тимчасової недоступності додає PR графіка (див. «Наступні PR»).
3. Практичні заняття в майбутньому створюватимуться лише через слоти. У цьому PR слоти й наявні ендпоінти занять
   існують поруч.
4. `INSTRUCTOR` слоти лише переглядає.

## Що вже є, а чого немає

- **Слотів немає.** План cancel прямо каже: «Окремої таблиці бронювань немає». Там слот — це час, який займає
  `SCHEDULED`-заняття. Тепер слот — рішення адміна «цей час відкритий для запису», і порахувати його з інших даних
  неможливо, тож він стає окремою сутністю.
- **Практичні заняття створюються напряму** через `POST /lessons/practice` (`ADMIN` і `INSTRUCTOR`). Цей PR їх не
  чіпає. Слот має не перетинатися з такими заняттями інструктора й авто.
- **Що перевикористовується:**

  | Що | Де | Для чого |
  |---|---|---|
  | `lessonSlot`, `overlaps`, `candidateWindow`, `scheduleConflict`, `sortConflicts`, `LessonConflict` | [schedule-conflicts.ts](../src/modules/lessons/schedule-conflicts.ts) | основа `findSlotConflicts`; тіло `409` |
  | `lockScheduleResources`, `scheduleLockKey`, `lockPracticeLesson` | [schedule-lock.ts:25](../src/common/prisma/schedule-lock.ts#L25), [:55](../src/common/prisma/schedule-lock.ts#L55) | advisory-ключі `instructor:`, `car:`; зразок для `lockPracticeSlot` |
  | `requireInstructor`, `assertInstructorActive`, `requireOrganization` | [lessons.service.ts:992](../src/modules/lessons/lessons.service.ts#L992), [:350](../src/modules/lessons/lessons.service.ts#L350), [:1052](../src/modules/lessons/lessons.service.ts#L1052) | інструктор з організації, роль і статус |
  | `requirePracticeCar` | [lessons.service.ts:1017](../src/modules/lessons/lessons.service.ts#L1017) | зразок для `requireSlotCar` |
  | `resolveRange` | [personal-schedule.service.ts:120](../src/modules/lessons/personal-schedule.service.ts#L120) | вікно `from`/`to` для списку |
  | `lessonPersonSelect`, `toPerson` | [lesson-view.ts](../src/modules/lessons/lesson-view.ts) | інструктор у відповіді без PII |
  | `IsScheduledAt`, `IsLessonDuration`, `IsScheduleBoundary`, `LessonPersonDto`, `LessonCarDto`, `LessonScheduleConflictResponseDto` | [lessons.dto.ts](../src/modules/lessons/lessons.dto.ts) | валідація й DTO; декоратори `Is*` зараз не експортуються, їх треба експортувати |
  | `INSTRUCTOR_CAR_MISMATCH_MESSAGE`, `CAR_NOT_AVAILABLE_MESSAGE`, `CAR_NOT_ASSIGNED_MESSAGE` | [students.service.ts:93](../src/modules/students/students.service.ts#L93) | повідомлення про авто |
  | `roleBindings` | [users.service.ts:207](../src/modules/users/users.service.ts#L207) | блокування зміни ролі інструктора зі слотами |

- Глобальний `ValidationPipe` ([configure-app.ts](../src/configure-app.ts)): `whitelist`, `forbidNonWhitelisted`,
  `transform` без `enableImplicitConversion`, `stopAtFirstError`. Помилки валідації мають форму
  `{ statusCode: 400, errors: [{ field, message }] }`.

## Рішення, зафіксовані цим планом

### Модель даних

1. **Таблиця `practice_slots`:** `organizationId`, `instructorId`, `carId`, `scheduledAt`, `durationMin`
   (за замовчуванням 60), `createdById`, `createdAt`, `updatedAt`. Поля часу названі як у `DrivingLesson`, тож
   `overlaps`, `candidateWindow` і `lessonSlot` працюють зі слотами без змін. `CHECK` тримає тривалість у межах
   15–240, як у занять.
2. **Ні статусу, ні полів бронювання в цьому PR немає.** Їх додає PR бронювання: там з'явиться
   `driving_lessons.slot_id`, і «заброньовано» означатиме, що на слоті є `SCHEDULED`-заняття.
3. **Ізоляція організацій на рівні БД** — складені FK, як `lessons → groups` у міграції `harden_lesson_schema`:
   `(instructor_id, organization_id) → users(id, organization_id)` і `(car_id, organization_id) → cars(id,
   organization_id)`. Для цього `users` і `cars` отримують унікальний індекс `(id, organization_id)`.
4. **Правила видалення:** з організації — `CASCADE`; з інструктора й авто — `RESTRICT`. Після бронювання слот стане
   історією, як і заняття, тож правило береться одразу, щоб не міняти його наступною міграцією.

### Створення і зміна

5. **Створення:** `POST /api/practice-slots` `{ instructorId, carId, scheduledAt, durationMin? }`. Перевірки йдуть у
   такому порядку:

   | # | Перевірка | Помилка |
   |---|---|---|
   | 1 | `scheduledAt` у майбутньому і на цілій хвилині (секунди й мілісекунди нульові) | `400`, `field: 'scheduledAt'` (до БД) |
   | 2 | advisory-ключі `instructor:<id>`, `car:<id>` | — |
   | 3 | інструктор з організації, роль `INSTRUCTOR`, `ACTIVE`, не видалений (`requireInstructor`) | `404` / `409` |
   | 4 | авто з організації, закріплене за цим інструктором, `AVAILABLE` (`requireSlotCar`) | `404` / `409` |
   | 5 | немає інших слотів чи `SCHEDULED`-занять цього інструктора чи авто, що перетинають інтервал (`findSlotConflicts`) | `409` з `conflicts` |

   - Категорія й коробка авто не перевіряються: студента в слоті ще немає. Це робитиме бронювання.
   - Пункти 3–5 ідуть після advisory-ключів. Створення й зміна практичних занять беруть ті самі ключі `instructor:` і
     `car:`, тож паралельне заняття не проскочить між перевіркою і записом слоту.
   - Робочий графік і недоступність тут не перевіряються. PR графіка додасть ці перевірки між пунктами 4 і 5 під тим
     самим ключем `instructor:`.
6. **Зміна:** `PATCH /api/practice-slots/:id` `{ instructorId?, carId?, scheduledAt?, durationMin? }`.
   - Порожнє тіло — `400`.
   - Рядок слоту блокується `FOR UPDATE`, потім читається з фільтром організації (`404`).
   - Слот, що вже почався, не змінюється: `409 SLOT_ALREADY_STARTED_MESSAGE`. Новий `scheduledAt` має бути в
     майбутньому, інакше `400`.
   - Нові значення зливаються з поточними й проходять пункти 2–5 таблиці вище. Сам слот у пошуку конфліктів
     виключається.
   - Якщо нічого не змінилося, відповідь `200` без запису.
7. **Конфлікт зі слотом** у тілі `409` має `lessonType: 'SLOT'`, а в `lessonId` — id слоту. Тип `LessonType` і
   Swagger `LessonConflictDto.lessonType` отримують значення `SLOT`. Конфлікт із заняттям має `lessonType: 'PRACTICE'`,
   як і зараз.
8. **Конфлікти з заняттями — усі `SCHEDULED`-заняття інструктора чи авто.** У цьому PR жодне заняття ще не
   прив'язане до слоту. PR бронювання звузить умову до «занять без слоту», щоб заброньований слот не рахувався двічі.
9. **У зворотний бік не перевіряється.** Наявні ендпоінти занять про слоти не знають, тож заняття можна створити на
   час слоту. Подвійного запису це не дасть: бронювання перевірить конфлікти інструктора й авто, а PR бронювання
   прибере пряме створення занять (відкрите питання 2).

### Читання

10. **Список:** `GET /api/practice-slots?from&to&instructorId&carId` повертає слоти, що перетинають вікно
    `[from, to)`. Вікно рахує `resolveRange`: за замовчуванням від поточного моменту на 30 днів, не довше 62.
    Сортування — за `scheduledAt`, потім за `id`. Відповідь містить `timezone` автошколи, як `GET /lessons/me`.
11. **Один слот:** `GET /api/practice-slots/:id`.
12. **`INSTRUCTOR` бачить лише свої слоти:** список фільтрується за `actor.id`, чужий `instructorId` у query дає
    `403`, чужий слот за `:id` — `403`. Слот іншої організації — `404`.

### Видалення

13. **`DELETE /api/practice-slots/:id` → `204`.** Видалити можна лише слот, що ще не почався, інакше `409`. Видалення
    фізичне: бронювань ще немає, тож історії немає. Коли з'являться бронювання, FK `RESTRICT` з
    `driving_lessons.slot_id` не дасть видалити слот із заняттями, і PR бронювання додасть скасування слоту.

### RBAC, блокування, логи

14. **Ролі:**

    | Дія | `ADMIN` | `INSTRUCTOR` | `STUDENT`, `OWNER`, `TEACHER` |
    |---|---|---|---|
    | створити, змінити, видалити | так | — | — |
    | список, один слот | усі слоти організації | свої | — |

    - Константи: `PRACTICE_SLOT_MANAGE_ROLES = [ADMIN]`, `PRACTICE_SLOT_VIEW_ROLES = [ADMIN, INSTRUCTOR]`.
    - `OWNER` отримує `403`, як у наявних ендпоінтах занять (відкрите питання 1).
    - Сервіс повторює перевірку ролі (`assertRole` з константою ролей), як `assertCanEditPractice`.
15. **Організація береться лише з токена.** Слот, інструктор чи авто іншої організації дають `404`, а не `403`.
    Складені FK не дадуть записати чужого інструктора чи авто, навіть якщо сервіс помилиться.
16. **Порядок блокувань:** спершу рядок слоту (`FOR UPDATE`), потім advisory-ключі, як у `changePractice`.
    - створення: ключі нових інструктора й авто;
    - зміна: слот → ключі нових інструктора й авто;
    - видалення: слот.
17. **Логи без PII:**
    - `Practice slot created slotId=… instructorId=… carId=… scheduledAt=… durationMin=… actorId=… organizationId=…`;
    - `Practice slot updated slotId=… fields=… scheduledAt=… actorId=… organizationId=…`;
    - `Practice slot deleted slotId=… actorId=… organizationId=…`;
    - `Practice slot conflict slotId=…|new conflicts=N actorId=… organizationId=…`.
18. **Зміна ролі інструктора, що має слоти, блокується** в `roleBindings`, як зараз з авто, студентами й заняттями.
    Інакше слот вказував би на людину, яка вже не інструктор.
19. **Назви в коді.** `ScheduleSlot` у коді — це інтервал часу `{ start, end }`, а не сутність. Сутність завжди
    називається `PracticeSlot` / `practiceSlot`, а змінна інтервалу — `interval`. Перейменовувати `ScheduleSlot` у
    цьому PR не треба.

## Ендпоінти

Новий `PracticeSlotsController` — під `@UseGuards(AuthGuard, RolesGuard)` на класі, як `LessonsController`.

| Метод і шлях | Тіло або query | Ролі | Успіх |
|---|---|---|---|
| `POST /api/practice-slots` | `{ instructorId, carId, scheduledAt, durationMin? }` | `ADMIN` | `201` |
| `GET /api/practice-slots` | `?from&to&instructorId&carId` | `ADMIN`; `INSTRUCTOR` (свої) | `200` |
| `GET /api/practice-slots/:id` | — | `ADMIN`; `INSTRUCTOR` (свій) | `200` |
| `PATCH /api/practice-slots/:id` | `{ instructorId?, carId?, scheduledAt?, durationMin? }` | `ADMIN` | `200` |
| `DELETE /api/practice-slots/:id` | — | `ADMIN` | `204` |

16 листопада 2026 року — понеділок; Київ живе за UTC+2.

Створення, запит:

```json
{ "instructorId": "5b0c…", "carId": "c7d2…", "scheduledAt": "2026-11-16T10:00:00+02:00", "durationMin": 60 }
```

Відповідь `201` (така сама форма в `GET :id`, `PATCH` і в `items` списку):

```json
{
  "id": "a9b8…",
  "scheduledAt": "2026-11-16T08:00:00.000Z",
  "endsAt": "2026-11-16T09:00:00.000Z",
  "durationMin": 60,
  "instructor": { "id": "5b0c…", "firstName": "Олег", "lastName": "Ткаченко" },
  "car": { "id": "c7d2…", "plateNumber": "AA1234BB", "category": "B", "transmission": "MANUAL" },
  "createdAt": "2026-11-07T10:00:00.000Z",
  "updatedAt": "2026-11-07T10:00:00.000Z"
}
```

Список, відповідь `200`:

```json
{
  "from": "2026-11-16T00:00:00.000Z",
  "to": "2026-11-23T00:00:00.000Z",
  "timezone": "Europe/Kyiv",
  "items": [ { "id": "a9b8…", "scheduledAt": "2026-11-16T08:00:00.000Z", "…": "…" } ]
}
```

Конфлікт, відповідь `409`:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Обраний час конфліктує з іншими заняттями.",
  "conflicts": [
    {
      "resource": "INSTRUCTOR",
      "resourceId": "5b0c…",
      "lessonType": "SLOT",
      "lessonId": "a9b8…",
      "scheduledAt": "2026-11-16T08:00:00.000Z",
      "endsAt": "2026-11-16T09:00:00.000Z"
    }
  ]
}
```

`LESSON_SCHEDULE_CONFLICT_MESSAGE` лишається тим самим: текст підходить і для слотів.

## Кроки реалізації

Кроки йдуть у порядку залежностей, тож зручно робити по коміту на крок. Крок 2 — рефакторинг без зміни поведінки.

### 1. Prisma-схема і міграція

`prisma/schema.prisma`:

```prisma
model Organization {
  // … наявні поля
  practiceSlots PracticeSlot[]
}

model User {
  // … наявні поля
  practiceSlots        PracticeSlot[] @relation("InstructorPracticeSlots")
  createdPracticeSlots PracticeSlot[] @relation("CreatedPracticeSlots")

  /// Ціль складеного FK з practice_slots: слот не прив'язати до інструктора іншої автошколи.
  @@unique([id, organizationId])
}

model Car {
  // … наявні поля
  practiceSlots PracticeSlot[]

  /// Ціль складеного FK з practice_slots.
  @@unique([id, organizationId])
}

/// Час, який ADMIN відкрив для запису на практику: інструктор + авто + інтервал.
/// CHECK у міграції: тривалість 15–240, як у занять.
model PracticeSlot {
  id             String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String       @map("organization_id") @db.Uuid
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  /// Restrict: після бронювання слот — історія, як і саме заняття.
  instructorId   String       @map("instructor_id") @db.Uuid
  instructor     User         @relation("InstructorPracticeSlots", fields: [instructorId, organizationId], references: [id, organizationId], onDelete: Restrict)
  carId          String       @map("car_id") @db.Uuid
  car            Car          @relation(fields: [carId, organizationId], references: [id, organizationId], onDelete: Restrict)
  scheduledAt    DateTime     @map("scheduled_at")
  durationMin    Int          @default(60) @map("duration_min")
  createdById    String?      @map("created_by_id") @db.Uuid
  createdBy      User?        @relation("CreatedPracticeSlots", fields: [createdById], references: [id], onDelete: SetNull)
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @default(now()) @updatedAt @map("updated_at")

  /// Індекси під пошук конфліктів і список: ресурс + вікно часу.
  @@index([organizationId, scheduledAt])
  @@index([instructorId, scheduledAt])
  @@index([carId, scheduledAt])
  @@index([createdById])
  @@map("practice_slots")
}
```

Міграція:

- `npx prisma migrate dev --create-only --name add_practice_slots`. Timestamp має бути пізнішим за останню міграцію в
  `develop`.
- У кінець згенерованого `migration.sql` додати `CHECK`; Prisma його не описує, як і в `add_lesson_scheduling_fields`:

  ```sql
  -- Межі збігаються з LESSON_MIN_DURATION_MIN / LESSON_MAX_DURATION_MIN: candidateWindow покладається на верхню межу.
  ALTER TABLE "practice_slots" ADD CONSTRAINT "practice_slots_duration_min_check"
    CHECK ("duration_min" BETWEEN 15 AND 240);
  ```

- Унікальні індекси `users(id, organization_id)` і `cars(id, organization_id)` створюються на наявних даних без
  помилок: `id` уже унікальний.
- `npm run db:generate`.

### 2. Рефакторинг: `practice-rules.ts` і `schedule-range.ts`

`PracticeSlotsService` потребує тих самих перевірок, що й `LessonsService`. Зараз це приватні методи й функції
модуля, тож вони переїжджають без зміни поведінки:

- `src/modules/lessons/practice-rules.ts`: `assertInstructorActive`, `requireInstructor(tx, organizationId,
  instructorId)` і `requirePracticeCar(tx, organizationId, carId, expected)` як експортовані функції. `LessonsService`
  викликає їх замість приватних методів.
- `src/modules/lessons/schedule-range.ts`: `resolveRange` і `fieldError` з `personal-schedule.service.ts`.

Наявні `lessons.service.spec.ts`, `personal-schedule.service.spec.ts` і `lesson-schedule.integration-spec.ts`
проходять без змін.

Новий `requireSlotCar` теж живе в `practice-rules.ts`:

```ts
/**
 * Авто слоту: з організації, закріплене за інструктором слоту, AVAILABLE.
 * Категорію й коробку перевіряє бронювання: студента в слоті ще немає.
 */
export async function requireSlotCar(
  tx: Prisma.TransactionClient,
  organizationId: string,
  carId: string,
  instructorId: string,
): Promise<void> {
  const car = await tx.car.findUnique({
    where: { id: carId },
    select: { organizationId: true, instructorId: true, status: true },
  });
  if (!car || car.organizationId !== organizationId) {
    throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
  }
  if (!car.instructorId) {
    throw new ConflictException(CAR_NOT_ASSIGNED_MESSAGE);
  }
  if (car.instructorId !== instructorId) {
    throw new ConflictException(INSTRUCTOR_CAR_MISMATCH_MESSAGE);
  }
  if (car.status !== CarStatus.AVAILABLE) {
    throw new ConflictException(CAR_NOT_AVAILABLE_MESSAGE);
  }
}
```

### 3. Блокування і конфлікти

**`src/common/prisma/schedule-lock.ts`** — блокування рядка слоту, як `lockPracticeLesson`:

```ts
/** Блокує рядок слоту до кінця транзакції. Слот іншої організації не блокується. */
export async function lockPracticeSlot(
  tx: Prisma.TransactionClient,
  slotId: string,
  organizationId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM practice_slots
    WHERE id = ${slotId}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE
  `;
}
```

**`src/modules/lessons/schedule-conflicts.ts`:**

```ts
export type LessonType = 'THEORY' | 'PRACTICE' | 'SLOT';

/**
 * Конфлікти слоту: інші слоти цього інструктора чи авто і SCHEDULED-заняття
 * з ними. Жодне заняття ще не прив'язане до слоту, тож рахуються всі.
 */
export async function findSlotConflicts(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    /** Слот, що змінюється; null для нового. */
    slotId: string | null;
    instructorId: string;
    carId: string;
    interval: ScheduleSlot;
  },
): Promise<LessonConflict[]> {
  const window = candidateWindow(input.interval);
  const resources = [
    { instructorId: input.instructorId },
    { carId: input.carId },
  ];

  const slots = await tx.practiceSlot.findMany({
    where: {
      ...(input.slotId === null ? {} : { id: { not: input.slotId } }),
      organizationId: input.organizationId,
      scheduledAt: window,
      OR: resources,
    },
    select: { id: true, instructorId: true, carId: true, scheduledAt: true, durationMin: true },
  });
  const lessons = await tx.drivingLesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      OR: resources,
    },
    select: { id: true, instructorId: true, carId: true, scheduledAt: true, durationMin: true },
  });

  const conflicts: LessonConflict[] = [];
  for (const [type, rows] of [['SLOT', slots], ['PRACTICE', lessons]] as const) {
    for (const row of rows.filter((r) => overlaps(input.interval, r))) {
      if (row.instructorId === input.instructorId) {
        conflicts.push(toConflict('INSTRUCTOR', input.instructorId, type, row));
      }
      if (row.carId === input.carId) {
        conflicts.push(toConflict('CAR', input.carId, type, row));
      }
    }
  }
  return sortConflicts(conflicts);
}
```

Запити йдуть послідовно, а не через `Promise.all`: в інтерактивній транзакції Prisma вони однаково виконуються на
одному з'єднанні, і так написані наявні функції. `LessonConflictDto.lessonType` у Swagger описується як
`'THEORY' | 'PRACTICE' | 'SLOT'`, з приміткою, що для `SLOT` у `lessonId` — id слоту.

### 4. DTO: `src/modules/lessons/practice-slots.dto.ts`

- `CreatePracticeSlotDto`: `instructorId`, `carId` — `IsUUID('4')`, `IsDefined`; `scheduledAt` — `IsScheduledAt`;
  `durationMin` — `IsLessonDuration`.
- `UpdatePracticeSlotDto`: ті самі поля, усі необов'язкові; `null` відхиляється.
- `PracticeSlotListQueryDto`: `from`, `to` — `IsScheduleBoundary`; `instructorId?`, `carId?` — UUID.
- `PracticeSlotDto`: `id`, `scheduledAt`, `endsAt`, `durationMin`, `instructor: LessonPersonDto`, `car: LessonCarDto`,
  `createdAt`, `updatedAt`.
- `PracticeSlotListDto`: `from`, `to`, `timezone`, `items: PracticeSlotDto[]`.

### 5. Сервіс: `src/modules/lessons/practice-slots.service.ts`

```ts
export const PRACTICE_SLOT_MANAGE_ROLES = [UserRole.ADMIN] as const;
export const PRACTICE_SLOT_VIEW_ROLES = [UserRole.ADMIN, UserRole.INSTRUCTOR] as const;

@Injectable()
export class PracticeSlotsService {
  private readonly logger = new Logger(PracticeSlotsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(actor: User, payload: CreatePracticeSlotDto): Promise<PracticeSlotDto> {
    assertRole(actor, PRACTICE_SLOT_MANAGE_ROLES);
    const scheduledAt = new Date(payload.scheduledAt);
    const durationMin = payload.durationMin ?? PRACTICE_DEFAULT_DURATION_MIN;
    assertSlotStart(scheduledAt, new Date()); // 400: минуле або не ціла хвилина
    await this.requireOrganization(actor.organizationId);

    const saved = await this.prisma.$transaction(async (tx) => {
      await this.assertSlotValid(tx, actor, {
        slotId: null,
        instructorId: payload.instructorId,
        carId: payload.carId,
        interval: lessonSlot(scheduledAt, durationMin),
      });
      return tx.practiceSlot.create({
        data: {
          organizationId: actor.organizationId,
          instructorId: payload.instructorId,
          carId: payload.carId,
          scheduledAt,
          durationMin,
          createdById: actor.id,
        },
        select: practiceSlotViewSelect,
      });
    });
    // лог + toPracticeSlotDto(saved)
  }

  /** Ключі → інструктор → авто → конфлікти. Спільне для create і update. */
  private async assertSlotValid(
    tx: Prisma.TransactionClient,
    actor: User,
    input: { slotId: string | null; instructorId: string; carId: string; interval: ScheduleSlot },
  ): Promise<void> {
    await lockScheduleResources(tx, [
      scheduleLockKey('instructor', input.instructorId),
      scheduleLockKey('car', input.carId),
    ]);
    await requireInstructor(tx, actor.organizationId, input.instructorId);
    await requireSlotCar(tx, actor.organizationId, input.carId, input.instructorId);
    const conflicts = await findSlotConflicts(tx, {
      organizationId: actor.organizationId,
      ...input,
    });
    if (conflicts.length > 0) {
      this.logger.log(
        `Practice slot conflict slotId=${input.slotId ?? 'new'} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw scheduleConflict(conflicts);
    }
  }
}
```

- `update(actor, slotId, payload)`: роль → порожнє тіло (`400`) → новий `scheduledAt` (`assertSlotStart`, `400`) →
  `requireOrganization` → транзакція: `lockPracticeSlot` → читання з фільтром організації (`404`) → слот ще не
  почався (`409`) → злиття нових значень з поточними → якщо нічого не змінилося, повернути слот → `assertSlotValid` з
  `slotId: slot.id` → `update` → лог зі списком змінених полів.
- `remove(actor, slotId)`: роль → `requireOrganization` → транзакція: `lockPracticeSlot` → читання (`404`) → ще не
  почався (`409`) → `delete` → лог.
- `list(actor, query)`: роль → для `INSTRUCTOR` `query.instructorId` відсутній або свій (`403`), у фільтр іде
  `actor.id` → `resolveRange` → `requireOrganization` → слоти з `candidateWindow` + `overlaps`, сортування за
  `scheduledAt`, `id`.
- `findOne(actor, slotId)`: роль → читання з фільтром організації (`404`) → для `INSTRUCTOR` чужий слот — `403`.
- `assertSlotStart(scheduledAt, now)`: `scheduledAt <= now` — `400 SLOT_IN_PAST_MESSAGE`; ненульові секунди чи
  мілісекунди — `400 SLOT_START_MINUTE_MESSAGE`. Ціла хвилина потрібна, щоб PR графіка порівнював слот з інтервалами
  `HH:MM` без округлення.

`practiceSlotViewSelect` і `toPracticeSlotDto` — поруч у `practice-slot-view.ts`, як `lesson-view.ts`.

### 6. Контролер і модуль

- `src/modules/lessons/practice-slots.controller.ts`: `@ApiTags('practice-slots')`, `@Controller('practice-slots')`,
  `@UseGuards(AuthGuard, RolesGuard)`. `:id` — `ParseUUIDPipe({ version: '4' })`. `DELETE` — `@HttpCode(204)`.
  Swagger-відповіді на кожному ендпоінті за таблицею помилок.
- `LessonsModule`: `PracticeSlotsController` у `controllers`, `PracticeSlotsService` у `providers`.

### 7. Зміна ролі інструктора: `users.service.ts`

`roleBindings` для `INSTRUCTOR` рахує також `tx.practiceSlot.count({ where: { instructorId: userId } })` і повертає
`INSTRUCTOR_HAS_SLOTS_MESSAGE`, якщо слоти є.

## Error responses

Порядок перевірок: guard'и → pipes → сервіс. Неавтентифікований клієнт із некоректним тілом отримає `401`.

| Ситуація | Де перевіряється | Статус | Тіло або повідомлення |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | як в інших модулях |
| Роль не з константи ендпоінта (`STUDENT`, `TEACHER`, `OWNER`; `INSTRUCTOR` на змінах) | `RolesGuard` | 403 | `Insufficient permissions` |
| Немає обов'язкового поля, `null`, не UUID, `durationMin` поза 15–240 чи не ціле, зайве поле | `ValidationPipe` | 400 | `errors: [{ field, message }]` |
| `scheduledAt` без часового зсуву | `ValidationPipe` | 400 | `field: 'scheduledAt'`, `SCHEDULED_AT_FORMAT_MESSAGE` |
| `id` не UUID | `ParseUUIDPipe` | 400 | як в інших модулях |
| Порожнє тіло `PATCH` | `update` | 400 | `field: 'body'`, `NO_SLOT_FIELDS_MESSAGE` |
| `scheduledAt <= now` | `assertSlotStart` | 400 | `field: 'scheduledAt'`, `SLOT_IN_PAST_MESSAGE` |
| `scheduledAt` не на цілій хвилині | `assertSlotStart` | 400 | `field: 'scheduledAt'`, `SLOT_START_MINUTE_MESSAGE` |
| `from` / `to` у неправильному порядку чи вікно довше 62 днів | `resolveRange` | 400 | як у `GET /lessons/me` |
| `INSTRUCTOR` передав чужий `instructorId` чи відкрив чужий слот | `list`, `findOne` | 403 | `Insufficient permissions` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |
| Слоту немає або він іншої організації | сервіс | 404 | `SLOT_NOT_FOUND_MESSAGE` |
| Інструктора немає або він іншої організації | `requireInstructor` | 404 | `Instructor not found` |
| Не `INSTRUCTOR` або не `ACTIVE` | `requireInstructor` | 409 | `INSTRUCTOR_ROLE_MESSAGE` / `INSTRUCTOR_NOT_ACTIVE_MESSAGE` |
| Авто немає або воно іншої організації | `requireSlotCar` | 404 | `Car not found` |
| Авто без інструктора або чужого інструктора | `requireSlotCar` | 409 | `CAR_NOT_ASSIGNED_MESSAGE` / `INSTRUCTOR_CAR_MISMATCH_MESSAGE` |
| Авто не `AVAILABLE` | `requireSlotCar` | 409 | `CAR_NOT_AVAILABLE_MESSAGE` |
| Інтервал перетинається з іншим слотом чи `SCHEDULED`-заняттям інструктора чи авто | `findSlotConflicts` | 409 | `LessonScheduleConflictResponseDto`, `lessonType: 'SLOT'` / `'PRACTICE'` |
| Зміна чи видалення слоту, що вже почався | `update`, `remove` | 409 | `SLOT_ALREADY_STARTED_MESSAGE` |

Нові тексти:

| Константа | Текст |
|---|---|
| `SLOT_NOT_FOUND_MESSAGE` | `Practice slot not found` |
| `SLOT_IN_PAST_MESSAGE` | `Слот можна створити чи перенести лише на майбутній час.` |
| `SLOT_START_MINUTE_MESSAGE` | `Слот має починатися на початку хвилини (секунди 00).` |
| `SLOT_ALREADY_STARTED_MESSAGE` | `Слот уже почався: змінити чи видалити його не можна.` |
| `NO_SLOT_FIELDS_MESSAGE` | `Немає полів для оновлення (instructorId, carId, scheduledAt, durationMin).` |
| `INSTRUCTOR_HAS_SLOTS_MESSAGE` | `Інструктор має слоти практики.` |

## Покриття AC

| AC | У цьому PR | Далі |
|---|---|---|
| 1. Список доступних слотів | список слотів для `ADMIN` та `INSTRUCTOR` | список доступних слотів для студента |
| 2. Актуальні дата та час | слот лише в майбутньому; `scheduledAt`, `endsAt` в UTC + `timezone` | фільтр «після поточного моменту» для студента |
| 3. Доступність інструктора | `ACTIVE`, роль `INSTRUCTOR`; немає інших слотів і занять у цей час | робочий графік і недоступність |
| 4. Доступність автомобіля | `AVAILABLE`, закріплене за інструктором; немає інших слотів і занять з цим авто | категорія й коробка студента |
| 5. Зайняті й заброньовані | слоти не перетинаються між собою і з `SCHEDULED`-заняттями | статус «заброньовано» через `slot_id` |
| 6. Недоступні не як доступні | — | фільтри списку для студента |
| 7. Доступ студента | — | `requirePracticeProfile` у списку й бронюванні |
| 8. Authentication + RBAC | `AuthGuard`, `@Roles`, `assertRole`, «свої» для `INSTRUCTOR` (рішення 14) | ролі нових ендпоінтів |
| 9. В межах Organization | організація з токена, `404` на чуже, складені FK (рішення 3, 15) | те саме |
| 10. Структура й error responses | DTO і приклади вище; таблиця помилок; Swagger | те саме |

## Тест-план

Запуск: `npm test -- practice-slots schedule-conflicts lessons users`, `npm run test:integration -- lesson-schedule`
(потрібен Docker), `npm run lint`, `npm run build`.

### `src/modules/lessons/practice-slots.dto.spec.ts` (новий)

- Створення: без `instructorId`, `carId` чи `scheduledAt` — `400`; `scheduledAt` без зсуву — `400`; `durationMin`
  14, 241, `60.5`, `null` — `400`; зайве поле `organizationId` — `400`.
- Зміна: порожнє тіло проходить валідацію (його відхиляє сервіс); `instructorId: null` — `400`.
- Query: `from` без зсуву — `400`; `instructorId` не UUID — `400`.

### `src/modules/lessons/schedule-conflicts.spec.ts`

- `findSlotConflicts`: інший слот інструктора — `INSTRUCTOR/SLOT`; інший слот з тим самим авто — `CAR/SLOT`; той
  самий інструктор і авто — два записи; `SCHEDULED`-заняття — `PRACTICE`; `CANCELLED`-заняття ігнорується; слот
  `slotId` виключається; впритул — не конфлікт; слот іншої організації не видно.

### `src/modules/lessons/practice-slots.service.spec.ts` (новий)

- Створення: кожна помилка з таблиці рішення 5 у правильному порядку; ключі `instructor:` і `car:` беруться до
  читань; `durationMin` за замовчуванням 60; `createdById = actor.id`; секунди в `scheduledAt` — `400`.
- Зміна: порожнє тіло — `400`; слот іншої організації — `404`; слот почався — `409`; зміна лише `durationMin`
  перевіряє конфлікти з виключенням самого слоту; зміна `instructorId` без `carId`, коли авто належить старому
  інструктору, — `409 INSTRUCTOR_CAR_MISMATCH_MESSAGE`; без змін — `200` без `update`; рядок блокується до читання.
- Видалення: `204`; почався — `409`; іншої організації — `404`.
- Список: вікно за замовчуванням 30 днів; слот, що почався до `from` і закінчується після, потрапляє в список;
  `INSTRUCTOR` бачить лише свої; чужий `instructorId` — `403`; фільтр `carId`.
- `findOne`: `INSTRUCTOR` свій — `200`, чужий — `403`.
- `STUDENT`, `TEACHER`, `OWNER` — `403` на всіх методах; `INSTRUCTOR` — `403` на `create`, `update`, `remove`.

### `src/modules/lessons/practice-slots.controller.spec.ts` (новий)

Метадані `@Roles` кожного ендпоінта відповідають таблиці рішення 14; `DELETE` повертає `204`.

### `src/modules/users/users.service.spec.ts`

Зміна ролі `INSTRUCTOR`, що має слоти, — `409` з `INSTRUCTOR_HAS_SLOTS_MESSAGE`.

### `test/integration/lesson-schedule.integration-spec.ts` (новий `describe('practice slots')`)

- Міграція: `duration_min = 300` — порушення `CHECK`; слот з інструктором чи авто іншої організації — порушення FK;
  видалення інструктора чи авто зі слотами — порушення FK; видалення всієї організації зі слотами проходить.
- Паралельне створення двох слотів, що перетинаються, для того самого інструктора: рівно одне `201`, друге `409`.
- Паралельне створення слоту і практичного заняття на той самий час того самого інструктора: слот бачить заняття
  (`409`) або заняття створюється пізніше. Обидва беруть ключ `instructor:`, тож перевірка слоту не пропускає вже
  створене заняття.
- Наскрізно: створити → список → змінити час → видалити.

### Регресія

- `lessons.service.spec.ts`, `personal-schedule.service.spec.ts`, `dashboard.service.spec.ts`,
  `group-lock.integration-spec.ts` проходять без змін: ендпоінти занять не змінювались.
- `npx prisma migrate status` чистий.

### Ручна перевірка

Ті самі demo-акаунти, що в плані create. Авто `<car>` закріплене за інструктором `<instructor>`
(`PATCH /api/cars/:id/instructor`).

```bash
# 201: слот 16.11 о 10:00 за Києвом
curl -s -X POST http://localhost:3000/api/practice-slots \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructorId":"<instructor>","carId":"<car>","scheduledAt":"2026-11-16T10:00:00+02:00"}'

# 409 INSTRUCTOR/SLOT і CAR/SLOT: перетин з першим слотом (10:30)
curl -s -X POST http://localhost:3000/api/practice-slots \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructorId":"<instructor>","carId":"<car>","scheduledAt":"2026-11-16T10:30:00+02:00"}'

# 201: впритул (11:00)
curl -s -X POST http://localhost:3000/api/practice-slots \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructorId":"<instructor>","carId":"<car>","scheduledAt":"2026-11-16T11:00:00+02:00"}'

# 200: перенести перший слот на 12:00
curl -s -X PATCH http://localhost:3000/api/practice-slots/<slot> \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-16T12:00:00+02:00"}'

# 200: тиждень слотів; INSTRUCTOR бачить лише свої
curl -s "http://localhost:3000/api/practice-slots?from=2026-11-16T00:00:00%2B02:00&to=2026-11-23T00:00:00%2B02:00" \
  -H "Authorization: Bearer $INSTRUCTOR_TOKEN"

# 204: видалити
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://localhost:3000/api/practice-slots/<slot> \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 400: у минулому; 409: авто іншого інструктора; 403: INSTRUCTOR створює; 403: STUDENT дивиться
curl -s -X POST http://localhost:3000/api/practice-slots \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructorId":"<instructor>","carId":"<car>","scheduledAt":"2026-01-01T10:00:00+02:00"}'
curl -s -X POST http://localhost:3000/api/practice-slots \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructorId":"<instructor>","carId":"<other-instructor-car>","scheduledAt":"2026-11-17T10:00:00+02:00"}'
curl -s -X POST http://localhost:3000/api/practice-slots \
  -H "Authorization: Bearer $INSTRUCTOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructorId":"<instructor>","carId":"<car>","scheduledAt":"2026-11-17T10:00:00+02:00"}'
curl -s http://localhost:3000/api/practice-slots -H "Authorization: Bearer $STUDENT_TOKEN"
```

Додатково:

- Створіть практичне заняття інструктора на 16.11 о 15:00 (`POST /api/lessons/practice`), потім слот на 15:30:
  `409` з `lessonType: 'PRACTICE'`.
- Переведіть авто в `MAINTENANCE` і створіть слот: `409 CAR_NOT_AVAILABLE_MESSAGE`.
- У Swagger є розділ `practice-slots` із п'ятьма ендпоінтами і всіма відповідями з таблиці помилок.

## Відкриті питання до продукту

1. **Доступ `OWNER`.** Зараз `403`, як у наявних ендпоінтах занять; зміна — додати `OWNER` у
   `PRACTICE_SLOT_MANAGE_ROLES` і `PRACTICE_SLOT_VIEW_ROLES`.
2. **Чи мають наявні ендпоінти занять уже зараз вважати слоти зайнятим часом?** Зараз ні (рішення 9): заняття можна
   створити на час слоту, а бронювання такого слоту потім дасть `409`. Зміна — додати слоти в `findPracticeConflicts`
   для інструктора й авто.

## Наступні PR

Коротко, щоб було видно, куди вбудовується цей PR. Кожен матиме окремий план.

1. **Робочий графік і недоступність інструктора.** Таблиці, `PUT`/`GET` графіка, CRUD недоступності. Створення й
   зміна слоту отримують перевірки «слот у межах графіка» і «інструктор доступний» між пунктами 4 і 5 рішення 5.
2. **Доступні слоти для студента** (`GET /practice-slots/available`): допуск до практики, інструктор студента,
   категорія й коробка авто, зайнятість студента.
3. **Бронювання і переробка ендпоінтів практики.** `driving_lessons.slot_id` з частковим унікальним індексом,
   бронювання студентом, скасування студентом не пізніше ніж за 24 години, `INSTRUCTOR` лише переглядає, скасування
   слоту замість видалення для слотів з історією.

## Поза скоупом

- **Масове створення слотів** (наприклад, на тиждень одним запитом).
- **Каскадні дії** при блокуванні інструктора, переведенні авто в `MAINTENANCE` чи переприв'язці авто до іншого
  інструктора. Майбутні слоти лишаються; доступні слоти й бронювання відсікатимуть недоступне.
- **Сповіщення** про нові чи змінені слоти.

## Чек-лист для рев'ю

- [ ] Міграція створює `practice_slots` з `CHECK` на тривалість, складеними FK на `users` і `cars` та унікальними
      `(id, organization_id)` на них; timestamp пізніший за міграції в `develop`.
- [ ] Інструктор, авто й конфлікти перевіряються після advisory-ключів `instructor:` і `car:`.
- [ ] `findSlotConflicts` рахує інші слоти й `SCHEDULED`-заняття інструктора чи авто і виключає слот, що змінюється.
- [ ] Порядок блокувань при зміні: рядок слоту → advisory-ключі.
- [ ] Слот, що вже почався, не змінюється й не видаляється.
- [ ] `INSTRUCTOR` бачить лише свої слоти й не має доступу до змін; `STUDENT`, `TEACHER`, `OWNER` отримують `403`.
- [ ] Організація береться лише з токена; слот, інструктор чи авто іншої організації дають `404`.
- [ ] Відповідь не містить email, телефону, ролей і статусів людей.
- [ ] Ендпоінти занять і їхні тести не змінились, крім перенесених у `practice-rules.ts` перевірок.
- [ ] Зміна ролі інструктора зі слотами блокується.
