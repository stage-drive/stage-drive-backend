import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import {
  ACCESS_DENIED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
} from '../src/modules/auth/auth-access';
import { signAccessToken } from '../src/modules/auth/token';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

type TestUser = {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: 'OWNER' | 'ADMIN' | 'INSTRUCTOR' | 'STUDENT';
  status: 'ACTIVE';
  organizationId: string;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
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
    status: 'ACTIVE',
    organizationId: organization.id,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const instructor: TestUser = {
    id: '55555555-5555-5555-5555-555555555555',
    email: 'instructor@example.com',
    passwordHash: '',
    firstName: 'Oksana',
    lastName: 'Shevchenko',
    phone: null,
    avatarUrl: null,
    role: 'INSTRUCTOR',
    status: 'ACTIVE',
    organizationId: organization.id,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createdAdmin = {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'admin@example.com',
    firstName: 'Olena',
    lastName: 'Koval',
    phone: null,
    role: 'ADMIN',
    status: 'INVITED',
    organizationId: organization.id,
  };

  const createdInvitation = {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'admin@example.com',
    role: 'ADMIN',
    status: 'PENDING',
    expiresAt: new Date('2026-09-20T12:00:00.000Z'),
    userId: createdAdmin.id,
    organizationId: organization.id,
  };

  const mailServiceMock = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };

  const prismaMock = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    invitation: {
      create: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
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
    prismaMock.$queryRaw.mockReset();
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.user.create.mockReset();
    prismaMock.user.delete.mockReset();
    prismaMock.invitation.create.mockReset();
    prismaMock.refreshToken.updateMany.mockReset();
    prismaMock.$transaction.mockReset();
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
        if (
          args.where.id === instructor.id ||
          args.where.email === instructor.email
        ) {
          return Promise.resolve({ ...instructor });
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
    prismaMock.user.create.mockResolvedValue(createdAdmin);
    prismaMock.invitation.create.mockResolvedValue(createdInvitation);
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.$transaction.mockImplementation(
      (cb: (client: typeof prismaMock) => unknown) => cb(prismaMock),
    );
    mailServiceMock.sendEmail.mockReset();
    mailServiceMock.sendEmail.mockResolvedValue(undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(MailService)
      .useValue(mailServiceMock)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / reports healthy when the database is reachable', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);

    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('GET / returns 503 when the database is unreachable', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    await request(app.getHttpServer()).get('/').expect(503);
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

  it('OpenAPI documents GET /api/auth/google', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(paths['/api/auth/google'] ?? paths['/auth/google']).toBeDefined();
    expect(
      paths['/api/auth/google/callback'] ?? paths['/auth/google/callback'],
    ).toBeDefined();
  });

  it('POST /api/auth/login with a wrong password returns 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: owner.email, password: 'WrongPassword' })
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: INVALID_CREDENTIALS_MESSAGE,
    });
  });

  it('POST /api/auth/login with an unknown email returns 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'missing@example.com', password: 'Password1' })
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: INVALID_CREDENTIALS_MESSAGE,
    });
  });

  it('POST /api/auth/login for a blocked user returns 403', async () => {
    prismaMock.user.findUnique.mockImplementation(
      (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id === owner.id || args.where.email === owner.email) {
          return Promise.resolve({ ...owner, status: 'BLOCKED' });
        }
        return Promise.resolve(null);
      },
    );

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: owner.email, password: 'Password1' })
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: ACCESS_DENIED_MESSAGE,
    });
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

  it('POST /api/invitations without token returns 401', () => {
    return request(app.getHttpServer())
      .post('/api/invitations')
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'admin@example.com',
      })
      .expect(401);
  });

  it('POST /api/invitations is forbidden for INSTRUCTOR', async () => {
    const token = signAccessToken(instructor.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'admin@example.com',
      })
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: 'Insufficient permissions',
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/invitations rejects an invalid payload', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: '', lastName: 'Koval', email: 'admin@example.com' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [{ field: 'firstName', message: "Заповніть обов'язкове поле." }],
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/invitations creates an INVITED ADMIN and sends the invitation', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'admin@example.com',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      user: {
        id: createdAdmin.id,
        email: 'admin@example.com',
        firstName: 'Olena',
        lastName: 'Koval',
        role: 'ADMIN',
        status: 'INVITED',
        organizationId: organization.id,
      },
      invitation: {
        id: createdInvitation.id,
        email: 'admin@example.com',
        role: 'ADMIN',
        status: 'PENDING',
        userId: createdAdmin.id,
        organizationId: organization.id,
      },
    });
    expect(response.body).not.toHaveProperty('token');
    expect(mailServiceMock.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@example.com',
        subject: expect.stringContaining(organization.name),
      }),
    );
  });

  it('POST /api/invitations returns 409 when the email already exists', async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: { target: ['email'] },
      }),
    );

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'admin@example.com',
      })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      errors: [
        { field: 'email', message: 'Користувач з таким email уже існує.' },
      ],
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });
});
