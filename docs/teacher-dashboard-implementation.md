# Teacher Dashboard (DF-03 / UF-16) — план реалізації

Читати після [CLAUDE.md](../CLAUDE.md) і перед тим, як імплементувати або рев'ювати цю задачу. Продовжує
[dashboard foundation](../src/modules/dashboard/) (Owner/Admin dashboards) — той самий модуль, той самий
контролер, новий ендпоінт за аналогією.

## Головна знахідка перед тим, як писати код

`OwnerDashboardDto`/`AdminDashboardDto` мають реальні дані для показу, бо вони рахують **User** і
**Invitation** — моделі, які вже є в `schema.prisma`. Для Teacher-дашборду природне очікування (за
CLAUDE.md, TEACHER = "Theoretical Course Lecturer") — щось на кшталt "скільки в мене груп/студентів/занять".
**Жодної з цих моделей у `schema.prisma` не існує** — перевірено напряму (`grep "^model " prisma/schema.prisma`
повертає лише `Organization`, `User`, `OAuthAccount`, `OAuthAuthorization`, `RefreshToken`,
`PasswordResetToken`, `Invitation`). Немає `Course`, `Group`, `Lesson`, жодного зв'язку "цей TEACHER
відповідає за цих STUDENT".

AC "Dependencies: Dashboard foundation" називає залежністю лише вже готовий dashboard-модуль, **не** назве
курси/групи — тобто задача офіційно вважається розв'язною без нових Prisma-моделей. Але буквальне трактування
AC-пункту "Обробляється відсутність даних" натякає, що очікується секція зі статистикою (groups/lessons/
students), яка може бути порожньою — а такої секції зараз просто нема з чого порахувати.

**Це відкрите питання, яке варто підтвердити перед кодуванням**, а не вгадувати мовчки:

- **Варіант A (реалізовно вже зараз, рекомендовано як перший крок):** Teacher dashboard повертає лише те, що
  вже існує в схемі — публічні дані організації (як в Admin) і власний профіль teacher'а. Жодних
  вигаданих "заглушок" на кшталт `groups: { total: 0 }` — поле, яке ніколи не порахує нічого, крім нуля,
  бо джерела даних нема, це оманливий "half-finished" API (CLAUDE.md прямо проти цього).
- **Варіант B:** реальна навчальна статистика (групи/студенти/заняття teacher'а) — вимагає нових Prisma-
  моделей (`Group`/`Enrollment`/`Lesson` чи подібне) і окремої задачі на рівні schema-міграції. Це не "Teacher
  Dashboard"-задача, а щонайменше "Courses/Groups foundation", яка мала б бути окремим DF-тікетом.

## Рішення: обрано Варіант B

Продукт хоче реальну навчальну статистику, не лише профіль+організацію. Це означає нову частину домену:
groups (навчальні групи), enrollments (студент у групі), lessons (заняття групи). Нижче — план саме для
цього, а розділ "Дизайн (Варіант A)" нижче лишається як задокументований fallback/довідка (наприклад, якщо
Варіант B доведеться відкласти) — не реалізовувати обидва одразу.

## Що потрібно додати в `schema.prisma`

Три нові моделі й три нові enum. Формат — той самий, що вже використовується в файлі (`dbgenerated`
`gen_random_uuid()`, `@map` snake_case, `@@index` на FK, `@@map` на назву таблиці):

```prisma
enum GroupStatus {
  PLANNED
  ACTIVE
  COMPLETED
  ARCHIVED
}

enum EnrollmentStatus {
  ACTIVE
  COMPLETED
  DROPPED
}

enum LessonStatus {
  SCHEDULED
  COMPLETED
  CANCELLED
}

model Group {
  id             String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name           String       @db.VarChar(120)
  status         GroupStatus  @default(PLANNED)
  organizationId String       @map("organization_id") @db.Uuid
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  teacherId      String       @map("teacher_id") @db.Uuid
  teacher        User         @relation("TeacherGroups", fields: [teacherId], references: [id], onDelete: Cascade)
  startDate      DateTime?    @map("start_date")
  endDate        DateTime?    @map("end_date")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")
  enrollments    Enrollment[]
  lessons        Lesson[]

  @@index([organizationId])
  @@index([teacherId])
  @@map("groups")
}

model Enrollment {
  id         String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  groupId    String           @map("group_id") @db.Uuid
  group      Group            @relation(fields: [groupId], references: [id], onDelete: Cascade)
  studentId  String           @map("student_id") @db.Uuid
  student    User             @relation("StudentEnrollments", fields: [studentId], references: [id], onDelete: Cascade)
  status     EnrollmentStatus @default(ACTIVE)
  enrolledAt DateTime         @default(now()) @map("enrolled_at")

  @@unique([groupId, studentId])
  @@index([groupId])
  @@index([studentId])
  @@map("enrollments")
}

model Lesson {
  id          String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  groupId     String       @map("group_id") @db.Uuid
  group       Group        @relation(fields: [groupId], references: [id], onDelete: Cascade)
  topic       String       @db.VarChar(200)
  scheduledAt DateTime     @map("scheduled_at")
  durationMin Int          @default(90) @map("duration_min")
  status      LessonStatus @default(SCHEDULED)
  createdAt   DateTime     @default(now()) @map("created_at")

  @@index([groupId])
  @@index([scheduledAt])
  @@map("lessons")
}
```

Плюс back-relations у вже існуючих моделях:
- `Organization` [schema.prisma:39](../prisma/schema.prisma#L39) — додати `groups Group[]` поруч із `users`/
  `invitations`.
- `User` [schema.prisma:59](../prisma/schema.prisma#L59) — додати `taughtGroups Group[] @relation("TeacherGroups")`
  і `enrollments Enrollment[] @relation("StudentEnrollments")` поруч з `oauthAccounts`/`refreshToken` тощо.

**Свідомі спрощення для MVP** (позначити явно, щоб ніхто не сприйняв за забудькуватість):
- Один `teacherId` на групу — заміна teacher-а на конкретному занятті (наприклад, хвороба) зараз не
  моделюється окремо на `Lesson`; `Lesson` успадковує teacher через свій `Group`. Якщо потрібна заміна
  вчителя на окреме заняття — це розширення (додати опціональний `substituteTeacherId` на `Lesson`), не
  робити зараз "про запас".
- `Enrollment` — без історії статусів (просто поточний `status`), без окремої таблиці аудиту.

### Міграція

```bash
npx prisma migrate dev --name add_teaching_domain
npx prisma generate
```
(Локально; на CI/Docker — той самий `npx prisma migrate deploy`, що вже налаштований у `docker-entrypoint.sh`
для сервісу `migrate`.)

## Найважливіше обмеження скоупу: звідки візьмуться дані

Ця задача додає **лише читання** (дашборд), не CRUD для груп/enrollments/занять. Без окремого способу
створити `Group`/`Enrollment`/`Lesson` нові таблиці будуть порожні, і дашборд коректно покаже нулі (це
законний прояв AC "обробляється відсутність даних" — не помилка). Але це означає, що **побачити реальні дані
в дашборді неможливо, поки не з'явиться хоча б мінімальний спосіб їх створити**:

- Для локальної розробки/демо — розширити `prisma/seed.ts` (шлях уже налаштований у
  [prisma.config.ts](../prisma.config.ts)) тестовими групами/enrollments/заняттями.
- Для реального продукту — керування групами (створення групи, призначення teacher'а, запис студентів,
  розклад занять) — це окрема, більша фіча ("Groups & Scheduling management"), природно наступна після цього
  дашборду, не її частина. Не намагатись непомітно "заодно" зробити CRUD ендпоінти в рамках Teacher Dashboard
  тікета — це інший обсяг роботи з власними AC (хто має право створювати групу — OWNER? ADMIN? і т.д.).

## Дизайн сервісу/DTO (Варіант B)

### DTO — [dashboard.dto.ts](../src/modules/dashboard/dashboard.dto.ts)

```ts
export class TeacherDashboardGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ example: 12 })
  studentsCount: number;
}

export class TeacherDashboardLessonDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  groupId: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  groupName: string;

  @ApiProperty({ example: 'Розділ 3: Дорожні знаки' })
  topic: string;

  @ApiProperty()
  scheduledAt: Date;
}

export class TeacherDashboardStatsDto {
  @ApiProperty({ example: 3 })
  groupsTotal: number;

  @ApiProperty({
    description: 'Унікальні студенти в усіх групах цього TEACHER (без дублів, якщо студент у двох групах).',
    example: 34,
  })
  studentsTotal: number;

  @ApiProperty({ example: 5 })
  upcomingLessonsTotal: number;
}

export class TeacherDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: TeacherDashboardProfileDto })
  teacher: TeacherDashboardProfileDto;

  @ApiProperty({ type: TeacherDashboardStatsDto })
  stats: TeacherDashboardStatsDto;

  @ApiProperty({ type: [TeacherDashboardGroupDto] })
  groups: TeacherDashboardGroupDto[];

  @ApiProperty({
    type: [TeacherDashboardLessonDto],
    description: 'Наступні 5 запланованих занять цього TEACHER, за зростанням дати.',
  })
  upcomingLessons: TeacherDashboardLessonDto[];
}
```

`TeacherDashboardProfileDto` — та сама, що вже описана в розділі "Дизайн (Варіант A)" нижче, без змін.

### Сервіс — `DashboardService.getTeacherDashboard(teacher: User)`

```ts
async getTeacherDashboard(teacher: User): Promise<TeacherDashboardDto> {
  const organization = await this.requireOrganization(teacher.organizationId);
  const now = new Date();

  const [groups, upcomingLessons, distinctStudents] = await Promise.all([
    this.prisma.group.findMany({
      where: { teacherId: teacher.id, organizationId: teacher.organizationId },
      include: {
        _count: {
          select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    this.prisma.lesson.findMany({
      where: {
        group: { teacherId: teacher.id, organizationId: teacher.organizationId },
        scheduledAt: { gte: now },
        status: LessonStatus.SCHEDULED,
      },
      include: { group: { select: { name: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    }),
    this.prisma.enrollment.findMany({
      where: {
        status: EnrollmentStatus.ACTIVE,
        group: { teacherId: teacher.id, organizationId: teacher.organizationId },
      },
      select: { studentId: true },
      distinct: ['studentId'],
    }),
  ]);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      logoUrl: organization.logoUrl,
      timezone: organization.timezone,
    },
    teacher: {
      id: teacher.id,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: teacher.email,
      status: teacher.status,
    },
    stats: {
      groupsTotal: groups.length,
      studentsTotal: distinctStudents.length,
      upcomingLessonsTotal: upcomingLessons.length,
    },
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      status: group.status,
      studentsCount: group._count.enrollments,
    })),
    upcomingLessons: upcomingLessons.map((lesson) => ({
      id: lesson.id,
      groupId: lesson.groupId,
      groupName: lesson.group.name,
      topic: lesson.topic,
      scheduledAt: lesson.scheduledAt,
    })),
  };
}
```

**Чому окремий `enrollment.findMany({ distinct: ['studentId'] })` для `studentsTotal`, а не просто сума
`_count.enrollments` по групах:** якщо той самий студент записаний у дві групи цього ж teacher'а, сума по
групах порахує його двічі. Дашборд-лічильник "скільки в мене студентів" має рахувати унікальних людей, не
записи.

`upcomingLessonsTotal` у `stats` — це кількість у видачі (`take: 5`), **не** загальна кількість майбутніх
занять. Якщо потрібне реальне загальне число (не обмежене 5) — додати окремий `lesson.count(...)` без `take`;
у цьому плані свідомо не додано, щоб не плодити запит заради цифри, яку ніхто explicitly не просив в AC.

### Контролер — без змін відносно Варіанту A

`GET /dashboard/teacher`, `@Roles(UserRole.TEACHER)` — та сама сигнатура, той самий контролер-метод з розділу
"Дизайн (Варіант A)" нижче (`getTeacherDashboard(@CurrentUser() user: User)`), просто DTO/сервіс тепер
повертають більше.

## Покриття AC (Варіант B)

- **"Teacher отримує необхідні dashboard data"** — так: групи, студенти (унікальні), найближчі заняття.
- **"Дані відповідають його scope"** — усі три запити (`group.findMany`, `lesson.findMany`,
  `enrollment.findMany`) фільтруються по `teacherId: teacher.id` **і** `organizationId: teacher.organizationId`
  одночасно (подвійний фільтр — навіть якщо колись з'явиться баг з `teacherId`, `organizationId` не дасть
  побачити чужу школу, і навпаки).
- **"Недоступні дані інших ролей не повертаються"** — групи/заняття/enrollments **інших** teacher'ів тієї ж
  школи не потрапляють у відповідь (фільтр по `teacherId`, не по `organizationId` окремо).
- **"Обробляється відсутність даних"** — teacher без жодної групи отримує `groups: []`,
  `stats: { groupsTotal: 0, studentsTotal: 0, upcomingLessonsTotal: 0 }`, `upcomingLessons: []` — валідний
  `200`, не `404`/`500`. `404` лишається тільки для видаленої/неіснуючої organization (той самий шлях, що і
  в Owner/Admin).

## Тест-план (Варіант B)

`dashboard.service.spec.ts`, мок `prisma.group`/`prisma.lesson`/`prisma.enrollment` за зразком уже наявних
моків `prisma.user`/`prisma.invitation`:

- teacher без груп → усі лічильники `0`, масиви порожні, без винятків;
- teacher з групами, але без enrollments → `studentsCount: 0` на кожній групі, `studentsTotal: 0`;
- студент записаний у дві групи того самого teacher'а → `studentsTotal` рахує його **один раз** (саме той
  тест, що ловить помилку "сума замість distinct");
- заняття іншого teacher'а (та сама organization) → не потрапляє у `upcomingLessons`;
- заняття цього teacher'а, але в **іншій** organization (гіпотетичний cross-tenant кейс, якщо колись
  з'явиться спільний teacherId — малоймовірно, але дешево перевірити) → не потрапляє;
- `upcomingLessons` не включає заняття зі `scheduledAt` у минулому чи зі статусом `CANCELLED`/`COMPLETED`;
- organization не знайдено/видалена → `NotFoundException` (як і в Owner/Admin).

## Чек-лист для рев'ю (Варіант B)

- [ ] Нові Prisma-моделі (`Group`, `Enrollment`, `Lesson`) і enum'и додані, міграція згенерована й застосована
      (`npx prisma migrate dev`), `npx prisma generate` виконано.
- [ ] Усі три запити в `getTeacherDashboard` фільтруються і по `teacherId`, і по `organizationId` —
      подвійна ізоляція, не лише одна з двох.
- [ ] `studentsTotal` — `distinct(['studentId'])`, не сума `_count.enrollments` по групах (реальний ризик
      подвійного підрахунку).
- [ ] `upcomingLessons` виключає минулі та `CANCELLED`/`COMPLETED` заняття.
- [ ] Дані інших teacher'ів (та ж школа) і будь-яких даних з інших organization не потрапляють у відповідь.
- [ ] Порожній стан (немає груп/enrollments/занять) повертає `200` з нулями/порожніми масивами, не помилку.
- [ ] CRUD для груп/enrollments/занять **не** додано в рамках цієї задачі — лише читання для дашборду; якщо
      з'явились POST/PATCH-ендпоінти для `Group`/`Lesson` — це вихід за межі тікета, обговорити окремо.
- [ ] `prisma/seed.ts` (якщо оновлювався для локального тестування) не зламав існуючі seed-дані для
      Owner/Admin dashboards.
- [ ] Нові тести з розділу вище присутні й проходять (`npm test`).

---

Нижче — початковий план для **Варіанту A**, залишений як довідка/fallback, **не для реалізації** (обрано
Варіант B вище):

## Дизайн (Варіант A)

### DTO — додати в [dashboard.dto.ts](../src/modules/dashboard/dashboard.dto.ts)

Organization-секція для Teacher — рівно той самий публічний підмножина полів, що вже є для Admin
(`id`, `name`, `logoUrl`, `timezone`, без `status` — organization-статус це вже перевірено на рівні
`AuthGuard`/логіну, показувати його в дашборді ролі, що не керує організацією, не потрібно). **Перевикористати
`AdminDashboardOrganizationDto` напряму**, а не створювати ідентичний дублікат:

```ts
export class TeacherDashboardProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Ганна' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'teacher@example.com' })
  email: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;
}

export class TeacherDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: TeacherDashboardProfileDto })
  teacher: TeacherDashboardProfileDto;
}
```

### Сервіс — `DashboardService.getTeacherDashboard(teacher: User)`

Дзеркалить `getAdminDashboard`'s патерн `requireOrganization`, але без `groupBy`/`invitation.count` — це саме
той scope, який реально належить Teacher сьогодні (organization publicly-visible info + власний профіль),
жодних запитів по інших User:

```ts
async getTeacherDashboard(teacher: User): Promise<TeacherDashboardDto> {
  const organization = await this.requireOrganization(teacher.organizationId);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      logoUrl: organization.logoUrl,
      timezone: organization.timezone,
    },
    teacher: {
      id: teacher.id,
      firstName: teacher.firstName,
      lastName: teacher.lastName,
      email: teacher.email,
      status: teacher.status,
    },
  };
}
```

`requireOrganization` уже приватний метод класу — перевикористовується як є, без змін.

### Контролер — новий `GET /dashboard/teacher`, за аналогією з `admin`

```ts
@Get('teacher')
@Roles(UserRole.TEACHER)
@ApiOperation({
  summary: 'Дані Teacher Dashboard',
  description:
    'Публічні дані школи й власний профіль поточного TEACHER. Дані інших користувачів ' +
    '(інших TEACHER, INSTRUCTOR, STUDENT, ADMIN, OWNER) не повертаються. ' +
    'Інші організації в відповідь не потрапляють.',
})
@ApiOkResponse({ type: TeacherDashboardDto })
@ApiForbiddenResponse({ description: 'Дані Teacher Dashboard доступні лише TEACHER.' })
@ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
getTeacherDashboard(@CurrentUser() user: User) {
  return this.dashboardService.getTeacherDashboard(user);
}
```

`@UseGuards(AuthGuard, RolesGuard)` уже висить на рівні контролера — новий ендпоінт успадковує їх автоматично,
як і `owner`/`admin`.

### Module wiring

Не потрібно нічого міняти в `dashboard.module.ts` — `DashboardService`/`DashboardController` вже
зареєстровані, новий метод/ендпоінт — просто доповнення існуючих класів.

## Покриття AC (Варіант A)

- **"Teacher отримує необхідні dashboard data"** — так, у межах того, що реально існує: свій профіль і
  публічні дані школи.
- **"Дані відповідають його scope"** — `organizationId` береться з `teacher.organizationId` (як і в
  Owner/Admin), teacher бачить лише свою організацію і лише себе, не інших користувачів.
- **"Недоступні дані інших ролей не повертаються"** — на відміну від Admin, тут навіть немає
  `users`/`invitations` секцій узагалі — Teacher не бачить нічого про склад школи, на відміну від Admin, який
  бачить агреговані (не персональні) лічильники TEACHER/INSTRUCTOR/STUDENT. Це свідомо строгіше: Teacher —
  не управлінська роль.
- **"Обробляється відсутність даних"** — немає окремої гілки "якщо даних нема" для Варіанту A, бо єдині дані
  (власний профіль, дані organization) завжди існують, поки є валідний токен і не видалена organization
  (той самий `NotFoundException` шлях, що й у Owner/Admin). Якщо прийнято Варіант B пізніше — ось де
  з'явиться реальна "порожня секція": teacher без призначених груп отримає `groups: []`/`total: 0`, а не 404.

## Тест-план

`dashboard.service.spec.ts` (доповнити, за зразком уже наявних тестів на `getOwnerDashboard`):

- `getTeacherDashboard` повертає organization (без `status`!) і власний профіль teacher'а;
- organization не знайдено / `deletedAt` не `null` → `NotFoundException` (той самий шлях, що й в Owner/Admin —
  можна перевірити одним спільним тестом на `requireOrganization`, якщо такого ще нема);
- переконатись, що відповідь **не містить** жодного поля з даними інших User (немає `users`/`invitations`
  ключів у результаті взагалі).

Controller-рівень: `@Roles(UserRole.TEACHER)` — покладатися на вже існуючий `roles.guard.spec.ts`, окремого
теста не потрібно, якщо той вже перевіряє generic-механізм `@Roles`.

## Чек-лист для рев'ю

- [ ] Teacher dashboard **не** робить жодного запиту, що зачіпає інших `User` (`groupBy`, `findMany` по
      `organizationId` без фільтра на себе) — лише `requireOrganization` + дані з переданого `teacher: User`.
- [ ] `organization`-секція **не** містить `status` (той самий підхід, що й в Admin — organization-статус не
      є "dashboard-даними" ролі, що нею не керує).
- [ ] `AdminDashboardOrganizationDto` перевикористано для organization-секції, не продубльовано.
- [ ] Жодних вигаданих placeholder-полів (`groups: 0`, `lessons: []` тощо) без реальної моделі, що їх рахує —
      якщо вони з'явились, це означає, що хтось тихцем вирішив Варіант B без нової Prisma-моделі під ним.
- [ ] `@Roles(UserRole.TEACHER)` виставлено на новому ендпоінті, і жодна інша роль (`INSTRUCTOR`, `STUDENT`
      тощо) не отримає `200` з нього.
- [ ] Нові тести з розділу вище присутні й проходять (`npm test`).
- [ ] Рішення "Варіант A чи B" зафіксовано — якщо продукт хоче реальну навчальну статистику, це окрема задача
      з новими Prisma-моделями, не розширення цього ендпоінта "по-тихому".
