# Groups Complete & Archive (UF-33): план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [groups-create-update-implementation.md](groups-create-update-implementation.md)
(UF-28) і [groups-course-members-access-implementation.md](groups-course-members-access-implementation.md) (UF-30,
UF-31), перш ніж імплементувати або рев'ювати цю задачу.

**Коротко:** більшу частину UF-33 уже зроблено в UF-28 через `PATCH /api/groups/:id/status`. Завершення — це
перехід `ACTIVE → COMPLETED`, архівування — перехід у `ARCHIVED`. Ця задача не додає нових ендпоінтів і не потребує
міграції. Вона закриває три прогалини:

1. гонку між закриттям групи та зарахуванням у неї студента;
2. майбутні заняття закритої групи, які лишаються в розкладі;
3. тіло `409`, з якого клієнт не може дізнатися поточний статус групи.

## Задача

Реалізувати backend логіку завершення та архівування навчальної групи відповідно до UF-33.

Acceptance Criteria:

1. ADMIN може завершити навчальну групу;
2. ADMIN може архівувати навчальну групу;
3. змінюється статус групи;
4. операція доступна тільки користувачу з відповідними permissions;
5. неможливо змінити групу іншої Organization;
6. реалізована валідація поточного статусу групи;
7. API повертає актуальний статус групи;
8. API повертає коректні error responses.

## Що вже є

Усе нижче вже є в [groups.service.ts](../src/modules/groups/groups.service.ts) і
[groups.controller.ts](../src/modules/groups/groups.controller.ts) і покрите тестами в
[groups.service.spec.ts](../src/modules/groups/groups.service.spec.ts) (`describe('changeStatus')`).

- **Ендпоінт** `PATCH /api/groups/:id/status` з тілом `UpdateGroupStatusDto { status }`. Він захищений
  `@UseGuards(AuthGuard, RolesGuard)` і `@Roles(...GROUP_MANAGE_ROLES)`, а в сервісі ще й `assertCanManageGroups`.
  `GROUP_MANAGE_ROLES = [UserRole.ADMIN]`.
- **Таблиця переходів** `GROUP_STATUS_TRANSITIONS`:

  | З | У |
  |---|---|
  | `PLANNED` | `ACTIVE`, `ARCHIVED` |
  | `ACTIVE` | `COMPLETED`, `ARCHIVED` |
  | `COMPLETED` | `ARCHIVED` |
  | `ARCHIVED` | — |

  Повтор того самого статусу, перехід назад, будь-який перехід з `ARCHIVED` і `PLANNED → COMPLETED` дають `409`
  `Недозволений перехід статусу групи. FROM → TO.`
- **Ізоляція організацій.** `requireGroup` шукає групу через `findFirst({ id, organizationId: actor.organizationId })`,
  тож чужа група дає `404 Group not found`. `requireOrganization` дає `404` для soft-deleted організації.
- **Наслідки закриття** (`→ COMPLETED` або `→ ARCHIVED`). В одній транзакції всі `ACTIVE`-зарахування групи
  переходять у `COMPLETED`, і це робиться до `group.update`. Тому у відповіді `studentsCount = 0`, а студентів можна
  зарахувати в іншу групу. Чому `COMPLETED`, а не `DROPPED`, див. UF-28.
- **Відповідь `200`** — `GroupListItemDto`, зібраний з результату `group.update`, тобто зі збереженим статусом.
- **Закрита група вже read-only.** `update`, `assignCourse`, `addStudent` і `removeStudent` повертають `409` для
  `COMPLETED` і `ARCHIVED`.
- **Лог:** `Group status changed groupId=… from=… to=… completedEnrollments=… actorId=… organizationId=…`.

## Чого бракує

### 1. Гонка: закриття групи і зарахування студента

Транзакції Prisma працюють на рівні `READ COMMITTED`, і ні `changeStatus`, ні `StudentsService.assignGroup` не
блокують рядок групи. Можливий такий сценарій:

```
T1 assignGroup(group A)                  T2 changeStatus(A → COMPLETED)
  group.findUnique → ACTIVE (відкрита)
                                           group.findFirst → ACTIVE
                                           enrollment.updateMany(ACTIVE → COMPLETED)  — нового рядка ще не бачить
                                           group.update(status = COMPLETED)
                                           COMMIT
  enrollment.upsert(ACTIVE)
  COMMIT
```

У результаті група `COMPLETED` має `ACTIVE`-зарахування. Це порушує інваріант 1 з UF-30/31:

- студент рахується в `studentsCount` закритої групи і є в її складі;
- Student Dashboard показує закриту групу як поточну, а Teacher Dashboard рахує студента серед активних;
- прибрати його звідти не можна, бо `removeFromGroup` для закритої групи дає `409`.

Стан виправляється лише тоді, коли студента зарахують в іншу групу: `assignGroup` переведе зайве зарахування в
`COMPLETED`. Так само поводиться `StudentsService.create` з `groupId`.

Обмеження FK `enrollments.group_id` тут не допомагає. Вставка бере `FOR KEY SHARE` на рядок групи, а `UPDATE` статусу
бере `FOR NO KEY UPDATE`, і ці блокування між собою не конфліктують.

### 2. Гонка: два паралельні запити на зміну статусу

Два ADMIN-и одночасно відправляють `ACTIVE → ARCHIVED` і `ACTIVE → COMPLETED`. Обидва читають `ACTIVE`, обидва
проходять перевірку. Якщо `ARCHIVED` закомітиться першим, другий запит перезапише його на `COMPLETED`. Виходить
перехід `ARCHIVED → COMPLETED`, який таблиця забороняє. Повтор `ACTIVE → COMPLETED` двічі теж дає два `200` замість
`200` і `409`. Отже, AC 6 зараз виконується лише без паралельних запитів.

### 3. Заняття закритої групи

Закриття не чіпає `Lesson`. Teacher Dashboard фільтрує заняття за викладачем, а не за статусом групи
([dashboard.service.ts](../src/modules/dashboard/dashboard.service.ts), `getTeacherDashboard`). Тому майбутні
`SCHEDULED`-заняття завершеної або архівної групи далі видно в `upcomingLessons`. UF-28 відклав це питання «до API
занять». API занять досі немає, але UF-33 — саме та задача, що визначає наслідки закриття, тож закриваємо питання
тут.

### 4. Тіло `409` без поточного статусу

Зараз `409` — це стандартне `{ statusCode, message, error }`. Якщо статус групи змінив інший ADMIN (див. п. 2), клієнт
отримує `409` і мусить окремим `GET /groups` з'ясовувати, що тепер. AC 7 просить повертати актуальний статус, тож
додаємо його і у відповідь з помилкою.

## Рішення, зафіксовані цим планом

1. **Нових ендпоінтів немає.** «Завершити» — це `PATCH /groups/:id/status` з `{ "status": "COMPLETED" }`,
   «Архівувати» — той самий ендпоінт з `{ "status": "ARCHIVED" }`. Так само влаштовані `PATCH /cars/:id/status` і
   `PATCH /students/:id/status`. Окремі `POST /groups/:id/complete` і `/archive` дублювали б ту саму логіку двома
   шляхами.
2. **Таблиця переходів не змінюється.** Завершити можна лише `ACTIVE`-групу. Архівувати можна `PLANNED` (скасування
   групи, яка не почалась), `ACTIVE` і `COMPLETED`. Повторно відкрити закриту групу не можна.
3. **Доступ лише для `ADMIN`** (`GROUP_MANAGE_ROLES`). Відкрите питання про `OWNER` з UF-27 досі не вирішене. Коли
   продукт його закриє, достатньо додати `UserRole.OWNER` у константу.
4. **Рядок групи блокується на час транзакції.** Prisma Client не підтримує `FOR UPDATE`, тому використовуємо raw SQL,
   як у `InvitationEmailQueue.claimNext`:
   - `changeStatus` бере `FOR UPDATE` **до** читання групи. Другий паралельний `changeStatus` чекає і читає вже новий
     статус, тож перевірка переходу спрацьовує правильно (гонка з п. 2).
   - `assignGroup` і `create` з `groupId` беруть `FOR SHARE` **до** читання статусу групи. Кілька зарахувань в одну
     групу йдуть паралельно, бо `FOR SHARE` між собою не конфліктують, але кожне з них чекає на закриття групи, і
     закриття чекає на них (гонка з п. 1).

   Обидва порядки подій дають коректний результат:
   - зарахування першим: `changeStatus` чекає на `FOR UPDATE`, після коміту зарахування `enrollment.updateMany`
     бачить новий рядок і переводить його в `COMPLETED`;
   - закриття першим: `FOR SHARE` у `assignGroup` чекає, після коміту закриття `findUnique` читає `COMPLETED`, і
     запит отримує `409 GROUP_NOT_ASSIGNABLE_MESSAGE`.

   Запит блокування фільтрує за `organization_id`, тож рядок чужої групи не блокується. `404` і далі кидає
   `requireGroup` (або перевірка організації в `assignGroup`), логіка ізоляції не змінюється.

   `removeFromGroup` блокування не потребує, бо жоден порядок подій не лишає `ACTIVE`-зарахування в закритій групі:
   - видалення встигло першим: `updateMany` закриття чекає на блокування рядка зарахування і пропускає видалений
     рядок;
   - закриття закомітилось між перевіркою групи і читанням зарахування: `findUnique` бачить `COMPLETED` і повертає
     `404 Student is not in this group`;
   - закриття закомітилось до перевірки групи: `409 GROUP_CLOSED_ROSTER_MESSAGE`.
5. **Закриття скасовує майбутні заняття.** У тій самій транзакції `Lesson` групи з `status = SCHEDULED` і
   `scheduledAt >= now` переходять у `CANCELLED`. Минулі `SCHEDULED`-заняття не змінюються: це питання обліку
   відвідування, а не розкладу, і для нього буде окрема задача. Кількість скасованих занять додається в лог.
6. **`409` для недозволеного переходу містить `currentStatus`.** Тіло:
   `{ statusCode: 409, message: 'Недозволений перехід статусу групи. ACTIVE → PLANNED.', error: 'Conflict', currentStatus: 'ACTIVE' }`.
   `statusCode`, `message` і `error` такі самі, як зараз, тож це розширення формату, а не breaking change.
7. **Інші сутності не змінюються:**
   - `Student.trainingStatus` не змінюється. Завершення теоретичної групи не означає випуску, бо далі йде практика,
     а `PRACTICE` призначається лише допуском до практики.
   - `Student.groupId` не обнуляється (інваріант з UF-27).
   - `startDate` і `endDate` групи не змінюються. `endDate` — це планова дата, а не факт завершення.
   - Нових колонок (`completedAt`, `archivedAt`) немає. Хто і коли закрив групу, видно з логу.

## Ендпоінт

```
PATCH /api/groups/dddddddd-dddd-4ddd-8ddd-dddddddddddd/status
Authorization: Bearer <access token ADMIN>
Content-Type: application/json

{ "status": "COMPLETED" }
```

`200`:

```json
{
  "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "name": "Група A — активна",
  "status": "COMPLETED",
  "startDate": null,
  "endDate": null,
  "teacher": { "id": "…", "firstName": "…", "lastName": "…" },
  "course": { "id": "…", "name": "…" },
  "studentsCount": 0,
  "createdAt": "2026-10-01T09:00:00.000Z"
}
```

`409` (повторне завершення):

```json
{
  "statusCode": 409,
  "message": "Недозволений перехід статусу групи. COMPLETED → COMPLETED.",
  "error": "Conflict",
  "currentStatus": "COMPLETED"
}
```

Підказка для фронтенду: кнопку «Завершити» варто показувати лише для `ACTIVE`, а «Архівувати» — для `PLANNED`,
`ACTIVE` і `COMPLETED`. Після `409` статус у UI оновлюється з `currentStatus`.

## Кроки реалізації

### 1. Helper блокування: `src/common/prisma/group-lock.ts` (новий)

Поруч з [unique-constraint.ts](../src/common/prisma/unique-constraint.ts). Helper спільний, бо ним користуються і
groups, і students.

```ts
import { Prisma } from '@prisma/client';

export type GroupLockMode = 'update' | 'share';

/**
 * Блокує рядок групи до кінця транзакції. Prisma Client не має FOR UPDATE /
 * FOR SHARE, тому raw SQL. Група іншої організації не блокується: запит нічого
 * не знаходить, а 404 кидає подальша перевірка групи.
 *
 * 'update' — зміна статусу групи; 'share' — зарахування студента в групу.
 * Зарахування між собою не конфліктують, але чекають на закриття групи.
 */
export async function lockGroup(
  tx: Prisma.TransactionClient,
  groupId: string,
  organizationId: string,
  mode: GroupLockMode,
): Promise<void> {
  const lock =
    mode === 'update' ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
  await tx.$queryRaw`
    SELECT id FROM groups
    WHERE id = ${groupId}::uuid AND organization_id = ${organizationId}::uuid
    ${lock}
  `;
}
```

`groupId` на цей момент уже провалідований як UUID: `ParseUUIDPipe` у контролері груп і `@IsUUID` у
`AssignStudentGroupDto`/`CreateStudentDto`. Тож `::uuid` не впаде з помилкою приведення типу.

### 2. `GroupsService.changeStatus`

```ts
return this.prisma.$transaction(async (tx) => {
  // Блокування до читання: паралельна зміна статусу або зарахування студента
  // чекає на цю транзакцію і бачить уже збережений статус.
  await lockGroup(tx, groupId, actor.organizationId, 'update');
  const existing = await this.requireGroup(tx, actor, groupId);

  const next = payload.status;
  if (!GROUP_STATUS_TRANSITIONS[existing.status].includes(next)) {
    throw new ConflictException({
      statusCode: 409,
      message: `${GROUP_STATUS_TRANSITION_MESSAGE} ${existing.status} → ${next}.`,
      error: 'Conflict',
      currentStatus: existing.status,
    });
  }

  let completedEnrollments = 0;
  let cancelledLessons = 0;
  if (!isOpenGroup(next)) {
    // COMPLETED, а не DROPPED: DROPPED блокує студенту зарахування в будь-яку іншу групу.
    const enrollments = await tx.enrollment.updateMany({
      where: { groupId: existing.id, status: EnrollmentStatus.ACTIVE },
      data: { status: EnrollmentStatus.COMPLETED },
    });
    completedEnrollments = enrollments.count;

    // Минулі SCHEDULED-заняття не чіпаємо: це облік відвідування, а не розклад.
    const lessons = await tx.lesson.updateMany({
      where: {
        groupId: existing.id,
        status: LessonStatus.SCHEDULED,
        scheduledAt: { gte: new Date() },
      },
      data: { status: LessonStatus.CANCELLED },
    });
    cancelledLessons = lessons.count;
  }

  const saved = await tx.group.update({ /* без змін */ });

  this.logger.log(
    `Group status changed groupId=${saved.id} from=${existing.status} to=${saved.status} completedEnrollments=${completedEnrollments} cancelledLessons=${cancelledLessons} actorId=${actor.id} organizationId=${actor.organizationId}`,
  );
  return toGroupListItem(saved);
});
```

- Порядок `enrollment.updateMany` → `group.update` залишається, щоб `studentsCount` у відповіді вже враховував
  закриття.
- `LessonStatus` додати в імпорт з `@prisma/client`.
- `error.message` у тестах не зміниться: `HttpException` бере `message` з об'єкта відповіді, якщо це рядок.

### 3. `StudentsService`: `FOR SHARE` перед читанням групи

[students.service.ts](../src/modules/students/students.service.ts):

- `assignGroup`: одразу перед `tx.group.findUnique({ where: { id: payload.groupId } })` додати
  `await lockGroup(tx, payload.groupId, actor.organizationId, 'share');`.
- `create`: у гілці `if (groupId)` перед `tx.group.findUnique({ where: { id: groupId } })` додати те саме.

Решта перевірок (`404` для чужої групи, `409` для закритої) не змінюється. Для групи іншої організації блокування
нічого не знаходить, а `findUnique` і порівняння `organizationId` дають той самий `404`.

### 4. Swagger і DTO

- `changeStatus` у [groups.controller.ts](../src/modules/groups/groups.controller.ts). Доповнити `description`:
  «Завершення групи — `{ status: COMPLETED }` з `ACTIVE`; архівування — `{ status: ARCHIVED }` з `PLANNED`, `ACTIVE`
  або `COMPLETED`. Закриття також скасовує майбутні `SCHEDULED`-заняття групи.»
- `@ApiConflictResponse`: «Недозволений перехід статусу. Тіло містить `currentStatus` — поточний статус групи.»
- `UpdateGroupStatusDto` не змінюється.

### 5. Модулі

Змін немає. `PrismaModule` глобальний, helper — звичайна функція, а не provider.

## Error responses

Порядок перевірок: guard'и, потім pipes, потім сервіс.

| Ситуація | Де перевіряється | Статус | Тіло |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | див. UF-27 |
| Роль не `ADMIN` (зокрема `OWNER`) | `RolesGuard` | 403 | `Insufficient permissions` |
| `:id` не UUID v4 | `ParseUUIDPipe` | 400 | `Validation failed (uuid v 4 is expected)` |
| `status` відсутній, `null` або не з enum | `ValidationPipe` | 400 | `errors: [{ field: 'status', … }]` |
| Зайве поле в тілі | `ValidationPipe` | 400 | `errors: [{ field, message: 'property … should not exist' }]` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |
| Групи немає або вона належить іншій організації | `requireGroup` | 404 | `Group not found` |
| Недозволений перехід: повтор статусу, перехід назад, з `ARCHIVED`, `PLANNED → COMPLETED` | `changeStatus` | 409 | `{ statusCode, message: 'Недозволений перехід статусу групи. FROM → TO.', error, currentStatus }` |
| Статус змінив паралельний запит | `lockGroup` + `changeStatus` | 409 | те саме, `currentStatus` — уже збережений статус |

Успіх: `200`, `GroupListItemDto` зі збереженим статусом.

## Покриття AC

| AC | Як закрито | Стан |
|---|---|---|
| 1. ADMIN завершує групу | `PATCH /groups/:id/status` `{ status: COMPLETED }`, перехід `ACTIVE → COMPLETED` | є |
| 2. ADMIN архівує групу | той самий ендпоінт `{ status: ARCHIVED }` з `PLANNED`, `ACTIVE`, `COMPLETED` | є |
| 3. Змінюється статус групи | `group.update({ data: { status } })`; зарахування → `COMPLETED`; майбутні заняття → `CANCELLED` | заняття — нове |
| 4. Лише з відповідними permissions | `@Roles(...GROUP_MANAGE_ROLES)` + `RolesGuard` + `assertCanManageGroups` | є |
| 5. Неможливо змінити групу іншої Organization | `requireGroup` → `404`; блокування теж фільтрує за `organization_id` | є |
| 6. Валідація поточного статусу | `GROUP_STATUS_TRANSITIONS`; `FOR UPDATE` / `FOR SHARE` гарантують перевірку і при паралельних запитах | блокування — нове |
| 7. API повертає актуальний статус | `200` з `GroupListItemDto` після `update`; `409` з `currentStatus` | `currentStatus` — нове |
| 8. Коректні error responses | таблиця вище; Swagger описує `400`, `401`, `403`, `404`, `409` | доповнити Swagger |

## Тест-план

### `src/common/prisma/group-lock.spec.ts` (новий)

- `'update'` виконує `$queryRaw` з `FOR UPDATE`, `'share'` — з `FOR SHARE`. Виклик tagged template збирається назад
  через `Prisma.sql(strings, ...values)`, і перевіряється підсумковий текст
  `SELECT id FROM groups WHERE id = $1::uuid AND organization_id = $2::uuid FOR …` та значення `[groupId, organizationId]`.
- `groupId` з SQL-ін'єкцією потрапляє лише в параметри, а не в текст запиту.

### `src/modules/groups/groups.service.spec.ts` (розширити `describe('changeStatus')`)

У мок `prisma` додано `$queryRaw` і `lesson.updateMany`. Модуль helper'а не мокається: працює справжній
`lockGroup`, а тест перевіряє виклик `$queryRaw(…, 'group-1', 'org-1', Prisma.sql\`FOR UPDATE\`)`.

- Блокування `FOR UPDATE` в організації актора — **до** `group.findFirst` (`invocationCallOrder`).
- Для всіх `REJECTED` переходів: `error.getResponse()` дорівнює
  `{ statusCode: 409, message, error: 'Conflict', currentStatus: from }`, `error.message` не змінився, заняття не
  скасовуються.
- Кожне закриття (`ACTIVE → COMPLETED`, `ACTIVE → ARCHIVED`, `PLANNED → ARCHIVED`, `COMPLETED → ARCHIVED`)
  скасовує лише майбутні `SCHEDULED`-заняття до `group.update`. Межа `scheduledAt.gte` перевіряється вікном
  `Date.now()` до і після виклику, без fake timers.
- `PLANNED → ACTIVE` не чіпає ні зарахувань, ні занять; лог містить `cancelledLessons=0`.
- Лог закриття містить `completedEnrollments=4 cancelledLessons=2`.
- Запит, що прочитав статус, збережений паралельною зміною (`ARCHIVED → COMPLETED`), отримує `409` з
  `currentStatus: ARCHIVED`.
- Чужа група: блокування з `org-1`, `404`, жодних записів.
- Не-ADMIN: `$queryRaw` не викликається.

### `src/modules/students/students.service.spec.ts` (розширити)

- `assignGroup`: `FOR SHARE` на `('group-new', 'org-1')` до `group.findUnique` і до `enrollment.upsert`.
- `create` з `groupId`: `FOR SHARE` до `group.findUnique`. Без `groupId` блокування немає.

### `test/integration/group-lock.integration-spec.ts` (новий, реальний Postgres)

За шаблоном [database.integration-spec.ts](../test/integration/database.integration-spec.ts) (testcontainers +
`prisma migrate deploy`). Справжні `GroupsService` і `StudentsService` працюють з реальним `PrismaClient`.
Конкурентний запит — це окрема транзакція, яка бере те саме блокування і чекає на сигнал, тож порядок подій
детермінований.

1. **Зарахування першим.** Транзакція тримає `FOR SHARE` і вже вставила `ACTIVE`-зарахування. `changeStatus(→ COMPLETED)`
   чекає щонайменше 300 мс. Після коміту зарахування `changeStatus` повертає `studentsCount: 0`, а зарахування
   стає `COMPLETED`.
2. **Закриття першим.** Транзакція тримає `FOR UPDATE` і вже зберегла `COMPLETED`. `assignGroup` чекає, а після коміту
   отримує `409 GROUP_NOT_ASSIGNABLE_MESSAGE`; зарахувань немає.
3. **Дві зміни статусу.** Транзакція тримає `FOR UPDATE` і зберегла `ARCHIVED`. `changeStatus(→ COMPLETED)` чекає, а
   після коміту отримує `409` з `currentStatus: ARCHIVED`; у БД лишається `ARCHIVED`.
4. **Чужа організація.** Блокування з `organizationId` іншої організації не зачіпає рядок: `changeStatus` завершується
   раніше, ніж за 2 с, поки це блокування ще тримається.

Сценарії 1–3 перевірено на коді без блокувань (`HEAD` до цієї задачі): усі три падають саме з описаними в «Чого
бракує» наслідками. Запуск: `npm run test:integration` (потрібен Docker).

### `test/app.e2e-spec.ts`

Змін не потрібно, але треба перевірити. `prismaMock.$queryRaw` уже є і за замовчуванням повертає рядок, а
`lockGroup` результат ігнорує. Тому e2e для `POST /api/students` з `groupId` має проходити без змін.

### Ручна перевірка

Скинути дані: `npm run db:seed`. Отримати access token через `POST /api/auth/login` для `admin@example.com` (пароль
з виводу seed) і для owner-акаунта.

```bash
GROUPS=http://localhost:3000/api/groups

# 200: завершити групу A (ACTIVE → COMPLETED), studentsCount = 0
curl -s -X PATCH $GROUPS/dddddddd-dddd-4ddd-8ddd-dddddddddddd/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}'

# 409 з currentStatus: COMPLETED: повторне завершення
curl -s -X PATCH $GROUPS/dddddddd-dddd-4ddd-8ddd-dddddddddddd/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}'

# 200: архівувати завершену групу C (COMPLETED → ARCHIVED)
curl -s -X PATCH $GROUPS/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"ARCHIVED"}'

# 409 з currentStatus: ARCHIVED: повернути архівну групу D
curl -s -X PATCH $GROUPS/ffffffff-ffff-4fff-8fff-ffffffffffff/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"ACTIVE"}'

# 409: завершити нову PLANNED-групу (спершу створити її через POST /api/groups)
curl -s -X PATCH $GROUPS/<planned-group-id>/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"COMPLETED"}'

# 404: група іншої автошколи
curl -s -X PATCH $GROUPS/abababab-abab-4bab-8bab-abababababab/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"ARCHIVED"}'

# 400: невідомий статус
curl -s -X PATCH $GROUPS/cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd/status -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"CLOSED"}'

# 403: OWNER; 401: без токена
curl -s -X PATCH $GROUPS/cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd/status -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"ARCHIVED"}'
curl -s -X PATCH $GROUPS/cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd/status -H 'Content-Type: application/json' \
  -d '{"status":"ARCHIVED"}'
```

Після завершення групи A: `GET /api/groups/dddddddd-…/students` повертає порожній склад, а
`POST /api/groups/dddddddd-…/students` дає `409`. Студента `grouped-student@example.com` можна додати в групу B.

## Поза скоупом

- Повторне відкриття закритої групи (див. UF-28, «Рішення», п. 3).
- Фільтр `?status=` у `GET /groups` і приховування `ARCHIVED` за замовчуванням. Зараз список повертає групи в усіх
  статусах, а фільтрує фронтенд.
- Teacher Dashboard рахує закриті групи в `groupsTotal`. Це наявна поведінка, її змінюють в окремій задачі.
- Колонки `completedAt` / `archivedAt` і журнал аудиту.
- Сповіщення викладачу та студентам про закриття групи.
- Зміна `trainingStatus` студентів і масовий випуск групи.
- Минулі `SCHEDULED`-заняття (облік відвідування).
- Доступ для `OWNER`, поки продукт не вирішить.

## Чек-лист для рев'ю

- [ ] Нова Prisma-міграція **не** додана; нових ендпоінтів немає.
- [ ] `lockGroup` фільтрує за `id` і `organization_id`, значення передаються параметрами, а не конкатенацією.
- [ ] `changeStatus` бере `FOR UPDATE` до `requireGroup`; `assignGroup` і `create` з `groupId` беруть `FOR SHARE`
      до читання групи.
- [ ] `GROUP_STATUS_TRANSITIONS` не змінено.
- [ ] `409` для переходу містить `statusCode`, `message` (той самий текст), `error` і `currentStatus`.
- [ ] Закриття в одній транзакції переводить `ACTIVE`-зарахування в `COMPLETED` і майбутні `SCHEDULED`-заняття в
      `CANCELLED`, до `group.update`.
- [ ] `trainingStatus`, `Student.groupId` і дати групи не змінюються.
- [ ] Лог містить `cancelledLessons` і не містить PII.
- [ ] Swagger описує завершення, архівування, скасування занять і `currentStatus` у `409`.
- [ ] `npm test`, `npm run test:integration`, `npm run lint` і `npm run build` чисті.
