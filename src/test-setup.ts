import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '..', '.env') });

process.env.AUTH_SECRET ??= 'test-auth-secret';
