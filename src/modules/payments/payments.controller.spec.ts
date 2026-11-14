import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PaymentStatus, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MePaymentsController } from './me-payments.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StudentPaymentsController } from './student-payments.controller';

const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_ID = '88888888-8888-4888-8888-888888888888';

function rolesOf(target: object): UserRole[] | undefined {
  return new Reflector().get<UserRole[]>(ROLES_KEY, target as () => unknown);
}

describe('Payments controllers', () => {
  it.each([
    PaymentsController,
    StudentPaymentsController,
    MePaymentsController,
  ])('%p applies AuthGuard and RolesGuard', (controller) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toEqual([
      AuthGuard,
      RolesGuard,
    ]);
  });

  it('restricts every /payments endpoint to OWNER and ADMIN', () => {
    expect(rolesOf(PaymentsController)).toEqual([
      UserRole.OWNER,
      UserRole.ADMIN,
    ]);
  });

  it('restricts /students/:studentId/payments to OWNER and ADMIN', () => {
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      rolesOf(StudentPaymentsController.prototype.list),
    ).toEqual([UserRole.OWNER, UserRole.ADMIN]);
  });

  it('restricts /me/payments to STUDENT', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
    expect(rolesOf(MePaymentsController.prototype.own)).toEqual([
      UserRole.STUDENT,
    ]);
  });

  it('declares GET history before GET :id so "history" is not parsed as an id', () => {
    const methods = Object.getOwnPropertyNames(PaymentsController.prototype);
    expect(methods.indexOf('history')).toBeLessThan(methods.indexOf('getById'));
    expect(methods.indexOf('records')).toBeLessThan(methods.indexOf('getById'));
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      Reflect.getMetadata(PATH_METADATA, PaymentsController.prototype.history),
    ).toBe('history');
  });

  it.each([
    ['overview', RequestMethod.GET, '/'],
    ['records', RequestMethod.GET, 'records'],
    ['history', RequestMethod.GET, 'history'],
    ['getById', RequestMethod.GET, ':id'],
    ['create', RequestMethod.POST, '/'],
    ['changeStatus', RequestMethod.PATCH, ':id/status'],
    ['update', RequestMethod.PATCH, ':id'],
  ] as const)('maps %s to the PRD route', (method, verb, path) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
    const handler = PaymentsController.prototype[method];
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
  });

  it('answers POST /payments with 201', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
        PaymentsController.prototype.create,
      ),
    ).toBe(HttpStatus.CREATED);
  });

  describe('delegation', () => {
    const user = { id: 'admin-1', organizationId: 'org-1' } as never;
    const response = { id: PAYMENT_ID };
    const service = {
      overview: jest.fn().mockResolvedValue(response),
      history: jest.fn().mockResolvedValue(response),
      getById: jest.fn().mockResolvedValue(response),
      create: jest.fn().mockResolvedValue(response),
      update: jest.fn().mockResolvedValue(response),
      changeStatus: jest.fn().mockResolvedValue(response),
      forStudent: jest.fn().mockResolvedValue(response),
      own: jest.fn().mockResolvedValue(response),
    };
    const paymentsService = service as unknown as PaymentsService;

    it('passes the current user and input to PaymentsService', async () => {
      const controller = new PaymentsController(paymentsService);
      const body = {
        studentId: STUDENT_ID,
        amount: 1,
        purpose: 'Курс теорії',
      };

      await expect(controller.overview(user, {})).resolves.toBe(response);
      await expect(controller.history(user, {})).resolves.toBe(response);
      await expect(controller.getById(user, PAYMENT_ID)).resolves.toBe(
        response,
      );
      await expect(controller.create(user, body, 'key-12345678')).resolves.toBe(
        response,
      );
      await expect(
        controller.update(user, PAYMENT_ID, { amount: 2 }),
      ).resolves.toBe(response);
      await expect(
        controller.changeStatus(user, PAYMENT_ID, {
          status: PaymentStatus.PAID,
        }),
      ).resolves.toBe(response);

      expect(service.create).toHaveBeenCalledWith(user, body, 'key-12345678');
      expect(service.update).toHaveBeenCalledWith(user, PAYMENT_ID, {
        amount: 2,
      });
      expect(service.changeStatus).toHaveBeenCalledWith(user, PAYMENT_ID, {
        status: PaymentStatus.PAID,
      });
    });

    it('passes the student id and the current student', async () => {
      await new StudentPaymentsController(paymentsService).list(
        user,
        STUDENT_ID,
      );
      await new MePaymentsController(paymentsService).own(user);

      expect(service.forStudent).toHaveBeenCalledWith(user, STUDENT_ID);
      expect(service.own).toHaveBeenCalledWith(user);
    });
  });
});
