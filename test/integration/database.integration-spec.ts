import { execFileSync } from 'child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

describe('Database schema (integration, real Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('generates UUID primary keys at the database level, not the application', async () => {
    const organization = await prisma.organization.create({
      data: {
        name: 'Test School',
        slug: 'test-school',
        email: 'school@example.com',
      },
    });

    expect(organization.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('cascades deletes from organization to its users via the FK', async () => {
    const organization = await prisma.organization.create({
      data: {
        name: 'Cascade School',
        slug: 'cascade-school',
        email: 'cascade@example.com',
      },
    });
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: 'owner@cascade.example.com',
        firstName: 'Ivan',
        lastName: 'Petrenko',
        role: 'OWNER',
      },
    });

    await prisma.organization.delete({ where: { id: organization.id } });

    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found).toBeNull();
  });

  it('rejects a user referencing a non-existent organization', async () => {
    await expect(
      prisma.user.create({
        data: {
          organizationId: '00000000-0000-0000-0000-000000000000',
          email: 'orphan@example.com',
          firstName: 'No',
          lastName: 'Org',
          role: 'STUDENT',
        },
      }),
    ).rejects.toThrow();
  });

  it('soft-deletes a user by stamping deletedAt instead of removing the row', async () => {
    const organization = await prisma.organization.create({
      data: {
        name: 'Soft Delete School',
        slug: 'soft-delete-school',
        email: 'soft@example.com',
      },
    });
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: 'deleteme@example.com',
        firstName: 'Old',
        lastName: 'User',
        role: 'STUDENT',
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    const stillThere = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.deletedAt).not.toBeNull();
  });

  it('enforces the VarChar bound on organization.name at the database level', async () => {
    const tooLong = 'x'.repeat(300);

    await expect(
      prisma.organization.create({
        data: {
          name: tooLong,
          slug: `too-long-${Date.now()}`,
          email: `too-long-${Date.now()}@example.com`,
        },
      }),
    ).rejects.toThrow();
  });
});
