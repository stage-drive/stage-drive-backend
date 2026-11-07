import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PracticeSlotsController } from './practice-slots.controller';
import { PracticeSlotsService } from './practice-slots.service';

describe('PracticeSlotsController', () => {
  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PracticeSlotsController),
    ).toEqual([AuthGuard, RolesGuard]);
  });

  it.each([
    ['create', [UserRole.ADMIN]],
    ['update', [UserRole.ADMIN]],
    ['remove', [UserRole.ADMIN]],
    ['list', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['findOne', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
  ] as const)('restricts %s to %j', (method, expected) => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      PracticeSlotsController.prototype[method],
    );

    expect(roles).toEqual(expected);
  });

  it.each([
    ['create', HttpStatus.CREATED],
    ['remove', HttpStatus.NO_CONTENT],
  ] as const)('%s answers %s', (method, status) => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        PracticeSlotsController.prototype[method],
      ),
    ).toBe(status);
  });

  describe('endpoints', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' };
    const id = 'slot-1';
    const response = { id };
    const practiceSlotsService = {
      create: jest.fn().mockResolvedValue(response),
      update: jest.fn().mockResolvedValue(response),
      remove: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue(response),
      findOne: jest.fn().mockResolvedValue(response),
    };
    const controller = new PracticeSlotsController(
      practiceSlotsService as unknown as PracticeSlotsService,
    );

    it('create passes the current user and body to the service', async () => {
      const body = {
        instructorId: 'instructor-1',
        carId: 'car-1',
        scheduledAt: '2026-11-16T10:00:00+02:00',
      };

      await expect(controller.create(user as never, body)).resolves.toBe(
        response,
      );
      expect(practiceSlotsService.create).toHaveBeenCalledWith(user, body);
    });

    it('list passes the current user and query to the service', async () => {
      const query = { instructorId: 'instructor-1' };

      await expect(controller.list(user as never, query)).resolves.toBe(
        response,
      );
      expect(practiceSlotsService.list).toHaveBeenCalledWith(user, query);
    });

    it('findOne passes the current user and id to the service', async () => {
      await expect(controller.findOne(user as never, id)).resolves.toBe(
        response,
      );
      expect(practiceSlotsService.findOne).toHaveBeenCalledWith(user, id);
    });

    it('update passes the current user, id and body to the service', async () => {
      const body = { durationMin: 90 };

      await expect(controller.update(user as never, id, body)).resolves.toBe(
        response,
      );
      expect(practiceSlotsService.update).toHaveBeenCalledWith(user, id, body);
    });

    it('remove passes the current user and id to the service', async () => {
      await expect(
        controller.remove(user as never, id),
      ).resolves.toBeUndefined();
      expect(practiceSlotsService.remove).toHaveBeenCalledWith(user, id);
    });
  });
});
