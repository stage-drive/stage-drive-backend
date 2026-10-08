# Groups List (UF-27): план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md), перш ніж імплементувати або рев'ювати цю задачу. Це перший ендпоінт
нового модуля `groups`. Guard'и, декоратори й патерни ізоляції беремо з [dashboard](../src/modules/dashboard/) та
[invitations](../src/modules/invitations/).

## Задача

Реалізувати backend API для отримання списку навчальних груп відповідно до UF-27.

Acceptance Criteria:

1. реалізовано отримання списку навчальних груп;
2. ADMIN отримує групи своєї Organization;
3. дані інших Organization не повертаються;
4. реалізована перевірка Authentication + RBAC;
5. враховується role-based access;
6. API повертає коректну структуру даних групи;
7. API повертає коректні error responses;
8. реалізована organization isolation.

## Що вже є, а чого немає

- **Модель `Group` уже існує** (міграція `20260929191541_add_teaching_domain`): `id`, `name`, `status`
  (`GroupStatus`: `PLANNED | ACTIVE | COMPLETED | ARCHIVED`), `organizationId`, `teacherId`, `startDate?`,
  `endDate?`, `createdAt`, `updatedAt`, а також зв'язки `enrollments` і `lessons`. **Нова міграція не потрібна.**
- **Модуля чи ендпоінта для груп немає.** Зараз групи читає лише `DashboardService` (Teacher/Student), і там
  вибірка обмежена конкретним викладачем чи студентом. Для адміністративного списку це не підходить, тому
  потрібен окремий модуль.
- **Зв'язок студент↔група зберігається у двох місцях:** `Student.groupId` (профіль студента, міграція
  `add_student_profile`) і `Enrollment`. `studentsCount` рахує саме `Enrollment` зі статусом `ACTIVE`, бо
  `StudentsService` тримає їх синхронними: призначення в групу оновлює `Student.groupId` і робить upsert
  `Enrollment(ACTIVE)`; перехід в іншу групу переводить старе зарахування в `COMPLETED`; зміна training status
  переводить активне зарахування в `COMPLETED` або `DROPPED`. Рахувати за `Student.groupId` не можна, бо
  `groupId` ніколи не обнуляється: випускники (`GRADUATED`) і відраховані (`DROPPED`) лишаються прив'язаними
  до групи й потрапили б у лічильник.
- `AuthGuard`, `RolesGuard`, `@Roles()` і `@CurrentUser()` готові й експортуються з `AuthModule`.
  `PrismaModule` позначений `@Global()`.
- У проєкті поки немає жодного ендпоінта з пагінацією чи `@Query`-DTO, тож прецеденту для них немає.
- `prisma/seed.ts` не створює груп. Для ручної перевірки дані доведеться вставити вручну (див. нижче).

## Рішення, зафіксовані цим планом

1. **Доступ лише для `ADMIN`** (`@Roles(UserRole.ADMIN)`), буквально за AC. `TEACHER`, `INSTRUCTOR` і `STUDENT`
   отримують `403`. Свої групи вони вже бачать через `/dashboard/teacher` і `/dashboard/student`.
   - **Відкрите питання для продукту: чи має `OWNER` бачити цей список?** В AC його немає, тому зараз він
     отримує `403`. Для порівняння, `GET /invitations` дозволений і `OWNER`, і `ADMIN`. Якщо продукт
     підтвердить, достатньо замінити рядок на `@Roles(UserRole.OWNER, UserRole.ADMIN)`. Сервіс змінювати не
     треба, бо фільтр за `organizationId` однаковий для обох ролей.
2. **`organizationId` береться лише з `@CurrentUser()`**, тобто з користувача, якого `AuthGuard` завантажив
   за токеном. Ні query, ні body, ні path-параметрів з `organizationId` ендпоінт не приймає, тож підмінити
   організацію клієнт не може.
3. **Без пагінації та фільтрів.** AC їх не вимагають, а груп в одній автошколі десятки, не тисячі. Щоб
   додати їх пізніше без breaking change, відповідь одразу обгорнута в об'єкт `{ groups: [...] }` (як
   `InvitationListDto`), а не повертається голим масивом. Тоді `meta` або `nextCursor` можна буде додати
   поруч.
4. **Окремий модуль `src/modules/groups/`**, а не ще один ендпоінт у `dashboard`. Групи стануть окремим
   доменом із CRUD, `GET /groups/:id` і зарахуванням студентів, і всі ці ендпоінти житимуть тут.

## Ендпоінт

```
GET /api/groups
Authorization: Bearer <access token>
```

Відповідь `200`:

```json
{
  "groups": [
    {
      "id": "6f1c…",
      "name": "ПДР — Група А",
      "status": "ACTIVE",
      "startDate": "2026-10-01T00:00:00.000Z",
      "endDate": null,
      "teacher": { "id": "a3b2…", "firstName": "Ірина", "lastName": "Мельник" },
      "studentsCount": 12,
      "createdAt": "2026-09-29T19:20:00.000Z"
    }
  ]
}
```

- Сортування: `createdAt desc`, найновіші першими, як у `GET /invitations`.
- `studentsCount` рахує лише `Enrollment.status = ACTIVE`. `COMPLETED` і `DROPPED` не враховуються, так само
  як у Teacher Dashboard.
- `organizationId` і `teacherId` у відповідь не потрапляють. Перший клієнту й так відомий, другий
  дублює `teacher.id`.
- Якщо груп немає, повертається `200` і `{ "groups": [] }`. Це не помилка.

## Кроки реалізації

### 1. DTO: `src/modules/groups/groups.dto.ts`

```ts
import { ApiProperty } from '@nestjs/swagger';
import { GroupStatus } from '@prisma/client';

export class GroupTeacherDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Ірина' })
  firstName: string;

  @ApiProperty({ example: 'Мельник' })
  lastName: string;
}

export class GroupListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ПДР — Група А' })
  name: string;

  @ApiProperty({ enum: GroupStatus, example: GroupStatus.ACTIVE })
  status: GroupStatus;

  @ApiProperty({ type: Date, nullable: true })
  startDate: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  endDate: Date | null;

  @ApiProperty({ type: GroupTeacherDto })
  teacher: GroupTeacherDto;

  @ApiProperty({
    description: 'Кількість студентів з активним зарахуванням (Enrollment.status = ACTIVE).',
    example: 12,
  })
  studentsCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class GroupListDto {
  @ApiProperty({ type: [GroupListItemDto] })
  groups: GroupListItemDto[];
}
```

Вхідних DTO немає, бо ендпоінт не приймає ні body, ні query.

### 2. Сервіс: `src/modules/groups/groups.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GroupListDto } from './groups.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(admin: User): Promise<GroupListDto> {
    await this.requireOrganization(admin.organizationId);

    const groups = await this.prisma.group.findMany({
      where: { organizationId: admin.organizationId },
      include: {
        teacher: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        status: group.status,
        startDate: group.startDate,
        endDate: group.endDate,
        teacher: group.teacher,
        studentsCount: group._count.enrollments,
        createdAt: group.createdAt,
      })),
    };
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}
```

Важливі деталі:

- **`teacher` завжди вибирається через `select`, а не `include: { teacher: true }`.** Інакше у відповідь
  потрапить увесь рядок `User`, разом із `passwordHash`, `tokensInvalidBefore`, `email`, `phone` тощо.
- **Мапінг явний, без spread `...group`.** Так у відповідь не проходять `organizationId`, `teacherId` чи
  `updatedAt`, а якщо в модель `Group` згодом додадуть нове поле, воно не з'явиться у відповіді саме.
- `requireOrganization` повторює однойменний метод у `DashboardService`. `AuthGuard` перевіряє, що організація
  не `BLOCKED`, але не перевіряє `deletedAt`. Без цієї перевірки ADMIN soft-deleted школи бачив би її групи.
  Виносити метод у спільний helper у межах цієї задачі не треба: дві копії по 6 рядків цілком прийнятні.
  Якщо з'явиться третя, тоді й варто зробити рефакторинг.
- Якщо OWNER колись отримає доступ, параметр краще перейменувати на `actor`, як в `InvitationsService`.

### 3. Контролер: `src/modules/groups/groups.controller.ts`

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GroupListDto } from './groups.dto';
import { GroupsService } from './groups.service';

@ApiTags('groups')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('groups')
@UseGuards(AuthGuard, RolesGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Список навчальних груп своєї автошколи',
    description:
      'Усі групи організації поточного ADMIN: назва, статус, дати, викладач і кількість активних студентів. ' +
      'Групи інших організацій не повертаються. Якщо груп немає, повертається порожній масив.',
  })
  @ApiOkResponse({ type: GroupListDto })
  @ApiForbiddenResponse({ description: 'Список груп доступний лише ADMIN.' })
  @ApiNotFoundResponse({ description: 'Автошколу не знайдено або її видалено.' })
  list(@CurrentUser() user: User) {
    return this.groupsService.list(user);
  }
}
```

`@UseGuards(AuthGuard, RolesGuard)` стоїть на рівні класу, як у `DashboardController`, тож майбутні ендпоінти
модуля захищені за замовчуванням. Кожен новий метод мусить мати свій `@Roles(...)`. Без нього `RolesGuard`
пропустить будь-якого автентифікованого користувача (`if (!roles?.length) return true`).

### 4. Модуль: `src/modules/groups/groups.module.ts`

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [AuthModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
```

### 5. Реєстрація в `src/app.module.ts`

Додати `GroupsModule` у масив `imports` після `DashboardModule`.

### 6. Тести

Див. розділ «Тест-план» нижче.

## Error responses

Усі помилки повертаються у стандартному форматі NestJS `{ statusCode, message, error }`. Перевірки
виконуються в такому порядку:

| Ситуація | Де перевіряється | Статус | `message` |
|---|---|---|---|
| Немає заголовка `Authorization` | `AuthGuard` | 401 | `Missing access token` |
| Невалідний або прострочений JWT | `AuthGuard` | 401 | `Invalid access token` |
| Користувача з `sub` не існує | `AuthGuard` | 401 | `User not found` |
| Користувач не `ACTIVE`, soft-deleted або організація `BLOCKED` | `assertActiveUser` | 401 | `Обліковий запис заблоковано або неактивний.` |
| Токен виданий до `tokensInvalidBefore` (зміна пароля чи logout-all) | `AuthGuard` | 401 | `Access token revoked` |
| Роль не `ADMIN` | `RolesGuard` | 403 | `Insufficient permissions` |
| Організацію soft-deleted (`deletedAt` не `null`) | `GroupsService.requireOrganization` | 404 | `Organization not found` |
| Груп немає | не помилка | 200 | `{ "groups": [] }` |

Чого тут свідомо немає: `404` «група іншої організації». Ендпоінт не приймає `id`, тому чужі групи просто не
потрапляють у вибірку. `404` на чужий `id` стане актуальним для майбутнього `GET /groups/:id` (як
`findInvitationForActor` в invitations).

## Покриття AC

| AC | Як закрито |
|---|---|
| 1. Отримання списку груп | `GET /api/groups` → `GroupsService.list()` |
| 2. ADMIN отримує групи своєї Organization | `where: { organizationId: admin.organizationId }` |
| 3. Дані інших Organization не повертаються | той самий `where`; `organizationId` не приймається від клієнта |
| 4. Authentication + RBAC | `@UseGuards(AuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` |
| 5. Role-based access | `TEACHER`, `INSTRUCTOR`, `STUDENT` (і поки що `OWNER`) отримують `403` |
| 6. Коректна структура групи | `GroupListItemDto`: явний мапінг, `teacher` через `select`, `studentsCount` з `_count` |
| 7. Коректні error responses | таблиця вище; Swagger-декоратори `401`, `403`, `404` |
| 8. Organization isolation | фільтр у запиті + перевірка soft-deleted організації |

## Тест-план

### `src/modules/groups/groups.service.spec.ts` (unit, мок Prisma як у `dashboard.service.spec.ts`)

```ts
const prisma = {
  organization: { findUnique: jest.fn() },
  group: { findMany: jest.fn() },
};
const admin = { id: 'admin-1', role: UserRole.ADMIN, organizationId: 'org-1' };
service = new GroupsService(prisma as unknown as PrismaService);
```

Кейси:

1. **Ізоляція:** `group.findMany` викликається з `where: { organizationId: 'org-1' }` і ні з чим іншим у
   `where`.
2. **Порожній список:** `findMany` повертає `[]`, а сервіс повертає `{ groups: [] }` без помилки.
3. **Мапінг структури:** група з `_count: { enrollments: 3 }` і `teacher: { id, firstName, lastName }`
   перетворюється рівно на очікуваний об'єкт (`toEqual`), без `organizationId`, `teacherId` і `updatedAt`.
4. **Без витоку полів викладача:** `include.teacher` у виклику `findMany` дорівнює
   `{ select: { id: true, firstName: true, lastName: true } }`.
5. **Лише активні зарахування:** `include._count.select.enrollments.where` дорівнює
   `{ status: EnrollmentStatus.ACTIVE }`.
6. **Сортування:** `orderBy` дорівнює `{ createdAt: 'desc' }`.
7. **Soft-deleted або відсутня організація:** `organization.findUnique` повертає `null` або
   `{ …, deletedAt: new Date() }`. Очікуємо `NotFoundException`, а `group.findMany` **не** викликається.

### `src/modules/groups/groups.controller.spec.ts` (метадані RBAC)

Дешевий регресійний тест: він не дасть комусь випадково прибрати `@Roles` або guard'и.

```ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

it('restricts the list to ADMIN', () => {
  expect(new Reflector().get(ROLES_KEY, GroupsController.prototype.list)).toEqual([UserRole.ADMIN]);
});

it('applies AuthGuard and RolesGuard to the controller', () => {
  expect(Reflect.getMetadata(GUARDS_METADATA, GroupsController)).toEqual([AuthGuard, RolesGuard]);
});
```

### Рекомендовано: `src/modules/auth/roles.guard.spec.ts`

`AuthGuard` уже покритий тестами (`auth.guard.spec.ts`), а `RolesGuard` ні, хоча AC 4–5 спираються саме на
нього. Варто додати три кейси: немає `@Roles` → `true`; роль у списку → `true`; роль не в списку →
`ForbiddenException`.

### Ручна перевірка

У seed немає груп, тому їх треба вставити вручну. Потрібно дві організації, у кожній по ADMIN і TEACHER.
`updated_at` не має DB-default, тому його треба передати явно:

```sql
INSERT INTO groups (name, status, organization_id, teacher_id, updated_at)
VALUES ('ПДР — Група А', 'ACTIVE', '<org-A-id>', '<teacher-A-id>', now()),
       ('ПДР — Група Б', 'PLANNED', '<org-B-id>', '<teacher-B-id>', now());
```

```bash
curl -s http://localhost:3000/api/groups -H "Authorization: Bearer $ADMIN_A_TOKEN"
# очікуємо 200 і лише «Група А»
curl -s http://localhost:3000/api/groups -H "Authorization: Bearer $TEACHER_A_TOKEN"
# очікуємо 403
curl -s http://localhost:3000/api/groups
# очікуємо 401
curl -s "http://localhost:3000/api/groups?organizationId=<org-B-id>" -H "Authorization: Bearer $ADMIN_A_TOKEN"
# очікуємо 200 і все одно лише «Група А»: query-параметр ігнорується
```

Також перевірити схему відповіді у Swagger: розділ `groups`.

## Поза скоупом цієї задачі

- Пагінація, пошук, фільтр за `status` або `teacherId`. Відповідь розширюється без breaking change (див.
  «Рішення», п. 3).
- `GET /groups/:id`, створення, редагування й архівування груп, зарахування студентів.
- Доступ для `OWNER`: чекає рішення продукту (див. «Рішення», п. 1).
- Перевірка `organization.deletedAt` всередині `AuthGuard`. Це глобальна прогалина, але її виправлення
  зачепить усі модулі, тож це окрема задача.
- Розширення `prisma/seed.ts` групами.

## Чек-лист для рев'ю

- [ ] Нова Prisma-міграція **не** додана, бо модель `Group` уже існує.
- [ ] `organizationId` береться лише з `@CurrentUser()`. У контролері немає `@Query`, `@Param` чи `@Body` з
      `organizationId`.
- [ ] `teacher` вибирається через `select` (`id`, `firstName`, `lastName`), без `include: { teacher: true }`.
- [ ] Відповідь будується явним мапінгом без `...group`.
- [ ] `studentsCount` рахує лише `EnrollmentStatus.ACTIVE`.
- [ ] `@Roles(UserRole.ADMIN)` стоїть на методі, `@UseGuards(AuthGuard, RolesGuard)` на класі.
- [ ] Soft-deleted організація дає `404`, а `group.findMany` при цьому не викликається.
- [ ] `GroupsModule` імпортує `AuthModule` і зареєстрований в `AppModule`.
- [ ] Swagger: `@ApiTags('groups')`, `@ApiBearerAuth()`, описані `200`, `401`, `403`, `404`.
- [ ] Рішення щодо доступу `OWNER` зафіксоване (або явно відкладене).
- [ ] Нові тести присутні й проходять (`npm test`), `npm run lint` і `npm run build` чисті.
