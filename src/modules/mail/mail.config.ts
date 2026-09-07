import { Injectable } from '@nestjs/common';
import { requireEnv } from '../../common/config/env';

@Injectable()
export class MailConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly from: string;

  constructor() {
    this.host = requireEnv('MAIL_HOST');
    this.port = Number(requireEnv('MAIL_PORT'));
    this.user = requireEnv('MAIL_USER');
    this.password = requireEnv('MAIL_PASSWORD');
    this.from = requireEnv('MAIL_FROM');

    if (!Number.isInteger(this.port) || this.port <= 0) {
      throw new Error(`Invalid MAIL_PORT: expected a positive integer`);
    }
  }
}
