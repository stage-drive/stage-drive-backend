import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LessonAttendanceService } from './lesson-attendance.service';
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
    ['createTheory', [UserRole.ADMIN, UserRole.TEACHER]],
    ['createPractice', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['updateTheory', [UserRole.ADMIN, UserRole.TEACHER]],
    ['rescheduleTheory', [UserRole.ADMIN, UserRole.TEACHER]],
    ['updatePractice', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['reschedulePractice', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['cancelTheory', [UserRole.ADMIN, UserRole.TEACHER]],
    ['cancelPractice', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['getAttendance', [UserRole.ADMIN, UserRole.TEACHER]],
    ['updateAttendance', [UserRole.ADMIN, UserRole.TEACHER]],
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

  it.each(['createTheory', 'createPractice'] as const)(
    '%s answers 201',
    (method) => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
          LessonsController.prototype[method],
        ),
      ).toBe(HttpStatus.CREATED);
    },
  );

  describe('endpoints', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' };
    const id = 'lesson-1';
    const response = { id };
    const lessonsService = {
      createTheory: jest.fn().mockResolvedValue(response),
      createPractice: jest.fn().mockResolvedValue(response),
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
    const lessonAttendanceService = {
      getAttendance: jest.fn().mockResolvedValue(response),
      updateAttendance: jest.fn().mockResolvedValue(response),
    };
    const controller = new LessonsController(
      lessonsService as unknown as LessonsService,
      personalScheduleService as unknown as PersonalScheduleService,
      lessonAttendanceService as unknown as LessonAttendanceService,
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

    it.each([
      [
        'createTheory',
        {
          groupId: 'group-1',
          topic: 'Дорожні знаки',
          scheduledAt: '2026-11-03T18:00:00+02:00',
        },
      ],
      [
        'createPractice',
        { studentId: 'student-1', scheduledAt: '2026-11-03T10:00:00+02:00' },
      ],
    ] as const)(
      '%s passes the current user and body to the service',
      async (method, body) => {
        await expect(
          controller[method](user as never, body as never),
        ).resolves.toBe(response);
        expect(lessonsService[method]).toHaveBeenCalledWith(user, body);
      },
    );

    it('getAttendance passes the current user and id to the attendance service', async () => {
      await expect(controller.getAttendance(user as never, id)).resolves.toBe(
        response,
      );
      expect(lessonAttendanceService.getAttendance).toHaveBeenCalledWith(
        user,
        id,
      );
    });

    it('updateAttendance passes the current user, id and body to the attendance service', async () => {
      const body = {
        records: [{ studentId: 'student-1', status: 'PRESENT' as const }],
      };

      await expect(
        controller.updateAttendance(user as never, id, body),
      ).resolves.toBe(response);
      expect(lessonAttendanceService.updateAttendance).toHaveBeenCalledWith(
        user,
        id,
        body,
      );
    });

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
