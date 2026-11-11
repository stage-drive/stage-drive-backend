import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AttendanceStatus,
  BookingConfirmation,
  CarStatus,
  CoursePublicationStatus,
  InvitationStatus,
  LessonStatus,
  LicenseCategory,
  PaymentStatus,
  TheoryTestStatus,
  TrainingStatus,
  Transmission,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { LICENSE_CATEGORY_MESSAGE } from '../../common/license-category';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO8601,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsPlainText } from '../../common/validators/plain-text.decorator';
import { InvitationEmailDeliveryDto } from '../invitations/invitations.dto';

export const STUDENT_SORT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'createdAt',
] as const;

export type StudentSortField = (typeof STUDENT_SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;

export type StudentSortOrder = (typeof SORT_ORDERS)[number];

const SEARCH_MAX_LENGTH = 100;
const PHONE_REGEX = /^\+?[0-9\s-]{7,20}$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const STUDENT_ADDRESS_MAX_LENGTH = 255;
export const STUDENT_CONTRACT_NUMBER_MAX_LENGTH = 64;
const REQUIRED_FIELD_MESSAGE = "Заповніть обов'язкове поле.";
const INVALID_EMAIL_MESSAGE = 'Введіть коректний email.';
export const STUDENT_DATE_FORMAT_MESSAGE =
  'Дата має бути у форматі YYYY-MM-DD.';
const ADDRESS_LENGTH_MESSAGE = `Адреса має містити не більше ${STUDENT_ADDRESS_MAX_LENGTH} символів.`;
const CONTRACT_NUMBER_LENGTH_MESSAGE = `Номер договору має містити не більше ${STUDENT_CONTRACT_NUMBER_MAX_LENGTH} символів.`;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

function optionalTrimmedString({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalInteger({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'number' ? value : Number(value);
}

function emptyToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class ListStudentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Пошук за ім’ям, прізвищем, email або телефоном. Пробіл шукає ім’я і прізвище разом.',
    example: 'Петренко',
    maxLength: SEARCH_MAX_LENGTH,
  })
  @Transform(optionalTrimmedString)
  @IsOptional()
  @IsString({ message: 'search має бути рядком.' })
  @MaxLength(SEARCH_MAX_LENGTH, {
    message: `search має містити не більше ${SEARCH_MAX_LENGTH} символів.`,
  })
  search?: string;

  @ApiPropertyOptional({
    enum: UserStatus,
    description:
      'Фільтр за обліковим статусом користувача (User.status). ' +
      'Навчальний статус фільтрується окремо через trainingStatus.',
    example: UserStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(UserStatus, {
    message: 'status має бути INVITED, ACTIVE, BLOCKED або ARCHIVED.',
  })
  status?: UserStatus;

  @ApiPropertyOptional({
    enum: TrainingStatus,
    description: 'Фільтр за навчальним статусом.',
    example: TrainingStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(TrainingStatus, {
    message:
      'trainingStatus має бути NEW, ACTIVE, THEORY_COMPLETED, PRACTICE, EXAM, GRADUATED, DROPPED або ARCHIVED.',
  })
  trainingStatus?: TrainingStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Фільтр за групою студента.',
    example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  })
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Фільтр за призначеним інструктором.',
    example: '23232323-2323-4232-8232-232323232323',
  })
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  @IsOptional()
  instructorId?: string;

  @ApiPropertyOptional({
    enum: LicenseCategory,
    description: 'Фільтр за категорією навчання.',
    example: LicenseCategory.B,
  })
  @IsOptional()
  @IsEnum(LicenseCategory, { message: LICENSE_CATEGORY_MESSAGE })
  category?: LicenseCategory;

  @ApiPropertyOptional({
    enum: PaymentStatus,
    description:
      'Фільтр за статусом оплати. UNPAID — є практичне заняття без оплати, яке не скасоване. ' +
      'PAID — таких занять немає.',
    example: PaymentStatus.PAID,
  })
  @IsOptional()
  @IsEnum(PaymentStatus, {
    message: 'paymentStatus має бути UNPAID або PAID.',
  })
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({
    enum: STUDENT_SORT_FIELDS,
    default: 'lastName',
    description: 'Поле сортування. За замовчуванням lastName.',
  })
  @IsOptional()
  @IsIn(STUDENT_SORT_FIELDS, {
    message:
      'sortBy має бути firstName, lastName, email, phone, status або createdAt.',
  })
  sortBy?: StudentSortField;

  @ApiPropertyOptional({
    enum: SORT_ORDERS,
    default: 'asc',
    description: 'Напрям сортування. За замовчуванням asc.',
  })
  @IsOptional()
  @IsIn(SORT_ORDERS, { message: 'sortOrder має бути asc або desc.' })
  sortOrder?: StudentSortOrder;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE,
    default: DEFAULT_PAGE,
    example: DEFAULT_PAGE,
  })
  @Transform(optionalInteger)
  @IsOptional()
  @IsInt({ message: 'page має бути цілим числом.' })
  @Min(1, { message: 'page має бути не менше 1.' })
  @Max(MAX_PAGE, { message: 'page занадто великий.' })
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    example: DEFAULT_LIMIT,
  })
  @Transform(optionalInteger)
  @IsOptional()
  @IsInt({ message: 'limit має бути цілим числом.' })
  @Min(1, { message: 'limit має бути не менше 1.' })
  @Max(MAX_LIMIT, { message: 'limit має бути не більше 100.' })
  limit?: number;
}

export class StudentGroupSummaryDto {
  @ApiProperty({ example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' })
  id: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: 'Група B-12',
    description: 'null, якщо назву групи не вдалося прочитати.',
  })
  name: string | null;
}

export class StudentInstructorSummaryDto {
  @ApiProperty({ example: '23232323-2323-4232-8232-232323232323' })
  id: string;

  @ApiProperty({ example: 'Ігор' })
  firstName: string;

  @ApiProperty({ example: 'Мельник' })
  lastName: string;
}

export class StudentListItemDto {
  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({
    enum: LicenseCategory,
    nullable: true,
    example: LicenseCategory.B,
    description:
      'Категорія, на яку навчається студент. null, якщо в профілі ще не вказана.',
  })
  category: LicenseCategory | null;

  @ApiProperty({
    enum: Transmission,
    nullable: true,
    example: Transmission.MANUAL,
    description:
      'Коробка передач, на яку навчається студент. null, якщо в профілі ще не вказана.',
  })
  transmission: Transmission | null;

  @ApiProperty({
    enum: TrainingStatus,
    nullable: true,
    example: TrainingStatus.ACTIVE,
    description:
      'Навчальний статус. null, якщо профіль учня належить іншій автошколі або його ще немає.',
  })
  trainingStatus: TrainingStatus | null;

  @ApiProperty({
    nullable: true,
    type: StudentGroupSummaryDto,
    description: 'Поточна група. null, якщо студента ще не зараховано.',
  })
  group: StudentGroupSummaryDto | null;

  @ApiProperty({
    nullable: true,
    type: StudentInstructorSummaryDto,
    description:
      'Призначений інструктор. null, доки немає допуску до практики.',
  })
  instructor: StudentInstructorSummaryDto | null;

  @ApiProperty({
    enum: PaymentStatus,
    example: PaymentStatus.PAID,
    description:
      'UNPAID, якщо є практичне заняття без оплати, яке не скасоване. Інакше PAID.',
  })
  paymentStatus: PaymentStatus;

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  createdAt: Date;
}

export class StudentListPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class StudentListDto {
  @ApiProperty({ type: [StudentListItemDto] })
  students: StudentListItemDto[];

  @ApiProperty({ type: StudentListPaginationDto })
  pagination: StudentListPaginationDto;
}

export class CreateStudentDto {
  @ApiProperty({ example: 'Олена' })
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  @MaxLength(60)
  @IsPlainText()
  @IsString()
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  @IsEmail({}, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  email: string;

  @ApiPropertyOptional({
    example: '+380991234567',
    nullable: true,
  })
  @Matches(PHONE_REGEX, { message: 'Введіть коректний номер телефону.' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    description:
      'Група своєї автошколи зі статусом PLANNED або ACTIVE. ' +
      'Якщо поле не передати, учень створюється без групи. ' +
      'Разом із groupId створюється активне зарахування.',
    example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  })
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({
    enum: LicenseCategory,
    nullable: true,
    description:
      'Категорія, на яку навчається студент. Потрібна разом із transmission для допуску до практики.',
    example: LicenseCategory.B,
  })
  @IsEnum(LicenseCategory, { message: LICENSE_CATEGORY_MESSAGE })
  @IsOptional()
  category?: LicenseCategory | null;

  @ApiPropertyOptional({
    enum: Transmission,
    nullable: true,
    description:
      'Коробка передач, на яку навчається студент. Має збігатися з автомобілем допуску.',
    example: Transmission.MANUAL,
  })
  @IsEnum(Transmission, {
    message: 'transmission має бути MANUAL або AUTOMATIC.',
  })
  @IsOptional()
  transmission?: Transmission | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2004-03-15',
    description:
      'Дата народження у форматі YYYY-MM-DD. Якщо поле не передати, зберігається null.',
  })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true }, { message: STUDENT_DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: STUDENT_DATE_FORMAT_MESSAGE })
  birthDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: STUDENT_ADDRESS_MAX_LENGTH,
    example: 'м. Київ, вул. Хрещатик, 1',
    description:
      'Адреса проживання. Пробіли по краях обрізаються, порожній рядок зберігається як null.',
  })
  @Transform(emptyToNull)
  @MaxLength(STUDENT_ADDRESS_MAX_LENGTH, { message: ADDRESS_LENGTH_MESSAGE })
  @IsPlainText()
  @IsString({ message: 'address має бути рядком або null.' })
  @IsOptional()
  address?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: STUDENT_CONTRACT_NUMBER_MAX_LENGTH,
    example: 'Д-2026/0142',
    description:
      'Номер договору. Пробіли по краях обрізаються, порожній рядок зберігається як null.',
  })
  @Transform(emptyToNull)
  @MaxLength(STUDENT_CONTRACT_NUMBER_MAX_LENGTH, {
    message: CONTRACT_NUMBER_LENGTH_MESSAGE,
  })
  @IsPlainText()
  @IsString({ message: 'contractNumber має бути рядком або null.' })
  @IsOptional()
  contractNumber?: string | null;
}

export class CreatedStudentUserDto {
  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  id: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  phone: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.INVITED })
  status: UserStatus;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;
}

export class PracticeCarDto {
  @ApiProperty({ example: '31313131-3131-4131-8131-313131313131' })
  id: string;

  @ApiProperty({ example: 'AA0001BB' })
  plateNumber: string;

  @ApiProperty({ enum: LicenseCategory, example: LicenseCategory.B })
  category: LicenseCategory;

  @ApiProperty({ enum: Transmission, example: Transmission.MANUAL })
  transmission: Transmission;

  @ApiProperty({
    enum: CarStatus,
    example: CarStatus.AVAILABLE,
    description:
      'Актуальний експлуатаційний статус. Для нового допуску до практики потрібен AVAILABLE.',
  })
  status: CarStatus;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '23232323-2323-4232-8232-232323232323',
    description: 'Інструктор, якому автомобіль призначено зараз.',
  })
  instructorId: string | null;
}

export class StudentProfileDto {
  @ApiProperty({ example: '12121212-1212-1212-1212-121212121212' })
  id: string;

  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  userId: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  })
  groupId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'null, доки ADMIN не надасть допуск до практики через PATCH /api/students/{id}/practice-access.',
  })
  instructorId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'null, доки ADMIN не надасть допуск до практики через PATCH /api/students/{id}/practice-access.',
  })
  carId: string | null;

  @ApiProperty({
    nullable: true,
    type: PracticeCarDto,
    description:
      'Актуальні дані призначеного автомобіля. null, якщо допуск до практики ще не надано ' +
      'або автомобіль належить іншій автошколі. Статус і номер читаються з автомобіля, а не з копії.',
  })
  car: PracticeCarDto | null;

  @ApiProperty({
    enum: LicenseCategory,
    nullable: true,
    example: LicenseCategory.B,
    description:
      'Категорія, на яку навчається студент. Потрібна для допуску до практики. ' +
      'Новий учень створюється з null.',
  })
  category: LicenseCategory | null;

  @ApiProperty({
    enum: Transmission,
    nullable: true,
    example: Transmission.MANUAL,
    description:
      'Коробка передач, на яку навчається студент. Має збігатися з автомобілем допуску. ' +
      'Новий учень створюється з null.',
  })
  transmission: Transmission | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2004-03-15',
    description:
      'Дата народження у форматі YYYY-MM-DD. null, якщо ще не вказана.',
  })
  birthDate: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'м. Київ, вул. Хрещатик, 1',
    description: 'Адреса проживання. null, якщо ще не вказана.',
  })
  address: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Д-2026/0142',
    description: 'Номер договору. null, якщо ще не вказаний.',
  })
  contractNumber: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Аватар студента. Той самий URL, що avatarUrl користувача. null, якщо аватара немає.',
  })
  avatar: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'Дата зарахування в поточну групу. null, якщо групи немає або зарахування не знайдено.',
  })
  enrolledAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date',
    example: '2026-06-30',
    description:
      'Орієнтовна дата завершення: endDate поточної групи, YYYY-MM-DD. null, якщо дати немає.',
  })
  estimatedCompletionDate: string | null;

  @ApiProperty({
    nullable: true,
    type: StudentGroupSummaryDto,
    description: 'Поточна група. null, якщо студента ще не зараховано.',
  })
  group: StudentGroupSummaryDto | null;

  @ApiProperty({
    nullable: true,
    type: StudentInstructorSummaryDto,
    description:
      'ПІБ призначеного інструктора. null, доки допуску до практики немає.',
  })
  instructor: StudentInstructorSummaryDto | null;

  @ApiProperty({
    enum: TrainingStatus,
    example: TrainingStatus.NEW,
    description:
      'Навчальний статус. Новий учень створюється як NEW. ' +
      'THEORY_COMPLETED ставить система. ' +
      'PRACTICE встановлюється лише через PATCH /api/students/{id}/practice-access. ' +
      'Інші переходи — через PATCH /api/students/{id}/status.',
  })
  trainingStatus: TrainingStatus;
}

export class CreatedStudentInvitationDto {
  @ApiProperty({ example: '44444444-4444-4444-4444-444444444444' })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: InvitationStatus, example: InvitationStatus.PENDING })
  status: InvitationStatus;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty({ example: '77777777-7777-7777-7777-777777777777' })
  userId: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({ type: InvitationEmailDeliveryDto })
  emailDelivery: InvitationEmailDeliveryDto;
}

export class CreateStudentResponseDto {
  @ApiProperty({ type: CreatedStudentUserDto })
  user: CreatedStudentUserDto;

  @ApiProperty({ type: StudentProfileDto })
  student: StudentProfileDto;

  @ApiProperty({ type: CreatedStudentInvitationDto })
  invitation: CreatedStudentInvitationDto;
}

export const TRAINING_STATUS_VALUE_MESSAGE =
  'status має бути NEW, ACTIVE, THEORY_COMPLETED, PRACTICE, EXAM, GRADUATED, DROPPED або ARCHIVED.';

export class UpdateStudentTrainingStatusDto {
  @ApiProperty({
    enum: TrainingStatus,
    example: TrainingStatus.ACTIVE,
    description:
      'Новий навчальний статус. Дозволені переходи: ' +
      'NEW → ACTIVE, DROPPED, ARCHIVED; ' +
      'ACTIVE → DROPPED, ARCHIVED; ' +
      'THEORY_COMPLETED → DROPPED, ARCHIVED; ' +
      'PRACTICE → EXAM, DROPPED, ARCHIVED; ' +
      'EXAM → GRADUATED, DROPPED, ARCHIVED; ' +
      'GRADUATED → ARCHIVED; DROPPED → ARCHIVED. ' +
      'ARCHIVED далі не змінюється. ' +
      'THEORY_COMPLETED адмін не ставить: його ставить система. ' +
      'PRACTICE цим запитом не призначається. ' +
      'EXAM доступний лише після рівно 40 годин практики.',
  })
  @IsEnum(TrainingStatus, {
    message: TRAINING_STATUS_VALUE_MESSAGE,
  })
  status: TrainingStatus;
}

export class AssignStudentGroupDto {
  @ApiProperty({
    description:
      'Навчальна група тієї самої автошколи. Групи ARCHIVED і COMPLETED не приймаються.',
    example: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  })
  @IsUUID('4', { message: 'groupId має бути UUID.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  groupId: string;
}

export class GrantPracticeAccessDto {
  @ApiProperty({
    description:
      'Інструктор тієї самої автошколи з роллю INSTRUCTOR і статусом ACTIVE.',
    example: '23232323-2323-4232-8232-232323232323',
  })
  @IsUUID('4', { message: 'instructorId має бути UUID.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  instructorId: string;

  @ApiProperty({
    description:
      'Автомобіль цього інструктора. category і transmission мають збігатися зі студентом.',
    example: '31313131-3131-4131-8131-313131313131',
  })
  @IsUUID('4', { message: 'carId має бути UUID.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  carId: string;
}

export class UpdateStudentDto {
  @ApiPropertyOptional({ example: 'Олена' })
  @MaxLength(60, { message: 'Ім’я має містити не більше 60 символів.' })
  @IsPlainText()
  @IsString({ message: 'firstName має бути рядком.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Коваль' })
  @MaxLength(60, { message: 'Прізвище має містити не більше 60 символів.' })
  @IsPlainText()
  @IsString({ message: 'lastName має бути рядком.' })
  @IsNotEmpty({ message: REQUIRED_FIELD_MESSAGE })
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
    description: 'Передайте null, щоб очистити телефон.',
  })
  @Matches(PHONE_REGEX, { message: 'Введіть коректний номер телефону.' })
  @IsString({ message: 'phone має бути рядком або null.' })
  @IsOptional()
  phone?: string | null;

  @ApiPropertyOptional({
    enum: LicenseCategory,
    nullable: true,
    description:
      'Категорія навчання. null очищує значення. ' +
      'Якщо студенту вже призначено автомобіль, нова пара category/transmission має з ним збігатися.',
    example: LicenseCategory.B,
  })
  @IsEnum(LicenseCategory, { message: LICENSE_CATEGORY_MESSAGE })
  @IsOptional()
  category?: LicenseCategory | null;

  @ApiPropertyOptional({
    enum: Transmission,
    nullable: true,
    description:
      'Коробка передач. null очищує значення. ' +
      'Має збігатися з уже призначеним автомобілем.',
    example: Transmission.MANUAL,
  })
  @IsEnum(Transmission, {
    message: 'transmission має бути MANUAL або AUTOMATIC.',
  })
  @IsOptional()
  transmission?: Transmission | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: true,
    example: '2004-03-15',
    description: 'Дата народження у форматі YYYY-MM-DD. null очищує значення.',
  })
  @Transform(emptyToNull)
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601({ strict: true }, { message: STUDENT_DATE_FORMAT_MESSAGE })
  @Matches(DATE_ONLY_PATTERN, { message: STUDENT_DATE_FORMAT_MESSAGE })
  birthDate?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: STUDENT_ADDRESS_MAX_LENGTH,
    example: 'м. Київ, вул. Хрещатик, 1',
    description:
      'Адреса проживання. null або порожній рядок очищує значення. Пробіли по краях обрізаються.',
  })
  @Transform(emptyToNull)
  @MaxLength(STUDENT_ADDRESS_MAX_LENGTH, { message: ADDRESS_LENGTH_MESSAGE })
  @IsPlainText()
  @IsString({ message: 'address має бути рядком або null.' })
  @IsOptional()
  address?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: STUDENT_CONTRACT_NUMBER_MAX_LENGTH,
    example: 'Д-2026/0142',
    description:
      'Номер договору. null або порожній рядок очищує значення. Пробіли по краях обрізаються.',
  })
  @Transform(emptyToNull)
  @MaxLength(STUDENT_CONTRACT_NUMBER_MAX_LENGTH, {
    message: CONTRACT_NUMBER_LENGTH_MESSAGE,
  })
  @IsPlainText()
  @IsString({ message: 'contractNumber має бути рядком або null.' })
  @IsOptional()
  contractNumber?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '/uploads/avatars/student.png',
    description:
      'URL аватара. null або порожній рядок очищує avatarUrl. ' +
      'role, organizationId, обліковий статус, instructorId і carId цим запитом не змінюються.',
  })
  @Transform(emptyToNull)
  @MaxLength(2048, { message: 'avatar має містити не більше 2048 символів.' })
  @IsString({ message: 'avatar має бути рядком або null.' })
  @IsOptional()
  avatar?: string | null;
}

export class StudentTheoryCourseDto {
  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  id: string;

  @ApiProperty({ example: 'Теорія категорії B' })
  name: string;

  @ApiProperty({
    enum: CoursePublicationStatus,
    example: CoursePublicationStatus.PUBLISHED,
  })
  publicationStatus: CoursePublicationStatus;
}

export class StudentTheorySessionDto {
  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  lessonId: string;

  @ApiProperty({ example: 'Дорожні знаки' })
  topic: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt: Date;

  @ApiProperty({ example: 90 })
  durationMin: number;

  @ApiProperty({ enum: LessonStatus, example: LessonStatus.SCHEDULED })
  status: LessonStatus;

  @ApiProperty({
    enum: AttendanceStatus,
    nullable: true,
    description: 'Відмітка цього студента на занятті. null — ще не відмічено.',
  })
  attendance: AttendanceStatus | null;
}

export class StudentTheoryLessonDto {
  @ApiProperty({ example: '61616161-6161-4616-8616-616161616161' })
  lessonId: string;

  @ApiProperty({ example: 'Дорожні знаки' })
  title: string;

  @ApiProperty({ example: true })
  completed: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt: Date | null;

  @ApiProperty({
    type: [StudentTheorySessionDto],
    description:
      'Очні заняття поточної групи, прив’язані до цього уроку курсу.',
  })
  sessions: StudentTheorySessionDto[];
}

export class StudentTheoryProgressDto {
  @ApiProperty({ example: 2, minimum: 0 })
  completedLessonCount: number;

  @ApiProperty({ example: 4, minimum: 0 })
  totalLessonCount: number;

  @ApiProperty({ example: 50, minimum: 0, maximum: 100 })
  percent: number;

  @ApiProperty({ type: [StudentTheoryLessonDto] })
  lessons: StudentTheoryLessonDto[];
}

export class StudentTheoryDto {
  @ApiProperty({ nullable: true, type: StudentTheoryCourseDto })
  course: StudentTheoryCourseDto | null;

  @ApiProperty({ nullable: true, type: StudentTheoryProgressDto })
  progress: StudentTheoryProgressDto | null;
}

export class StudentTestResultDto {
  @ApiProperty({ example: '91919191-9191-4919-8919-919191919191' })
  id: string;

  @ApiProperty({ example: '41414141-4141-4414-8414-414141414141' })
  courseId: string;

  @ApiProperty({ example: 'Теорія категорії B' })
  courseName: string;

  @ApiProperty({ enum: TheoryTestStatus, example: TheoryTestStatus.PASSED })
  status: TheoryTestStatus;

  @ApiProperty({ nullable: true, type: Number, example: 86 })
  score: number | null;

  @ApiProperty({ type: String, format: 'date-time' })
  takenAt: Date;
}

export class StudentAttendanceItemDto {
  @ApiProperty({ example: '51515151-5151-4515-8515-515151515151' })
  lessonId: string;

  @ApiProperty({ example: 'Правила проїзду перехресть' })
  topic: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt: Date;

  @ApiProperty({ enum: LessonStatus, example: LessonStatus.COMPLETED })
  lessonStatus: LessonStatus;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Урок курсу, прив’язаний до цього заняття. null — заняття без контенту курсу.',
  })
  courseLessonId: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Курс прив’язаного уроку. null, якщо заняття не прив’язане.',
  })
  courseId: string | null;

  @ApiProperty({ enum: AttendanceStatus, example: AttendanceStatus.PRESENT })
  status: AttendanceStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  markedAt: Date;
}

export class StudentPracticeLessonDto {
  @ApiProperty({ example: '81818181-8181-4818-8818-818181818181' })
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt: Date;

  @ApiProperty({ example: 120 })
  durationMin: number;

  @ApiProperty({ enum: LessonStatus, example: LessonStatus.COMPLETED })
  status: LessonStatus;

  @ApiProperty({
    enum: BookingConfirmation,
    example: BookingConfirmation.CONFIRMED,
  })
  confirmationStatus: BookingConfirmation;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PAID })
  paymentStatus: PaymentStatus;

  @ApiProperty({ nullable: true, type: String })
  instructorComment: string | null;
}

export class StudentPracticeDto {
  @ApiProperty({
    example: 40,
    description: 'Скільки годин практики треба відкатати на статусі PRACTICE.',
  })
  requiredHours: number;

  @ApiProperty({
    example: 40,
    description:
      'Сума годин практичних занять зі статусом оплати PAID, крім скасованих.',
  })
  paidHours: number;

  @ApiProperty({
    example: 40,
    description: 'Сума годин занять зі статусом COMPLETED.',
  })
  completedHours: number;

  @ApiProperty({
    example: 0,
    description:
      'paidHours − completedHours. Може бути від’ємним, якщо пройдено більше, ніж оплачено.',
  })
  remainingHours: number;

  @ApiProperty({
    example: true,
    description:
      'true лише коли пройдено рівно requiredHours. Менше або більше — іспит недоступний.',
  })
  examAvailable: boolean;

  @ApiProperty({ type: [StudentPracticeLessonDto] })
  lessons: StudentPracticeLessonDto[];
}

export class StudentPaymentHistoryItemDto {
  @ApiProperty({ example: '81818181-8181-4818-8818-818181818181' })
  id: string;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt: Date;

  @ApiProperty({ example: 2 })
  hours: number;

  @ApiProperty({ enum: LessonStatus, example: LessonStatus.COMPLETED })
  lessonStatus: LessonStatus;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PAID })
  paymentStatus: PaymentStatus;
}

export class StudentPaymentsDto {
  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PAID })
  status: PaymentStatus;

  @ApiProperty({ type: [StudentPaymentHistoryItemDto] })
  history: StudentPaymentHistoryItemDto[];
}

export class StudentCardDto {
  @ApiProperty({
    example: '88888888-8888-4888-8888-888888888888',
    description: 'Id користувача. Той самий id, що в списку студентів.',
  })
  id: string;

  @ApiProperty({ example: 'student@example.com' })
  email: string;

  @ApiProperty({ example: 'Олена' })
  firstName: string;

  @ApiProperty({ example: 'Коваль' })
  lastName: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '+380991234567',
  })
  phone: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  avatarUrl: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  organizationId: string;

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-02-01T00:00:00.000Z' })
  updatedAt: Date;

  @ApiPropertyOptional({
    nullable: true,
    type: StudentProfileDto,
    description:
      'Профіль учня. null, якщо рядок у таблиці students ще не створений.',
  })
  student: StudentProfileDto | null;

  @ApiProperty({ type: StudentTheoryDto })
  theory: StudentTheoryDto;

  @ApiProperty({ type: [StudentTestResultDto] })
  tests: StudentTestResultDto[];

  @ApiProperty({
    type: [StudentAttendanceItemDto],
    description:
      'Журнал очної відвідуваності. На навчальний статус THEORY_COMPLETED не впливає.',
  })
  attendance: StudentAttendanceItemDto[];

  @ApiProperty({ type: StudentPracticeDto })
  practice: StudentPracticeDto;

  @ApiProperty({ type: StudentPaymentsDto })
  payments: StudentPaymentsDto;
}
