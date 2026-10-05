import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LicenseCategory, Transmission, User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CAR_SORT_FIELDS,
  CAR_SORT_ORDERS,
  CarListDto,
  CarListItemDto,
  CreateCarDto,
  ListCarsQueryDto,
  UpdateCarDto,
} from './cars.dto';
import { CAR_LIST_ROLES, CAR_WRITE_ROLES, CarsService } from './cars.service';

@ApiTags('cars')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('cars')
@UseGuards(AuthGuard, RolesGuard)
export class CarsController {
  constructor(private readonly carsService: CarsService) {}

  @Get()
  @Roles(...CAR_LIST_ROLES)
  @ApiOperation({
    summary: 'Список автомобілів своєї автошколи',
    description:
      'OWNER і ADMIN отримують усі автомобілі своєї організації. ' +
      'INSTRUCTOR отримує лише автомобілі, призначені йому. ' +
      'TEACHER і STUDENT доступу не мають. Автомобіль іншої автошколи у відповідь не потрапляє. ' +
      'organizationId береться з access token, а не з query. ' +
      'Підтримуються search за номером, фільтри category, transmission і instructorId, ' +
      'sortBy/sortOrder і пагінація page/limit.',
  })
  @ApiQuery({ name: 'search', required: false, example: 'AA0001' })
  @ApiQuery({ name: 'category', required: false, enum: LicenseCategory })
  @ApiQuery({ name: 'transmission', required: false, enum: Transmission })
  @ApiQuery({
    name: 'instructorId',
    required: false,
    example: '23232323-2323-4232-8232-232323232323',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: CAR_SORT_FIELDS,
    example: 'plateNumber',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: CAR_SORT_ORDERS,
    example: 'asc',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiOkResponse({ type: CarListDto })
  @ApiForbiddenResponse({
    description:
      'Список автомобілів доступний лише OWNER, ADMIN або INSTRUCTOR.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректні query-параметри. Тіло містить errors: [{ field, message }].',
  })
  @ApiNotFoundResponse({
    description: 'Автошколу не знайдено або її видалено.',
  })
  list(@CurrentUser() user: User, @Query() query: ListCarsQueryDto) {
    return this.carsService.list(user, query);
  }

  @Post()
  @Roles(...CAR_WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Створити автомобіль своєї автошколи',
    description:
      'OWNER або ADMIN створює автомобіль у своїй організації. ' +
      'organizationId береться з access token і не приймається в тілі. ' +
      'instructorId має вказувати на активного інструктора тієї самої автошколи. ' +
      'Державний номер унікальний у межах організації: той самий номер в іншій автошколі дозволений. ' +
      'Пробіли і дефіси в номері прибираються, літери зберігаються у верхньому регістрі.',
  })
  @ApiCreatedResponse({ type: CarListItemDto })
  @ApiForbiddenResponse({
    description: 'Створювати автомобілі можуть лише OWNER або ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло запиту. Тіло містить errors: [{ field, message }].',
  })
  @ApiConflictResponse({
    description:
      'Номер уже зайнятий у цій автошколі, користувач не є інструктором, або інструктор не ACTIVE.',
  })
  @ApiNotFoundResponse({
    description:
      'Автошколу не знайдено, її видалено, або інструктор не належить цій автошколі.',
  })
  create(@CurrentUser() user: User, @Body() body: CreateCarDto) {
    return this.carsService.create(user, body);
  }

  @Patch(':id')
  @Roles(...CAR_WRITE_ROLES)
  @ApiOperation({
    summary: 'Редагувати автомобіль своєї автошколи',
    description:
      'OWNER або ADMIN змінюють plateNumber, category, transmission або instructorId ' +
      'автомобіля своєї організації. organizationId з тіла не приймається. ' +
      'Автомобіль іншої автошколи повертає 404. Новий номер має бути унікальним у цій організації. ' +
      'Якщо автомобіль уже призначено студенту, нові category, transmission і instructorId ' +
      'мають збігатися з цим призначенням. Сам номер можна змінити.',
  })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Id автомобіля своєї автошколи.',
    example: '31313131-3131-4131-8131-313131313131',
  })
  @ApiOkResponse({ type: CarListItemDto })
  @ApiForbiddenResponse({
    description: 'Редагувати автомобілі можуть лише OWNER або ADMIN.',
  })
  @ApiBadRequestResponse({
    description:
      'Некоректне тіло або немає жодного дозволеного поля. Тіло містить errors: [{ field, message }].',
  })
  @ApiConflictResponse({
    description:
      'Номер уже зайнятий у цій автошколі, інструктор некоректний, ' +
      'або нові category, transmission чи instructorId не збігаються зі студентом, якому призначено автомобіль.',
  })
  @ApiNotFoundResponse({
    description:
      'Автомобіль або інструктор не знайдено, їх видалено, або вони належать іншій автошколі. ' +
      'Також якщо автошколу видалено.',
  })
  update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: UpdateCarDto,
  ) {
    return this.carsService.update(user, id, body);
  }
}
