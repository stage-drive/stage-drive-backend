import { User as PrismaUser } from '@prisma/client';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required for declaration merging
    interface User extends PrismaUser {}
  }
}

export {};
