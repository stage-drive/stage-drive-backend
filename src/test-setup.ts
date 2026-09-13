import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '..', '.env') });

process.env.AUTH_SECRET ??= 'test-auth-secret';
process.env.DATABASE_URL ??=
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';
process.env.MAIL_HOST ??= 'smtp.example.com';
process.env.MAIL_PORT ??= '587';
process.env.MAIL_USER ??= 'test@example.com';
process.env.MAIL_PASSWORD ??= 'test-password';
process.env.MAIL_FROM ??= 'test@example.com';
process.env.FRONTEND_URL ??= 'http://localhost:5173';
