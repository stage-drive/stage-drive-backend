# Lessons Cancel: план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [lessons-edit-reschedule-implementation.md](lessons-edit-reschedule-implementation.md)
і [groups-complete-archive-implementation.md](groups-complete-archive-implementation.md), перш ніж імплементувати або
рев'ювати цю задачу. Модуль `lessons`, RBAC, блокування рядків і формат помилок уже є. Скасування додає до нього два
ендпоінти і перевикористовує той самий конвеєр «заблокувати → прочитати → перевірити → записати».

## Задача

Реалізувати backend-логіку скасування запланованого заняття.

Acceptance Criteria:

1. реалізовано cancellation заняття;
2. заняття не видаляється неконтрольовано з БД;
3. статус заняття змінюється відповідно до бізнес-логіки;
4. скасоване заняття не вважається активним у розкладі;
5. після скасування звільняються пов'язані ресурси;
6. перевіряються permissions користувача;
7. неможливо скасувати заняття іншої Organization;
8. API повертає актуальний статус заняття;
9. реалізовані коректні error responses.

## Що вже є, а чого немає

- **Статус `CANCELLED` уже є** в обох enum: `LessonStatus` (теорія, таблиця `lessons`) і `DrivingLessonStatus`
  (практика, таблиця `driving_lessons`). Зараз його ставить лише `GroupsService.changeStatus`: закриття групи
  скасовує її майбутні `SCHEDULED`-заняття через `updateMany`
  ([groups.service.ts:331](../src/modules/groups/groups.service.ts#L331)). Минулі `SCHEDULED`-заняття він не чіпає:
  «це облік відвідування, а не розклад».
- **Хто, коли і чому скасував, ніде не зберігається.** Є лише `updatedAt` і рядок у лозі групи.
- **Ендпоінта скасування немає.** `PATCH /lessons/{theory,practice}/:id` і `/reschedule` змінювати `status` не дають:
  поля немає в DTO, `forbidNonWhitelisted` повертає `400`. Для не-`SCHEDULED` занять `assertEditable` повертає `409`
  з `currentStatus` ([lessons.service.ts:208](../src/modules/lessons/lessons.service.ts#L208)).
- **`DELETE` для занять немає**, і ця задача його не додає.
- **Усі, хто читає розклад, уже фільтрують `SCHEDULED`:**

  | Хто читає | Де | Фільтр |
  |---|---|---|
  | Пошук конфліктів теорії | [schedule-conflicts.ts:131](../src/modules/lessons/schedule-conflicts.ts#L131), [:151](../src/modules/lessons/schedule-conflicts.ts#L151) | `status: SCHEDULED` |
  | Пошук конфліктів практики | [schedule-conflicts.ts:198](../src/modules/lessons/schedule-conflicts.ts#L198), [:218](../src/modules/lessons/schedule-conflicts.ts#L218) | `status: SCHEDULED` |
  | Teacher Dashboard, `upcomingLessons` | [dashboard.service.ts:160](../src/modules/dashboard/dashboard.service.ts#L160) | `SCHEDULED`, `scheduledAt >= now` |
  | Student Dashboard, `upcomingLessons` | [dashboard.service.ts:239](../src/modules/dashboard/dashboard.service.ts#L239) | `SCHEDULED`, `scheduledAt >= now` |
  | Instructor Dashboard, `upcomingLessons` і `studentsTotal` | [dashboard.service.ts:291](../src/modules/dashboard/dashboard.service.ts#L291), [:301](../src/modules/dashboard/dashboard.service.ts#L301) | `SCHEDULED` |

  Тому AC 4 і AC 5 закриваються самою зміною статусу. Нових фільтрів додавати не треба, але треба тест, що це справді
  так (див. тест-план).
- **Блокування є:** `lockGroup` ([group-lock.ts](../src/common/prisma/group-lock.ts)), `lockTheoryLesson` і
  `lockPracticeLesson` ([schedule-lock.ts](../src/common/prisma/schedule-lock.ts)). Обидві функції блокування заняття
  вже фільтрують за `organizationId`.

## Рішення, зафіксовані цим планом

1. **Скасування — це зміна статусу, а не видалення.** Рядок лишається в БД зі статусом `CANCELLED`. Зв'язки
   `groupId`, `instructorId`, `studentId` і `carId` не обнуляються: це історія, і за ними видно, кому заняття було
   призначене. `DELETE`-ендпоінта немає (AC 2).
2. **Аудит скасування в самому рядку.** Нові nullable-колонки на обох таблицях:
   - `cancelled_at` (`TIMESTAMP(3)`) — коли скасовано;
   - `cancelled_by_id` (`UUID`, FK на `users`, `ON DELETE SET NULL`, індекс) — хто скасував;
   - `cancellation_reason` (`VARCHAR(500)`) — необов'язкова причина.

   `CHECK` тримає інваріант на рівні БД: `cancelled_at` заповнений тоді й лише тоді, коли `status = 'CANCELLED'`, а
   `cancellation_reason` буває лише в скасованого заняття. Наявні `CANCELLED`-рядки (їх скасувало закриття групи)
   отримують `cancelled_at = updated_at`: точний час невідомий, а це найближче наближення. `cancelled_by_id` у них
   лишається `null`. Окрема таблиця історії не потрібна: заняття скасовується один раз, відновлення немає (див. «Поза
   скоупом»).
3. **Ендпоінти:** `POST /api/lessons/theory/:id/cancel` і `POST /api/lessons/practice/:id/cancel`, тіло
   `{ reason? }`, відповідь `200`.
   - `POST`, а не `PATCH`: це дія над ресурсом, а не часткове оновлення полів. Так само зроблено
     `POST /invitations/:id/cancel`. `@HttpCode(HttpStatus.OK)`, бо `POST` за замовчуванням дає `201`.
   - Маршрути розділені за типом, як і решта модуля (рішення 1 у плані edit/reschedule).
   - Порожнє тіло (або без тіла взагалі) дозволене.
4. **Переходи статусу.** Скасувати можна лише `SCHEDULED`. Інших переходів ця задача не додає.

   | Поточний статус | Результат |
   |---|---|
   | `SCHEDULED`, ще не почалося | `200`, статус `CANCELLED` |
   | `SCHEDULED`, `scheduledAt <= now` | `409 LESSON_CANCEL_STARTED_MESSAGE` |
   | `COMPLETED` | `409 LESSON_NOT_CANCELLABLE_MESSAGE`, `currentStatus: COMPLETED` |
   | `CANCELLED` | `409 LESSON_NOT_CANCELLABLE_MESSAGE`, `currentStatus: CANCELLED` |

   - **Повторне скасування дає `409`, а не `200`.** Це узгоджено з `assertEditable` у цьому модулі і з повторним
     скасуванням запрошення (там `400`). Клієнт, що повторив запит після обриву мережі, бачить
     `currentStatus: CANCELLED` і може вважати дію виконаною.
   - **Скасувати можна лише заняття, яке ще не почалося** (`scheduledAt > now`). Правило те саме, що в
     `GroupsService.changeStatus`: минуле `SCHEDULED`-заняття — це облік відвідування, а не розклад. Пропущене заняття
     можна перенести (`/reschedule`) або закрити майбутньою задачею завершення заняття. Якщо продукт захоче, щоб ADMIN
     скасовував і минулі заняття, вистачить пропустити цю перевірку для ролі `ADMIN` (див. «Відкриті питання»).
   - **Порядок перевірок: статус → група → час.** Тоді повторне скасування завжди дає `currentStatus: CANCELLED`, а
     не «заняття вже почалося».
5. **Теорія закритої групи** (`COMPLETED` або `ARCHIVED`) дає `409 LESSON_GROUP_CLOSED_MESSAGE`, як і для
   редагування. Насправді майбутні заняття такої групи вже скасовані закриттям, тож користувач побачить спершу
   `currentStatus: CANCELLED`. Перевірка лишається на випадок минулих занять і для однаковості з `changeTheory`.
6. **Стан ресурсів не перевіряється.** Заблокований викладач чи інструктор, авто в `MAINTENANCE`, студент, що
   вибув, — це якраз причини скасувати заняття. Тому `assertTeacherActive`, `assertInstructorActive`,
   `requirePracticeProfile` і `requirePracticeCar` у скасуванні не викликаються. Пошук конфліктів теж не потрібен:
   скасування нічого не займає, а лише звільняє.
7. **«Звільнення ресурсів» означає звільнення часового слоту.** Окремої таблиці бронювань немає. Слот викладача,
   групи, інструктора, авто і студента зайнятий, поки заняття `SCHEDULED`, бо всі читачі фільтрують цей статус (таблиця
   вище). Після скасування `findTheoryConflicts` і `findPracticeConflicts` заняття не бачать, і інше заняття можна
   поставити на цей час. Призначення, які не належать заняттю, не змінюються:
   - `Student.instructorId` і `Student.carId` (допуск до практики);
   - `Car.instructorId` і `Car.status`;
   - `Enrollment` студента в групі.
8. **RBAC — ті самі ролі, що й для редагування.** Скасування — це зміна заняття, тому використовуються наявні
   `THEORY_LESSON_EDIT_ROLES = [ADMIN, TEACHER]` і `PRACTICE_LESSON_EDIT_ROLES = [ADMIN, INSTRUCTOR]`:
   - `TEACHER` скасовує лише заняття груп, де він `teacherId`;
   - `INSTRUCTOR` скасовує лише власні практичні заняття;
   - `STUDENT` і `OWNER` отримують `403` від `RolesGuard`. Самоскасування практики студентом і доступ `OWNER` — відкриті
     питання продукту. Коли їх вирішать, роль додається в константу (для студента ще й перевірка «своє заняття»);
   - сервіс повторює перевірку ролі (`assertCanEditTheory`, `assertCanEditPractice`).

   Окремі константи `*_CANCEL_ROLES` не заводяться, поки ролі збігаються.
9. **Ізоляція організацій.** Заняття шукається з фільтром організації в самому запиті: `group.organizationId` для
   теорії, `organizationId` для практики. Блокування рядка теж фільтрує за організацією. Заняття іншої організації дає
   `404 Lesson not found`, а не `403`, щоб не розкривати факт існування id. Чуже заняття своєї організації для `TEACHER`
   чи `INSTRUCTOR` дає `403`.
10. **Блокування.**
    - Теорія: `lockGroup(..., 'share')` → `lockTheoryLesson` (`FOR UPDATE`) → читання → перевірки → `update`. Порядок
      «група → заняття» той самий, що в `changeStatus` і `changeTheory`, тож скасування і закриття групи не дають
      deadlock: скасування чекає на закриття і потім бачить `CANCELLED`.
    - Практика: `lockPracticeLesson` (`FOR UPDATE`) → читання → перевірки → `update`.
    - Скасування і перенесення того самого заняття серіалізуються блокуванням рядка: друге бачить уже збережений стан.
    - **Advisory-ключі не беруться.** Скасування лише звільняє слот. Паралельне перенесення іншого заняття на цей слот у
      гіршому разі ще побачить скасоване заняття як `SCHEDULED` і отримає `409`. Це безпечний бік гонки: конфліктний
      розклад так не з'явиться, а клієнт може повторити запит.
11. **Закриття групи теж заповнює аудит.** `GroupsService.changeStatus` додає в `updateMany`
    `cancelledAt: now`, `cancelledById: actor.id` і `cancellationReason: GROUP_CLOSED_CANCELLATION_REASON`
    («Групу завершено або архівовано.»). Без цього `CHECK` з рішення 2 впаде на закритті групи з майбутніми
    заняттями.
12. **Відповідь — та сама `TheoryLessonDto` / `PracticeLessonDto`** з двома новими полями: `cancelledAt` і
    `cancellationReason` (обидва `null`, доки заняття не скасоване). Поля з'являються і у відповідях
    `PATCH`-ендпоінтів. `cancelledById` у відповідь не потрапляє: він потрібен для аудиту, а UI його поки не показує.
13. **Логи без PII.** `Lesson cancelled type=THEORY lessonId=… scheduledAt=… actorId=… organizationId=…`. Текст
    причини в лог не пишеться: це вільний текст, у ньому можуть бути імена чи дані про здоров'я.

## Ендпоінти

Обидва ендпоінти під `@UseGuards(AuthGuard, RolesGuard)` на класі, `:id` — UUID v4 (`ParseUUIDPipe`).

| Метод і шлях | Тіло | Ролі |
|---|---|---|
| `POST /api/lessons/theory/:id/cancel` | `{ reason? }` | `ADMIN`, `TEACHER` (своя група) |
| `POST /api/lessons/practice/:id/cancel` | `{ reason? }` | `ADMIN`, `INSTRUCTOR` (своє заняття) |

`reason`: необов'язковий рядок, пробіли по краях обрізаються, від 1 до 500 символів, без `<` і `>` (`IsPlainText`),
`null` відхиляється.

Запит:

```json
{ "reason": "Викладач захворів" }
```

Відповідь для теорії:

```json
{
  "id": "1f0e…",
  "type": "THEORY",
  "status": "CANCELLED",
  "topic": "Дорожні знаки",
  "scheduledAt": "2026-11-03T16:00:00.000Z",
  "endsAt": "2026-11-03T17:30:00.000Z",
  "durationMin": 90,
  "group": { "id": "4c21…", "name": "ПДР — Група А" },
  "teacher": { "id": "a3b2…", "firstName": "Ірина", "lastName": "Мельник" },
  "cancelledAt": "2026-10-23T09:12:44.120Z",
  "cancellationReason": "Викладач захворів",
  "updatedAt": "2026-10-23T09:12:44.120Z"
}
```

Відповідь для практики має ту саму форму, що `PracticeLessonDto` у плані edit/reschedule, плюс `cancelledAt` і
`cancellationReason`. `instructor`, `student` і `car` лишаються заповненими (рішення 1).

## Кроки реалізації

Кроки йдуть у порядку залежностей, тож зручно робити по коміту на крок.

### 1. Prisma-схема і міграція

`prisma/schema.prisma`, у `Lesson` і `DrivingLesson`:

```prisma
  cancelledAt        DateTime? @map("cancelled_at")
  cancelledById      String?   @map("cancelled_by_id") @db.Uuid
  cancelledBy        User?     @relation("CancelledLessons", fields: [cancelledById], references: [id], onDelete: SetNull)
  cancellationReason String?   @map("cancellation_reason") @db.VarChar(500)

  @@index([cancelledById])
```

Для `DrivingLesson` назва relation `"CancelledDrivingLessons"`. У `User` дві зворотні relation:

```prisma
  cancelledLessons         Lesson[]        @relation("CancelledLessons")
  cancelledDrivingLessons  DrivingLesson[] @relation("CancelledDrivingLessons")
```

Міграція `prisma/migrations/20261023120000_add_lesson_cancellation/migration.sql`. Згенеруйте її через
`npx prisma migrate dev --create-only --name add_lesson_cancellation` і допишіть backfill і `CHECK` вручну: Prisma
не описує `CHECK` у схемі. Timestamp має бути пізнішим за останню міграцію в `develop`.

```sql
-- AlterTable
ALTER TABLE "lessons" ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by_id" UUID,
ADD COLUMN "cancellation_reason" VARCHAR(500);

ALTER TABLE "driving_lessons" ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by_id" UUID,
ADD COLUMN "cancellation_reason" VARCHAR(500);

-- CreateIndex
CREATE INDEX "lessons_cancelled_by_id_idx" ON "lessons"("cancelled_by_id");
CREATE INDEX "driving_lessons_cancelled_by_id_idx" ON "driving_lessons"("cancelled_by_id");

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Наявні скасовані заняття (закриття групи): точний час невідомий, updated_at — найближче наближення.
UPDATE "lessons" SET "cancelled_at" = "updated_at" WHERE "status" = 'CANCELLED';
UPDATE "driving_lessons" SET "cancelled_at" = "updated_at" WHERE "status" = 'CANCELLED';

-- cancelled_at є тоді й лише тоді, коли заняття скасоване; причина буває лише в скасованого.
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_cancellation_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  AND ("cancellation_reason" IS NULL OR "status" = 'CANCELLED')
);
ALTER TABLE "driving_lessons" ADD CONSTRAINT "driving_lessons_cancellation_check" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  AND ("cancellation_reason" IS NULL OR "status" = 'CANCELLED')
);
```

### 2. DTO: `src/modules/lessons/lessons.dto.ts`

```ts
export const CANCELLATION_REASON_MAX_LENGTH = 500;
export const CANCELLATION_REASON_LENGTH_MESSAGE = `Причина має містити не більше ${CANCELLATION_REASON_MAX_LENGTH} символів.`;

export class CancelLessonDto {
  @ApiPropertyOptional({
    example: 'Викладач захворів',
    maxLength: CANCELLATION_REASON_MAX_LENGTH,
    description: 'Необов’язкова причина скасування. Пробіли по краях обрізаються.',
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(CANCELLATION_REASON_MAX_LENGTH, {
    message: CANCELLATION_REASON_LENGTH_MESSAGE,
  })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'reason має бути рядком.' })
  reason?: string;
}
```

Набір декораторів той самий, що в `UpdateTheoryLessonDto.topic`, тож `null`, порожній рядок і рядок з пробілів
дають `400`.

У `TheoryLessonDto` і `PracticeLessonDto` додати перед `updatedAt`:

```ts
  @ApiProperty({
    type: Date,
    nullable: true,
    example: null,
    description: 'Коли заняття скасовано; null, якщо не скасоване.',
  })
  cancelledAt: Date | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    maxLength: CANCELLATION_REASON_MAX_LENGTH,
  })
  cancellationReason: string | null;
```

### 3. Сервіс: `src/modules/lessons/lessons.service.ts`

**Повідомлення:**

```ts
export const LESSON_NOT_CANCELLABLE_MESSAGE =
  'Скасувати можна лише заняття зі статусом SCHEDULED.';
export const LESSON_CANCEL_STARTED_MESSAGE =
  'Скасувати можна лише заняття, яке ще не почалося.';
```

**Selects і мапери.** Додати `cancelledAt: true` і `cancellationReason: true` у `theoryLessonSelect` і
`practiceLessonSelect`, а також відповідні поля в `toTheoryLessonDto` і `toPracticeLessonDto`.

**`assertEditable` отримує параметр повідомлення** (за замовчуванням `LESSON_NOT_EDITABLE_MESSAGE`), щоб скасування
повертало те саме тіло `409` з `currentStatus`, але зі своїм текстом.

**Винести блокування і читання заняття в приватні методи.** Зараз цей код живе всередині `changeTheory`
([lessons.service.ts:412](../src/modules/lessons/lessons.service.ts#L412)) і `changePractice`
([:528](../src/modules/lessons/lessons.service.ts#L528)). Скасуванню потрібна та сама послідовність, тож краще винести
її, ніж копіювати:

```ts
  /**
   * Група (FOR SHARE) → заняття (FOR UPDATE) → читання з фільтром організації.
   * Заняття іншої організації — 404, чужої групи для TEACHER — 403.
   */
  private async lockTheoryForChange(
    tx: Prisma.TransactionClient,
    actor: User,
    lessonId: string,
  ): Promise<TheoryLessonRow> { … }

  /** Заняття (FOR UPDATE) → читання; чуже заняття для INSTRUCTOR — 403. */
  private async lockPracticeForChange(
    tx: Prisma.TransactionClient,
    actor: User,
    lessonId: string,
  ): Promise<PracticeLessonRow> { … }
```

`changeTheory` і `changePractice` починають викликати ці методи. Це чистий рефакторинг: наявні тести
`lessons.service.spec.ts` і `lesson-schedule.integration-spec.ts` мають пройти без змін. Зручно зробити його окремим
комітом перед кроком із `cancel*`.

**Публічні методи:**

```ts
  async cancelTheory(
    actor: User,
    lessonId: string,
    payload: CancelLessonDto,
  ): Promise<TheoryLessonDto> {
    assertCanEditTheory(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const saved = await this.prisma.$transaction(async (tx) => {
      const lesson = await this.lockTheoryForChange(tx, actor, lessonId);
      assertEditable(lesson.status, LESSON_NOT_CANCELLABLE_MESSAGE);
      if (!OPEN_GROUP_STATUSES.includes(lesson.group.status)) {
        throw new ConflictException(LESSON_GROUP_CLOSED_MESSAGE);
      }
      assertNotStarted(lesson.scheduledAt, now);

      return tx.lesson.update({
        where: { id: lesson.id },
        data: {
          status: LessonStatus.CANCELLED,
          cancelledAt: now,
          cancelledById: actor.id,
          cancellationReason: payload.reason ?? null,
        },
        select: theoryLessonSelect,
      });
    });

    this.logger.log(
      `Lesson cancelled type=THEORY lessonId=${saved.id} scheduledAt=${saved.scheduledAt.toISOString()} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toTheoryLessonDto(saved);
  }
```

`cancelPractice` такий самий, але з `assertCanEditPractice`, `lockPracticeForChange`, без перевірки групи, з
`tx.drivingLesson.update`, `DrivingLessonStatus.CANCELLED` і `type=PRACTICE` у лозі.

```ts
function assertNotStarted(scheduledAt: Date, now: Date): void {
  if (scheduledAt.getTime() <= now.getTime()) {
    throw new ConflictException(LESSON_CANCEL_STARTED_MESSAGE);
  }
}
```

Пошуку конфліктів, `lockScheduleResources` і перевірок стану ресурсів тут немає навмисно (рішення 6 і 10).

### 4. Закриття групи: `src/modules/groups/groups.service.ts`

У `changeStatus` ([groups.service.ts:331](../src/modules/groups/groups.service.ts#L331)):

```ts
export const GROUP_CLOSED_CANCELLATION_REASON = 'Групу завершено або архівовано.';

// …
const now = new Date();
const lessons = await tx.lesson.updateMany({
  where: {
    groupId: existing.id,
    status: LessonStatus.SCHEDULED,
    scheduledAt: { gte: now },
  },
  data: {
    status: LessonStatus.CANCELLED,
    cancelledAt: now,
    cancelledById: actor.id,
    cancellationReason: GROUP_CLOSED_CANCELLATION_REASON,
  },
});
```

Оновити очікування `data` у `groups.service.spec.ts` (зараз `{ status: LessonStatus.CANCELLED }`, рядок 807).

### 5. Контролер і Swagger: `src/modules/lessons/lessons.controller.ts`

```ts
  @Post('theory/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...THEORY_LESSON_EDIT_ROLES)
  @ApiOperation({
    summary: 'Скасувати теоретичне заняття',
    description: `ADMIN або викладач групи скасовує заняття своєї автошколи. ${CANCEL_RULES}`,
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id теоретичного заняття.' })
  @ApiOkResponse({ type: TheoryLessonDto })
  @ApiBadRequestResponse({ description: 'id не UUID або некоректна причина. Тіло містить errors: [{ field, message }].' })
  @ApiForbiddenResponse({ description: 'Роль не ADMIN чи TEACHER, або викладач скасовує заняття чужої групи.' })
  @ApiNotFoundResponse({ description: 'Заняття не знайдено або воно належить іншій автошколі.' })
  @ApiConflictResponse({ description: CANCEL_CONFLICT_DESCRIPTION })
  cancelTheory(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: CancelLessonDto,
  ): Promise<TheoryLessonDto> {
    return this.lessonsService.cancelTheory(user, id, body);
  }
```

`practice/:id/cancel` аналогічно з `PRACTICE_LESSON_EDIT_ROLES` і `PracticeLessonDto`.

```ts
const CANCEL_RULES =
  'Скасувати можна лише заняття зі статусом SCHEDULED, яке ще не почалося. ' +
  'Заняття не видаляється: статус стає CANCELLED, зберігаються час, автор і причина скасування. ' +
  'Скасоване заняття не займає час викладача, групи, інструктора, авто і студента.';

const CANCEL_CONFLICT_DESCRIPTION =
  'Заняття не SCHEDULED (тіло з currentStatus, зокрема повторне скасування), ' +
  'заняття вже почалося, або група теоретичного заняття закрита.';
```

## Error responses

Порядок перевірок: guard'и, потім pipes, потім сервіс. Неавтентифікований клієнт з некоректним тілом отримає `401`.

| Ситуація | Де перевіряється | Статус | Тіло або повідомлення |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | як в інших модулях |
| Роль не з `*_LESSON_EDIT_ROLES` (`STUDENT`, `OWNER`, `INSTRUCTOR` на теорії, `TEACHER` на практиці) | `RolesGuard` | 403 | `Insufficient permissions` |
| `:id` не UUID v4 | `ParseUUIDPipe` | 400 | `Validation failed (uuid v 4 is expected)` |
| `reason` порожній, з пробілів, довший за 500, містить `<` чи `>`, не рядок або `null` | `ValidationPipe` | 400 | `errors: [{ field: 'reason', … }]` |
| Зайве поле в тілі (`status`, `cancelledAt`, …) | `ValidationPipe` | 400 | `property X should not exist` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |
| Заняття немає або воно іншої організації | `lock*ForChange` | 404 | `Lesson not found` |
| Чуже заняття своєї організації для `TEACHER` чи `INSTRUCTOR` | `lock*ForChange` | 403 | `Insufficient permissions` |
| Заняття `COMPLETED` або вже `CANCELLED` | `assertEditable` | 409 | `LESSON_NOT_CANCELLABLE_MESSAGE`, `currentStatus` |
| Група теоретичного заняття `COMPLETED` або `ARCHIVED` | `cancelTheory` | 409 | `LESSON_GROUP_CLOSED_MESSAGE` |
| Заняття вже почалося (`scheduledAt <= now`) | `assertNotStarted` | 409 | `LESSON_CANCEL_STARTED_MESSAGE` |

Приклад `409` для повторного скасування:

```json
{
  "statusCode": 409,
  "message": "Скасувати можна лише заняття зі статусом SCHEDULED.",
  "error": "Conflict",
  "currentStatus": "CANCELLED"
}
```

## Покриття AC

| AC | Як закрито |
|---|---|
| 1. Cancellation | `POST /lessons/{theory,practice}/:id/cancel`, `cancelTheory` / `cancelPractice` |
| 2. Не видаляється неконтрольовано | зміна статусу замість `DELETE`; `DELETE`-маршруту немає; зв'язки не обнуляються; `cancelled_at`, `cancelled_by_id`, `cancellation_reason`; `CHECK` на узгодженість; integration-тест, що рядок лишається |
| 3. Статус за бізнес-логікою | лише `SCHEDULED → CANCELLED`; лише заняття, що ще не почалося; теорія лише відкритої групи; закриття групи заповнює ті самі поля (рішення 4, 5, 11) |
| 4. Не активне в розкладі | усі читачі розкладу (пошук конфліктів, три дашборди) фільтрують `SCHEDULED`; integration-тест |
| 5. Звільнення ресурсів | слот викладача, групи, інструктора, авто і студента звільняється, бо `find*Conflicts` не бачать `CANCELLED`; integration-тест «перенести інше заняття на звільнений слот» (рішення 7) |
| 6. Permissions | `@Roles(...*_LESSON_EDIT_ROLES)`, `assertCanEdit*` у сервісі, перевірка власності для `TEACHER` / `INSTRUCTOR` |
| 7. Інша Organization | фільтр організації в блокуванні і в читанні заняття → `404` (рішення 9) |
| 8. Актуальний статус у відповіді | `update` з `select` повертає збережений рядок → DTO зі `status: CANCELLED`, `cancelledAt`, `cancellationReason` |
| 9. Error responses | таблиця вище, Swagger-декоратори на обох ендпоінтах |

## Тест-план

Запуск: `npm test -- lessons groups`, `npm run test:integration -- lesson-schedule` (потрібен Docker), а також
`npm run lint` і `npm run build`.

### `src/modules/lessons/lessons.dto.spec.ts`

1. `{}` проходить; `{ reason: '  Захворів  ' }` дає `reason: 'Захворів'`.
2. `reason: null`, `''`, `'   '`, `123`, рядок з 501 символу, `'<b>x</b>'` дають `400` з `field: 'reason'`.
3. Рядок рівно з 500 символів проходить.
4. `{ status: 'SCHEDULED' }` дає `property status should not exist`.

### `src/modules/lessons/lessons.service.spec.ts`

Теорія:

1. ADMIN скасовує майбутнє `SCHEDULED`-заняття: `update` з `status: CANCELLED`, `cancelledAt: now`,
   `cancelledById: actor.id`, `cancellationReason`; відповідь містить `status: 'CANCELLED'`; лог без тексту причини.
2. Без `reason` пишеться `cancellationReason: null`.
3. TEACHER своєї групи — `200`; TEACHER чужої групи — `403`; INSTRUCTOR, STUDENT, OWNER — `403` до будь-яких запитів у
   БД.
4. Заняття не знайдене (зокрема іншої організації) — `404`; запит містить `group: { organizationId }`.
5. `COMPLETED` і `CANCELLED` — `409` з `currentStatus` і `LESSON_NOT_CANCELLABLE_MESSAGE`; `update` не викликається.
6. Група `COMPLETED` / `ARCHIVED` — `409 LESSON_GROUP_CLOSED_MESSAGE`.
7. `scheduledAt` у минулому і рівно `now` — `409 LESSON_CANCEL_STARTED_MESSAGE`.
8. Заблокований викладач групи не заважає скасуванню.
9. Порядок блокувань: `lockGroup('share')` раніше за `lockTheoryLesson`; `lockScheduleResources` не викликається.

Практика:

10. Ті самі кейси 1, 2, 4, 5, 7 для `cancelPractice`.
11. INSTRUCTOR свого заняття — `200`, чужого — `403`; TEACHER — `403`.
12. Авто в `MAINTENANCE`, заблокований інструктор, студент не в `PRACTICE` не заважають скасуванню.
13. Відповідь для заняття з авто містить `car`, а не `null`.

Рефакторинг:

14. Наявні тести `updateTheory`, `rescheduleTheory`, `updatePractice`, `reschedulePractice` проходять без змін.

### `src/modules/lessons/lessons.controller.spec.ts`

1. `cancelTheory` і `cancelPractice` мають `@Roles` з відповідними константами і `@HttpCode(200)`.
2. Контролер передає в сервіс `user`, `id` і `body` без змін.

### `src/modules/groups/groups.service.spec.ts`

1. Закриття групи передає в `lesson.updateMany` `cancelledAt`, `cancelledById: actor.id` і
   `cancellationReason: GROUP_CLOSED_CANCELLATION_REASON`.

### `test/integration/lesson-schedule.integration-spec.ts` (новий `describe('cancel')`)

Новий `describe` у тому самому файлі, щоб перевикористати `createSchool()`, `at()`, `deferred()` і `track()`.

1. **Міграція.** Вставка `CANCELLED` без `cancelled_at`, `SCHEDULED` з `cancelled_at` і `SCHEDULED` з
   `cancellation_reason` падають на `CHECK` в обох таблицях.
2. **Рядок не видаляється.** Після `cancelPractice` кількість рядків `driving_lessons` не змінилася; рядок має
   `status = CANCELLED`, `cancelled_at`, `cancelled_by_id = admin.id`, а `instructor_id`, `student_id` і `car_id` ті
   самі, що до скасування.
3. **Звільнення слоту, практика.** Заняття A на 10:00 і B на 13:00 одного інструктора. Перенесення B на 10:00 дає
   `409 INSTRUCTOR`. Після `cancelPractice(A)` те саме перенесення дає `200`.
4. **Звільнення слоту, теорія.** Теорія групи на 18:00 і практика студента цієї групи на 13:00. Перенесення практики
   на 18:30 дає `409 STUDENT / THEORY`. Після `cancelTheory` — `200`.
5. **Скасування чекає на перенесення того самого заняття.** Сира транзакція тримає `lockPracticeLesson` і вже
   перенесла заняття на 14:00. `cancelPractice` лишається pending щонайменше `LOCK_WAIT_MS`, а після коміту скасовує
   вже перенесене заняття (`scheduledAt` 14:00, `status: CANCELLED`).
6. **Скасування проти закриття групи.** Паралельно `GroupsService.changeStatus` (→ `COMPLETED`) і `cancelTheory`
   майбутнього заняття. Обидва завершуються за `UNBLOCKED_WITHIN_MS`, без deadlock. Заняття `CANCELLED` у будь-якому
   разі; `cancelled_by_id` і `cancellation_reason` належать тому, хто встиг першим.
7. **Закриття групи з майбутніми заняттями** проходить `CHECK` і заповнює `cancelled_at`.

Оновити наявний тест `ignores a cancelled lesson in the same slot` (рядок 371): `school.practice({ status: CANCELLED })`
тепер має передавати й `cancelledAt`, інакше впаде `CHECK`. Якщо helper `practice()` не приймає це поле, додати.

### Регресія

- `dashboard.service.spec.ts`, `group-lock.integration-spec.ts` і `test/app.e2e-spec.ts` проходять. Моки занять у
  `app.e2e-spec.ts` зі `status: 'CANCELLED'` можуть потребувати полів `cancelledAt` і `cancellationReason`, якщо
  e2e-тести перевіряють форму відповіді.

### Ручна перевірка

Ті самі demo-акаунти і SQL-вставки занять, що в розділі «Ручна перевірка» плану edit/reschedule.

```bash
# 200: ADMIN скасовує практику з причиною
curl -s -X POST http://localhost:3000/api/lessons/practice/<lesson-1>/cancel \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"Авто на ремонті"}'

# 409 з currentStatus CANCELLED: повторне скасування
curl -s -X POST http://localhost:3000/api/lessons/practice/<lesson-1>/cancel \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 200: друге заняття тепер можна перенести на звільнений слот (10:00 за Києвом)
curl -s -X PATCH http://localhost:3000/api/lessons/practice/<lesson-2>/reschedule \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"scheduledAt":"2026-11-03T10:00:00+02:00"}'

# 200: TEACHER скасовує теорію своєї групи без тіла
curl -s -X POST http://localhost:3000/api/lessons/theory/<theory-lesson>/cancel \
  -H "Authorization: Bearer $TEACHER_TOKEN"

# 403: STUDENT; 404: id заняття іншої автошколи
curl -s -X POST http://localhost:3000/api/lessons/practice/<lesson-2>/cancel \
  -H "Authorization: Bearer $STUDENT_TOKEN"
curl -s -X POST http://localhost:3000/api/lessons/practice/<foreign-lesson>/cancel \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Додатково:

- `GET /api/dashboard/instructor` (і `teacher`) після скасування не показує заняття в `upcomingLessons`.
- `SELECT status, cancelled_at, cancelled_by_id, cancellation_reason FROM driving_lessons WHERE id = '<lesson-1>';`
  показує рядок на місці.
- У Swagger розділ `lessons` показує шість ендпоінтів; у `cancel` є відповіді `200`, `400`, `401`, `403`, `404`, `409`.

## Відкриті питання до продукту

Відповідь на кожне змінює невелику частину плану, але не його структуру.

1. **Чи може `STUDENT` скасувати свою практику**, і до якого часу (наприклад, не пізніше ніж за 24 години)? Зараз
   `403`.
2. **Чи може `ADMIN` скасувати минуле `SCHEDULED`-заняття** (пропущене)? Зараз `409`; зміна — пропустити
   `assertNotStarted` для `ADMIN`.
3. **Доступ `OWNER`** — як і в groups та edit/reschedule.
4. **Чи обов'язкова причина?** Зараз необов'язкова; зміна — прибрати `ValidateIf` у DTO.

## Поза скоупом

- **Сповіщення** студенту, групі, викладачу чи інструктору про скасування (MailModule готовий, окрема задача).
- **Відновлення скасованого заняття** (`CANCELLED → SCHEDULED`). Замість нього створюється нове заняття, коли з'явиться
  create.
- **Завершення заняття і відмітка «не з'явився»** (`COMPLETED`, no-show) — окрема задача.
- **Правила пізнього скасування**: дедлайн, штрафи, ліміти, списання оплаченого заняття.
- **Масове скасування** при блокуванні інструктора чи викладача, переведенні авто в `MAINTENANCE` / `INACTIVE` або
  вибутті студента. Ці дії досі не зважають на майбутні заняття (див. «Поза скоупом» у плані edit/reschedule).
- **Списки і календар** (`GET /lessons`). Коли з'являться, за замовчуванням мають показувати лише `SCHEDULED` або мати
  явний фільтр за статусом, і показувати `cancelledAt` та `cancellationReason` для скасованих.
- **Окрема таблиця історії змін заняття.**

## Чек-лист для рев'ю

- [ ] Міграція додає `cancelled_at`, `cancelled_by_id` (FK `SET NULL`, індекс) і `cancellation_reason` на обидві
      таблиці, робить backfill `cancelled_at` для наявних `CANCELLED` і додає `CHECK`; її timestamp пізніший за
      міграції в `develop`.
- [ ] Немає `DELETE` для занять; скасування не обнуляє `instructorId`, `studentId`, `carId`, `groupId`.
- [ ] Скасувати можна лише `SCHEDULED`, яке ще не почалося; порядок перевірок «статус → група → час».
- [ ] Повторне скасування дає `409` з `currentStatus: CANCELLED`.
- [ ] Стан ресурсів і конфлікти при скасуванні не перевіряються; advisory-ключі не беруться.
- [ ] Порядок блокувань для теорії: група (`FOR SHARE`) → заняття (`FOR UPDATE`).
- [ ] Заняття шукається з фільтром організації в самому запиті; чуже заняття дає `404`, а не `403`.
- [ ] `TEACHER` і `INSTRUCTOR` скасовують лише свої заняття; `STUDENT` і `OWNER` отримують `403`.
- [ ] `GroupsService.changeStatus` заповнює `cancelledAt`, `cancelledById` і `cancellationReason`.
- [ ] `changeTheory` і `changePractice` після рефакторингу проходять наявні тести без змін.
- [ ] Відповідь містить `status: CANCELLED`, `cancelledAt`, `cancellationReason` і не містить email, телефону, `role`
      чи `cancelledById`.
- [ ] Integration-тест «перенести інше заняття на звільнений слот» проходить.
- [ ] Текст причини не потрапляє в лог.
