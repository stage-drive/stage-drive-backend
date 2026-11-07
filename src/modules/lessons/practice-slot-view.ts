import { Prisma } from '@prisma/client';
import { lessonPersonSelect, toPerson } from './lesson-view';
import { PracticeSlotDto } from './practice-slots.dto';
import { lessonEnd } from './schedule-conflicts';

/**
 * Форма слоту у відповідях API. Select запису в PracticeSlotsService —
 * надмножина цього, тож його рядки передаються в мапер без перетворень.
 */
export const practiceSlotViewSelect = {
  id: true,
  scheduledAt: true,
  durationMin: true,
  createdAt: true,
  updatedAt: true,
  instructor: { select: lessonPersonSelect },
  car: {
    select: { id: true, plateNumber: true, category: true, transmission: true },
  },
} satisfies Prisma.PracticeSlotSelect;

export type PracticeSlotView = Prisma.PracticeSlotGetPayload<{
  select: typeof practiceSlotViewSelect;
}>;

export function toPracticeSlotDto(row: PracticeSlotView): PracticeSlotDto {
  return {
    id: row.id,
    scheduledAt: row.scheduledAt,
    endsAt: lessonEnd(row.scheduledAt, row.durationMin),
    durationMin: row.durationMin,
    instructor: toPerson(row.instructor),
    car: {
      id: row.car.id,
      plateNumber: row.car.plateNumber,
      category: row.car.category,
      transmission: row.car.transmission,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
