import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  TEST_RESULT_STAFF_ROLES,
  TestAttemptsService,
} from './test-attempts.service';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';

describe('TestsController', () => {
  const user = { id: 'admin-1', organizationId: 'org-1' };
  const response = { id: 'test-1' };
  const testsService = {
    list: jest.fn().mockResolvedValue({ tests: [] }),
    get: jest.fn().mockResolvedValue(response),
    create: jest.fn().mockResolvedValue(response),
    update: jest.fn().mockResolvedValue(response),
    changePublication: jest.fn().mockResolvedValue(response),
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
    submit: jest.fn().mockResolvedValue(response),
    getOwnResult: jest.fn().mockResolvedValue(response),
    listResults: jest.fn().mockResolvedValue({ results: [] }),
    getStudentResult: jest.fn().mockResolvedValue(response),
  };
  const controller = new TestsController(
    testsService as unknown as TestsService,
    attemptsService as unknown as TestAttemptsService,
  );

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
    'createQuestion',
    'updateQuestion',
    'deleteQuestion',
    'createOption',
    'updateOption',
    'deleteOption',
  ] as const)('restricts %s to ADMIN', (method) => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      TestsController.prototype[method],
    );
    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it.each([
    'listCurrent',
    'getContent',
    'startAttempt',
    'getAttempt',
    'submitAttempt',
    'getOwnResult',
  ] as const)('restricts %s to STUDENT', (method) => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      TestsController.prototype[method],
    );
    expect(roles).toEqual([UserRole.STUDENT]);
  });

  it.each([
    'create',
    'createQuestion',
    'createOption',
    'startAttempt',
  ] as const)('answers 201 from %s', (method) => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        TestsController.prototype[method],
      ),
    ).toBe(HttpStatus.CREATED);
  });

  it('passes the current user to the service', async () => {
    const body = { name: 'ПДР' };
    await expect(controller.create(user as never, body as never)).resolves.toBe(
      response,
    );
    expect(testsService.create).toHaveBeenCalledWith(user, body);
  });

  it('passes the current student to the published test', async () => {
    const student = { id: 'student-1', organizationId: 'org-1' };
    await expect(
      controller.getContent(student as never, 'test-1'),
    ).resolves.toBe(response);
    expect(testsService.getContent).toHaveBeenCalledWith(student, 'test-1');
  });

  it('starts, reads and submits an attempt for the current student', async () => {
    const student = { id: 'student-1', organizationId: 'org-1' };
    const body = { answers: [] };
    await expect(
      controller.startAttempt(student as never, 'test-1'),
    ).resolves.toBe(response);
    await expect(
      controller.getAttempt(student as never, 'test-1', 'attempt-1'),
    ).resolves.toBe(response);
    await expect(
      controller.submitAttempt(
        student as never,
        'test-1',
        'attempt-1',
        body as never,
      ),
    ).resolves.toBe(response);
    expect(attemptsService.start).toHaveBeenCalledWith(student, 'test-1');
    expect(attemptsService.get).toHaveBeenCalledWith(
      student,
      'test-1',
      'attempt-1',
    );
    expect(attemptsService.submit).toHaveBeenCalledWith(
      student,
      'test-1',
      'attempt-1',
      body,
    );
    await expect(
      controller.getOwnResult(student as never, 'test-1'),
    ).resolves.toBe(response);
    expect(attemptsService.getOwnResult).toHaveBeenCalledWith(
      student,
      'test-1',
    );
  });

  it('lets ADMIN and TEACHER read results', async () => {
    expect(
      new Reflector().get<UserRole[]>(
        ROLES_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        TestsController.prototype.listResults,
      ),
    ).toEqual([...TEST_RESULT_STAFF_ROLES]);
    expect(
      new Reflector().get<UserRole[]>(
        ROLES_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        TestsController.prototype.getStudentResult,
      ),
    ).toEqual([UserRole.ADMIN, UserRole.TEACHER]);
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
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        TestsController.prototype.submitAttempt,
      ),
    ).toBe(HttpStatus.OK);
  });
});
