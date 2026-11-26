import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationReadStatus, NotificationType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

function optionalInteger({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return typeof value === 'number' ? value : Number(value);
}

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    enum: NotificationReadStatus,
    description: 'Лише непрочитані або лише прочитані. Без фільтра — усі свої.',
    example: NotificationReadStatus.UNREAD,
  })
  @IsOptional()
  @IsEnum(NotificationReadStatus, {
    message: 'readStatus має бути UNREAD або READ.',
  })
  readStatus?: NotificationReadStatus;

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

export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty({
    description: 'Текст сповіщення для отримувача.',
    example: 'Заплановано теоретичне заняття «ПДР» на 26.11.2026, 10:00.',
  })
  text: string;

  @ApiProperty({ enum: NotificationReadStatus })
  readStatus: NotificationReadStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time', nullable: true })
  readAt: Date | null;
}

export class NotificationPaginationDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto] })
  items: NotificationDto[];

  @ApiProperty({ type: NotificationPaginationDto })
  pagination: NotificationPaginationDto;
}

export class UnreadNotificationCountDto {
  @ApiProperty({
    description: 'Кількість непрочитаних сповіщень поточного користувача.',
    example: 2,
  })
  count: number;
}
