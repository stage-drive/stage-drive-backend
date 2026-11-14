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
import { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StudentPaymentSummaryDto } from './payments.dto';
import { PAYMENT_SELF_ROLES, PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('me/payments')
@UseGuards(AuthGuard, RolesGuard)
export class MePaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @Roles(...PAYMENT_SELF_ROLES)
  @ApiOperation({
    summary: 'Власні оплати студента',
    description:
      'Актуальний статус, остання оплата, сума підтверджених оплат за валютами та історія ' +
      'оплат. Студент бачить лише свої оплати і не може їх змінювати. Службовий коментар ' +
      'ADMIN не повертається. Практику можна бронювати лише з актуальним статусом PAID.',
  })
  @ApiOkResponse({ type: StudentPaymentSummaryDto })
  @ApiForbiddenResponse({
    description: 'Власні оплати доступні лише ролі STUDENT.',
  })
  @ApiNotFoundResponse({
    description: 'Профіль студента не знайдено або автошколу видалено.',
  })
  own(@CurrentUser() user: User) {
    return this.paymentsService.own(user);
  }
}
