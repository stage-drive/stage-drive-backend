# Lessons Attendance: план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [lessons-cancel-implementation.md](lessons-cancel-implementation.md),
[lessons-edit-reschedule-implementation.md](lessons-edit-reschedule-implementation.md) і
[groups-course-members-access-implementation.md](groups-course-members-access-implementation.md), перш ніж
імплементувати або рев'ювати цю задачу. Модуль `lessons`, RBAC, блокування рядків і формат помилок уже є. Відвідування
додає одну таблицю, два ендпоінти і перевикористовує той самий конвеєр «заблокувати → прочитати → перевірити →
записати», що й редагування та скасування теорії.

## Задача

Реалізувати backend API для перегляду списку студентів заняття та фіксації їх відвідуваності.

Acceptance Criteria:

1. TEACHER може отримати список студентів відповідної групи/заняття;
2. реалізовано отримання attendance status;
3. реалізована зміна attendance status;
4. attendance зберігається в БД;
5. для одного студента зберігається актуальний статус;
6. TEACHER не може змінювати attendance чужої групи;
7. перевіряється Authentication + RBAC;
8. дані ізольовані на рівні Organization;
9. API повертає актуальний attendance після збереження;
10. реалізовані коректні error responses.

## Що вже є, а чого немає

- **Відвідування ніде не зберігається.** Немає ні моделі, ні enum, ні ендпоінта. Коментар у
  `GroupsService.changeStatus` («Минулі SCHEDULED-заняття не чіпаємо: це облік відвідування, а не розклад») —
  єдина згадка.
- **Склад групи — це `Enrollment` зі статусом `ACTIVE`** (інваріант 1 у плані groups-course-members-access).
  `Student.groupId` не є джерелом складу. Так рахують `GET /groups/:id/students`
  ([groups.service.ts:464](../src/modules/groups/groups.service.ts#L464)), дашборди і пошук конфліктів практики.
- **Зарахування змінюються так:**

  | Подія | Що стає з `Enrollment` | Де |
  |---|---|---|
  | Закриття групи (`COMPLETED` / `ARCHIVED`) | `ACTIVE → COMPLETED` | [groups.service.ts:326](../src/modules/groups/groups.service.ts#L326) |
  | Випуск студента (`GRADUATED`) | `ACTIVE → COMPLETED` | `enrollmentStatusForTraining` у students.service.ts |
  | Відрахування / архівація студента | `ACTIVE → DROPPED` | те саме |
  | Видалення студента з групи | **рядок видаляється** | [students.service.ts:1137](../src/modules/students/students.service.ts#L1137) |

  Через останній рядок відвідування **не можна** прив'язувати до `Enrollment` (FK з `ON DELETE CASCADE` стер би
  історію). Воно прив'язується до заняття і користувача-студента.
- **Минулі заняття лишаються `SCHEDULED`.** Завершення заняття (`COMPLETED`) ще не реалізоване. Персональний розклад
  уже показує `timing` (`UPCOMING`, `IN_PROGRESS`, `FINISHED`) за часом сервера.
- **Заняття, що вже почалося, можна перенести в майбутнє** (`PATCH /lessons/theory/:id/reschedule`,
  `assertStartsInFuture` перевіряє лише новий час). Якщо в заняття вже є відвідування, після перенесення воно
  описувало б заняття, якого ще не було. Цю дірку план закриває (рішення 9).
- **Що можна перевикористати:**

  | Що | Де | Для чого |
  |---|---|---|
  | `lockGroup(..., 'share')` → `lockTheoryLesson` | [group-lock.ts](../src/common/prisma/group-lock.ts), [schedule-lock.ts](../src/common/prisma/schedule-lock.ts) | серіалізація з перенесенням заняття і закриттям групи |
  | `lockTheoryForChange` | [lessons.service.ts:880](../src/modules/lessons/lessons.service.ts#L880) | пошук заняття з фільтром організації → `404`, перевірка `teacherId` → `403` |
  | `THEORY_LESSON_EDIT_ROLES`, `assertCanEditTheory` | lessons.service.ts | RBAC |
  | `theoryLessonViewSelect`, `toTheoryLessonDto`, `lessonPersonSelect` | [lesson-view.ts](../src/modules/lessons/lesson-view.ts) | заняття і люди у відповіді без PII |
  | `assertEditable` (`409` з `currentStatus`) | lessons.service.ts | однакова форма `409` для скасованого заняття |
  | `validationExceptionFactory` | [field-error.ts](../src/common/validation/field-error.ts) | вкладені помилки `records.0.status` |
  | `createSchool()`, `at()`, `deferred()`, `track()` | [lesson-schedule.integration-spec.ts](../test/integration/lesson-schedule.integration-spec.ts) | integration-тести |

## Рішення, зафіксовані цим планом

1. **Лише теоретичні заняття.** AC говорять про TEACHER і групу, тобто про `Lesson`. Відвідування практики
   (`DrivingLesson`, один студент, INSTRUCTOR) — це «не з'явився» в задачі завершення практичного заняття (див.
   «Поза скоупом»).
2. **Нова таблиця `lesson_attendances`, один рядок на пару (заняття, студент).** `UNIQUE (lesson_id, student_id)`
   гарантує на рівні БД, що в студента один актуальний статус на заняття (AC 5). Зміна статусу оновлює рядок, а не
   додає новий. Окремої таблиці історії немає: останній автор і час зберігаються в `marked_by_id` і `marked_at`.
   - `student_id` → `users` (`ON DELETE CASCADE`), а не `enrollments`: історія переживає видалення студента з групи.
   - `lesson_id` → `lessons` (`ON DELETE CASCADE`). Заняття не видаляються (лише скасовуються), тож каскад
     спрацює тільки з видаленням групи чи організації.
   - `marked_by_id` → `users` (`ON DELETE SET NULL`).
   - `organization_id` не дублюється. Як і `lessons`, рядок належить організації через заняття → групу, і всі запити
     фільтрують `lesson: { group: { organizationId } }`. Денормалізована колонка могла б розійтися з групою.
   - Колонки `updated_at` немає. `marked_at` сервіс ставить явно і лише тоді, коли статус справді змінився, тож
     окрема технічна колонка дублювала б її. Прецедент — таблиці токенів.
3. **Статуси:** `PRESENT` (присутній), `ABSENT` (відсутній), `LATE` (запізнився), `EXCUSED` (відсутній з поважної
   причини). «Не відмічено» — це відсутність рядка (`attendance: null` у відповіді), а не значення enum. Набір
   потрібно підтвердити з продуктом (див. «Відкриті питання»). Додати значення пізніше — проста міграція, а прибрати —
   ні, тож краще почати з меншого набору, ніж з більшого.
4. **Ендпоінти:** `GET` і `PATCH /api/lessons/theory/:id/attendance`.
   - Ресурс вкладений у заняття: відвідування не існує окремо від нього. Маршрут іде під `theory/`, як і решта
     модуля (рішення 1 у плані edit/reschedule).
   - `PATCH`, а не `PUT`: змінюються лише студенти з `records`, решта лишається як була. `PUT` означав би заміну всього
     списку.
   - Один пакетний ендпоінт замість `PUT …/attendance/:studentId`. UI відмічає всю групу й зберігає одним запитом, а
     зміна одного студента — це `records` з одного елемента. Пакет атомарний: одна помилка — нічого не збережено.
   - Відповідь обох ендпоінтів однакова (`LessonAttendanceDto`), `200`. `PATCH` повертає повний актуальний список,
     прочитаний у тій самій транзакції після запису (AC 9).
5. **Хто в списку заняття.**

   | Хто | Коли |
   |---|---|
   | Студенти з `ACTIVE`-зарахуванням у групу заняття | група відкрита (`PLANNED` / `ACTIVE`) |
   | Студенти з `COMPLETED`-зарахуванням | група закрита: закриття перевело в `COMPLETED` саме її склад |
   | Будь-який студент, у якого вже є рядок відвідування цього заняття | завжди: історія не зникає, коли студент вибув, випустився чи його видалили з групи |

   Кожен елемент має `enrollmentStatus` (`ACTIVE`, `COMPLETED`, `DROPPED` або `null`, якщо зарахування видалене).
   Фільтр за `enrolledAt` не застосовується: студента, якого внесли в систему із запізненням, теж можна відмітити
   на минулому занятті (див. «Відкриті питання»).
6. **Коли відвідування можна змінювати.** Перевірки в порядку «статус → група → час», як у `cancelTheory`:

   | Стан | Результат `PATCH` |
   |---|---|
   | Заняття `CANCELLED` | `409 ATTENDANCE_LESSON_CANCELLED_MESSAGE`, `currentStatus: CANCELLED` |
   | Група `COMPLETED` / `ARCHIVED` | `409 ATTENDANCE_GROUP_CLOSED_MESSAGE`: історія закритої групи лише для читання |
   | Заняття ще не почалося (`scheduledAt > now`) | `409 ATTENDANCE_NOT_STARTED_MESSAGE` |
   | Заняття `SCHEDULED` або `COMPLETED`, почалося, група відкрита | `200` |

   - Межа та сама, що в `assertNotStarted` і `lessonTiming`: `scheduledAt = now` — заняття вже почалося. Відмітити
     можна від початку заняття, без верхньої межі, поки група відкрита. Вікно виправлень — відкрите питання.
   - `COMPLETED` дозволений наперед, для майбутньої задачі завершення заняття.
   - `GET` цих обмежень не має: список видно для заняття в будь-якому стані, зокрема майбутнього (хто прийде) і
     скасованого. Поле `editable` у відповіді рахує та сама функція, що й перевірки `PATCH`, тож UI не дублює правила.
7. **Кого можна відмітити.** Лише студентів з `ACTIVE`-зарахуванням у групу заняття. Якщо `studentId` не існує,
   належить іншій організації, не в цій групі, вибув або випустився, відповідь одна: `400` з
   `errors: [{ field: 'records.<i>.studentId', message: ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE }]` для кожного
   такого елемента.
   - `400`, а не `404`: це перевірка тіла проти складу групи, а шлях поля дає UI підсвітити конкретний рядок.
     Прецедент — `fieldError('scheduledAt', LESSON_OUTSIDE_GROUP_DATES_MESSAGE)`.
   - Однакове повідомлення для всіх причин не розкриває, чи існує студент в іншій автошколі.
   - Рядок студента, який уже не `ACTIVE` (рішення 5), видно, але змінити його не можна. Рядок у UI можна
     редагувати тоді й лише тоді, коли `editable && enrollmentStatus === 'ACTIVE'`.
8. **RBAC — ті самі ролі, що й для редагування теорії:** `THEORY_LESSON_EDIT_ROLES = [ADMIN, TEACHER]`. Окрема
   константа не заводиться, поки ролі збігаються (рішення 8 у плані cancel).
   - `ADMIN` бачить і змінює відвідування будь-якого заняття своєї організації.
   - `TEACHER` — лише занять груп, де він `teacherId` (AC 6). Для чужої групи `GET` і `PATCH` дають `403`. Якщо групі
     змінили викладача, історію бачить новий викладач, а попередній втрачає доступ, як і до самих занять.
   - `INSTRUCTOR`, `STUDENT` і `OWNER` отримують `403` від `RolesGuard`. Сервіс повторює перевірку ролі
     (`assertCanEditTheory`) до будь-яких запитів у БД.
9. **Заняття з відвідуванням не переноситься.** `changeTheory`, коли змінюється `scheduledAt`, а в заняття є хоч один
   рядок відвідування, повертає `409 LESSON_HAS_ATTENDANCE_MESSAGE`. Інших змін у наявних ендпоінтах не потрібно:
   - Зміна `durationMin` заняття, що вже почалося, і так дає `409 LESSON_ALREADY_STARTED_MESSAGE`.
   - Скасування заняття, що вже почалося, і так дає `409 LESSON_CANCEL_STARTED_MESSAGE`. Відвідування буває лише в
     заняття, що почалося, тож скасованих занять з відвідуванням не буде.
   - Закриття групи скасовує лише майбутні заняття, а відвідування мають тільки минулі.
10. **Ізоляція організацій** (AC 8):
    - заняття шукається з `group: { organizationId: actor.organizationId }`, і блокування рядків теж фільтрують за
      організацією. Заняття іншої організації дає `404 Lesson not found`, а не `403`;
    - склад групи читається з `student: { organizationId }`, як у `findGroupStudents`;
    - рядки відвідування читаються лише для заняття, яке вже пройшло перевірку організації, і теж із
      `student: { organizationId }`;
    - `organizationId`, `groupId` і `teacherId` не приймаються ні з query, ні з тіла: `forbidNonWhitelisted` дає `400`.
11. **Блокування.** `GET` блокувань не бере. `PATCH`: група (`FOR SHARE`) → заняття (`FOR UPDATE`) → читання →
    перевірки → запис → читання відповіді, усе в одній транзакції. Порядок той самий, що в `changeTheory`,
    `cancelTheory` і `GroupsService.changeStatus`, тож deadlock неможливий.
    - Два `PATCH` одного заняття серіалізуються блокуванням заняття. Для кожного студента виграє останній запис, і
      кожна відповідь показує стан після власного коміту.
    - `PATCH` і перенесення того самого заняття теж серіалізуються. Перенесення бачить збережені рядки відвідування і
      дає `409`, а `PATCH` після перенесення бачить майбутнє заняття і дає `409`.
    - `PATCH` і закриття групи: закриття тримає групу `FOR UPDATE`, тож `PATCH` чекає і потім бачить закриту групу.
    - Advisory-ключі розкладу (`lockScheduleResources`) не беруться: відвідування не займає часу в розкладі.
    - `StudentsService.removeFromGroup` групу не блокує. Якщо студента видаляють з групи паралельно з `PATCH`, рядок
      відвідування може записатися для щойно видаленого студента. Це безпечний бік гонки: студент був у складі на
      момент перевірки, а рядок лишиться в історії (рішення 5).
12. **Незмінені записи не пишуться.** Якщо статус у `records` збігається зі збереженим, рядок не оновлюється,
    `markedAt` і `markedBy` лишаються старими. Так `changeTheory` поводиться з полями, що не змінилися.
13. **Логи без PII:** `Lesson attendance updated lessonId=… groupId=… changed=3 unchanged=9 actorId=…
    organizationId=…`. Імена і статуси окремих студентів у лог не пишуться.

## Ендпоінти

Обидва ендпоінти в `LessonsController` під `@UseGuards(AuthGuard, RolesGuard)` на класі, `:id` — UUID v4
(`ParseUUIDPipe`).

| Метод і шлях | Тіло | Ролі |
|---|---|---|
| `GET /api/lessons/theory/:id/attendance` | — | `ADMIN`, `TEACHER` (своя група) |
| `PATCH /api/lessons/theory/:id/attendance` | `{ records: [{ studentId, status }] }` | `ADMIN`, `TEACHER` (своя група) |

Тіло `PATCH`:

- `records`: масив від 1 до `ATTENDANCE_MAX_RECORDS = 100` елементів, `studentId` не повторюється;
- `studentId`: UUID v4;
- `status`: `PRESENT`, `ABSENT`, `LATE` або `EXCUSED`;
- зайве поле на будь-якому рівні дає `400`.

```json
{
  "records": [
    { "studentId": "8f3c…", "status": "PRESENT" },
    { "studentId": "b71a…", "status": "LATE" }
  ]
}
```

Відповідь обох ендпоінтів:

```json
{
  "lesson": {
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
    "updatedAt": "2026-10-20T09:00:00.000Z"
  },
  "editable": true,
  "students": [
    {
      "id": "8f3c…",
      "firstName": "Олена",
      "lastName": "Коваль",
      "enrollmentStatus": "ACTIVE",
      "attendance": {
        "status": "PRESENT",
        "markedAt": "2026-11-03T16:05:12.000Z",
        "markedBy": { "id": "a3b2…", "firstName": "Ірина", "lastName": "Мельник" }
      }
    },
    {
      "id": "c90d…",
      "firstName": "Петро",
      "lastName": "Шевчук",
      "enrollmentStatus": "ACTIVE",
      "attendance": null
    }
  ]
}
```

- `students` відсортовані за `lastName`, `firstName`, `id`, як у `GET /groups/:id/students`.
- У студента лише `id` та ім'я: email, телефон і `trainingStatus` викладачу для журналу не потрібні.
- `markedBy` — `null`, якщо автора відмітки видалили.

## Кроки реалізації

Кроки йдуть у порядку залежностей, тож зручно робити по коміту на крок.

### 1. Prisma-схема і міграція

`prisma/schema.prisma`:

```prisma
/// Відвідування теоретичного заняття. «Не відмічено» — відсутність рядка.
enum AttendanceStatus {
  PRESENT
  ABSENT
  LATE
  EXCUSED
}

/// Відвідування студентом теоретичного заняття: один рядок на пару (заняття, студент) — актуальний статус.
/// studentId посилається на User, а не на Enrollment: видалення студента з групи не стирає історію.
model LessonAttendance {
  id         String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  lessonId   String           @map("lesson_id") @db.Uuid
  lesson     Lesson           @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  studentId  String           @map("student_id") @db.Uuid
  student    User             @relation("StudentAttendances", fields: [studentId], references: [id], onDelete: Cascade)
  status     AttendanceStatus
  /// Хто й коли востаннє змінив статус. Оновлюються лише разом зі status.
  markedById String?          @map("marked_by_id") @db.Uuid
  markedBy   User?            @relation("MarkedAttendances", fields: [markedById], references: [id], onDelete: SetNull)
  markedAt   DateTime         @map("marked_at")
  createdAt  DateTime         @default(now()) @map("created_at")

  @@unique([lessonId, studentId])
  @@index([studentId])
  @@index([markedById])
  @@map("lesson_attendances")
}
```

У `Lesson`: `attendances LessonAttendance[]`. У `User`:

```prisma
  lessonAttendances        LessonAttendance[]   @relation("StudentAttendances")
  markedAttendances        LessonAttendance[]   @relation("MarkedAttendances")
```

Окремий індекс на `lesson_id` не потрібен: його покриває унікальний індекс `(lesson_id, student_id)`.

Міграція `prisma/migrations/20261024120000_add_lesson_attendance/migration.sql`. Згенеруйте її через
`npx prisma migrate dev --create-only --name add_lesson_attendance` і звірте з очікуваним SQL. Timestamp має бути
пізнішим за останню міграцію в `develop` (зараз `20261023120000_add_lesson_cancellation`).

```sql
-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

-- CreateTable
CREATE TABLE "lesson_attendances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lesson_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "marked_by_id" UUID,
    "marked_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lesson_attendances_lesson_id_student_id_key" ON "lesson_attendances"("lesson_id", "student_id");
CREATE INDEX "lesson_attendances_student_id_idx" ON "lesson_attendances"("student_id");
CREATE INDEX "lesson_attendances_marked_by_id_idx" ON "lesson_attendances"("marked_by_id");

-- AddForeignKey
ALTER TABLE "lesson_attendances" ADD CONSTRAINT "lesson_attendances_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_attendances" ADD CONSTRAINT "lesson_attendances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_attendances" ADD CONSTRAINT "lesson_attendances_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Backfill не потрібен: таблиця нова. Правила «студент належить групі заняття» і «студент з тієї самої організації»
зачіпають кілька таблиць, тож `CHECK` їх не виразить. Їх тримає сервіс (рішення 7).

### 2. Рефакторинг: спільне блокування теорії

`lockTheoryForChange` ([lessons.service.ts:880](../src/modules/lessons/lessons.service.ts#L880)) зараз приватний.
Його першу половину винести в експортовану функцію модуля в тому самому файлі:

```ts
/**
 * Група (FOR SHARE) → заняття (FOR UPDATE). Порядок той самий, що в
 * GroupsService.changeStatus. Заняття іншої організації — 404. Читання з
 * потрібним select робить викликач: після блокування воно бачить збережений стан.
 */
export async function lockTheoryLessonWithGroup(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lessonId: string,
): Promise<void> {
  const target = await tx.lesson.findFirst({
    where: { id: lessonId, group: { organizationId } },
    select: { groupId: true },
  });
  if (!target) {
    throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
  }
  // Закриття групи, що вже йде, завершиться раніше, і нижче ми побачимо
  // закриту групу.
  await lockGroup(tx, target.groupId, organizationId, 'share');
  await lockTheoryLesson(tx, lessonId, organizationId);
}
```

`lockTheoryForChange` викликає її, а потім читає заняття з `theoryLessonSelect` і перевіряє `teacherId`, як зараз.
Також експортувати `assertCanEditTheory`. Це чистий рефакторинг: `lessons.service.spec.ts` і
`lesson-schedule.integration-spec.ts` мають пройти без змін. Нова функція живе в `lessons.service.ts`, а не в
`common/prisma`, бо кидає `NotFoundException` з повідомленням модуля. `lesson-attendance.service.ts` імпортує її звідти;
у зворотний бік імпорту немає, тож циклу теж немає.

### 3. DTO: `src/modules/lessons/lesson-attendance.dto.ts` (новий)

```ts
export const ATTENDANCE_MAX_RECORDS = 100;

export const ATTENDANCE_STATUS_VALUE_MESSAGE =
  'status має бути PRESENT, ABSENT, LATE або EXCUSED.';
export const ATTENDANCE_RECORDS_MESSAGE = `records має бути масивом від 1 до ${ATTENDANCE_MAX_RECORDS} елементів.`;
export const ATTENDANCE_DUPLICATE_STUDENT_MESSAGE =
  'Кожен студент може бути в records лише один раз.';

export class AttendanceRecordDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  studentId: string;

  @ApiProperty({ enum: AttendanceStatus, example: AttendanceStatus.PRESENT })
  @IsEnum(AttendanceStatus, { message: ATTENDANCE_STATUS_VALUE_MESSAGE })
  status: AttendanceStatus;
}

export class UpdateLessonAttendanceDto {
  @ApiProperty({
    type: [AttendanceRecordDto],
    minItems: 1,
    maxItems: ATTENDANCE_MAX_RECORDS,
    description: 'Змінюються лише перелічені студенти; решта лишається як була.',
  })
  @IsArray({ message: ATTENDANCE_RECORDS_MESSAGE })
  @ArrayNotEmpty({ message: ATTENDANCE_RECORDS_MESSAGE })
  @ArrayMaxSize(ATTENDANCE_MAX_RECORDS, { message: ATTENDANCE_RECORDS_MESSAGE })
  @ArrayUnique((record: AttendanceRecordDto) => record.studentId, {
    message: ATTENDANCE_DUPLICATE_STUDENT_MESSAGE,
  })
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordDto)
  records: AttendanceRecordDto[];
}
```

- `ArrayUnique` у class-validator 0.15 пропускає `null`-елементи повз identifier, тож `records: [null]` дає `400`, а
  не `500`. Це має перевірити тест.
- Вкладені помилки `validationExceptionFactory` уже повертає зі шляхом: `records.1.status`.

DTO відповіді:

```ts
export class AttendanceMarkDto {
  @ApiProperty({ enum: AttendanceStatus })
  status: AttendanceStatus;

  @ApiProperty({ description: 'Коли статус востаннє змінено.' })
  markedAt: Date;

  @ApiProperty({ type: LessonPersonDto, nullable: true })
  markedBy: LessonPersonDto | null;
}

export class LessonAttendanceStudentDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;

  @ApiProperty({
    enum: EnrollmentStatus,
    nullable: true,
    description: 'null — студента видалили з групи, але відмітка лишилась. Змінювати можна лише ACTIVE.',
  })
  enrollmentStatus: EnrollmentStatus | null;

  @ApiProperty({ type: AttendanceMarkDto, nullable: true, description: 'null — ще не відмічено.' })
  attendance: AttendanceMarkDto | null;
}

export class LessonAttendanceDto {
  @ApiProperty({ type: TheoryLessonDto })
  lesson: TheoryLessonDto;

  @ApiProperty({
    description: 'Чи можна зараз змінювати відвідування: заняття не скасоване, почалося, група відкрита.',
  })
  editable: boolean;

  @ApiProperty({ type: [LessonAttendanceStudentDto] })
  students: LessonAttendanceStudentDto[];
}
```

### 4. Сервіс: `src/modules/lessons/lesson-attendance.service.ts` (новий)

Окремий сервіс у тому самому модулі, як `PersonalScheduleService`: `LessonsService` уже має понад 1000 рядків.

**Повідомлення:**

```ts
export const ATTENDANCE_LESSON_CANCELLED_MESSAGE =
  'Відвідування скасованого заняття не ведеться.';
export const ATTENDANCE_GROUP_CLOSED_MESSAGE =
  'Відвідування занять групи зі статусом COMPLETED або ARCHIVED змінювати не можна.';
export const ATTENDANCE_NOT_STARTED_MESSAGE =
  'Відвідування можна відмітити лише після початку заняття.';
export const ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE =
  'Студент не входить до складу групи заняття.';
```

**Select заняття** — надмножина `theoryLessonViewSelect`, тож рядок іде в `toTheoryLessonDto` без перетворень:

```ts
const attendanceLessonSelect = {
  ...theoryLessonViewSelect,
  groupId: true,
  group: {
    select: { ...theoryLessonViewSelect.group.select, status: true, teacherId: true },
  },
} satisfies Prisma.LessonSelect;
```

**Правило редагування — одна функція для `PATCH` і для поля `editable`:**

```ts
/** null — можна змінювати; інакше виняток, який кине PATCH. Порядок: статус → група → час. */
function attendanceBlocker(lesson: AttendanceLessonRow, now: Date): HttpException | null {
  if (lesson.status === LessonStatus.CANCELLED) {
    return new ConflictException({
      statusCode: 409,
      message: ATTENDANCE_LESSON_CANCELLED_MESSAGE,
      error: 'Conflict',
      currentStatus: lesson.status,
    });
  }
  if (!OPEN_GROUP_STATUSES.includes(lesson.group.status)) {
    return new ConflictException(ATTENDANCE_GROUP_CLOSED_MESSAGE);
  }
  if (lesson.scheduledAt.getTime() > now.getTime()) {
    return new ConflictException(ATTENDANCE_NOT_STARTED_MESSAGE);
  }
  return null;
}
```

**Публічні методи:**

```ts
  async getAttendance(actor: User, lessonId: string): Promise<LessonAttendanceDto> {
    assertCanEditTheory(actor);
    await this.requireOrganization(actor.organizationId);

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, group: { organizationId: actor.organizationId } },
      select: attendanceLessonSelect,
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    assertTeachesGroup(actor, lesson.group.teacherId);
    return this.loadAttendance(this.prisma, actor, lesson, new Date());
  }

  async updateAttendance(
    actor: User,
    lessonId: string,
    payload: UpdateLessonAttendanceDto,
  ): Promise<LessonAttendanceDto> {
    assertCanEditTheory(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const { result, changed } = await this.prisma.$transaction(async (tx) => {
      await lockTheoryLessonWithGroup(tx, actor.organizationId, lessonId);
      const lesson = await tx.lesson.findFirst({
        where: { id: lessonId, group: { organizationId: actor.organizationId } },
        select: attendanceLessonSelect,
      });
      if (!lesson) {
        throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
      }
      assertTeachesGroup(actor, lesson.group.teacherId);
      const blocker = attendanceBlocker(lesson, now);
      if (blocker) {
        throw blocker;
      }
      await this.assertActiveMembers(tx, actor, lesson.groupId, payload.records);

      const changed = await this.writeChanged(tx, actor, lesson.id, payload.records, now);
      // Читання після запису в тій самій транзакції: відповідь — збережений стан.
      return { result: await this.loadAttendance(tx, actor, lesson, now), changed };
    });

    this.logger.log(
      `Lesson attendance updated lessonId=${lessonId} groupId=${result.lesson.group.id} changed=${changed} unchanged=${payload.records.length - changed} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return result;
  }
```

`assertTeachesGroup(actor, teacherId)`: `TEACHER` і `teacherId !== actor.id` → `403 Insufficient permissions`.

**Приватні методи:**

- `assertActiveMembers(tx, actor, groupId, records)`: один `tx.enrollment.findMany` з `groupId`,
  `status: ACTIVE`, `studentId: { in: ids }`, `student: { organizationId }`. Для кожного `records[i]`, чийого
  `studentId` немає в результаті, — `{ field: \`records.${i}.studentId\`, message: ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE }`.
  Якщо список не порожній — `BadRequestException({ statusCode: 400, errors })`.
- `writeChanged(tx, actor, lessonId, records, now)`: читає наявні рядки (`lessonId`, `studentId: { in: ids }`),
  відкидає записи з тим самим статусом (рішення 12), далі робить не більше п'яти запитів незалежно від розміру
  групи:
  - `createMany` для студентів без рядка: `status`, `markedById: actor.id`, `markedAt: now`;
  - по одному `updateMany` на кожен статус серед змінених: `where: { lessonId, studentId: { in: [...] } }`,
    `data: { status, markedById: actor.id, markedAt: now }`.

  Повертає кількість змінених. Блокування заняття `FOR UPDATE` серіалізує всі записи цього заняття, тож `createMany`
  не наткнеться на унікальний індекс. Індекс лишається страховкою на рівні БД.
- `loadAttendance(client, actor, lesson, now)` — склад за рішенням 5:
  1. `enrollment.findMany`: `groupId: lesson.groupId`, `student: { organizationId }` і
     `OR: [{ status: { in: rosterStatuses } }, { student: { lessonAttendances: { some: { lessonId } } } }]`,
     де `rosterStatuses` — `[ACTIVE]` для відкритої групи і `[COMPLETED]` для закритої. Select:
     `status`, `student: { select: lessonPersonSelect }`.
  2. `lessonAttendance.findMany`: `lessonId`, `student: { organizationId }`. Select: `studentId`, `status`,
     `markedAt`, `student: { select: lessonPersonSelect }`, `markedBy: { select: lessonPersonSelect }`.
  3. Злиття за `studentId`: база — зарахування, до неї додаються студенти лише з відміткою
     (`enrollmentStatus: null`). Сортування — `Intl.Collator('uk')` за `lastName`, `firstName`, далі `id`.
  4. `{ lesson: toTheoryLessonDto(lesson), editable: attendanceBlocker(lesson, now) === null, students }`.

  `client` має тип `Prisma.TransactionClient`: `GET` передає `this.prisma`, `PATCH` — `tx`.
- `requireOrganization` — та сама копія, що в кожному сервісі модуля.

### 5. Заборона перенесення: `src/modules/lessons/lessons.service.ts`

```ts
export const LESSON_HAS_ATTENDANCE_MESSAGE =
  'Заняття з відміченим відвідуванням не можна перенести.';
```

У `changeTheory` ([lessons.service.ts:679](../src/modules/lessons/lessons.service.ts#L679)), у блоці
`if (data.scheduledAt !== undefined || data.durationMin !== undefined)` одразу після `assertStartsInFuture`:

```ts
if (data.scheduledAt !== undefined) {
  const marked = await tx.lessonAttendance.count({ where: { lessonId: lesson.id } });
  if (marked > 0) {
    throw new ConflictException(LESSON_HAS_ATTENDANCE_MESSAGE);
  }
}
```

Заняття вже заблоковане `FOR UPDATE`, а `PATCH …/attendance` бере те саме блокування, тож гонки між перевіркою і
записом немає. `LESSON_CONFLICT_DESCRIPTION` у контролері доповнити: «…або заняття вже має відмічене
відвідування».

### 6. Контролер, модуль і Swagger

`src/modules/lessons/lessons.module.ts`: додати `LessonAttendanceService` у `providers`.

`src/modules/lessons/lessons.controller.ts`: третій параметр конструктора і два методи.

```ts
const ATTENDANCE_RULES =
  'Список — студенти групи з активним зарахуванням (у закритої групи — її склад на момент закриття) ' +
  'і всі, кого вже відмічено на цьому занятті. Змінювати можна, коли заняття не скасоване, вже почалося, ' +
  'а група відкрита, і лише студентів з активним зарахуванням. Для одного студента зберігається один актуальний статус.';

  @Get('theory/:id/attendance')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Відвідування теоретичного заняття',
    description: `ADMIN або викладач групи отримує список студентів заняття з поточними статусами. ${ATTENDANCE_RULES}`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id теоретичного заняття.' })
  @ApiOkResponse({ type: LessonAttendanceDto })
  @ApiBadRequestResponse({ description: 'id не UUID.' })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN чи TEACHER, або викладач відкриває заняття чужої групи.' })
  @ApiNotFoundResponse({ description: 'Заняття не знайдено або воно належить іншій автошколі.' })
  getAttendance(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<LessonAttendanceDto> {
    return this.lessonAttendanceService.getAttendance(user, id);
  }

  @Patch('theory/:id/attendance')
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Відмітити відвідування теоретичного заняття',
    description:
      'ADMIN або викладач групи встановлює статуси переліченим студентам; решта не змінюється. ' +
      `Пакет атомарний. Відповідь — актуальний список після збереження. ${ATTENDANCE_RULES}`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id теоретичного заняття.' })
  @ApiOkResponse({ type: LessonAttendanceDto })
  @ApiBadRequestResponse({
    description:
      'id не UUID, некоректне тіло, зайве поле, студент повторюється, або студент не входить до складу групи ' +
      '(field: records.<i>.studentId). Тіло містить errors: [{ field, message }].',
  })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN чи TEACHER, або викладач змінює відвідування чужої групи.' })
  @ApiNotFoundResponse({ description: 'Заняття не знайдено або воно належить іншій автошколі.' })
  @ApiConflictResponse({
    description: 'Заняття скасоване (тіло з currentStatus), ще не почалося, або група закрита.',
  })
  updateAttendance(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateLessonAttendanceDto,
  ): Promise<LessonAttendanceDto> {
    return this.lessonAttendanceService.updateAttendance(user, id, body);
  }
```

## Error responses

Порядок перевірок: guard'и, потім pipes, потім сервіс. Неавтентифікований клієнт з некоректним тілом отримає `401`.

| Ситуація | Де перевіряється | Ендпоінт | Статус | Тіло або повідомлення |
|---|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | обидва | 401 | як в інших модулях |
| Роль не `ADMIN` чи `TEACHER` | `RolesGuard` | обидва | 403 | `Insufficient permissions` |
| `:id` не UUID v4 | `ParseUUIDPipe` | обидва | 400 | `Validation failed (uuid v 4 is expected)` |
| `records` відсутнє, не масив, порожнє або довше за 100 | `ValidationPipe` | `PATCH` | 400 | `errors: [{ field: 'records', … }]` |
| `studentId` повторюється | `ValidationPipe` | `PATCH` | 400 | `ATTENDANCE_DUPLICATE_STUDENT_MESSAGE` |
| Елемент не об'єкт, `studentId` не UUID, `status` не з enum | `ValidationPipe` | `PATCH` | 400 | `errors: [{ field: 'records.1.status', … }]` |
| Зайве поле (`organizationId`, `records.0.markedAt`, …) | `ValidationPipe` | `PATCH` | 400 | `property X should not exist` |
| Організацію soft-deleted | `requireOrganization` | обидва | 404 | `Organization not found` |
| Заняття немає або воно іншої організації | `findFirst` / `lockTheoryLessonWithGroup` | обидва | 404 | `Lesson not found` |
| `TEACHER` не веде групу заняття | `assertTeachesGroup` | обидва | 403 | `Insufficient permissions` |
| Заняття `CANCELLED` | `attendanceBlocker` | `PATCH` | 409 | `ATTENDANCE_LESSON_CANCELLED_MESSAGE`, `currentStatus` |
| Група `COMPLETED` / `ARCHIVED` | `attendanceBlocker` | `PATCH` | 409 | `ATTENDANCE_GROUP_CLOSED_MESSAGE` |
| Заняття ще не почалося | `attendanceBlocker` | `PATCH` | 409 | `ATTENDANCE_NOT_STARTED_MESSAGE` |
| Студента немає, він з іншої організації, не в групі, вибув або випустився | `assertActiveMembers` | `PATCH` | 400 | `errors: [{ field: 'records.<i>.studentId', message: ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE }]` |
| Перенесення заняття, що має відвідування | `changeTheory` | `PATCH /theory/:id/reschedule` | 409 | `LESSON_HAS_ATTENDANCE_MESSAGE` |

Приклад `400` для студента не з групи:

```json
{
  "statusCode": 400,
  "errors": [
    { "field": "records.2.studentId", "message": "Студент не входить до складу групи заняття." }
  ]
}
```

## Покриття AC

| AC | Як закрито |
|---|---|
| 1. TEACHER отримує список студентів | `GET /lessons/theory/:id/attendance`: склад групи за рішенням 5, `TEACHER` своєї групи |
| 2. Отримання attendance status | `attendance: { status, markedAt, markedBy } \| null` у кожного студента |
| 3. Зміна attendance status | `PATCH /lessons/theory/:id/attendance`, пакет `records` |
| 4. Зберігається в БД | таблиця `lesson_attendances`, міграція `add_lesson_attendance` |
| 5. Один актуальний статус на студента | `UNIQUE (lesson_id, student_id)`; зміна оновлює рядок; integration-тест «два PATCH — один рядок» |
| 6. TEACHER не змінює чужу групу | `assertTeachesGroup` → `403` в обох ендпоінтах |
| 7. Authentication + RBAC | `AuthGuard`, `RolesGuard` з `THEORY_LESSON_EDIT_ROLES`, `assertCanEditTheory` у сервісі |
| 8. Ізоляція Organization | фільтр організації в пошуку і блокуванні заняття (`404`), у складі групи і в перевірці `studentId` (рішення 10) |
| 9. Актуальний attendance після збереження | `PATCH` читає список у тій самій транзакції після запису |
| 10. Error responses | таблиця вище, Swagger-декоратори на обох ендпоінтах |

## Тест-план

Запуск: `npm test -- lessons`, `npm run test:integration -- lesson-schedule` (потрібен Docker), а також
`npm run lint` і `npm run build`.

### `src/modules/lessons/lesson-attendance.dto.spec.ts`

Через реальний `ValidationPipe` з `validationExceptionFactory`, як у `lessons.dto.spec.ts`.

1. Валідне тіло з одним і зі ста записами проходить.
2. Немає `records`, `records: []`, `records: {}`, 101 запис — `400` з `field: 'records'`.
3. Два записи з тим самим `studentId` — `ATTENDANCE_DUPLICATE_STUDENT_MESSAGE`.
4. `records: [null]` і `records: [5]` — `400`, а не `500`.
5. `studentId: 'abc'` — `records.0.studentId`; `status: 'present'` чи `'UNKNOWN'` — `records.0.status`.
6. `records.0.markedAt` і `organizationId` на верхньому рівні — `should not exist`.

### `src/modules/lessons/lesson-attendance.service.spec.ts`

Мок Prisma і `$transaction`, хелпер `caught()`, як у `lessons.service.spec.ts`.

`getAttendance`:

1. ADMIN отримує список: заняття, `editable`, студенти з `attendance` і `null` для не відмічених; сортування за
   прізвищем.
2. TEACHER своєї групи — `200`; чужої — `403`; INSTRUCTOR, STUDENT, OWNER — `403` до запитів у БД.
3. Заняття не знайдене (зокрема іншої організації) — `404`; запит містить `group: { organizationId }`.
4. Скасоване, майбутнє і закритої групи заняття — `200` з `editable: false`.
5. Закрита група: склад з `COMPLETED`-зарахувань. Відкрита: з `ACTIVE`.
6. Студент з відміткою, але без зарахування (видалений з групи) — є в списку з `enrollmentStatus: null`.
7. Запити складу і відміток містять `student: { organizationId }`.

`updateAttendance`:

8. Нові відмітки: `createMany` з `markedById: actor.id`, `markedAt: now`; відповідь містить збережені статуси.
9. Зміна наявних: `updateMany` по одному на статус; записи з тим самим статусом не пишуться; лог з `changed` і
   `unchanged`, без імен.
10. TEACHER чужої групи — `403`, запису немає (AC 6).
11. `CANCELLED` — `409` з `currentStatus`; закрита група — `409 ATTENDANCE_GROUP_CLOSED_MESSAGE`; `scheduledAt`
    у майбутньому — `409 ATTENDANCE_NOT_STARTED_MESSAGE`; `scheduledAt = now` — `200`. Порядок: скасоване заняття
    закритої групи дає `currentStatus`.
12. `COMPLETED`-заняття відкритої групи — `200`.
13. Студент не з `ACTIVE`-складу — `400` з `records.<i>.studentId` для кожного такого елемента; нічого не записано.
14. Порядок блокувань: `lockGroup('share')` раніше за `lockTheoryLesson`; `lockScheduleResources` не викликається.

### `src/modules/lessons/lessons.service.spec.ts`

1. `rescheduleTheory` заняття з відвідуванням — `409 LESSON_HAS_ATTENDANCE_MESSAGE`, `update` не викликається.
2. `updateTheory` лише з `topic` для заняття з відвідуванням — `200`: `count` не викликається.
3. Наявні тести після рефакторингу з кроку 2 проходять без змін.

### `src/modules/lessons/lessons.controller.spec.ts`

1. `getAttendance` і `updateAttendance` мають `@Roles(...THEORY_LESSON_EDIT_ROLES)`.
2. Контролер передає в сервіс `user`, `id` і `body` без змін.

### `test/integration/lesson-schedule.integration-spec.ts` (новий `describe('attendance')`)

У `createSchool()` уже є викладач, `ACTIVE`-група і два студенти з `ACTIVE`-зарахуванням. Сервіс створюється так
само, як `LessonsService` у `beforeAll`.

1. **Міграція.** Друга вставка тієї самої пари (`lesson_id`, `student_id`) падає на унікальному індексі.
2. **Один актуальний статус.** `PRESENT`, потім `LATE` для того самого студента — у таблиці один рядок зі статусом
   `LATE` і новим `marked_at`; `GET` показує `LATE`.
3. **Відповідь `PATCH` збігається з наступним `GET`.**
4. **Ізоляція.** Заняття другої школи — `404`. `studentId` студента другої школи — `400`, у таблиці нічого не
   з'явилося.
5. **Історія переживає видалення з групи.** Відмітити `student1` → `StudentsService.removeFromGroup` → `GET`
   показує `student1` з `enrollmentStatus: null` і його статусом; `PATCH` для нього — `400`.
6. **Закриття групи.** Після `GroupsService.changeStatus(COMPLETED)` `GET` показує обох студентів
   (`enrollmentStatus: COMPLETED`), `editable: false`; `PATCH` — `409`.
7. **Перенесення проти відвідування.** Заняття, що почалося, з відміткою: `rescheduleTheory` у майбутнє — `409`.
   Без відмітки — `200`.
8. **Блокування.** Сира транзакція тримає `lockTheoryLesson` і переносить заняття в майбутнє. `updateAttendance`
   лишається pending щонайменше `LOCK_WAIT_MS`, а після коміту дає `409 ATTENDANCE_NOT_STARTED_MESSAGE`.
9. **Паралельні PATCH.** Два `updateAttendance` з різними статусами для того самого студента завершуються без
   помилок; у таблиці один рядок зі статусом того, хто закомітив останнім.

### Регресія

- `groups.service.spec.ts`, `students.service.spec.ts`, `dashboard.service.spec.ts` і `test/app.e2e-spec.ts`
  проходять без змін: наявні запити нова таблиця не зачіпає.
- Наявні integration-тести `reschedule` не створюють відміток, тож нова перевірка їх не ламає.

### Ручна перевірка

Потрібні demo-акаунти з seed: `admin@example.com`, `teacher@example.com` (id
`a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7`), `student@example.com`. Групи з seed веде INVITED-викладач, тож для
`teacher@example.com` спершу створіть групу:

```bash
# група з teacher@example.com і студентом у ній
curl -s -X POST http://localhost:3000/api/groups \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Відвідування","teacherId":"a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7"}'
curl -s -X POST http://localhost:3000/api/groups/<group>/students \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"studentId":"<student>"}'
```

API не створює занять у минулому, тож заняття, що вже почалося, вставляється через `psql "$DATABASE_URL"`:

```sql
INSERT INTO lessons (group_id, topic, scheduled_at, duration_min)
VALUES ('<group>', 'Дорожні знаки', now() - interval '10 minutes', 90),
       ('<group>', 'Перехрестя', now() + interval '2 days', 90),
       ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Чужа група', now() - interval '10 minutes', 90)
RETURNING id;
```

```bash
# 200: список, attendance: null, editable: true
curl -s http://localhost:3000/api/lessons/theory/<started>/attendance \
  -H "Authorization: Bearer $TEACHER_TOKEN"

# 200: відмітити й одразу отримати актуальний список
curl -s -X PATCH http://localhost:3000/api/lessons/theory/<started>/attendance \
  -H "Authorization: Bearer $TEACHER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"records":[{"studentId":"<student>","status":"PRESENT"}]}'

# 409: заняття ще не почалося
curl -s -X PATCH http://localhost:3000/api/lessons/theory/<future>/attendance \
  -H "Authorization: Bearer $TEACHER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"records":[{"studentId":"<student>","status":"PRESENT"}]}'

# 403: група A, яку веде інший викладач
curl -s http://localhost:3000/api/lessons/theory/<group-a-lesson>/attendance \
  -H "Authorization: Bearer $TEACHER_TOKEN"

# 400: студент не з цієї групи (grouped-student з групи A)
curl -s -X PATCH http://localhost:3000/api/lessons/theory/<started>/attendance \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"records":[{"studentId":"<grouped-student>","status":"ABSENT"}]}'

# 409: перенести заняття з відвідуванням
curl -s -X PATCH http://localhost:3000/api/lessons/theory/<started>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-10T10:00:00+02:00"}'

# 403: STUDENT
curl -s http://localhost:3000/api/lessons/theory/<started>/attendance \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

Додатково:

- `SELECT lesson_id, student_id, status, marked_by_id, marked_at FROM lesson_attendances;` — після повторного
  `PATCH` з іншим статусом рядок той самий, змінилися лише `status` і `marked_at`.
- У Swagger розділ `lessons` показує обидва нові ендпоінти з відповідями `200`, `400`, `401`, `403`, `404` і `409`
  (у `PATCH`).

## Відкриті питання до продукту

Відповідь на кожне змінює невелику частину плану, але не його структуру.

1. **Набір статусів.** Зараз `PRESENT`, `ABSENT`, `LATE`, `EXCUSED`. Чи потрібен `LATE`? Чи потрібен коментар або
   причина для `EXCUSED`? Коментар — нова nullable-колонка і поле в `records`.
2. **Вікно виправлень.** Зараз відвідування можна змінювати без обмеження в часі, поки група відкрита. Чи обмежити
   `TEACHER` (наприклад, 7 днями після заняття), лишивши `ADMIN` без обмежень? Зміна — ще одна умова в
   `attendanceBlocker` для ролі `TEACHER`.
3. **Відмітка до початку.** Чи можна відмічати за кілька хвилин до початку заняття? Зміна — зсув межі в
   `attendanceBlocker`.
4. **Чи завершує відмітка заняття** (`SCHEDULED → COMPLETED`)? Зараз ні: це окрема задача завершення заняття.
5. **Студенти, зараховані після заняття.** Зараз їх показують і дозволяють відмітити. Чи ховати їх за
   `enrolledAt > endsAt`?
6. **Скидання відмітки** до «не відмічено». Зараз неможливе, статус лише замінюється. Зміна — `status: null` у
   `records` і видалення рядка.
7. **Доступ `OWNER`** — як і в groups, edit/reschedule і cancel.

## Поза скоупом

- **STUDENT бачить власне відвідування** (`GET /lessons/me` чи дашборд). Дані для цього вже будуть у таблиці.
- **Відвідування і «не з'явився» на практиці** (`DrivingLesson`) — у задачі завершення практичного заняття.
- **Завершення заняття** (`COMPLETED`) і автоматичне завершення минулих занять.
- **Статистика і звіти**: відсоток відвідування студента чи групи, лічильники на дашбордах, експорт журналу, допуск
  до іспиту за відвідуванням.
- **Сповіщення** студенту чи адміністратору про пропуск (MailModule готовий, окрема задача).
- **Історія змін відмітки** (хто і що змінював до останнього разу). Зараз зберігається лише останній автор і час.
- **Масове «всі присутні»** окремим ендпоінтом: це той самий `PATCH` з усіма студентами в `records`.

## Чек-лист для рев'ю

- [ ] Міграція створює `AttendanceStatus` і `lesson_attendances` з `UNIQUE (lesson_id, student_id)`, FK на `lessons`
      (`CASCADE`), на `users` для студента (`CASCADE`) і автора (`SET NULL`); її timestamp пізніший за міграції в
      `develop`.
- [ ] `student_id` посилається на `users`, а не на `enrollments`; видалення студента з групи не стирає відмітки.
- [ ] Заняття шукається з фільтром організації в самому запиті; чуже заняття дає `404`, а не `403`.
- [ ] `TEACHER` бачить і змінює лише заняття груп, які веде (`403` інакше); `INSTRUCTOR`, `STUDENT` і `OWNER`
      отримують `403`.
- [ ] Відмітити можна лише студента з `ACTIVE`-зарахуванням у групу заняття і з тієї самої організації; інакше `400`
      з `records.<i>.studentId` і однаковим повідомленням для всіх причин.
- [ ] Порядок перевірок `PATCH`: «статус → група → час»; `GET` повертає `editable` з тієї самої функції.
- [ ] Порядок блокувань: група (`FOR SHARE`) → заняття (`FOR UPDATE`); advisory-ключі не беруться.
- [ ] Записи з незміненим статусом не оновлюють `markedAt` і `markedBy`; запис робиться не більше ніж п'ятьма
      запитами.
- [ ] `PATCH` повертає список, прочитаний у тій самій транзакції після запису.
- [ ] `changeTheory` не переносить заняття з відвідуванням (`409`); рефакторинг `lockTheoryForChange` не змінив
      наявних тестів.
- [ ] Відповідь не містить email, телефону, `role` чи `trainingStatus` студентів.
- [ ] У лозі лише id і лічильники, без імен і статусів окремих студентів.
