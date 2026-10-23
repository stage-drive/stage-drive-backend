# Lessons Create: план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [lessons-edit-reschedule-implementation.md](lessons-edit-reschedule-implementation.md)
і [lessons-cancel-implementation.md](lessons-cancel-implementation.md), перш ніж імплементувати або рев'ювати цю задачу.
Модуль `lessons`, RBAC, формат дати-часу, пошук конфліктів, advisory-блокування і DTO відповідей уже є. Створення
додає до модуля два ендпоінти і проходить той самий конвеєр «заблокувати → прочитати → перевірити → знайти конфлікти →
записати». Відмінність одна: рядка заняття ще немає, тож блокувати й виключати з пошуку конфліктів нічого.

**Міграція не потрібна.** Обидві таблиці вже мають усі поля, `CHECK` на тривалість і на поля скасування.

## Задача

Реалізувати backend API для створення теоретичних та практичних занять у розкладі.

Acceptance Criteria:

1. реалізовано створення theory slot;
2. реалізовано створення practice slot;
3. зберігаються дата та час заняття;
4. зберігається тип заняття;
5. зберігається навчальна група;
6. для practice враховується instructor;
7. для practice враховується автомобіль, якщо він необхідний;
8. перевіряється доступність пов'язаних ресурсів;
9. реалізована перевірка Authentication + RBAC;
10. дані зберігаються в межах відповідної Organization;
11. API повертає коректні success/error responses;
12. реалізована перевірка конфліктів.

## Що вже є, а чого немає

- **Дві таблиці, як і раніше.**
  - `Lesson` (теорія, `lessons`): `groupId`, `topic` (`VarChar(200)`), `scheduledAt`, `durationMin` (default 90),
    `status`, поля скасування, `createdAt`, `updatedAt`. Власних `organizationId` і викладача немає: обидва беруться з
    групи.
  - `DrivingLesson` (практика, `driving_lessons`): `organizationId`, `instructorId`, `studentId` (обидва `NOT NULL`),
    `carId` (nullable лише заради старих рядків), `scheduledAt`, `durationMin` (default 60), `status`, поля скасування.
  - `CHECK` тримає `duration_min` у межах 15–240 і узгодженість `cancelled_at` зі статусом.
- **Ендпоінта створення немає.** У ручних перевірках попередніх планів заняття вставлялися через `psql`, в
  integration-тестах через `prisma.lesson.create` / `prisma.drivingLesson.create`. План edit/reschedule прямо залишив
  create на потім: «Create має перевикористати `schedule-conflicts.ts` і `lockScheduleResources` та робити `carId`
  обов'язковим», а також «Майбутній create бере ті самі advisory-ключі».
- **Що перевикористовується:**

  | Що | Де | Для чого в create |
  |---|---|---|
  | `findTheoryConflicts`, `findPracticeConflicts` | [schedule-conflicts.ts:116](../src/modules/lessons/schedule-conflicts.ts#L116), [:181](../src/modules/lessons/schedule-conflicts.ts#L181) | пошук конфліктів; зараз приймають обов'язковий `lessonId` для виключення (крок 1) |
  | `lessonSlot`, `scheduleConflict` | [schedule-conflicts.ts](../src/modules/lessons/schedule-conflicts.ts) | інтервал і тіло `409` |
  | `lockScheduleResources`, `scheduleLockKey` | [schedule-lock.ts](../src/common/prisma/schedule-lock.ts) | advisory-ключі ресурсів |
  | `lockGroup` | [group-lock.ts](../src/common/prisma/group-lock.ts) | `FOR SHARE` на групу теорії |
  | `assertWithinGroupDates`, `assertTeacherActive`, `assertInstructorActive`, `requirePracticeProfile` | [lessons.service.ts:270](../src/modules/lessons/lessons.service.ts#L270), [:283](../src/modules/lessons/lessons.service.ts#L283), [:292](../src/modules/lessons/lessons.service.ts#L292), [:310](../src/modules/lessons/lessons.service.ts#L310) | перевірки стану ресурсів |
  | `requireInstructor`, `requirePracticeCar`, `requireOrganization` | [lessons.service.ts:733](../src/modules/lessons/lessons.service.ts#L733), [:758](../src/modules/lessons/lessons.service.ts#L758), [:793](../src/modules/lessons/lessons.service.ts#L793) | інструктор і авто з організації актора |
  | `toTheoryLessonDto`, `toPracticeLessonDto` | [lesson-view.ts](../src/modules/lessons/lesson-view.ts) | відповідь |
  | `TheoryLessonDto`, `PracticeLessonDto`, `LessonScheduleConflictResponseDto`, `IsLessonDuration`, `ZONED_DATE_TIME_PATTERN` | [lessons.dto.ts](../src/modules/lessons/lessons.dto.ts) | DTO і валідація |
  | `THEORY_CHECKS`, `PRACTICE_CHECKS`, `LESSON_CONFLICT_DESCRIPTION` | [lessons.controller.ts:75](../src/modules/lessons/lessons.controller.ts#L75) | Swagger |

- **Усі читачі розкладу вже фільтрують `SCHEDULED`**: пошук конфліктів, три дашборди, `GET /lessons/me`. Нове заняття
  з'являється в них без змін коду (перевіряється integration-тестом).
- **Допуск до практики вже задає дефолти.** `PATCH /students/:id/practice-access` ставить студенту
  `trainingStatus = PRACTICE`, `Student.instructorId` і `Student.carId`
  ([students.service.ts:1219](../src/modules/students/students.service.ts#L1219)). Create бере їх, коли клієнт не
  передав інструктора чи авто (рішення 3).
- Глобальний `ValidationPipe` ([configure-app.ts](../src/configure-app.ts)): `whitelist`, `forbidNonWhitelisted`,
  `transform` без `enableImplicitConversion`, `stopAtFirstError`. Помилки валідації мають форму
  `{ statusCode: 400, errors: [{ field, message }] }`.

## Як читаються AC

AC сформульовані загально, тому план фіксує, що саме кожен з них означає в цій кодовій базі.

- **«Slot»** — це заняття в розкладі: рядок `lessons` або `driving_lessons` зі статусом `SCHEDULED`. Окремої сутності
  «вільний слот», який студент потім бронює, немає і ця задача її не додає (відкрите питання 1).
- **Практика завжди для конкретного студента.** AC студента не згадує, але `driving_lessons.student_id` має `NOT NULL`,
  а конфлікти практики рахуються по студенту. Тому `studentId` обов'язковий.
- **«Зберігається тип заняття» (AC 4)** — тип визначає таблиця і маршрут: `POST /lessons/theory` пише в `lessons`,
  `POST /lessons/practice` пише в `driving_lessons`. У відповіді `type: 'THEORY' | 'PRACTICE'`. Окремої колонки `type`
  немає, і таблиці не об'єднуються (рішення 1 плану edit/reschedule).
- **«Зберігається навчальна група» (AC 5)** стосується теорії: `lessons.group_id` обов'язковий. Практика — індивідуальне
  заняття студента, і групу в `driving_lessons` план **не** додає:
  - група студента вже відома з `Enrollment` (і `Student.groupId`), а третя копія застаріє після переведення студента;
  - жоден читач не потребує групи в практиці: зв'язок «практика ↔ теорія групи» пошук конфліктів уже рахує через
    `ACTIVE`-зарахування в обидва боки.

  Якщо продукт усе ж хоче групу в практиці (наприклад, для календаря групи), це відкрите питання 2 з готовим рецептом.
- **«Автомобіль, якщо він необхідний» (AC 7).** Кожне нове практичне заняття має авто: так вирішено ще в плані
  edit/reschedule (рішення 3). «Якщо необхідний» означає, що клієнт може не передавати `carId`, і тоді сервер бере авто,
  призначене студенту під час допуску. Якщо авто немає ні в запиті, ні в студента, відповідь `409`. Колонка лишається
  nullable: старі рядки без авто і `ON DELETE SET NULL` на FK. Практика без авто взагалі — відкрите питання 6.

## Рішення, зафіксовані цим планом

1. **Ендпоінти:** `POST /api/lessons/theory` і `POST /api/lessons/practice`, відповідь `201 Created` з тією самою
   `TheoryLessonDto` / `PracticeLessonDto`, що в `PATCH` і `cancel`. Маршрути розділені за типом, як і решта модуля.
   Заголовка `Location` немає, бо немає `GET /lessons/theory/:id`.
2. **Тіло теорії:** `{ groupId, topic, scheduledAt, durationMin? }`.
   - Викладача в тілі немає: він береться з групи (`group.teacherId`), як і в редагуванні.
   - `durationMin` за замовчуванням `THEORY_DEFAULT_DURATION_MIN = 90`, як default колонки. Сервіс пише значення явно,
     щоб перевірка конфліктів і рядок у БД використовували те саме число.
3. **Тіло практики:** `{ studentId, scheduledAt, durationMin?, instructorId?, carId? }`. Сервер добирає те, чого немає:

   | Поле | `ADMIN` | `INSTRUCTOR` | Якщо нічого немає |
   |---|---|---|---|
   | `instructorId` | `payload.instructorId ?? student.instructorId` | завжди `actor.id`; інший id — `403` | `409 PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE` |
   | `carId` | `payload.carId ?? student.carId` | те саме | `409 PRACTICE_CAR_REQUIRED_MESSAGE` (уже є) |
   | `durationMin` | `payload.durationMin ?? 60` | те саме | — |

   Типовий запит тоді `{ studentId, scheduledAt }`. Якщо `ADMIN` передав іншого інструктора без `carId`, авто студента
   належить старому інструктору, і `requirePracticeCar` поверне `409 INSTRUCTOR_CAR_MISMATCH_MESSAGE`. Це правильна
   поведінка: з новим інструктором треба передати і його авто.
4. **Чого в тілі немає:** `status` (нове заняття завжди `SCHEDULED`, default колонки), `organizationId` (з токена),
   `teacherId`, поля скасування, `id`. `forbidNonWhitelisted` повертає на них `400`.
5. **Час.** `scheduledAt` у тому самому форматі, що в `reschedule`: ISO 8601 з обов'язковим зсувом. У БД UTC-момент.
   - Заняття створюється лише в майбутньому: `scheduledAt <= now` дає `400` з `field: 'scheduledAt'` і
     `LESSON_CREATE_IN_PAST_MESSAGE`. Ця перевірка йде до будь-яких запитів у БД.
   - Теорія: день заняття за `Organization.timezone` має бути в межах `startDate..endDate` групи
     (`assertWithinGroupDates`, `400`). Група без дат обмежень не має.
   - Верхньої межі («не далі ніж через N днів») немає (відкрите питання 5).
6. **Доступність ресурсів (AC 8).** Ті самі правила, що в рішенні 8 плану edit/reschedule, плюс перевірка, що ресурс
   існує в організації актора:

   | Тип | Ресурс | Існування й належність | Стан | Конфлікт: перетин часу з |
   |---|---|---|---|---|
   | Теорія | Група | своя організація, інакше `404 Group not found` | `PLANNED`/`ACTIVE`, інакше `409`; дата в межах групи, інакше `400` | теорією цієї групи |
   | Теорія | Викладач групи | — | `ACTIVE`, не видалений, інакше `409` | теорією будь-якої групи цього викладача |
   | Теорія | Студенти групи (`Enrollment.status = ACTIVE`) | — | — | практикою будь-кого з них |
   | Практика | Студент | `STUDENT` своєї організації, не видалений, з профілем, інакше `404 Student not found` | `ACTIVE` і `trainingStatus = PRACTICE`, інакше `409` | практикою цього студента; теорією груп, де він має `ACTIVE`-зарахування |
   | Практика | Інструктор | своя організація, інакше `404 Instructor not found` | роль `INSTRUCTOR`, `ACTIVE`, інакше `409` | практикою цього інструктора |
   | Практика | Авто | своя організація, інакше `404 Car not found` | `AVAILABLE`, призначене інструктору, категорія й коробка як у студента, інакше `409` | практикою з цим авто |

7. **Конфлікти (AC 12)** — ті самі `findTheoryConflicts` / `findPracticeConflicts` з `lessonId: null`. Інтервали
   напіввідкриті, враховуються лише `SCHEDULED`-заняття тієї самої організації. `409` повертає повний список у формі
   `LessonScheduleConflictResponseDto`. Повторне натискання «Створити» з тим самим тілом дає `409` на власне щойно
   створене заняття (той самий інструктор, авто й студент або та сама група), тож дубль не з'явиться без ключа
   ідемпотентності.
8. **Гонки закриваються тими самими блокуваннями, що в edit/reschedule (рішення 10 там).**
   - **Теорія:** `lockGroup(..., 'share')` → читання групи з фільтром організації → перевірки → advisory-ключі
     `teacher:<id>` і `group:<id>` → `findTheoryConflicts` → `create`. Порядок «група → advisory» той самий, що в
     `changeTheory`. Паралельне закриття групи: create чекає, потім бачить `COMPLETED` і отримує `409`; deadlock
     неможливий.
   - **Практика:** рядка заняття ще немає, тож row-lock не береться. Читання студента → вибір інструктора й авто →
     перевірки → advisory-ключі `instructor:<id>`, `car:<id>`, `student:<id>` і `group:<id>` кожної `ACTIVE`-групи
     студента → `findPracticeConflicts` → `create`.
   - Два паралельні створення на той самий слот серіалізуються advisory-ключем: друге бачить перше і отримує `409`.
     Створення і перенесення різних занять на той самий слот — так само.
   - Прогалини, успадковані від edit/reschedule, лишаються («Поза скоупом» там): паралельна зміна статусу авто,
     блокування інструктора чи відкликання допуску студента не беруть цих ключів.
9. **RBAC (AC 9).** Ролі ті самі, що для редагування і скасування. Окремі константи `*_CREATE_ROLES` не заводяться,
   поки ролі збігаються (як у рішенні 8 плану cancel).
   - Теорія: `THEORY_LESSON_EDIT_ROLES = [ADMIN, TEACHER]`. `TEACHER` створює заняття лише для груп, де він
     `teacherId`, інакше `403`.
   - Практика: `PRACTICE_LESSON_EDIT_ROLES = [ADMIN, INSTRUCTOR]`. `INSTRUCTOR` створює лише власні заняття:
     - `instructorId` у тілі відсутній або дорівнює `actor.id`, інакше `403 LESSON_INSTRUCTOR_ASSIGN_MESSAGE` (до
       транзакції);
     - студент має бути призначений цьому інструктору (`Student.instructorId = actor.id`), інакше
       `403 STUDENT_NOT_ASSIGNED_MESSAGE`. Інакше інструктор міг би ставити заняття чужим студентам. `ADMIN` може
       будь-якому (відкрите питання 3).
   - `STUDENT` і `OWNER` отримують `403` від `RolesGuard`. Сервіс повторює перевірку ролі (`assertCanEditTheory`,
     `assertCanEditPractice`).
   - Ресурс іншої організації дає `404`, а не `403`, щоб не розкривати факт існування id. Чужий ресурс своєї організації
     для `TEACHER` чи `INSTRUCTOR` дає `403`.
10. **Ізоляція організацій (AC 10).** Організація береться лише з токена.
    - Теорія: заняття належить організації через групу, а група шукається з `organizationId: actor.organizationId`.
      `lockGroup` теж фільтрує за організацією, тож чужу групу навіть не заблокує.
    - Практика: `organizationId: actor.organizationId` пишеться явно. Студент, інструктор і авто перевіряються на ту саму
      організацію (`404`).
    - `requireOrganization` дає `404` для видаленої організації; заблоковану відсікає `AuthGuard` (`401`).
11. **Спільні перевірки слоту виносяться з `changeTheory` / `changePractice`** у приватні методи
    `assertTheorySlotFree` і `assertPracticeSlotFree` (advisory-ключі → пошук конфліктів → лог → `409`). Create і change
    викликають їх, тож правила конфліктів живуть в одному місці. Це чистий рефакторинг окремим комітом: наявні тести
    `lessons.service.spec.ts` і `lesson-schedule.integration-spec.ts` проходять без змін.
12. **Логи без PII.** `Lesson created type=THEORY lessonId=… groupId=… scheduledAt=… durationMin=… actorId=…
    organizationId=…` і `Lesson created type=PRACTICE lessonId=… instructorId=… studentId=… carId=… scheduledAt=…
    durationMin=… actorId=… organizationId=…`. `topic` у лог не пишеться: це вільний текст. Лог конфлікту той самий, що
    в edit, з `lessonId=new`.

## Ендпоінти

Обидва ендпоінти під `@UseGuards(AuthGuard, RolesGuard)` на класі. Успішна відповідь `201` з даними збереженого
заняття.

| Метод і шлях | Тіло | Ролі |
|---|---|---|
| `POST /api/lessons/theory` | `{ groupId, topic, scheduledAt, durationMin? }` | `ADMIN`, `TEACHER` (своя група) |
| `POST /api/lessons/practice` | `{ studentId, scheduledAt, durationMin?, instructorId?, carId? }` | `ADMIN`; `INSTRUCTOR` (лише як інструктор заняття, лише свій студент) |

Запит теорії:

```json
{
  "groupId": "4c21…",
  "topic": "Дорожні знаки",
  "scheduledAt": "2026-11-03T18:00:00+02:00",
  "durationMin": 90
}
```

Відповідь `201`:

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
  "cancelledAt": null,
  "cancellationReason": null,
  "updatedAt": "2026-10-23T09:12:44.120Z"
}
```

Запит практики (інструктор і авто з допуску студента):

```json
{ "studentId": "77aa…", "scheduledAt": "2026-11-03T10:00:00+02:00" }
```

Відповідь `201`:

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
  "cancelledAt": null,
  "cancellationReason": null,
  "updatedAt": "2026-10-23T09:12:44.120Z"
}
```

`car` у новому занятті ніколи не `null`. Email, телефон, роль і статуси людей у відповідь не потрапляють.

## Кроки реалізації

Кроки йдуть у порядку залежностей, тож зручно робити по коміту на крок. Кроки 1–2 — рефакторинг без зміни поведінки.

### 1. Пошук конфліктів без виключення: `src/modules/lessons/schedule-conflicts.ts`

`lessonId` в обох функціях стає `string | null`:

```ts
/** Нове заняття ще не має id, тож нічого не виключається. */
function excludeLesson(lessonId: string | null): Prisma.LessonWhereInput {
  return lessonId === null ? {} : { id: { not: lessonId } };
}

export async function findTheoryConflicts(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    /** Заняття, що змінюється; null для нового. */
    lessonId: string | null;
    groupId: string;
    teacherId: string;
    slot: ScheduleSlot;
  },
): Promise<LessonConflict[]> {
  const window = candidateWindow(input.slot);

  const theory = await tx.lesson.findMany({
    where: {
      ...excludeLesson(input.lessonId),
      status: LessonStatus.SCHEDULED,
      // … решта без змін
```

У `findPracticeConflicts` те саме для `tx.drivingLesson.findMany` (тип `Prisma.DrivingLessonWhereInput`; простіше
зробити helper generic або inline-тернарник).

Чому не `lessonId?: string`: явний `null` змушує кожен виклик сказати, що він робить. Чому не `id: { not: undefined }`:
Prisma мовчки пропускає `undefined` у фільтрі, і це працює випадково.

### 2. Винести перевірку слоту: `src/modules/lessons/lessons.service.ts`

Блок «advisory-ключі → пошук → лог → `409`» з `changeTheory`
([lessons.service.ts:516](../src/modules/lessons/lessons.service.ts#L516)) і `changePractice`
([:620](../src/modules/lessons/lessons.service.ts#L620)) переїжджає в приватні методи:

```ts
  /**
   * Advisory-ключі викладача й групи → пошук конфліктів теорії. Викликається
   * після всіх row-lock'ів транзакції. lessonId — null для нового заняття.
   */
  private async assertTheorySlotFree(
    tx: Prisma.TransactionClient,
    actor: User,
    input: {
      lessonId: string | null;
      groupId: string;
      teacherId: string;
      slot: ScheduleSlot;
    },
  ): Promise<void> {
    await lockScheduleResources(tx, [
      scheduleLockKey('teacher', input.teacherId),
      scheduleLockKey('group', input.groupId),
    ]);
    const conflicts = await findTheoryConflicts(tx, {
      organizationId: actor.organizationId,
      ...input,
    });
    if (conflicts.length > 0) {
      this.logger.log(
        `Lesson schedule conflict type=THEORY lessonId=${input.lessonId ?? 'new'} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw scheduleConflict(conflicts);
    }
  }

  /**
   * Advisory-ключі інструктора, авто, студента і його відкритих груп → пошук
   * конфліктів практики. Спільний ключ group: серіалізує практику студента з
   * теорією його групи.
   */
  private async assertPracticeSlotFree(
    tx: Prisma.TransactionClient,
    actor: User,
    input: {
      lessonId: string | null;
      instructorId: string;
      carId: string;
      studentId: string;
      slot: ScheduleSlot;
    },
  ): Promise<void> {
    const studentGroups = await tx.enrollment.findMany({
      where: { studentId: input.studentId, status: EnrollmentStatus.ACTIVE },
      select: { groupId: true },
    });
    await lockScheduleResources(tx, [
      scheduleLockKey('instructor', input.instructorId),
      scheduleLockKey('car', input.carId),
      scheduleLockKey('student', input.studentId),
      ...studentGroups.map((row) => scheduleLockKey('group', row.groupId)),
    ]);
    const conflicts = await findPracticeConflicts(tx, {
      organizationId: actor.organizationId,
      ...input,
    });
    if (conflicts.length > 0) {
      this.logger.log(
        `Lesson schedule conflict type=PRACTICE lessonId=${input.lessonId ?? 'new'} conflicts=${conflicts.length} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      throw scheduleConflict(conflicts);
    }
  }
```

`changeTheory` і `changePractice` викликають їх з `lessonId: lesson.id`. Текст логів для редагування не змінюється.

Ще два дрібні виноси, які знадобляться create:

- **`lessonGroupSelect`** — під-select групи з `theoryLessonSelect` (`id`, `name`, `status`, `teacherId`, `startDate`,
  `endDate`, `teacher` зі `status` і `deletedAt`). `theoryLessonSelect.group` стає `{ select: lessonGroupSelect }`,
  а create читає групу тим самим select.
- **`practiceStudentSelect`** — під-select студента з `practiceLessonSelect`, плюс `studentProfile.instructorId`
  (потрібен для дефолту і перевірки «свій студент»). `requirePracticeProfile` типізується через цей select, а не через
  `PracticeLessonRow['student']`.

### 3. DTO: `src/modules/lessons/lessons.dto.ts`

Константи й повідомлення:

```ts
/** Збігаються з @default у колонках duration_min. */
export const THEORY_DEFAULT_DURATION_MIN = 90;
export const PRACTICE_DEFAULT_DURATION_MIN = 60;
```

Набір декораторів `RescheduleLessonDto.scheduledAt` ([lessons.dto.ts:174](../src/modules/lessons/lessons.dto.ts#L174))
виноситься в `IsScheduledAt()` поруч з `IsLessonDuration()`, бо тепер у нього три користувачі:

```ts
/** Обов'язковий початок заняття: ISO 8601 з часовим зсувом. */
function IsScheduledAt() {
  return applyDecorators(
    IsISO8601({ strict: true }, { message: SCHEDULED_AT_FORMAT_MESSAGE }),
    Matches(ZONED_DATE_TIME_PATTERN, { message: SCHEDULED_AT_FORMAT_MESSAGE }),
    IsString({ message: SCHEDULED_AT_FORMAT_MESSAGE }),
    IsDefined({ message: REQUIRED_FIELD_MESSAGE }),
  );
}
```

`RescheduleLessonDto` починає використовувати `@IsScheduledAt()`; `lessons.dto.spec.ts` має пройти без змін.

```ts
export class CreateTheoryLessonDto {
  @ApiProperty({
    format: 'uuid',
    example: '4c21a0b0-0000-4000-8000-000000000000',
    description:
      'Група своєї автошколи зі статусом PLANNED або ACTIVE. Викладач заняття — викладач групи.',
  })
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  groupId: string;

  @ApiProperty({
    example: 'Дорожні знаки',
    maxLength: LESSON_TOPIC_MAX_LENGTH,
    description: 'Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(LESSON_TOPIC_MAX_LENGTH, { message: LESSON_TOPIC_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'topic має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  topic: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-03T18:00:00+02:00',
    description:
      'Початок заняття, ISO 8601 з часовим зсувом (Z або ±HH:MM). Має бути в майбутньому і в межах дат групи.',
  })
  @IsScheduledAt()
  scheduledAt: string;

  @ApiPropertyOptional({
    example: THEORY_DEFAULT_DURATION_MIN,
    default: THEORY_DEFAULT_DURATION_MIN,
    minimum: LESSON_MIN_DURATION_MIN,
    maximum: LESSON_MAX_DURATION_MIN,
    description: DURATION_DESCRIPTION,
  })
  @IsLessonDuration()
  durationMin?: number;
}

export class CreatePracticeLessonDto {
  @ApiProperty({
    format: 'uuid',
    example: '77aa0000-0000-4000-8000-000000000000',
    description: 'Студент своєї автошколи з допуском до практики (PRACTICE).',
  })
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  studentId: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-03T10:00:00+02:00',
    description: 'Початок заняття, ISO 8601 з часовим зсувом (Z або ±HH:MM). Має бути в майбутньому.',
  })
  @IsScheduledAt()
  scheduledAt: string;

  @ApiPropertyOptional({
    example: PRACTICE_DEFAULT_DURATION_MIN,
    default: PRACTICE_DEFAULT_DURATION_MIN,
    minimum: LESSON_MIN_DURATION_MIN,
    maximum: LESSON_MAX_DURATION_MIN,
    description: DURATION_DESCRIPTION,
  })
  @IsLessonDuration()
  durationMin?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Інструктор заняття. За замовчуванням — інструктор, призначений студенту. INSTRUCTOR може передати лише свій id.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  instructorId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Авто заняття: AVAILABLE, призначене інструктору заняття, з категорією й коробкою як у студента. ' +
      'За замовчуванням — авто, призначене студенту.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'carId має бути UUID.' })
  carId?: string;
}
```

`null` у будь-якому полі дає `400`: обов'язкові поля мають `IsDefined`, необов'язкові — `ValidateIf(value !== undefined)`
так само, як в `UpdatePracticeLessonDto`.

### 4. Сервіс: `src/modules/lessons/lessons.service.ts`

**Повідомлення:**

```ts
export const LESSON_CREATE_IN_PAST_MESSAGE =
  'Заняття можна створити лише на майбутній час.';
export const LESSON_GROUP_NOT_OPEN_MESSAGE =
  'Заняття можна створити лише для групи зі статусом PLANNED або ACTIVE.';
export const PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE =
  'Студенту не призначено інструктора. Передайте instructorId.';
export const LESSON_INSTRUCTOR_ASSIGN_MESSAGE =
  'Інструктор може створити заняття лише для себе.';
export const STUDENT_NOT_ASSIGNED_MESSAGE =
  'Інструктор може створити заняття лише для свого студента.';
```

`GROUP_NOT_FOUND_MESSAGE` імпортується з `groups.service`, `STUDENT_NOT_FOUND_MESSAGE` — з `students.service` (сервіс уже
імпортує повідомлення з cars і students).

```ts
function assertCreatableAt(scheduledAt: Date, now: Date): void {
  if (scheduledAt.getTime() <= now.getTime()) {
    throw fieldError('scheduledAt', LESSON_CREATE_IN_PAST_MESSAGE);
  }
}
```

**Теорія.** Порядок блокувань той самий, що в `changeTheory`: група (`FOR SHARE`) → advisory-ключі.

```ts
  async createTheory(
    actor: User,
    payload: CreateTheoryLessonDto,
  ): Promise<TheoryLessonDto> {
    assertCanEditTheory(actor);
    const organization = await this.requireOrganization(actor.organizationId);
    const scheduledAt = new Date(payload.scheduledAt);
    const durationMin = payload.durationMin ?? THEORY_DEFAULT_DURATION_MIN;
    assertCreatableAt(scheduledAt, new Date());

    const saved = await this.prisma.$transaction(async (tx) => {
      // Закриття групи, що вже йде, завершиться раніше, і нижче ми побачимо
      // закриту групу.
      await lockGroup(tx, payload.groupId, actor.organizationId, 'share');
      const group = await tx.group.findFirst({
        where: { id: payload.groupId, organizationId: actor.organizationId },
        select: lessonGroupSelect,
      });
      if (!group) {
        throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
      }
      if (actor.role === UserRole.TEACHER && group.teacherId !== actor.id) {
        throw new ForbiddenException('Insufficient permissions');
      }
      if (!OPEN_GROUP_STATUSES.includes(group.status)) {
        throw new ConflictException(LESSON_GROUP_NOT_OPEN_MESSAGE);
      }
      assertWithinGroupDates(scheduledAt, group, organization.timezone);
      assertTeacherActive(group.teacher);

      await this.assertTheorySlotFree(tx, actor, {
        lessonId: null,
        groupId: group.id,
        teacherId: group.teacherId,
        slot: lessonSlot(scheduledAt, durationMin),
      });

      return tx.lesson.create({
        data: {
          groupId: group.id,
          topic: payload.topic,
          scheduledAt,
          durationMin,
        },
        select: theoryLessonSelect,
      });
    });

    this.logger.log(
      `Lesson created type=THEORY lessonId=${saved.id} groupId=${saved.groupId} scheduledAt=${saved.scheduledAt.toISOString()} durationMin=${saved.durationMin} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toTheoryLessonDto(saved);
  }
```

**Практика.** Порядок перевірок: роль → «лише для себе» (до транзакції) → студент (`404`) → «свій студент» (`403`) → стан
студента → інструктор → авто → слот.

```ts
  async createPractice(
    actor: User,
    payload: CreatePracticeLessonDto,
  ): Promise<PracticeLessonDto> {
    assertCanEditPractice(actor);
    const isInstructor = actor.role === UserRole.INSTRUCTOR;
    if (
      isInstructor &&
      payload.instructorId !== undefined &&
      payload.instructorId !== actor.id
    ) {
      throw new ForbiddenException(LESSON_INSTRUCTOR_ASSIGN_MESSAGE);
    }
    await this.requireOrganization(actor.organizationId);
    const scheduledAt = new Date(payload.scheduledAt);
    const durationMin = payload.durationMin ?? PRACTICE_DEFAULT_DURATION_MIN;
    assertCreatableAt(scheduledAt, new Date());

    const saved = await this.prisma.$transaction(async (tx) => {
      const student = await tx.user.findFirst({
        where: {
          id: payload.studentId,
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
      if (isInstructor && student.studentProfile?.instructorId !== actor.id) {
        throw new ForbiddenException(STUDENT_NOT_ASSIGNED_MESSAGE);
      }
      const profile = requirePracticeProfile(student);

      const instructorId = isInstructor
        ? actor.id
        : (payload.instructorId ?? profile.instructorId);
      if (!instructorId) {
        throw new ConflictException(PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE);
      }
      await this.requireInstructor(tx, actor.organizationId, instructorId);

      const carId = payload.carId ?? profile.carId;
      if (!carId) {
        throw new ConflictException(PRACTICE_CAR_REQUIRED_MESSAGE);
      }
      await this.requirePracticeCar(tx, actor.organizationId, carId, {
        instructorId,
        category: profile.category,
        transmission: profile.transmission,
      });

      await this.assertPracticeSlotFree(tx, actor, {
        lessonId: null,
        instructorId,
        carId,
        studentId: student.id,
        slot: lessonSlot(scheduledAt, durationMin),
      });

      return tx.drivingLesson.create({
        data: {
          organizationId: actor.organizationId,
          instructorId,
          studentId: student.id,
          carId,
          scheduledAt,
          durationMin,
        },
        select: practiceLessonSelect,
      });
    });

    this.logger.log(
      `Lesson created type=PRACTICE lessonId=${saved.id} instructorId=${saved.instructorId} studentId=${saved.studentId} carId=${saved.carId} scheduledAt=${saved.scheduledAt.toISOString()} durationMin=${saved.durationMin} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toPracticeLessonDto(saved);
  }
```

Для `INSTRUCTOR` `requireInstructor` повторно перевіряє самого актора. `AuthGuard` уже гарантує, що він `ACTIVE` і не
видалений ([auth-access.ts](../src/modules/auth/auth-access.ts)), тож це дешевий дубль, зате шлях коду для обох ролей
один.

### 5. Контролер і Swagger: `src/modules/lessons/lessons.controller.ts`

```ts
const CREATE_RULES =
  `Тривалість — ціле число хвилин від ${LESSON_MIN_DURATION_MIN} до ${LESSON_MAX_DURATION_MIN}. ` +
  'Заняття створюється зі статусом SCHEDULED і має починатися в майбутньому. ' +
  'Інтервали напіввідкриті: заняття впритул одне до одного не конфліктують. ' +
  'Конфлікт повертає 409 з переліком усіх занять, з якими перетинається час.';

const CREATE_CONFLICT_DESCRIPTION =
  'Група закрита, ресурс недоступний (викладач, студент, інструктор, авто), студенту не призначено ' +
  'інструктора чи авто, або час конфліктує з іншими заняттями ' +
  '(тіло з conflicts: [{ resource, resourceId, lessonType, lessonId, scheduledAt, endsAt }]).';
```

```ts
  @Post('theory')
  @HttpCode(HttpStatus.CREATED)
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Створити теоретичне заняття',
    description:
      'ADMIN або викладач групи створює заняття групи своєї автошколи. Викладач заняття — викладач групи. ' +
      `${CREATE_RULES} ${THEORY_CHECKS}`,
  })
  @ApiCreatedResponse({ type: TheoryLessonDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло, зайве поле, scheduledAt без зсуву чи в минулому, або день заняття поза датами групи. ' +
      'Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({
    description: 'Роль не ADMIN чи TEACHER, або викладач створює заняття чужої групи.',
  })
  @ApiNotFoundResponse({
    description: 'Групу не знайдено або вона належить іншій автошколі.',
  })
  @ApiConflictResponse({
    type: LessonScheduleConflictResponseDto,
    description: CREATE_CONFLICT_DESCRIPTION,
  })
  createTheory(
    @CurrentUser() user: User,
    @Body() body: CreateTheoryLessonDto,
  ): Promise<TheoryLessonDto> {
    return this.lessonsService.createTheory(user, body);
  }
```

`POST practice` аналогічно з `PRACTICE_LESSON_EDIT_ROLES`, `PRACTICE_CHECKS`, `PracticeLessonDto`. Опис `403`:
«Роль не ADMIN чи INSTRUCTOR, інструктор передав чужий instructorId або створює заняття не своєму студенту». Опис
`404`: «Студента, інструктора чи авто не знайдено, або вони належать іншій автошколі». `@HttpCode(HttpStatus.CREATED)`
явно, як у `groups.controller.ts`.

Маршрути `theory` і `practice` не перетинаються з `theory/:id/cancel` та `me`.

## Error responses

Порядок перевірок: guard'и → pipes → сервіс. Неавтентифікований клієнт з некоректним тілом отримає `401`.

| Ситуація | Де перевіряється | Статус | Тіло або повідомлення |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | як в інших модулях |
| Роль не з `*_LESSON_EDIT_ROLES` (`STUDENT`, `OWNER`, `INSTRUCTOR` на теорії, `TEACHER` на практиці) | `RolesGuard` | 403 | `Insufficient permissions` |
| Немає обов'язкового поля, `null`, не UUID, `topic` порожній / довший за 200 / з `<` чи `>`, `durationMin` поза 15–240 чи не ціле | `ValidationPipe` | 400 | `errors: [{ field, message }]` |
| `scheduledAt` без часового зсуву | `ValidationPipe` | 400 | `field: 'scheduledAt'`, `SCHEDULED_AT_FORMAT_MESSAGE` |
| Зайве поле (`status`, `organizationId`, `teacherId`, …) | `ValidationPipe` | 400 | `property X should not exist` |
| `INSTRUCTOR` передав чужий `instructorId` | `createPractice` | 403 | `LESSON_INSTRUCTOR_ASSIGN_MESSAGE` |
| `scheduledAt <= now` | `assertCreatableAt` | 400 | `field: 'scheduledAt'`, `LESSON_CREATE_IN_PAST_MESSAGE` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |
| Групи немає або вона іншої організації | `createTheory` | 404 | `Group not found` |
| Чужа група своєї організації для `TEACHER` | `createTheory` | 403 | `Insufficient permissions` |
| Група `COMPLETED` або `ARCHIVED` | `createTheory` | 409 | `LESSON_GROUP_NOT_OPEN_MESSAGE` |
| День заняття поза `startDate..endDate` групи | `assertWithinGroupDates` | 400 | `field: 'scheduledAt'`, `LESSON_OUTSIDE_GROUP_DATES_MESSAGE` |
| Викладач групи не `ACTIVE` або видалений | `assertTeacherActive` | 409 | `LESSON_TEACHER_NOT_ACTIVE_MESSAGE` |
| Студента немає, він іншої організації, не `STUDENT` чи без профілю | `createPractice` | 404 | `Student not found` |
| Студент не призначений `INSTRUCTOR`-актору | `createPractice` | 403 | `STUDENT_NOT_ASSIGNED_MESSAGE` |
| Студент не `ACTIVE` або не `PRACTICE` | `requirePracticeProfile` | 409 | `STUDENT_NOT_IN_PRACTICE_MESSAGE` |
| Інструктора не передано і студенту не призначено | `createPractice` | 409 | `PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE` |
| Інструктора немає або він іншої організації | `requireInstructor` | 404 | `Instructor not found` |
| Не `INSTRUCTOR` або не `ACTIVE` | `requireInstructor` | 409 | `INSTRUCTOR_ROLE_MESSAGE` / `INSTRUCTOR_NOT_ACTIVE_MESSAGE` |
| Авто не передано і студенту не призначено | `createPractice` | 409 | `PRACTICE_CAR_REQUIRED_MESSAGE` |
| Авто немає або воно іншої організації | `requirePracticeCar` | 404 | `Car not found` |
| Авто не цього інструктора, інша категорія чи коробка | `requirePracticeCar` | 409 | `INSTRUCTOR_CAR_MISMATCH_MESSAGE` |
| Авто не `AVAILABLE` | `requirePracticeCar` | 409 | `CAR_NOT_AVAILABLE_MESSAGE` |
| Час перетинається з іншими `SCHEDULED`-заняттями | `assert*SlotFree` | 409 | `LessonScheduleConflictResponseDto` з `conflicts` |

Приклад `409` для практики на зайнятий слот інструктора:

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
    }
  ]
}
```

## Покриття AC

| AC | Як закрито |
|---|---|
| 1. Створення theory slot | `POST /lessons/theory`, `createTheory` |
| 2. Створення practice slot | `POST /lessons/practice`, `createPractice` |
| 3. Дата та час | `scheduledAt` (ISO 8601 зі зсувом → UTC) і `durationMin` у рядку; `endsAt` у відповіді; лише майбутнє (рішення 5) |
| 4. Тип заняття | таблиця `lessons` / `driving_lessons` і маршрут; `type` у відповіді («Як читаються AC») |
| 5. Навчальна група | `lessons.group_id` обов'язковий; практика пов'язана з групою через зарахування студента, що враховує пошук конфліктів («Як читаються AC», відкрите питання 2) |
| 6. Instructor для practice | `instructorId` з тіла чи з допуску студента; `requireInstructor`; конфлікти інструктора (рішення 3, 6) |
| 7. Автомобіль, якщо необхідний | `carId` з тіла чи з допуску студента; без авто `409`; `requirePracticeCar`; конфлікти авто (рішення 3, «Як читаються AC») |
| 8. Доступність ресурсів | таблиця рішення 6: існування, належність, стан групи, викладача, студента, інструктора, авто |
| 9. Authentication + RBAC | `AuthGuard`, `@Roles(...*_LESSON_EDIT_ROLES)`, `assertCanEdit*`, «своя група» для `TEACHER`, «лише для себе і свого студента» для `INSTRUCTOR` (рішення 9) |
| 10. В межах Organization | організація з токена; група, студент, інструктор, авто з фільтром організації → `404`; `organizationId` практики пишеться з токена (рішення 10) |
| 11. Success/error responses | `201` з DTO; таблиця помилок; Swagger-декоратори на обох ендпоінтах |
| 12. Перевірка конфліктів | `find*Conflicts` з `lessonId: null` під advisory-ключами; `409` з повним списком (рішення 7, 8) |

## Тест-план

Запуск: `npm test -- lessons`, `npm run test:integration -- lesson-schedule` (потрібен Docker), а також `npm run lint`
і `npm run build`.

### `src/modules/lessons/lessons.dto.spec.ts`

`CreateTheoryLessonDto`:

1. Мінімальне валідне тіло проходить; `topic: '  Знаки  '` дає `'Знаки'`; без `durationMin` поле лишається `undefined`.
2. Без `groupId`, `topic` чи `scheduledAt` — `400` з відповідним `field`; `null` у кожному з них теж `400`.
3. `groupId: 'abc'`; `topic: ''`, `'   '`, рядок з 201 символу, `'<b>x</b>'`; `scheduledAt: '2026-11-03T10:00:00'`
   (без зсуву); `durationMin: 14`, `241`, `60.5`, `'60'`, `null` — `400`.
4. `{ …, status: 'SCHEDULED' }`, `organizationId`, `teacherId` — `property … should not exist`.

`CreatePracticeLessonDto`:

5. `{ studentId, scheduledAt }` проходить; `instructorId: null` і `carId: null` — `400`; не UUID — `400`.
6. Зайві поля `organizationId`, `groupId`, `status` — `400`.

`RescheduleLessonDto` після виносу `IsScheduledAt()` — наявні тести проходять без змін.

### `src/modules/lessons/lessons.service.spec.ts`

Теорія:

1. ADMIN створює заняття: `lesson.create` з `groupId`, `topic`, `scheduledAt`, `durationMin`; відповідь
   `type: 'THEORY'`, `status: 'SCHEDULED'`; лог `Lesson created type=THEORY` без `topic`.
2. Без `durationMin` пишеться `90`, і конфлікти рахуються для 90 хвилин.
3. TEACHER своєї групи — успіх; TEACHER чужої групи — `403` без `create`; INSTRUCTOR, STUDENT, OWNER — `403` до будь-яких
   запитів у БД.
4. Група не знайдена (зокрема іншої організації) — `404`; запит групи містить `organizationId: actor.organizationId`.
5. Група `COMPLETED` / `ARCHIVED` — `409 LESSON_GROUP_NOT_OPEN_MESSAGE`; `PLANNED` — успіх.
6. `scheduledAt` у минулому і рівно `now` — `400 field: 'scheduledAt'` без жодного запиту в БД.
7. День поза датами групи — `400`; група без дат — успіх.
8. Заблокований викладач групи — `409 LESSON_TEACHER_NOT_ACTIVE_MESSAGE`.
9. Конфлікт — `409` з `conflicts`; `create` не викликається.
10. Порядок: `lockGroup('share')` → `lockScheduleResources` з ключами `teacher:` і `group:` → пошук → `create`.

Практика:

11. ADMIN з `{ studentId, scheduledAt }`: інструктор і авто беруться з профілю студента; `drivingLesson.create` з
    `organizationId: actor.organizationId`; без `durationMin` пишеться `60`.
12. ADMIN з явними `instructorId` і `carId` — використовуються вони.
13. ADMIN з іншим інструктором без `carId` — `409 INSTRUCTOR_CAR_MISMATCH_MESSAGE`.
14. Студенту не призначено інструктора і його не передано — `409 PRACTICE_INSTRUCTOR_REQUIRED_MESSAGE`; те саме для
    авто — `409 PRACTICE_CAR_REQUIRED_MESSAGE`.
15. INSTRUCTOR для свого студента без `instructorId` — інструктор заняття `actor.id`.
16. INSTRUCTOR з чужим `instructorId` — `403 LESSON_INSTRUCTOR_ASSIGN_MESSAGE` до транзакції; з власним — успіх.
17. INSTRUCTOR для студента іншого інструктора — `403 STUDENT_NOT_ASSIGNED_MESSAGE`.
18. Студент не знайдений / іншої організації — `404`; студент не `PRACTICE` чи не `ACTIVE` — `409`.
19. Інструктор іншої організації — `404`; не `ACTIVE` — `409`. Авто іншої організації — `404`; `MAINTENANCE` — `409`.
20. Advisory-ключі: `instructor:`, `car:`, `student:` і `group:` кожної `ACTIVE`-групи студента.
21. Конфлікт — `409`; `create` не викликається; лог конфлікту з `lessonId=new`.

Рефакторинг:

22. Наявні тести `update*`, `reschedule*`, `cancel*` проходять без змін.

### `src/modules/lessons/schedule-conflicts.spec.ts`

1. `lessonId: null` не додає фільтра за `id` (обидві функції).
2. `lessonId: '…'` дає `id: { not: '…' }`, як і раніше.

### `src/modules/lessons/lessons.controller.spec.ts`

1. `createTheory` і `createPractice` мають `@Roles` з відповідними константами і `@HttpCode(201)`.
2. Контролер передає в сервіс `user` і `body` без змін.

### `test/integration/lesson-schedule.integration-spec.ts` (новий `describe('create')`)

Новий `describe` у тому самому файлі, щоб перевикористати `createSchool()`, `at()`, `deferred()`, `track()` і
`conflictsOf()`.

1. **Теорія зберігається.** `createTheory` пише рядок з `group_id`, `topic`, `scheduled_at`, `duration_min`,
   `status = SCHEDULED`. Заняття бачать `GET /lessons/me` викладача і обох студентів групи та Teacher Dashboard.
2. **Практика з дефолтами.** `createPractice({ studentId: student1, scheduledAt })` пише `instructor_id = instructor`,
   `car_id = car1`, `organization_id` школи. Заняття бачить Instructor Dashboard.
3. **Конфлікти:**
   - практика `student2` з `instructor` на час практики `student1` — `409 INSTRUCTOR/PRACTICE`;
   - практика `student1` з `car3` / `otherInstructor` на час його ж практики — `409 STUDENT/PRACTICE`;
   - теорія групи на час практики `student1` — `409 STUDENT/PRACTICE`;
   - практика `student1` на час теорії групи — `409 STUDENT/THEORY`;
   - заняття впритул — `201`; скасоване заняття в тому самому слоті не заважає — `201`.
4. **Дубль.** Той самий `createPractice` двічі підряд: другий — `409` з `[INSTRUCTOR, CAR, STUDENT]`, у таблиці один
   рядок.
5. **Інша школа.** ADMIN школи A передає групу, студента, інструктора чи авто школи B — `404`, рядків не додалося.
6. **Створення чекає на бронювання того самого інструктора.** Сира транзакція бере
   `lockScheduleResources(tx, [scheduleLockKey('instructor', id)])`, вставляє заняття на 10:00 і чекає на `deferred()`.
   `createPractice` на 10:00 лишається pending щонайменше `LOCK_WAIT_MS`, а після `resolve()` отримує
   `409 INSTRUCTOR`. Без advisory-lock тест падає.
7. **Два паралельні створення на один слот** інструктора (різні студенти й авто): рівно одне `201`, друге `409`.
8. **Створення чекає на закриття групи.** Сира транзакція тримає `lockGroup(..., 'update')` і ставить групі
   `COMPLETED`. `createTheory` чекає і після коміту отримує `409 LESSON_GROUP_NOT_OPEN_MESSAGE`.
9. **Немає deadlock.** Паралельно `GroupsService.changeStatus` (→ `COMPLETED`) і `createTheory` цієї групи. Обидва
   завершуються за `UNBLOCKED_WITHIN_MS`. Одне з двох: або заняття створене і потім `CANCELLED` закриттям, або create
   отримав `409`.

Фікстура `createSchool()` уже має все потрібне: двох інструкторів, три авто, `ACTIVE`-групу і двох студентів з
допуском до практики.

### Регресія

- `dashboard.service.spec.ts`, `personal-schedule.service.spec.ts`, `group-lock.integration-spec.ts`,
  `test/app.e2e-spec.ts` проходять без змін.

### Ручна перевірка

Ті самі demo-акаунти, що в «Ручній перевірці» плану edit/reschedule. Студенту потрібен допуск до практики
(`PATCH /api/students/:id/practice-access`). SQL-вставки занять більше не потрібні. 3 листопада 2026 року Київ живе за
UTC+2.

```bash
# 201: практика з інструктором і авто з допуску студента (10:00 за Києвом)
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>","scheduledAt":"2026-11-03T10:00:00+02:00"}'

# 409 з conflicts [INSTRUCTOR, CAR, STUDENT]: той самий запит ще раз
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>","scheduledAt":"2026-11-03T10:00:00+02:00"}'

# 201: впритул (11:00)
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $INSTRUCTOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>","scheduledAt":"2026-11-03T11:00:00+02:00","durationMin":90}'

# 201: теорія групи студента (18:00)
curl -s -X POST http://localhost:3000/api/lessons/theory \
  -H "Authorization: Bearer $TEACHER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"groupId":"<group>","topic":"Дорожні знаки","scheduledAt":"2026-11-03T18:00:00+02:00"}'

# 409 STUDENT/THEORY: практика на час теорії (18:30)
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>","scheduledAt":"2026-11-03T18:30:00+02:00"}'

# 400: без зсуву; 400: у минулому; 400: зайве поле organizationId
curl -s -X POST http://localhost:3000/api/lessons/theory \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"groupId":"<group>","topic":"Знаки","scheduledAt":"2026-11-03T18:00:00"}'
curl -s -X POST http://localhost:3000/api/lessons/theory \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"groupId":"<group>","topic":"Знаки","scheduledAt":"2026-01-01T18:00:00+02:00"}'
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>","scheduledAt":"2026-11-04T10:00:00+02:00","organizationId":"<other-org>"}'

# 403: STUDENT; 403: INSTRUCTOR з чужим instructorId; 404: група іншої автошколи
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $STUDENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>","scheduledAt":"2026-11-04T10:00:00+02:00"}'
curl -s -X POST http://localhost:3000/api/lessons/practice \
  -H "Authorization: Bearer $INSTRUCTOR_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>","scheduledAt":"2026-11-04T10:00:00+02:00","instructorId":"<other-instructor>"}'
curl -s -X POST http://localhost:3000/api/lessons/theory \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"groupId":"<foreign-group>","topic":"Знаки","scheduledAt":"2026-11-04T18:00:00+02:00"}'
```

Додатково:

- Переведіть авто в `MAINTENANCE` (`PATCH /api/cars/:id/status`) і створіть практику: `409 CAR_NOT_AVAILABLE_MESSAGE`.
- Запустіть два створення на один слот паралельно (`… & … & wait`): рівно одне має отримати `201`.
- `GET /api/lessons/me` викладача, інструктора і студента показує створені заняття.
- У Swagger розділ `lessons` показує дев'ять ендпоінтів; у `POST theory` і `POST practice` є відповіді `201`, `400`,
  `401`, `403`, `404`, `409`.

## Відкриті питання до продукту

Відповідь на кожне змінює невелику частину плану, але не його структуру.

1. **Чи потрібні практичні слоти без студента**, які студент потім бронює сам? Зараз `studentId` обов'язковий. Відкриті
   слоти потребують nullable `student_id`, окремого правила конфліктів і ендпоінта бронювання — це окрема задача.
2. **Чи зберігати групу в практичному занятті?** Зараз ні. Якщо так: nullable `driving_lessons.group_id` (FK
   `SET NULL`, індекс), сервер заповнює його з `ACTIVE`-зарахування студента в момент створення (клієнт не передає), і
   це знімок, а не джерело правди.
3. **Чи може `INSTRUCTOR` створювати заняття студентам, яких йому не призначено?** Зараз `403`; зміна — прибрати
   перевірку `STUDENT_NOT_ASSIGNED_MESSAGE`.
4. **Доступ `OWNER`** — як у groups, edit/reschedule і cancel.
5. **Горизонт планування**: чи обмежувати практику, наприклад, 60 днями вперед? Теорію вже обмежують дати групи.
6. **Чи бувають практичні заняття без авто** (інструктаж, тренажер)? Зараз ні; зміна — прапорець у тілі і пропуск
   `requirePracticeCar` і ключа `car:`.
7. **Чи може `STUDENT` сам записатися на практику?** Зараз `403`; пов'язано з питанням 1.

## Поза скоупом

- **Серії занять** (щотижнева теорія на весь курс) і масове створення.
- **Прив'язка теорії до уроку курсу** (`CourseLesson`): зараз `topic` — вільний текст.
- **Списки і календар школи** (`GET /lessons` для `ADMIN`) і `GET /lessons/{theory,practice}/:id`.
- **Сповіщення** студенту, групі, викладачу чи інструктору про нове заняття (MailModule готовий, окрема задача).
- **Робочі години, перерви, відпустки інструктора, ліміт занять на день чи годин практики на студента.**
- **Зворотні перевірки в інших модулях** (зміна статусу авто, блокування інструктора, зміна дат групи чи її викладача,
  зарахування студента) — ті самі прогалини, що в «Поза скоупом» плану edit/reschedule.
- **Ключ ідемпотентності** для повторних запитів: дубль і так відсікає `409` (рішення 7).
- **Перейменування `*_LESSON_EDIT_ROLES` на `*_LESSON_MANAGE_ROLES`**, якщо ролі для create розійдуться з edit.

## Чек-лист для рев'ю

- [ ] Міграції немає; нові рядки практики завжди мають `car_id`.
- [ ] `find*Conflicts` приймають `lessonId: string | null`; редагування поводиться як раніше.
- [ ] Перевірка слоту винесена в `assertTheorySlotFree` / `assertPracticeSlotFree`; `change*` і `create*` викликають
      ті самі методи; наявні тести проходять без змін.
- [ ] У DTO немає `status`, `organizationId`, `teacherId`, `groupId` практики; `null` відхиляється в усіх полях.
- [ ] `scheduledAt` без зсуву дає `400`; у минулому — `400` до запитів у БД.
- [ ] Організація береться лише з токена; група, студент, інструктор, авто іншої організації дають `404`.
- [ ] `TEACHER` створює лише для своєї групи; `INSTRUCTOR` — лише як інструктор заняття і лише своєму студенту.
- [ ] Інструктор і авто за замовчуванням беруться з допуску студента; без них — `409`.
- [ ] Порядок для теорії: `lockGroup('share')` → читання групи → перевірки → advisory-ключі → пошук → `create`.
- [ ] Практика блокує `instructor:`, `car:`, `student:` і `group:` відкритих груп студента.
- [ ] `409` містить усі конфлікти; повторний запит з тим самим тілом дає `409`.
- [ ] Відповідь `201` з `TheoryLessonDto` / `PracticeLessonDto` без email, телефону, `role` і статусів людей.
- [ ] Integration-тест гонки падає, якщо прибрати `lockScheduleResources`.
- [ ] `topic` не потрапляє в лог.
