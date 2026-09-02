import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '..', '.env') });

process.env.AUTH_SECRET ??= 'test-auth-secret';
process.env.DATABASE_URL ??=
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';
