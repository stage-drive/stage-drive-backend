import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';
import { PersonalScheduleService } from './personal-schedule.service';

describe('LessonsController', () => {
  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, LessonsController)).toEqual([
      AuthGuard,
      RolesGuard,
    ]);
  });

  it.each([
    ['updateTheory', [UserRole.ADMIN, UserRole.TEACHER]],
    ['rescheduleTheory', [UserRole.ADMIN, UserRole.TEACHER]],
    ['updatePractice', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['reschedulePractice', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['cancelTheory', [UserRole.ADMIN, UserRole.TEACHER]],
    ['cancelPractice', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    [
      'getMySchedule',
      [UserRole.TEACHER, UserRole.INSTRUCTOR, UserRole.STUDENT],
    ],
  ] as const)('restricts %s to %j', (method, expected) => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      LessonsController.prototype[method],
    );

    expect(roles).toEqual(expected);
  });

  it.each(['cancelTheory', 'cancelPractice'] as const)(
    '%s answers 200, not the POST default 201',
    (method) => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
          LessonsController.prototype[method],
        ),
      ).toBe(HttpStatus.OK);
    },
  );

  describe('endpoints', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' };
    const id = 'lesson-1';
    const response = { id };
    const lessonsService = {
      updateTheory: jest.fn().mockResolvedValue(response),
      rescheduleTheory: jest.fn().mockResolvedValue(response),
      updatePractice: jest.fn().mockResolvedValue(response),
      reschedulePractice: jest.fn().mockResolvedValue(response),
      cancelTheory: jest.fn().mockResolvedValue(response),
      cancelPractice: jest.fn().mockResolvedValue(response),
    };
    const personalScheduleService = {
      getMySchedule: jest.fn().mockResolvedValue(response),
    };
    const controller = new LessonsController(
      lessonsService as unknown as LessonsService,
      personalScheduleService as unknown as PersonalScheduleService,
    );

    it.each([
      ['updateTheory', { topic: 'Дорожні знаки' }],
      ['rescheduleTheory', { scheduledAt: '2026-11-03T18:00:00+02:00' }],
      ['updatePractice', { durationMin: 90 }],
      ['reschedulePractice', { scheduledAt: '2026-11-03T10:00:00+02:00' }],
      ['cancelTheory', { reason: 'Викладач захворів' }],
      ['cancelPractice', {}],
    ] as const)(
      '%s passes the current user, id and body to the service',
      async (method, body) => {
        await expect(
          controller[method](user as never, id, body as never),
        ).resolves.toBe(response);
        expect(lessonsService[method]).toHaveBeenCalledWith(user, id, body);
      },
    );

    it('getMySchedule passes the current user and query to the schedule service', async () => {
      const query = { from: '2026-11-02T00:00:00Z', type: 'THEORY' as const };

      await expect(
        controller.getMySchedule(user as never, query),
      ).resolves.toBe(response);
      expect(personalScheduleService.getMySchedule).toHaveBeenCalledWith(
        user,
        query,
      );
    });
  });
});
