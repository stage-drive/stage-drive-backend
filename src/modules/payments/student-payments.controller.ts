import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StudentPaymentSummaryDto } from './payments.dto';
import { PAYMENT_MANAGE_ROLES, PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('students/:studentId/payments')
@UseGuards(AuthGuard, RolesGuard)
export class StudentPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(...PAYMENT_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Оплати студента',
    description:
      'Вкладка «Оплати» в картці студента: актуальний статус, остання оплата, сума ' +
      'підтверджених оплат за валютами та історія оплат від нових до старих. ' +
      'studentId — id користувача зі списку студентів. Лише OWNER або ADMIN своєї автошколи.',
  })
  @ApiParam({
    name: 'studentId',
    format: 'uuid',
    description: 'Id користувача-студента.',
    example: '88888888-8888-4888-8888-888888888888',
  })
  @ApiOkResponse({ type: StudentPaymentSummaryDto })
  @ApiForbiddenResponse({
    description: 'Оплати студента переглядають лише OWNER або ADMIN.',
  })
  @ApiNotFoundResponse({
    description:
      'Студента не знайдено, його видалено, або він належить іншій автошколі.',
  })
  list(
    @CurrentUser() user: User,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return this.paymentsService.forStudent(user, studentId);
  }
}
