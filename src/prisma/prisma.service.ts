import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { requireEnv } from '../common/config/env';
import { ensureDemoAccountsIfEnabled } from './demo-accounts';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({
      connectionString: requireEnv('DATABASE_URL'),
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
    const demoEmails = await ensureDemoAccountsIfEnabled(this);
    if (demoEmails) {
      this.logger.log(`Demo logins ready: ${demoEmails.join(', ')}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
