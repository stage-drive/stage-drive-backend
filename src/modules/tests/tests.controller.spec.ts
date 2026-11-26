import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  TEST_RESULT_STAFF_ROLES,
  TestAttemptsService,
} from './test-attempts.service';
import { TestsController } from './tests.controller';
import { TEST_MANAGE_ROLES, TestsService } from './tests.service';

describe('TestsController', () => {
  const user = { id: 'admin-1', organizationId: 'org-1' };
  const student = { id: 'student-1', organizationId: 'org-1' };
  const response = { id: 'test-1' };
  const testsService = {
    list: jest.fn().mockResolvedValue({ tests: [] }),
    get: jest.fn().mockResolvedValue(response),
    create: jest.fn().mockResolvedValue(response),
    update: jest.fn().mockResolvedValue(response),
    changePublication: jest.fn().mockResolvedValue(response),
    archive: jest.fn().mockResolvedValue(response),
    listCurrent: jest
      .fn()
      .mockResolvedValue({ courseId: 'course-1', tests: [] }),
    getContent: jest.fn().mockResolvedValue(response),
    createQuestion: jest.fn().mockResolvedValue(response),
    updateQuestion: jest.fn().mockResolvedValue(response),
    deleteQuestion: jest.fn().mockResolvedValue(response),
    createOption: jest.fn().mockResolvedValue(response),
    updateOption: jest.fn().mockResolvedValue(response),
    deleteOption: jest.fn().mockResolvedValue(response),
  };
  const attemptsService = {
    start: jest.fn().mockResolvedValue(response),
    get: jest.fn().mockResolvedValue(response),
    saveAnswers: jest.fn().mockResolvedValue(response),
    submit: jest.fn().mockResolvedValue(response),
    expire: jest.fn().mockResolvedValue(response),
    listOwn: jest.fn().mockResolvedValue(response),
    listForTest: jest.fn().mockResolvedValue({ attempts: [] }),
    listAttempts: jest.fn().mockResolvedValue({ attempts: [] }),
    getOwnResult: jest.fn().mockResolvedValue(response),
    listResults: jest.fn().mockResolvedValue({ results: [] }),
    getStudentResult: jest.fn().mockResolvedValue(response),
  };
  const controller = new TestsController(
    testsService as unknown as TestsService,
    attemptsService as unknown as TestAttemptsService,
  );

  function rolesOf(method: keyof TestsController): UserRole[] {
    return new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      TestsController.prototype[method],
    );
  }

  function httpCodeOf(method: keyof TestsController): unknown {
    return Reflect.getMetadata(
      HTTP_CODE_METADATA,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      TestsController.prototype[method],
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TestsController)).toEqual([
      AuthGuard,
      RolesGuard,
    ]);
  });

  it.each([
    'list',
    'create',
    'get',
    'update',
    'changePublication',
    'archive',
    'createQuestion',
    'updateQuestion',
    'deleteQuestion',
    'createOption',
    'updateOption',
    'deleteOption',
  ] as const)('restricts %s to ADMIN and TEACHER', (method) => {
    expect(rolesOf(method)).toEqual([...TEST_MANAGE_ROLES]);
  });

  it.each([
    'listCurrent',
    'getContent',
    'startAttempt',
    'getAttemptById',
    'saveAnswers',
    'submitAttemptById',
    'expireAttempt',
    'listOwnAttempts',
    'getOwnResult',
  ] as const)('restricts %s to STUDENT', (method) => {
    expect(rolesOf(method)).toEqual([UserRole.STUDENT]);
  });

  it.each([
    'listAttempts',
    'listTestAttempts',
    'listResults',
    'getStudentResult',
  ] as const)(
    'restricts %s to ADMIN and TEACHER, never to INSTRUCTOR',
    (method) => {
      expect(rolesOf(method)).toEqual([...TEST_RESULT_STAFF_ROLES]);
      expect(rolesOf(method)).not.toContain(UserRole.INSTRUCTOR);
    },
  );

  it.each([
    'create',
    'createQuestion',
    'createOption',
    'startAttempt',
  ] as const)('answers 201 from %s', (method) => {
    expect(httpCodeOf(method)).toBe(HttpStatus.CREATED);
  });

  it.each(['submitAttemptById', 'expireAttempt'] as const)(
    'answers 200 from %s',
    (method) => {
      expect(httpCodeOf(method)).toBe(HttpStatus.OK);
    },
  );

  describe('routes', () => {
    function routes() {
      return Object.getOwnPropertyNames(TestsController.prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => {
          const handler = (
            TestsController.prototype as unknown as Record<string, object>
          )[name];
          return {
            name,
            method: Reflect.getMetadata(METHOD_METADATA, handler) as
              RequestMethod | undefined,
            path: Reflect.getMetadata(PATH_METADATA, handler) as
              string | undefined,
          };
        })
        .filter((route) => route.method !== undefined);
    }

    function find(method: RequestMethod, path: string) {
      return routes().find(
        (route) => route.method === method && route.path === path,
      );
    }

    it('exposes the lesson test contract', () => {
      expect(find(RequestMethod.GET, 'attempts')?.name).toBe('listAttempts');
      expect(find(RequestMethod.GET, 'attempts/:attemptId')?.name).toBe(
        'getAttemptById',
      );
      expect(
        find(RequestMethod.PATCH, 'attempts/:attemptId/answers')?.name,
      ).toBe('saveAnswers');
      expect(find(RequestMethod.POST, 'attempts/:attemptId/submit')?.name).toBe(
        'submitAttemptById',
      );
      expect(find(RequestMethod.POST, 'attempts/:attemptId/expire')?.name).toBe(
        'expireAttempt',
      );
      expect(find(RequestMethod.POST, ':testId/attempts')?.name).toBe(
        'startAttempt',
      );
      expect(find(RequestMethod.GET, ':testId/attempts')?.name).toBe(
        'listTestAttempts',
      );
      expect(find(RequestMethod.GET, ':testId/attempts/me')?.name).toBe(
        'listOwnAttempts',
      );
      expect(find(RequestMethod.PATCH, ':testId/archive')?.name).toBe(
        'archive',
      );
      expect(find(RequestMethod.PATCH, ':testId/publication')?.name).toBe(
        'changePublication',
      );
    });

    it('declares static GET routes before the :testId ones, otherwise "attempts" would be read as a test id', () => {
      const all = routes();
      const indexOf = (path: string) =>
        all.findIndex(
          (route) => route.method === RequestMethod.GET && route.path === path,
        );
      const firstDynamic = all.findIndex(
        (route) =>
          route.method === RequestMethod.GET &&
          route.path !== undefined &&
          route.path.startsWith(':testId'),
      );
      expect(firstDynamic).toBeGreaterThanOrEqual(0);
      for (const path of ['current', 'attempts', 'attempts/:attemptId']) {
        expect(indexOf(path)).toBeGreaterThanOrEqual(0);
        expect(indexOf(path)).toBeLessThan(firstDynamic);
      }
    });

    it.each([
      'listAttempts',
      'getAttemptById',
      'saveAnswers',
      'submitAttemptById',
      'expireAttempt',
      'startAttempt',
      'listOwnAttempts',
      'archive',
    ] as const)('does not deprecate the current route %s', (method) => {
      const operation = Reflect.getMetadata(
        DECORATORS.API_OPERATION,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        TestsController.prototype[method],
      ) as { deprecated?: boolean };
      expect(operation.deprecated).not.toBe(true);
    });
  });

  it('passes the current user and the filters to the test list', async () => {
    const query = { courseId: 'course-1', lessonId: 'lesson-1' };
    await expect(controller.list(user as never, query)).resolves.toEqual({
      tests: [],
    });
    expect(testsService.list).toHaveBeenCalledWith(user, query);
  });

  it('passes the current user to the service', async () => {
    const body = { name: 'ПДР' };
    await expect(controller.create(user as never, body as never)).resolves.toBe(
      response,
    );
    expect(testsService.create).toHaveBeenCalledWith(user, body);
  });

  it('archives a test for the current user', async () => {
    await expect(controller.archive(user as never, 'test-1')).resolves.toBe(
      response,
    );
    expect(testsService.archive).toHaveBeenCalledWith(user, 'test-1');
  });

  it('passes the current student to the published test', async () => {
    await expect(
      controller.getContent(student as never, 'test-1'),
    ).resolves.toBe(response);
    expect(testsService.getContent).toHaveBeenCalledWith(student, 'test-1');
  });

  it('starts an attempt for the current student', async () => {
    await expect(
      controller.startAttempt(student as never, 'test-1'),
    ).resolves.toBe(response);
    expect(attemptsService.start).toHaveBeenCalledWith(student, 'test-1');
  });

  it('reads, saves, submits and expires an attempt by its own id', async () => {
    const answers = { answers: [{ questionId: 'q-1', optionIds: ['o-1'] }] };
    const submitBody = { answers: [] };
    await expect(
      controller.getAttemptById(student as never, 'attempt-1'),
    ).resolves.toBe(response);
    await expect(
      controller.saveAnswers(student as never, 'attempt-1', answers as never),
    ).resolves.toBe(response);
    await expect(
      controller.submitAttemptById(
        student as never,
        'attempt-1',
        submitBody as never,
      ),
    ).resolves.toBe(response);
    await expect(
      controller.expireAttempt(student as never, 'attempt-1'),
    ).resolves.toBe(response);

    expect(attemptsService.get).toHaveBeenCalledWith(student, 'attempt-1');
    expect(attemptsService.saveAnswers).toHaveBeenCalledWith(
      student,
      'attempt-1',
      answers,
    );
    expect(attemptsService.submit).toHaveBeenCalledWith(
      student,
      'attempt-1',
      submitBody,
    );
    expect(attemptsService.expire).toHaveBeenCalledWith(student, 'attempt-1');
  });

  it('reads the own attempts of a test and the own result', async () => {
    await expect(
      controller.listOwnAttempts(student as never, 'test-1'),
    ).resolves.toBe(response);
    await expect(
      controller.getOwnResult(student as never, 'test-1'),
    ).resolves.toBe(response);
    expect(attemptsService.listOwn).toHaveBeenCalledWith(student, 'test-1');
    expect(attemptsService.getOwnResult).toHaveBeenCalledWith(
      student,
      'test-1',
    );
  });

  it('lets staff list attempts of one test and of all tests with their filters', async () => {
    const teacher = { id: 'teacher-1', role: UserRole.TEACHER };
    const query = { groupId: 'group-1', status: 'COMPLETED' };
    await expect(
      controller.listTestAttempts(teacher as never, 'test-1', query as never),
    ).resolves.toEqual({ attempts: [] });
    await expect(
      controller.listAttempts(
        teacher as never,
        {
          ...query,
          testId: 'test-1',
        } as never,
      ),
    ).resolves.toEqual({ attempts: [] });
    expect(attemptsService.listForTest).toHaveBeenCalledWith(
      teacher,
      'test-1',
      query,
    );
    expect(attemptsService.listAttempts).toHaveBeenCalledWith(teacher, {
      ...query,
      testId: 'test-1',
    });
  });

  it('lets ADMIN and TEACHER read results', async () => {
    expect(rolesOf('getStudentResult')).toEqual([
      UserRole.ADMIN,
      UserRole.TEACHER,
    ]);
    const teacher = { id: 'teacher-1', role: UserRole.TEACHER };
    await expect(
      controller.listResults(teacher as never, 'test-1'),
    ).resolves.toEqual({
      results: [],
    });
    await expect(
      controller.getStudentResult(teacher as never, 'test-1', 'student-1'),
    ).resolves.toBe(response);
    expect(attemptsService.listResults).toHaveBeenCalledWith(teacher, 'test-1');
    expect(attemptsService.getStudentResult).toHaveBeenCalledWith(
      teacher,
      'test-1',
      'student-1',
    );
  });
});
