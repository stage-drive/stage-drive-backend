# Student Dashboard — план реалізації

Читати після [CLAUDE.md](../CLAUDE.md) і [teacher-dashboard-implementation.md](teacher-dashboard-implementation.md)
перед тим, як імплементувати або рев'ювати цю задачу. Той самий модуль [dashboard](../src/modules/dashboard/),
той самий контролер, новий ендпоінт за аналогією.

## На відміну від Teacher Dashboard — нова Prisma-схема тут не потрібна

Для Teacher Dashboard довелось спочатку додавати `Group`/`Enrollment`/`Lesson` в `schema.prisma` (домену
курсів не існувало). Ці моделі вже є в базі (міграція `20260929191541_add_teaching_domain` застосована), і
`Enrollment` — це рівно те, що потрібно для Student: зв'язок `studentId` ↔ `groupId`. **Нової міграції для
цієї задачі не треба**, лише читання вже існуючих таблиць з іншим фільтром (`studentId` замість `teacherId`).

## Scope Student — з чого він складається

- **Групи, в яких студент реально навчається** — `Enrollment.status = ACTIVE` для цього `studentId`, а не всі
  групи школи.
- **Найближчі заняття** — `Lesson`, що належать саме цим групам (через `group.enrollments.some({ studentId })`),
  а не всі заняття школи.
- **Хто веде групу** — ім'я `TEACHER` цієї конкретної групи. Це не "дані іншої ролі" в сенсі AC (студент і так
  бачить свого викладача на занятті) — це необхідна частина його ж scope, а не стороння інформація.

**Свідомо не включати** (за тим самим принципом мінімізації даних, що вже застосований у Teacher Dashboard,
де немає імен окремих студентів): **інших студентів тієї ж групи**. AC "Недоступні дані інших ролей не
повертаються" буквально про ролі OWNER/ADMIN/TEACHER/INSTRUCTOR, а не про одногрупників-STUDENT — але показ
персональних даних інших конкретних людей (навіть тієї самої ролі) без явного запиту продукту — це рішення,
яке краще підтвердити, а не вгадати. Якщо потрібне лише число ("у групі 12 студентів") — це дешево додати
пізніше; імена одногрупників у цьому плані свідомо не включені.

## Дизайн

### DTO — додати в [dashboard.dto.ts](../src/modules/dashboard/dashboard.dto.ts)

```ts
export class StudentDashboardProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Петренко' })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;
}

export class StudentDashboardGroupDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ example: 'Ганна Коваль' })
  teacherName: string;
}

export class StudentDashboardLessonDto {
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

export class StudentDashboardStatsDto {
  @ApiProperty({ example: 2 })
  groupsTotal: number;

  @ApiProperty({ example: 3 })
  upcomingLessonsTotal: number;
}

export class StudentDashboardDto {
  @ApiProperty({ type: AdminDashboardOrganizationDto })
  organization: AdminDashboardOrganizationDto;

  @ApiProperty({ type: StudentDashboardProfileDto })
  student: StudentDashboardProfileDto;

  @ApiProperty({ type: StudentDashboardStatsDto })
  stats: StudentDashboardStatsDto;

  @ApiProperty({ type: [StudentDashboardGroupDto] })
  groups: StudentDashboardGroupDto[];

  @ApiProperty({
    type: [StudentDashboardLessonDto],
    description: 'Наступні 5 запланованих занять студента, за зростанням дати.',
  })
  upcomingLessons: StudentDashboardLessonDto[];
}
```

`organization` — перевикористати `AdminDashboardOrganizationDto`, як і в Teacher Dashboard (та сама публічна
підмножина полів, без `status`).

### Сервіс — `DashboardService.getStudentDashboard(student: User)`

```ts
async getStudentDashboard(student: User): Promise<StudentDashboardDto> {
  const organization = await this.requireOrganization(student.organizationId);
  const now = new Date();

  const [enrollments, upcomingLessons] = await Promise.all([
    this.prisma.enrollment.findMany({
      where: {
        studentId: student.id,
        status: EnrollmentStatus.ACTIVE,
        group: { organizationId: student.organizationId },
      },
      include: {
        group: {
          include: {
            teacher: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    this.prisma.lesson.findMany({
      where: {
        group: {
          organizationId: student.organizationId,
          enrollments: {
            some: { studentId: student.id, status: EnrollmentStatus.ACTIVE },
          },
        },
        scheduledAt: { gte: now },
        status: LessonStatus.SCHEDULED,
      },
      include: { group: { select: { name: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    }),
  ]);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      logoUrl: organization.logoUrl,
      timezone: organization.timezone,
    },
    student: {
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      email: student.email,
      status: student.status,
    },
    stats: {
      groupsTotal: enrollments.length,
      upcomingLessonsTotal: upcomingLessons.length,
    },
    groups: enrollments.map((enrollment) => ({
      id: enrollment.group.id,
      name: enrollment.group.name,
      status: enrollment.group.status,
      teacherName: `${enrollment.group.teacher.firstName} ${enrollment.group.teacher.lastName}`,
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

**Чому `group: { organizationId: student.organizationId }` дублюється в обох запитах, хоча `studentId` уже
унікально визначає студента:** той самий принцип подвійної ізоляції, що й у Teacher Dashboard — якщо колись
`studentId` зіставиться не з тим записом (баг, помилка тестових даних), `organizationId`-фільтр не дасть
показати дані чужої школи. Дешевий страховий пояс, вартий одного зайвого умовного рядка в `where`.

**Чому `upcomingLessons` шукається через `group.enrollments.some(...)`, а не через список `enrollments` із
першого запиту:** обидва підходи дають однаковий результат, але окремий Prisma-запит із власним `take: 5` і
`orderBy` простіший, ніж вручну збирати заняття з усіх груп студента і сортувати/обрізати в JS. Той самий
патерн, що вже використаний у Teacher Dashboard.

### Контролер — новий `GET /dashboard/student`

```ts
@Get('student')
@Roles(UserRole.STUDENT)
@ApiOperation({
  summary: 'Дані Student Dashboard',
  description:
    'Групи, в яких студент активно навчається, викладач кожної групи, найближчі заняття. ' +
    'Дані інших студентів, груп чи занять, до яких студент не має стосунку, не повертаються.',
})
@ApiOkResponse({ type: StudentDashboardDto })
@ApiForbiddenResponse({ description: 'Дані Student Dashboard доступні лише STUDENT.' })
@ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
getStudentDashboard(@CurrentUser() user: User) {
  return this.dashboardService.getStudentDashboard(user);
}
```

`@UseGuards(AuthGuard, RolesGuard)` вже на рівні контролера — успадковується автоматично. Зміни в
`dashboard.module.ts` не потрібні (те саме, що й для Teacher).

## Покриття AC

- **"Student отримує необхідні dashboard data"** — активні групи з ім'ям викладача, найближчі заняття.
- **"Дані відповідають його scope"** — фільтр по `studentId: student.id` у першому запиті й
  `enrollments.some({ studentId: student.id })` у другому; подвійно підкріплено `organizationId`.
- **"Недоступні дані інших ролей не повертаються"** — жодних `users`/`invitations`-секцій, жодних імен інших
  студентів, жодних груп/занять, до яких студент не записаний (навіть у межах тієї самої школи).
- **"Обробляється відсутність даних"** — студент без активних enrollments отримує `groups: []`,
  `upcomingLessons: []`, `stats: { groupsTotal: 0, upcomingLessonsTotal: 0 }` — `200`, не помилка.

## Тест-план

`dashboard.service.spec.ts`, мок `prisma.enrollment.findMany`/`prisma.lesson.findMany` (ті самі моки, що вже
додані для Teacher, `prisma.group` тут не викликається напряму — лише через `include`):

- студент без активних enrollments → нулі, порожні масиви, без винятків;
- студент з групою → `teacherName` збирається з `firstName + lastName` включеного `teacher`;
- перевірити аргументи виклику `enrollment.findMany` — `where` містить `status: EnrollmentStatus.ACTIVE`
  (сам фільтр не спрацює в тесті з мокованим Prisma, бо мок не виконує `where` сам — перевіряється саме
  наявність умови в аргументах запиту, як і в тестах Teacher Dashboard);
- заняття групи, в якій студент **не** записаний (та сама школа) → не потрапляє в `upcomingLessons` —
  перевірити через аргументи `lesson.findMany` (`enrollments: { some: { studentId } }` присутній у `where`);
- organization не знайдено/видалена → `NotFoundException` (як і в Owner/Admin/Teacher).

## Чек-лист для рев'ю

- [ ] Обидва запити (`enrollment.findMany`, `lesson.findMany`) фільтрують і по `studentId`, і по
      `organizationId` — подвійна ізоляція, як і в Teacher Dashboard.
- [ ] `enrollment.findMany` фільтрує `status: ACTIVE` — завершені/відраховані (`COMPLETED`/`DROPPED`)
      enrollments не потрапляють у "мої групи".
- [ ] Відповідь **не містить** імен/ідентифікаторів інших студентів тієї ж групи.
- [ ] Жодних нових Prisma-моделей чи міграцій не додано — задача суто на читання вже існуючої схеми.
- [ ] `@Roles(UserRole.STUDENT)` виставлено на новому ендпоінті.
- [ ] Нові тести з розділу вище присутні й проходять (`npm test`).
