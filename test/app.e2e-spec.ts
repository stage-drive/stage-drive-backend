import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import {
  ACCESS_DENIED_MESSAGE,
  ACCOUNT_NOT_ACTIVE_MESSAGE,
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
  role: 'OWNER' | 'ADMIN' | 'TEACHER' | 'INSTRUCTOR' | 'STUDENT';
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

  const admin: TestUser = {
    id: '66666666-6666-6666-6666-666666666666',
    email: 'school-admin@example.com',
    passwordHash: '',
    firstName: 'Maria',
    lastName: 'Ivanenko',
    phone: null,
    avatarUrl: null,
    role: 'ADMIN',
    status: 'ACTIVE',
    organizationId: organization.id,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const teacher: TestUser = {
    id: '88888888-8888-8888-8888-888888888888',
    email: 'theory-teacher@example.com',
    passwordHash: '',
    firstName: 'Taras',
    lastName: 'Melnyk',
    phone: null,
    avatarUrl: null,
    role: 'TEACHER',
    status: 'ACTIVE',
    organizationId: organization.id,
    lastLoginAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const pupil: TestUser = {
    id: '99999999-9999-9999-9999-999999999999',
    email: 'pupil@example.com',
    passwordHash: '',
    firstName: 'Sofiia',
    lastName: 'Bondar',
    phone: null,
    avatarUrl: null,
    role: 'STUDENT',
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
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      groupBy: jest.fn(),
    },
    invitation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    invitationEmailJob: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    group: {
      findUnique: jest.fn(),
    },
    student: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    car: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    enrollment: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
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
    passwordHash = await bcrypt.hash('SecurePassword123', 10);
    owner.passwordHash = passwordHash;
  });

  beforeEach(async () => {
    prismaMock.$queryRaw.mockReset();
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findFirst.mockReset();
    prismaMock.user.update.mockReset();
    prismaMock.user.create.mockReset();
    prismaMock.user.delete.mockReset();
    prismaMock.user.updateMany.mockReset();
    prismaMock.user.findUniqueOrThrow.mockReset();
    prismaMock.user.groupBy.mockReset();
    prismaMock.user.groupBy.mockResolvedValue([]);
    prismaMock.user.findMany.mockReset();
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockReset();
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.invitation.count.mockReset();
    prismaMock.invitation.count.mockResolvedValue(0);
    prismaMock.invitation.create.mockReset();
    prismaMock.invitation.findUnique.mockReset();
    prismaMock.invitation.findUnique.mockResolvedValue(null);
    prismaMock.invitation.findMany.mockReset();
    prismaMock.invitation.findMany.mockResolvedValue([]);
    prismaMock.invitation.update.mockReset();
    prismaMock.invitation.findFirst.mockReset();
    prismaMock.invitation.findFirst.mockResolvedValue(null);
    prismaMock.invitation.updateMany.mockReset();
    prismaMock.invitation.delete.mockReset();
    prismaMock.invitationEmailJob.create.mockReset();
    prismaMock.invitationEmailJob.update.mockReset();
    prismaMock.invitationEmailJob.updateMany.mockReset();
    prismaMock.invitationEmailJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.invitationEmailJob.findUnique.mockReset();
    prismaMock.group.findUnique.mockReset();
    prismaMock.group.findUnique.mockResolvedValue(null);
    prismaMock.student.create.mockReset();
    prismaMock.student.findUnique.mockReset();
    prismaMock.student.findUnique.mockResolvedValue(null);
    prismaMock.student.update.mockReset();
    prismaMock.student.update.mockImplementation(
      (args: {
        data: {
          groupId?: string | null;
          trainingStatus?: string;
          instructorId?: string | null;
          carId?: string | null;
        };
      }) =>
        Promise.resolve({
          id: '12121212-1212-1212-1212-121212121212',
          userId: '77777777-7777-7777-7777-777777777777',
          organizationId: organization.id,
          groupId: args.data.groupId ?? null,
          instructorId: args.data.instructorId ?? null,
          carId: args.data.carId ?? null,
          trainingStatus: args.data.trainingStatus ?? 'ACTIVE',
        }),
    );
    prismaMock.car.findUnique.mockReset();
    prismaMock.car.findUnique.mockResolvedValue(null);
    prismaMock.car.findFirst.mockReset();
    prismaMock.car.findFirst.mockResolvedValue(null);
    prismaMock.car.findMany.mockReset();
    prismaMock.car.findMany.mockResolvedValue([]);
    prismaMock.car.count.mockReset();
    prismaMock.car.count.mockResolvedValue(0);
    prismaMock.car.create.mockReset();
    prismaMock.car.create.mockImplementation(
      (args: {
        data: {
          organizationId: string;
          instructorId: string;
          plateNumber: string;
          category: string;
          transmission: string;
        };
      }) =>
        Promise.resolve({
          id: '37373737-3737-4373-8373-373737373737',
          organizationId: args.data.organizationId,
          instructorId: args.data.instructorId,
          plateNumber: args.data.plateNumber,
          category: args.data.category,
          transmission: args.data.transmission,
          createdAt: new Date('2026-04-01T00:00:00.000Z'),
          updatedAt: new Date('2026-04-01T00:00:00.000Z'),
          instructor: {
            id: args.data.instructorId,
            firstName: instructor.firstName,
            lastName: instructor.lastName,
          },
        }),
    );
    prismaMock.car.update.mockReset();
    prismaMock.car.update.mockImplementation(
      (args: {
        data: {
          plateNumber?: string;
          category?: string;
          transmission?: string;
          instructorId?: string;
        };
      }) =>
        Promise.resolve({
          id: '31313131-3131-4131-8131-313131313131',
          organizationId: organization.id,
          instructorId: args.data.instructorId ?? instructor.id,
          plateNumber: args.data.plateNumber ?? 'AA0001BB',
          category: args.data.category ?? 'B',
          transmission: args.data.transmission ?? 'MANUAL',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          updatedAt: new Date('2026-04-02T00:00:00.000Z'),
          instructor: {
            id: args.data.instructorId ?? instructor.id,
            firstName: instructor.firstName,
            lastName: instructor.lastName,
          },
        }),
    );
    prismaMock.student.findFirst.mockReset();
    prismaMock.student.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.findFirst.mockReset();
    prismaMock.enrollment.findFirst.mockResolvedValue(null);
    prismaMock.enrollment.upsert.mockReset();
    prismaMock.enrollment.upsert.mockResolvedValue({});
    prismaMock.enrollment.updateMany.mockReset();
    prismaMock.enrollment.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.refreshToken.create.mockReset();
    prismaMock.refreshToken.create.mockResolvedValue({});
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
        if (args.where.id === '23232323-2323-4232-8232-232323232323') {
          return Promise.resolve({
            ...instructor,
            id: '23232323-2323-4232-8232-232323232323',
          });
        }
        if (args.where.id === admin.id || args.where.email === admin.email) {
          return Promise.resolve({ ...admin });
        }
        if (args.where.id === teacher.id) {
          return Promise.resolve({ ...teacher });
        }
        if (args.where.id === pupil.id) {
          return Promise.resolve({ ...pupil });
        }
        return Promise.resolve(null);
      },
    );
    prismaMock.user.findFirst.mockImplementation(
      (args: {
        where: { email?: string | { equals?: string }; id?: string };
      }) => {
        const email =
          typeof args.where.email === 'string'
            ? args.where.email
            : args.where.email?.equals;
        return prismaMock.user.findUnique({
          where: { id: args.where.id, email },
        });
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
    prismaMock.user.create.mockImplementation(
      (args: {
        data: {
          email: string;
          firstName: string;
          lastName: string;
          phone: string | null;
          role: TestUser['role'];
          status: string;
          organizationId: string;
        };
      }) =>
        Promise.resolve({
          id:
            args.data.role === 'STUDENT'
              ? '77777777-7777-7777-7777-777777777777'
              : createdAdmin.id,
          email: args.data.email,
          firstName: args.data.firstName,
          lastName: args.data.lastName,
          phone: args.data.phone,
          role: args.data.role,
          status: args.data.status,
          organizationId: args.data.organizationId,
        }),
    );
    prismaMock.invitationEmailJob.create.mockImplementation(
      (args: {
        data: {
          invitationId: string;
          token: string;
          tokenHash: string;
          status: string;
        };
      }) =>
        Promise.resolve({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          invitationId: args.data.invitationId,
          token: args.data.token,
          tokenHash: args.data.tokenHash,
          status: args.data.status,
          attempts: 0,
          lastError: null,
          sentAt: null,
          createdAt: new Date('2026-10-05T10:00:00.000Z'),
        }),
    );
    prismaMock.invitation.create.mockImplementation(
      (args: {
        data: {
          email: string;
          role: TestUser['role'];
          status: string;
          expiresAt: Date;
          userId: string;
          organizationId: string;
        };
      }) =>
        Promise.resolve({
          id: createdInvitation.id,
          email: args.data.email,
          role: args.data.role,
          status: args.data.status,
          expiresAt: args.data.expiresAt,
          userId: args.data.userId,
          organizationId: args.data.organizationId,
        }),
    );
    prismaMock.student.create.mockImplementation(
      (args: {
        data: {
          userId: string;
          organizationId: string;
          groupId: string | null;
          instructorId: string | null;
          carId: string | null;
          trainingStatus?: string;
        };
      }) =>
        Promise.resolve({
          id: '12121212-1212-1212-1212-121212121212',
          userId: args.data.userId,
          organizationId: args.data.organizationId,
          groupId: args.data.groupId,
          instructorId: args.data.instructorId,
          carId: args.data.carId,
          trainingStatus: args.data.trainingStatus ?? 'INVITED',
        }),
    );
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

  it('OpenAPI documents GET and POST /api/auth/google', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (
      response.body as {
        paths: Record<string, { get?: unknown; post?: unknown }>;
      }
    ).paths;
    const google = paths['/api/auth/google'] ?? paths['/auth/google'];
    expect(google).toBeDefined();
    expect(google?.get).toBeDefined();
    expect(google?.post).toBeDefined();
    expect(
      paths['/api/auth/google/callback'] ?? paths['/auth/google/callback'],
    ).toBeDefined();

    const loginExample = (
      response.body as {
        components: {
          schemas: { LoginDto: { properties: { email: { example: string } } } };
        };
      }
    ).components.schemas.LoginDto.properties.email.example;
    expect(loginExample).toBe('owner@example.com');
  });

  it('POST /api/auth/login returns 200 and tokens for the demo owner', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: owner.email, password: 'SecurePassword123' })
      .expect(200);

    expect(response.body).toMatchObject({
      tokenType: 'Bearer',
    });
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('POST /api/auth/register rejects HTML in name fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: 'Автошкола Drive',
        firstName: '<script>alert(1)</script>',
        lastName: 'Петренко',
        email: 'xss@example.com',
        phone: '+380991234567',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
        termsAccepted: true,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'firstName',
          message: 'Поле містить недопустимі символи.',
        },
      ],
    });
  });

  it('POST /api/auth/register rejects a password without an uppercase letter', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        organizationName: 'Автошкола Drive',
        firstName: 'Іван',
        lastName: 'Петренко',
        email: 'weak@example.com',
        password: 'password1!',
        passwordConfirmation: 'password1!',
        termsAccepted: true,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'password',
          message:
            'Пароль має містити щонайменше одну велику літеру, одну малу літеру, одну цифру та один спеціальний символ.',
        },
      ],
    });
  });

  it('POST /api/auth/google without idToken returns 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({})
      .expect(400);
  });

  it('POST /api/auth/google with an invalid idToken returns 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/google')
      .send({ idToken: 'not-a-google-jwt' })
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: 'Не вдалося увійти через Google.',
    });
  });

  it('OpenAPI documents POST /api/invitations/activate', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(
      paths['/api/invitations/activate'] ?? paths['/invitations/activate'],
    ).toBeDefined();
  });

  it('OpenAPI documents POST /api/invitations/verify', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(
      paths['/api/invitations/verify'] ?? paths['/invitations/verify'],
    ).toBeDefined();
  });

  it('OpenAPI documents POST /api/invitations/members', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(
      paths['/api/invitations/members'] ?? paths['/invitations/members'],
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
      .send({ email: 'missing@example.com', password: 'SecurePassword123' })
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
      .send({ email: owner.email, password: 'SecurePassword123' })
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
      .send({ currentPassword: 'SecurePassword123', newPassword: 'Password2!' })
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

  it('GET /api/dashboard without token returns 401', () => {
    return request(app.getHttpServer()).get('/api/dashboard').expect(401);
  });

  it.each(['ADMIN', 'INSTRUCTOR'] as const)(
    'GET /api/dashboard is forbidden for %s',
    async (role) => {
      const actor = role === 'ADMIN' ? admin : instructor;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get('/api/dashboard')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.user.groupBy).not.toHaveBeenCalled();
    },
  );

  it('GET /api/dashboard returns zeros when the school has no extra data', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      status: 'ACTIVE',
      deletedAt: null,
    });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      organization: {
        id: organization.id,
        name: organization.name,
        status: 'ACTIVE',
        logoUrl: null,
        timezone: organization.timezone,
      },
      users: {
        total: 0,
        byRole: {
          OWNER: 0,
          ADMIN: 0,
          TEACHER: 0,
          INSTRUCTOR: 0,
          STUDENT: 0,
        },
        byStatus: {
          INVITED: 0,
          ACTIVE: 0,
          BLOCKED: 0,
          ARCHIVED: 0,
        },
      },
      invitations: { pending: 0, expired: 0 },
    });
    expect(prismaMock.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: organization.id, deletedAt: null },
      }),
    );
  });

  it('GET /api/dashboard returns owner-scoped counts', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      status: 'ACTIVE',
      deletedAt: null,
    });
    prismaMock.user.groupBy.mockResolvedValue([
      { role: 'OWNER', status: 'ACTIVE', _count: { _all: 1 } },
      { role: 'ADMIN', status: 'INVITED', _count: { _all: 1 } },
    ]);
    prismaMock.invitation.count.mockImplementation(
      (args: { where: { expiresAt?: { gt?: Date; lte?: Date } } }) =>
        Promise.resolve(args.where.expiresAt?.gt ? 2 : 1),
    );

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.users).toEqual({
      total: 2,
      byRole: {
        OWNER: 1,
        ADMIN: 1,
        TEACHER: 0,
        INSTRUCTOR: 0,
        STUDENT: 0,
      },
      byStatus: {
        INVITED: 1,
        ACTIVE: 1,
        BLOCKED: 0,
        ARCHIVED: 0,
      },
    });
    expect(response.body.invitations).toEqual({ pending: 2, expired: 1 });
  });

  it('GET /api/dashboard returns 404 when the organization is missing', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
  });

  it('OpenAPI documents GET /api/dashboard', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(paths['/api/dashboard'] ?? paths['/dashboard']).toBeDefined();
  });

  it('GET /api/dashboard/admin without token returns 401', () => {
    return request(app.getHttpServer()).get('/api/dashboard/admin').expect(401);
  });

  it.each(['OWNER', 'INSTRUCTOR'] as const)(
    'GET /api/dashboard/admin is forbidden for %s',
    async (role) => {
      const actor = role === 'OWNER' ? owner : instructor;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get('/api/dashboard/admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.user.groupBy).not.toHaveBeenCalled();
    },
  );

  it('GET /api/dashboard/admin returns zeros when the school has no members', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      status: 'ACTIVE',
      deletedAt: null,
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      organization: {
        id: organization.id,
        name: organization.name,
        logoUrl: null,
        timezone: organization.timezone,
      },
      users: {
        total: 0,
        byRole: {
          TEACHER: 0,
          INSTRUCTOR: 0,
          STUDENT: 0,
        },
        byStatus: {
          INVITED: 0,
          ACTIVE: 0,
          BLOCKED: 0,
          ARCHIVED: 0,
        },
      },
      invitations: { pending: 0, expired: 0 },
    });
    expect(response.body.organization).not.toHaveProperty('status');
    expect(prismaMock.user.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: organization.id,
          deletedAt: null,
          role: { in: ['TEACHER', 'INSTRUCTOR', 'STUDENT'] },
        },
      }),
    );
  });

  it('GET /api/dashboard/admin omits owner-only counts', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      status: 'ACTIVE',
      deletedAt: null,
    });
    prismaMock.user.groupBy.mockResolvedValue([
      { role: 'OWNER', status: 'ACTIVE', _count: { _all: 1 } },
      { role: 'ADMIN', status: 'ACTIVE', _count: { _all: 1 } },
      { role: 'TEACHER', status: 'ACTIVE', _count: { _all: 2 } },
      { role: 'STUDENT', status: 'INVITED', _count: { _all: 3 } },
    ]);
    prismaMock.invitation.count.mockImplementation(
      (args: { where: { expiresAt?: { gt?: Date; lte?: Date } } }) =>
        Promise.resolve(args.where.expiresAt?.gt ? 1 : 0),
    );

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.users).toEqual({
      total: 5,
      byRole: {
        TEACHER: 2,
        INSTRUCTOR: 0,
        STUDENT: 3,
      },
      byStatus: {
        INVITED: 3,
        ACTIVE: 2,
        BLOCKED: 0,
        ARCHIVED: 0,
      },
    });
    expect(response.body.users.byRole).not.toHaveProperty('OWNER');
    expect(response.body.users.byRole).not.toHaveProperty('ADMIN');
    expect(response.body.organization).not.toHaveProperty('status');
    expect(response.body.invitations).toEqual({ pending: 1, expired: 0 });
    expect(prismaMock.invitation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: organization.id,
          role: { in: ['TEACHER', 'INSTRUCTOR', 'STUDENT'] },
        }),
      }),
    );
  });

  it('GET /api/dashboard/admin returns 404 when the organization is missing', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/dashboard/admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
  });

  it('OpenAPI documents GET /api/dashboard/admin', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(
      paths['/api/dashboard/admin'] ?? paths['/dashboard/admin'],
    ).toBeDefined();
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
    expect(response.body.invitation.emailDelivery).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      lastError: null,
      sentAt: null,
    });
    expect(response.body).not.toHaveProperty('token');
    expect(response.body.invitation).not.toHaveProperty('token');
    const queuedToken = (
      prismaMock.invitationEmailJob.create.mock.calls[0][0] as {
        data: { token: string };
      }
    ).data.token;
    expect(JSON.stringify(response.body)).not.toContain(queuedToken);
    expect(prismaMock.invitationEmailJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invitationId: createdInvitation.id,
        status: 'QUEUED',
        token: expect.any(String),
        tokenHash: expect.any(String),
      }),
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/invitations creates an INVITED STUDENT when role is passed', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'student@example.com',
        role: 'STUDENT',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      user: {
        email: 'student@example.com',
        role: 'STUDENT',
        status: 'INVITED',
      },
      invitation: { email: 'student@example.com', role: 'STUDENT' },
    });
  });

  it('POST /api/invitations rejects role OWNER', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'owner2@example.com',
        role: 'OWNER',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'role',
          message:
            'Можна запросити лише ADMIN, TEACHER, INSTRUCTOR або STUDENT.',
        },
      ],
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('GET /api/invitations returns invitations for the caller role', async () => {
    prismaMock.invitation.findMany.mockResolvedValue([
      {
        id: createdInvitation.id,
        email: 'admin@example.com',
        role: 'ADMIN',
        status: 'PENDING',
        expiresAt: createdInvitation.expiresAt,
        userId: createdAdmin.id,
        organizationId: organization.id,
      },
    ]);

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.invitations).toEqual([
      {
        id: createdInvitation.id,
        email: 'admin@example.com',
        role: 'ADMIN',
        status: 'PENDING',
        expiresAt: createdInvitation.expiresAt.toISOString(),
        userId: createdAdmin.id,
        organizationId: organization.id,
        emailDelivery: {
          status: 'NONE',
          attempts: 0,
          lastError: null,
          sentAt: null,
          queuedAt: null,
        },
      },
    ]);
  });

  it('GET /api/invitations/:id returns one invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'PENDING',
      expiresAt: createdInvitation.expiresAt,
      acceptedAt: null,
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: { status: 'INVITED', deletedAt: null },
    });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get(`/api/invitations/${createdInvitation.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: createdInvitation.id,
      role: 'ADMIN',
      status: 'PENDING',
    });
  });

  it('POST /api/invitations/:id/cancel lets OWNER cancel a pending ADMIN invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'PENDING',
      expiresAt: createdInvitation.expiresAt,
      acceptedAt: null,
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: { status: 'INVITED', deletedAt: null },
    });
    prismaMock.invitation.update.mockResolvedValue({
      id: createdInvitation.id,
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'CANCELLED',
      expiresAt: createdInvitation.expiresAt,
      userId: createdAdmin.id,
      organizationId: organization.id,
    });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post(`/api/invitations/${createdInvitation.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: createdInvitation.id,
      status: 'CANCELLED',
      role: 'ADMIN',
    });
  });

  it('POST /api/invitations/:id/resend queues another email without returning the token', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'PENDING',
      expiresAt: createdInvitation.expiresAt,
      acceptedAt: null,
      userId: createdAdmin.id,
      organizationId: organization.id,
      tokenHash: 'old-hash',
      user: { status: 'INVITED', deletedAt: null },
    });
    prismaMock.invitation.update.mockImplementation(
      (args: { data: { expiresAt: Date; tokenHash: string } }) =>
        Promise.resolve({
          id: createdInvitation.id,
          email: 'admin@example.com',
          role: 'ADMIN',
          status: 'PENDING',
          expiresAt: args.data.expiresAt,
          userId: createdAdmin.id,
          organizationId: organization.id,
        }),
    );

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post(`/api/invitations/${createdInvitation.id}/resend`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: createdInvitation.id,
      status: 'PENDING',
      emailDelivery: { status: 'QUEUED', attempts: 0, lastError: null },
    });
    expect(response.body).not.toHaveProperty('token');
    const queuedToken = (
      prismaMock.invitationEmailJob.create.mock.calls[0][0] as {
        data: { token: string };
      }
    ).data.token;
    expect(JSON.stringify(response.body)).not.toContain(queuedToken);
    expect(prismaMock.invitationEmailJob.updateMany).toHaveBeenCalled();
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/invitations/:id/resend rejects a cancelled invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'CANCELLED',
      expiresAt: createdInvitation.expiresAt,
      acceptedAt: null,
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: { status: 'INVITED', deletedAt: null },
    });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post(`/api/invitations/${createdInvitation.id}/resend`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Це запрошення вже скасовано.',
    });
    expect(prismaMock.invitationEmailJob.create).not.toHaveBeenCalled();
  });

  it('POST /api/invitations/:id/cancel is forbidden for ADMIN cancelling an ADMIN invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: 'admin@example.com',
      role: 'ADMIN',
      status: 'PENDING',
      expiresAt: createdInvitation.expiresAt,
      acceptedAt: null,
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: { status: 'INVITED', deletedAt: null },
    });

    const token = signAccessToken(admin.id);
    await request(app.getHttpServer())
      .post(`/api/invitations/${createdInvitation.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(prismaMock.invitation.update).not.toHaveBeenCalled();
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

  it('POST /api/invitations is forbidden for ADMIN', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'another-admin@example.com',
      })
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: 'Insufficient permissions',
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/invitations/members without token returns 401', () => {
    return request(app.getHttpServer())
      .post('/api/invitations/members')
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'teacher@example.com',
        role: 'TEACHER',
      })
      .expect(401);
  });

  it('POST /api/invitations/members is forbidden for OWNER', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'teacher@example.com',
        role: 'TEACHER',
      })
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: 'Insufficient permissions',
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/invitations/members is forbidden for INSTRUCTOR', async () => {
    const token = signAccessToken(instructor.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'teacher@example.com',
        role: 'TEACHER',
      })
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: 'Insufficient permissions',
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'POST /api/invitations/members rejects role %s',
    async (role) => {
      const token = signAccessToken(admin.id);
      const response = await request(app.getHttpServer())
        .post('/api/invitations/members')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Olena',
          lastName: 'Koval',
          email: 'privileged@example.com',
          role,
        })
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        errors: [
          {
            field: 'role',
            message: 'Можна запрошувати лише TEACHER, INSTRUCTOR або STUDENT.',
          },
        ],
      });
      expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('POST /api/invitations/members rejects a payload without role', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'teacher@example.com',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [{ field: 'role', message: "Заповніть обов'язкове поле." }],
    });
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it.each(['TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'POST /api/invitations/members creates an INVITED %s and sends the invitation',
    async (role) => {
      const token = signAccessToken(admin.id);
      const response = await request(app.getHttpServer())
        .post('/api/invitations/members')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Olena',
          lastName: 'Koval',
          email: `new-${role.toLowerCase()}@example.com`,
          role,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        user: {
          email: `new-${role.toLowerCase()}@example.com`,
          firstName: 'Olena',
          lastName: 'Koval',
          role,
          status: 'INVITED',
          organizationId: organization.id,
        },
        invitation: {
          email: `new-${role.toLowerCase()}@example.com`,
          role,
          status: 'PENDING',
          organizationId: organization.id,
        },
      });
      expect(response.body).not.toHaveProperty('token');
      expect(response.body.invitation.emailDelivery).toMatchObject({
        status: 'QUEUED',
      });
      expect(prismaMock.invitationEmailJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'QUEUED',
          token: expect.any(String),
        }),
      });
      expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('POST /api/invitations/members returns 409 when the email already exists', async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.9.1',
        meta: { target: ['email'] },
      }),
    );

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/invitations/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'teacher@example.com',
        role: 'TEACHER',
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

  it('POST /api/invitations/verify accepts a valid token without auth', async () => {
    const token = 'valid-invitation-token';
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: createdAdmin.email,
      role: createdAdmin.role,
      status: 'PENDING',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: createdAdmin.id,
      organizationId: organization.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      user: {
        firstName: createdAdmin.firstName,
        lastName: createdAdmin.lastName,
        status: 'INVITED',
      },
      organization: { name: organization.name },
    });

    const response = await request(app.getHttpServer())
      .post('/api/invitations/verify')
      .send({ token })
      .expect(200);

    expect(response.body).toEqual({
      valid: true,
      email: createdAdmin.email,
      firstName: createdAdmin.firstName,
      lastName: createdAdmin.lastName,
      role: createdAdmin.role,
      status: 'PENDING',
      expiresAt: expect.any(String),
      organizationName: organization.name,
      organizationId: organization.id,
    });
  });

  it('POST /api/invitations/verify rejects an invalid token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/invitations/verify')
      .send({ token: 'unknown-token' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'INVALID_INVITATION_TOKEN',
      message: 'Посилання-запрошення недійсне.',
    });
  });

  it('POST /api/invitations/verify rejects an expired token', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: createdAdmin.email,
      role: createdAdmin.role,
      status: 'PENDING',
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: {
        firstName: createdAdmin.firstName,
        lastName: createdAdmin.lastName,
        status: 'INVITED',
      },
      organization: { name: organization.name },
    });

    const response = await request(app.getHttpServer())
      .post('/api/invitations/verify')
      .send({ token: 'expired-token' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'EXPIRED_INVITATION_TOKEN',
      message: 'Посилання-запрошення прострочене.',
    });
  });

  it('POST /api/invitations/verify rejects a used token', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: createdAdmin.email,
      role: createdAdmin.role,
      status: 'ACCEPTED',
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: {
        firstName: createdAdmin.firstName,
        lastName: createdAdmin.lastName,
        status: 'ACTIVE',
      },
      organization: { name: organization.name },
    });

    const response = await request(app.getHttpServer())
      .post('/api/invitations/verify')
      .send({ token: 'used-token' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'USED_INVITATION_TOKEN',
      message: 'Це запрошення вже використано.',
    });
  });

  it('POST /api/invitations/verify rejects an empty token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/invitations/verify')
      .send({ token: '' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [{ field: 'token', message: "Заповніть обов'язкове поле." }],
    });
  });

  it('POST /api/invitations/verify rejects a cancelled token', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue({
      id: createdInvitation.id,
      email: createdAdmin.email,
      role: createdAdmin.role,
      status: 'CANCELLED',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: {
        firstName: createdAdmin.firstName,
        lastName: createdAdmin.lastName,
        status: 'INVITED',
      },
      organization: { name: organization.name, deletedAt: null },
    });

    const response = await request(app.getHttpServer())
      .post('/api/invitations/verify')
      .send({ token: 'cancelled-token' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'CANCELLED_INVITATION_TOKEN',
      message: 'Це запрошення скасовано.',
    });
  });

  function activatableInvitation(overrides: Record<string, unknown> = {}) {
    return {
      id: createdInvitation.id,
      email: createdAdmin.email,
      role: createdAdmin.role,
      status: 'PENDING',
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: createdAdmin.id,
      organizationId: organization.id,
      user: {
        id: createdAdmin.id,
        firstName: createdAdmin.firstName,
        lastName: createdAdmin.lastName,
        email: createdAdmin.email,
        phone: null,
        status: 'INVITED',
        deletedAt: null,
      },
      organization: { name: organization.name, deletedAt: null },
      ...overrides,
    };
  }

  it('POST /api/invitations/activate sets the password and accepts the invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(activatableInvitation());
    prismaMock.invitation.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({
      ...createdAdmin,
      phone: null,
      status: 'ACTIVE',
    });

    const response = await request(app.getHttpServer())
      .post('/api/invitations/activate')
      .send({
        token: 'valid-invitation-token',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      user: {
        id: createdAdmin.id,
        email: createdAdmin.email,
        status: 'ACTIVE',
      },
      invitation: {
        id: createdInvitation.id,
        status: 'ACCEPTED',
      },
    });
  });

  it('POST /api/invitations/activate rejects an expired invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(
      activatableInvitation({
        expiresAt: new Date(Date.now() - 1000),
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/invitations/activate')
      .send({
        token: 'expired-token',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'EXPIRED_INVITATION_TOKEN',
      message: 'Посилання-запрошення прострочене.',
    });
  });

  it('POST /api/invitations/activate rejects a cancelled invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(
      activatableInvitation({ status: 'CANCELLED' }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/invitations/activate')
      .send({
        token: 'cancelled-token',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'CANCELLED_INVITATION_TOKEN',
      message: 'Це запрошення скасовано.',
    });
  });

  it('POST /api/invitations/activate rejects a reused invitation', async () => {
    prismaMock.invitation.findUnique.mockResolvedValue(
      activatableInvitation({
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        user: {
          id: createdAdmin.id,
          firstName: createdAdmin.firstName,
          lastName: createdAdmin.lastName,
          email: createdAdmin.email,
          phone: null,
          status: 'ACTIVE',
          deletedAt: null,
        },
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/invitations/activate')
      .send({
        token: 'used-token',
        password: 'SecurePassword123!',
        passwordConfirmation: 'SecurePassword123!',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: 'USED_INVITATION_TOKEN',
      message: 'Це запрошення вже використано.',
    });
  });

  it('POST /api/invitations creates a new invitation for an expired invite', async () => {
    const invited = {
      id: createdAdmin.id,
      email: 'admin@example.com',
      firstName: 'Old',
      lastName: 'Name',
      phone: null,
      role: 'ADMIN' as const,
      status: 'INVITED' as const,
      organizationId: organization.id,
      deletedAt: null,
      passwordHash: null,
    };
    prismaMock.user.findUnique.mockImplementation(
      (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id === owner.id || args.where.email === owner.email) {
          return Promise.resolve({ ...owner });
        }
        if (args.where.email === invited.email) {
          return Promise.resolve(invited);
        }
        return Promise.resolve(null);
      },
    );
    prismaMock.user.update.mockResolvedValue({
      ...invited,
      firstName: 'Olena',
      lastName: 'Koval',
    });

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

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.invitation.create).toHaveBeenCalled();
    expect(response.body).toMatchObject({
      user: {
        id: createdAdmin.id,
        email: 'admin@example.com',
        status: 'INVITED',
      },
      invitation: {
        status: 'PENDING',
      },
    });
  });

  const listedStudent = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'olena.koval@example.com',
    firstName: 'Олена',
    lastName: 'Коваль',
    phone: '+380991234567',
    avatarUrl: null,
    role: 'STUDENT' as const,
    status: 'ACTIVE' as const,
    organizationId: organization.id,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
  };

  it('GET /api/students without token returns 401', () => {
    return request(app.getHttpServer()).get('/api/students').expect(401);
  });

  it('GET /api/students rejects an invalid access token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/students')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: 'Invalid access token',
    });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'STUDENT'] as const)(
    'GET /api/students is forbidden for %s',
    async (role) => {
      const actor = role === 'OWNER' ? owner : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get('/api/students')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    },
  );

  it('GET /api/students rejects a blocked caller', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...admin,
      status: 'BLOCKED',
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: ACCOUNT_NOT_ACTIVE_MESSAGE,
    });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'TEACHER', 'INSTRUCTOR'] as const)(
    'GET /api/students returns only the %s organization scope',
    async (role) => {
      const actor =
        role === 'ADMIN' ? admin : role === 'TEACHER' ? teacher : instructor;
      prismaMock.user.findMany.mockResolvedValue([
        listedStudent,
        {
          ...listedStudent,
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          email: 'foreign@example.com',
          organizationId: '22222222-2222-2222-2222-222222222222',
        },
      ]);
      prismaMock.user.count.mockResolvedValue(1);

      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get('/api/students')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({
        students: [
          {
            id: listedStudent.id,
            email: listedStudent.email,
            firstName: listedStudent.firstName,
            lastName: listedStudent.lastName,
            phone: listedStudent.phone,
            avatarUrl: null,
            role: 'STUDENT',
            status: 'ACTIVE',
            organizationId: organization.id,
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(response.body.students[0]).not.toHaveProperty('passwordHash');
      expect(prismaMock.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                organizationId: organization.id,
                role: 'STUDENT',
                deletedAt: null,
              },
            ],
          },
          skip: 0,
          take: 20,
          orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
        }),
      );
    },
  );

  it('GET /api/students applies search, filter, sort and pagination', async () => {
    const token = signAccessToken(admin.id);
    await request(app.getHttpServer())
      .get('/api/students')
      .query({
        search: 'Коваль',
        status: 'ACTIVE',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        page: 2,
        limit: 5,
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const contains = (value: string) => ({
      contains: value,
      mode: 'insensitive',
    });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: organization.id,
              role: 'STUDENT',
              deletedAt: null,
            },
            { status: 'ACTIVE' },
            {
              OR: [
                { firstName: contains('Коваль') },
                { lastName: contains('Коваль') },
                { email: contains('Коваль') },
                { phone: contains('Коваль') },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 5,
        take: 5,
      }),
    );
  });

  it('GET /api/students rejects an unknown query parameter', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/students')
      .query({ organizationId: '22222222-2222-2222-2222-222222222222' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'organizationId',
          message: 'property organizationId should not exist',
        },
      ],
    });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('GET /api/students rejects an invalid status filter', async () => {
    const token = signAccessToken(teacher.id);
    const response = await request(app.getHttpServer())
      .get('/api/students')
      .query({ status: 'DELETED' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'status',
          message: 'status має бути INVITED, ACTIVE, BLOCKED або ARCHIVED.',
        },
      ],
    });
  });

  it('GET /api/students returns 404 when the organization is deleted', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  const createdStudentUserId = '77777777-7777-7777-7777-777777777777';
  const createdStudentProfileId = '12121212-1212-1212-1212-121212121212';
  const schoolGroupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherOrganizationId = '22222222-2222-2222-2222-222222222222';

  it('POST /api/students without token returns 401', () => {
    return request(app.getHttpServer()).post('/api/students').expect(401);
  });

  it.each(['TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'POST /api/students is forbidden for %s',
    async (role) => {
      const actor =
        role === 'TEACHER'
          ? teacher
          : role === 'INSTRUCTOR'
            ? instructor
            : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .post('/api/students')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Olena',
          lastName: 'Koval',
          email: 'new-student@example.com',
        })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('POST /api/students rejects organizationId from the body', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'new-student@example.com',
        organizationId: otherOrganizationId,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'organizationId',
          message: 'property organizationId should not exist',
        },
      ],
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('POST /api/students creates an INVITED student in the caller organization and sends the invitation', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'New-Student@Example.com',
        phone: '+380991234567',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      user: {
        id: createdStudentUserId,
        email: 'new-student@example.com',
        firstName: 'Olena',
        lastName: 'Koval',
        phone: '+380991234567',
        role: 'STUDENT',
        status: 'INVITED',
        organizationId: organization.id,
      },
      student: {
        id: createdStudentProfileId,
        userId: createdStudentUserId,
        organizationId: organization.id,
        groupId: null,
        instructorId: null,
        carId: null,
        trainingStatus: 'INVITED',
      },
      invitation: {
        id: createdInvitation.id,
        email: 'new-student@example.com',
        role: 'STUDENT',
        status: 'PENDING',
        userId: createdStudentUserId,
        organizationId: organization.id,
      },
    });
    expect(response.body).not.toHaveProperty('token');
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'new-student@example.com',
        role: 'STUDENT',
        status: 'INVITED',
        organizationId: organization.id,
        passwordHash: null,
      }),
    });
    expect(prismaMock.student.create).toHaveBeenCalledWith({
      data: {
        userId: createdStudentUserId,
        organizationId: organization.id,
        groupId: null,
        instructorId: null,
        carId: null,
        trainingStatus: 'INVITED',
      },
    });
    expect(response.body.invitation.emailDelivery).toMatchObject({
      status: 'QUEUED',
      attempts: 0,
      lastError: null,
    });
    expect(prismaMock.invitationEmailJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'QUEUED',
        token: expect.any(String),
        tokenHash: expect.any(String),
      }),
    });
    const queuedToken = (
      prismaMock.invitationEmailJob.create.mock.calls[0][0] as {
        data: { token: string };
      }
    ).data.token;
    expect(JSON.stringify(response.body)).not.toContain(queuedToken);
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/students stores groupId when the group belongs to the same organization', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: schoolGroupId,
      organizationId: organization.id,
    });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'grouped-student@example.com',
        groupId: schoolGroupId,
      })
      .expect(201);

    expect(response.body.student).toMatchObject({
      organizationId: organization.id,
      groupId: schoolGroupId,
      instructorId: null,
      carId: null,
    });
    expect(response.body.user.organizationId).toBe(organization.id);
    expect(prismaMock.student.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: organization.id,
        groupId: schoolGroupId,
        instructorId: null,
        carId: null,
      }),
    });
  });

  it('POST /api/students does not create a student from another organization group', async () => {
    prismaMock.group.findUnique.mockResolvedValue({
      id: schoolGroupId,
      organizationId: otherOrganizationId,
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: 'foreign-group@example.com',
        groupId: schoolGroupId,
      })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Group not found',
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.student.create).not.toHaveBeenCalled();
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('POST /api/students returns 409 when the email already exists', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/students')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Olena',
        lastName: 'Koval',
        email: owner.email,
      })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      errors: [
        { field: 'email', message: 'Користувач з таким email уже існує.' },
      ],
    });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(mailServiceMock.sendEmail).not.toHaveBeenCalled();
  });

  it('OpenAPI documents the student collection and card', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    expect(paths['/api/students'] ?? paths['/students']).toBeDefined();
    expect(paths['/api/students/me'] ?? paths['/students/me']).toBeDefined();
    const card = (paths['/api/students/{id}'] ?? paths['/students/{id}']) as
      { get?: unknown; patch?: unknown; delete?: unknown } | undefined;
    expect(card?.get).toBeDefined();
    expect(card?.patch).toBeDefined();
    expect(card?.delete).toBeDefined();
  });

  const studentCardId = '12121212-1212-4212-8212-121212121212';
  const foreignStudentId = 'abababab-abab-4bab-8bab-abababababab';

  function studentCardRecord(
    overrides: {
      id?: string;
      email?: string;
      organizationId?: string;
      deletedAt?: Date | null;
      status?: 'INVITED' | 'ACTIVE' | 'BLOCKED' | 'ARCHIVED';
      groupId?: string | null;
      trainingStatus?:
        | 'INVITED'
        | 'ACTIVE'
        | 'PRACTICE'
        | 'GRADUATED'
        | 'DROPPED'
        | 'ARCHIVED';
      category?: 'A' | 'B' | 'C' | 'D' | null;
      transmission?: 'MANUAL' | 'AUTOMATIC' | null;
    } = {},
  ) {
    const id = overrides.id ?? studentCardId;
    const organizationId = overrides.organizationId ?? organization.id;
    return {
      id,
      email: overrides.email ?? 'olena.koval@example.com',
      firstName: 'Олена',
      lastName: 'Коваль',
      phone: '+380991234567',
      avatarUrl: null,
      role: 'STUDENT' as const,
      status: overrides.status ?? ('ACTIVE' as const),
      organizationId,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      deletedAt: overrides.deletedAt ?? null,
      studentProfile: {
        id: createdStudentProfileId,
        userId: id,
        organizationId,
        groupId: overrides.groupId ?? null,
        instructorId: null,
        carId: null,
        category: overrides.category ?? null,
        transmission: overrides.transmission ?? null,
        trainingStatus: overrides.trainingStatus ?? 'ACTIVE',
      },
    };
  }

  function mockStudentCard(
    record: ReturnType<typeof studentCardRecord> | null,
  ) {
    prismaMock.user.findFirst.mockImplementation(
      (args: {
        where: { id?: string; organizationId?: string; role?: string };
      }) => {
        if (!record || args.where.id !== record.id) {
          return Promise.resolve(null);
        }
        if (
          args.where.organizationId &&
          args.where.organizationId !== record.organizationId
        ) {
          return Promise.resolve(null);
        }
        if (args.where.role && args.where.role !== record.role) {
          return Promise.resolve(null);
        }
        return Promise.resolve(record);
      },
    );
  }

  function ownStudentRecord(
    overrides: Parameters<typeof studentCardRecord>[0] = {},
  ) {
    return studentCardRecord({
      id: pupil.id,
      email: pupil.email,
      ...overrides,
    });
  }

  it('GET /api/students/me without token returns 401', () => {
    return request(app.getHttpServer()).get('/api/students/me').expect(401);
  });

  it('GET /api/students/me rejects an invalid access token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/students/me')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: 'Invalid access token',
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('GET /api/students/me rejects a blocked student', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...pupil,
      status: 'BLOCKED',
    });

    const token = signAccessToken(pupil.id);
    const response = await request(app.getHttpServer())
      .get('/api/students/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: ACCOUNT_NOT_ACTIVE_MESSAGE,
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN', 'TEACHER', 'INSTRUCTOR'] as const)(
    'GET /api/students/me does not expand access for %s',
    async (role) => {
      const actor =
        role === 'OWNER'
          ? owner
          : role === 'ADMIN'
            ? admin
            : role === 'TEACHER'
              ? teacher
              : instructor;
      mockStudentCard(studentCardRecord());

      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get('/api/students/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    },
  );

  it('GET /api/students/me returns only the caller student profile', async () => {
    const record = {
      ...ownStudentRecord(),
      firstName: pupil.firstName,
      lastName: pupil.lastName,
      phone: pupil.phone,
    };
    prismaMock.user.findFirst.mockResolvedValue(record);

    const token = signAccessToken(pupil.id);
    const response = await request(app.getHttpServer())
      .get('/api/students/me')
      .query({
        userId: foreignStudentId,
        organizationId: '22222222-2222-2222-2222-222222222222',
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      id: pupil.id,
      email: pupil.email,
      firstName: pupil.firstName,
      lastName: pupil.lastName,
      phone: null,
      avatarUrl: null,
      role: 'STUDENT',
      status: 'ACTIVE',
      organizationId: organization.id,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      student: {
        id: createdStudentProfileId,
        userId: pupil.id,
        organizationId: organization.id,
        groupId: null,
        instructorId: null,
        carId: null,
        category: null,
        transmission: null,
        trainingStatus: 'ACTIVE',
      },
    });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('deletedAt');
    expect(response.body.student.userId).toBe(pupil.id);
    expect(response.body.organizationId).toBe(organization.id);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: pupil.id,
          organizationId: organization.id,
          role: 'STUDENT',
          deletedAt: null,
          studentProfile: {
            is: {
              userId: pupil.id,
              organizationId: organization.id,
            },
          },
        },
      }),
    );
  });

  it('GET /api/students/me does not return another student', async () => {
    prismaMock.user.findFirst.mockResolvedValue(
      studentCardRecord({
        id: foreignStudentId,
        email: 'foreign-student@example.com',
        organizationId: '22222222-2222-2222-2222-222222222222',
      }),
    );

    const token = signAccessToken(pupil.id);
    const response = await request(app.getHttpServer())
      .get('/api/students/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
    expect(JSON.stringify(response.body)).not.toContain(
      'foreign-student@example.com',
    );
    expect(JSON.stringify(response.body)).not.toContain(foreignStudentId);
  });

  it('GET /api/students/me returns 404 when the student profile is missing', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const token = signAccessToken(pupil.id);
    const response = await request(app.getHttpServer())
      .get('/api/students/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
  });

  it('GET /api/students/:id without token returns 401', () => {
    return request(app.getHttpServer())
      .get(`/api/students/${studentCardId}`)
      .expect(401);
  });

  it('GET /api/students/:id rejects an id that is not a UUID', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/students/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400 });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('GET /api/students/:id is forbidden for STUDENT', async () => {
    const token = signAccessToken(pupil.id);
    const response = await request(app.getHttpServer())
      .get(`/api/students/${studentCardId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body).toMatchObject({
      statusCode: 403,
      message: 'Insufficient permissions',
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN', 'TEACHER', 'INSTRUCTOR'] as const)(
    'GET /api/students/:id returns the student card for %s',
    async (role) => {
      const actor =
        role === 'OWNER'
          ? owner
          : role === 'ADMIN'
            ? admin
            : role === 'TEACHER'
              ? teacher
              : instructor;
      mockStudentCard(studentCardRecord());

      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get(`/api/students/${studentCardId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({
        id: studentCardId,
        email: 'olena.koval@example.com',
        firstName: 'Олена',
        lastName: 'Коваль',
        phone: '+380991234567',
        avatarUrl: null,
        role: 'STUDENT',
        status: 'ACTIVE',
        organizationId: organization.id,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        student: {
          id: createdStudentProfileId,
          userId: studentCardId,
          organizationId: organization.id,
          groupId: null,
          instructorId: null,
          carId: null,
          category: null,
          transmission: null,
          trainingStatus: 'ACTIVE',
        },
      });
      expect(response.body).not.toHaveProperty('passwordHash');
      expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: studentCardId,
            organizationId: organization.id,
            role: 'STUDENT',
            deletedAt: null,
          },
        }),
      );
    },
  );

  it('GET /api/students/:id does not return a student of another organization', async () => {
    const foreign = studentCardRecord({
      id: foreignStudentId,
      email: 'foreign-student@example.com',
      organizationId: otherOrganizationId,
    });
    prismaMock.user.findFirst.mockImplementation(
      (args: { where: { id?: string; organizationId?: string } }) => {
        if (args.where.id !== foreign.id) {
          return Promise.resolve(null);
        }
        if (args.where.organizationId === organization.id) {
          return Promise.resolve(null);
        }
        return Promise.resolve(foreign);
      },
    );

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get(`/api/students/${foreignStudentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
    expect(response.body).not.toHaveProperty('email');
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: foreignStudentId,
          organizationId: organization.id,
          role: 'STUDENT',
          deletedAt: null,
        }),
      }),
    );
  });

  it('GET /api/students/:id returns 404 when the organization is deleted', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get(`/api/students/${studentCardId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id without token returns 401', () => {
    return request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}`)
      .send({ firstName: 'Ірина' })
      .expect(401);
  });

  it.each(['TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'PATCH /api/students/:id is forbidden for %s',
    async (role) => {
      const actor =
        role === 'TEACHER'
          ? teacher
          : role === 'INSTRUCTOR'
            ? instructor
            : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .patch(`/api/students/${studentCardId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Ірина' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    },
  );

  it.each(['role', 'organizationId', 'status'] as const)(
    'PATCH /api/students/:id rejects %s and does not write it',
    async (field) => {
      mockStudentCard(studentCardRecord());
      const token = signAccessToken(admin.id);
      const value =
        field === 'role'
          ? 'ADMIN'
          : field === 'status'
            ? 'BLOCKED'
            : otherOrganizationId;
      const response = await request(app.getHttpServer())
        .patch(`/api/students/${studentCardId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Ірина', [field]: value })
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        errors: [
          {
            field,
            message: `property ${field} should not exist`,
          },
        ],
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    },
  );

  it('PATCH /api/students/:id updates allowed fields and keeps role, organization and status', async () => {
    const record = studentCardRecord({ status: 'INVITED' });
    mockStudentCard(record);
    prismaMock.user.update.mockImplementation(
      (args: { data: { firstName?: string; phone?: string | null } }) =>
        Promise.resolve({ ...record, ...args.data }),
    );

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: '  Ірина ', phone: '+380671112233' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: studentCardId,
      firstName: 'Ірина',
      phone: '+380671112233',
      role: 'STUDENT',
      status: 'INVITED',
      organizationId: organization.id,
    });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: studentCardId },
        data: { firstName: 'Ірина', phone: '+380671112233' },
      }),
    );
    const updateData = (
      prismaMock.user.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ]
    )[0].data;
    expect(updateData).not.toHaveProperty('role');
    expect(updateData).not.toHaveProperty('organizationId');
    expect(updateData).not.toHaveProperty('status');
  });

  it('PATCH /api/students/:id rejects an empty body', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'body',
          message:
            'Немає дозволених полів для оновлення (firstName, lastName, phone).',
        },
      ],
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id does not update a student of another organization', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${foreignStudentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lastName: 'Чужа' })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  const assignableGroupId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const currentGroupId = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';

  function mockAssignableGroup(
    group: {
      id: string;
      organizationId: string;
      status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
    } | null,
  ) {
    prismaMock.group.findUnique.mockImplementation(
      (args: { where: { id: string } }) => {
        if (!group || args.where.id !== group.id) {
          if (args.where.id === currentGroupId) {
            return Promise.resolve({
              id: currentGroupId,
              organizationId: organization.id,
              status: 'ACTIVE',
            });
          }
          return Promise.resolve(group);
        }
        return Promise.resolve(group);
      },
    );
  }

  it('PATCH /api/students/:id/group without token returns 401', () => {
    return request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/group`)
      .send({ groupId: assignableGroupId })
      .expect(401);
  });

  it.each(['TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'PATCH /api/students/:id/group is forbidden for %s',
    async (role) => {
      const actor =
        role === 'TEACHER'
          ? teacher
          : role === 'INSTRUCTOR'
            ? instructor
            : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .patch(`/api/students/${studentCardId}/group`)
        .set('Authorization', `Bearer ${token}`)
        .send({ groupId: assignableGroupId })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.student.update).not.toHaveBeenCalled();
    },
  );

  it('PATCH /api/students/:id/group updates groupId for an admin', async () => {
    mockStudentCard(studentCardRecord());
    mockAssignableGroup({
      id: assignableGroupId,
      organizationId: organization.id,
      status: 'ACTIVE',
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/group`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: assignableGroupId })
      .expect(200);

    expect(response.body.student).toMatchObject({
      groupId: assignableGroupId,
      organizationId: organization.id,
    });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: createdStudentProfileId },
      data: { groupId: assignableGroupId },
    });
    expect(prismaMock.enrollment.upsert).toHaveBeenCalledWith({
      where: {
        groupId_studentId: {
          groupId: assignableGroupId,
          studentId: studentCardId,
        },
      },
      create: {
        groupId: assignableGroupId,
        studentId: studentCardId,
        status: 'ACTIVE',
      },
      update: { status: 'ACTIVE' },
    });
  });

  it('PATCH /api/students/:id/group rejects a group from another organization', async () => {
    mockStudentCard(studentCardRecord());
    mockAssignableGroup({
      id: assignableGroupId,
      organizationId: otherOrganizationId,
      status: 'ACTIVE',
    });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/group`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: assignableGroupId })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Group not found',
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/group does not assign a student of another organization', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${foreignStudentId}/group`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: assignableGroupId })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/group rejects an archived student', async () => {
    mockStudentCard(studentCardRecord({ status: 'ARCHIVED' }));

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/group`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: assignableGroupId })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      message:
        'Студента зі статусом ARCHIVED, DROPPED або GRADUATED не можна призначити до групи.',
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it.each(['ARCHIVED', 'COMPLETED'] as const)(
    'PATCH /api/students/:id/group rejects a %s group',
    async (status) => {
      mockStudentCard(studentCardRecord());
      mockAssignableGroup({
        id: assignableGroupId,
        organizationId: organization.id,
        status,
      });

      const token = signAccessToken(admin.id);
      const response = await request(app.getHttpServer())
        .patch(`/api/students/${studentCardId}/group`)
        .set('Authorization', `Bearer ${token}`)
        .send({ groupId: assignableGroupId })
        .expect(409);

      expect(response.body).toMatchObject({
        statusCode: 409,
        message:
          'Групу зі статусом ARCHIVED або COMPLETED не можна призначити.',
      });
      expect(prismaMock.student.update).not.toHaveBeenCalled();
    },
  );

  it('PATCH /api/students/:id/group rejects a dropped or graduated student', async () => {
    mockStudentCard(studentCardRecord());
    prismaMock.enrollment.findFirst.mockResolvedValue({
      id: 'enr-dropped',
      status: 'DROPPED',
      groupId: currentGroupId,
      studentId: studentCardId,
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/group`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: assignableGroupId })
      .expect(409);

    expect(response.body.message).toContain('DROPPED');
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/group rejects a student already in another active group', async () => {
    mockStudentCard(studentCardRecord({ groupId: currentGroupId }));
    mockAssignableGroup({
      id: assignableGroupId,
      organizationId: organization.id,
      status: 'ACTIVE',
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/group`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: assignableGroupId })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      message: 'Студент уже перебуває в іншій активній групі.',
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/group rejects an invalid groupId', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/group`)
      .set('Authorization', `Bearer ${token}`)
      .send({ groupId: 'not-a-uuid' })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [{ field: 'groupId', message: 'groupId має бути UUID.' }],
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('OpenAPI documents student group assignment', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    const assignment = (paths['/api/students/{id}/group'] ??
      paths['/students/{id}/group']) as { patch?: unknown } | undefined;
    expect(assignment?.patch).toBeDefined();
  });

  it('PATCH /api/students/:id/status without token returns 401', () => {
    return request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/status`)
      .send({ status: 'GRADUATED' })
      .expect(401);
  });

  it.each(['OWNER', 'TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'PATCH /api/students/:id/status is forbidden for %s',
    async (role) => {
      const actor =
        role === 'OWNER'
          ? owner
          : role === 'TEACHER'
            ? teacher
            : role === 'INSTRUCTOR'
              ? instructor
              : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .patch(`/api/students/${studentCardId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'GRADUATED' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.student.update).not.toHaveBeenCalled();
    },
  );

  it('PATCH /api/students/:id/status stores an allowed transition for ADMIN', async () => {
    mockStudentCard(studentCardRecord({ trainingStatus: 'ACTIVE' }));

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'GRADUATED' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: studentCardId,
      role: 'STUDENT',
      status: 'ACTIVE',
      organizationId: organization.id,
      student: {
        id: createdStudentProfileId,
        trainingStatus: 'GRADUATED',
      },
    });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: createdStudentProfileId },
      data: { trainingStatus: 'GRADUATED' },
    });
    expect(prismaMock.enrollment.updateMany).toHaveBeenCalledWith({
      where: {
        studentId: studentCardId,
        status: 'ACTIVE',
        group: { organizationId: organization.id },
      },
      data: { status: 'COMPLETED' },
    });
  });

  it('PATCH /api/students/:id/status rejects a forbidden transition', async () => {
    mockStudentCard(studentCardRecord({ trainingStatus: 'ARCHIVED' }));

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' })
      .expect(409);

    expect(response.body.message).toContain('ARCHIVED → ACTIVE');
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/status does not change a student of another organization', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${foreignStudentId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/status returns 404 when the organization is deleted', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ARCHIVED' })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/status rejects an unknown status', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'BLOCKED' })
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400 });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('OpenAPI documents student training status changes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    const status = (paths['/api/students/{id}/status'] ??
      paths['/students/{id}/status']) as { patch?: unknown } | undefined;
    expect(status?.patch).toBeDefined();
  });

  const practiceInstructorId = '23232323-2323-4232-8232-232323232323';
  const practiceCarId = '31313131-3131-4131-8131-313131313131';

  function mockPracticeInstructor(record: {
    id?: string;
    role?: string;
    status?: string;
    organizationId?: string;
    deletedAt?: Date | null;
  }) {
    const findUnique = prismaMock.user.findUnique.getMockImplementation();
    prismaMock.user.findUnique.mockImplementation(
      (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id === (record.id ?? practiceInstructorId)) {
          return Promise.resolve({
            id: practiceInstructorId,
            role: 'INSTRUCTOR',
            status: 'ACTIVE',
            organizationId: organization.id,
            deletedAt: null,
            ...record,
          });
        }
        return findUnique?.(args);
      },
    );
  }

  it('PATCH /api/students/:id/practice-access without token returns 401', () => {
    return request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/practice-access`)
      .send({ instructorId: practiceInstructorId, carId: practiceCarId })
      .expect(401);
  });

  it.each(['OWNER', 'TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'PATCH /api/students/:id/practice-access is forbidden for %s',
    async (role) => {
      const actor =
        role === 'OWNER'
          ? owner
          : role === 'TEACHER'
            ? teacher
            : role === 'INSTRUCTOR'
              ? instructor
              : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .patch(`/api/students/${studentCardId}/practice-access`)
        .set('Authorization', `Bearer ${token}`)
        .send({ instructorId: practiceInstructorId, carId: practiceCarId })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.student.update).not.toHaveBeenCalled();
    },
  );

  it('PATCH /api/students/:id/practice-access grants PRACTICE for ADMIN', async () => {
    mockStudentCard(
      studentCardRecord({
        trainingStatus: 'ACTIVE',
        category: 'B',
        transmission: 'MANUAL',
      }),
    );
    mockPracticeInstructor({});
    prismaMock.car.findUnique.mockResolvedValue({
      id: practiceCarId,
      organizationId: organization.id,
      instructorId: practiceInstructorId,
      category: 'B',
      transmission: 'MANUAL',
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/practice-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructorId: practiceInstructorId, carId: practiceCarId })
      .expect(200);

    expect(response.body).toMatchObject({
      id: studentCardId,
      role: 'STUDENT',
      status: 'ACTIVE',
      student: {
        instructorId: practiceInstructorId,
        carId: practiceCarId,
        category: 'B',
        transmission: 'MANUAL',
        trainingStatus: 'PRACTICE',
      },
    });
    expect(prismaMock.student.update).toHaveBeenCalledWith({
      where: { id: createdStudentProfileId },
      data: {
        instructorId: practiceInstructorId,
        carId: practiceCarId,
        trainingStatus: 'PRACTICE',
      },
    });
  });

  it('PATCH /api/students/:id/practice-access rejects a mismatched car', async () => {
    mockStudentCard(
      studentCardRecord({ category: 'B', transmission: 'MANUAL' }),
    );
    mockPracticeInstructor({});
    prismaMock.car.findUnique.mockResolvedValue({
      id: practiceCarId,
      organizationId: organization.id,
      instructorId: practiceInstructorId,
      category: 'B',
      transmission: 'AUTOMATIC',
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/practice-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructorId: practiceInstructorId, carId: practiceCarId })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      message: 'Некоректна комбінація інструктора та автомобіля.',
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/practice-access rejects a new booking for an archived student', async () => {
    mockStudentCard(
      studentCardRecord({
        status: 'ARCHIVED',
        trainingStatus: 'ARCHIVED',
      }),
    );

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/practice-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructorId: practiceInstructorId, carId: practiceCarId })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      message:
        'Архівованому студенту не можна створювати нове бронювання практики.',
    });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/practice-access rejects a student who is not eligible', async () => {
    mockStudentCard(studentCardRecord({ trainingStatus: 'GRADUATED' }));

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/practice-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructorId: practiceInstructorId, carId: practiceCarId })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      message: 'Студент не має права на допуск до практичного навчання.',
    });
    expect(prismaMock.car.findUnique).not.toHaveBeenCalled();
  });

  it('PATCH /api/students/:id/practice-access does not change a student of another organization', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${foreignStudentId}/practice-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructorId: practiceInstructorId, carId: practiceCarId })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
  });

  it('PATCH /api/students/:id/practice-access rejects an invalid body', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/students/${studentCardId}/practice-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ instructorId: 'not-a-uuid' })
      .expect(400);

    expect(response.body).toMatchObject({ statusCode: 400 });
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it('DELETE /api/students/:id without token returns 401', () => {
    return request(app.getHttpServer())
      .delete(`/api/students/${studentCardId}`)
      .expect(401);
  });

  it.each(['TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'DELETE /api/students/:id is forbidden for %s',
    async (role) => {
      const actor =
        role === 'TEACHER'
          ? teacher
          : role === 'INSTRUCTOR'
            ? instructor
            : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .delete(`/api/students/${studentCardId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.user.delete).not.toHaveBeenCalled();
    },
  );

  it.each(['OWNER', 'ADMIN'] as const)(
    'DELETE /api/students/:id archives the student for %s and keeps the row',
    async (role) => {
      mockStudentCard(studentCardRecord({ trainingStatus: 'PRACTICE' }));
      const actor = role === 'OWNER' ? owner : admin;
      const token = signAccessToken(actor.id);

      const response = await request(app.getHttpServer())
        .delete(`/api/students/${studentCardId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: studentCardId,
        role: 'STUDENT',
        status: 'ARCHIVED',
        organizationId: organization.id,
        student: {
          id: createdStudentProfileId,
          trainingStatus: 'ARCHIVED',
        },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: studentCardId },
        data: { status: 'ARCHIVED' },
      });
      expect(prismaMock.student.update).toHaveBeenCalledWith({
        where: { id: createdStudentProfileId },
        data: { trainingStatus: 'ARCHIVED' },
      });
      expect(prismaMock.user.delete).not.toHaveBeenCalled();
      expect(prismaMock.enrollment.updateMany).not.toHaveBeenCalled();
    },
  );

  it('DELETE /api/students/:id does not archive a student of another organization', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .delete(`/api/students/${foreignStudentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Student not found',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('DELETE /api/students/:id returns 404 when the organization is deleted', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .delete(`/api/students/${studentCardId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('OpenAPI documents student practice access', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    const access = (paths['/api/students/{id}/practice-access'] ??
      paths['/students/{id}/practice-access']) as
      { patch?: unknown } | undefined;
    expect(access?.patch).toBeDefined();
  });

  const listedCar = {
    id: '31313131-3131-4131-8131-313131313131',
    organizationId: organization.id,
    instructorId: instructor.id,
    plateNumber: 'AA0001BB',
    category: 'B' as const,
    transmission: 'MANUAL' as const,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    instructor: {
      id: instructor.id,
      firstName: instructor.firstName,
      lastName: instructor.lastName,
    },
  };

  it('GET /api/cars without token returns 401', () => {
    return request(app.getHttpServer()).get('/api/cars').expect(401);
  });

  it('GET /api/cars rejects an invalid access token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/cars')
      .set('Authorization', 'Bearer not-a-token')
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: 'Invalid access token',
    });
    expect(prismaMock.car.findMany).not.toHaveBeenCalled();
  });

  it.each(['TEACHER', 'STUDENT'] as const)(
    'GET /api/cars is forbidden for %s',
    async (role) => {
      const actor = role === 'TEACHER' ? teacher : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get('/api/cars')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.car.findMany).not.toHaveBeenCalled();
    },
  );

  it('GET /api/cars rejects a blocked caller', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...admin,
      status: 'BLOCKED',
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      message: ACCOUNT_NOT_ACTIVE_MESSAGE,
    });
    expect(prismaMock.car.findMany).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN'] as const)(
    'GET /api/cars returns only the %s organization scope',
    async (role) => {
      const actor = role === 'OWNER' ? owner : admin;
      prismaMock.car.findMany.mockResolvedValue([
        listedCar,
        {
          ...listedCar,
          id: '36363636-3636-4363-8363-363636363636',
          organizationId: '22222222-2222-2222-2222-222222222222',
          plateNumber: 'AA0005BB',
        },
      ]);
      prismaMock.car.count.mockResolvedValue(1);

      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .get('/api/cars')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({
        cars: [
          {
            id: listedCar.id,
            organizationId: organization.id,
            instructorId: instructor.id,
            instructor: listedCar.instructor,
            plateNumber: 'AA0001BB',
            category: 'B',
            transmission: 'MANUAL',
            createdAt: '2026-01-02T00:00:00.000Z',
            updatedAt: '2026-01-03T00:00:00.000Z',
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
      expect(response.body.cars[0].instructor).not.toHaveProperty('email');
      expect(prismaMock.car.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ organizationId: organization.id }],
          },
          skip: 0,
          take: 20,
          orderBy: [{ plateNumber: 'asc' }, { id: 'asc' }],
        }),
      );
    },
  );

  it('GET /api/cars limits an instructor to assigned cars', async () => {
    prismaMock.car.findMany.mockResolvedValue([
      listedCar,
      {
        ...listedCar,
        id: '35353535-3535-4353-8353-353535353535',
        instructorId: '24242424-2424-4242-8242-242424242424',
        plateNumber: 'AA0004BB',
        instructor: {
          id: '24242424-2424-4242-8242-242424242424',
          firstName: 'Bohdan',
          lastName: 'Kovalenko',
        },
      },
    ]);
    prismaMock.car.count.mockResolvedValue(1);

    const token = signAccessToken(instructor.id);
    const response = await request(app.getHttpServer())
      .get('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.cars.map((car: { id: string }) => car.id)).toEqual([
      listedCar.id,
    ]);
    expect(prismaMock.car.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              organizationId: organization.id,
              instructorId: instructor.id,
            },
          ],
        },
      }),
    );
  });

  it('GET /api/cars applies search, filters, sort and pagination', async () => {
    const token = signAccessToken(owner.id);
    await request(app.getHttpServer())
      .get('/api/cars')
      .query({
        search: 'AA0001',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: '23232323-2323-4232-8232-232323232323',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        page: 2,
        limit: 5,
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(prismaMock.car.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { organizationId: organization.id },
            { category: 'B' },
            { transmission: 'MANUAL' },
            { instructorId: '23232323-2323-4232-8232-232323232323' },
            {
              plateNumber: { contains: 'AA0001', mode: 'insensitive' },
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 5,
        take: 5,
      }),
    );
  });

  it('GET /api/cars rejects an unknown query parameter', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/cars')
      .query({ organizationId: '22222222-2222-2222-2222-222222222222' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'organizationId',
          message: 'property organizationId should not exist',
        },
      ],
    });
    expect(prismaMock.car.findMany).not.toHaveBeenCalled();
  });

  it('GET /api/cars rejects an invalid category filter', async () => {
    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .get('/api/cars')
      .query({ category: 'Z' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'category',
          message: 'category має бути A, B, C або D.',
        },
      ],
    });
  });

  it('GET /api/cars returns 404 when the organization is deleted', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .get('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
    expect(prismaMock.car.findMany).not.toHaveBeenCalled();
  });

  it('OpenAPI documents the car collection', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = (response.body as { paths: Record<string, unknown> }).paths;
    const cars = (paths['/api/cars'] ?? paths['/cars']) as
      { get?: unknown; post?: unknown } | undefined;
    const car = (paths['/api/cars/{id}'] ?? paths['/cars/{id}']) as
      { patch?: unknown } | undefined;
    expect(cars?.get).toBeDefined();
    expect(cars?.post).toBeDefined();
    expect(car?.patch).toBeDefined();
  });

  const createdCarId = '37373737-3737-4373-8373-373737373737';
  const writableInstructorId = '23232323-2323-4232-8232-232323232323';

  it('POST /api/cars without token returns 401', () => {
    return request(app.getHttpServer())
      .post('/api/cars')
      .send({
        plateNumber: 'AA0003BB',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: instructor.id,
      })
      .expect(401);
  });

  it.each(['TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'POST /api/cars is forbidden for %s',
    async (role) => {
      const actor =
        role === 'TEACHER'
          ? teacher
          : role === 'INSTRUCTOR'
            ? instructor
            : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .post('/api/cars')
        .set('Authorization', `Bearer ${token}`)
        .send({
          plateNumber: 'AA0003BB',
          category: 'B',
          transmission: 'MANUAL',
          instructorId: instructor.id,
        })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.car.create).not.toHaveBeenCalled();
    },
  );

  it('POST /api/cars rejects organizationId from the body', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plateNumber: 'AA0003BB',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: writableInstructorId,
        organizationId: otherOrganizationId,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'organizationId',
          message: 'property organizationId should not exist',
        },
      ],
    });
    expect(prismaMock.car.create).not.toHaveBeenCalled();
  });

  it('POST /api/cars rejects a missing plate and an invalid category', async () => {
    const token = signAccessToken(owner.id);
    const missing = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'B',
        transmission: 'MANUAL',
        instructorId: writableInstructorId,
      })
      .expect(400);

    expect(missing.body).toMatchObject({
      statusCode: 400,
      errors: [
        { field: 'plateNumber', message: "Заповніть обов'язкове поле." },
      ],
    });

    const invalid = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plateNumber: 'AA0003BB',
        category: 'Z',
        transmission: 'MANUAL',
        instructorId: writableInstructorId,
      })
      .expect(400);

    expect(invalid.body).toMatchObject({
      statusCode: 400,
      errors: [
        { field: 'category', message: 'category має бути A, B, C або D.' },
      ],
    });
    expect(prismaMock.car.create).not.toHaveBeenCalled();
  });

  it('POST /api/cars creates a car in the caller organization', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plateNumber: ' aa-0003-bb ',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: writableInstructorId,
      })
      .expect(201);

    expect(response.body).toEqual({
      id: createdCarId,
      organizationId: organization.id,
      instructorId: writableInstructorId,
      instructor: {
        id: writableInstructorId,
        firstName: instructor.firstName,
        lastName: instructor.lastName,
      },
      plateNumber: 'AA0003BB',
      category: 'B',
      transmission: 'MANUAL',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(response.body.instructor).not.toHaveProperty('email');
    expect(prismaMock.car.create).toHaveBeenCalledWith({
      data: {
        organizationId: organization.id,
        instructorId: writableInstructorId,
        plateNumber: 'AA0003BB',
        category: 'B',
        transmission: 'MANUAL',
      },
      select: expect.any(Object),
    });
  });

  it('POST /api/cars does not accept an instructor from another organization', async () => {
    const foreignInstructorId = '24242424-2424-4242-8242-242424242424';
    prismaMock.user.findUnique.mockImplementation(
      (args: { where: { id?: string; email?: string } }) => {
        if (args.where.id === foreignInstructorId) {
          return Promise.resolve({
            ...instructor,
            id: foreignInstructorId,
            organizationId: otherOrganizationId,
          });
        }
        if (args.where.id === admin.id) {
          return Promise.resolve({ ...admin });
        }
        return Promise.resolve(null);
      },
    );

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plateNumber: 'AA0003BB',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: foreignInstructorId,
      })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Instructor not found',
    });
    expect(prismaMock.car.create).not.toHaveBeenCalled();
  });

  it('POST /api/cars returns 409 when the plate already exists', async () => {
    prismaMock.car.findFirst.mockResolvedValue({ id: listedCar.id });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plateNumber: 'AA0001BB',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: writableInstructorId,
      })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      errors: [
        {
          field: 'plateNumber',
          message: 'Автомобіль з таким номером уже є в цій автошколі.',
        },
      ],
    });
    expect(prismaMock.car.create).not.toHaveBeenCalled();
  });

  it('POST /api/cars rejects an instructor who is not ACTIVE', async () => {
    prismaMock.user.findUnique.mockImplementation(
      (args: { where: { id?: string } }) => {
        if (args.where.id === writableInstructorId) {
          return Promise.resolve({
            ...instructor,
            id: writableInstructorId,
            status: 'BLOCKED',
          });
        }
        if (args.where.id === admin.id) {
          return Promise.resolve({ ...admin });
        }
        return Promise.resolve(null);
      },
    );

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plateNumber: 'AA0003BB',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: writableInstructorId,
      })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      message: 'Інструктор має бути в статусі ACTIVE.',
    });
    expect(prismaMock.car.create).not.toHaveBeenCalled();
  });

  it('POST /api/cars returns 404 when the organization is deleted', async () => {
    prismaMock.organization.findUnique.mockResolvedValue({
      ...organization,
      deletedAt: new Date(),
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .post('/api/cars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        plateNumber: 'AA0003BB',
        category: 'B',
        transmission: 'MANUAL',
        instructorId: writableInstructorId,
      })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Organization not found',
    });
    expect(prismaMock.car.create).not.toHaveBeenCalled();
  });

  it('PATCH /api/cars/:id updates a car of the caller organization', async () => {
    prismaMock.car.findUnique.mockResolvedValue(listedCar);

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/cars/${listedCar.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plateNumber: 'aa 0099 bb' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: listedCar.id,
      organizationId: organization.id,
      plateNumber: 'AA0099BB',
    });
    expect(prismaMock.car.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: listedCar.id },
        data: { plateNumber: 'AA0099BB' },
      }),
    );
    expect(prismaMock.student.findFirst).not.toHaveBeenCalled();
  });

  it('PATCH /api/cars/:id does not edit a car from another organization', async () => {
    prismaMock.car.findUnique.mockResolvedValue({
      ...listedCar,
      organizationId: otherOrganizationId,
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/cars/${listedCar.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plateNumber: 'AA0099BB' })
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      message: 'Car not found',
    });
    expect(prismaMock.car.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/cars/:id rejects an empty body', async () => {
    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/cars/${listedCar.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      errors: [
        {
          field: 'body',
          message:
            'Немає дозволених полів для оновлення (plateNumber, category, transmission, instructorId).',
        },
      ],
    });
    expect(prismaMock.car.findUnique).not.toHaveBeenCalled();
  });

  it('PATCH /api/cars/:id rejects a plate that is already used', async () => {
    prismaMock.car.findUnique.mockResolvedValue(listedCar);
    prismaMock.car.findFirst.mockResolvedValue({
      id: '35353535-3535-4353-8353-353535353535',
    });

    const token = signAccessToken(admin.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/cars/${listedCar.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plateNumber: 'AA0004BB' })
      .expect(409);

    expect(response.body.errors).toEqual([
      {
        field: 'plateNumber',
        message: 'Автомобіль з таким номером уже є в цій автошколі.',
      },
    ]);
    expect(prismaMock.car.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/cars/:id rejects an assignment that no longer matches the student', async () => {
    prismaMock.car.findUnique.mockResolvedValue(listedCar);
    prismaMock.student.findFirst.mockResolvedValue({ id: pupil.id });

    const token = signAccessToken(owner.id);
    const response = await request(app.getHttpServer())
      .patch(`/api/cars/${listedCar.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ transmission: 'AUTOMATIC' })
      .expect(409);

    expect(response.body).toMatchObject({
      statusCode: 409,
      message:
        'Автомобіль уже призначено студенту з іншою категорією, коробкою передач або інструктором.',
    });
    expect(prismaMock.car.update).not.toHaveBeenCalled();
  });

  it.each(['TEACHER', 'INSTRUCTOR', 'STUDENT'] as const)(
    'PATCH /api/cars/:id is forbidden for %s',
    async (role) => {
      const actor =
        role === 'TEACHER'
          ? teacher
          : role === 'INSTRUCTOR'
            ? instructor
            : pupil;
      const token = signAccessToken(actor.id);
      const response = await request(app.getHttpServer())
        .patch(`/api/cars/${listedCar.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ plateNumber: 'AA0099BB' })
        .expect(403);

      expect(response.body).toMatchObject({
        statusCode: 403,
        message: 'Insufficient permissions',
      });
      expect(prismaMock.car.update).not.toHaveBeenCalled();
    },
  );
});
