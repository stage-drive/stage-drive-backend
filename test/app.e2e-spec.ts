import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { requireEnv } from '../src/common/config/env';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

const jwtService = new JwtService({ secret: requireEnv('JWT_ACCESS_SECRET') });
const signAccessToken = (userId: string) => jwtService.sign({ sub: userId });

type TestUser = {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: 'OWNER' | 'INSTRUCTOR' | 'STUDENT';
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
};

type TestOrganization = {
  id: string;
  name: string;
  logoUrl: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
};

describe('API (e2e)', () => {
  let app: INestApplication<App>;
  let passwordHash: string;

  const organization: TestOrganization = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Stage Drive School',
    logoUrl: null,
    timezone: 'Europe/Kyiv',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const owner: TestUser = {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'owner@example.com',
    passwordHash: '',
    firstName: 'Ivan',
    lastName: 'Petrenko',
    phone: null,
    avatarUrl: null,
    role: 'OWNER',
    organizationId: organization.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const prismaMock = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    oAuthAuthorization: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      delete: jest.fn(),
    },
    oAuthAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('Password1', 10);
    owner.passwordHash = passwordHash;
  });

  beforeEach(async () => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.organization.findUnique.mockReset();
    prismaMock.organization.update.mockReset();
    prismaMock.oAuthAuthorization.findUnique.mockReset();
    prismaMock.oAuthAuthorization.create.mockReset();
    prismaMock.oAuthAuthorization.deleteMany.mockReset();
    prismaMock.oAuthAuthorization.delete.mockReset();
    prismaMock.oAuthAccount.findUnique.mockReset();
    prismaMock.oAuthAccount.create.mockReset();

    prismaMock.user.findUnique.mockImplementation(
      (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id === owner.id || args.where.email === owner.email) {
          return Promise.resolve({ ...owner });
        }
        return Promise.resolve(null);
      },
    );
    prismaMock.user.update.mockImplementation(
      (args: { data: Partial<TestUser> }) =>
        Promise.resolve({ ...owner, ...args.data }),
    );
    prismaMock.organization.findUnique.mockResolvedValue({ ...organization });
    prismaMock.organization.update.mockImplementation(
      (args: { data: Partial<TestOrganization> }) =>
        Promise.resolve({ ...organization, ...args.data }),
    );
    prismaMock.oAuthAuthorization.create.mockResolvedValue({});
    prismaMock.oAuthAuthorization.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.oAuthAuthorization.findUnique.mockResolvedValue(null);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / returns Hello World', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('OPTIONS preflight from Vite origin is allowed', () => {
    return request(app.getHttpServer())
      .options('/api/auth/register')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'http://localhost:5173');
  });

  it('GET /api/docs serves Swagger UI', () => {
    return request(app.getHttpServer()).get('/api/docs').expect(200);
  });

  it('GET /api/users/me without token returns 401', () => {
    return request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('GET /api/users/me returns own profile', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: owner.id,
      email: owner.email,
      firstName: owner.firstName,
      lastName: owner.lastName,
      role: 'OWNER',
    });
    expect(
      (response.body as { passwordHash?: string }).passwordHash,
    ).toBeUndefined();
  });

  it('PATCH /api/users/me updates allowed fields', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Petro', phone: '+380000000000' })
      .expect(200);

    expect(response.body).toMatchObject({
      firstName: 'Petro',
      phone: '+380000000000',
    });
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('PATCH /api/users/me/password changes password', async () => {
    const token = signAccessToken(owner.id);
    await request(app.getHttpServer())
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Password1', newPassword: 'Password2' })
      .expect(200);

    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('POST email endpoints are outside MVP', async () => {
    const token = signAccessToken(owner.id);
    await request(app.getHttpServer())
      .post('/api/users/me/email/change')
      .set('Authorization', `Bearer ${token}`)
      .expect(501);
    await request(app.getHttpServer())
      .post('/api/users/me/email/verify')
      .set('Authorization', `Bearer ${token}`)
      .expect(501);
  });

  it('GET /api/auth/google redirects to Google with PKCE', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/google')
      .redirects(0)
      .expect(302);

    expect(response.headers.location).toContain(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(response.headers.location).toContain('code_challenge_method=S256');
    expect(prismaMock.oAuthAuthorization.create).toHaveBeenCalled();
  });

  it('GET /api/auth/google/callback with invalid state is rejected', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/google/callback')
      .query({ code: 'oauth-code', state: 'unknown-state' })
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: 'Не вдалося увійти через Google.',
    });
  });

  it('GET /api/organization returns current organization', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get('/api/organization')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: organization.id,
      name: organization.name,
      timezone: organization.timezone,
    });
  });

  it('PATCH /api/organization updates name for OWNER', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .patch('/api/organization')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New School Name' })
      .expect(200);

    expect(response.body).toMatchObject({ name: 'New School Name' });
  });
});
