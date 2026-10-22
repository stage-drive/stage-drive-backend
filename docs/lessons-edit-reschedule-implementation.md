# Lessons Edit & Reschedule: план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [groups-create-update-implementation.md](groups-create-update-implementation.md) і
[groups-complete-archive-implementation.md](groups-complete-archive-implementation.md), перш ніж імплементувати або
рев'ювати цю задачу. Звідти беруться патерни DTO (`ValidateIf` для `PATCH`, `fieldError`), RBAC (константа ролей плюс
перевірка в сервісі) і блокувань (`lockGroup`, порядок «група → заняття»). Перевірки інструктора й автомобіля
повторюють `StudentsService.grantPracticeAccess`
([students.service.ts:1225](../src/modules/students/students.service.ts#L1225)).

## Задача

Реалізувати API для редагування наявного заняття та перенесення його на іншу дату/час.

Acceptance Criteria:

1. реалізовано редагування даних заняття;
2. реалізовано reschedule;
3. змінюється дата та/або час заняття;
4. перевіряється доступність instructor;
5. перевіряється доступність групи;
6. для practice перевіряється доступність автомобіля;
7. перед збереженням виконується перевірка конфліктів;
8. заборонено створення конфліктного розкладу;
9. права на редагування перевіряються через RBAC;
10. зміни зберігаються в БД;
11. API повертає актуальні дані заняття.

## Що вже є, а чого немає

- **Заняття двох типів живуть у двох таблицях.**
  - `Lesson` (теорія): `groupId`, `topic` (`VarChar(200)`), `scheduledAt`, `durationMin` (default 90), `status`
    (`LessonStatus`), `createdAt`. Власних `organizationId` і викладача немає: обидва беруться з групи
    (`group.organizationId`, `group.teacherId`).
  - `DrivingLesson` (практика): `organizationId`, `instructorId`, `studentId` (обидва посилаються на `User`),
    `scheduledAt`, `durationMin` (default 60), `status` (`DrivingLessonStatus`), `createdAt`.
  - Поля `updatedAt` немає в жодній таблиці.
- **У `DrivingLesson` немає автомобіля.** Без нового поля AC 6 не закрити. Зараз авто є лише в `Student.carId`
  (призначається під час допуску до практики, `PATCH /students/:id/practice-access`) і в `Car.instructorId`. Потрібна
  міграція, див. рішення 3.
- **API занять немає взагалі**: ні створення, ні читання, ні редагування. Seed занять не створює. Заняття читають лише
  дашборди (Teacher і Student читають `Lesson`, Instructor читає `DrivingLesson`; усі фільтрують `SCHEDULED` і
  `scheduledAt >= now`). Крім того, `GroupsService.changeStatus` скасовує майбутні `SCHEDULED`-заняття закритої групи.
  Ця задача закладає модуль `lessons`. Майбутнє створення заняття має перевикористати пошук конфліктів і блокування з
  цього плану.
- **Блокування.** `lockGroup` ([group-lock.ts](../src/common/prisma/group-lock.ts)) уже є. `changeStatus` спершу бере
  `FOR UPDATE` на рядок групи, а потім робить `updateMany` по її заняттях, тобто блокує в порядку «група → заняття».
  Нові блокування мають іти в тому самому порядку (рішення 10).
- **Правила практики вже є в `grantPracticeAccess`.** Інструктор має бути `INSTRUCTOR`, `ACTIVE`, не видалений, з тієї
  самої організації. Авто має бути з тієї самої організації, `AVAILABLE`, призначене цьому інструктору, з категорією і
  коробкою передач як у студента. Тексти помилок уже є в cars і students: `INSTRUCTOR_NOT_FOUND_MESSAGE`,
  `INSTRUCTOR_ROLE_MESSAGE`, `INSTRUCTOR_NOT_ACTIVE_MESSAGE`, `CAR_NOT_FOUND_MESSAGE`, `CAR_NOT_AVAILABLE_MESSAGE`,
  `INSTRUCTOR_CAR_MISMATCH_MESSAGE`.
- **Формату дати-часу у вхідних DTO ще немає**: groups приймає лише `YYYY-MM-DD`. Цей план фіксує його вперше
  (рішення 4). `Organization.timezone` є (default `Europe/Kyiv`), і дашборди вже віддають його клієнту.
- Глобальний `ValidationPipe` ([configure-app.ts](../src/configure-app.ts)) має `whitelist`, `forbidNonWhitelisted`,
  `transform` (без `enableImplicitConversion`) і `stopAtFirstError`. Зайве поле в тілі дає `400`. Рядок `"60"` замість
  числа теж дає `400`.
- **У гілці `feat/THEORY-02` з'являється модель `CourseLesson`**: урок у структурі курсу
  (`/courses/:courseId/chapters/:chapterId/lessons`). Це не заняття за розкладом, моделі й маршрути не перетинаються.
  Але якщо THEORY-02 зміржать першою, міграція з цього плану має йти після `20261020140000_add_course_structure`.
  Тому генеруйте її після rebase на свіжий `develop`.

## Рішення, зафіксовані цим планом

1. **Таблиці не об'єднуються.** Злиття `Lesson` і `DrivingLesson` в одну таблицю з полем `type` зачепило б три
   дашборди і `changeStatus`, а для AC воно не потрібне. Новий модуль `src/modules/lessons` обслуговує обидва типи, а
   маршрути розділені за типом: `/api/lessons/theory/:id` і `/api/lessons/practice/:id`.
2. **Редагування і перенесення: окремі ендпоінти зі спільним конвеєром.**
   - `PATCH /:id` змінює дані: для теорії `topic` і `durationMin`, для практики `durationMin`, `instructorId` і `carId`.
   - `PATCH /:id/reschedule` змінює `scheduledAt` (обов'язкове поле) і, за потреби, `durationMin`.

   Обидва ендпоінти викликають той самий приватний метод сервісу, тож зміна тривалості чи інструктора проходить ту саму
   перевірку конфліктів, що й перенесення. Не редагуються:
   - `groupId` і `studentId`: заняття іншої групи чи іншого студента — це вже інше заняття;
   - викладач теорії: він береться з групи;
   - `status`: скасування і завершення заняття — окремі задачі;
   - `organizationId`.

   Цих полів немає в DTO, тож `forbidNonWhitelisted` поверне на них `400`.
3. **`DrivingLesson.carId` (nullable) з backfill.** Міграція додає `car_id` з FK на `cars` (`ON DELETE SET NULL`, як у
   `Student.carId`) і заповнює його в наявних рядках авто студента. Поле nullable, бо заняття студентів без авто
   лишаються без нього. При зміні розкладу перевіряється авто `payload.carId ?? lesson.carId ?? student.carId`. Якщо всі
   три `null`, відповідь `409 PRACTICE_CAR_REQUIRED_MESSAGE`. Обране авто записується в заняття. Майбутній create має
   робити `carId` обов'язковим.
4. **`scheduledAt` у форматі ISO 8601 з обов'язковим зсувом**, наприклад `2026-11-03T10:00:00+02:00` або
   `2026-11-03T08:00:00.000Z`. Без зсуву (`2026-11-03T10:00:00`) відповідь `400`, бо незрозуміло, чий це місцевий час.
   У БД зберігається UTC-момент. «Дату та/або час» з AC змінює клієнт: щоб перенести лише дату, він надсилає новий
   момент з тим самим місцевим часом у `Organization.timezone`. Окремі поля `date` і `time` у часовому поясі школи
   відкинуто: на сервері немає бібліотеки часових поясів, а переходи на літній і зимовий час легко зламати.
5. **Тривалість — ціле число хвилин від 15 до 240** (`LESSON_MIN_DURATION_MIN`, `LESSON_MAX_DURATION_MIN`). Міграція
   додає такий самий `CHECK` на обидві таблиці. Від нього залежить точність вікна в пошуку конфліктів (див. крок 4).
6. **Редагувати можна лише заняття зі статусом `SCHEDULED`.** `COMPLETED` і `CANCELLED` дають `409` з `currentStatus`
   у тілі, як `409` у `PATCH /groups/:id/status`. Теоретичне заняття закритої групи (`COMPLETED` або `ARCHIVED`) теж
   дає `409`: майбутні заняття такої групи вже скасовані, а минулі — це історія.
7. **Новий розклад має починатися в майбутньому.** Якщо змінюється хоча б одне поле розкладу (`scheduledAt`,
   `durationMin`, `instructorId`, `carId`), підсумковий `scheduledAt` має бути пізніше за `now`:
   - перенесення в минуле дає `400` з `field: 'scheduledAt'`;
   - зміна тривалості, інструктора чи авто без перенесення для заняття, яке вже почалося, дає
     `409 LESSON_ALREADY_STARTED_MESSAGE`.

   Пропущене заняття (статус `SCHEDULED`, але час уже минув) можна перенести на майбутнє, і це основний сценарій
   reschedule. Зміна лише `topic` дозволена завжди і перевірок розкладу не запускає.
8. **Що означає «доступність».** Інтервали напіввідкриті: `[scheduledAt, scheduledAt + durationMin)`. Тому заняття
   впритул (10:00–11:00 і 11:00–12:00) не конфліктують. Враховуються лише `SCHEDULED`-заняття тієї самої організації,
   крім самого заняття, що редагується.

   | Тип | Ресурс | Перевірка стану | Конфлікт: перетин часу з |
   |---|---|---|---|
   | Теорія | Викладач (`group.teacherId`) | `ACTIVE`, не видалений, інакше `409` | теорією будь-якої групи цього викладача |
   | Теорія | Група | група відкрита (рішення 6); день заняття за часовим поясом школи в межах `startDate..endDate` групи, інакше `400` | теорією цієї групи |
   | Теорія | Студенти групи (`Enrollment.status = ACTIVE`) | — | практикою будь-кого з них |
   | Практика | Інструктор | `INSTRUCTOR`, `ACTIVE`, не видалений, тієї самої організації (`404` або `409`) | практикою цього інструктора |
   | Практика | Авто | тієї самої організації, `AVAILABLE`, `car.instructorId` дорівнює інструктору заняття, категорія й коробка як у студента | практикою з цим авто |
   | Практика | Студент | `ACTIVE`, не видалений, `trainingStatus = PRACTICE` | практикою цього студента; теорією групи, де він має `ACTIVE`-зарахування |

   - AC 4 каже «instructor» для обох типів. Теорію веде `TEACHER`, тож для теорії це доступність викладача групи.
   - Студенти перевіряються в обидва боки: практика бачить теорію студента, а теорія бачить практику студентів групи.
     Інакше правило «студент не може бути на двох заняттях одночасно» можна обійти, змінюючи заняття іншого типу.
   - Стан ресурсу (статус інструктора, викладача, авто) перевіряється, навіть якщо сам ресурс не змінюється. Це
     відрізняється від рішення 5 у groups, де перейменування групи із заблокованим викладачем дозволене. Тут сервіс
     створює нове майбутнє зобов'язання, і із заблокованим інструктором заняття не відбудеться.
9. **`409` містить усі конфлікти, а не лише перший:**

   ```json
   {
     "statusCode": 409,
     "error": "Conflict",
     "message": "Обраний час конфліктує з іншими заняттями.",
     "conflicts": [
       {
         "resource": "INSTRUCTOR",
         "resourceId": "5b0c…",
         "lessonType": "PRACTICE",
         "lessonId": "9e41…",
         "scheduledAt": "2026-11-03T08:00:00.000Z",
         "endsAt": "2026-11-03T09:00:00.000Z"
       },
       {
         "resource": "CAR",
         "resourceId": "c7d2…",
         "lessonType": "PRACTICE",
         "lessonId": "9e41…",
         "scheduledAt": "2026-11-03T08:00:00.000Z",
         "endsAt": "2026-11-03T09:00:00.000Z"
       }
     ]
   }
   ```

   `resource` набуває значень `TEACHER | INSTRUCTOR | GROUP | CAR | STUDENT`. Одне чуже заняття може дати кілька
   записів, як у прикладі: той самий інструктор і те саме авто. Записи сортуються за `resource` у порядку вище, потім
   за `scheduledAt`. Імен і контактів у тілі немає, лише id: списки людей і авто фронтенд уже має.
10. **Гонки закриваються блокуваннями, а не лише перевіркою.** На рівні `READ COMMITTED` два паралельні перенесення на
    той самий слот інструктора обидва пройдуть перевірку і обидва збережуться. Exclusion constraint тут не допоможе:
    конфлікти йдуть через дві таблиці і через зарахування. Тому:
    - **На кожен ресурс нового розкладу береться advisory-lock** через `pg_advisory_xact_lock`. Ключі: `teacher:<id>`,
      `instructor:<id>`, `group:<id>`, `car:<id>`, `student:<userId>`, відсортовані. Практика блокує ще й
      `group:<id>` відкритої групи студента. Так теорія групи і практика її студента серіалізуються через спільний ключ.
    - **Порядок блокувань**: рядок групи (`lockGroup(..., 'share')`, лише для теорії) → рядок заняття (`FOR UPDATE`) →
      advisory-ключі → читання конфліктів → запис. Порядок «група → заняття» той самий, що в `changeStatus`. Тому
      закриття групи і перенесення її заняття не дають deadlock: перенесення чекає, доки група закриється, і потім
      отримує `409`.
    - Advisory-ключі завжди беруться останніми. Жодна транзакція не чекає на row-lock, утримуючи advisory-ключ, тож
      циклів очікування немає.
    - Майбутній create бере ті самі advisory-ключі (рядка заняття на той момент ще немає).
11. **RBAC.**
    - Теорія: `THEORY_LESSON_EDIT_ROLES = [ADMIN, TEACHER]`. `TEACHER` змінює лише заняття груп, де він є `teacherId`.
    - Практика: `PRACTICE_LESSON_EDIT_ROLES = [ADMIN, INSTRUCTOR]`. `INSTRUCTOR` змінює лише власні заняття. Змінити
      `instructorId` може лише `ADMIN`, інакше `403`. Інструктор може поставити лише своє авто, бо перевірка
      `car.instructorId` вимагає цього й так.
    - Заняття іншої організації дає `404 Lesson not found`. Чуже заняття своєї організації для `TEACHER` чи
      `INSTRUCTOR` дає `403`, так само як склад чужої групи для викладача
      ([groups.service.ts:401](../src/modules/groups/groups.service.ts#L401)).
    - `STUDENT` і `OWNER` отримують `403`. Доступ `OWNER`, як і в groups, лишається відкритим питанням продукту: коли
      його вирішать, достатньо додати роль у константи.
    - Сервіс повторює перевірку ролі (`assertCanEditTheory`, `assertCanEditPractice`), як `assertCanManageGroups` у
      groups.
12. **`updatedAt` на обох таблицях** (`@default(now()) @updatedAt`). Історії змін (хто переніс і з якого часу) немає,
    лише запис у лозі (див. «Поза скоупом»).
13. **Запит без фактичних змін повертає `200` без запису.** Якщо після злиття з поточними значеннями нічого не
    змінилося, сервіс повертає поточне заняття без перевірок розкладу і без `update`.

## Ендпоінти

Усі ендпоінти мають `@UseGuards(AuthGuard, RolesGuard)` на класі, `:id` — UUID v4 (`ParseUUIDPipe`). Успішна відповідь
`200` з актуальними даними заняття.

| Метод і шлях | Тіло | Ролі |
|---|---|---|
| `PATCH /api/lessons/theory/:id` | `{ topic?, durationMin? }`, хоча б одне поле | `ADMIN`, `TEACHER` (своя група) |
| `PATCH /api/lessons/theory/:id/reschedule` | `{ scheduledAt, durationMin? }` | `ADMIN`, `TEACHER` (своя група) |
| `PATCH /api/lessons/practice/:id` | `{ durationMin?, instructorId?, carId? }`, хоча б одне поле | `ADMIN`; `INSTRUCTOR` (своє заняття, без `instructorId`) |
| `PATCH /api/lessons/practice/:id/reschedule` | `{ scheduledAt, durationMin? }` | `ADMIN`; `INSTRUCTOR` (своє заняття) |

Відповідь для теорії (`TheoryLessonDto`):

```json
{
  "id": "1f0e…",
  "type": "THEORY",
  "status": "SCHEDULED",
  "topic": "Дорожні знаки",
  "scheduledAt": "2026-11-03T16:00:00.000Z",
  "endsAt": "2026-11-03T17:30:00.000Z",
  "durationMin": 90,
  "group": { "id": "4c21…", "name": "ПДР — Група А" },
  "teacher": { "id": "a3b2…", "firstName": "Ірина", "lastName": "Мельник" },
  "updatedAt": "2026-10-21T09:12:44.120Z"
}
```

Відповідь для практики (`PracticeLessonDto`):

```json
{
  "id": "9e41…",
  "type": "PRACTICE",
  "status": "SCHEDULED",
  "scheduledAt": "2026-11-03T08:00:00.000Z",
  "endsAt": "2026-11-03T09:00:00.000Z",
  "durationMin": 60,
  "instructor": { "id": "5b0c…", "firstName": "Олег", "lastName": "Ткаченко" },
  "student": { "id": "77aa…", "firstName": "Марія", "lastName": "Коваль" },
  "car": { "id": "c7d2…", "plateNumber": "AA1234BB", "category": "B", "transmission": "MANUAL" },
  "updatedAt": "2026-10-21T09:12:44.120Z"
}
```

`car` дорівнює `null` лише для старого заняття без авто, якщо запит його не змінив (рішення 13). Email і телефон
студента у відповідь не потрапляють.

## Кроки реалізації

Кроки йдуть у порядку залежностей, тож зручно робити по коміту на крок.

### 1. Prisma-схема і міграція

`prisma/schema.prisma`:

```prisma
model Car {
  // …
  students       Student[]
  drivingLessons DrivingLesson[]
}

model Lesson {
  // …
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @default(now()) @updatedAt @map("updated_at")
}

model DrivingLesson {
  // …
  carId          String?             @map("car_id") @db.Uuid
  car            Car?                @relation(fields: [carId], references: [id], onDelete: SetNull)
  createdAt      DateTime            @default(now()) @map("created_at")
  updatedAt      DateTime            @default(now()) @updatedAt @map("updated_at")

  @@index([carId])
  // наявні @@index лишаються
}
```

Згенеруйте міграцію через `npx prisma migrate dev --create-only --name add_lesson_scheduling_fields` і допишіть у неї
вручну backfill та `CHECK`. Підсумковий SQL:

```sql
-- Автомобіль практичного заняття: без нього не перевірити, чи вільне авто.
ALTER TABLE "driving_lessons" ADD COLUMN "car_id" UUID;
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_car_id_fkey"
  FOREIGN KEY ("car_id") REFERENCES "cars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "driving_lessons_car_id_idx" ON "driving_lessons"("car_id");

-- Наявні заняття отримують авто, призначене студенту під час допуску до практики.
UPDATE "driving_lessons" AS dl
SET "car_id" = s."car_id"
FROM "students" AS s
WHERE s."user_id" = dl."student_id" AND s."car_id" IS NOT NULL;

ALTER TABLE "lessons" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "driving_lessons" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Межі збігаються з LESSON_MIN_DURATION_MIN / LESSON_MAX_DURATION_MIN у lessons.dto.ts.
-- Prisma не описує CHECK у схемі; integration-тест перевіряє, що обмеження на місці.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_duration_min_check"
  CHECK ("duration_min" BETWEEN 15 AND 240);
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_duration_min_check"
  CHECK ("duration_min" BETWEEN 15 AND 240);
```

Перед деплоєм на середовище з реальними даними перевірте, що `CHECK` не впаде:

```sql
SELECT 'lessons' AS t, count(*) FROM lessons WHERE duration_min NOT BETWEEN 15 AND 240
UNION ALL
SELECT 'driving_lessons', count(*) FROM driving_lessons WHERE duration_min NOT BETWEEN 15 AND 240;
```

Дашборди і `changeStatus` після міграції змін не потребують: нові поля для них необов'язкові.

### 2. Блокування: `src/common/prisma/schedule-lock.ts` (новий)

Файл лежить поруч із `group-lock.ts` і має той самий стиль: raw SQL, параметри лише через tagged template.

```ts
import { Prisma } from '@prisma/client';

export type ScheduleResource =
  | 'teacher'
  | 'instructor'
  | 'group'
  | 'car'
  | 'student';
export type ScheduleLockKey = `${ScheduleResource}:${string}`;

export function scheduleLockKey(
  resource: ScheduleResource,
  id: string,
): ScheduleLockKey {
  return `${resource}:${id}`;
}

/**
 * Серіалізує зміни розкладу, що зачіпають ті самі ресурси. Advisory-lock
 * тримається до кінця транзакції. Ключі сортуються, щоб дві транзакції з
 * однаковим набором ресурсів не взяли їх у різному порядку (deadlock).
 */
export async function lockScheduleResources(
  tx: Prisma.TransactionClient,
  keys: readonly ScheduleLockKey[],
): Promise<void> {
  const ordered = [...new Set(keys)].sort();
  for (const key of ordered) {
    // $executeRaw: pg_advisory_xact_lock повертає void, а $queryRaw у Prisma
    // може впасти на десеріалізації колонки типу void.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
  }
}

/** Рядок теоретичного заняття. Заняття іншої організації не блокується. */
export async function lockTheoryLesson(
  tx: Prisma.TransactionClient,
  lessonId: string,
  organizationId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT l.id FROM lessons l
    JOIN groups g ON g.id = l.group_id
    WHERE l.id = ${lessonId}::uuid AND g.organization_id = ${organizationId}::uuid
    FOR UPDATE OF l
  `;
}

/** Рядок практичного заняття. Заняття іншої організації не блокується. */
export async function lockPracticeLesson(
  tx: Prisma.TransactionClient,
  lessonId: string,
  organizationId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM driving_lessons
    WHERE id = ${lessonId}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE
  `;
}
```

Колізія `hashtextextended` двох різних ключів лише зайвий раз серіалізує дві транзакції, на коректність вона не
впливає. Ключі беруться в циклі, а не одним `SELECT … FROM unnest(…)`: Postgres не гарантує порядок виклику функцій у
такому запиті.

### 3. DTO: `src/modules/lessons/lessons.dto.ts` (новий)

```ts
export const LESSON_MIN_DURATION_MIN = 15;
export const LESSON_MAX_DURATION_MIN = 240;
export const LESSON_TOPIC_MAX_LENGTH = 200;

export const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
export const LESSON_TOPIC_LENGTH_MESSAGE = `Тема має містити не більше ${LESSON_TOPIC_MAX_LENGTH} символів.`;
export const LESSON_DURATION_MESSAGE = `Тривалість має бути цілим числом хвилин від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}.`;
export const SCHEDULED_AT_FORMAT_MESSAGE =
  'scheduledAt має бути датою й часом ISO 8601 з часовим зсувом, наприклад 2026-11-03T10:00:00+02:00.';

/** Секунди обов'язкові, мілісекунди — ні. Зсув обов'язковий: Z або ±HH:MM. */
const ZONED_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export class UpdateTheoryLessonDto {
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(LESSON_TOPIC_MAX_LENGTH, { message: LESSON_TOPIC_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'topic має бути рядком.' })
  topic?: string;

  @ValidateIf((_, value) => value !== undefined)
  @Max(LESSON_MAX_DURATION_MIN, { message: LESSON_DURATION_MESSAGE })
  @Min(LESSON_MIN_DURATION_MIN, { message: LESSON_DURATION_MESSAGE })
  @IsInt({ message: LESSON_DURATION_MESSAGE })
  durationMin?: number;
}

export class UpdatePracticeLessonDto {
  // durationMin: ті самі декоратори, що в UpdateTheoryLessonDto

  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  instructorId?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'carId має бути UUID.' })
  carId?: string;
}

export class RescheduleLessonDto {
  @IsISO8601({ strict: true }, { message: SCHEDULED_AT_FORMAT_MESSAGE })
  @Matches(ZONED_DATE_TIME_PATTERN, { message: SCHEDULED_AT_FORMAT_MESSAGE })
  @IsString({ message: SCHEDULED_AT_FORMAT_MESSAGE })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  scheduledAt: string;

  // durationMin?: ті самі декоратори, що в UpdateTheoryLessonDto
}
```

- `ValidateIf(value !== undefined)` пропускає відсутнє поле, але відхиляє `null`, як `name` в `UpdateGroupDto`.
  Очищати тут нічого не можна: `topic` і `durationMin` у БД `NOT NULL`, а зняти інструктора чи авто з практики не
  можна.
- `strict: true` у `IsISO8601` відхиляє неіснуючі дати (`2026-02-30T10:00:00Z`), а `Matches` вимагає зсув і секунди.
- `scheduledAt` лишається рядком у DTO. Сервіс перетворює його через `new Date(payload.scheduledAt)`.
- У тому самому файлі опишіть відповіді для Swagger: `LessonPersonDto` (`id`, `firstName`, `lastName`),
  `LessonGroupDto`, `LessonCarDto`, `TheoryLessonDto`, `PracticeLessonDto` (див. «Ендпоінти»), `LessonConflictDto` і
  `LessonScheduleConflictResponseDto` (тіло `409` з рішення 9). Поле `type` має бути літеральним: `'THEORY'` або
  `'PRACTICE'`.
- `trimString` і `REQUIRED_FIELD_MESSAGE` скопіюйте з groups.dto.ts. Їх винесення в спільний helper — окремий
  рефакторинг (див. «Поза скоупом»).

### 4. Пошук конфліктів: `src/modules/lessons/schedule-conflicts.ts` (новий)

Тут лише функції, що приймають `tx`, без Nest-провайдера, як `lockGroup`. Їх перевикористає майбутній create.

```ts
const MINUTE_MS = 60_000;

export type ConflictResource =
  | 'TEACHER'
  | 'INSTRUCTOR'
  | 'GROUP'
  | 'CAR'
  | 'STUDENT';
export type LessonType = 'THEORY' | 'PRACTICE';

export type ScheduleSlot = { start: Date; end: Date };

export type LessonConflict = {
  resource: ConflictResource;
  resourceId: string;
  lessonType: LessonType;
  lessonId: string;
  scheduledAt: Date;
  endsAt: Date;
};

const RESOURCE_ORDER: ConflictResource[] = [
  'TEACHER',
  'INSTRUCTOR',
  'GROUP',
  'CAR',
  'STUDENT',
];

export function lessonEnd(scheduledAt: Date, durationMin: number): Date {
  return new Date(scheduledAt.getTime() + durationMin * MINUTE_MS);
}

/** Напіввідкриті інтервали: 10:00–11:00 і 11:00–12:00 не перетинаються. */
export function overlaps(
  slot: ScheduleSlot,
  other: { scheduledAt: Date; durationMin: number },
): boolean {
  return (
    other.scheduledAt < slot.end &&
    lessonEnd(other.scheduledAt, other.durationMin) > slot.start
  );
}

/**
 * Prisma не вміє фільтрувати за scheduledAt + durationMin, тому БД повертає
 * кандидатів, що починаються у вікні (start - MAX, end), а точний перетин
 * рахує overlaps(). Вікно точне завдяки CHECK на duration_min.
 */
export function candidateWindow(slot: ScheduleSlot): Prisma.DateTimeFilter {
  return {
    gt: new Date(slot.start.getTime() - LESSON_MAX_DURATION_MIN * MINUTE_MS),
    lt: slot.end,
  };
}

export async function findTheoryConflicts(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    lessonId: string;
    groupId: string;
    teacherId: string;
    slot: ScheduleSlot;
  },
): Promise<LessonConflict[]> {
  const window = candidateWindow(input.slot);
  const theory = await tx.lesson.findMany({
    where: {
      id: { not: input.lessonId },
      status: LessonStatus.SCHEDULED,
      scheduledAt: window,
      group: { organizationId: input.organizationId },
      OR: [{ groupId: input.groupId }, { group: { teacherId: input.teacherId } }],
    },
    select: {
      id: true,
      groupId: true,
      scheduledAt: true,
      durationMin: true,
      group: { select: { teacherId: true } },
    },
  });
  const practice = await tx.drivingLesson.findMany({
    where: {
      organizationId: input.organizationId,
      status: DrivingLessonStatus.SCHEDULED,
      scheduledAt: window,
      student: {
        enrollments: {
          some: { groupId: input.groupId, status: EnrollmentStatus.ACTIVE },
        },
      },
    },
    select: { id: true, studentId: true, scheduledAt: true, durationMin: true },
  });

  const conflicts: LessonConflict[] = [];
  for (const row of theory.filter((r) => overlaps(input.slot, r))) {
    if (row.groupId === input.groupId) {
      conflicts.push(toConflict('GROUP', input.groupId, 'THEORY', row));
    }
    if (row.group.teacherId === input.teacherId) {
      conflicts.push(toConflict('TEACHER', input.teacherId, 'THEORY', row));
    }
  }
  for (const row of practice.filter((r) => overlaps(input.slot, r))) {
    conflicts.push(toConflict('STUDENT', row.studentId, 'PRACTICE', row));
  }
  return sortConflicts(conflicts);
}
```

`findPracticeConflicts(tx, { organizationId, lessonId, instructorId, carId, studentId, slot })` влаштована так само:

- **практика**: один `drivingLesson.findMany` з `id: { not: lessonId }`, `organizationId`, `SCHEDULED`, вікном і
  `OR: [{ instructorId }, { carId }, { studentId }]`. Кожен рядок, що перетинається за часом, дає по запису на кожен
  ресурс, який збігся: `INSTRUCTOR`, `CAR`, `STUDENT`;
- **теорія студента**: `lesson.findMany` з `SCHEDULED`, вікном і
  `group: { organizationId, enrollments: { some: { studentId, status: ACTIVE } } }`, як у Student Dashboard. Кожен
  перетин дає запис з `resource: 'STUDENT'` і `lessonType: 'THEORY'`.

Допоміжні функції в тому самому файлі:

- `toConflict(resource, resourceId, lessonType, row)` рахує `endsAt` через `lessonEnd`;
- `sortConflicts` сортує за `RESOURCE_ORDER`, потім за `scheduledAt`, потім за `lessonId`;
- `scheduleConflict(conflicts)` повертає `ConflictException` з тілом із рішення 9.

Запити в транзакції виконуються послідовно, без `Promise.all`: interactive transaction працює на одному з'єднанні,
тож паралельність тут нічого не дає.

### 5. Сервіс: `src/modules/lessons/lessons.service.ts` (новий)

Константи:

```ts
export const THEORY_LESSON_EDIT_ROLES = [UserRole.ADMIN, UserRole.TEACHER] as const;
export const PRACTICE_LESSON_EDIT_ROLES = [UserRole.ADMIN, UserRole.INSTRUCTOR] as const;

export const LESSON_NOT_FOUND_MESSAGE = 'Lesson not found';
export const LESSON_NOT_EDITABLE_MESSAGE =
  'Змінювати можна лише заняття зі статусом SCHEDULED.';
export const LESSON_GROUP_CLOSED_MESSAGE =
  'Заняття групи зі статусом COMPLETED або ARCHIVED не можна змінювати.';
export const LESSON_IN_PAST_MESSAGE =
  'Заняття можна перенести лише на майбутній час.';
export const LESSON_ALREADY_STARTED_MESSAGE =
  'Заняття вже почалося. Спершу перенесіть його на майбутній час.';
export const LESSON_OUTSIDE_GROUP_DATES_MESSAGE =
  'Дата заняття виходить за період навчання групи.';
export const LESSON_TEACHER_NOT_ACTIVE_MESSAGE =
  'Викладач групи має бути в статусі ACTIVE.';
export const STUDENT_NOT_IN_PRACTICE_MESSAGE =
  'Студент має бути активним і мати допуск до практики (PRACTICE).';
export const PRACTICE_CAR_REQUIRED_MESSAGE =
  'Для практичного заняття потрібен автомобіль. Передайте carId.';
export const LESSON_INSTRUCTOR_CHANGE_MESSAGE =
  'Змінити інструктора заняття може лише ADMIN.';
export const LESSON_SCHEDULE_CONFLICT_MESSAGE =
  'Обраний час конфліктує з іншими заняттями.';
export const NO_THEORY_LESSON_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (topic, durationMin).';
export const NO_PRACTICE_LESSON_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (durationMin, instructorId, carId).';
```

Повідомлення про інструктора й авто імпортуються з `cars.service.ts` і `students.service.ts`, щоб тексти збігалися.
Нових копій не робіть.

Публічні методи лише готують зміну і передають її в спільний конвеєр:

```ts
async updatePractice(actor: User, lessonId: string, payload: UpdatePracticeLessonDto) {
  assertCanEditPractice(actor);
  if (Object.values(payload).every((value) => value === undefined)) {
    throw fieldError('body', NO_PRACTICE_LESSON_FIELDS_MESSAGE);
  }
  if (payload.instructorId !== undefined && actor.role !== UserRole.ADMIN) {
    throw new ForbiddenException(LESSON_INSTRUCTOR_CHANGE_MESSAGE);
  }
  return this.changePractice(actor, lessonId, payload);
}

async reschedulePractice(actor: User, lessonId: string, payload: RescheduleLessonDto) {
  assertCanEditPractice(actor);
  return this.changePractice(actor, lessonId, {
    scheduledAt: new Date(payload.scheduledAt),
    durationMin: payload.durationMin,
  });
}
```

Конвеєр практики:

```ts
private async changePractice(
  actor: User,
  lessonId: string,
  change: PracticeChange, // { scheduledAt?: Date; durationMin?: number; instructorId?: string; carId?: string }
): Promise<PracticeLessonDto> {
  await this.requireOrganization(actor.organizationId);
  const now = new Date();

  const result = await this.prisma.$transaction(async (tx) => {
    // Паралельна зміна того самого заняття чекає на цю транзакцію.
    await lockPracticeLesson(tx, lessonId, actor.organizationId);
    const lesson = await tx.drivingLesson.findFirst({
      where: { id: lessonId, organizationId: actor.organizationId },
      select: practiceLessonSelect,
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    if (actor.role === UserRole.INSTRUCTOR && lesson.instructorId !== actor.id) {
      throw new ForbiddenException('Insufficient permissions');
    }
    assertEditable(lesson.status);

    const next = {
      scheduledAt: change.scheduledAt ?? lesson.scheduledAt,
      durationMin: change.durationMin ?? lesson.durationMin,
      instructorId: change.instructorId ?? lesson.instructorId,
      carId:
        change.carId ?? lesson.carId ?? lesson.student.studentProfile?.carId ?? null,
    };
    const data = practiceDiff(lesson, next); // лише змінені поля
    if (Object.keys(data).length === 0) {
      return { lesson, changed: [] as string[] };
    }

    assertStartsInFuture(next.scheduledAt, now, change.scheduledAt !== undefined);
    assertStudentInPractice(lesson.student);
    if (next.instructorId === lesson.instructorId) {
      assertInstructorActive(lesson.instructor);
    } else {
      await requireInstructor(tx, actor.organizationId, next.instructorId);
    }
    if (!next.carId) {
      throw new ConflictException(PRACTICE_CAR_REQUIRED_MESSAGE);
    }
    await requirePracticeCar(tx, actor.organizationId, next.carId, {
      instructorId: next.instructorId,
      category: lesson.student.studentProfile.category,
      transmission: lesson.student.studentProfile.transmission,
    });

    const studentGroups = await tx.enrollment.findMany({
      where: { studentId: lesson.studentId, status: EnrollmentStatus.ACTIVE },
      select: { groupId: true },
    });
    await lockScheduleResources(tx, [
      scheduleLockKey('instructor', next.instructorId),
      scheduleLockKey('car', next.carId),
      scheduleLockKey('student', lesson.studentId),
      ...studentGroups.map((row) => scheduleLockKey('group', row.groupId)),
    ]);

    const conflicts = await findPracticeConflicts(tx, {
      organizationId: actor.organizationId,
      lessonId: lesson.id,
      instructorId: next.instructorId,
      carId: next.carId,
      studentId: lesson.studentId,
      slot: { start: next.scheduledAt, end: lessonEnd(next.scheduledAt, next.durationMin) },
    });
    if (conflicts.length > 0) {
      this.logger.log(
        `Lesson schedule conflict type=PRACTICE lessonId=${lesson.id} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw scheduleConflict(conflicts);
    }

    const saved = await tx.drivingLesson.update({
      where: { id: lesson.id },
      data,
      select: practiceLessonSelect,
    });
    return { lesson: saved, changed: Object.keys(data) };
  });

  if (result.changed.length > 0) {
    this.logger.log(
      `Lesson updated type=PRACTICE lessonId=${result.lesson.id} fields=${result.changed.join(',')} scheduledAt=${result.lesson.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
  }
  return toPracticeLessonDto(result.lesson);
}
```

Деталі практики:

- `practiceLessonSelect` вибирає поля заняття, `instructor` (`id`, імена, `role`, `status`, `deletedAt`), `student`
  (`id`, імена, `status`, `deletedAt`, `studentProfile { trainingStatus, category, transmission, carId }`) і `car`.
  `toPracticeLessonDto` віддає з них лише поля з «Ендпоінти». `role`, `status` і `deletedAt` у відповідь не
  потрапляють.
- `assertStudentInPractice` перевіряє, що `deletedAt` порожній, `status = ACTIVE`, профіль є і
  `trainingStatus = PRACTICE`. Інакше `409 STUDENT_NOT_IN_PRACTICE_MESSAGE`. `ACTIVE` без допуску тут не підходить,
  хоча `isEligibleForPractice` його приймає: там перевіряється право отримати допуск, а тут допуск уже має бути.
- `requireInstructor` повторює `CarsService.requireInstructor`: `404`, якщо користувача немає, його видалено або він з
  іншої організації; `409`, якщо роль не та або статус не `ACTIVE`. `assertInstructorActive` дає ті самі `409` для
  поточного інструктора.
- `requirePracticeCar` повторює перевірку авто з `grantPracticeAccess`: `404 CAR_NOT_FOUND_MESSAGE`,
  `409 CAR_NOT_AVAILABLE_MESSAGE`, `409 INSTRUCTOR_CAR_MISMATCH_MESSAGE`. Якщо змінюється лише `instructorId`, а
  поточне авто належить іншому інструктору, відповідь `409 INSTRUCTOR_CAR_MISMATCH_MESSAGE`. ADMIN передає
  `instructorId` і `carId` разом.
- `assertStartsInFuture(scheduledAt, now, timeChanged)`: якщо `scheduledAt > now`, перевірка пройдена. Інакше при
  `timeChanged` відповідь `400` з `field: 'scheduledAt'`, без нього — `409 LESSON_ALREADY_STARTED_MESSAGE`
  (рішення 7).
- `carId`, підставлений з профілю студента, теж записується в `data`. Тому для старого заняття без авто навіть зміна
  тривалості запише авто.

Конвеєр теорії (`changeTheory`) має ту саму структуру. Відмінності:

```ts
const organization = await this.requireOrganization(actor.organizationId); // потрібен timezone

// усередині транзакції:
const target = await tx.lesson.findFirst({
  where: { id: lessonId, group: { organizationId: actor.organizationId } },
  select: { groupId: true },
});
if (!target) throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);

// Порядок як у GroupsService.changeStatus: група → заняття. Закриття групи,
// що вже йде, завершиться раніше, і нижче ми побачимо закриту групу.
await lockGroup(tx, target.groupId, actor.organizationId, 'share');
await lockTheoryLesson(tx, lessonId, actor.organizationId);
const lesson = await tx.lesson.findFirst({
  where: { id: lessonId, group: { organizationId: actor.organizationId } },
  select: theoryLessonSelect,
}); // перечитати після блокування; null → 404
```

- Перевірка власності: `TEACHER` і `lesson.group.teacherId !== actor.id` дають `403`.
- Після `assertEditable` закрита група (`!OPEN_GROUP_STATUSES.includes(lesson.group.status)`) дає
  `409 LESSON_GROUP_CLOSED_MESSAGE`. Ця перевірка виконується і для зміни лише `topic`.
- `next = { topic, scheduledAt, durationMin }`. Перевірки розкладу (`assertStartsInFuture`, `assertWithinGroupDates`,
  `assertTeacherActive`, `lockScheduleResources([teacher:T, group:G])`, `findTheoryConflicts`) виконуються, лише якщо
  в `data` є `scheduledAt` або `durationMin`.
- `assertWithinGroupDates` порівнює місцеву дату початку заняття з датами групи. Групові дати зберігаються як UTC-північ
  дня (`toDate` у groups.service.ts), тож `toISOString().slice(0, 10)` дає саму дату:

  ```ts
  function localDate(instant: Date, timeZone: string): string {
    // en-CA форматує як YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  }

  function assertWithinGroupDates(
    scheduledAt: Date,
    group: { startDate: Date | null; endDate: Date | null },
    timeZone: string,
  ): void {
    const day = localDate(scheduledAt, timeZone);
    const start = group.startDate?.toISOString().slice(0, 10);
    const end = group.endDate?.toISOString().slice(0, 10);
    if ((start && day < start) || (end && day > end)) {
      throw fieldError('scheduledAt', LESSON_OUTSIDE_GROUP_DATES_MESSAGE);
    }
  }
  ```

- `theoryLessonSelect` вибирає поля заняття і `group { id, name, status, teacherId, startDate, endDate, teacher { id,
  firstName, lastName, status, deletedAt } }`.

Спільні правила для обох конвеєрів:

- **Ізоляція організації живе в самому запиті**: `findFirst` з `organizationId` (практика) або
  `group: { organizationId }` (теорія). Чуже заняття просто не знаходиться. Інструктор і авто перевіряються на ту саму
  організацію.
- **`requireOrganization` викликається до транзакції**, як у groups: `AuthGuard` перевіряє `BLOCKED`, але не
  `deletedAt`.
- **`try/catch` навколо транзакції не потрібен.** Унікальних індексів тут немає, а `HttpException` з транзакції і так
  доходить до клієнта.
- **У логах немає PII**: лише id, поля, що змінилися, і новий час.

### 6. Контролер, модуль, Swagger

`src/modules/lessons/lessons.controller.ts`:

```ts
@ApiTags('lessons')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('lessons')
@UseGuards(AuthGuard, RolesGuard)
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Patch('theory/:id')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({ summary: 'Редагувати теоретичне заняття', description: '…' })
  @ApiOkResponse({ type: TheoryLessonDto })
  @ApiConflictResponse({ type: LessonScheduleConflictResponseDto })
  // + ApiBadRequest/Forbidden/NotFound, як у GroupsController
  updateTheory(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateTheoryLessonDto,
  ): Promise<TheoryLessonDto> {
    return this.lessonsService.updateTheory(user, id, body);
  }

  // rescheduleTheory: @Patch('theory/:id/reschedule'), RescheduleLessonDto
  // updatePractice: @Patch('practice/:id'), @Roles(...PRACTICE_LESSON_EDIT_ROLES)
  // reschedulePractice: @Patch('practice/:id/reschedule')
}
```

У `description` кожного ендпоінта перелічіть правила з рішень 4–8 і 11: формат `scheduledAt`, межі тривалості, що
перевіряється для типу, хто може редагувати.

- `src/modules/lessons/lessons.module.ts`: `imports: [AuthModule]`, контролер і сервіс, як у `GroupsModule`.
  `PrismaModule` глобальний.
- Додайте `LessonsModule` в `AppModule`.
- `src/configure-swagger.ts`: `.addTag('lessons', 'Розклад занять: редагування і перенесення')`.

## Error responses

Порядок перевірок: guard'и, потім pipes, потім сервіс. Тому неавтентифікований клієнт з некоректним тілом отримає
`401`, а не `400`.

| Ситуація | Де перевіряється | Статус | Тіло або повідомлення |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | як в інших модулях |
| Роль не з `*_LESSON_EDIT_ROLES` (`STUDENT`, `OWNER`, `INSTRUCTOR` на теорії, `TEACHER` на практиці) | `RolesGuard` | 403 | `Insufficient permissions` |
| `:id` не UUID v4 | `ParseUUIDPipe` | 400 | `Validation failed (uuid v 4 is expected)` |
| `topic` порожня, з пробілів, довша за 200 символів, містить `<` чи `>`, або `null` | `ValidationPipe` | 400 | `errors: [{ field: 'topic', … }]` |
| `durationMin` не ціле, поза 15–240, рядок або `null` | `ValidationPipe` | 400 | `errors: [{ field: 'durationMin', message: LESSON_DURATION_MESSAGE }]` |
| Немає `scheduledAt`, немає зсуву, неіснуюча дата | `ValidationPipe` | 400 | `errors: [{ field: 'scheduledAt', … }]` |
| `instructorId` чи `carId` не UUID або `null` | `ValidationPipe` | 400 | `errors: [{ field, … }]` |
| Зайве поле (`status`, `groupId`, `studentId`, `organizationId`, `scheduledAt` у `PATCH /:id`, …) | `ValidationPipe` | 400 | `property X should not exist` |
| `PATCH /:id` з порожнім тілом | сервіс | 400 | `errors: [{ field: 'body', … }]` |
| `INSTRUCTOR` передав `instructorId` | сервіс | 403 | `LESSON_INSTRUCTOR_CHANGE_MESSAGE` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |
| Заняття немає або воно іншої організації | сервіс | 404 | `Lesson not found` |
| Чуже заняття своєї організації для `TEACHER` чи `INSTRUCTOR` | сервіс | 403 | `Insufficient permissions` |
| Заняття `COMPLETED` або `CANCELLED` | `assertEditable` | 409 | `LESSON_NOT_EDITABLE_MESSAGE`, `currentStatus` |
| Група заняття `COMPLETED` або `ARCHIVED` | `changeTheory` | 409 | `LESSON_GROUP_CLOSED_MESSAGE` |
| Новий `scheduledAt` не в майбутньому | `assertStartsInFuture` | 400 | `errors: [{ field: 'scheduledAt', message: LESSON_IN_PAST_MESSAGE }]` |
| Зміна тривалості, інструктора чи авто для заняття, що вже почалося | `assertStartsInFuture` | 409 | `LESSON_ALREADY_STARTED_MESSAGE` |
| День заняття поза `startDate..endDate` групи | `assertWithinGroupDates` | 400 | `errors: [{ field: 'scheduledAt', … }]` |
| Викладач групи не `ACTIVE` або видалений | `assertTeacherActive` | 409 | `LESSON_TEACHER_NOT_ACTIVE_MESSAGE` |
| Студента видалено, він не `ACTIVE` або не `PRACTICE` | `assertStudentInPractice` | 409 | `STUDENT_NOT_IN_PRACTICE_MESSAGE` |
| Новий інструктор не знайдений, видалений або з іншої організації | `requireInstructor` | 404 | `Instructor not found` |
| Інструктор не `INSTRUCTOR` або не `ACTIVE` | `requireInstructor`, `assertInstructorActive` | 409 | `INSTRUCTOR_ROLE_MESSAGE`, `INSTRUCTOR_NOT_ACTIVE_MESSAGE` |
| Немає авто ні в запиті, ні в занятті, ні в студента | `changePractice` | 409 | `PRACTICE_CAR_REQUIRED_MESSAGE` |
| Авто не знайдене або з іншої організації | `requirePracticeCar` | 404 | `Car not found` |
| Авто не `AVAILABLE` | `requirePracticeCar` | 409 | `CAR_NOT_AVAILABLE_MESSAGE` |
| Авто не цього інструктора або не тієї категорії чи коробки | `requirePracticeCar` | 409 | `INSTRUCTOR_CAR_MISMATCH_MESSAGE` |
| Перетин з іншими заняттями | `find*Conflicts` | 409 | тіло з рішення 9, `conflicts: […]` |

## Покриття AC

| AC | Як закрито |
|---|---|
| 1. Редагування даних | `PATCH /lessons/theory/:id` (`topic`, `durationMin`), `PATCH /lessons/practice/:id` (`durationMin`, `instructorId`, `carId`) |
| 2. Reschedule | `PATCH /lessons/{theory,practice}/:id/reschedule` |
| 3. Змінюється дата та/або час | `scheduledAt` у форматі ISO 8601 зі зсувом; клієнт складає новий момент у часовому поясі школи (рішення 4) |
| 4. Доступність instructor | практика: `requireInstructor` / `assertInstructorActive` і конфлікти `INSTRUCTOR`; теорія: `assertTeacherActive` і конфлікти `TEACHER` |
| 5. Доступність групи | відкрита група, `assertWithinGroupDates`, конфлікти `GROUP` і `STUDENT` для студентів групи |
| 6. Доступність авто для practice | `DrivingLesson.carId`, `requirePracticeCar` (організація, `AVAILABLE`, інструктор, категорія, коробка), конфлікти `CAR` |
| 7. Перевірка конфліктів перед збереженням | `find*Conflicts` у тій самій транзакції, після advisory-блокувань і перед `update` |
| 8. Заборона конфліктного розкладу | `409` з `conflicts`; advisory-lock закриває гонку паралельних запитів; integration-тест |
| 9. RBAC | `@Roles(...*_LESSON_EDIT_ROLES)`, `assertCanEdit*` у сервісі, перевірка власності для `TEACHER`/`INSTRUCTOR`, `instructorId` лише для `ADMIN` |
| 10. Зміни в БД | `tx.lesson.update` / `tx.drivingLesson.update`, `updatedAt`, записаний `carId` |
| 11. Актуальні дані у відповіді | `update` з `select` повертає збережений рядок → `TheoryLessonDto` / `PracticeLessonDto` з `endsAt` |

## Тест-план

Запуск: `npm test -- lessons schedule`, `npm run test:integration -- lesson-schedule` (потрібен Docker), а також
`npm run lint` і `npm run build`.

### `src/common/prisma/schedule-lock.spec.ts` (новий)

Той самий підхід, що в `group-lock.spec.ts`: зібрати tagged template назад у `Prisma.sql` і перевірити текст і
параметри.

1. `lockScheduleResources` викликає `$executeRaw` по разу на кожен унікальний ключ у відсортованому порядку:
   `['student:b', 'car:a', 'student:b']` дає два виклики, спершу `car:a`.
2. Порожній список не робить жодного виклику.
3. Ключ передається параметром, а не вклеюється в SQL (кейс з `'; DROP TABLE`).
4. `lockTheoryLesson` дає `… JOIN groups … FOR UPDATE OF l` з параметрами `[lessonId, organizationId]`.
5. `lockPracticeLesson` дає `… FROM driving_lessons … FOR UPDATE` з тими самими параметрами.

### `src/modules/lessons/schedule-conflicts.spec.ts` (новий)

Чисті функції:

1. `overlaps`: впритул до і після (`end == other.start`, `other.end == start`) — `false`; перетин на хвилину — `true`;
   вкладення в обидва боки — `true`; однакові інтервали — `true`.
2. `candidateWindow`: `gt = start - 240 хв`, `lt = end`.
3. `sortConflicts`: порядок за ресурсом, потім за часом.

`findTheoryConflicts` і `findPracticeConflicts` з моком `tx`:

4. `where` першого запиту містить `id: { not: lessonId }`, `status: SCHEDULED`, вікно і фільтр організації.
5. Кандидат, що лише потрапив у вікно, але закінчується до `start`, конфліктом не стає.
6. Практика: рядок з тим самим інструктором і авто дає два записи (`INSTRUCTOR`, `CAR`) з одним `lessonId`.
7. Практика: теорія групи студента дає `STUDENT` / `THEORY`.
8. Теорія: заняття тієї самої групи того самого викладача дає `GROUP` і `TEACHER`; практика студента групи дає
   `STUDENT` / `PRACTICE`.
9. Без перетинів результат — порожній масив.

### `src/modules/lessons/lessons.dto.spec.ts` (новий)

Через реальний `ValidationPipe` з опціями `configureApp`, як у `groups.dto.spec.ts`.

`RescheduleLessonDto`:

1. Проходять: `2026-11-03T10:00:00+02:00`, `2026-11-03T08:00:00Z`, `2026-11-03T08:00:00.000Z`.
2. Дають `SCHEDULED_AT_FORMAT_MESSAGE`: `2026-11-03T10:00:00` (без зсуву), `2026-11-03`, `2026-11-03T10:00+02:00`
   (без секунд), `2026-02-30T10:00:00Z`, `03.11.2026 10:00`, число `1793433600000`.
3. Немає `scheduledAt` — `REQUIRED_FIELD_MESSAGE`.
4. `durationMin`: `15` і `240` проходять; `14`, `241`, `60.5`, `"60"`, `null` дають `LESSON_DURATION_MESSAGE`.

`UpdateTheoryLessonDto`:

5. `{}` проходить pipe (порожнє тіло перевіряє сервіс); `'  Знаки  '` стає `'Знаки'`.
6. `topic: '   '`, `topic: null`, 201 символ, `'<b>x</b>'` дають `400`.
7. `scheduledAt`, `status`, `groupId` у тілі дають `400` з відповідним `field`.

`UpdatePracticeLessonDto`:

8. `instructorId: 'abc'`, `carId: null` дають `400`; `studentId` у тілі дає `400`.

### `src/modules/lessons/lessons.service.spec.ts` (новий)

Мок Prisma: `$transaction` через `mockImplementation((cb) => cb(prisma))` (як у `cars.service.spec.ts`), `$queryRaw`,
`$executeRaw`, `organization.findUnique`, `lesson.findFirst/findMany/update`,
`drivingLesson.findFirst/findMany/update`, `enrollment.findMany`, `user.findUnique`, `car.findUnique`. Час фіксується
через `jest.useFakeTimers().setSystemTime(new Date('2026-10-21T10:00:00Z'))`.

Практика:

1. `ADMIN` переносить заняття на вільний час: `update` отримує `{ scheduledAt }`, відповідь містить новий
   `scheduledAt` і `endsAt`.
2. `TEACHER` і `STUDENT` отримують `ForbiddenException` без звернень до БД.
3. `INSTRUCTOR` змінює чуже заняття — `403`; передає `instructorId` — `403` до транзакції.
4. `findFirst` повертає `null` — `404`; `where` містить `organizationId: actor.organizationId`.
5. Заняття `COMPLETED` або `CANCELLED` — `409` з `currentStatus`.
6. Перенесення на `now - 1 хв` — `400` з `field: 'scheduledAt'`. Зміна `durationMin` для заняття о `now - 30 хв` —
   `409 LESSON_ALREADY_STARTED_MESSAGE`. Перенесення пропущеного заняття на завтра проходить.
7. Студент `DROPPED`, `BLOCKED` або без профілю — `409 STUDENT_NOT_IN_PRACTICE_MESSAGE`.
8. Поточний інструктор `BLOCKED` — `409`. Новий інструктор з іншої організації — `404`; з роллю `TEACHER` — `409`.
9. `lesson.carId = null`, авто студента підставляється, перевіряється і потрапляє в `data.carId`. Немає авто ні там, ні
   там — `409 PRACTICE_CAR_REQUIRED_MESSAGE`.
10. Авто `MAINTENANCE` — `409`; авто іншого інструктора — `409 INSTRUCTOR_CAR_MISMATCH_MESSAGE`; категорія `C` у
    студента `B` — `409`; авто іншої організації — `404`.
11. `findMany` повертає перетин — `ConflictException` з тілом із рішення 9, `update` не викликається.
12. Порядок викликів (`mock.invocationCallOrder`): `$queryRaw` (рядок заняття) → `$executeRaw` (advisory) →
    `drivingLesson.findMany` (конфлікти) → `drivingLesson.update`.
13. Advisory-ключі містять `instructor:`, `car:`, `student:` і `group:` для кожного `ACTIVE`-зарахування студента.
14. Запит з тими самими значеннями — `update`, `$executeRaw` і `findMany` не викликаються, повертається поточне
    заняття.
15. `data` містить лише змінені поля.
16. Порожнє тіло `PATCH /:id` — `400` з `field: 'body'` без звернень до заняття.
17. Лог містить id і поля, що змінилися, але не імена і не email.

Теорія:

18. `TEACHER` своєї групи змінює `topic`: `update({ data: { topic } })`, без `$executeRaw` і без пошуку конфліктів.
19. `TEACHER` чужої групи — `403`; `INSTRUCTOR` — `403`.
20. Порядок: `lockGroup` (`FOR SHARE`) → `lockTheoryLesson` → повторне читання → advisory → конфлікти → `update`.
21. Група `COMPLETED` — `409 LESSON_GROUP_CLOSED_MESSAGE`, навіть для зміни лише `topic`.
22. Викладач групи `BLOCKED` — `409` при перенесенні; при зміні лише `topic` перевірки немає.
23. Дати групи `2026-11-01..2026-11-30`, `Organization.timezone = 'Europe/Kyiv'`:
    - `2026-11-30T22:30:00Z` — це вже 1 грудня 00:30 за Києвом, відповідь `400`;
    - `2026-10-31T22:30:00Z` — це вже 1 листопада, перевірка проходить.
24. Конфлікт `GROUP` і `TEACHER` з одним рядком дає два записи; практика студента групи дає `STUDENT`.

### `src/modules/lessons/lessons.controller.spec.ts` (новий)

1. Через `Reflector`: теоретичні методи мають ролі `[ADMIN, TEACHER]`, практичні — `[ADMIN, INSTRUCTOR]`.
2. Кожен метод передає в сервіс `user`, `id` і `body` без змін.

### `test/integration/lesson-schedule.integration-spec.ts` (новий, реальний Postgres)

Каркас як у `group-lock.integration-spec.ts`: testcontainers, `prisma migrate deploy`, реальний `LessonsService`,
`createSchool()` створює організацію з ADMIN, TEACHER, INSTRUCTOR, авто і студентом у `PRACTICE`.

1. **Міграція.** Вставка `driving_lessons` з `duration_min = 300` падає на `CHECK`; `car_id` є, FK працює.
2. **Реальні запити конфліктів.** Ці перевірки неможливі на моках:
   - перенесення на час іншого заняття того самого інструктора дає `409 INSTRUCTOR`;
   - заняття іншого інструктора з тим самим авто дає `409 CAR`;
   - теорія групи студента в той самий час дає `409 STUDENT` / `THEORY`;
   - перенесення теорії на час практики студента групи дає `409 STUDENT` / `PRACTICE`;
   - заняття впритул проходить; `CANCELLED`-заняття в той самий час не заважає; заняття іншої організації в той самий
     час не заважає.
3. **Гонка двох перенесень.** Сирий `prisma.$transaction` бере той самий ключ через
   `lockScheduleResources(tx, [scheduleLockKey('instructor', id)])`, вставляє заняття інструктора на 10:00 і чекає на
   `deferred()`. `reschedulePractice` іншого заняття на 10:00 має лишатися
   pending щонайменше `LOCK_WAIT_MS`. Після `resolve()` він отримує `409 INSTRUCTOR`. Без advisory-lock тест падає:
   перенесення завершилося б раніше і зберегло б конфлікт.
4. **Закриття групи проти перенесення.** Сира транзакція тримає `lockGroup(..., 'update')` і ставить групі статус
   `COMPLETED`. `rescheduleTheory` її заняття чекає і після коміту отримує `409 LESSON_GROUP_CLOSED_MESSAGE`.
5. **Немає deadlock.** Паралельно запустити `GroupsService.changeStatus` (група → `COMPLETED`) і `rescheduleTheory`
   майбутнього заняття цієї групи. Обидва мають завершитися за `UNBLOCKED_WITHIN_MS`. Одне з двох правильне: або
   заняття перенесене і потім `CANCELLED`, або перенесення отримало `409`.
6. **Advisory-lock через `$executeRaw`** працює з `@prisma/adapter-pg`. Це покривають тести 3–5, а також паралельний
   тест: два перенесення різних занять одного інструктора на той самий слот, з яких рівно одне отримує `409`. Якщо
   прибрати `lockScheduleResources`, обидва тести гонки практики падають.

Практичні шляхи друкують `DeprecationWarning: Calling client.query() when the client is already executing a query`.
Причина в Prisma: `practiceLessonSelect` має три сусідні relation (`instructor`, `student`, `car`), і всередині
транзакції Prisma читає їх паралельно на одному з'єднанні. `pg@8` ставить такі запити в чергу, тож результат
коректний. Це варто перевірити під час переходу на `pg@9`.

### Регресія

- `dashboard.service.spec.ts`, `groups.service.spec.ts` і `group-lock.integration-spec.ts` проходять без змін.
- Instructor і Teacher Dashboard після перенесення показують новий час у `upcomingLessons`.

### Ручна перевірка

Потрібні demo-акаунти з seed (`admin@example.com`, `teacher@example.com`, `instructor@example.com`,
`student@example.com`). Студенту треба видати допуск до практики (`PATCH /api/students/:id/practice-access` з
`instructorId` і `carId`; авто має бути призначене інструктору через `PATCH /api/cars/:id/instructor`). API для
створення занять немає, тож заняття вставляються через `psql "$DATABASE_URL"`. Час зберігається в UTC, а 3 листопада
2026 року Київ живе за UTC+2:

```sql
-- практика: 10:00 і 12:00 за Києвом
INSERT INTO driving_lessons (organization_id, instructor_id, student_id, car_id, scheduled_at, duration_min)
VALUES ('<org>', '<instructor>', '<student>', '<car>', '2026-11-03 08:00', 60),
       ('<org>', '<instructor>', '<student>', '<car>', '2026-11-03 10:00', 60)
RETURNING id;

-- теорія групи студента: 18:00 за Києвом
INSERT INTO lessons (group_id, topic, scheduled_at, duration_min)
VALUES ('<group>', 'Дорожні знаки', '2026-11-03 16:00', 90)
RETURNING id;
```

```bash
# 200: перенести друге практичне заняття на 14:00
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-2>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-03T14:00:00+02:00"}'

# 409 з conflicts [INSTRUCTOR, CAR, STUDENT]: на 10:30, поверх першого заняття
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-2>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-03T10:30:00+02:00"}'

# 200: впритул після першого заняття (11:00)
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-2>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-03T11:00:00+02:00"}'

# 409 STUDENT/THEORY: практика на час теорії групи (18:30)
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-2>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-03T18:30:00+02:00"}'

# 400: без часового зсуву; 400: у минулому
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-2>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-03T14:00:00"}'
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-2>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-01-01T10:00:00+02:00"}'

# 200: TEACHER змінює тему свого заняття
curl -s -X PATCH http://localhost:3000/api/lessons/theory/<theory-lesson> \
  -H "Authorization: Bearer $TEACHER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"topic":"Дорожні знаки: попереджувальні"}'

# 403: INSTRUCTOR міняє instructorId; 403: STUDENT
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-1> \
  -H "Authorization: Bearer $INSTRUCTOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructorId":"<instructor>"}'
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-1>/reschedule \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-04T10:00:00+02:00"}'
```

Додатково:

- Переведіть авто в `MAINTENANCE` (`PATCH /api/cars/:id/status`) і перенесіть практику: має бути `409`.
- Запустіть два перенесення різних занять на один слот паралельно (`… & … & wait`): рівно одне має отримати `200`.
- У Swagger розділ `lessons` має показувати чотири ендпоінти з відповідями `200`, `400`, `401`, `403`, `404`, `409`.

## Поза скоупом

- **Створення заняття, списки і календар** (`POST`, `GET /lessons`), скасування і завершення (`status`). Create має
  перевикористати `schedule-conflicts.ts` і `lockScheduleResources` та робити `carId` обов'язковим.
- **Сповіщення** студенту, викладачу чи інструктору про перенесення (MailModule готовий, це окрема задача).
- **Історія перенесень** (хто, коли, з якого часу) як окрема таблиця. Зараз є лише лог.
- **Робочі години, перерви між заняттями, відпустки інструктора, ліміт занять на день.** Зараз «доступність» означає
  лише відсутність перетину з іншими заняттями і коректний статус ресурсу.
- **Зворотні перевірки в інших модулях.** Ці дії досі не зважають на майбутні заняття:
  - переведення авто в `MAINTENANCE` чи `INACTIVE` (`CarsService.changeStatus`);
  - блокування інструктора чи викладача;
  - зміна `teacherId` групи (`GroupsService.update`): заняття переходять до нового викладача без перевірки конфліктів;
  - зміна дат групи;
  - зарахування студента в групу, коли її теорія перетинається з його практикою.

  Кожну з них варто закрити окремо, перевикориставши `find*Conflicts`.
- **Заміна викладача на одне заняття** (`Lesson.teacherId`).
- **Об'єднання `Lesson` і `DrivingLesson`** в одну таблицю (рішення 1).
- **Доступ для `OWNER`**, поки продукт не вирішить (рішення 11).
- **Винесення в спільні helper'и** `requireOrganization`, `fieldError`, `trimString`, `REQUIRED_FIELD_MESSAGE` і
  перевірок інструктора та авто. Їхні копії вже є в кількох модулях, тож це окремий рефакторинг.

## Чек-лист для рев'ю

- [ ] Міграція додає `driving_lessons.car_id` (FK `SET NULL`, індекс, backfill), `updated_at` на обох таблицях і
      `CHECK` на `duration_min`; її timestamp пізніший за міграції в `develop`.
- [ ] Межі `CHECK` збігаються з `LESSON_MIN_DURATION_MIN` і `LESSON_MAX_DURATION_MIN`.
- [ ] У DTO немає `status`, `groupId`, `studentId`, `organizationId`; `null` відхиляється для всіх полів.
- [ ] `scheduledAt` без часового зсуву дає `400`.
- [ ] Заняття шукається з фільтром організації в самому запиті; чуже заняття дає `404`, а не `403`.
- [ ] `TEACHER` і `INSTRUCTOR` змінюють лише свої заняття; `instructorId` змінює лише `ADMIN`.
- [ ] Порядок блокувань: група (`FOR SHARE`, теорія) → заняття (`FOR UPDATE`) → advisory-ключі → пошук конфліктів →
      `update`.
- [ ] Advisory-ключі відсортовані; практика блокує й `group:` відкритої групи студента.
- [ ] Пошук конфліктів враховує лише `SCHEDULED`, виключає саме заняття і використовує напіввідкриті інтервали.
- [ ] `409` містить усі конфлікти з `resource`, `resourceId`, `lessonId`, `scheduledAt`, `endsAt`.
- [ ] Зміна лише `topic` не запускає перевірок розкладу; запит без змін не пише в БД.
- [ ] Відповідь не містить email, телефону, `role`, `status` чи `deletedAt` користувачів.
- [ ] Integration-тест гонки падає, якщо прибрати `lockScheduleResources`.
- [ ] Логи без PII.
