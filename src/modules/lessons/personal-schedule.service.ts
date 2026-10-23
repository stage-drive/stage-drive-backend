import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DrivingLessonStatus,
  EnrollmentStatus,
  LessonStatus,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PracticeLessonView,
  practiceLessonViewSelect,
  TheoryLessonView,
  theoryLessonViewSelect,
  toPracticeLessonDto,
  toTheoryLessonDto,
} from './lesson-view';
import {
  LessonTiming,
  LessonTypeFilter,
  PersonalScheduleDto,
  PersonalScheduleItemDto,
  PersonalScheduleQueryDto,
  SCHEDULE_DEFAULT_RANGE_DAYS,
  SCHEDULE_MAX_RANGE_DAYS,
  SCHEDULE_RANGE_LENGTH_MESSAGE,
  SCHEDULE_RANGE_ORDER_MESSAGE,
} from './lessons.dto';
import { candidateWindow, overlaps, ScheduleSlot } from './schedule-conflicts';

export const SCHEDULE_VIEW_ROLES = [
  UserRole.TEACHER,
  UserRole.INSTRUCTOR,
  UserRole.STUDENT,
] as const;

const DAY_MS = 24 * 60 * 60_000;

/** При однаковому часі теорія йде раніше за практику. */
const TYPE_ORDER: Record<LessonTypeFilter, number> = {
  THEORY: 0,
  PRACTICE: 1,
};

/** null — у ролі немає занять цього типу, запиту в БД не буде. */
type ScheduleScope = {
  theory: Prisma.LessonWhereInput | null;
  practice: Prisma.DrivingLessonWhereInput | null;
};

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

/**
 * Заняття, що належать до розкладу користувача. Кожна умова містить фільтр
 * організації. «Немає занять» — це null, а не {}: порожній where повернув би
 * заняття всіх автошкіл. Ролі без власних занять — 403.
 */
function scheduleScope(actor: User, now: Date): ScheduleScope {
  const organizationId = actor.organizationId;

  switch (actor.role) {
    case UserRole.TEACHER:
      return {
        theory: { group: { organizationId, teacherId: actor.id } },
        practice: null,
      };
    case UserRole.INSTRUCTOR:
      return {
        theory: null,
        practice: { organizationId, instructorId: actor.id },
      };
    case UserRole.STUDENT:
      return {
        theory: {
          group: { organizationId },
          OR: [
            {
              group: {
                enrollments: {
                  some: {
                    studentId: actor.id,
                    status: EnrollmentStatus.ACTIVE,
                  },
                },
              },
            },
            // Закриття групи переводить зарахування в COMPLETED. З нього —
            // лише історія: майбутні заняття вже не студента.
            {
              scheduledAt: { lte: now },
              group: {
                enrollments: {
                  some: {
                    studentId: actor.id,
                    status: EnrollmentStatus.COMPLETED,
                  },
                },
              },
            },
          ],
        },
        practice: { organizationId, studentId: actor.id },
      };
    default:
      throw new ForbiddenException('Insufficient permissions');
  }
}

/** Формат from і to уже перевірив DTO; тут — правила, що зв'язують обидва поля. */
function resolveRange(
  query: PersonalScheduleQueryDto,
  now: Date,
): ScheduleSlot {
  const start = query.from ? new Date(query.from) : now;
  const end = query.to
    ? new Date(query.to)
    : new Date(start.getTime() + SCHEDULE_DEFAULT_RANGE_DAYS * DAY_MS);

  if (end.getTime() <= start.getTime()) {
    throw fieldError('to', SCHEDULE_RANGE_ORDER_MESSAGE);
  }
  if (end.getTime() - start.getTime() > SCHEDULE_MAX_RANGE_DAYS * DAY_MS) {
    throw fieldError('to', SCHEDULE_RANGE_LENGTH_MESSAGE);
  }
  return { start, end };
}

/** Межі ті самі, що в assertNotStarted: scheduledAt = now — уже почалося. */
export function lessonTiming(
  scheduledAt: Date,
  endsAt: Date,
  now: Date,
): LessonTiming {
  if (now.getTime() < scheduledAt.getTime()) {
    return 'UPCOMING';
  }
  return now.getTime() < endsAt.getTime() ? 'IN_PROGRESS' : 'FINISHED';
}

function withTiming<T extends { scheduledAt: Date; endsAt: Date }>(
  dto: T,
  now: Date,
): T & { timing: LessonTiming } {
  return { ...dto, timing: lessonTiming(dto.scheduledAt, dto.endsAt, now) };
}

/** id — останній ключ, щоб порядок не змінювався між запитами. */
function compareItems(
  a: PersonalScheduleItemDto,
  b: PersonalScheduleItemDto,
): number {
  return (
    a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
    a.id.localeCompare(b.id)
  );
}

@Injectable()
export class PersonalScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Розклад поточного користувача: заняття, що перетинають вікно
   * [from, to). Без транзакції: це читання, як у DashboardService.
   */
  async getMySchedule(
    actor: User,
    query: PersonalScheduleQueryDto,
  ): Promise<PersonalScheduleDto> {
    const now = new Date();
    // Як у LessonsService: 403 і 400 — до запитів у БД, потім 404.
    const scope = scheduleScope(actor, now);
    const range = resolveRange(query, now);
    const organization = await this.requireOrganization(actor.organizationId);

    const scheduledAt = candidateWindow(range);
    const includeCancelled = query.includeCancelled === true;
    const [theory, practice] = await Promise.all([
      this.findTheory(
        query.type === 'PRACTICE' ? null : scope.theory,
        scheduledAt,
        includeCancelled,
      ),
      this.findPractice(
        query.type === 'THEORY' ? null : scope.practice,
        scheduledAt,
        includeCancelled,
      ),
    ]);

    // БД повертає кандидатів, що починаються у вікні candidateWindow;
    // точний перетин рахує overlaps, як у пошуку конфліктів.
    const items: PersonalScheduleItemDto[] = [
      ...theory
        .filter((row) => overlaps(range, row))
        .map((row) => withTiming(toTheoryLessonDto(row), now)),
      ...practice
        .filter((row) => overlaps(range, row))
        .map((row) => withTiming(toPracticeLessonDto(row), now)),
    ];

    return {
      from: range.start,
      to: range.end,
      timezone: organization.timezone,
      items: items.sort(compareItems),
    };
  }

  // AND, а не spread: однойменний ключ у scope не перетре вікно чи фільтр статусу.
  private async findTheory(
    where: Prisma.LessonWhereInput | null,
    scheduledAt: Prisma.DateTimeFilter,
    includeCancelled: boolean,
  ): Promise<TheoryLessonView[]> {
    if (!where) {
      return [];
    }
    return this.prisma.lesson.findMany({
      where: {
        AND: [
          where,
          { scheduledAt },
          includeCancelled ? {} : { status: { not: LessonStatus.CANCELLED } },
        ],
      },
      select: theoryLessonViewSelect,
    });
  }

  private async findPractice(
    where: Prisma.DrivingLessonWhereInput | null,
    scheduledAt: Prisma.DateTimeFilter,
    includeCancelled: boolean,
  ): Promise<PracticeLessonView[]> {
    if (!where) {
      return [];
    }
    return this.prisma.drivingLesson.findMany({
      where: {
        AND: [
          where,
          { scheduledAt },
          includeCancelled
            ? {}
            : { status: { not: DrivingLessonStatus.CANCELLED } },
        ],
      },
      select: practiceLessonViewSelect,
    });
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }
}
