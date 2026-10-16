# Groups: доступ на перегляд, склад групи, теоретичний курс — план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), [groups-list-implementation.md](groups-list-implementation.md) (UF-27) і
[groups-create-update-implementation.md](groups-create-update-implementation.md) (UF-28), перш ніж імплементувати або
рев'ювати ці задачі. Тут три тікети поверх модуля `groups`. Вони змінюють ті самі файли (`groups.service.ts`,
`groups.dto.ts`, `groups.controller.ts`), тому їх краще робити послідовно, окремими PR (див.
[«Порядок реалізації»](#порядок-реалізації)).

## Задачі

### Права на перегляд груп (номер UF у тікеті не вказаний)

Реалізувати backend permissions для перегляду навчальних груп відповідно до ролі користувача.

1. ADMIN має доступ відповідно до свого scope;
2. TEACHER бачить дозволені йому навчальні групи;
3. STUDENT бачить свою навчальну групу;
4. користувач не може отримати дані групи, до якої не має доступу;
5. перевіряється Authentication + RBAC;
6. реалізована organization isolation;
7. API не повертає дані іншої Organization;
8. unauthorized/forbidden requests повертають коректні error responses.

### UF-31 — додавання та видалення STUDENT

Реалізувати backend логіку додавання та видалення STUDENT з навчальної групи.

1. ADMIN може додати STUDENT до групи;
2. ADMIN може видалити STUDENT із групи;
3. STUDENT належить тій самій Organization;
4. група належить тій самій Organization;
5. перевіряється, що STUDENT існує;
6. перевіряються відповідні permissions;
7. неможливо додати STUDENT до недоступної/неіснуючої групи;
8. актуальний склад групи повертається після операції;
9. API повертає коректні error responses.

### UF-30 — призначення теоретичного курсу

Реалізувати backend логіку призначення теоретичного курсу навчальній групі.

1. ADMIN може призначити теоретичний курс групі;
2. курс існує;
3. курс доступний у поточній Organization;
4. неможливо призначити курс іншої Organization;
5. перевіряється Authentication + RBAC;
6. реалізована валідація;
7. API повертає коректні success/error responses;
8. після призначення група містить актуальний курс.

## Що вже зроблено з групами

### Модель даних

| Модель / поле | Що зберігає | Звідки |
|---|---|---|
| `Group` | `name`, `status` (`PLANNED → ACTIVE → COMPLETED → ARCHIVED`), `organizationId`, `teacherId`, `startDate?`, `endDate?` | міграція `add_teaching_domain` |
| `Enrollment` | студент у групі: `groupId`, `studentId` (id користувача), `status` (`ACTIVE`, `COMPLETED`, `DROPPED`), `enrolledAt`; унікальна пара `(groupId, studentId)` | `add_teaching_domain` |
| `Student.groupId` | поточна або остання група студента | `add_student_profile` |
| `Lesson` | заняття групи: `topic`, `scheduledAt`, `status` | `add_teaching_domain` |
| `Course` | **немає**, ні моделі, ні коду | — |

### Інваріанти, на які спираються всі три задачі

1. **Склад групи — це `Enrollment` зі статусом `ACTIVE`.** Саме їх рахують `studentsCount` у `GET /groups`, Teacher
   Dashboard і Student Dashboard. `Student.groupId` не є джерелом складу, бо в випускників і відрахованих він не
   обнуляється.
2. **Відкрита група — це `PLANNED` або `ACTIVE`.** Зарахувати студента можна лише у відкриту групу, і студент
   може бути лише в одній відкритій групі.
3. **`Student.groupId` і `Enrollment` змінює лише `StudentsService`** (`create` з `groupId`, `assignGroup`,
   `changeTrainingStatus`). Виняток — `GroupsService.changeStatus`: закриття групи переводить її
   `ACTIVE`-зарахування в `COMPLETED`.
4. **`StudentsService.assignGroup` відхиляє студента, у якого є `DROPPED`-зарахування будь-де в організації або
   `COMPLETED`-зарахування у відкритій групі** (перевірка `terminalEnrollment`). Тому видалення студента з групи
   (UF-31) не може ставити ні `DROPPED`, ні `COMPLETED`.

### Ендпоінти

| Ендпоінт | Ролі | Звідки |
|---|---|---|
| `GET /api/groups` | `ADMIN` | UF-27 |
| `POST /api/groups` | `ADMIN` | UF-28 |
| `PATCH /api/groups/:id` | `ADMIN` | UF-28 |
| `PATCH /api/groups/:id/status` | `ADMIN` | UF-28 |
| `PATCH /api/students/:id/group` | `OWNER`, `ADMIN` | students: призначення студента в групу з картки студента |
| `GET /api/dashboard/teacher` | `TEACHER` | групи, де `teacherId = actor.id` |
| `GET /api/dashboard/student` | `STUDENT` | групи з власним `ACTIVE`-зарахуванням |

### Що можна перевикористати

| Що | Де | Для чого |
|---|---|---|
| `GROUP_MANAGE_ROLES` + `assertCanManageGroups` | [groups.service.ts](../src/modules/groups/groups.service.ts) | усі ендпоінти запису в UF-30 і UF-31 |
| `groupListInclude` + `toGroupListItem` | groups.service.ts | відповідь усіх ендпоінтів; UF-30 додає в них `course` |
| `requireGroup(tx, actor, id)`: `findFirst({ id, organizationId })` → `404 Group not found` | groups.service.ts | основа ізоляції в усіх трьох задачах |
| `requireTeacher` | groups.service.ts | шаблон для `requireCourse` (UF-30) |
| `isOpenGroup` / `OPEN_GROUP_STATUSES` / `GROUP_CLOSED_MESSAGE` | groups.service.ts | заборона змін у закритій групі (UF-30, UF-31) |
| `fieldError`, `requireOrganization` | groups.service.ts | формат `400` і перевірка soft-deleted організації |
| `StudentsService.assignGroup` | [students.service.ts](../src/modules/students/students.service.ts) | UF-31 «додати»: усі перевірки студента й групи вже тут |
| `allowedStudentScope(actor)`: `switch` за роллю, що повертає `where` або кидає `403` | students.service.ts | шаблон для `groupScope(actor)` |
| Запити дашбордів (`teacherId = actor.id`; `enrollments.some ACTIVE`) | [dashboard.service.ts](../src/modules/dashboard/dashboard.service.ts) | ті самі правила видимості для TEACHER і STUDENT |
| `findInvitationForActor`: інша організація → `404`, своя, але без доступу → `403` | [invitations.service.ts](../src/modules/invitations/invitations.service.ts) | прецедент для `GET /groups/:id` |
| `PATCH /cars/:id/instructor` + `AssignCarInstructorDto` (`uuid` або `null`) | [cars](../src/modules/cars/) | шаблон для `PATCH /groups/:id/course` |
| Тестові хелпери `caught()`, `mockGroupLookups()`, мок `$transaction`; DTO-спек через реальний `ValidationPipe`; `Reflector`-тест ролей | [groups.service.spec.ts](../src/modules/groups/groups.service.spec.ts), [groups.dto.spec.ts](../src/modules/groups/groups.dto.spec.ts), [groups.controller.spec.ts](../src/modules/groups/groups.controller.spec.ts) | тести всіх трьох задач |
| Seed: групи A (`dddddddd-…`, `ACTIVE`), B (`cdcdcdcd-…`, `ACTIVE`), C (`eeeeeeee-…`, `COMPLETED`), D (`ffffffff-…`, `ARCHIVED`), чужа група (`abababab-…`, інша організація); `grouped-student@example.com` уже в групі A | [prisma/seed.ts](../prisma/seed.ts) | ручна перевірка |

### Чого немає

- Моделі `Course` і зв'язку групи з курсом (UF-30).
- Видалення студента з групи: його немає ніде, ні в groups, ні в students (UF-31).
- Ендпоінта зі складом групи (UF-31, permissions).
- `GET /groups/:id`; `GET /groups` доступний лише ADMIN (permissions).
- `StudentsService` не експортується зі `StudentsModule` (UF-31).

## Порядок реалізації

1. **Права на перегляд.** Додає `groupScope(actor)` і `findVisibleGroup`, на які спирається `GET /groups/:id/students`
   з UF-31. Міграції немає.
2. **UF-31.** Ендпоінти складу групи. Міграції немає.
3. **UF-30.** Нова модель і міграція. Від перших двох не залежить, але змінює ті самі три файли, тож паралельна
   розробка дасть конфлікти.

---

## Частина 1. Права на перегляд груп

### Рішення

1. **Ролі.** `GROUP_VIEW_ROLES = [ADMIN, TEACHER, STUDENT]`. `INSTRUCTOR` отримує `403`: він працює зі студентами
   через практичні заняття, а не через групи, і AC його не згадують. `OWNER` теж отримує `403`: питання про його
   доступ відкрите з UF-27, і цей тікет його не закриває.
2. **Scope за роллю:**

   | Роль | Бачить |
   |---|---|
   | `ADMIN` | усі групи своєї організації, будь-який статус |
   | `TEACHER` | групи своєї організації з `teacherId = actor.id`, будь-який статус (як Teacher Dashboard, з історією своїх груп) |
   | `STUDENT` | групи, де в нього `Enrollment.status = ACTIVE`; на практиці одна або жодної (як Student Dashboard) |

   Після закриття групи зарахування стає `COMPLETED`, тож студент свою завершену групу вже не бачить. Це збігається
   зі Student Dashboard. Історія груп студента не входить у цей тікет.
3. **`404` чи `403`** (прецедент `findInvitationForActor`): групи немає або вона належить іншій організації —
   `404 Group not found`; група своєї організації поза scope ролі — `403 Insufficient permissions`. Існування групи
   іншої автошколи так не розкривається.
4. **Однакова форма відповіді для всіх ролей** (`GroupListItemDto`): назва, статус, дати, викладач (`id`, ім'я,
   прізвище), `studentsCount`. Тут немає PII студентів. Склад групи з контактами студентів віддає окремий
   `GET /groups/:id/students` (частина 2), доступний лише ADMIN і викладачу цієї групи. STUDENT контактів
   одногрупників не бачить.
5. **Ні query-, ні body-параметрів для scope.** `organizationId`, `teacherId` і `studentId` фільтра беруться лише з
   `@CurrentUser()`.

### Ендпоінти

- `GET /api/groups` стає role-aware (раніше лише ADMIN). Форма відповіді `{ groups: [...] }` не змінюється.
- `GET /api/groups/:id` (новий) повертає `GroupListItemDto`.

### Кроки

#### 1. Сервіс

```ts
export const GROUP_VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.STUDENT,
] as const;

/**
 * ADMIN бачить усі групи організації, TEACHER — свої, STUDENT — групу з власним
 * ACTIVE-зарахуванням. Інші ролі отримують 403 ще до запитів у БД.
 */
function groupScope(actor: User): Prisma.GroupWhereInput {
  const organizationGroups: Prisma.GroupWhereInput = {
    organizationId: actor.organizationId,
  };
  switch (actor.role) {
    case UserRole.ADMIN:
      return organizationGroups;
    case UserRole.TEACHER:
      return { ...organizationGroups, teacherId: actor.id };
    case UserRole.STUDENT:
      return {
        ...organizationGroups,
        enrollments: {
          some: { studentId: actor.id, status: EnrollmentStatus.ACTIVE },
        },
      };
    default:
      throw new ForbiddenException('Insufficient permissions');
  }
}
```

`list(actor)`: перейменувати параметр `admin` на `actor` і замінити `where` на `groupScope(actor)`. `groupScope`
викликати **до** `requireOrganization`, щоб `INSTRUCTOR` і `OWNER` отримували `403` без запитів у БД.

Новий приватний метод, спільний для `GET /groups/:id` і `GET /groups/:id/students`:

```ts
private async findVisibleGroup(
  actor: User,
  groupId: string,
): Promise<GroupListRow> {
  const scope = groupScope(actor); // 403 для ролей без доступу
  await this.requireOrganization(actor.organizationId);
  const group = await this.requireGroup(this.prisma, actor, groupId); // 404
  if (actor.role !== UserRole.ADMIN) {
    const visible = await this.prisma.group.count({
      where: { AND: [{ id: group.id }, scope] },
    });
    if (visible === 0) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
  return group;
}

async findOne(actor: User, groupId: string): Promise<GroupListItemDto> {
  return toGroupListItem(await this.findVisibleGroup(actor, groupId));
}
```

`requireGroup` приймає `Prisma.TransactionClient`, а `PrismaService` сумісний із цим типом, тож поза транзакцією
можна передати `this.prisma`. Друга перевірка через `count` з тим самим `scope` гарантує, що список і картка
групи не розійдуться в правилах видимості.

#### 2. Контролер

- `list()`: `@Roles(...GROUP_VIEW_ROLES)`, оновити Swagger-опис («ADMIN — усі групи організації, TEACHER — свої,
  STUDENT — групу з активним зарахуванням»).
- Новий `@Get(':id')` з `@Roles(...GROUP_VIEW_ROLES)` і `ParseUUIDPipe({ version: '4' })`. Swagger: `200`, `401`,
  `403`, `404`.

### Error responses

| Ситуація | Статус | `message` |
|---|---|---|
| Немає або невалідний access token | 401 | див. UF-27 |
| Роль `INSTRUCTOR` або `OWNER` | 403 | `Insufficient permissions` |
| `:id` не UUID v4 | 400 | `Validation failed (uuid v 4 is expected)` |
| Групи немає або вона іншої організації | 404 | `Group not found` |
| TEACHER: група своєї організації, але не його | 403 | `Insufficient permissions` |
| STUDENT: група своєї організації, але він не має в ній `ACTIVE`-зарахування | 403 | `Insufficient permissions` |
| Організацію soft-deleted | 404 | `Organization not found` |
| Груп у scope немає | 200 | `{ "groups": [] }` |

### Тести

`groups.service.spec.ts`:

1. `list` для ADMIN, TEACHER і STUDENT викликає `findMany` з точним `where` із таблиці scope.
2. `list` і `findOne` для `INSTRUCTOR` і `OWNER` кидають `ForbiddenException` без звернень до БД.
3. `findOne`: чужа або неіснуюча група → `404`; група поза scope для TEACHER і STUDENT → `403`; для ADMIN `count` не
   викликається; успіх повертає `GroupListItemDto`.

`groups.controller.spec.ts`: оновити наявний тест «restricts the group list to ADMIN» на `GROUP_VIEW_ROLES`;
`findOne` має `GROUP_VIEW_ROLES`.

Ручна перевірка. Групи з seed веде запрошений викладач без пароля, тому для перевірки TEACHER спершу створіть групу
з `teacher@example.com` (`a7a7a7a7-…`) через `POST /groups` від ADMIN.

- `teacher@example.com`: `GET /groups` показує лише цю групу, `GET /groups/dddddddd-…` дає `403`.
- `grouped-student@example.com` / `Password1`: `GET /groups` показує лише групу A, `GET /groups/cdcdcdcd-…` дає
  `403`, `GET /groups/abababab-…` (інша організація) дає `404`.
- `instructor@example.com`: `GET /groups` дає `403`.

### Покриття AC

| AC | Як закрито |
|---|---|
| 1. ADMIN у своєму scope | `groupScope`: уся організація |
| 2. TEACHER бачить дозволені групи | `teacherId = actor.id` |
| 3. STUDENT бачить свою групу | `enrollments.some { studentId, ACTIVE }` |
| 4. Немає доступу до чужих груп | `findVisibleGroup`: `404` або `403` |
| 5. Authentication + RBAC | `AuthGuard` + `RolesGuard` на класі, `GROUP_VIEW_ROLES`, `groupScope` у сервісі |
| 6–7. Organization isolation | `organizationId` з токена в кожному `where`; чужа група дає `404` |
| 8. Коректні 401 і 403 | таблиця вище |

---

## Частина 2. UF-31 — склад групи

### Рішення

1. **Ендпоінти з боку групи:**
   - `GET /api/groups/:id/students` — склад групи (ADMIN або TEACHER цієї групи);
   - `POST /api/groups/:id/students` з тілом `{ "studentId": "<uuid>" }` — додати студента (ADMIN);
   - `DELETE /api/groups/:id/students/:studentId` — видалити студента (ADMIN).

   Наявний `PATCH /students/:id/group` лишається для UI картки студента. Обидва шляхи працюють через той самий код.
2. **`StudentsService` лишається єдиним, хто змінює `Student.groupId` і `Enrollment`.** `StudentsModule` експортує
   `StudentsService`, `GroupsModule` імпортує `StudentsModule`. Циклу немає, бо students від groups не залежить.
   «Додати» викликає наявний `assignGroup` замість копіювання його ~100 рядків перевірок. «Видалити» — це новий
   `StudentsService.removeFromGroup` поруч з `assignGroup`.
3. **Додавання.** Спершу `GroupsService` перевіряє групу з URL (`requireGroup` → `404 Group not found`), бо це
   ресурс запиту. Решту перевіряє `assignGroup`: студента немає, його видалено або він з іншої організації —
   `404 Student not found`; студент `ARCHIVED` або з термінальним статусом навчання — `409`; група закрита — `409`;
   студент уже в іншій відкритій групі — `409`. Повторне додавання студента, який уже в цій групі, нічого не змінює
   і повертає `200`. `assignGroup` дозволяє `OWNER` і `ADMIN`, а груповий ендпоінт звужує доступ до `ADMIN`
   (`@Roles` + `assertCanManageGroups`).
4. **Видалення прибирає рядок `Enrollment` і обнуляє `Student.groupId`**, якщо той вказує на цю групу. Статус
   змінювати не можна: `DROPPED` назавжди заблокував би студенту будь-яке нове зарахування, а `COMPLETED` у
   відкритій групі блокує його, доки ця група відкрита (інваріант 4). Видалення означає «студента тут не має бути»
   (помилка або переведення), а не результат навчання. Випуск і відрахування робляться через
   `PATCH /students/:id/status`. Додатково:
   - видаляти можна лише з відкритої групи; для закритої — `409`, бо її склад — це історія;
   - видаляти можна лише `ACTIVE`-зарахування; якщо його немає — `404 Student is not in this group`;
   - `trainingStatus` студента не змінюється.
5. **Склад групи** — це `ACTIVE`-зарахування, відсортовані за прізвищем та ім'ям. Поля: `id` (id користувача),
   `firstName`, `lastName`, `email`, `phone`, `trainingStatus`, `enrolledAt`. TEACHER бачить контакти: він уже має
   доступ до карток студентів усієї організації (`STUDENT_CARD_ROLES`), тож нового розкриття даних немає. STUDENT
   доступу до складу не має.
6. **Відповідь** усіх трьох ендпоінтів — `GroupStudentsDto { group: GroupListItemDto, students: GroupStudentDto[] }`.
   `group` несе оновлений `studentsCount`. `POST` повертає `200`, а не `201`, бо віддає склад групи, а не новий
   ресурс.

### Відома прогалина: архівовані студенти

`StudentsService.archive` (`DELETE /students/:id`) і `changeTrainingStatus(→ ARCHIVED)` не закривають
`ACTIVE`-зарахування (`enrollmentStatusForTraining(ARCHIVED)` повертає `null`). Тому архівований студент лишається в
`studentsCount` і потрапить у склад групи. AC 8 вимагає актуального складу, тож **рекомендовано виправити це в
цьому ж PR**: при архівуванні переводити `ACTIVE`-зарахування в `DROPPED`. `ARCHIVED` — термінальний статус, тож
блокування нових зарахувань тут нічого не ламає. Достатньо, щоб `enrollmentStatusForTraining(ARCHIVED)` повертав
`DROPPED`, а `archive()` викликав той самий `enrollment.updateMany`. Зарахування випускника, якого потім архівували,
уже `COMPLETED`, і фільтр `status: ACTIVE` його не зачепить.

### Кроки

#### 1. Модулі

- `students.module.ts`: `exports: [StudentsService]`.
- `groups.module.ts`: `imports: [AuthModule, StudentsModule]`; конструктор `GroupsService` отримує
  `private readonly studentsService: StudentsService`.

#### 2. `StudentsService.removeFromGroup`

```ts
export const STUDENT_NOT_IN_GROUP_MESSAGE = 'Student is not in this group';
export const GROUP_CLOSED_ROSTER_MESSAGE =
  'Склад групи зі статусом COMPLETED або ARCHIVED змінювати не можна.';

async removeFromGroup(
  actor: User,
  studentId: string,
  groupId: string,
): Promise<void> {
  assertCanAssignStudentGroup(actor);
  await this.requireOrganization(actor.organizationId);

  await this.prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({
      where: { id: groupId, organizationId: actor.organizationId },
    });
    if (!group) {
      throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
    }
    if (!isOpenGroup(group.status)) {
      throw new ConflictException(GROUP_CLOSED_ROSTER_MESSAGE);
    }

    const student = await tx.user.findFirst({
      where: {
        id: studentId,
        organizationId: actor.organizationId,
        role: UserRole.STUDENT,
        deletedAt: null,
      },
      select: { id: true, studentProfile: { select: { id: true, groupId: true } } },
    });
    if (!student?.studentProfile) {
      throw new NotFoundException(STUDENT_NOT_FOUND_MESSAGE);
    }

    const enrollment = await tx.enrollment.findUnique({
      where: { groupId_studentId: { groupId, studentId: student.id } },
    });
    if (!enrollment || enrollment.status !== EnrollmentStatus.ACTIVE) {
      throw new NotFoundException(STUDENT_NOT_IN_GROUP_MESSAGE);
    }

    await tx.enrollment.delete({ where: { id: enrollment.id } });
    if (student.studentProfile.groupId === groupId) {
      await tx.student.update({
        where: { id: student.studentProfile.id },
        data: { groupId: null },
      });
    }
  });

  this.logger.log(
    `Student removed from group studentId=${studentId} groupId=${groupId} actorId=${actor.id} organizationId=${actor.organizationId}`,
  );
}
```

#### 3. DTO у `groups.dto.ts`

```ts
export class AddGroupStudentDto {
  @ApiProperty({ format: 'uuid', example: '88888888-8888-4888-8888-888888888888' })
  @IsUUID('4', { message: 'studentId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  studentId: string;
}

export class GroupStudentDto {
  id: string;            // id користувача-студента
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  trainingStatus: TrainingStatus | null;
  enrolledAt: Date;
}

export class GroupStudentsDto {
  group: GroupListItemDto;
  students: GroupStudentDto[];
}
```

Swagger-декоратори (`@ApiProperty`) додати так само, як у наявних DTO.

#### 4. `GroupsService`

```ts
export const GROUP_ROSTER_ROLES = [UserRole.ADMIN, UserRole.TEACHER] as const;

async listStudents(actor: User, groupId: string): Promise<GroupStudentsDto> {
  assertCanViewRoster(actor); // GROUP_ROSTER_ROLES, інакше 403
  await this.findVisibleGroup(actor, groupId); // 404 або 403 (TEACHER не цієї групи)
  return this.loadRoster(actor, groupId);
}

async addStudent(actor: User, groupId: string, payload: AddGroupStudentDto) {
  assertCanManageGroups(actor);
  await this.requireOrganization(actor.organizationId);
  await this.requireGroup(this.prisma, actor, groupId);
  await this.studentsService.assignGroup(actor, payload.studentId, { groupId });
  return this.loadRoster(actor, groupId);
}

async removeStudent(actor: User, groupId: string, studentId: string) {
  assertCanManageGroups(actor);
  await this.studentsService.removeFromGroup(actor, studentId, groupId);
  return this.loadRoster(actor, groupId);
}

private async loadRoster(actor: User, groupId: string): Promise<GroupStudentsDto> {
  const [group, enrollments] = await Promise.all([
    this.requireGroup(this.prisma, actor, groupId),
    this.prisma.enrollment.findMany({
      where: {
        groupId,
        status: EnrollmentStatus.ACTIVE,
        student: { organizationId: actor.organizationId },
      },
      select: {
        enrolledAt: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            studentProfile: { select: { trainingStatus: true } },
          },
        },
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    }),
  ]);
  return {
    group: toGroupListItem(group),
    students: enrollments.map(toGroupStudent),
  };
}
```

- Склад читається після транзакції `assignGroup` або `removeFromGroup`, тобто бачить уже збережені зміни.
- `student` вибирається через `select`. Не можна `include: { student: true }`, бо тоді у відповідь потрапили б
  `passwordHash` та інші поля `User`.
- `toGroupStudent` мапить поля явно, без spread, як `toGroupListItem`.

#### 5. Контролер

```ts
@Get(':id/students')      // @Roles(...GROUP_ROSTER_ROLES)
@Post(':id/students')     // @Roles(...GROUP_MANAGE_ROLES), @HttpCode(HttpStatus.OK)
@Delete(':id/students/:studentId') // @Roles(...GROUP_MANAGE_ROLES)
```

Обидва параметри шляху через `ParseUUIDPipe({ version: '4' })`. Swagger: `200 GroupStudentsDto`, `400`, `401`,
`403`, `404`, `409`.

### Error responses

| Ситуація | Ендпоінт | Статус | `message` |
|---|---|---|---|
| Роль не `ADMIN` (запис) або не `ADMIN`/`TEACHER` (склад) | усі | 403 | `Insufficient permissions` |
| TEACHER читає склад чужої групи своєї організації | `GET` | 403 | `Insufficient permissions` |
| `:id` або `:studentId` не UUID, `studentId` у тілі не UUID або відсутній | усі | 400 | `errors: [{ field, … }]` або `Validation failed (uuid v 4 is expected)` |
| Групи немає або вона іншої організації | усі | 404 | `Group not found` |
| Студента немає, його видалено або він з іншої організації | `POST`, `DELETE` | 404 | `Student not found` |
| Студент не в цій групі | `DELETE` | 404 | `Student is not in this group` |
| Група `COMPLETED` або `ARCHIVED` | `POST` | 409 | `GROUP_NOT_ASSIGNABLE_MESSAGE` (з `assignGroup`) |
| Група `COMPLETED` або `ARCHIVED` | `DELETE` | 409 | `GROUP_CLOSED_ROSTER_MESSAGE` |
| Студент `ARCHIVED`, `DROPPED` або `GRADUATED` | `POST` | 409 | `STUDENT_TRAINING_STATUS_MESSAGE` |
| Студент уже в іншій відкритій групі | `POST` | 409 | `STUDENT_ACTIVE_GROUP_MESSAGE` |

### Тести

- `students.service.spec.ts`, `removeFromGroup`: успіх видаляє зарахування й обнуляє `groupId`; `groupId`, що
  вказує на іншу групу, не чіпається; закрита група дає `409`; немає `ACTIVE`-зарахування (немає взагалі,
  `COMPLETED`, `DROPPED`) — `404`; чужий студент і чужа група — `404`; `TEACHER` — `403`. Якщо виправляється
  прогалина з архівованими, тест: `archive()` переводить `ACTIVE`-зарахування в `DROPPED`.
- `groups.service.spec.ts`: мок `StudentsService` у конструкторі (наявні тести теж потрібно оновити, бо конструктор
  отримує другий аргумент); `addStudent` перевіряє групу до `assignGroup` і повертає склад; `removeStudent` повертає
  склад без видаленого; `loadRoster` вибирає лише `ACTIVE`, свою організацію і безпечні поля студента;
  `listStudents` для TEACHER чужої групи дає `403`, для STUDENT — `403` без звернень до БД.
- `groups.dto.spec.ts`: `AddGroupStudentDto` (відсутній або не-UUID `studentId`, зайві поля).
- `groups.controller.spec.ts`: ролі трьох нових методів; передача `user`, `id`, `studentId` і `body` у сервіс.

Ручна перевірка на seed: від ADMIN додати `student@example.com` (`88888888-…`) у групу B, переконатися, що
`studentsCount` = 1, видалити, потім додати знову (повторне додавання після видалення має працювати). Чужа група
`abababab-…` дає `404`, група C (`COMPLETED`) — `409`, `grouped-student@example.com` у групу B — `409` (він уже в
групі A).

### Покриття AC

| AC | Як закрито |
|---|---|
| 1–2. ADMIN додає і видаляє | `POST` і `DELETE /groups/:id/students` |
| 3. STUDENT тієї самої Organization | `assignGroup` і `removeFromGroup` шукають студента з `organizationId: actor.organizationId` |
| 4. Група тієї самої Organization | `requireGroup` / `findFirst({ id, organizationId })` |
| 5. STUDENT існує | `404 Student not found` |
| 6. Permissions | `GROUP_MANAGE_ROLES` для запису, `GROUP_ROSTER_ROLES` + scope для читання |
| 7. Недоступна або неіснуюча група | `404` для неіснуючої чи чужої, `409` для закритої |
| 8. Актуальний склад після операції | відповідь `GroupStudentsDto`, прочитана після транзакції |
| 9. Error responses | таблиця вище |

---

## Частина 3. UF-30 — теоретичний курс

### Рішення

1. **Нова модель `Course`, що належить організації.** AC «курс іншої Organization» передбачає саме курси
   організації, а не глобальний каталог. Мінімальні поля: `name`, `description?`, `status` (`ACTIVE` або
   `ARCHIVED`). «Курс доступний у поточній Organization» означає: та сама організація **і** статус `ACTIVE`.
2. **`Group.courseId` — необов'язковий зовнішній ключ з `onDelete: SetNull`**, як `Student.groupId`. Курси
   архівуються, а не видаляються, тож `SetNull` спрацює лише при ручному видаленні.
3. **Відкрите питання: CRUD курсів.** AC UF-30 не просять створювати чи редагувати курси. Якщо для цього є окремий
   тікет (можливо, UF-29), його треба зробити першим. Якщо немає, UF-30 включає: модель, міграцію, курси в seed і
   `GET /api/courses` лише для читання (ADMIN), без якого фронтенду нема з чого обрати курс. Створення й
   редагування курсів тоді окремий тікет.
4. **Окремий ендпоінт `PATCH /api/groups/:id/course`** з тілом `{ "courseId": "<uuid>" | null }`, за зразком
   `PATCH /cars/:id/instructor`. `null` знімає курс. Не поле в `PATCH /groups/:id`, бо тут власні правила й помилки
   (курс не знайдено, курс архівовано), і `UpdateGroupDto` лишається простим.
5. **Правила:**
   - група своєї організації, інакше `404 Group not found`;
   - група відкрита, інакше `409` `GROUP_CLOSED_MESSAGE` (курс завершеної групи — історія);
   - курс своєї організації, інакше `404 Course not found`; курс іншої організації теж дає `404`;
   - курс `ARCHIVED` дає `409`;
   - той самий курс, або `null` для групи без курсу, нічого не змінює і повертає `200`.
6. **`GroupListItemDto` отримує `course: { id, name } | null`.** Поле з'являється в `GET /groups`,
   `GET /groups/:id` і у відповідях усіх ендпоінтів запису. Це додавання поля, а не breaking change. AC 8
   закривається відповіддю `PATCH` і будь-яким наступним `GET`.

### Кроки

#### 1. `prisma/schema.prisma`

```prisma
enum CourseStatus {
  ACTIVE
  ARCHIVED
}

/// Теоретичний курс автошколи: програма, яку викладач читає групі.
model Course {
  id             String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String       @map("organization_id") @db.Uuid
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String       @db.VarChar(120)
  description    String?
  status         CourseStatus @default(ACTIVE)
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")
  groups         Group[]

  @@index([organizationId])
  @@map("courses")
}
```

У `Group`:

```prisma
  courseId       String?      @map("course_id") @db.Uuid
  course         Course?      @relation(fields: [courseId], references: [id], onDelete: SetNull)

  @@index([courseId])
```

В `Organization`: `courses Course[]`.

Унікальність назви курсу, категорію (`LicenseCategory`) і кількість годин краще визначити в тікеті на CRUD курсів.
Для призначення вони не потрібні.

#### 2. Міграція

`npx prisma migrate dev --name add_courses`. Перевірити згенерований SQL: `CREATE TYPE "CourseStatus"`,
`CREATE TABLE "courses"` з `DEFAULT gen_random_uuid()`, `ALTER TABLE "groups" ADD COLUMN "course_id" UUID`, індекси
та `FOREIGN KEY … ON DELETE SET NULL`. Колонка nullable, тож наявні групи мігрують без бекфілу.

#### 3. Seed

Хелпер `upsertCourse` за зразком `upsertGroup`. Додати два `ACTIVE` і один `ARCHIVED` курс у демо-організацію та
один курс в іншу організацію (для перевірки ізоляції). Призначити курс групі A, щоб фронтенд одразу бачив
заповнене поле.

#### 4. Модуль `courses` (якщо немає окремого CRUD-тікета)

`src/modules/courses/`: `CoursesModule` (імпортує `AuthModule`), `CoursesController` з
`GET /courses` (`@Roles(UserRole.ADMIN)`), `CoursesService.list(actor)` повертає `{ courses: [{ id, name, status }] }`
своєї організації, відсортовані за `name`. Відповідь обгорнута в об'єкт, як `GroupListDto`, щоб пізніше додати
пагінацію без breaking change. Зареєструвати в `AppModule`.

#### 5. DTO у `groups.dto.ts`

```ts
export class GroupCourseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'Теоретичний курс, категорія B' }) name: string;
}

// GroupListItemDto:
@ApiProperty({ type: GroupCourseDto, nullable: true })
course: GroupCourseDto | null;

export class AssignGroupCourseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Активний курс своєї автошколи. null знімає курс.',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID('4', { message: 'courseId має бути UUID або null.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  courseId: string | null;
}
```

Перевірено на встановленій версії class-validator: якщо умова `@ValidateIf` хибна, пропускається і `@IsDefined`.
Тому `{ "courseId": null }` проходить, а `{}` дає «Заповніть обов'язкове поле.», без окремої перевірки в сервісі.

#### 6. `GroupsService`

- `groupListInclude` додає `course: { select: { id: true, name: true } }`, `toGroupListItem` мапить
  `course: group.course`.
- Новий метод:

```ts
export const COURSE_NOT_FOUND_MESSAGE = 'Course not found';
export const COURSE_ARCHIVED_MESSAGE = 'Архівований курс не можна призначити групі.';

async assignCourse(
  actor: User,
  groupId: string,
  payload: AssignGroupCourseDto,
): Promise<GroupListItemDto> {
  assertCanManageGroups(actor);
  await this.requireOrganization(actor.organizationId);

  const saved = await this.prisma.$transaction(async (tx) => {
    const existing = await this.requireGroup(tx, actor, groupId);
    if (!isOpenGroup(existing.status)) {
      throw new ConflictException(GROUP_CLOSED_MESSAGE);
    }
    if (payload.courseId === existing.courseId) {
      return existing;
    }
    if (payload.courseId !== null) {
      await this.requireCourse(tx, actor.organizationId, payload.courseId);
    }
    return tx.group.update({
      where: { id: existing.id },
      data: { courseId: payload.courseId },
      include: groupListInclude,
    });
  });

  this.logger.log(
    `Group course assigned groupId=${saved.id} courseId=${saved.courseId ?? 'none'} actorId=${actor.id} organizationId=${actor.organizationId}`,
  );
  return toGroupListItem(saved);
}

private async requireCourse(
  tx: Prisma.TransactionClient,
  organizationId: string,
  courseId: string,
) {
  const course = await tx.course.findFirst({
    where: { id: courseId, organizationId },
    select: { status: true },
  });
  if (!course) {
    throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
  }
  if (course.status !== CourseStatus.ACTIVE) {
    throw new ConflictException(COURSE_ARCHIVED_MESSAGE);
  }
}
```

#### 7. Контролер

`@Patch(':id/course')` з `@Roles(...GROUP_MANAGE_ROLES)` і `ParseUUIDPipe({ version: '4' })`. Swagger: `200
GroupListItemDto`, `400`, `401`, `403`, `404`, `409`.

### Error responses

| Ситуація | Статус | `message` |
|---|---|---|
| Роль не `ADMIN` | 403 | `Insufficient permissions` |
| `courseId` відсутній | 400 | `errors: [{ field: 'courseId', message: "Заповніть обов'язкове поле." }]` |
| `courseId` не UUID і не `null`, зайві поля в тілі | 400 | `errors: [{ field, … }]` |
| Групи немає або вона іншої організації | 404 | `Group not found` |
| Курсу немає або він іншої організації | 404 | `Course not found` |
| Група `COMPLETED` або `ARCHIVED` | 409 | `GROUP_CLOSED_MESSAGE` |
| Курс `ARCHIVED` | 409 | `COURSE_ARCHIVED_MESSAGE` |

### Тести

- `groups.service.spec.ts`: оновити наявні очікування мапінгу (`course: null`) і повний `include` у тесті `create`;
  `assignCourse`: успіх, знімання курсу через `null`, той самий курс без запису, курс іншої організації — `404`,
  архівований курс — `409`, закрита група — `409`, чужа група — `404`, не-ADMIN — `403`, `requireCourse` не
  викликається для `null`.
- `groups.dto.spec.ts`: `AssignGroupCourseDto` (`null` проходить, `{}` і `'abc'` дають `400`).
- `courses.service.spec.ts` (якщо модуль у скоупі): лише своя організація, сортування за `name`, `403` для
  не-ADMIN.
- Міграцію перевірити на чистій БД (`prisma migrate reset` локально або testcontainers, як у
  `test/integration/database.integration-spec.ts`).

### Покриття AC

| AC | Як закрито |
|---|---|
| 1. ADMIN призначає курс | `PATCH /groups/:id/course` |
| 2. Курс існує | `requireCourse` → `404` |
| 3. Курс доступний в Organization | та сама організація і `status = ACTIVE` |
| 4. Курс іншої Organization не призначається | `findFirst({ id, organizationId })` → `404` |
| 5. Authentication + RBAC | guard'и класу + `GROUP_MANAGE_ROLES` + `assertCanManageGroups` |
| 6. Валідація | `AssignGroupCourseDto` + правила сервісу |
| 7. Success і error responses | таблиця вище; Swagger |
| 8. Група містить актуальний курс | `course` у `GroupListItemDto` у відповіді та в усіх `GET` |

---

## Поза скоупом

- Створення й редагування курсів, якщо для цього немає окремого тікета (див. частину 3, рішення 3).
- Доступ `OWNER` (відкрите питання з UF-27) і `INSTRUCTOR` до груп.
- Історія груп студента: STUDENT бачить лише групу з `ACTIVE`-зарахуванням.
- Масове додавання студентів і пагінація складу групи.
- Сповіщення студенту про додавання чи видалення з групи.
- Показ курсу в Teacher і Student Dashboard.
- Заняття закритої групи (див. UF-28, «Поза скоупом»).

## Чек-лист для рев'ю

Права на перегляд:

- [ ] `groupScope` — єдине джерело правил видимості; його використовують `list` і `findVisibleGroup`.
- [ ] `INSTRUCTOR` і `OWNER` отримують `403` до запитів у БД.
- [ ] Чужа або неіснуюча група дає `404`, група поза scope — `403`.
- [ ] STUDENT і TEACHER не можуть розширити scope query-параметрами.

UF-31:

- [ ] `StudentsService` — єдиний, хто змінює `Student.groupId` і `Enrollment`; `GroupsService` лише делегує.
- [ ] Видалення прибирає `Enrollment` і обнуляє `Student.groupId` лише для цієї групи; статуси `DROPPED` і
      `COMPLETED` не використовуються.
- [ ] Закрита група: склад не змінюється (`409`).
- [ ] Склад вибирає студента через `select`, без `passwordHash` і без spread.
- [ ] Рішення щодо архівованих студентів прийняте (виправлено в цьому PR або заведено окремим тікетом).

UF-30:

- [ ] Міграція створює `courses` і nullable `groups.course_id` з `ON DELETE SET NULL`; бекфіл не потрібен.
- [ ] Курс іншої організації дає `404`, архівований — `409`, закрита група — `409`.
- [ ] `course` додано в `groupListInclude` і `toGroupListItem`, тобто він є в усіх відповідях групи.
- [ ] Відкрите питання про CRUD курсів закрите до початку роботи.

Загальне:

- [ ] Swagger описує всі нові ендпоінти та статуси.
- [ ] Логи без PII: лише id групи, студента, курсу, актора й організації.
- [ ] `npm test`, `npm run lint` і `npm run build` чисті.
