import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';

describe('CoursesController', () => {
  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CoursesController)).toEqual([
      AuthGuard,
      RolesGuard,
    ]);
  });

  it('restricts the course list to ADMIN', () => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      CoursesController.prototype.list,
    );

    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('passes the current user to the service', async () => {
    const response = { courses: [] };
    const coursesService = { list: jest.fn().mockResolvedValue(response) };
    const controller = new CoursesController(
      coursesService as unknown as CoursesService,
    );
    const user = { id: 'admin-1', organizationId: 'org-1' };

    await expect(controller.list(user as never)).resolves.toBe(response);
    expect(coursesService.list).toHaveBeenCalledWith(user);
  });

  it.each(['create', 'update'] as const)('restricts %s to ADMIN', (method) => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      CoursesController.prototype[method],
    );

    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('answers 201 when a course is created', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        CoursesController.prototype.create,
      ),
    ).toBe(HttpStatus.CREATED);
  });

  describe('write endpoints', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' };
    const response = { id: 'course-1' };
    const coursesService = {
      create: jest.fn().mockResolvedValue(response),
      update: jest.fn().mockResolvedValue(response),
    };
    const controller = new CoursesController(
      coursesService as unknown as CoursesService,
    );

    it('create passes the current user and body to the service', async () => {
      const body = { name: 'Теоретичний курс' };

      await expect(controller.create(user as never, body)).resolves.toBe(
        response,
      );
      expect(coursesService.create).toHaveBeenCalledWith(user, body);
    });

    it('update passes the current user, id and body to the service', async () => {
      const body = { description: null };

      await expect(
        controller.update(user as never, 'course-1', body),
      ).resolves.toBe(response);
      expect(coursesService.update).toHaveBeenCalledWith(
        user,
        'course-1',
        body,
      );
    });
  });
});
