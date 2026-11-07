import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CourseProgressController } from './course-progress.controller';
import { CourseProgressService } from './course-progress.service';

describe('CourseProgressController', () => {
  const user = { id: 'student-1', organizationId: 'org-1' };
  const response = { courseId: 'course-1', percent: 0 };
  const progress = {
    getCurrent: jest.fn().mockResolvedValue(response),
    getOwn: jest.fn().mockResolvedValue(response),
    completeLesson: jest.fn().mockResolvedValue(response),
    getForStudent: jest.fn().mockResolvedValue(response),
  };
  const controller = new CourseProgressController(
    progress as unknown as CourseProgressService,
  );

  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CourseProgressController),
    ).toEqual([AuthGuard, RolesGuard]);
  });

  it.each(['getCurrent', 'getOwn', 'completeLesson'] as const)(
    'restricts %s to STUDENT',
    (method) => {
      const roles = new Reflector().get<UserRole[]>(
        ROLES_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        CourseProgressController.prototype[method],
      );

      expect(roles).toEqual([UserRole.STUDENT]);
    },
  );

  it('restricts staff progress to ADMIN and TEACHER', () => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      CourseProgressController.prototype.getForStudent,
    );

    expect(roles).toEqual([UserRole.ADMIN, UserRole.TEACHER]);
  });

  it('answers 200 when a lesson is marked complete', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        CourseProgressController.prototype.completeLesson,
      ),
    ).toBe(HttpStatus.OK);
  });

  it('passes the current student to the current-course progress query', async () => {
    const student = { ...user, role: UserRole.STUDENT };

    await expect(controller.getCurrent(student as never)).resolves.toBe(
      response,
    );
    expect(progress.getCurrent).toHaveBeenCalledWith(student);
  });

  it('passes the course id to the own progress query', async () => {
    const student = { ...user, role: UserRole.STUDENT };

    await expect(controller.getOwn(student as never, 'course-1')).resolves.toBe(
      response,
    );
    expect(progress.getOwn).toHaveBeenCalledWith(student, 'course-1');
  });

  it('passes the lesson id when the student completes a lesson', async () => {
    const student = { ...user, role: UserRole.STUDENT };

    await expect(
      controller.completeLesson(student as never, 'course-1', 'lesson-1'),
    ).resolves.toBe(response);
    expect(progress.completeLesson).toHaveBeenCalledWith(
      student,
      'course-1',
      'lesson-1',
    );
  });

  it('passes the student id to the staff progress query', async () => {
    const admin = { ...user, id: 'admin-1', role: UserRole.ADMIN };

    await expect(
      controller.getForStudent(admin as never, 'course-1', 'student-1'),
    ).resolves.toBe(response);
    expect(progress.getForStudent).toHaveBeenCalledWith(
      admin,
      'course-1',
      'student-1',
    );
  });
});
