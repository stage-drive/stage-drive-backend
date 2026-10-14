# Groups Create & Update (UF-28): план реалізації

Прочитайте [CLAUDE.md](../CLAUDE.md) і [groups-list-implementation.md](groups-list-implementation.md), перш ніж
імплементувати або рев'ювати цю задачу. Модуль `groups` уже існує (UF-27), тут до нього додаються два ендпоінти
запису. Патерни create/update (транзакція, перевірка пов'язаного користувача, `fieldError`, `409` з полем) беремо з
[cars.service.ts](../src/modules/cars/cars.service.ts): це найближчий прецедент.

## Задача

Реалізувати backend для створення та редагування навчальної групи відповідно до UF-28.

Acceptance Criteria:

1. реалізовано створення навчальної групи;
2. реалізовано редагування навчальної групи;
3. група створюється в поточній Organization;
4. перевіряється Authentication + RBAC;
5. неможливо створити/редагувати групу іншої Organization;
6. реалізована валідація даних;
7. обробляються некоректні дані;
8. API повертає коректні success/error responses.

## Що вже є, а чого немає

- **Модель `Group` не змінюється, міграція не потрібна.** Поля: `name` (`VarChar(120)`), `status` (`GroupStatus`,
  default `PLANNED`), `organizationId`, `teacherId` (обов'язковий), `startDate?`, `endDate?`. Унікальних індексів,
  крім `id`, немає.
- `GroupsModule` зареєстрований в `AppModule` та імпортує `AuthModule`. `GroupsController` має
  `@UseGuards(AuthGuard, RolesGuard)` на рівні класу. Зараз є лише `GET /groups` з `@Roles(UserRole.ADMIN)`.
- `GroupsService` має `list()` і `requireOrganization()`. Мапінг у `GroupListItemDto` зараз написаний прямо всередині
  `list()`. Його треба винести в окрему функцію, щоб create і update повертали ту саму структуру.
- Глобальний `ValidationPipe` ([configure-app.ts](../src/configure-app.ts)) має `whitelist`, `forbidNonWhitelisted`,
  `transform` і `stopAtFirstError`. Помилки форматує `validationExceptionFactory` у
  `{ statusCode: 400, errors: [{ field, message }] }`. **Будь-яке зайве поле в тілі, зокрема `organizationId` чи
  `status`, дає `400`.**
- **Статус групи впливає на студентів.** `StudentsService` вважає групу відкритою, якщо її статус `PLANNED` або
  `ACTIVE` (`isOpenGroup`, [students.service.ts:312](../src/modules/students/students.service.ts#L312)). Зарахувати
  студента можна лише у відкриту групу, і студент не може бути у двох відкритих групах одночасно. З цього випливають
  рішення 3 і 4 нижче.
- У проєкті ще немає жодного вхідного DTO з датою. Формат дат цей план фіксує вперше.
- `@IsPlainText()` ([plain-text.decorator.ts](../src/common/validators/plain-text.decorator.ts)) уже використовується
  для назв, наприклад в `UpdateOrganizationDto.name`.

## Рішення, зафіксовані цим планом

1. **Доступ лише для `ADMIN`**, як і для списку груп. Ролі виносяться в константу
   `GROUP_MANAGE_ROLES = [UserRole.ADMIN] as const` у `groups.service.ts`. Її використовують усі три ендпоінти
   (`list`, `create`, `update`) і сервісна перевірка `assertCanManageGroups`. Відкрите питання про `OWNER` з UF-27
   досі не вирішене. Коли продукт його закриє, достатньо додати `UserRole.OWNER` у цю константу.
2. **`organizationId` береться лише з `@CurrentUser()`.** У DTO його немає, тож якщо клієнт його передасть,
   `forbidNonWhitelisted` поверне `400`. Редагування шукає групу за `{ id, organizationId: actor.organizationId }`,
   тому група іншої автошколи дає `404 Group not found`, а не `403`. Так клієнт не дізнається, що такий `id` існує
   (так само як `Car not found` у cars).
3. **Статус не приймається ні при створенні, ні при редагуванні.** Нова група завжди `PLANNED`. Статус змінює
   окремий ендпоінт `PATCH /groups/:id/status` з таблицею переходів (як `PATCH /cars/:id/status`), бо зміна статусу
   зачіпає зарахування:
   - закриття групи (`→ COMPLETED` або `→ ARCHIVED`) переводить `ACTIVE`-зарахування в `COMPLETED`;
   - повторне відкриття (`COMPLETED → ACTIVE`) могло б поставити студента у дві відкриті групи одночасно, а це ламає
     інваріант `STUDENT_ACTIVE_GROUP_MESSAGE`. Тому переходи йдуть лише вперед.

   Деталі див. у розділі [`PATCH /api/groups/:id/status`](#patch-apigroupsidstatus).
4. **Закриту групу (`COMPLETED` або `ARCHIVED`) редагувати не можна, відповідь `409`.** Це історичний запис: зміна
   викладача прибрала б групу з дашборду викладача, який її реально вів. Через API така група поки не з'явиться
   (див. п. 3), але вона може бути в seed або в даних, внесених вручну. Якщо продукт захоче дозволити хоча б
   перейменування, достатньо прибрати цю перевірку.
5. **Викладач (`teacherId`)** має бути користувачем тієї самої організації з `role = TEACHER`, `status = ACTIVE` і
   `deletedAt = null`. Перевірка повторює `requireInstructor` з cars. Якщо користувача не знайдено, його видалено або
   він з іншої організації, повертається `404 Teacher not found`. Якщо роль не та або статус не `ACTIVE`,
   повертається `409`. **Під час редагування перевірка виконується лише тоді, коли `teacherId` змінюється.** Інакше
   перейменування групи, викладача якої заблокували, впало б з `409`.
6. **Назва.** Пробіли по краях обрізаються, довжина від 1 до 120 символів (ліміт колонки), символи `<` і `>`
   заборонені (`@IsPlainText`). **Назва унікальна без урахування регістру серед відкритих груп організації**, інакше
   повертається `409` з `errors: [{ field: 'name', … }]`. Закриті групи не враховуються, бо автошколи щороку
   використовують ті самі назви на кшталт «Група Б-1». Перевірка робиться в коді всередині транзакції, без міграції.
   Регістронезалежний частковий індекс потребував би raw-SQL міграції, а гонка двох адмінів, які одночасно
   створюють групу з однаковою назвою, на практиці малоймовірна.
7. **Дати.** `startDate` і `endDate` необов'язкові, формат лише `YYYY-MM-DD` (саме це значення дає
   `<input type="date">`). У БД пишеться північ UTC (`2026-11-01T00:00:00.000Z`), а у відповіді дата повертається в
   тому самому ISO-форматі, що й у `GET /groups`. `endDate` не може бути раніше `startDate`, однакові дати дозволені.
   Обмеження «дата початку не в минулому» немає, бо адмін може вносити групу, яка вже йде. У `PATCH` значення `null`
   очищає дату.
8. **Відповідь обох ендпоінтів має тип `GroupListItemDto`**, тобто це той самий об'єкт, що й елемент `GET /groups`.
   Фронтенд може вставити або замінити рядок у списку без повторного запиту.
9. **`PATCH` оновлює групу частково.** Порожнє тіло дає `400` з `field: 'body'`. Якщо передані значення збігаються з
   поточними, запис у БД не виконується, і повертається `200` з поточною групою (так само як у cars).

## Ендпоінти

### `POST /api/groups`

```
POST /api/groups
Authorization: Bearer <access token>
Content-Type: application/json

{
  "name": "ПДР — Група А",
  "teacherId": "a3b2c1d0-…",
  "startDate": "2026-11-01",
  "endDate": "2027-01-31"
}
```

Обов'язкові поля: `name` і `teacherId`. Відповідь `201`:

```json
{
  "id": "6f1c…",
  "name": "ПДР — Група А",
  "status": "PLANNED",
  "startDate": "2026-11-01T00:00:00.000Z",
  "endDate": "2027-01-31T00:00:00.000Z",
  "teacher": { "id": "a3b2…", "firstName": "Ірина", "lastName": "Мельник" },
  "studentsCount": 0,
  "createdAt": "2026-10-13T10:00:00.000Z"
}
```

### `PATCH /api/groups/:id`

```
PATCH /api/groups/6f1c…
Authorization: Bearer <access token>
Content-Type: application/json

{ "name": "ПДР — Група А (вечірня)", "endDate": null }
```

Усі поля (`name`, `teacherId`, `startDate`, `endDate`) необов'язкові, але хоча б одне має бути передане. Відповідь
`200` має той самий формат `GroupListItemDto`.

### `PATCH /api/groups/:id/status`

```
PATCH /api/groups/6f1c…/status
Authorization: Bearer <access token>
Content-Type: application/json

{ "status": "COMPLETED" }
```

Відповідь `200` має формат `GroupListItemDto` зі збереженим статусом. Доступ має лише `ADMIN` (`GROUP_MANAGE_ROLES`).

Дозволені переходи (`GROUP_STATUS_TRANSITIONS` у сервісі):

| З | У |
|---|---|
| `PLANNED` | `ACTIVE`, `ARCHIVED` |
| `ACTIVE` | `COMPLETED`, `ARCHIVED` |
| `COMPLETED` | `ARCHIVED` |
| `ARCHIVED` | — |

- **Повтор того самого статусу, будь-який перехід назад і будь-який перехід з `ARCHIVED` дають `409`** з
  повідомленням `Недозволений перехід статусу групи. FROM → TO.` (як у cars).
- `PLANNED → COMPLETED` заборонено: групу, яка не почалась, не можна завершити. Скасувати її можна через `ARCHIVED`.
- **Перехід у `COMPLETED` або `ARCHIVED` в тій самій транзакції переводить усі `ACTIVE`-зарахування групи в
  `COMPLETED`.** Саме `COMPLETED`, а не `DROPPED`: `StudentsService.assignGroup` відхиляє студента з будь-яким
  `DROPPED`-зарахуванням в організації, тож `DROPPED` назавжди заблокував би студентам перехід в іншу групу. Після
  закриття групи `studentsCount` дорівнює `0`, група зникає зі Student Dashboard, а студента можна зарахувати в нову
  групу.
- `Student.groupId` не обнуляється, як і раніше (див. UF-27).
- Унікальність назви при зміні статусу повторно не перевіряється: переходів, що відкривають групу, немає.

## Кроки реалізації

### 1. DTO: `src/modules/groups/groups.dto.ts`

Вихідні `GroupTeacherDto`, `GroupListItemDto` і `GroupListDto` не змінюються. Додати вхідні DTO:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';

export const GROUP_NAME_MAX_LENGTH = 120;
export const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
export const GROUP_NAME_LENGTH_MESSAGE = `Назва має містити не більше ${GROUP_NAME_MAX_LENGTH} символів.`;
export const DATE_FORMAT_MESSAGE = 'Дата має бути у форматі YYYY-MM-DD.';
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateGroupDto {
  @ApiProperty({
    example: 'ПДР — Група А',
    maxLength: GROUP_NAME_MAX_LENGTH,
    description:
      'Пробіли по краях обрізаються. Унікальна серед відкритих груп автошколи без урахування регістру.',
  })
  @Transform(trimString)
  @IsPlainText()
  @MaxLength(GROUP_NAME_MAX_LENGTH, { message: GROUP_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  name: string;

  @ApiProperty({
    format: 'uuid',
    example: 'a3b2c1d0-0000-4000-8000-000000000000',
    description: 'Викладач тієї самої автошколи з роллю TEACHER і статусом ACTIVE.',
  })
  @IsUUID('4', { message: 'teacherId має бути UUID.' })
  @IsDefined({ message: REQUIRED_FIELD_MESSAGE })
  teacherId: string;

  @ApiPropertyOptional({ format: 'date', example: '2026-11-01' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  startDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2027-01-31',
    description: 'Не раніше startDate.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  endDate?: string;
}

export class UpdateGroupDto {
  @ApiPropertyOptional({
    example: 'ПДР — Група А (вечірня)',
    maxLength: GROUP_NAME_MAX_LENGTH,
  })
  @Transform(trimString)
  @ValidateIf((_, value) => value !== undefined)
  @IsPlainText()
  @MaxLength(GROUP_NAME_MAX_LENGTH, { message: GROUP_NAME_LENGTH_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsString({ message: 'name має бути рядком.' })
  name?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Новий викладач: TEACHER зі статусом ACTIVE тієї самої автошколи.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID('4', { message: 'teacherId має бути UUID.' })
  teacherId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-11-01',
    description: 'null очищає дату.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  startDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-01-31',
    description: 'Не раніше startDate. null очищає дату.',
  })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true }, { message: DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: DATE_FORMAT_MESSAGE })
  endDate?: string | null;
}
```

Важливі деталі:

- **Порядок декораторів має значення.** class-validator виконує їх знизу вгору, а через `stopAtFirstError` клієнт
  отримує лише першу помилку. Тому `@IsDefined` і `@IsString` стоять найнижче, як у `CreateCarDto`. Для порожнього
  рядка клієнт отримає «Заповніть обов'язкове поле.», а не повідомлення про довжину.
- **Для дат потрібні обидва декоратори.** `@Matches` відсікає час і часову зону (`2026-11-01T10:00:00Z` без нього
  пройшов би). `@IsISO8601({ strict: true })` відсікає неіснуючі дати на кшталт `2026-02-30`, які регулярний вираз
  пропустив би. Обидва повертають одне повідомлення, тож клієнту неважливо, який із них спрацював.
- **`null` у `UpdateGroupDto`.** Для `name` і `teacherId` `ValidateIf` пропускає `null` далі на валідацію, тож
  `{ "name": null }` дає `400`. Для дат `null` валідацію пропускає, бо це означає «очистити дату».
- `{}` проходить ValidationPipe без помилки. Порожнє тіло ловить сервіс, бо це бізнес-правило, а не формат.
- `endDate >= startDate` перевіряється в сервісі, а не в DTO. Для `PATCH` порівнювати треба з поточними значеннями
  групи, а DTO їх не знає.

### 2. Сервіс: `src/modules/groups/groups.service.ts`

Спільні константи, include і функції на рівні модуля:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EnrollmentStatus,
  GroupStatus,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGroupDto,
  GroupListDto,
  GroupListItemDto,
  UpdateGroupDto,
} from './groups.dto';

export const GROUP_MANAGE_ROLES = [UserRole.ADMIN] as const;

export const GROUP_NOT_FOUND_MESSAGE = 'Group not found';
export const TEACHER_NOT_FOUND_MESSAGE = 'Teacher not found';
export const TEACHER_ROLE_MESSAGE = 'Користувач не має ролі TEACHER.';
export const TEACHER_NOT_ACTIVE_MESSAGE = 'Викладач має бути в статусі ACTIVE.';
export const GROUP_NAME_TAKEN_MESSAGE =
  'Відкрита група з такою назвою вже є в цій автошколі.';
export const GROUP_DATE_RANGE_MESSAGE =
  'Дата завершення не може бути раніше дати початку.';
export const GROUP_CLOSED_MESSAGE =
  'Групу зі статусом COMPLETED або ARCHIVED не можна редагувати.';
export const NO_GROUP_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (name, teacherId, startDate, endDate).';

const OPEN_GROUP_STATUSES: GroupStatus[] = [
  GroupStatus.PLANNED,
  GroupStatus.ACTIVE,
];

const groupListInclude = {
  teacher: { select: { id: true, firstName: true, lastName: true } },
  _count: {
    select: { enrollments: { where: { status: EnrollmentStatus.ACTIVE } } },
  },
} satisfies Prisma.GroupInclude;

type GroupListRow = Prisma.GroupGetPayload<{ include: typeof groupListInclude }>;

function assertCanManageGroups(actor: User): void {
  if (!(GROUP_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function assertDateRange(startDate: Date | null, endDate: Date | null): void {
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    throw fieldError('endDate', GROUP_DATE_RANGE_MESSAGE);
  }
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function toGroupListItem(group: GroupListRow): GroupListItemDto {
  return {
    id: group.id,
    name: group.name,
    status: group.status,
    startDate: group.startDate,
    endDate: group.endDate,
    teacher: group.teacher,
    studentsCount: group._count.enrollments,
    createdAt: group.createdAt,
  };
}
```

`list()` змінюється лише так, щоб використовувати `groupListInclude` і `toGroupListItem`. Поведінка та наявні тести
лишаються тими самими:

```ts
const groups = await this.prisma.group.findMany({
  where: { organizationId: admin.organizationId },
  include: groupListInclude,
  orderBy: { createdAt: 'desc' },
});
return { groups: groups.map(toGroupListItem) };
```

У клас додати `private readonly logger = new Logger(GroupsService.name);` і методи:

```ts
async create(actor: User, payload: CreateGroupDto): Promise<GroupListItemDto> {
  assertCanManageGroups(actor);
  await this.requireOrganization(actor.organizationId);

  const startDate = toDate(payload.startDate ?? null);
  const endDate = toDate(payload.endDate ?? null);
  assertDateRange(startDate, endDate);

  const created = await this.prisma.$transaction(async (tx) => {
    await this.requireTeacher(tx, actor.organizationId, payload.teacherId);
    await this.assertNameAvailable(tx, actor.organizationId, payload.name);
    return tx.group.create({
      data: {
        organizationId: actor.organizationId,
        name: payload.name,
        teacherId: payload.teacherId,
        startDate,
        endDate,
        status: GroupStatus.PLANNED,
      },
      include: groupListInclude,
    });
  });

  this.logger.log(
    `Group created groupId=${created.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
  );
  return toGroupListItem(created);
}

async update(
  actor: User,
  groupId: string,
  payload: UpdateGroupDto,
): Promise<GroupListItemDto> {
  assertCanManageGroups(actor);
  await this.requireOrganization(actor.organizationId);
  if (
    payload.name === undefined &&
    payload.teacherId === undefined &&
    payload.startDate === undefined &&
    payload.endDate === undefined
  ) {
    throw fieldError('body', NO_GROUP_FIELDS_MESSAGE);
  }

  const updated = await this.prisma.$transaction(async (tx) => {
    const existing = await tx.group.findFirst({
      where: { id: groupId, organizationId: actor.organizationId },
      include: groupListInclude,
    });
    if (!existing) {
      throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
    }
    if (!OPEN_GROUP_STATUSES.includes(existing.status)) {
      throw new ConflictException(GROUP_CLOSED_MESSAGE);
    }

    const startDate =
      payload.startDate === undefined
        ? existing.startDate
        : toDate(payload.startDate);
    const endDate =
      payload.endDate === undefined ? existing.endDate : toDate(payload.endDate);
    assertDateRange(startDate, endDate);

    const data: Prisma.GroupUncheckedUpdateInput = {};
    if (payload.name !== undefined && payload.name !== existing.name) {
      await this.assertNameAvailable(
        tx,
        actor.organizationId,
        payload.name,
        existing.id,
      );
      data.name = payload.name;
    }
    if (
      payload.teacherId !== undefined &&
      payload.teacherId !== existing.teacherId
    ) {
      await this.requireTeacher(tx, actor.organizationId, payload.teacherId);
      data.teacherId = payload.teacherId;
    }
    if (!sameDate(startDate, existing.startDate)) {
      data.startDate = startDate;
    }
    if (!sameDate(endDate, existing.endDate)) {
      data.endDate = endDate;
    }

    if (Object.keys(data).length === 0) {
      return existing;
    }
    return tx.group.update({
      where: { id: existing.id },
      data,
      include: groupListInclude,
    });
  });

  this.logger.log(
    `Group updated groupId=${updated.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
  );
  return toGroupListItem(updated);
}

private async requireTeacher(
  tx: Prisma.TransactionClient,
  organizationId: string,
  teacherId: string,
) {
  const teacher = await tx.user.findUnique({
    where: { id: teacherId },
    select: { organizationId: true, role: true, status: true, deletedAt: true },
  });
  if (
    !teacher ||
    teacher.deletedAt ||
    teacher.organizationId !== organizationId
  ) {
    throw new NotFoundException(TEACHER_NOT_FOUND_MESSAGE);
  }
  if (teacher.role !== UserRole.TEACHER) {
    throw new ConflictException(TEACHER_ROLE_MESSAGE);
  }
  if (teacher.status !== UserStatus.ACTIVE) {
    throw new ConflictException(TEACHER_NOT_ACTIVE_MESSAGE);
  }
}

private async assertNameAvailable(
  tx: Prisma.TransactionClient,
  organizationId: string,
  name: string,
  excludeGroupId?: string,
) {
  const duplicate = await tx.group.findFirst({
    where: {
      organizationId,
      status: { in: OPEN_GROUP_STATUSES },
      name: { equals: name, mode: 'insensitive' },
      ...(excludeGroupId ? { NOT: { id: excludeGroupId } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictException({
      statusCode: 409,
      errors: [{ field: 'name', message: GROUP_NAME_TAKEN_MESSAGE }],
    });
  }
}
```

Важливі деталі:

- **Ізоляція організації живе в самому запиті.** `organizationId` у `create` береться з `actor`. В `update` група
  шукається через `findFirst({ where: { id, organizationId } })`, а не через `findUnique` з порівнянням після
  запиту, тож чужа група просто не знаходиться. Викладач перевіряється на ту саму організацію в `requireTeacher`.
- **`assertCanManageGroups` дублює `@Roles` навмисно**, як `assertCanWriteCars` у cars. Сервіс лишається захищеним,
  навіть якщо його викличуть не з контролера.
- **`requireOrganization` викликається до транзакції.** `AuthGuard` перевіряє `OrganizationStatus.BLOCKED`, але не
  `deletedAt` (див. UF-27).
- **Перевірка викладача й назви та запис виконуються в одній транзакції**, тож між перевіркою і записом викладача не
  встигнуть видалити.
- **Перейменування лише з іншим регістром** (`група а` → `Група А`) проходить, бо `NOT: { id }` виключає саму групу з
  перевірки унікальності.
- **`try/catch` навколо транзакції не потрібен.** На відміну від cars, тут немає DB-unique-індексу, тож `P2002`
  не виникне, а `HttpException` з транзакції і так доходить до клієнта без змін.
- **У логах немає PII**: лише id групи, організації та актора.

### 3. Контролер: `src/modules/groups/groups.controller.ts`

У `list()` замінити `@Roles(UserRole.ADMIN)` на `@Roles(...GROUP_MANAGE_ROLES)`. Після цього `UserRole` в
контролері більше не потрібен, тож його імпорт треба прибрати. Додати два методи:

```ts
@Post()
@Roles(...GROUP_MANAGE_ROLES)
@HttpCode(HttpStatus.CREATED)
@ApiOperation({
  summary: 'Створити навчальну групу своєї автошколи',
  description:
    'ADMIN створює групу у своїй організації. organizationId береться з access token і не приймається в тілі. ' +
    'teacherId має вказувати на активного TEACHER тієї самої автошколи. ' +
    'Назва унікальна серед відкритих груп автошколи без урахування регістру. ' +
    'Дати у форматі YYYY-MM-DD, endDate не раніше startDate. Нова група завжди має статус PLANNED.',
})
@ApiCreatedResponse({ type: GroupListItemDto })
@ApiBadRequestResponse({
  description: 'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
})
@ApiForbiddenResponse({ description: 'Створювати групи може лише ADMIN.' })
@ApiNotFoundResponse({
  description:
    'Автошколу не знайдено або її видалено, або викладач не належить цій автошколі.',
})
@ApiConflictResponse({
  description:
    'Відкрита група з такою назвою вже є, користувач не є викладачем, або викладач не ACTIVE.',
})
create(@CurrentUser() user: User, @Body() body: CreateGroupDto) {
  return this.groupsService.create(user, body);
}

@Patch(':id')
@Roles(...GROUP_MANAGE_ROLES)
@ApiOperation({
  summary: 'Редагувати навчальну групу своєї автошколи',
  description:
    'ADMIN змінює name, teacherId, startDate або endDate групи своєї організації. ' +
    'Група іншої автошколи повертає 404. Групу зі статусом COMPLETED або ARCHIVED редагувати не можна. ' +
    'null у startDate чи endDate очищає дату. Статус цим запитом не змінюється.',
})
@ApiParam({
  name: 'id',
  format: 'uuid',
  description: 'Id групи своєї автошколи.',
})
@ApiOkResponse({ type: GroupListItemDto })
@ApiBadRequestResponse({
  description:
    'Некоректне тіло, порожнє тіло або id не UUID. Тіло містить errors: [{ field, message }].',
})
@ApiForbiddenResponse({ description: 'Редагувати групи може лише ADMIN.' })
@ApiNotFoundResponse({
  description:
    'Групу або викладача не знайдено, їх видалено, або вони належать іншій автошколі. ' +
    'Також якщо автошколу видалено.',
})
@ApiConflictResponse({
  description:
    'Група закрита (COMPLETED/ARCHIVED), назва зайнята, користувач не є викладачем, або викладач не ACTIVE.',
})
update(
  @CurrentUser() user: User,
  @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  @Body() body: UpdateGroupDto,
) {
  return this.groupsService.update(user, id, body);
}
```

`ParseUUIDPipe({ version: '4' })` такий самий, як у cars: `gen_random_uuid()` генерує UUID v4.

### 3a. Зміна статусу

- **DTO:** `UpdateGroupStatusDto` з одним полем `status` (`@IsEnum(GroupStatus)` + `@IsDefined`). Будь-яке значення
  enum проходить валідацію, а недозволений перехід відхиляє сервіс з `409`.
- **Сервіс:** `changeStatus(actor, groupId, payload)`. Спочатку `assertCanManageGroups` і `requireOrganization`, далі
  в транзакції: знайти групу, звірити перехід з `GROUP_STATUS_TRANSITIONS`, для закриття виконати
  `enrollment.updateMany({ where: { groupId, status: ACTIVE }, data: { status: COMPLETED } })`, потім
  `group.update` з `include: groupListInclude`. Оновлення зарахувань іде **до** оновлення групи, тож
  `studentsCount` у відповіді вже враховує закриття.
- `findFirst({ where: { id, organizationId } })` з `update` винесено в приватний `requireGroup`, бо ним користуються
  обидва методи.
- **Контролер:** `@Patch(':id/status')` з `@Roles(...GROUP_MANAGE_ROLES)` і `ParseUUIDPipe({ version: '4' })`.
- **Лог:** `Group status changed groupId=… from=… to=… completedEnrollments=… actorId=… organizationId=…`.

### 4. Модуль

Змін немає. `GroupsModule` уже зареєстрований і імпортує `AuthModule`, а `PrismaModule` глобальний.

### 5. Тести

Див. розділ «Тест-план» нижче.

## Error responses

Перевірки йдуть у такому порядку: guard'и, потім pipes, потім сервіс. Тому неавтентифікований клієнт з некоректним
тілом отримає `401`, а не `400`.

| Ситуація | Де перевіряється | Статус | Тіло |
|---|---|---|---|
| Немає або невалідний access token, користувач не `ACTIVE`, організація `BLOCKED` | `AuthGuard` | 401 | див. таблицю в UF-27 |
| Роль не `ADMIN` | `RolesGuard` | 403 | `Insufficient permissions` |
| `:id` не UUID v4 | `ParseUUIDPipe` | 400 | `Validation failed (uuid v 4 is expected)` |
| Немає `name` або `teacherId`, назва порожня або лише з пробілів | `ValidationPipe` | 400 | `errors: [{ field, message: "Заповніть обов'язкове поле." }]` |
| Назва довша за 120 символів або містить `<`, `>` | `ValidationPipe` | 400 | `errors: [{ field: 'name', … }]` |
| `teacherId` не UUID, `name: null` або `teacherId: null` у `PATCH` | `ValidationPipe` | 400 | `errors: [{ field, … }]` |
| Дата не `YYYY-MM-DD` або неіснуюча (`2026-02-30`) | `ValidationPipe` | 400 | `errors: [{ field, message: 'Дата має бути у форматі YYYY-MM-DD.' }]` |
| Зайве поле в тілі (`organizationId`, `status`, …) | `ValidationPipe` | 400 | `errors: [{ field: 'organizationId', message: 'property organizationId should not exist' }]` |
| Організацію soft-deleted | `requireOrganization` | 404 | `Organization not found` |
| `PATCH` з порожнім тілом | `GroupsService.update` | 400 | `errors: [{ field: 'body', … }]` |
| Групи немає або вона іншої організації | `GroupsService.update` | 404 | `Group not found` |
| Група `COMPLETED` або `ARCHIVED` | `GroupsService.update` | 409 | `GROUP_CLOSED_MESSAGE` |
| `endDate` раніше `startDate` (з урахуванням поточних дат групи для `PATCH`) | `assertDateRange` | 400 | `errors: [{ field: 'endDate', … }]` |
| Відкрита група з такою назвою вже є | `assertNameAvailable` | 409 | `errors: [{ field: 'name', … }]` |
| Викладача немає, його видалено або він з іншої організації | `requireTeacher` | 404 | `Teacher not found` |
| Користувач не `TEACHER` | `requireTeacher` | 409 | `TEACHER_ROLE_MESSAGE` |
| Викладач не `ACTIVE` | `requireTeacher` | 409 | `TEACHER_NOT_ACTIVE_MESSAGE` |
| `status` відсутній, `null` або не з enum (`/status`) | `ValidationPipe` | 400 | `errors: [{ field: 'status', … }]` |
| Недозволений перехід статусу (`/status`) | `GroupsService.changeStatus` | 409 | `Недозволений перехід статусу групи. FROM → TO.` |

Успіх: `POST` повертає `201`, обидва `PATCH` повертають `200`. Тіло в усіх випадках `GroupListItemDto`.

## Покриття AC

| AC | Як закрито |
|---|---|
| 1. Створення групи | `POST /api/groups` → `GroupsService.create()` |
| 2. Редагування групи | `PATCH /api/groups/:id` → `GroupsService.update()` |
| 3. Група в поточній Organization | `data.organizationId = actor.organizationId`, поля в DTO немає |
| 4. Authentication + RBAC | `@UseGuards(AuthGuard, RolesGuard)` на класі, `@Roles(...GROUP_MANAGE_ROLES)` на методах, `assertCanManageGroups` у сервісі |
| 5. Неможливо створити чи редагувати групу іншої Organization | `organizationId` з тіла дає `400`; чужа група дає `404` через `findFirst({ id, organizationId })`; викладач з іншої організації дає `404` |
| 6. Валідація даних | `CreateGroupDto` і `UpdateGroupDto`, плюс бізнес-правила в сервісі (діапазон дат, унікальна назва, викладач) |
| 7. Обробка некоректних даних | таблиця вище; формат `{ statusCode, errors: [{ field, message }] }` |
| 8. Коректні success/error responses | `201`/`200` з `GroupListItemDto`; Swagger описує `400`, `401`, `403`, `404`, `409` |

## Тест-план

### `src/modules/groups/groups.dto.spec.ts` (новий)

Більшість валідації живе в DTO, тому її варто перевіряти через реальний `ValidationPipe` з тими самими опціями, що в
`configureApp`:

```ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationExceptionFactory,
});
const validate = (metatype: Type, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype });
```

Кейси для `CreateGroupDto`:

1. Валідне тіло проходить, `'  Група А  '` стає `'Група А'`.
2. Немає `name`, або `name: '   '`, дає `field: 'name'` з `REQUIRED_FIELD_MESSAGE`.
3. Назва з 121 символу дає `GROUP_NAME_LENGTH_MESSAGE`, `'<b>Група</b>'` дає `UNSAFE_TEXT_MESSAGE`.
4. `teacherId: 'abc'` дає помилку UUID.
5. `startDate` зі значеннями `'2026-02-30'`, `'2026-13-01'`, `'2026-11-01T10:00:00Z'` і `'01.11.2026'` дає
   `DATE_FORMAT_MESSAGE`.
6. `organizationId` або `status` у тілі дає `400` з відповідним `field`.

Кейси для `UpdateGroupDto`:

1. `{}` проходить pipe (порожнє тіло перевіряє сервіс).
2. `{ startDate: null }` проходить.
3. `{ name: null }` і `{ teacherId: null }` дають `400`.

### `src/modules/groups/groups.service.spec.ts` (розширити)

Мок Prisma доповнити `$transaction` (як у `cars.service.spec.ts`: `mockImplementation((cb) => cb(prisma))`),
`group.create`, `group.findFirst`, `group.update` і `user.findUnique`.

`create`:

1. Створює групу з `organizationId: actor.organizationId` і `status: PLANNED` та повертає змаплений об'єкт зі
   `studentsCount: 0`.
2. `'2026-11-01'` записується як `new Date('2026-11-01T00:00:00.000Z')`, відсутні дати записуються як `null`.
3. `endDate` раніше `startDate` дає `BadRequestException`, а `$transaction` не викликається.
4. Викладача немає, його видалено або він з іншої організації: `NotFoundException`, `group.create` не викликається.
5. Користувач з роллю `INSTRUCTOR` або викладач зі статусом `INVITED` дає `ConflictException`.
6. Назва зайнята дає `409` з `field: 'name'`. Запит `findFirst` містить `mode: 'insensitive'` і
   `status: { in: [PLANNED, ACTIVE] }`.
7. Актор з роллю `TEACHER` отримує `ForbiddenException`, звернень до БД немає.
8. Soft-deleted організація дає `NotFoundException`, `$transaction` не викликається.

`update`:

1. Порожній payload дає `400` з `field: 'body'`, звернень до групи немає.
2. `findFirst` повертає `null` (чужа або неіснуюча група), результат `NotFoundException`. `where` містить
   `organizationId: actor.organizationId`.
3. Група `COMPLETED` або `ARCHIVED` дає `ConflictException`.
4. Ті самі `name` і `teacherId`: `user.findUnique` і `group.update` не викликаються, повертається поточна група.
5. Незмінний `teacherId` не перевіряється, навіть якщо викладач тепер `BLOCKED`.
6. Новий `teacherId` перевіряється через `requireTeacher`.
7. `{ endDate: '2026-10-01' }` при поточному `startDate = 2026-11-01` дає `400`. `{ startDate: null }` записує `null`.
8. Перейменування виключає саму групу з перевірки: `findFirst` викликається з `NOT: { id: groupId }`.
9. `data` містить лише змінені поля.

`changeStatus`:

1. Кожен із 5 дозволених переходів зберігається, і відповідь містить новий статус.
2. Решта 11 пар (усі `from × to` мінус дозволені, разом із повтором того самого статусу) дають `409` з
   `FROM → TO` у повідомленні; ні `group.update`, ні `enrollment.updateMany` не викликаються.
3. Закриття (`ACTIVE → COMPLETED`, `ACTIVE → ARCHIVED`, `PLANNED → ARCHIVED`) переводить `ACTIVE`-зарахування в
   `COMPLETED`, і `updateMany` викликається раніше за `group.update`.
4. `PLANNED → ACTIVE` зарахувань не чіпає.
5. Чужа група дає `404`, не-ADMIN отримує `403`, soft-deleted організація дає `404`.

Наявні тести `list()` після рефакторингу мають проходити без змін.

### `src/modules/groups/groups.controller.spec.ts` (розширити)

1. `create`, `update` і `changeStatus` мають ролі `[UserRole.ADMIN]` (той самий `Reflector`-тест, що вже є для
   `list`).
2. `create` передає в сервіс `user` і `body`; `update` і `changeStatus` передають `user`, `id` і `body`.

### Ручна перевірка

Потрібні дві організації, у кожній ADMIN і ACTIVE TEACHER.

```bash
# 201: група в організації A
curl -s -X POST http://localhost:3000/api/groups -H "Authorization: Bearer $ADMIN_A_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ПДР — Група А","teacherId":"<teacher-A-id>","startDate":"2026-11-01","endDate":"2027-01-31"}'

# 409: та сама назва в іншому регістрі
curl -s -X POST http://localhost:3000/api/groups -H "Authorization: Bearer $ADMIN_A_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"пдр — група а","teacherId":"<teacher-A-id>"}'

# 404: викладач з організації B
curl -s -X POST http://localhost:3000/api/groups -H "Authorization: Bearer $ADMIN_A_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Група Б","teacherId":"<teacher-B-id>"}'

# 400: спроба підставити чужу організацію
curl -s -X POST http://localhost:3000/api/groups -H "Authorization: Bearer $ADMIN_A_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Група В","teacherId":"<teacher-A-id>","organizationId":"<org-B-id>"}'

# 400: endDate раніше startDate
curl -s -X POST http://localhost:3000/api/groups -H "Authorization: Bearer $ADMIN_A_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Група Г","teacherId":"<teacher-A-id>","startDate":"2026-12-01","endDate":"2026-11-01"}'

# 200: редагування своєї групи, очищення endDate
curl -s -X PATCH http://localhost:3000/api/groups/<group-A-id> -H "Authorization: Bearer $ADMIN_A_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"ПДР — Група А (вечірня)","endDate":null}'

# 404: ADMIN A редагує групу організації B
curl -s -X PATCH http://localhost:3000/api/groups/<group-B-id> -H "Authorization: Bearer $ADMIN_A_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Чужа"}'

# 403: TEACHER; 401: без токена
curl -s -X POST http://localhost:3000/api/groups -H "Authorization: Bearer $TEACHER_A_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"X","teacherId":"<teacher-A-id>"}'
curl -s -X POST http://localhost:3000/api/groups -H 'Content-Type: application/json' -d '{}'
```

Після створення `GET /api/groups` має показати нову групу першою. Swagger у розділі `groups` має показувати три
ендпоінти з описаними відповідями.

## Поза скоупом цієї задачі

- **Заняття закритої групи.** Закриття групи не скасовує її майбутні `Lesson` зі статусом `SCHEDULED`, і Teacher
  Dashboard далі їх показує (він фільтрує заняття за викладачем, а не за статусом групи). API для створення занять
  поки немає, тож такі дані можуть з'явитися лише вручну. Коли API занять з'явиться, закриття групи має скасовувати
  майбутні заняття (`→ CANCELLED`) або дашборд має фільтрувати відкриті групи.
- Повторне відкриття закритої групи (див. «Рішення», п. 3). Якщо продукт його попросить, знадобиться перевірка, що
  жоден студент групи вже не відкритий в іншій групі, і повторна перевірка унікальності назви.
- `DELETE /groups/:id` і `GET /groups/:id`.
- Доступ для `OWNER`, поки продукт не вирішить (див. «Рішення», п. 1).
- DB-рівневий унікальний індекс на назву (див. «Рішення», п. 6).
- Перевірка, що наявні `Lesson.scheduledAt` потрапляють у новий діапазон дат групи. Зараз зміна дат на заняття не
  впливає.
- Винесення `requireOrganization`, `fieldError` і списку відкритих статусів у спільні helper'и. Їхні копії вже є в
  groups, cars, students і dashboard, тож це варто зробити окремим рефакторингом, а не в цьому PR.

## Чек-лист для рев'ю

- [ ] Нова Prisma-міграція **не** додана.
- [ ] `organizationId` береться лише з `@CurrentUser()`; у `CreateGroupDto` і `UpdateGroupDto` його немає.
- [ ] `update` шукає групу через `findFirst({ where: { id, organizationId } })`; чужа група дає `404`, а не `403`.
- [ ] `status` не приймається в тілі; нова група створюється як `PLANNED`.
- [ ] Закрита група (`COMPLETED` або `ARCHIVED`) дає `409` при редагуванні.
- [ ] `requireTeacher` перевіряє організацію, `deletedAt`, роль `TEACHER` і статус `ACTIVE`; при редагуванні
      викликається лише для нового `teacherId`.
- [ ] Унікальність назви: `mode: 'insensitive'`, лише відкриті групи, `NOT: { id }` при редагуванні.
- [ ] Дати приймаються лише як `YYYY-MM-DD`, неіснуючі дати відхиляються, `endDate >= startDate` перевіряється з
      урахуванням поточних значень групи.
- [ ] `create` і `update` повертають `GroupListItemDto` через спільний `toGroupListItem`; `teacher` вибирається через
      `select`.
- [ ] `@Roles(...GROUP_MANAGE_ROLES)` стоїть на всіх чотирьох методах; `assertCanManageGroups` є в `create`, `update`
      і `changeStatus`.
- [ ] `GROUP_STATUS_TRANSITIONS` дозволяє лише переходи вперед; з `ARCHIVED` переходів немає.
- [ ] Закриття групи переводить `ACTIVE`-зарахування в `COMPLETED` (не `DROPPED`) у тій самій транзакції, до
      `group.update`.
- [ ] `Logger` логує створення, редагування і зміну статусу без PII.
- [ ] Swagger: `201`/`200`, `400`, `401`, `403`, `404`, `409` описані для всіх трьох ендпоінтів запису.
- [ ] Нові тести присутні й проходять (`npm test`); `npm run lint` і `npm run build` чисті.
