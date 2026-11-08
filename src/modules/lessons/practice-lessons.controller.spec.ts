import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { User, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PracticeLessonsController } from './practice-lessons.controller';
import { PracticeLessonsService } from './practice-lessons.service';

type Method = keyof PracticeLessonsController;

function metadata(key: string, method: Method): unknown {
  return Reflect.getMetadata(
    key,
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
    PracticeLessonsController.prototype[method],
  );
}

describe('PracticeLessonsController', () => {
  it('applies AuthGuard and RolesGuard under /lessons/practice', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PracticeLessonsController),
    ).toEqual([AuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, PracticeLessonsController)).toBe(
      'lessons/practice',
    );
  });

  it.each<[Method, RequestMethod, string, UserRole[]]>([
    ['list', RequestMethod.GET, '/', [UserRole.ADMIN]],
    ['listAvailable', RequestMethod.GET, 'available', [UserRole.STUDENT]],
    ['book', RequestMethod.POST, 'book', [UserRole.STUDENT]],
  ])('routes %s and restricts it', (method, verb, path, roles) => {
    expect(metadata(METHOD_METADATA, method)).toBe(verb);
    expect(metadata(PATH_METADATA, method)).toBe(path);
    expect(
      new Reflector().get<UserRole[]>(
        ROLES_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        PracticeLessonsController.prototype[method],
      ),
    ).toEqual(roles);
  });

  it('answers 201 to a booking', () => {
    expect(metadata(HTTP_CODE_METADATA, 'book')).toBe(HttpStatus.CREATED);
  });

  it('passes the actor and the request to the service', async () => {
    const user = { id: 'student-1', organizationId: 'org-1' } as User;
    const response = { id: 'x' };
    const practiceLessonsService = {
      list: jest.fn().mockResolvedValue(response),
      listAvailable: jest.fn().mockResolvedValue(response),
      book: jest.fn().mockResolvedValue(response),
    };
    const controller = new PracticeLessonsController(
      practiceLessonsService as unknown as PracticeLessonsService,
    );
    const query = { from: '2026-11-16T00:00:00Z' };
    const body = { scheduledAt: '2026-11-16T09:00:00+02:00' };

    await expect(controller.list(user, query)).resolves.toBe(response);
    await expect(controller.listAvailable(user, query)).resolves.toBe(response);
    await expect(controller.book(user, body)).resolves.toBe(response);

    expect(practiceLessonsService.list).toHaveBeenCalledWith(user, query);
    expect(practiceLessonsService.listAvailable).toHaveBeenCalledWith(
      user,
      query,
    );
    expect(practiceLessonsService.book).toHaveBeenCalledWith(user, body);
  });
});
