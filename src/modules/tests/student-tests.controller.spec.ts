import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  LessonTestAccessController,
  MyTestAttemptsController,
} from './student-tests.controller';
import { TestAttemptsService } from './test-attempts.service';
import { TestsService } from './tests.service';

describe('LessonTestAccessController', () => {
  const student = { id: 'student-1', organizationId: 'org-1' };
  const lessonTest = { id: 'test-1', lessonId: 'lesson-1' };
  const tests = { getLessonTest: jest.fn().mockResolvedValue(lessonTest) };
  const controller = new LessonTestAccessController(
    tests as unknown as TestsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LessonTestAccessController),
    ).toEqual([AuthGuard, RolesGuard]);
  });

  it('serves the lesson test with GET /lessons/{lessonId}/test', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LessonTestAccessController)).toBe(
      'lessons',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
    const handler = LessonTestAccessController.prototype.getLessonTest;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':lessonId/test');
  });

  it('is only for STUDENT: neither staff nor INSTRUCTOR may read the student view', () => {
    expect(
      new Reflector().get<UserRole[]>(
        ROLES_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        LessonTestAccessController.prototype.getLessonTest,
      ),
    ).toEqual([UserRole.STUDENT]);
  });

  it('asks the service for the published test of the lesson of the current student', async () => {
    await expect(
      controller.getLessonTest(student as never, 'lesson-1'),
    ).resolves.toBe(lessonTest);
    expect(tests.getLessonTest).toHaveBeenCalledWith(student, 'lesson-1');
  });
});

describe('MyTestAttemptsController', () => {
  const student = { id: 'student-1', organizationId: 'org-1' };
  const page = {
    attempts: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  };
  const attempts = { listMyAttempts: jest.fn().mockResolvedValue(page) };
  const controller = new MyTestAttemptsController(
    attempts as unknown as TestAttemptsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MyTestAttemptsController),
    ).toEqual([AuthGuard, RolesGuard]);
  });

  it('serves the history with GET /me/test-attempts for STUDENT only', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MyTestAttemptsController)).toBe(
      'me/test-attempts',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
    const handler = MyTestAttemptsController.prototype.list;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(new Reflector().get<UserRole[]>(ROLES_KEY, handler)).toEqual([
      UserRole.STUDENT,
    ]);
  });

  it('lists the attempts of the current student with the query filters', async () => {
    const query = { lessonId: 'lesson-1', status: 'COMPLETED', page: 2 };
    await expect(
      controller.list(student as never, query as never),
    ).resolves.toBe(page);
    expect(attempts.listMyAttempts).toHaveBeenCalledWith(student, query);
  });
});
