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
import { InstructorScheduleController } from './instructor-schedule.controller';
import { InstructorScheduleService } from './instructor-schedule.service';

type Method = keyof InstructorScheduleController;

function metadata(key: string, method: Method): unknown {
  return Reflect.getMetadata(
    key,
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
    InstructorScheduleController.prototype[method],
  );
}

describe('InstructorScheduleController', () => {
  it('applies AuthGuard and RolesGuard under /instructors/:instructorId', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, InstructorScheduleController),
    ).toEqual([AuthGuard, RolesGuard]);
    expect(
      Reflect.getMetadata(PATH_METADATA, InstructorScheduleController),
    ).toBe('instructors/:instructorId');
  });

  it.each<[Method, RequestMethod, string]>([
    ['getWorkingHours', RequestMethod.GET, 'working-hours'],
    ['replaceWorkingHours', RequestMethod.PUT, 'working-hours'],
    ['listTimeOff', RequestMethod.GET, 'time-off'],
    ['createTimeOff', RequestMethod.POST, 'time-off'],
    ['removeTimeOff', RequestMethod.DELETE, 'time-off/:timeOffId'],
  ])('routes %s', (method, verb, path) => {
    expect(metadata(METHOD_METADATA, method)).toBe(verb);
    expect(metadata(PATH_METADATA, method)).toBe(path);
  });

  it.each<[Method, UserRole[]]>([
    ['getWorkingHours', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['listTimeOff', [UserRole.ADMIN, UserRole.INSTRUCTOR]],
    ['replaceWorkingHours', [UserRole.ADMIN]],
    ['createTimeOff', [UserRole.ADMIN]],
    ['removeTimeOff', [UserRole.ADMIN]],
  ])('restricts %s to %j', (method, expected) => {
    expect(
      new Reflector().get<UserRole[]>(
        ROLES_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        InstructorScheduleController.prototype[method],
      ),
    ).toEqual(expected);
  });

  it.each<[Method, HttpStatus]>([
    ['createTimeOff', HttpStatus.CREATED],
    ['removeTimeOff', HttpStatus.NO_CONTENT],
  ])('%s answers %s', (method, status) => {
    expect(metadata(HTTP_CODE_METADATA, method)).toBe(status);
  });

  describe('endpoints', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' } as User;
    const response = { id: 'x' };
    const scheduleService = {
      getWorkingHours: jest.fn().mockResolvedValue(response),
      replaceWorkingHours: jest.fn().mockResolvedValue(response),
      listTimeOff: jest.fn().mockResolvedValue(response),
      createTimeOff: jest.fn().mockResolvedValue(response),
      removeTimeOff: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new InstructorScheduleController(
      scheduleService as unknown as InstructorScheduleService,
    );

    it('passes the actor and the instructor from the path to the service', async () => {
      const body = { intervals: [] };
      const timeOff = { startDate: '2026-11-20' };
      const query = { from: '2026-11-16T00:00:00Z' };

      await expect(
        controller.getWorkingHours(user, 'instructor-1'),
      ).resolves.toBe(response);
      await controller.replaceWorkingHours(user, 'instructor-1', body);
      await controller.listTimeOff(user, 'instructor-1', query);
      await controller.createTimeOff(user, 'instructor-1', timeOff);
      await controller.removeTimeOff(user, 'instructor-1', 'time-off-1');

      expect(scheduleService.getWorkingHours).toHaveBeenCalledWith(
        user,
        'instructor-1',
      );
      expect(scheduleService.replaceWorkingHours).toHaveBeenCalledWith(
        user,
        'instructor-1',
        body,
      );
      expect(scheduleService.listTimeOff).toHaveBeenCalledWith(
        user,
        'instructor-1',
        query,
      );
      expect(scheduleService.createTimeOff).toHaveBeenCalledWith(
        user,
        'instructor-1',
        timeOff,
      );
      expect(scheduleService.removeTimeOff).toHaveBeenCalledWith(
        user,
        'instructor-1',
        'time-off-1',
      );
    });
  });
});
