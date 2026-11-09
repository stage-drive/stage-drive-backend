import { BookingConfirmation, LessonStatus } from '@prisma/client';
import { practiceBookingStatus } from './lesson-view';

describe('practiceBookingStatus', () => {
  it.each([
    [LessonStatus.SCHEDULED, BookingConfirmation.PENDING, 'PENDING'],
    [LessonStatus.SCHEDULED, BookingConfirmation.CONFIRMED, 'CONFIRMED'],
    [LessonStatus.CANCELLED, BookingConfirmation.REJECTED, 'REJECTED'],
    // Студент відкликав запит, що чекав підтвердження.
    [LessonStatus.CANCELLED, BookingConfirmation.PENDING, 'CANCELLED'],
    [LessonStatus.CANCELLED, BookingConfirmation.CONFIRMED, 'CANCELLED'],
    [LessonStatus.COMPLETED, BookingConfirmation.CONFIRMED, 'COMPLETED'],
    [LessonStatus.NO_SHOW, BookingConfirmation.CONFIRMED, 'NO_SHOW'],
  ])('%s + %s → %s', (status, confirmationStatus, expected) => {
    expect(practiceBookingStatus({ status, confirmationStatus })).toBe(
      expected,
    );
  });
});
