import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MePaymentsController } from './me-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StudentPaymentsController } from './student-payments.controller';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [
    PaymentsController,
    StudentPaymentsController,
    MePaymentsController,
  ],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
