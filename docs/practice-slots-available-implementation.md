# Доступні слоти практики для студента: план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [practice-slots-implementation.md](practice-slots-implementation.md) і
[lessons-create-implementation.md](lessons-create-implementation.md), перш ніж імплементувати або рев'ювати цю задачу.

Цей PR додає `GET /api/practice-slots/available` — список слотів, на які студент може записатися зараз. Слот потрапляє
в список, лише якщо інструктор активний, авто доступне й підходить студенту, а час не зайнятий ні інструктором, ні
авто, ні самим студентом. Це другий PR тікета: слоти вже створює `ADMIN` (див. план слотів), тепер їх бачить студент.

**Міграція не потрібна.** Усі дані вже є: слоти, заняття, профіль студента, авто.

**Що не входить у цей PR** (див. «Наступні PR»): бронювання, робочий графік і недоступність інструктора, переробка
ендпоінтів практичних занять. Наявні ендпоінти занять цей PR не змінює (див. «Ендпоінти практичних занять»).

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

## Що вже є, а чого немає

- **Слоти є.** `practice_slots`, CRUD для `ADMIN` і перегляд своїх слотів для `INSTRUCTOR` — у
  [practice-slots.service.ts](../src/modules/lessons/practice-slots.service.ts). При створенні слоту вже перевіряються
  інструктор (`ACTIVE`), авто (`AVAILABLE`, закріплене за інструктором) і конфлікти з іншими слотами й заняттями.
- **Списку для студента немає.** `GET /api/practice-slots` доступний лише `ADMIN` та `INSTRUCTOR` і повертає всі слоти
  без урахування зайнятості.
- **Позначки «заброньовано» немає.** `driving_lessons.slot_id` з'явиться в PR бронювання. Практичні заняття досі
  створюються напряму через `POST /lessons/practice`, і, за рішенням 9 плану слотів, заняття можна створити на час
  слоту.
- **Що перевикористовується:**

  | Що | Де | Для чого |
  |---|---|---|
  | `resolveRange` | [schedule-range.ts:26](../src/modules/lessons/schedule-range.ts#L26) | вікно `from`/`to`, `400` на порядок і довжину |
  | `candidateWindow`, `overlaps`, `lessonSlot`, `lessonEnd` | [schedule-conflicts.ts](../src/modules/lessons/schedule-conflicts.ts) | пошук зайнятого часу |
  | `findPracticeConflicts` | [schedule-conflicts.ts:183](../src/modules/lessons/schedule-conflicts.ts#L183) | зразок правил зайнятості студента: їх треба повторити один в один |
  | `practiceSlotSelect`, `assertRole`, `requireOrganization` | [practice-slots.service.ts:57](../src/modules/lessons/practice-slots.service.ts#L57), [:70](../src/modules/lessons/practice-slots.service.ts#L70), [:368](../src/modules/lessons/practice-slots.service.ts#L368) | той самий файл, без змін |
  | `toPracticeSlotDto`, `PracticeSlotListDto` | [practice-slot-view.ts](../src/modules/lessons/practice-slot-view.ts), [practice-slots.dto.ts](../src/modules/lessons/practice-slots.dto.ts) | форма відповіді |
  | `IsScheduleBoundary` | [lessons.dto.ts:103](../src/modules/lessons/lessons.dto.ts#L103) | валідація `from`/`to` |
  | `practiceStudentSelect`, `requirePracticeProfile`, `STUDENT_NOT_IN_PRACTICE_MESSAGE` | [lessons.service.ts:146](../src/modules/lessons/lessons.service.ts#L146), [:347](../src/modules/lessons/lessons.service.ts#L347), [:82](../src/modules/lessons/lessons.service.ts#L82) | допуск студента; зараз приватні, переїжджають у `practice-rules.ts` |
  | `STUDENT_NOT_FOUND_MESSAGE` | [students.service.ts](../src/modules/students/students.service.ts) | `404` студента |

## Рішення, зафіксовані цим планом

### Порядок PR

1. **Цей PR іде перед PR робочого графіка**, хоча план слотів ставив графік першим. Список доступних слотів — суть
   тікета, він закриває AC 1, 2, 4–10 і частину AC 3 без міграції. PR графіка потім додає один фільтр у вже готовий
   запит (див. «Наступні PR»). До того AC 3 закрито частково: статус інструктора й зайнятість, без робочих годин і
   відпусток.

### Що таке «доступний слот»

2. **Слот доступний студенту, якщо виконуються всі умови:**

   | AC | Умова | Де перевіряється |
   |---|---|---|
   | 2 | `scheduledAt > now` і початок слоту в `[from, to)` | запит слотів |
   | 3 | інструктор слоту — інструктор студента (`profile.instructorId`); зараз `INSTRUCTOR`, `ACTIVE`, не видалений | запит слотів |
   | 4 | авто зараз `AVAILABLE`, досі закріплене за цим інструктором, `category` і `transmission` збігаються зі студентом | запит слотів |
   | 5 | немає `SCHEDULED`-практики з тим самим інструктором чи авто, що перетинає слот | `isSlotFree` |
   | 5 | немає `SCHEDULED`-практики самого студента (з будь-яким інструктором), що перетинає слот | `isSlotFree` |
   | 5 | немає `SCHEDULED`-теорії груп, де студент має `ACTIVE`-зарахування, що перетинає слот | `isSlotFree` |

   Статуси інструктора й авто перевіряються на момент запиту, а не беруться з моменту створення слоту: інструктора
   могли заблокувати, авто — перевести в `MAINTENANCE` чи переприв'язати. План слотів («Поза скоупом») прямо покладає
   це на список доступних слотів.
3. **«Заброньовано» = слот перетинається зі `SCHEDULED`-заняттям того самого інструктора чи авто.** Окремої позначки
   не треба. Правило працює вже зараз (заняття, створені напряму через `POST /lessons/practice`, ховають слот) і
   лишається правильним після PR бронювання: заброньоване заняття має інструктора й авто свого слоту і перетинає його.
   Тому PR бронювання цей фільтр не змінює.
4. **Правила зайнятості — ті самі, що в `findPracticeConflicts`.** Список не має показувати слот, який бронювання
   відхилить через конфлікт. Розходження можливе лише через гонку між списком і бронюванням (рішення 13).
5. **Авто — будь-яке авто інструктора студента з відповідними категорією й коробкою**, а не лише `profile.carId`. Так
   само перевіряє `requirePracticeCar` при створенні заняття, і так адмін може відкрити слот на іншому авто того самого
   інструктора. Альтернатива — у «Відкритих питаннях».
6. **Фільтр за початком слоту, а не за перетином.** На відміну від `list()`, слот, що почався до `from` чи до `now`,
   не повертається: записатися на нього вже не можна. Тому `candidateWindow` для самих слотів не потрібен.
7. **Повертаються лише доступні слоти, без поля статусу.** Це прямо виконує AC 6 і не розкриває, коли зайняті інші
   студенти чи інструктор.

### Доступ студента

8. **Студент без допуску до практики — `409 STUDENT_NOT_IN_PRACTICE_MESSAGE`, а не порожній список.** Перевірка —
   `requirePracticeProfile`, як при створенні заняття: користувач `ACTIVE`, не видалений, `trainingStatus = PRACTICE`.
   Фронтенду треба відрізняти «немає допуску» від «немає вільних слотів».
9. **Неповний профіль практики — `409 PRACTICE_PROFILE_INCOMPLETE_MESSAGE`.** Студент у `PRACTICE`, але без
   `instructorId`, `category` чи `transmission`. Таке буває рідко: `students.instructor_id` має `SetNull` на видалення
   інструктора, а категорію можна стерти, якщо авто студента видалили (`SetNull` на `car_id`, і перевірка в
   [students.service.ts:940](../src/modules/students/students.service.ts#L940) вже не спрацьовує).
   `PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE` не підходить: він каже «Передайте instructorId», а студент цього зробити не
   може.
10. **Інструктор заблокований, авто на обслуговуванні — порожній список, а не помилка.** Це тимчасова недоступність
    ресурсу, а не проблема доступу студента (AC 6).

### RBAC і організація

11. **Ролі:**

    | Ендпоінт | `STUDENT` | `ADMIN`, `INSTRUCTOR` | `OWNER`, `TEACHER` |
    |---|---|---|---|
    | `GET /api/practice-slots/available` | свої доступні слоти | `403` (користуються `GET /api/practice-slots`) | `403` |

    - Константа `PRACTICE_SLOT_AVAILABLE_ROLES = [UserRole.STUDENT]`.
    - Сервіс повторює перевірку ролі через `assertRole`, як решта методів `PracticeSlotsService`.
12. **Студент і організація беруться лише з токена.** У query тільки `from` і `to`. Через `forbidNonWhitelisted` спроба
    передати `instructorId` чи `studentId` дає `400`. Кожен запит у БД фільтрується за `organizationId`.

### Читання

13. **Без транзакції й блокувань.** Це знімок на момент запиту. Бронювання повторить ті самі перевірки під
    advisory-ключами `instructor:`, `car:`, `student:`, тож гонка дасть `409` при бронюванні, а не подвійний запис.
14. **Зайнятий час — двома запитами на всі слоти разом**, а не `findPracticeConflicts` на кожен слот. Вікно 62 дні може
    містити сотні слотів, і запит на слот дав би сотні запитів.
15. **Відповідь — `PracticeSlotListDto`**, та сама форма, що в `GET /api/practice-slots`: `from`, `to`, `timezone`
    автошколи, `items`. Фронтенд малює обидва списки одним компонентом. `instructor` — без PII, як і зараз.
16. **Без логів.** Це читання, як `list()` і `findOne()`.

## Ендпоінти практичних занять

**У цьому PR не змінюються.** `POST /lessons/practice`, `PATCH /lessons/practice/:id`,
`PATCH /lessons/practice/:id/reschedule` і `POST /lessons/practice/:id/cancel` лишаються як є, разом із тестами в
[lessons.controller.spec.ts](../src/modules/lessons/lessons.controller.spec.ts):

- до бронювання це єдиний спосіб створити практичне заняття;
- скасування потрібне для вже запланованих занять (наприклад, інструктор захворів);
- прибрати ендпоінти без заміни означає реліз, у якому практику неможливо ні створити, ні скасувати.

**PR бронювання перероблює їх так:**

| Ендпоінт | Що стає | Чому |
|---|---|---|
| `POST /lessons/practice` | прибрати; замінює бронювання (`POST /api/practice-slots/:id/book`) | час, інструктор і авто беруться зі слоту. Бронювання перевикористовує логіку сервісу (`requirePracticeProfile`, `requirePracticeCar`, `assertPracticeSlotFree`), а не маршрут |
| `PATCH /lessons/practice/:id` | звузити до `meetingPlace` або прибрати | зміна інструктора, авто чи тривалості розійдеться зі слотом |
| `PATCH /lessons/practice/:id/reschedule` | прибрати; перенесення = скасування + бронювання іншого слоту (або окремий «перенести на слот X» пізніше) | довільний `scheduledAt` не має сенсу, коли заняття стоять на слотах |
| `POST /lessons/practice/:id/cancel` | лишити; додати `STUDENT` (своє заняття, не пізніше ніж за 24 години). За планом слотів `INSTRUCTOR` лише переглядає, тож ролі — `ADMIN` і `STUDENT` | скасування потрібне й далі. Скасоване заняття автоматично звільняє слот (рішення 3) |

Правила для того PR:

- код видаляється, а не коментується: історія лишається в git;
- разом із маршрутами прибирається все, що стало мертвим: методи сервісу, `CreatePracticeLessonDto`,
  `UpdatePracticeLessonDto`, їхні тести, Swagger-константи на кшталт `PRACTICE_CHECKS`;
- заміна й видалення йдуть в одному PR, щоб не було релізу без способу створити практику;
- відкрите питання: хто задає `meetingPlace` при бронюванні студентом (зараз воно обов'язкове при створенні).

## Ендпоінт

| Метод і шлях | Query | Ролі | Успіх |
|---|---|---|---|
| `GET /api/practice-slots/available` | `?from&to` | `STUDENT` | `200` |

Вікно — як у `GET /api/practice-slots`: за замовчуванням від поточного моменту на 30 днів, не довше 62.

16 листопада 2026 року — понеділок; Київ живе за UTC+2.

```bash
curl -s "http://localhost:3000/api/practice-slots/available?from=2026-11-16T00:00:00%2B02:00&to=2026-11-23T00:00:00%2B02:00" \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

Відповідь `200`:

```json
{
  "from": "2026-11-15T22:00:00.000Z",
  "to": "2026-11-22T22:00:00.000Z",
  "timezone": "Europe/Kyiv",
  "items": [
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
  ]
}
```

Студент без допуску, відповідь `409`:

```json
{
  "statusCode": 409,
  "message": "Студент має бути активним і мати допуск до практики (PRACTICE).",
  "error": "Conflict"
}
```

## Кроки реалізації

Кроки йдуть у порядку залежностей, тож зручно робити по коміту на крок. Крок 1 — рефакторинг без зміни поведінки.

### 1. Рефакторинг: допуск студента в `practice-rules.ts`

`PracticeSlotsService` потребує тієї самої перевірки допуску, що й `LessonsService.createPractice`. Переїжджають без
зміни поведінки з [lessons.service.ts](../src/modules/lessons/lessons.service.ts) у
[practice-rules.ts](../src/modules/lessons/practice-rules.ts):

- `practiceStudentSelect` і тип `PracticeStudentRow`;
- `requirePracticeProfile`;
- `STUDENT_NOT_IN_PRACTICE_MESSAGE`. `practice-rules.ts` не може імпортувати його з `lessons.service.ts`: це був би
  циклічний імпорт. `lessons.service.ts` реекспортує константу (`export { STUDENT_NOT_IN_PRACTICE_MESSAGE } from
  './practice-rules';`), щоб `lessons.service.spec.ts` не змінювався.

`lessonPersonSelect` для `practiceStudentSelect` імпортується з `lesson-view.ts`, як і зараз.

Наявні `lessons.service.spec.ts` і `lesson-schedule.integration-spec.ts` проходять без змін.

### 2. Зайнятий час: `schedule-conflicts.ts`

```ts
/** Заняття, що може зайняти час слоту. У теорії instructorId і carId — null. */
export type SlotBlocker = {
  instructorId: string | null;
  carId: string | null;
  studentId: string | null;
  scheduledAt: Date;
  durationMin: number;
};

/** Інтервал від початку першого рядка до кінця найпізнішого. rows не порожній. */
export function spanOf(
  rows: readonly { scheduledAt: Date; durationMin: number }[],
): ScheduleSlot {
  const start = Math.min(...rows.map((row) => row.scheduledAt.getTime()));
  const end = Math.max(
    ...rows.map((row) => lessonEnd(row.scheduledAt, row.durationMin).getTime()),
  );
  return { start: new Date(start), end: new Date(end) };
}

/**
 * Зайнятість для списку доступних слотів: SCHEDULED-практика інструктора,
 * цих авто чи студента і SCHEDULED-теорія груп з ACTIVE-зарахуванням
 * студента. Ті самі правила, що в findPracticeConflicts, але одним запитом
 * на всі слоти.
 */
export async function findStudentSlotBlockers(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    studentId: string;
    instructorId: string;
    carIds: readonly string[];
    interval: ScheduleSlot;
  },
): Promise<SlotBlocker[]> {
  const window = candidateWindow(input.interval);

  const practice = await tx.drivingLesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      OR: [
        { instructorId: input.instructorId },
        { carId: { in: [...input.carIds] } },
        { studentId: input.studentId },
      ],
    },
    select: {
      instructorId: true,
      carId: true,
      studentId: true,
      scheduledAt: true,
      durationMin: true,
    },
  });

  const theory = await tx.lesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      group: {
        enrollments: {
          some: { studentId: input.studentId, status: EnrollmentStatus.ACTIVE },
        },
      },
    },
    select: { scheduledAt: true, durationMin: true },
  });

  return [
    ...practice,
    ...theory.map((row) => ({
      ...row,
      instructorId: null,
      carId: null,
      studentId: input.studentId,
    })),
  ];
}

/** Слот вільний, якщо жодне заняття того самого інструктора, авто чи студента його не перетинає. */
export function isSlotFree(
  slot: { instructorId: string; carId: string; scheduledAt: Date; durationMin: number },
  blockers: readonly SlotBlocker[],
  studentId: string,
): boolean {
  const interval = lessonSlot(slot.scheduledAt, slot.durationMin);
  return !blockers.some(
    (row) =>
      overlaps(interval, row) &&
      (row.instructorId === slot.instructorId ||
        row.carId === slot.carId ||
        row.studentId === studentId),
  );
}
```

- Запити послідовні, як у наявних функціях цього файлу.
- `isSlotFree` — чиста функція: усі правила зайнятості тестуються без БД.
- Старі заняття з `carId = null` у фільтр `carId IN (…)` не потрапляють, але знаходяться за інструктором чи студентом.

### 3. DTO: `practice-slots.dto.ts`

```ts
export class AvailablePracticeSlotQueryDto {
  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-16T00:00:00+02:00',
    description:
      'Початок вікна, ISO 8601 з часовим зсувом (Z або ±HH:MM). За замовчуванням — поточний момент. ' +
      'Слоти, що вже почалися, не повертаються. Знак + кодуйте як %2B.',
  })
  @IsScheduleBoundary()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-11-23T00:00:00+02:00',
    description:
      `Кінець вікна, не включно. За замовчуванням — from + ${SCHEDULE_DEFAULT_RANGE_DAYS} днів. ` +
      `Має бути пізніше за from, але не більше ніж на ${SCHEDULE_MAX_RANGE_DAYS} днів.`,
  })
  @IsScheduleBoundary()
  to?: string;
}
```

Окремий клас, а не `PracticeSlotListQueryDto`: у того є `instructorId` і `carId`, а студент їх передавати не може
(рішення 12).

### 4. Сервіс: `practice-slots.service.ts`

```ts
export const PRACTICE_SLOT_AVAILABLE_ROLES = [UserRole.STUDENT] as const;

export const PRACTICE_PROFILE_INCOMPLETE_MESSAGE =
  'Профіль практики не завершено: немає інструктора, категорії чи коробки передач. Зверніться до адміністратора автошколи.';

/**
 * Слоти, на які студент може записатися: починаються у вікні [from, to) і в
 * майбутньому, інструктор студента ACTIVE, авто AVAILABLE і підходить
 * студенту, час не зайнятий інструктором, авто чи самим студентом. Без
 * транзакції: це знімок, бронювання перевірить усе ще раз під ключами.
 */
async listAvailable(
  actor: User,
  query: AvailablePracticeSlotQueryDto,
): Promise<PracticeSlotListDto> {
  assertRole(actor, PRACTICE_SLOT_AVAILABLE_ROLES);
  const now = new Date();
  const range = resolveRange(query, now);
  const organization = await this.requireOrganization(actor.organizationId);
  const profile = await this.requireBookingProfile(actor);

  const slots = await this.prisma.practiceSlot.findMany({
    where: {
      organizationId: actor.organizationId,
      instructorId: profile.instructorId,
      scheduledAt: { gt: now, gte: range.start, lt: range.end },
      instructor: {
        is: {
          role: UserRole.INSTRUCTOR,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        },
      },
      car: {
        is: {
          status: CarStatus.AVAILABLE,
          instructorId: profile.instructorId,
          category: profile.category,
          transmission: profile.transmission,
        },
      },
    },
    select: practiceSlotSelect,
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
  });

  const blockers =
    slots.length === 0
      ? []
      : await findStudentSlotBlockers(this.prisma, {
          organizationId: actor.organizationId,
          studentId: actor.id,
          instructorId: profile.instructorId,
          carIds: [...new Set(slots.map((slot) => slot.carId))],
          interval: spanOf(slots),
        });

  return {
    from: range.start,
    to: range.end,
    timezone: organization.timezone,
    items: slots
      .filter((slot) => isSlotFree(slot, blockers, actor.id))
      .map(toPracticeSlotDto),
  };
}

/**
 * Студент з токена з допуском PRACTICE і повним профілем практики.
 * Бронювання викликатиме те саме.
 */
private async requireBookingProfile(actor: User) {
  const student = await this.prisma.user.findFirst({
    where: {
      id: actor.id,
      organizationId: actor.organizationId,
      role: UserRole.STUDENT,
      deletedAt: null,
      studentProfile: { is: { organizationId: actor.organizationId } },
    },
    select: practiceStudentSelect,
  });
  if (!student) {
    throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
  }
  const { instructorId, category, transmission } =
    requirePracticeProfile(student);
  if (!instructorId || !category || !transmission) {
    throw new ConflictException(PRACTICE_PROFILE_INCOMPLETE_MESSAGE);
  }
  return { instructorId, category, transmission };
}
```

- Порядок, як у `list()`: `403` і `400` — до запитів у БД, потім `404`, потім `409`.
- `gt: now` і `gte: range.start` разом: `from` у минулому не повертає слоти, що вже почалися, а слот рівно о `now`
  вважається таким, що почався (межа та сама, що в `assertNotStarted`).
- Перевірка `null` у `category` і `transmission` потрібна й типам: `CarWhereInput.category` не приймає `null`.
- `this.prisma` підходить як `Prisma.TransactionClient` для `findStudentSlotBlockers`.

### 5. Контролер: `practice-slots.controller.ts`

```ts
@Get('available')
@Roles(...PRACTICE_SLOT_AVAILABLE_ROLES)
@ApiOperation({
  summary: 'Доступні слоти практики для студента',
  description:
    'Слоти інструктора студента, що починаються у вікні [from, to) і в майбутньому: ' +
    `за замовчуванням від поточного моменту на ${SCHEDULE_DEFAULT_RANGE_DAYS} днів, не довше ${SCHEDULE_MAX_RANGE_DAYS} днів. ` +
    'Інструктор ACTIVE, авто AVAILABLE з категорією й коробкою студента, час не зайнятий заняттями ' +
    'інструктора, авто чи студента (практика й теорія його груп). Зайняті слоти не повертаються.',
})
@ApiOkResponse({ type: PracticeSlotListDto })
@ApiBadRequestResponse({ description: '…from/to, як у списку слотів, або невідомий параметр…' })
@ApiForbiddenResponse({ description: 'Роль не STUDENT.' })
@ApiNotFoundResponse({ description: 'Автошколу чи профіль студента не знайдено.' })
@ApiConflictResponse({
  description:
    'Студент не має допуску до практики (PRACTICE) або профіль практики неповний (немає інструктора, категорії чи коробки).',
})
listAvailable(
  @CurrentUser() user: User,
  @Query() query: AvailablePracticeSlotQueryDto,
): Promise<PracticeSlotListDto> {
  return this.practiceSlotsService.listAvailable(user, query);
}
```

**Метод оголошується вище за `@Get(':id')`**
([practice-slots.controller.ts:145](../src/modules/lessons/practice-slots.controller.ts#L145)). Nest реєструє маршрути
в порядку оголошення. Якщо `:id` стоїть першим, `GET /practice-slots/available` потрапляє в `findOne`, і
`ParseUUIDPipe` повертає `400`.

`LessonsModule` не змінюється: контролер і сервіс уже зареєстровані.

## Error responses

Порядок перевірок: guard'и → pipes → сервіс.

| Ситуація | Де перевіряється | Статус | Тіло або повідомлення |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | як в інших модулях |
| Роль не `STUDENT` | `RolesGuard`, `assertRole` | 403 | `Insufficient permissions` |
| `from` / `to` не ISO 8601 зі зсувом, невідомий параметр (`instructorId`, `studentId`, …) | `ValidationPipe` | 400 | `errors: [{ field, message }]` |
| `to` не пізніше за `from` чи вікно довше 62 днів | `resolveRange` | 400 | як у `GET /api/practice-slots` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |
| Немає профілю студента | `requireBookingProfile` | 404 | `STUDENT_NOT_FOUND_MESSAGE` |
| Студент не `ACTIVE` чи не `PRACTICE` | `requirePracticeProfile` | 409 | `STUDENT_NOT_IN_PRACTICE_MESSAGE` |
| `PRACTICE`, але немає інструктора, категорії чи коробки | `requireBookingProfile` | 409 | `PRACTICE_PROFILE_INCOMPLETE_MESSAGE` |
| Інструктор заблокований, авто не `AVAILABLE`, усе зайнято | — | 200 | `items: []` |

Новий текст:

| Константа | Текст |
|---|---|
| `PRACTICE_PROFILE_INCOMPLETE_MESSAGE` | `Профіль практики не завершено: немає інструктора, категорії чи коробки передач. Зверніться до адміністратора автошколи.` |

## Покриття AC

| AC | Після цього PR | Далі |
|---|---|---|
| 1. Список доступних слотів | `GET /api/practice-slots/available` | — |
| 2. Актуальні дата та час | лише слоти в майбутньому; `scheduledAt`, `endsAt` в UTC + `timezone` | мінімальний запас до початку, якщо продукт вирішить (відкрите питання 1) |
| 3. Доступність інструктора | `ACTIVE`, роль `INSTRUCTOR`, немає його занять у цей час | робочий графік і недоступність (PR графіка) |
| 4. Доступність автомобіля | `AVAILABLE`, закріплене за інструктором, категорія й коробка студента, немає занять з цим авто | — |
| 5. Зайняті й заброньовані | перетин зі `SCHEDULED`-заняттями інструктора, авто, студента і теорією його груп | правило не змінюється після `slot_id` (рішення 3) |
| 6. Недоступні не як доступні | повертаються лише доступні слоти | — |
| 7. Доступ студента | `requirePracticeProfile`, повний профіль | — |
| 8. Authentication + RBAC | `AuthGuard`, `@Roles(STUDENT)`, `assertRole` | — |
| 9. В межах Organization | організація й студент з токена, фільтр `organizationId` у кожному запиті | — |
| 10. Структура й error responses | `PracticeSlotListDto`, таблиця помилок, Swagger | — |

## Тест-план

Запуск: `npm test -- practice-slots schedule-conflicts lessons`, `npm run test:integration -- lesson-schedule`
(потрібен Docker), `npm run lint`, `npm run build`.

### `src/modules/lessons/schedule-conflicts.spec.ts`

- `isSlotFree`, слот зайнятий:
  - практика того самого інструктора з іншим авто;
  - практика іншого інструктора з тим самим авто;
  - практика самого студента з іншим інструктором;
  - теорія групи студента.
- `isSlotFree`, слот вільний:
  - заняття впритул (закінчується, коли слот починається);
  - практика іншого інструктора, іншого авто й іншого студента.
- `findStudentSlotBlockers`: фільтр `SCHEDULED`, `organizationId`, вікно `candidateWindow(interval)`; теорія приходить
  з `studentId` студента і `null` в `instructorId`, `carId`.
- `spanOf`: слоти різної тривалості — кінець береться найпізніший, а не останнього слоту.

### `src/modules/lessons/practice-slots.dto.spec.ts`

`AvailablePracticeSlotQueryDto`: порожній query проходить; `from` без зсуву — `400`; `instructorId` у query — `400`.

### `src/modules/lessons/practice-slots.service.spec.ts` (новий `describe('listAvailable')`)

- Ролі: `ADMIN`, `INSTRUCTOR`, `TEACHER`, `OWNER` — `403` до запитів у БД.
- Вікно: `to` раніше за `from` — `400` до запитів у БД.
- Студент:
  - профілю немає — `404`;
  - `trainingStatus = ACTIVE` — `409 STUDENT_NOT_IN_PRACTICE_MESSAGE`;
  - користувач `BLOCKED` — той самий `409`;
  - `PRACTICE` без `instructorId`, `category` чи `transmission` — `409 PRACTICE_PROFILE_INCOMPLETE_MESSAGE`.
- Запит слотів: `where` містить `organizationId`, інструктора студента, `scheduledAt: { gt: now, gte: from, lt: to }`,
  фільтри інструктора (`ACTIVE`, не видалений) і авто (`AVAILABLE`, інструктор, категорія, коробка студента).
- Слотів немає — запиту зайнятості немає, `items: []`.
- Зайнятий слот (є перетин у `findStudentSlotBlockers`) не повертається, сусідній вільний — повертається.
- Відповідь містить `timezone` автошколи; порядок — за `scheduledAt`, потім `id`.

### `src/modules/lessons/practice-slots.controller.spec.ts`

- `@Roles` на `listAvailable` — `[STUDENT]`.
- `listAvailable` оголошено раніше за `findOne`:
  `Object.getOwnPropertyNames(PracticeSlotsController.prototype)` має `listAvailable` перед `findOne`. Захищає від
  `GET /available` → `ParseUUIDPipe` → `400`.
- `listAvailable` передає користувача й query в сервіс.

### `test/integration/lesson-schedule.integration-spec.ts` (`describe('practice slots')`)

Мок не перевіряє, що Prisma правильно фільтрує за складеними зв'язками `instructor` і `car`, тож на реальній БД:

- слот інструктора студента повертається; слот іншого інструктора — ні;
- авто переведене в `MAINTENANCE` — слот зникає; авто переприв'язане до іншого інструктора — зникає;
- авто іншої категорії чи коробки, ніж у студента, — слот не повертається;
- інструктора заблоковано — слоти зникають;
- практичне заняття на час слоту, створене через `LessonsService.createPractice` для іншого студента, — слот зникає;
  після `cancelPractice` — знову повертається;
- теорія групи студента на час слоту — слот зникає;
- слот іншої організації з тим самим часом не повертається.

### Регресія

- `lessons.service.spec.ts`, `lessons.controller.spec.ts`, `personal-schedule.service.spec.ts` проходять без змін.
- `npx prisma migrate status` чистий: міграцій немає.

### Ручна перевірка

Ті самі demo-акаунти, що в плані слотів. Студент `<student>` у `PRACTICE` з інструктором `<instructor>` і авто `<car>`
(`PATCH /api/students/:id/practice-access`). Слоти на 16.11 о 10:00 і 11:00 створено `ADMIN`.

```bash
# 200: обидва слоти
curl -s "http://localhost:3000/api/practice-slots/available?from=2026-11-16T00:00:00%2B02:00&to=2026-11-17T00:00:00%2B02:00" \
  -H "Authorization: Bearer $STUDENT_TOKEN"

# створити заняття іншому студенту цього інструктора на 10:00 — слот 10:00 зникає зі списку
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<other-student>","scheduledAt":"2026-11-16T10:00:00+02:00","meetingPlace":"Автодром"}'

# 403: ADMIN і INSTRUCTOR
curl -s http://localhost:3000/api/practice-slots/available -H "Authorization: Bearer $ADMIN_TOKEN"

# 400: студент передає instructorId
curl -s "http://localhost:3000/api/practice-slots/available?instructorId=<instructor>" \
  -H "Authorization: Bearer $STUDENT_TOKEN"

# 409: студент без допуску (trainingStatus = ACTIVE)
curl -s http://localhost:3000/api/practice-slots/available -H "Authorization: Bearer $ACTIVE_STUDENT_TOKEN"
```

Додатково:

- Переведіть `<car>` у `MAINTENANCE`: список порожній. Поверніть `AVAILABLE`: слоти повертаються.
- У Swagger у розділі `practice-slots` є `GET /practice-slots/available` з відповідями з таблиці помилок, а
  `GET /practice-slots/{id}` і далі працює.

## Відкриті питання до продукту

1. **Мінімальний запас до початку.** Зараз повертається будь-який майбутній слот, навіть той, що починається за хвилину.
   Студент може скасувати заняття не пізніше ніж за 24 години, тож продукт може захотіти «не записуватися менш ніж за N
   годин». Зміна — `gte: now + N` у запиті слотів і та сама межа в бронюванні.
2. **Яке авто.** Зараз — будь-яке авто інструктора студента з його категорією й коробкою (рішення 5). Альтернатива —
   лише авто, призначене студенту (`profile.carId`).
3. **`ADMIN` бачить доступні слоти конкретного студента** (`?studentId=`), щоб записати його. Пропозиція — у PR
   бронювання разом із бронюванням від імені студента.
4. **Доступ `OWNER`** — як у плані слотів: зараз `403`.
5. **Чи мають ендпоінти занять уже зараз вважати слоти зайнятим часом** (відкрите питання 2 плану слотів). Якщо так,
   `findPracticeConflicts` враховує слоти інструктора й авто, і пряме заняття не можна створити поверх слоту. Тоді
   рішення 3 цього плану перестає бути потрібним до PR бронювання, але не шкодить.

## Наступні PR

1. **Робочий графік і недоступність інструктора.** Таблиці, `PUT`/`GET` графіка, CRUD недоступності. Створення й зміна
   слоту перевіряють «слот у межах графіка» і «інструктор доступний». `listAvailable` отримує ще одну умову: немає
   недоступності інструктора, що перетинає слот. Найпростіше — третій запит у `findStudentSlotBlockers` з
   `instructorId` у рядку, і `isSlotFree` не змінюється.
2. **Бронювання і переробка ендпоінтів практики.** `driving_lessons.slot_id` з частковим унікальним індексом,
   `POST /api/practice-slots/:id/book` (перевіряє `requireBookingProfile`, ті самі фільтри, що й `listAvailable`, і
   `findPracticeConflicts` під ключами), скасування студентом не пізніше ніж за 24 години, переробка ендпоінтів занять
   за таблицею в «Ендпоінти практичних занять».

## Поза скоупом

- **Пагінація.** Вікно обмежене 62 днями, а слоти одного інструктора не перетинаються.
- **Групування за днями чи календарна сітка** — на фронтенді, з `timezone` з відповіді.
- **Кешування** списку.
- **Сповіщення** про нові слоти.

## Чек-лист для рев'ю

- [ ] `GET /available` оголошено в контролері вище за `GET :id`; тест на порядок є.
- [ ] Студент і організація беруться лише з токена; у query тільки `from` і `to`.
- [ ] Студент без `PRACTICE` — `409`, а не порожній список; неповний профіль — `409` з новим текстом.
- [ ] Статуси інструктора й авто, закріплення авто за інструктором, категорія й коробка перевіряються на момент запиту.
- [ ] Зайнятість рахує практику інструктора, авто й студента і теорію груп студента — ті самі правила, що
      `findPracticeConflicts`.
- [ ] Зайнятість читається двома запитами на всі слоти, а не запитом на слот.
- [ ] Слоти, що вже почалися, не повертаються, навіть якщо `from` у минулому.
- [ ] Відповідь не містить email, телефону, ролей і статусів людей.
- [ ] `requirePracticeProfile` перенесено без зміни поведінки; `lessons.service.spec.ts` не змінювався.
- [ ] Ендпоінти практичних занять і їхні тести не змінились.
