import { Logger } from '@nestjs/common';
import { BookingConfirmation, LessonStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BOOKING_EXPIRED_REASON,
  PracticeRequestExpiryJob,
} from './practice-request-expiry.job';

const NOW = new Date('2026-11-10T10:00:00.000Z');

describe('PracticeRequestExpiryJob', () => {
  const prisma = { drivingLesson: { updateMany: jest.fn() } };
  let job: PracticeRequestExpiryJob;
  let log: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.drivingLesson.updateMany.mockResolvedValue({ count: 0 });
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    job = new PracticeRequestExpiryJob(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    job.onModuleDestroy();
    jest.useRealTimers();
    log.mockRestore();
    errorLog.mockRestore();
  });

  it('rejects pending requests that start within 2 hours in one update', async () => {
    prisma.drivingLesson.updateMany.mockResolvedValue({ count: 3 });

    await expect(job.expireOverdue(NOW)).resolves.toBe(3);

    expect(prisma.drivingLesson.updateMany).toHaveBeenCalledWith({
      where: {
        status: LessonStatus.SCHEDULED,
        confirmationStatus: BookingConfirmation.PENDING,
        scheduledAt: { lte: new Date('2026-11-10T12:00:00.000Z') },
      },
      data: {
        status: LessonStatus.CANCELLED,
        confirmationStatus: BookingConfirmation.REJECTED,
        cancelledAt: NOW,
        cancellationReason: BOOKING_EXPIRED_REASON,
      },
    });
    expect(log).toHaveBeenCalledWith(
      'Practice booking requests expired count=3',
    );
  });

  it('logs nothing when no request expired', async () => {
    await job.expireOverdue(NOW);

    expect(log).not.toHaveBeenCalled();
  });

  it('runs on bootstrap and then every minute until destroyed', async () => {
    jest.useFakeTimers({ now: NOW });

    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(prisma.drivingLesson.updateMany).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(prisma.drivingLesson.updateMany).toHaveBeenCalledTimes(2);

    job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(prisma.drivingLesson.updateMany).toHaveBeenCalledTimes(2);
  });

  it('logs a failed run and keeps going', async () => {
    jest.useFakeTimers({ now: NOW });
    prisma.drivingLesson.updateMany
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue({ count: 0 });

    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(errorLog).toHaveBeenCalledWith(
      'Failed to expire practice booking requests: connection lost',
      expect.any(String),
    );

    await jest.advanceTimersByTimeAsync(60_000);
    expect(prisma.drivingLesson.updateMany).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the previous run is still going', async () => {
    jest.useFakeTimers({ now: NOW });
    let finish: () => void = () => undefined;
    prisma.drivingLesson.updateMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ count: 0 });
        }),
    );

    job.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(prisma.drivingLesson.updateMany).toHaveBeenCalledTimes(1);

    finish();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(prisma.drivingLesson.updateMany).toHaveBeenCalledTimes(2);
  });
});
