import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { GroupStatus, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

describe('GroupsController', () => {
  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GroupsController)).toEqual([
      AuthGuard,
      RolesGuard,
    ]);
  });

  it('restricts the group list to ADMIN', () => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      GroupsController.prototype.list,
    );

    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('passes the current user to the service', async () => {
    const response = { groups: [] };
    const groupsService = { list: jest.fn().mockResolvedValue(response) };
    const controller = new GroupsController(
      groupsService as unknown as GroupsService,
    );
    const user = { id: 'admin-1', organizationId: 'org-1' };

    await expect(controller.list(user as never)).resolves.toBe(response);
    expect(groupsService.list).toHaveBeenCalledWith(user);
  });

  it.each([
    'create',
    'update',
    'changeStatus',
    'addStudent',
    'removeStudent',
  ] as const)('restricts %s to ADMIN', (method) => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      GroupsController.prototype[method],
    );

    expect(roles).toEqual([UserRole.ADMIN]);
  });

  describe('write endpoints', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' };
    const response = { id: 'group-1' };
    const groupsService = {
      create: jest.fn().mockResolvedValue(response),
      update: jest.fn().mockResolvedValue(response),
      changeStatus: jest.fn().mockResolvedValue(response),
    };
    const controller = new GroupsController(
      groupsService as unknown as GroupsService,
    );

    it('create passes the current user and body to the service', async () => {
      const body = { name: 'Група А', teacherId: 'teacher-1' };

      await expect(controller.create(user as never, body)).resolves.toBe(
        response,
      );
      expect(groupsService.create).toHaveBeenCalledWith(user, body);
    });

    it('update passes the current user, id and body to the service', async () => {
      const body = { name: 'Група Б' };

      await expect(
        controller.update(user as never, 'group-1', body),
      ).resolves.toBe(response);
      expect(groupsService.update).toHaveBeenCalledWith(user, 'group-1', body);
    });

    it('changeStatus passes the current user, id and body to the service', async () => {
      const body = { status: GroupStatus.ACTIVE };

      await expect(
        controller.changeStatus(user as never, 'group-1', body),
      ).resolves.toBe(response);
      expect(groupsService.changeStatus).toHaveBeenCalledWith(
        user,
        'group-1',
        body,
      );
    });
  });

  it('opens the group roster to ADMIN and TEACHER only', () => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      GroupsController.prototype.listStudents,
    );

    expect(roles).toEqual([UserRole.ADMIN, UserRole.TEACHER]);
  });

  it('answers 200 (not 201) when a student is added', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        GroupsController.prototype.addStudent,
      ),
    ).toBe(HttpStatus.OK);
  });

  describe('roster endpoints', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' };
    const response = { group: { id: 'group-1' }, students: [] };
    const groupsService = {
      listStudents: jest.fn().mockResolvedValue(response),
      addStudent: jest.fn().mockResolvedValue(response),
      removeStudent: jest.fn().mockResolvedValue(response),
    };
    const controller = new GroupsController(
      groupsService as unknown as GroupsService,
    );

    it('listStudents passes the current user and id to the service', async () => {
      await expect(
        controller.listStudents(user as never, 'group-1'),
      ).resolves.toBe(response);
      expect(groupsService.listStudents).toHaveBeenCalledWith(user, 'group-1');
    });

    it('addStudent passes the current user, id and body to the service', async () => {
      const body = { studentId: 'student-1' };

      await expect(
        controller.addStudent(user as never, 'group-1', body),
      ).resolves.toBe(response);
      expect(groupsService.addStudent).toHaveBeenCalledWith(
        user,
        'group-1',
        body,
      );
    });

    it('removeStudent passes the current user, id and studentId to the service', async () => {
      await expect(
        controller.removeStudent(user as never, 'group-1', 'student-1'),
      ).resolves.toBe(response);
      expect(groupsService.removeStudent).toHaveBeenCalledWith(
        user,
        'group-1',
        'student-1',
      );
    });
  });
});
