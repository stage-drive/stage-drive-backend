import { execFileSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RefreshTokenService } from '../../src/modules/auth/refresh-token.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

type RefreshTokenRow = {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  used_at: Date | null;
  revoked_at: Date | null;
};

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Real RefreshTokenService against real Postgres. Rows are read back with raw
 * SQL, so the assertions see exactly what a database dump or a leaked backup
 * would contain.
 */
describe('Refresh tokens at rest (integration, real Postgres)', () => {
  const originalSecret = process.env.AUTH_SECRET;
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let service: RefreshTokenService;
  let userId: string;

  beforeAll(async () => {
    // rotate() signs an access token, so it needs a valid key.
    process.env.AUTH_SECRET = randomBytes(32).toString('base64');

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
    service = new RefreshTokenService(prisma as unknown as PrismaService);

    const organization = await prisma.organization.create({
      data: {
        name: 'Refresh School',
        slug: 'refresh-school',
        email: 'refresh-school@example.com',
      },
    });
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: 'owner@refresh.example.com',
        firstName: 'Ivan',
        lastName: 'Petrenko',
        role: UserRole.OWNER,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (originalSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalSecret;
    }
    await prisma?.$disconnect();
    await container?.stop();
  });

  function rowsForUser(): Promise<RefreshTokenRow[]> {
    return prisma.$queryRaw<RefreshTokenRow[]>`
      SELECT * FROM refresh_token WHERE user_id = ${userId}::uuid`;
  }

  it('stores only the SHA-256 hash: no column of any row contains the plaintext token', async () => {
    const token = await service.issue(userId);

    const rows = await rowsForUser();
    const matching = rows.filter((row) => row.token_hash === sha256Hex(token));

    expect(matching).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);

    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM refresh_token WHERE token_hash = ${token}`;
    expect(count).toBe(0);
  });

  it('rotates through the real unique index and keeps every stored value hashed', async () => {
    const original = await service.issue(userId);

    const { refreshToken: rotated } = await service.rotate(original);

    const rows = await rowsForUser();
    const originalRow = rows.find(
      (row) => row.token_hash === sha256Hex(original),
    );
    const rotatedRow = rows.find(
      (row) => row.token_hash === sha256Hex(rotated),
    );

    expect(originalRow?.used_at).toBeInstanceOf(Date);
    expect(rotatedRow?.used_at).toBeNull();
    expect(rotatedRow?.family_id).toBe(originalRow?.family_id);
    expect(JSON.stringify(rows)).not.toContain(original);
    expect(JSON.stringify(rows)).not.toContain(rotated);
  });

  it('reuse of a rotated token is rejected and revokes the whole family in the database', async () => {
    const original = await service.issue(userId);
    const { refreshToken: rotated } = await service.rotate(original);

    await expect(service.rotate(original)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const rows = await rowsForUser();
    const familyId = rows.find(
      (row) => row.token_hash === sha256Hex(original),
    )?.family_id;
    const family = rows.filter((row) => row.family_id === familyId);

    expect(family).toHaveLength(2);
    expect(family.every((row) => row.revoked_at instanceof Date)).toBe(true);
    await expect(service.rotate(rotated)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('a stored hash copied from the database cannot be redeemed as a token', async () => {
    const token = await service.issue(userId);

    await expect(service.rotate(sha256Hex(token))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
