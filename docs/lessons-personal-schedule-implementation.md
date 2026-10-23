# Lessons Personal Schedule: план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [lessons-edit-reschedule-implementation.md](lessons-edit-reschedule-implementation.md),
[lessons-cancel-implementation.md](lessons-cancel-implementation.md) і частину 1 плану
[groups-course-members-access-implementation.md](groups-course-members-access-implementation.md) (права на перегляд
груп), перш ніж імплементувати або рев'ювати цю задачу. Модуль `lessons` уже вміє редагувати, переносити й
скасовувати заняття, але не має жодного ендпоінта читання. Ця задача додає перший: `GET /api/lessons/me`,
персональний розклад поточного користувача.

## Задача

Реалізувати API для отримання персонального розкладу користувача з урахуванням його ролі.

Acceptance Criteria:

1. користувач отримує власний розклад;
2. повертаються тільки релевантні користувачу заняття;
3. враховується role-based access;
4. TEACHER бачить свої заняття;
5. STUDENT бачить заняття своєї групи;
6. не повертаються дані інших користувачів/груп без відповідних permissions;
7. враховуються майбутні та завершені заняття відповідно до бізнес-логіки;
8. API повертає коректну структуру даних;
9. реалізована organization isolation.

## Що вже є, а чого немає

- **Ендпоінта читання занять немає.** У [lessons.controller.ts](../src/modules/lessons/lessons.controller.ts) є лише
  `PATCH` і `POST`. Найближчі заняття показують тільки дашборди, і там лише `SCHEDULED`, лише майбутні і не більше
  п'яти (`take: 5`):

  | Дашборд | Де | Що повертає |
  |---|---|---|
  | Teacher | [dashboard.service.ts:160](../src/modules/dashboard/dashboard.service.ts#L160) | теорія груп з `teacherId = actor.id` |
  | Student | [dashboard.service.ts:239](../src/modules/dashboard/dashboard.service.ts#L239) | теорія груп з `ACTIVE`-зарахуванням; **практики студента немає** |
  | Instructor | [dashboard.service.ts:291](../src/modules/dashboard/dashboard.service.ts#L291) | практика з `instructorId = actor.id` |

  Минулих і скасованих занять не віддає жоден ендпоінт.
- **Статус `COMPLETED` ніхто не ставить.** Ні сервіси, ні міграції не переводять заняття в `COMPLETED`: задача
  завершення заняття ще не зроблена (див. «Поза скоупом» у плані cancel). Тож минуле заняття майже завжди має статус
  `SCHEDULED`. Завершеність доводиться визначати за часом, а не за статусом.
- **Хто до якого заняття має стосунок:**

  | Роль | Теорія (`lessons`) | Практика (`driving_lessons`) |
  |---|---|---|
  | `TEACHER` | `group.teacherId = actor.id` | — |
  | `INSTRUCTOR` | — | `instructorId = actor.id` |
  | `STUDENT` | групи з його `Enrollment` | `studentId = actor.id` |
  | `ADMIN`, `OWNER` | власних занять немає | власних занять немає |

- **Склад групи — це `Enrollment`, а не `Student.groupId`** (інваріант 1 у плані groups-course-members-access).
  Закриття групи переводить її `ACTIVE`-зарахування в `COMPLETED`, а майбутні `SCHEDULED`-заняття в `CANCELLED`
  ([groups.service.ts:326](../src/modules/groups/groups.service.ts#L326)). Випуск студента (`GRADUATED`) дає
  `COMPLETED`, відрахування й архів (`DROPPED`, `ARCHIVED`) дають `DROPPED`
  ([students.service.ts:315](../src/modules/students/students.service.ts#L315)).
- **У `lessons` немає `organization_id`.** Організація теорії береться через `group.organizationId`, у
  `driving_lessons` є власний `organizationId`. Так само фільтрують `find*Conflicts` і дашборди.
- **`AuthGuard` уже відсікає** неактивного чи видаленого користувача і заблоковану організацію (`401`,
  [auth-access.ts](../src/modules/auth/auth-access.ts)), а `request.user` щоразу читається з БД, тож роль актуальна.
- **Глобальний `ValidationPipe`** з `whitelist`, `forbidNonWhitelisted` і `transform`
  ([configure-app.ts](../src/configure-app.ts)): невідомий query-параметр дає `400`. Це стосується і `userId`,
  `groupId` чи `organizationId`.

### Що можна перевикористати

| Що | Де | Для чого |
|---|---|---|
| `candidateWindow` + `overlaps` | [schedule-conflicts.ts:53](../src/modules/lessons/schedule-conflicts.ts#L53), [:69](../src/modules/lessons/schedule-conflicts.ts#L69) | вибрати заняття, що перетинають вікно `[from, to)` |
| `lessonEnd`, `ScheduleSlot` | [schedule-conflicts.ts:41](../src/modules/lessons/schedule-conflicts.ts#L41) | `endsAt` і `timing` |
| `toTheoryLessonDto`, `toPracticeLessonDto`, `lessonPersonSelect` | [lessons.service.ts:101](../src/modules/lessons/lessons.service.ts#L101), [:328](../src/modules/lessons/lessons.service.ts#L328), [:345](../src/modules/lessons/lessons.service.ts#L345) | та сама форма елемента, що в `PATCH` і `cancel` |
| `TheoryLessonDto`, `PracticeLessonDto` | [lessons.dto.ts](../src/modules/lessons/lessons.dto.ts) | базові класи елементів розкладу |
| `ZONED_DATE_TIME_PATTERN` | [lessons.dto.ts:40](../src/modules/lessons/lessons.dto.ts#L40) | формат `from` і `to`, як у `scheduledAt` |
| `allowedStudentScope(actor)`: `switch` за роллю, що повертає `where` або кидає `403` | [students.service.ts:340](../src/modules/students/students.service.ts#L340) | шаблон для `scheduleScope(actor, now)` |
| `requireOrganization` | [lessons.service.ts:839](../src/modules/lessons/lessons.service.ts#L839) | `404` для soft-deleted організації і `timezone` для відповіді |
| `createSchool()`, `theory()`, `practice()`, `at()` | [lesson-schedule.integration-spec.ts](../test/integration/lesson-schedule.integration-spec.ts) | integration-тести |
| Шаблон «rejects an unknown query parameter» | [app.e2e-spec.ts:2367](../test/app.e2e-spec.ts#L2367) | e2e-тест на `userId` у query |

## Рішення, зафіксовані цим планом

1. **Один ендпоінт для всіх ролей з розкладом: `GET /api/lessons/me`.** Чий розклад, визначає лише access token.
   `userId`, `groupId` і `organizationId` у запиті не приймаються: `forbidNonWhitelisted` дає `400` (AC 1, 6).
   - `me`, як у `GET /users/me` і `GET /students/me`.
   - У модулі `lessons`, бо форма даних, selects і мапери тут. Майбутній `GET /api/lessons` (календар школи для
     ADMIN) ляже поруч.
2. **Ролі: `SCHEDULE_VIEW_ROLES = [TEACHER, INSTRUCTOR, STUDENT]`.** `ADMIN` і `OWNER` отримують `403`: власних
   занять у них немає, а розклад усієї школи — окрема задача. `403`, а не порожній список, бо порожній список
   виглядав би як «занять немає», хоча їх не може бути. Сервіс повторює перевірку ролі: `scheduleScope` кидає `403`
   для будь-якої іншої ролі (AC 3).

   `INSTRUCTOR` у AC не згаданий, але «розклад з урахуванням ролі» без нього неповний, а дані вже є
   (`driving_lessons.instructor_id`). Коштує одну гілку `switch`.
3. **Scope за роллю.** Кожна умова містить фільтр організації: `group.organizationId` для теорії, `organizationId`
   для практики (AC 2, 4, 5, 9).

   | Роль | Теорія | Практика |
   |---|---|---|
   | `TEACHER` | групи з `teacherId = actor.id`, будь-який статус групи | — |
   | `INSTRUCTOR` | — | `instructorId = actor.id` |
   | `STUDENT` | групи з `ACTIVE`-зарахуванням — усі заняття; з `COMPLETED`-зарахуванням — лише ті, що вже почалися (`scheduledAt <= now`); `DROPPED` — жодних | `studentId = actor.id` |

   - **Чому `STUDENT` бачить минулі заняття групи з `COMPLETED`-зарахуванням.** Закриття групи переводить
     зарахування в `COMPLETED`. Якщо фільтрувати лише `ACTIVE`, студент втрачає всю історію теорії саме тоді, коли
     курс закінчився, і AC 7 для нього не виконується. Майбутні заняття з такого зарахування не показуються:
     студент уже не в групі (випуск), а майбутні заняття закритої групи й так скасовані.
   - **Це свідома відмінність від `GET /groups` і Student Dashboard**, де студент бачить лише групу з
     `ACTIVE`-зарахуванням (рішення 2 частини 1 плану groups-course-members-access). Там мова про поточну групу, тут
     про історію занять. Про групу у відповідь потрапляють лише `id` і `name`, складу групи немає.
   - **`TEACHER` бачить заняття груп у будь-якому статусі**, як Teacher Dashboard і `GET /groups` для викладача.
4. **«Майбутнє» і «завершене» визначаються за часом.** Кожен елемент має обчислене поле `timing` (AC 7):

   | `timing` | Умова |
   |---|---|
   | `UPCOMING` | `now < scheduledAt` |
   | `IN_PROGRESS` | `scheduledAt <= now < endsAt` |
   | `FINISHED` | `endsAt <= now` |

   - `status` повертається як є. Минуле заняття зазвичай має `status: SCHEDULED` і `timing: FINISHED`, бо
     `COMPLETED` ніхто не ставить. Коли з'явиться задача завершення заняття, `timing` не зміниться, а `status` стане
     `COMPLETED`.
   - Межі ті самі, що в `assertNotStarted`: заняття з `scheduledAt = now` уже почалося, тож редагувати чи скасувати
     його не можна. Клієнт може ховати кнопки за `timing !== 'UPCOMING'` і не залежати від годинника пристрою.
   - `timing` рахується і для скасованих занять. Скасоване заняття розпізнається за `status: CANCELLED`.
5. **Вікно часу замість пагінації.** Query-параметри `from` і `to`, ISO 8601 з часовим зсувом, як `scheduledAt` у
   `/reschedule`.
   - За замовчуванням `from = now`, `to = from + 30 днів`. Без параметрів користувач отримує свій найближчий
     місяць. Завершені заняття клієнт отримує, передавши вікно в минулому.
   - `to` має бути пізніше за `from`, вікно — не довше 62 днів. Це вміщує місячний календар (до шести тижнів, 42
     дні) з запасом і обмежує відповідь: інструктор із вісьмома заняттями на день отримає до ~500 елементів.
   - **Чому не `page`/`limit`.** У студента заняття з двох таблиць. Offset-пагінація по двох таблицях потребує або
     `UNION` у сирому SQL, або вибірки `page × limit` рядків з кожної. Обмежене вікно дає обмежену відповідь без
     цього.
   - **Вікно напіввідкрите, `[from, to)`, і заняття потрапляє в нього, якщо перетинається з ним.** Заняття, що
     почалося до `from` і ще триває, входить (тому за замовчуванням видно поточне заняття). Заняття, що починається
     рівно в `to` або закінчується рівно в `from`, не входить. Прийом той самий, що в пошуку конфліктів:
     `candidateWindow` звужує вибірку в БД, а `overlaps` рахує точний перетин у пам'яті.
   - **`+` у query треба кодувати як `%2B`.** Express декодує `+` у query як пробіл, і `from=…T00:00:00+02:00`
     дасть `400`. `URLSearchParams` і `encodeURIComponent` кодують `+` самі; `Z` працює без кодування. Це сказано в
     Swagger-описі параметрів.
6. **Скасовані заняття за замовчуванням не повертаються** (`status != CANCELLED`), як вимагає «Поза скоупом» плану
   cancel: списки за замовчуванням показують лише активні заняття або мають явний фільтр. `includeCancelled=true`
   повертає їх разом з `cancelledAt` і `cancellationReason`. `COMPLETED` повертається завжди.
7. **`type=THEORY|PRACTICE` — необов'язковий фільтр.** Тип, якого в ролі немає (`TEACHER` + `PRACTICE`), дає
   порожній `items`, а не `400`: запит коректний, просто таких занять немає. Запит у БД для нього не робиться.
8. **Елемент розкладу — та сама `TheoryLessonDto` / `PracticeLessonDto`, що повертають `PATCH` і `cancel`, плюс
   `timing`.** Дискримінатор — поле `type`. Обгортка: `{ from, to, timezone, items }` (AC 8).
   - `from` і `to` — фактичні межі вікна після підстановки значень за замовчуванням.
   - `timezone` — часовий пояс автошколи, щоб клієнт показував час за школою, а не за пристроєм.
   - **Дані інших людей у відповіді:** лише `id`, `firstName` і `lastName` викладача, інструктора й студента
     заняття, а також номер, категорія і коробка авто. Email, телефонів, ролей, статусів і складу групи немає.
     У практиці студента поле `student` — це він сам (AC 6).
9. **Сортування:** `scheduledAt` за зростанням, при однаковому часі `THEORY` раніше за `PRACTICE`, далі `id`.
   Порядок стабільний між запитами.
10. **Ізоляція організацій.** Фільтр організації в кожному запиті (рішення 3), `requireOrganization` (soft-deleted
    організація — `404`) і `AuthGuard` (заблокована організація — `401`). `organizationId` береться лише з
    `actor`. Окремого `404` для «чужих» занять тут немає: їх просто немає у відповіді (AC 9).
11. **Без транзакції і блокувань.** Це читання. Теорія і практика читаються паралельно через `Promise.all`;
    узгоджений знімок двох таблиць не потрібен, як і в дашбордах.
12. **Без логу на кожен запит**, як у `DashboardService`: читання без побічних ефектів.

### Відомі обмеження моделі даних

Виправлення кожного потребує міграції і не входить у задачу (див. «Поза скоупом»).

- **`Lesson` не зберігає викладача.** Зміна `Group.teacherId` переносить до нового викладача всю історію групи,
  разом з минулими заняттями, які читав попередній. Практика цієї проблеми не має: `instructorId` у самому занятті.
- **`Enrollment` не зберігає дату виходу з групи.** Випускник, чия група ще відкрита, бачить її заняття, що
  відбулися після випуску (до `now`). Випадок рідкісний: `GRADUATED` зазвичай ставлять після закриття групи.
- **`enrolledAt` не враховується.** Студент, зарахований посеред курсу, бачить і ранні заняття групи. Це розклад
  групи, а не відвідування.

## Ендпоінт

`GET /api/lessons/me`, під `@UseGuards(AuthGuard, RolesGuard)` на класі, `@Roles(...SCHEDULE_VIEW_ROLES)`.

| Query-параметр | Тип | За замовчуванням | Правила |
|---|---|---|---|
| `from` | ISO 8601 зі зсувом | поточний момент | `Z` або `±HH:MM`, секунди обов'язкові |
| `to` | ISO 8601 зі зсувом | `from + 30 днів` | пізніше за `from`, не більше ніж `from + 62 дні` |
| `type` | `THEORY` \| `PRACTICE` | обидва типи | |
| `includeCancelled` | `true` \| `false` | `false` | лише рядки `true` або `false` |

Запит:

```
GET /api/lessons/me?from=2026-11-02T00:00:00%2B02:00&to=2026-11-09T00:00:00%2B02:00
```

Відповідь `200` для студента:

```json
{
  "from": "2026-11-01T22:00:00.000Z",
  "to": "2026-11-08T22:00:00.000Z",
  "timezone": "Europe/Kyiv",
  "items": [
    {
      "id": "7b1c…",
      "type": "PRACTICE",
      "status": "SCHEDULED",
      "timing": "UPCOMING",
      "scheduledAt": "2026-11-03T08:00:00.000Z",
      "endsAt": "2026-11-03T09:00:00.000Z",
      "durationMin": 60,
      "instructor": { "id": "a3b2…", "firstName": "Олег", "lastName": "Коваль" },
      "student": { "id": "c9d8…", "firstName": "Марія", "lastName": "Шевченко" },
      "car": { "id": "c7d2…", "plateNumber": "AA1234BB", "category": "B", "transmission": "MANUAL" },
      "cancelledAt": null,
      "cancellationReason": null,
      "updatedAt": "2026-10-20T09:12:44.120Z"
    },
    {
      "id": "1f0e…",
      "type": "THEORY",
      "status": "SCHEDULED",
      "timing": "UPCOMING",
      "topic": "Дорожні знаки",
      "scheduledAt": "2026-11-03T16:00:00.000Z",
      "endsAt": "2026-11-03T17:30:00.000Z",
      "durationMin": 90,
      "group": { "id": "4c21…", "name": "ПДР — Група А" },
      "teacher": { "id": "e5f6…", "firstName": "Ірина", "lastName": "Мельник" },
      "cancelledAt": null,
      "cancellationReason": null,
      "updatedAt": "2026-10-20T09:12:44.120Z"
    }
  ]
}
```

Якщо занять у вікні немає, `items` — порожній масив, статус `200`.

## Кроки реалізації

Кроки йдуть у порядку залежностей, тож зручно робити по коміту на крок. Міграції немає.

### 1. Рефакторинг: `src/modules/lessons/lesson-view.ts`

Перенести з [lessons.service.ts](../src/modules/lessons/lessons.service.ts) у новий файл `lessonPersonSelect`,
`toPerson`, `toTheoryLessonDto` і `toPracticeLessonDto` та додати вузькі select-и лише з полями, що потрапляють у
DTO:

```ts
export const lessonPersonSelect = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

/** Поля TheoryLessonDto. Select-и запису в LessonsService — їхні надмножини. */
export const theoryLessonViewSelect = {
  id: true,
  topic: true,
  scheduledAt: true,
  durationMin: true,
  status: true,
  cancelledAt: true,
  cancellationReason: true,
  updatedAt: true,
  group: {
    select: { id: true, name: true, teacher: { select: lessonPersonSelect } },
  },
} satisfies Prisma.LessonSelect;

export type TheoryLessonView = Prisma.LessonGetPayload<{
  select: typeof theoryLessonViewSelect;
}>;

export const practiceLessonViewSelect = {
  id: true,
  scheduledAt: true,
  durationMin: true,
  status: true,
  cancelledAt: true,
  cancellationReason: true,
  updatedAt: true,
  instructor: { select: lessonPersonSelect },
  student: { select: lessonPersonSelect },
  car: {
    select: { id: true, plateNumber: true, category: true, transmission: true },
  },
} satisfies Prisma.DrivingLessonSelect;

export type PracticeLessonView = Prisma.DrivingLessonGetPayload<{
  select: typeof practiceLessonViewSelect;
}>;

export function toTheoryLessonDto(row: TheoryLessonView): TheoryLessonDto { … }
export function toPracticeLessonDto(row: PracticeLessonView): PracticeLessonDto { … }
```

- Тіла маперів не змінюються, змінюється лише тип параметра.
- `theoryLessonSelect` і `practiceLessonSelect` лишаються в `lessons.service.ts`: вони потрібні для перевірок
  запису (статус групи, стан викладача, профіль студента). Рядки з них структурно сумісні з `*View`, тож виклики
  маперів у `LessonsService` не змінюються.
- У [lessons.dto.ts](../src/modules/lessons/lessons.dto.ts) зробити `ZONED_DATE_TIME_PATTERN` експортованим.

Це чистий рефакторинг: `lessons.service.spec.ts` і `lesson-schedule.integration-spec.ts` мають пройти без змін.

### 2. DTO: `src/modules/lessons/lessons.dto.ts`

**Константи й повідомлення:**

```ts
export const SCHEDULE_DEFAULT_RANGE_DAYS = 30;
export const SCHEDULE_MAX_RANGE_DAYS = 62;

export const LESSON_TYPES = ['THEORY', 'PRACTICE'] as const;
export type LessonTypeFilter = (typeof LESSON_TYPES)[number];

export const LESSON_TIMINGS = ['UPCOMING', 'IN_PROGRESS', 'FINISHED'] as const;
export type LessonTiming = (typeof LESSON_TIMINGS)[number];

export const SCHEDULE_RANGE_FORMAT_MESSAGE =
  'from і to мають бути датою й часом ISO 8601 з часовим зсувом, наприклад 2026-11-02T00:00:00+02:00. ' +
  'Знак + у query кодуйте як %2B.';
export const SCHEDULE_RANGE_ORDER_MESSAGE = 'to має бути пізніше за from.';
export const SCHEDULE_RANGE_LENGTH_MESSAGE = `Період розкладу має бути не довшим за ${SCHEDULE_MAX_RANGE_DAYS} днів.`;
export const LESSON_TYPE_MESSAGE = 'type має бути THEORY або PRACTICE.';
export const INCLUDE_CANCELLED_MESSAGE = 'includeCancelled має бути true або false.';
```

**Query DTO.** Query-параметри приходять рядками, і `enableImplicitConversion` вимкнено, тож `includeCancelled`
перетворюється явно. Будь-яке інше значення, крім `'true'` і `'false'`, лишається рядком і падає на `IsBoolean`.

```ts
function optionalBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

export class PersonalScheduleQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-02T00:00:00+02:00',
    description:
      'Початок вікна, ISO 8601 з часовим зсувом. За замовчуванням — поточний момент. ' +
      'Знак + кодуйте як %2B, інакше він прийде пробілом.',
  })
  @IsISO8601({ strict: true }, { message: SCHEDULE_RANGE_FORMAT_MESSAGE })
  @Matches(ZONED_DATE_TIME_PATTERN, { message: SCHEDULE_RANGE_FORMAT_MESSAGE })
  @IsString({ message: SCHEDULE_RANGE_FORMAT_MESSAGE })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-09T00:00:00+02:00',
    description: `Кінець вікна (не включно). За замовчуванням — from + ${SCHEDULE_DEFAULT_RANGE_DAYS} днів. Не більше from + ${SCHEDULE_MAX_RANGE_DAYS} днів.`,
  })
  // ті самі декоратори, що в from
  to?: string;

  @ApiPropertyOptional({ enum: LESSON_TYPES, description: 'Без параметра — обидва типи.' })
  @IsIn(LESSON_TYPES, { message: LESSON_TYPE_MESSAGE })
  @IsOptional()
  type?: LessonTypeFilter;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'true — повернути й скасовані заняття.',
  })
  @Transform(optionalBoolean)
  @IsBoolean({ message: INCLUDE_CANCELLED_MESSAGE })
  @IsOptional()
  includeCancelled?: boolean;
}
```

**Відповідь.** `@nestjs/swagger` успадковує `@ApiProperty` батьківського класу, тож елементи розкладу розширюють
наявні DTO одним полем.

```ts
const TIMING_DESCRIPTION =
  'UPCOMING — ще не почалося, IN_PROGRESS — триває, FINISHED — закінчилося. ' +
  'Рахується за часом сервера; status минулого заняття зазвичай SCHEDULED.';

export class ScheduleTheoryLessonDto extends TheoryLessonDto {
  @ApiProperty({ enum: LESSON_TIMINGS, example: 'UPCOMING', description: TIMING_DESCRIPTION })
  timing: LessonTiming;
}

export class SchedulePracticeLessonDto extends PracticeLessonDto {
  @ApiProperty({ enum: LESSON_TIMINGS, example: 'FINISHED', description: TIMING_DESCRIPTION })
  timing: LessonTiming;
}

export type PersonalScheduleItemDto =
  | ScheduleTheoryLessonDto
  | SchedulePracticeLessonDto;

@ApiExtraModels(ScheduleTheoryLessonDto, SchedulePracticeLessonDto)
export class PersonalScheduleDto {
  @ApiProperty({ example: '2026-11-01T22:00:00.000Z', description: 'Фактичний початок вікна.' })
  from: Date;

  @ApiProperty({ example: '2026-11-08T22:00:00.000Z', description: 'Фактичний кінець вікна (не включно).' })
  to: Date;

  @ApiProperty({ example: 'Europe/Kyiv', description: 'Часовий пояс автошколи.' })
  timezone: string;

  @ApiProperty({
    type: 'array',
    description: 'Заняття, що перетинають вікно, за зростанням scheduledAt.',
    items: {
      oneOf: [
        { $ref: getSchemaPath(ScheduleTheoryLessonDto) },
        { $ref: getSchemaPath(SchedulePracticeLessonDto) },
      ],
      discriminator: {
        propertyName: 'type',
        mapping: {
          THEORY: getSchemaPath(ScheduleTheoryLessonDto),
          PRACTICE: getSchemaPath(SchedulePracticeLessonDto),
        },
      },
    },
  })
  items: PersonalScheduleItemDto[];
}
```

### 3. Сервіс: `src/modules/lessons/personal-schedule.service.ts`

Окремий сервіс, а не метод `LessonsService`: той має 850 рядків логіки запису з блокуваннями, а читанню нічого з
цього не потрібно.

```ts
export const SCHEDULE_VIEW_ROLES = [
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
] as const;

const DAY_MS = 24 * 60 * 60_000;

const TYPE_ORDER: Record<LessonTypeFilter, number> = { THEORY: 0, PRACTICE: 1 };

type ScheduleScope = {
  theory: Prisma.LessonWhereInput | null;
  practice: Prisma.DrivingLessonWhereInput | null;
};

/**
 * Заняття, що належать до розкладу користувача. Кожна умова містить фільтр
 * організації. Ролі без власних занять — 403.
 */
function scheduleScope(actor: User, now: Date): ScheduleScope {
  const organizationId = actor.organizationId;
  switch (actor.role) {
    case UserRole.TEACHER:
      return {
        theory: { group: { organizationId, teacherId: actor.id } },
        practice: null,
      };
    case UserRole.INSTRUCTOR:
      return {
        theory: null,
        practice: { organizationId, instructorId: actor.id },
      };
    case UserRole.STUDENT:
      return {
        // Із завершеного зарахування — лише історія: майбутні заняття вже не його.
        theory: {
          group: { organizationId },
          OR: [
            {
              group: {
                enrollments: {
                  some: { studentId: actor.id, status: EnrollmentStatus.ACTIVE },
                },
              },
            },
            {
              scheduledAt: { lte: now },
              group: {
                enrollments: {
                  some: { studentId: actor.id, status: EnrollmentStatus.COMPLETED },
                },
              },
            },
          ],
        },
        practice: { organizationId, studentId: actor.id },
      };
    default:
      throw new ForbiddenException('Insufficient permissions');
  }
}

function resolveRange(query: PersonalScheduleQueryDto, now: Date): ScheduleSlot {
  const start = query.from ? new Date(query.from) : now;
  const end = query.to
    ? new Date(query.to)
    : new Date(start.getTime() + SCHEDULE_DEFAULT_RANGE_DAYS * DAY_MS);
  if (end.getTime() <= start.getTime()) {
    throw fieldError('to', SCHEDULE_RANGE_ORDER_MESSAGE);
  }
  if (end.getTime() - start.getTime() > SCHEDULE_MAX_RANGE_DAYS * DAY_MS) {
    throw fieldError('to', SCHEDULE_RANGE_LENGTH_MESSAGE);
  }
  return { start, end };
}

/** Межі ті самі, що в assertNotStarted: scheduledAt = now — уже почалося. */
export function lessonTiming(scheduledAt: Date, endsAt: Date, now: Date): LessonTiming {
  if (now.getTime() < scheduledAt.getTime()) {
    return 'UPCOMING';
  }
  return now.getTime() < endsAt.getTime() ? 'IN_PROGRESS' : 'FINISHED';
}

function compareItems(a: PersonalScheduleItemDto, b: PersonalScheduleItemDto): number {
  return (
    a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
    a.id.localeCompare(b.id)
  );
}
```

`fieldError` — локальна копія, як у `lessons.service.ts` і `groups.service.ts`.

```ts
@Injectable()
export class PersonalScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async getMySchedule(
    actor: User,
    query: PersonalScheduleQueryDto,
  ): Promise<PersonalScheduleDto> {
    const now = new Date();
    // Порядок як у LessonsService: 403 і 400 до будь-яких запитів у БД, потім 404.
    const scope = scheduleScope(actor, now);
    const range = resolveRange(query, now);
    const organization = await this.requireOrganization(actor.organizationId);

    const theoryWhere = query.type === 'PRACTICE' ? null : scope.theory;
    const practiceWhere = query.type === 'THEORY' ? null : scope.practice;
    const scheduledAt = candidateWindow(range);

    const [theory, practice] = await Promise.all([
      theoryWhere
        ? this.prisma.lesson.findMany({
            where: {
              AND: [
                theoryWhere,
                { scheduledAt },
                query.includeCancelled ? {} : { status: { not: LessonStatus.CANCELLED } },
              ],
            },
            select: theoryLessonViewSelect,
          })
        : [],
      practiceWhere
        ? this.prisma.drivingLesson.findMany({
            where: {
              AND: [
                practiceWhere,
                { scheduledAt },
                query.includeCancelled ? {} : { status: { not: DrivingLessonStatus.CANCELLED } },
              ],
            },
            select: practiceLessonViewSelect,
          })
        : [],
    ]);

    const items: PersonalScheduleItemDto[] = [
      ...theory
        .filter((row) => overlaps(range, row))
        .map(toTheoryLessonDto)
        .map((dto) => ({ ...dto, timing: lessonTiming(dto.scheduledAt, dto.endsAt, now) })),
      ...practice
        .filter((row) => overlaps(range, row))
        .map(toPracticeLessonDto)
        .map((dto) => ({ ...dto, timing: lessonTiming(dto.scheduledAt, dto.endsAt, now) })),
    ];

    return {
      from: range.start,
      to: range.end,
      timezone: organization.timezone,
      items: items.sort(compareItems),
    };
  }

  private async requireOrganization(organizationId: string) { … } // як у LessonsService
}
```

- `AND` замість spread (`{ ...scope, scheduledAt }`): spread мовчки перетирає однойменний ключ верхнього рівня. Зараз
  колізії немає (`scheduledAt` гілки `STUDENT` всередині `OR`), але щойно в scope з'явиться `status` чи `scheduledAt`
  на верхньому рівні, spread зламає фільтр без жодної помилки. `AND` нічого не перетирає.
- У реалізації запити винесено в `findTheory` / `findPractice` (`null` → `[]` без запиту в БД, явний тип
  результату), а `timing` додає `withTiming`.
- `candidateWindow` повертає `{ gt: from − 240 хв, lt: to }`; точний перетин рахує `overlaps`. Вікно точне завдяки
  `CHECK` на `duration_min`, як у пошуку конфліктів.

### 4. Модуль і контролер

[lessons.module.ts](../src/modules/lessons/lessons.module.ts): додати `PersonalScheduleService` у `providers`.

[lessons.controller.ts](../src/modules/lessons/lessons.controller.ts): другий параметр конструктора і новий метод
першим у класі.

```ts
const SCHEDULE_DESCRIPTION =
  'Розклад поточного користувача. TEACHER — теорія своїх груп; INSTRUCTOR — свої практичні заняття; ' +
  'STUDENT — теорія своєї групи і своя практика, а з завершених груп лише заняття, що вже почалися. ' +
  `Повертаються заняття, що перетинають вікно [from, to); за замовчуванням від поточного моменту на ${SCHEDULE_DEFAULT_RANGE_DAYS} днів, ` +
  `не довше ${SCHEDULE_MAX_RANGE_DAYS} днів. Скасовані — лише з includeCancelled=true. ` +
  'timing показує, чи заняття майбутнє, триває або закінчилося. Заняття інших автошкіл і людей не повертаються.';

  @Get('me')
  @Roles(...SCHEDULE_VIEW_ROLES)
  @ApiOperation({ summary: 'Персональний розклад', description: SCHEDULE_DESCRIPTION })
  @ApiOkResponse({ type: PersonalScheduleDto })
  @ApiBadRequestResponse({
    description:
      'from чи to не ISO 8601 зі зсувом, to не пізніше за from, вікно довше ' +
      `${SCHEDULE_MAX_RANGE_DAYS} днів, некоректний type чи includeCancelled, або невідомий параметр ` +
      '(зокрема userId, groupId, organizationId). Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Роль не TEACHER, INSTRUCTOR чи STUDENT: у OWNER і ADMIN немає власного розкладу.',
  })
  @ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
  getMySchedule(
    @CurrentUser() user: User,
    @Query() query: PersonalScheduleQueryDto,
  ): Promise<PersonalScheduleDto> {
    return this.personalScheduleService.getMySchedule(user, query);
  }
```

## Error responses

Порядок перевірок: guard'и, потім pipes, потім сервіс. Неавтентифікований клієнт з некоректним query отримає
`401`; `ADMIN` з некоректним query — `403`.

| Ситуація | Де перевіряється | Статус | Тіло або повідомлення |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | як в інших модулях |
| Роль `OWNER` або `ADMIN` | `RolesGuard`, потім `scheduleScope` | 403 | `Insufficient permissions` |
| `from` чи `to` не ISO 8601 зі зсувом, без секунд, лише дата, `+` прийшов пробілом, параметр повторено | `ValidationPipe` | 400 | `errors: [{ field: 'from' \| 'to', message: SCHEDULE_RANGE_FORMAT_MESSAGE }]` |
| `type` не `THEORY` / `PRACTICE` | `ValidationPipe` | 400 | `errors: [{ field: 'type', … }]` |
| `includeCancelled` не `true` / `false` | `ValidationPipe` | 400 | `errors: [{ field: 'includeCancelled', … }]` |
| Невідомий параметр (`userId`, `groupId`, `organizationId`, `status`, …) | `ValidationPipe` | 400 | `property X should not exist` |
| `to <= from` (зокрема лише `to` у минулому, бо `from = now`) | `resolveRange` | 400 | `errors: [{ field: 'to', message: SCHEDULE_RANGE_ORDER_MESSAGE }]` |
| Вікно довше 62 днів | `resolveRange` | 400 | `errors: [{ field: 'to', message: SCHEDULE_RANGE_LENGTH_MESSAGE }]` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |

## Покриття AC

| AC | Як закрито |
|---|---|
| 1. Власний розклад | `GET /api/lessons/me`; користувач лише з access token, без параметрів ідентичності (рішення 1) |
| 2. Лише релевантні заняття | `scheduleScope` за роллю; вікно `[from, to)`; скасовані лише за явним запитом (рішення 3, 5, 6) |
| 3. Role-based access | `@Roles(...SCHEDULE_VIEW_ROLES)` і `scheduleScope` з `403` для інших ролей (рішення 2) |
| 4. TEACHER — свої заняття | теорія груп з `teacherId = actor.id` |
| 5. STUDENT — заняття своєї групи | теорія груп з `ACTIVE`-зарахуванням, історія груп з `COMPLETED`, плюс власна практика (рішення 3) |
| 6. Без чужих даних | `userId` / `groupId` у query дають `400`; у відповіді лише імена учасників власних занять, без email, телефонів і складу групи (рішення 8); integration-тести на студента, викладача й інструктора поруч |
| 7. Майбутні й завершені | вікно в майбутньому чи минулому; `timing` за часом, бо `COMPLETED` ніхто не ставить (рішення 4, 5) |
| 8. Коректна структура | `PersonalScheduleDto` з дискримінатором `type`, ті самі DTO, що в `PATCH` і `cancel`; OpenAPI з `oneOf` |
| 9. Organization isolation | фільтр організації в кожній умові, `requireOrganization`, `AuthGuard`; integration-тест з двома школами і навмисно зіпсованим зарахуванням (рішення 10) |

## Тест-план

Запуск: `npm test -- lessons`, `npm run test:integration -- lesson-schedule` (потрібен Docker),
`npm run test:e2e`, а також `npm run lint` і `npm run build`.

### `src/modules/lessons/lessons.dto.spec.ts`

Хелпер `validate` зараз передає `type: 'body'`; для query-DTO додати параметр типу або сусідній хелпер з
`type: 'query'`.

1. `{}` проходить.
2. `from` з `Z`, з `+02:00`, з мілісекундами проходить.
3. `'2026-11-02'`, `'2026-11-02T00:00:00'`, `'2026-11-02T00:00'`, `'2026-11-02T00:00:00 02:00'` (`+`, що прийшов
   пробілом), `'abc'` і масив із двох рядків дають `400` з `field: 'from'` і `SCHEDULE_RANGE_FORMAT_MESSAGE`. Те
   саме для `to`.
4. `type: 'THEORY'` і `'PRACTICE'` проходять; `'theory'` дає `LESSON_TYPE_MESSAGE`.
5. `includeCancelled: 'true'` дає `true`, `'false'` дає `false`; `'yes'`, `'1'`, `''` дають
   `INCLUDE_CANCELLED_MESSAGE`.
6. `userId`, `groupId`, `organizationId` дають `property X should not exist`.

### `src/modules/lessons/personal-schedule.service.spec.ts` (новий)

Мок `PrismaService` з `organization.findUnique`, `lesson.findMany`, `drivingLesson.findMany`; фіксований `now`
через `jest.useFakeTimers().setSystemTime(...)`.

Ролі й scope:

1. `ADMIN` і `OWNER` — `403`; жоден метод prisma не викликається.
2. `TEACHER`: `lesson.findMany` з `group: { organizationId, teacherId: actor.id }`; `drivingLesson.findMany` не
   викликається.
3. `INSTRUCTOR`: `drivingLesson.findMany` з `organizationId` і `instructorId: actor.id`; `lesson.findMany` не
   викликається.
4. `STUDENT`: теорія з `group.organizationId` і `OR` з двох гілок (`ACTIVE`; `COMPLETED` + `scheduledAt <= now`);
   практика з `organizationId` і `studentId: actor.id`. `DROPPED` у запиті не згадується.

Фільтри:

5. Без `includeCancelled` обидва запити містять `status: { not: CANCELLED }`; з `includeCancelled: true` фільтра
   статусу немає.
6. `STUDENT` з `type: 'THEORY'` робить лише запит теорії; `TEACHER` з `type: 'PRACTICE'` не робить запитів занять
   і повертає `items: []`.

Вікно:

7. Без параметрів — `from = now`, `to = now + 30 днів`; лише `from` — `to = from + 30 днів`; відповідь містить ці
   межі.
8. `to = from` і `to < from` — `400` з `field: 'to'`; рівно 62 дні — `200`; 62 дні й 1 мс — `400`. Помилки до
   будь-яких запитів у БД.
9. `scheduledAt` у запиті — `{ gt: from − 240 хв, lt: to }`.
10. Рядок, що закінчився рівно в `from`, відкидається; рядок, що почався до `from` і ще триває, лишається.

Відповідь:

11. `timing`: `scheduledAt > now` — `UPCOMING`; `scheduledAt = now` — `IN_PROGRESS`; `endsAt = now` — `FINISHED`.
12. Теорія і практика з однаковим `scheduledAt`: спершу `THEORY`; далі за `id`.
13. Елементи мають лише поля `ScheduleTheoryLessonDto` / `SchedulePracticeLessonDto` (`Object.keys`), без
    `email`, `phone`, `role`, `status` людей і `cancelledById`.
14. `timezone` береться з організації; soft-deleted організація — `404`.

### `src/modules/lessons/lessons.controller.spec.ts`

1. `getMySchedule` має `@Roles(TEACHER, INSTRUCTOR, STUDENT)` (додати рядок у наявний `it.each`).
2. Контролер передає в `PersonalScheduleService` `user` і `query` без змін.
3. Конструктор тепер приймає два сервіси: оновити `new LessonsController(...)` у блоці `endpoints`.

### `test/integration/lesson-schedule.integration-spec.ts` (новий `describe('personal schedule')`)

Новий `describe` у тому самому файлі, щоб перевикористати `createSchool()`, `theory()`, `practice()` і `at()`.
`PersonalScheduleService` створюється так само, як `DashboardService` у `beforeAll`. Минулі заняття вставляються з
`scheduledAt` відносно `Date.now()`: `CHECK` міграції минулий час не забороняє.

1. **Студент.** Теорія своєї групи і власна практика є; практики `student2` немає; теорії іншої групи тієї самої
   школи немає.
2. **Викладач.** Теорія лише своїх груп: група другого викладача тієї самої школи не потрапляє. Практики немає навіть
   без `type`.
3. **Інструктор.** Лише власна практика; заняття `otherInstructor` не потрапляють.
4. **Ізоляція організацій.** Друга школа (`createSchool()`) з заняттями в тому самому вікні: жодне її заняття не
   потрапляє до викладача, інструктора чи студента першої. Додатково навмисно зіпсоване `Enrollment` студента школи
   A в групу школи B (сирим `prisma.enrollment.create`): теорії школи B у студента немає.
5. **Межі вікна.** Заняття, що триває в момент `from`, є з `timing: IN_PROGRESS`; заняття, що починається рівно в
   `to`, і заняття, що закінчилося рівно в `from`, відсутні.
6. **Завершені заняття.** Вікно в минулому повертає заняття зі `status: SCHEDULED` і `timing: FINISHED`.
7. **Скасовані.** Після `cancelPractice` заняття зникає з розкладу; з `includeCancelled: true` воно є зі
   `status: CANCELLED`, `cancelledAt` і `cancellationReason`.
8. **Закриття групи.** Група з минулим і майбутнім заняттям; `GroupsService.changeStatus` → `COMPLETED`. Студент
   бачить минуле заняття, а майбутнього (тепер `CANCELLED`) не бачить навіть з `includeCancelled: true`. Викладач
   бачить обидва з `includeCancelled: true`.
9. **Відрахування.** Після переведення зарахування в `DROPPED` теорії групи в студента немає, власна практика
   лишається.

### `test/app.e2e-spec.ts`

1. `GET /api/lessons/me` без токена — `401`.
2. `GET /api/lessons/me?userId=…` — `400` (шаблон «rejects an unknown query parameter»).
3. `GET /api/lessons/me` для `ADMIN` — `403`.
4. OpenAPI документує `GET /api/lessons/me` з параметрами `from`, `to`, `type`, `includeCancelled` і схемою
   `PersonalScheduleDto` з `oneOf`.

### Регресія

- `lessons.service.spec.ts`, наявні `describe` у `lesson-schedule.integration-spec.ts` і
  `dashboard.service.spec.ts` проходять без змін після рефакторингу з кроку 1.

### Ручна перевірка

Ті самі demo-акаунти, що в розділі «Ручна перевірка» плану edit/reschedule. API створення занять немає, тож
заняття вставляються через `psql "$DATABASE_URL"`:

```sql
-- теорія групи студента: тиждень тому (FINISHED) і за тиждень (UPCOMING)
INSERT INTO lessons (group_id, topic, scheduled_at, duration_min)
VALUES ('<group>', 'Вступ', now() - interval '7 days', 90),
       ('<group>', 'Дорожні знаки', now() + interval '7 days', 90)
RETURNING id;

-- практика студента: завтра
INSERT INTO driving_lessons (organization_id, instructor_id, student_id, car_id, scheduled_at, duration_min)
VALUES ('<org>', '<instructor>', '<student>', '<car>', now() + interval '1 day', 60)
RETURNING id;
```

```bash
# 200: найближчі 30 днів студента — теорія групи і своя практика, timing UPCOMING
curl -s http://localhost:3000/api/lessons/me -H "Authorization: Bearer $STUDENT_TOKEN"

# 200: минулий місяць — заняття тижневої давнини зі status SCHEDULED і timing FINISHED
curl -s "http://localhost:3000/api/lessons/me?from=2026-09-24T00:00:00Z&to=2026-10-24T00:00:00Z" \
  -H "Authorization: Bearer $STUDENT_TOKEN"

# 200: TEACHER — лише теорія; INSTRUCTOR — лише практика
curl -s http://localhost:3000/api/lessons/me -H "Authorization: Bearer $TEACHER_TOKEN"
curl -s http://localhost:3000/api/lessons/me -H "Authorization: Bearer $INSTRUCTOR_TOKEN"

# 400: + без кодування приходить пробілом; з %2B — 200
curl -s "http://localhost:3000/api/lessons/me?from=2026-11-02T00:00:00+02:00" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
curl -s "http://localhost:3000/api/lessons/me?from=2026-11-02T00:00:00%2B02:00" \
  -H "Authorization: Bearer $STUDENT_TOKEN"

# 400: чужий userId; 400: вікно довше 62 днів; 403: ADMIN
curl -s "http://localhost:3000/api/lessons/me?userId=<other-student>" -H "Authorization: Bearer $STUDENT_TOKEN"
curl -s "http://localhost:3000/api/lessons/me?from=2026-11-01T00:00:00Z&to=2027-01-15T00:00:00Z" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
curl -s http://localhost:3000/api/lessons/me -H "Authorization: Bearer $ADMIN_TOKEN"
```

Додатково:

- Скасувати практику (`POST /api/lessons/practice/<id>/cancel`): вона зникає з розкладу і з'являється з
  `?includeCancelled=true`.
- У Swagger розділ `lessons` показує сім ендпоінтів; у `GET /lessons/me` є відповіді `200`, `400`, `401`, `403`,
  `404`, а схема `items` показує обидва варіанти елемента.

## Відкриті питання до продукту

Відповідь на кожне змінює невелику частину плану, але не його структуру.

1. **Чи потрібен `ADMIN` і `OWNER` якийсь розклад тут?** Зараз `403`. Розклад усієї школи з фільтрами за групою,
   викладачем чи інструктором логічно робити окремим `GET /api/lessons`.
2. **Історія студента із завершених груп.** Зараз видно заняття з `COMPLETED`-зарахування, що вже почалися. Якщо
   продукт хоче суворо як у `GET /groups` (лише `ACTIVE`), вистачить прибрати другу гілку `OR` у `scheduleScope`.
3. **Відрахований студент (`DROPPED`)** зараз не бачить теорії групи взагалі, навіть минулої. Чи показувати йому
   історію до відрахування?
4. **Чи показувати студенту `cancellationReason`?** Це вільний текст ADMIN чи викладача («Викладач захворів»); план
   cancel з тієї ж причини не пише його в лог. Зараз показується, як вимагав план cancel для списків.
5. **Межі вікна:** 30 днів за замовчуванням і 62 максимум — чи збігаються з тим, як UI показує розклад (тиждень,
   місяць, список)?

## Поза скоупом

- **Розклад школи для `ADMIN` / `OWNER`** (`GET /api/lessons` з фільтрами) і перегляд розкладу іншого користувача.
- **Створення занять**, завершення (`COMPLETED`), облік відвідування і no-show.
- **`Lesson.teacherId`** — знімок викладача на момент заняття, щоб історія не переходила до нового викладача групи.
- **Дата виходу з групи в `Enrollment`** — точна історія для випускників і відрахованих.
- **Експорт у iCal** і синхронізація з Google Calendar; сповіщення про зміни розкладу.
- **Курсорна пагінація** і нескінченний список історії.
- **Складені індекси** `(instructor_id, scheduled_at)`, `(student_id, scheduled_at)`. Наявних індексів на
  `scheduled_at`, `instructor_id`, `student_id` і `group_id` вистачає для поточних обсягів; повернутися з
  `EXPLAIN ANALYZE`, якщо запит стане повільним.

## Чек-лист для рев'ю

- [ ] Міграції немає; `lesson-view.ts` — чистий рефакторинг, наявні тести проходять без змін.
- [ ] Ідентичність лише з access token; `userId`, `groupId`, `organizationId` у query дають `400`.
- [ ] `OWNER` і `ADMIN` отримують `403` і від `RolesGuard`, і від `scheduleScope`; `403` і `400` — до запитів у БД.
- [ ] Кожна умова `scheduleScope` містить фільтр організації: `group.organizationId` для теорії, `organizationId`
      для практики.
- [ ] `TEACHER` бачить лише теорію своїх груп, `INSTRUCTOR` — лише свою практику, `STUDENT` — теорію своїх груп і
      свою практику.
- [ ] `STUDENT` з `COMPLETED`-зарахуванням бачить лише заняття, що вже почалися; з `DROPPED` — жодних.
- [ ] Вікно напіввідкрите й перетинне: `candidateWindow` у БД, `overlaps` у пам'яті; `to > from`, не довше 62 днів.
- [ ] Скасовані заняття лише з `includeCancelled=true`.
- [ ] `timing` рахується з одного `now` на запит; межі збігаються з `assertNotStarted`.
- [ ] Елементи — `TheoryLessonDto` / `PracticeLessonDto` + `timing`; немає email, телефонів, ролей, статусів людей
      і `cancelledById`.
- [ ] Сортування `scheduledAt` → `THEORY` перед `PRACTICE` → `id`.
- [ ] Swagger: query-параметри з описом `%2B`, `oneOf` з дискримінатором `type`, усі коди відповідей.
- [ ] Integration-тест з двома школами і зіпсованим зарахуванням проходить.
