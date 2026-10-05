import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
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
  ListCarsQueryDto,
} from './cars.dto';
import { CAR_LIST_ROLES, CarsService } from './cars.service';

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
}
