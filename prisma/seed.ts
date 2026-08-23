import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres_password@localhost:5432/stage_drive';

const DEMO_ORG_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_USER_ID = '22222222-2222-2222-2222-222222222222';
const DEMO_EMAIL = 'owner@example.com';
const DEMO_PASSWORD = 'Password1';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await prisma.organization.upsert({
    where: { id: DEMO_ORG_ID },
    update: { name: 'Stage Drive School' },
    create: {
      id: DEMO_ORG_ID,
      name: 'Stage Drive School',
      slug: 'stage-drive-school',
      email: DEMO_EMAIL,
      timezone: 'Europe/Kyiv',
    },
  });

  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      passwordHash,
      firstName: 'Ivan',
      lastName: 'Petrenko',
      role: UserRole.OWNER,
      organizationId: DEMO_ORG_ID,
    },
    create: {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      passwordHash,
      firstName: 'Ivan',
      lastName: 'Petrenko',
      role: UserRole.OWNER,
      organizationId: DEMO_ORG_ID,
    },
  });

  console.log(`Demo user ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
