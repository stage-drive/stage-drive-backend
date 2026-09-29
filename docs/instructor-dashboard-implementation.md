# Instructor Dashboard — план реалізації

Читати після [CLAUDE.md](../CLAUDE.md), [teacher-dashboard-implementation.md](teacher-dashboard-implementation.md)
і [student-dashboard-implementation.md](student-dashboard-implementation.md) перед тим, як імплементувати або
рев'ювати цю задачу. Той самий модуль [dashboard](../src/modules/dashboard/), той самий контролер, новий
ендпоінт за аналогією.

## Головна знахідка: на відміну від Student, тут схема Teacher-роботи **не** підходить

Для Student Dashboard вдалося перевикористати `Group`/`Enrollment`/`Lesson` без жодної нової міграції, бо
`Enrollment` — це саме зв'язок студент↔група. Для INSTRUCTOR це не працює: за CLAUDE.md, `INSTRUCTOR` —
"Driving Instructor", і практичні заняття з водіння — це **не** групові теоретичні заняття `TEACHER`.
`Group.teacherId` жорстко прив'язаний до вчителя теорії, `Lesson` належить `Group`, не окремому студенту.
Перевірено напряму (`grep "^model \|INSTRUCTOR" prisma/schema.prisma`) — `INSTRUCTOR` існує лише як значення
enum `UserRole`, жодної моделі для практичних занять, автомобілів чи розкладу інструктора в базі немає.

Тобто ситуація повторює ту, що була з Teacher Dashboard спочатку — **потрібне рішення "Варіант A чи B" перед
кодуванням**, а не мовчазне вгадування:

- **Варіант A (реалізовно вже зараз):** Instructor dashboard повертає лише профіль інструктора й публічні дані
  школи — без жодної вигаданої "заглушки" на кшталт `upcomingLessons: []`, яка ніколи нічого не порахує, бо
  джерела даних нема.
- **Варіант B:** реальний розклад практичних занять (хто з студентів, коли, скільки) — вимагає нової
  Prisma-моделі `DrivingLesson` (1-до-1 інструктор↔студент, не групова). План для обох варіантів — нижче.

## Рішення: обрано Варіант B

Продукт хоче реальний розклад практичних занять, не лише профіль+організацію. Розділ "Дизайн (Варіант A)"
нижче лишається як задокументований fallback/довідка — **не для реалізації**. Імплементувати саме розділ
"Дизайн (Варіант B — реальний розклад практичних занять)" нижче, в такому порядку:

1. Додати `DrivingLessonStatus` enum і модель `DrivingLesson` в `schema.prisma` (плюс back-relations на
   `User`/`Organization`) — точний код у розділі "Нова Prisma-модель" нижче.
2. Згенерувати й застосувати міграцію: `npx prisma migrate dev --name add_driving_lessons`, потім
   `npx prisma generate` (той самий порядок дій, що й для `add_teaching_domain` раніше в цьому проєкті —
   не забути другий крок, `migrate dev` тут не завжди сам оновлює client, як уже траплялось).
3. Додати DTO (`InstructorDashboardProfileDto`, `InstructorDashboardLessonDto`, `InstructorDashboardStatsDto`,
   `InstructorDashboardDto`) в [dashboard.dto.ts](../src/modules/dashboard/dashboard.dto.ts) — код у розділі
   "DTO (Варіант B)" нижче. `organization` — перевикористати `AdminDashboardOrganizationDto`, як і в
   Teacher/Student, не дублювати.
4. Додати `DashboardService.getInstructorDashboard()` — код у розділі "Сервіс (Варіант B)" нижче.
5. Додати `GET /dashboard/instructor` у `DashboardController` з `@Roles(UserRole.INSTRUCTOR)` — сигнатура та
   сама, що вже описана в розділі "Контролер" (Варіант A) нижче, просто повертає розширений DTO.
6. Тести в `dashboard.service.spec.ts` — за списком у розділі "Тест-план" нижче, мокаючи
   `prisma.drivingLesson.findMany` (новий мок, за зразком уже наявних `prisma.group`/`prisma.lesson`/
   `prisma.enrollment` для Teacher/Student).

`dashboard.module.ts` не чіпати — так само, як для Teacher/Student, нові методи/ендпоінт на вже
зареєстрованих класах реєстрації не потребують.

## Дизайн (Варіант A — довідка/fallback, не для реалізації)

### DTO — додати в [dashboard.dto.ts](../src/modules/dashboard/dashboard.dto.ts)

```ts
export class InstructorDashboardProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Максим' })
  firstName: string;

  @ApiProperty({ example: 'Гриценко' })
  lastName: string;

  @ApiProperty({ example: 'instructor@example.com' })
  email: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;
}

export class InstructorDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: InstructorDashboardProfileDto })
  instructor: InstructorDashboardProfileDto;
}
```

### Сервіс

```ts
async getInstructorDashboard(instructor: User): Promise<InstructorDashboardDto> {
  const organization = await this.requireOrganization(instructor.organizationId);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      logoUrl: organization.logoUrl,
      timezone: organization.timezone,
    },
    instructor: {
      id: instructor.id,
      firstName: instructor.firstName,
      lastName: instructor.lastName,
      email: instructor.email,
      status: instructor.status,
    },
  };
}
```

### Контролер

```ts
@Get('instructor')
@Roles(UserRole.INSTRUCTOR)
@ApiOperation({
  summary: 'Дані Instructor Dashboard',
  description:
    'Публічні дані школи й власний профіль поточного INSTRUCTOR. Дані інших користувачів не повертаються.',
})
@ApiOkResponse({ type: InstructorDashboardDto })
@ApiForbiddenResponse({ description: 'Дані Instructor Dashboard доступні лише INSTRUCTOR.' })
@ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
getInstructorDashboard(@CurrentUser() user: User) {
  return this.dashboardService.getInstructorDashboard(user);
}
```

`dashboard.module.ts` — без змін, як і для Teacher/Student.

## Дизайн (Варіант B — реальний розклад практичних занять)

### Нова Prisma-модель

```prisma
enum DrivingLessonStatus {
  SCHEDULED
  COMPLETED
  CANCELLED
}

model DrivingLesson {
  id             String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId String              @map("organization_id") @db.Uuid
  organization   Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instructorId   String              @map("instructor_id") @db.Uuid
  instructor     User                @relation("InstructorDrivingLessons", fields: [instructorId], references: [id], onDelete: Cascade)
  studentId      String              @map("student_id") @db.Uuid
  student        User                @relation("StudentDrivingLessons", fields: [studentId], references: [id], onDelete: Cascade)
  scheduledAt    DateTime            @map("scheduled_at")
  durationMin    Int                 @default(60) @map("duration_min")
  status         DrivingLessonStatus @default(SCHEDULED)
  createdAt      DateTime            @default(now()) @map("created_at")

  @@index([organizationId])
  @@index([instructorId])
  @@index([studentId])
  @@index([scheduledAt])
  @@map("driving_lessons")
}
```

Back-relations: `Organization.drivingLessons DrivingLesson[]`;
`User.instructorDrivingLessons DrivingLesson[] @relation("InstructorDrivingLessons")` і
`User.studentDrivingLessons DrivingLesson[] @relation("StudentDrivingLessons")` (той самий студент може мати
і `enrollments` (теорія), і `studentDrivingLessons` (практика) одночасно — це очікувано, різні викладачі
різних предметів).

**Свідомо не змодельовано зараз:** автомобіль/локація заняття, історія перенесень. Додати окремим полем
(`vehicleId`?), коли з'явиться відповідна вимога, не "про запас".

Міграція: `npx prisma migrate dev --name add_driving_lessons`, потім `npx prisma generate`.

### DTO (Варіант B)

```ts
export class InstructorDashboardLessonDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  studentId: string;

  @ApiProperty({ example: 'Олена Петренко' })
  studentName: string;

  @ApiProperty()
  scheduledAt: Date;
}

export class InstructorDashboardStatsDto {
  @ApiProperty({
    description: 'Унікальні студенти з майбутніми заняттями цього INSTRUCTOR.',
    example: 8,
  })
  studentsTotal: number;

  @ApiProperty({ example: 5 })
  upcomingLessonsTotal: number;
}

export class InstructorDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: InstructorDashboardProfileDto })
  instructor: InstructorDashboardProfileDto;

  @ApiProperty({ type: InstructorDashboardStatsDto })
  stats: InstructorDashboardStatsDto;

  @ApiProperty({
    type: [InstructorDashboardLessonDto],
    description: 'Наступні 5 запланованих практичних занять, за зростанням дати.',
  })
  upcomingLessons: InstructorDashboardLessonDto[];
}
```

На відміну від Teacher/Student, тут ім'я конкретного студента (`studentName`) у списку занять — **не**
надлишкові дані іншої ролі: практичне заняття завжди 1-до-1, інструктору об'єктивно потрібно знати, з ким саме
наступне заняття. Це відрізняється від Teacher-дашборду, де імена **всіх** студентів групи навмисно не
показувались (там це була б зайва деталізація за межами "скільки студентів у групі").

### Сервіс (Варіант B)

```ts
async getInstructorDashboard(instructor: User): Promise<InstructorDashboardDto> {
  const organization = await this.requireOrganization(instructor.organizationId);
  const now = new Date();

  const [upcomingLessons, distinctStudents] = await Promise.all([
    this.prisma.drivingLesson.findMany({
      where: {
        instructorId: instructor.id,
        organizationId: instructor.organizationId,
        scheduledAt: { gte: now },
        status: DrivingLessonStatus.SCHEDULED,
      },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    }),
    this.prisma.drivingLesson.findMany({
      where: {
        instructorId: instructor.id,
        organizationId: instructor.organizationId,
        status: DrivingLessonStatus.SCHEDULED,
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
    instructor: {
      id: instructor.id,
      firstName: instructor.firstName,
      lastName: instructor.lastName,
      email: instructor.email,
      status: instructor.status,
    },
    stats: {
      studentsTotal: distinctStudents.length,
      upcomingLessonsTotal: upcomingLessons.length,
    },
    upcomingLessons: upcomingLessons.map((lesson) => ({
      id: lesson.id,
      studentId: lesson.studentId,
      studentName: `${lesson.student.firstName} ${lesson.student.lastName}`,
      scheduledAt: lesson.scheduledAt,
    })),
  };
}
```

Той самий подвійний фільтр `instructorId` + `organizationId`, і той самий `distinct(['studentId'])`-підхід
для `studentsTotal`, що вже застосований у Teacher Dashboard (один студент може мати кілька занять — рахувати
людей, не заняття).

### Найважливіше обмеження, як і для Teacher/Student

Це знову лише читання. Без способу створити `DrivingLesson` (CRUD для розкладу — окрема, більша фіча:
"Driving Lessons Scheduling", природний наступний крок після Teacher/Student/Instructor дашбордів, не їхня
частина) нова таблиця буде порожня, і дашборд коректно покаже нулі. Для локального тестування — розширити
`prisma/seed.ts` або вставити рядки напряму через SQL, як робилось для Teacher Dashboard.

## Покриття AC

- **"Instructor отримує необхідні dashboard data"** — Варіант A: профіль + школа. Варіант B: додатково
  найближчі практичні заняття з іменами студентів і кількість активних учнів.
- **"Дані відповідають його scope"** — усі запити (Варіант B) фільтруються і по `instructorId`, і по
  `organizationId`.
- **"Недоступні дані інших ролей не повертаються"** — заняття інших інструкторів тієї ж школи не потрапляють
  (фільтр по `instructorId`); жодних `users`/`invitations`-секцій.
- **"Обробляється відсутність даних"** — інструктор без запланованих занять отримує `upcomingLessons: []`,
  `stats: { studentsTotal: 0, upcomingLessonsTotal: 0 }` — `200`, не помилка.

## Тест-план (для обраного варіанту)

За зразком уже наявних тестів для Teacher/Student у `dashboard.service.spec.ts`:

**Варіант A:** повертає профіль + organization; `NotFoundException` на відсутній/видаленій organization.

**Варіант B**, додатково:
- інструктор без занять → нулі, порожні масиви;
- `studentsTotal` — `distinct`, не сума/довжина списку занять (той самий клас помилки, що й у Teacher: студент
  із двома майбутніми заняттями має рахуватись один раз);
- заняття іншого інструктора (та сама organization) → не потрапляє в `upcomingLessons` (перевірка аргументів
  `drivingLesson.findMany`);
- `CANCELLED`/`COMPLETED`/минулі заняття не потрапляють у `upcomingLessons`.

## Чек-лист для рев'ю

- [ ] Рішення "Варіант A чи B" зафіксовано явно, а не вгадано мовчки.
- [ ] (Варіант B) Нова модель `DrivingLesson` — **не** переплутана/об'єднана з `Group`/`Lesson` (це різні,
      незалежні концепції: групова теорія проти індивідуальної практики).
- [ ] (Варіант B) Обидва запити фільтрують і по `instructorId`, і по `organizationId`.
- [ ] (Варіант B) `studentsTotal` — `distinct(['studentId'])`, не довжина/сума списку занять.
- [ ] CRUD для `DrivingLesson` **не** додано в рамках цієї задачі — лише читання для дашборду.
- [ ] `@Roles(UserRole.INSTRUCTOR)` виставлено на новому ендпоінті.
- [ ] Нові тести присутні й проходять (`npm test`).
