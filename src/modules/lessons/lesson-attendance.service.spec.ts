import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  EnrollmentStatus,
  GroupStatus,
  LessonStatus,
  OrganizationStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceRecordDto } from './lesson-attendance.dto';
import {
  ATTENDANCE_GROUP_CLOSED_MESSAGE,
  ATTENDANCE_LESSON_CANCELLED_MESSAGE,
  ATTENDANCE_NOT_STARTED_MESSAGE,
  ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE,
  LessonAttendanceService,
} from './lesson-attendance.service';
import { LESSON_NOT_FOUND_MESSAGE } from './lessons.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

const NOW = new Date('2026-10-21T10:00:00.000Z');
const MARKED_BEFORE = new Date('2026-10-21T09:40:00.000Z');

type Person = { id: string; firstName: string; lastName: string };

const people: Record<string, Person> = {
  'admin-1': { id: 'admin-1', firstName: 'Марія', lastName: 'Іваненко' },
  'teacher-1': { id: 'teacher-1', firstName: 'Ірина', lastName: 'Мельник' },
  'student-1': { id: 'student-1', firstName: 'Олена', lastName: 'Коваль' },
  'student-2': { id: 'student-2', firstName: 'Петро', lastName: 'Шевчук' },
  'student-3': { id: 'student-3', firstName: 'Андрій', lastName: 'Бойко' },
};

type EnrollmentRow = { studentId: string; status: EnrollmentStatus };
type MarkRow = {
  studentId: string;
  status: AttendanceStatus;
  markedAt: Date;
  markedById: string | null;
};

type EnrollmentQuery = {
  where: {
    status?: EnrollmentStatus;
    studentId?: { in: string[] };
    OR?: [{ status: EnrollmentStatus }, unknown];
  };
};
type MarkQuery = {
  where: { studentId?: { in: string[] } };
  select: { markedAt?: true };
};
type MarkWrite = {
  where: { studentId: { in: string[] } };
  data: { status: AttendanceStatus; markedById: string; markedAt: Date };
};
type MarkCreate = { data: (MarkRow & { lessonId: string })[] };

describe('LessonAttendanceService', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };
  const teacherActor = {
    id: 'teacher-1',
    role: UserRole.TEACHER,
    organizationId: 'org-1',
  };
  const otherTeacher = {
    id: 'teacher-2',
    role: UserRole.TEACHER,
    organizationId: 'org-1',
  };
  const forbiddenActors = [
    UserRole.INSTRUCTOR,
    UserRole.STUDENT,
    UserRole.OWNER,
  ].map(
    (role) =>
      [
        role,
        { id: `${role.toLowerCase()}-1`, role, organizationId: 'org-1' },
      ] as const,
  );

  function lessonRow(overrides: { lesson?: object; group?: object } = {}) {
    return {
      id: 'lesson-1',
      groupId: 'group-1',
      topic: 'Дорожні знаки',
      // Почалося пів години тому.
      scheduledAt: new Date('2026-10-21T09:30:00.000Z'),
      durationMin: 90,
      status: LessonStatus.SCHEDULED as LessonStatus,
      cancelledAt: null as Date | null,
      cancellationReason: null as string | null,
      updatedAt: new Date('2026-10-20T09:00:00.000Z'),
      group: {
        id: 'group-1',
        name: 'ПДР — Група А',
        status: GroupStatus.ACTIVE as GroupStatus,
        teacherId: 'teacher-1',
        teacher: people['teacher-1'],
        ...overrides.group,
      },
      ...overrides.lesson,
    };
  }

  let enrollments: EnrollmentRow[];
  let marks: MarkRow[];

  const prisma = {
    organization: { findUnique: jest.fn() },
    lesson: { findFirst: jest.fn() },
    enrollment: { findMany: jest.fn() },
    lessonAttendance: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: LessonAttendanceService;
  let log: jest.SpyInstance;

  /**
   * In-memory enrollments and marks of one lesson. The roster query is the one
   * with OR; the member check filters ACTIVE by studentId. The marks query with
   * markedAt reads the roster; without it, the saved statuses before a write.
   */
  function useFakeTables() {
    prisma.enrollment.findMany.mockImplementation(
      ({ where }: EnrollmentQuery) => {
        if (where.OR) {
          const rosterStatus = where.OR[0].status;
          return Promise.resolve(
            enrollments
              .filter(
                (row) =>
                  row.status === rosterStatus ||
                  marks.some((mark) => mark.studentId === row.studentId),
              )
              .map((row) => ({
                status: row.status,
                student: people[row.studentId],
              })),
          );
        }
        return Promise.resolve(
          enrollments
            .filter(
              (row) =>
                row.status === where.status &&
                where.studentId?.in.includes(row.studentId),
            )
            .map((row) => ({ studentId: row.studentId })),
        );
      },
    );
    prisma.lessonAttendance.findMany.mockImplementation(
      ({ where, select }: MarkQuery) => {
        if (select.markedAt) {
          return Promise.resolve(
            marks.map((mark) => ({
              status: mark.status,
              markedAt: mark.markedAt,
              student: people[mark.studentId],
              markedBy: mark.markedById ? people[mark.markedById] : null,
            })),
          );
        }
        return Promise.resolve(
          marks
            .filter((mark) => where.studentId?.in.includes(mark.studentId))
            .map(({ studentId, status }) => ({ studentId, status })),
        );
      },
    );
    prisma.lessonAttendance.createMany.mockImplementation(
      ({ data }: MarkCreate) => {
        marks.push(
          ...data.map(({ studentId, status, markedAt, markedById }) => ({
            studentId,
            status,
            markedAt,
            markedById,
          })),
        );
        return Promise.resolve({ count: data.length });
      },
    );
    prisma.lessonAttendance.updateMany.mockImplementation(
      ({ where, data }: MarkWrite) => {
        const rows = marks.filter((mark) =>
          where.studentId.in.includes(mark.studentId),
        );
        rows.forEach((mark) => Object.assign(mark, data));
        return Promise.resolve({ count: rows.length });
      },
    );
  }

  /** Rebuilds a tagged-template raw query into the final SQL text. */
  function rawSql(index: number): string {
    const [strings, ...values] = prisma.$queryRaw.mock.calls[index] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return Prisma.sql(strings, ...values)
      .text.replace(/\s+/g, ' ')
      .trim();
  }

  function records(...entries: [string, AttendanceStatus][]): {
    records: AttendanceRecordDto[];
  } {
    return {
      records: entries.map(([studentId, status]) => ({ studentId, status })),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    enrollments = [
      { studentId: 'student-1', status: EnrollmentStatus.ACTIVE },
      { studentId: 'student-2', status: EnrollmentStatus.ACTIVE },
    ];
    marks = [];
    useFakeTables();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      status: OrganizationStatus.ACTIVE,
      deletedAt: null,
    });
    prisma.lesson.findFirst.mockResolvedValue(lessonRow());
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    service = new LessonAttendanceService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getAttendance', () => {
    it('returns the lesson, editable and every student with their mark or null', async () => {
      marks = [
        {
          studentId: 'student-2',
          status: AttendanceStatus.LATE,
          markedAt: MARKED_BEFORE,
          markedById: 'teacher-1',
        },
      ];

      const result = await service.getAttendance(admin as never, 'lesson-1');

      expect(result).toEqual({
        lesson: {
          id: 'lesson-1',
          type: 'THEORY',
          status: LessonStatus.SCHEDULED,
          topic: 'Дорожні знаки',
          scheduledAt: new Date('2026-10-21T09:30:00.000Z'),
          endsAt: new Date('2026-10-21T11:00:00.000Z'),
          durationMin: 90,
          group: { id: 'group-1', name: 'ПДР — Група А' },
          teacher: people['teacher-1'],
          cancelledAt: null,
          cancellationReason: null,
          updatedAt: new Date('2026-10-20T09:00:00.000Z'),
        },
        editable: true,
        students: [
          {
            ...people['student-1'],
            enrollmentStatus: EnrollmentStatus.ACTIVE,
            attendance: null,
          },
          {
            ...people['student-2'],
            enrollmentStatus: EnrollmentStatus.ACTIVE,
            attendance: {
              status: AttendanceStatus.LATE,
              markedAt: MARKED_BEFORE,
              markedBy: people['teacher-1'],
            },
          },
        ],
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('sorts students by last name, then first name', async () => {
      enrollments.push({
        studentId: 'student-3',
        status: EnrollmentStatus.ACTIVE,
      });

      const result = await service.getAttendance(admin as never, 'lesson-1');

      expect(result.students.map((student) => student.lastName)).toEqual([
        'Бойко',
        'Коваль',
        'Шевчук',
      ]);
    });

    it('lets the group teacher read the list', async () => {
      await expect(
        service.getAttendance(teacherActor as never, 'lesson-1'),
      ).resolves.toMatchObject({ editable: true });
    });

    it('forbids a teacher of another group', async () => {
      const error = await caught(
        service.getAttendance(otherTeacher as never, 'lesson-1'),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.enrollment.findMany).not.toHaveBeenCalled();
    });

    it.each(forbiddenActors)(
      'forbids %s before touching the database',
      async (_, actor) => {
        const error = await caught(
          service.getAttendance(actor as never, 'lesson-1'),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.organization.findUnique).not.toHaveBeenCalled();
        expect(prisma.lesson.findFirst).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for a lesson of another organization', async () => {
      prisma.lesson.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.getAttendance(admin as never, 'lesson-1'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
      expect(prisma.lesson.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lesson-1', group: { organizationId: 'org-1' } },
        }),
      );
    });

    it('returns 404 when the organization is soft-deleted', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: 'org-1',
        deletedAt: new Date('2026-10-01T00:00:00.000Z'),
      });

      const error = await caught(
        service.getAttendance(admin as never, 'lesson-1'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.lesson.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      [
        'cancelled',
        lessonRow({
          lesson: {
            status: LessonStatus.CANCELLED,
            cancelledAt: MARKED_BEFORE,
          },
        }),
      ],
      [
        'in the future',
        lessonRow({
          lesson: { scheduledAt: new Date('2026-10-22T09:30:00.000Z') },
        }),
      ],
      [
        'of a closed group',
        lessonRow({ group: { status: GroupStatus.COMPLETED } }),
      ],
    ])('shows a lesson %s as not editable', async (_, row) => {
      prisma.lesson.findFirst.mockResolvedValue(row);

      await expect(
        service.getAttendance(admin as never, 'lesson-1'),
      ).resolves.toMatchObject({ editable: false });
    });

    it('lists the members of a closed group by their COMPLETED enrollment', async () => {
      prisma.lesson.findFirst.mockResolvedValue(
        lessonRow({ group: { status: GroupStatus.ARCHIVED } }),
      );
      enrollments = [
        { studentId: 'student-1', status: EnrollmentStatus.COMPLETED },
        { studentId: 'student-2', status: EnrollmentStatus.DROPPED },
      ];

      const result = await service.getAttendance(admin as never, 'lesson-1');

      expect(result.students).toEqual([
        expect.objectContaining({
          id: 'student-1',
          enrollmentStatus: EnrollmentStatus.COMPLETED,
        }),
      ]);
    });

    it('keeps a marked student who left the group, with their enrollment status', async () => {
      enrollments[1].status = EnrollmentStatus.DROPPED;
      marks = [
        {
          studentId: 'student-2',
          status: AttendanceStatus.PRESENT,
          markedAt: MARKED_BEFORE,
          markedById: 'teacher-1',
        },
      ];

      const result = await service.getAttendance(admin as never, 'lesson-1');

      expect(result.students[1]).toMatchObject({
        id: 'student-2',
        enrollmentStatus: EnrollmentStatus.DROPPED,
        attendance: { status: AttendanceStatus.PRESENT },
      });
    });

    it('keeps a marked student removed from the group with enrollmentStatus null', async () => {
      enrollments = [enrollments[0]];
      marks = [
        {
          studentId: 'student-2',
          status: AttendanceStatus.ABSENT,
          markedAt: MARKED_BEFORE,
          markedById: null,
        },
      ];

      const result = await service.getAttendance(admin as never, 'lesson-1');

      expect(result.students[1]).toEqual({
        ...people['student-2'],
        enrollmentStatus: null,
        attendance: {
          status: AttendanceStatus.ABSENT,
          markedAt: MARKED_BEFORE,
          markedBy: null,
        },
      });
    });

    it('filters the roster and the marks by organization', async () => {
      await service.getAttendance(admin as never, 'lesson-1');

      expect(prisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            groupId: 'group-1',
            student: { organizationId: 'org-1' },
          }) as unknown,
        }),
      );
      expect(prisma.lessonAttendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lessonId: 'lesson-1', student: { organizationId: 'org-1' } },
        }),
      );
    });
  });

  describe('updateAttendance', () => {
    it('creates new marks and returns the saved list', async () => {
      const result = await service.updateAttendance(
        teacherActor as never,
        'lesson-1',
        records(
          ['student-1', AttendanceStatus.PRESENT],
          ['student-2', AttendanceStatus.ABSENT],
        ),
      );

      expect(prisma.lessonAttendance.createMany).toHaveBeenCalledWith({
        data: [
          {
            lessonId: 'lesson-1',
            studentId: 'student-1',
            status: AttendanceStatus.PRESENT,
            markedById: 'teacher-1',
            markedAt: NOW,
          },
          {
            lessonId: 'lesson-1',
            studentId: 'student-2',
            status: AttendanceStatus.ABSENT,
            markedById: 'teacher-1',
            markedAt: NOW,
          },
        ],
      });
      expect(prisma.lessonAttendance.updateMany).not.toHaveBeenCalled();
      expect(result.students.map((student) => student.attendance)).toEqual([
        {
          status: AttendanceStatus.PRESENT,
          markedAt: NOW,
          markedBy: people['teacher-1'],
        },
        {
          status: AttendanceStatus.ABSENT,
          markedAt: NOW,
          markedBy: people['teacher-1'],
        },
      ]);
    });

    it('updates a changed mark in place and leaves an unchanged one alone', async () => {
      marks = [
        {
          studentId: 'student-1',
          status: AttendanceStatus.PRESENT,
          markedAt: MARKED_BEFORE,
          markedById: 'teacher-1',
        },
        {
          studentId: 'student-2',
          status: AttendanceStatus.ABSENT,
          markedAt: MARKED_BEFORE,
          markedById: 'teacher-1',
        },
      ];

      const result = await service.updateAttendance(
        admin as never,
        'lesson-1',
        records(
          ['student-1', AttendanceStatus.PRESENT],
          ['student-2', AttendanceStatus.LATE],
        ),
      );

      expect(prisma.lessonAttendance.createMany).not.toHaveBeenCalled();
      expect(prisma.lessonAttendance.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.lessonAttendance.updateMany).toHaveBeenCalledWith({
        where: { lessonId: 'lesson-1', studentId: { in: ['student-2'] } },
        data: {
          status: AttendanceStatus.LATE,
          markedById: 'admin-1',
          markedAt: NOW,
        },
      });
      expect(marks).toHaveLength(2);
      expect(result.students.map((student) => student.attendance)).toEqual([
        {
          status: AttendanceStatus.PRESENT,
          markedAt: MARKED_BEFORE,
          markedBy: people['teacher-1'],
        },
        {
          status: AttendanceStatus.LATE,
          markedAt: NOW,
          markedBy: people['admin-1'],
        },
      ]);
      expect(log).toHaveBeenCalledWith(
        'Lesson attendance updated lessonId=lesson-1 groupId=group-1 changed=1 unchanged=1 actorId=admin-1 organizationId=org-1',
      );
    });

    it('writes one updateMany per status, whatever the group size', async () => {
      marks = ['student-1', 'student-2'].map((studentId) => ({
        studentId,
        status: AttendanceStatus.PRESENT,
        markedAt: MARKED_BEFORE,
        markedById: 'teacher-1',
      }));

      await service.updateAttendance(
        admin as never,
        'lesson-1',
        records(
          ['student-1', AttendanceStatus.ABSENT],
          ['student-2', AttendanceStatus.ABSENT],
        ),
      );

      expect(prisma.lessonAttendance.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.lessonAttendance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            lessonId: 'lesson-1',
            studentId: { in: ['student-1', 'student-2'] },
          },
        }),
      );
    });

    it('logs counts only, never names or statuses', async () => {
      await service.updateAttendance(
        admin as never,
        'lesson-1',
        records(['student-1', AttendanceStatus.EXCUSED]),
      );

      const [message] = log.mock.calls[0] as [string];
      expect(message).not.toMatch(/Коваль|EXCUSED|student-1/);
    });

    it('forbids a teacher of another group without writing', async () => {
      const error = await caught(
        service.updateAttendance(
          otherTeacher as never,
          'lesson-1',
          records(['student-1', AttendanceStatus.PRESENT]),
        ),
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(prisma.lessonAttendance.createMany).not.toHaveBeenCalled();
      expect(prisma.lessonAttendance.updateMany).not.toHaveBeenCalled();
    });

    it.each(forbiddenActors)(
      'forbids %s before opening a transaction',
      async (_, actor) => {
        const error = await caught(
          service.updateAttendance(
            actor as never,
            'lesson-1',
            records(['student-1', AttendanceStatus.PRESENT]),
          ),
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('returns 404 for a lesson of another organization without locking', async () => {
      prisma.lesson.findFirst.mockResolvedValue(null);

      const error = await caught(
        service.updateAttendance(
          admin as never,
          'lesson-1',
          records(['student-1', AttendanceStatus.PRESENT]),
        ),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('locks the group FOR SHARE, then the lesson FOR UPDATE, then reads and writes', async () => {
      await service.updateAttendance(
        admin as never,
        'lesson-1',
        records(['student-1', AttendanceStatus.PRESENT]),
      );

      expect(rawSql(0)).toBe(
        'SELECT id FROM groups WHERE id = $1::uuid AND organization_id = $2::uuid FOR SHARE',
      );
      expect(rawSql(1)).toContain('FOR UPDATE OF l');
      const order = [
        prisma.$queryRaw.mock.invocationCallOrder[0],
        prisma.$queryRaw.mock.invocationCallOrder[1],
        prisma.lesson.findFirst.mock.invocationCallOrder[1],
        prisma.enrollment.findMany.mock.invocationCallOrder[0],
        prisma.lessonAttendance.createMany.mock.invocationCallOrder[0],
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('refuses a cancelled lesson with currentStatus, before the group and time checks', async () => {
      prisma.lesson.findFirst.mockResolvedValue(
        lessonRow({
          lesson: {
            status: LessonStatus.CANCELLED,
            cancelledAt: MARKED_BEFORE,
            scheduledAt: new Date('2026-10-22T09:30:00.000Z'),
          },
          group: { status: GroupStatus.ARCHIVED },
        }),
      );

      const error = await caught(
        service.updateAttendance(
          admin as never,
          'lesson-1',
          records(['student-1', AttendanceStatus.PRESENT]),
        ),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        message: ATTENDANCE_LESSON_CANCELLED_MESSAGE,
        error: 'Conflict',
        currentStatus: LessonStatus.CANCELLED,
      });
    });

    it.each([GroupStatus.COMPLETED, GroupStatus.ARCHIVED])(
      'refuses a lesson of a %s group',
      async (status) => {
        prisma.lesson.findFirst.mockResolvedValue(
          lessonRow({ group: { status } }),
        );

        const error = await caught(
          service.updateAttendance(
            admin as never,
            'lesson-1',
            records(['student-1', AttendanceStatus.PRESENT]),
          ),
        );

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toBe(ATTENDANCE_GROUP_CLOSED_MESSAGE);
        expect(prisma.lessonAttendance.createMany).not.toHaveBeenCalled();
      },
    );

    it('refuses a lesson that has not started yet', async () => {
      prisma.lesson.findFirst.mockResolvedValue(
        lessonRow({
          lesson: { scheduledAt: new Date('2026-10-21T10:00:00.001Z') },
        }),
      );

      const error = await caught(
        service.updateAttendance(
          admin as never,
          'lesson-1',
          records(['student-1', AttendanceStatus.PRESENT]),
        ),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toBe(ATTENDANCE_NOT_STARTED_MESSAGE);
    });

    it('accepts a lesson that starts exactly now', async () => {
      prisma.lesson.findFirst.mockResolvedValue(
        lessonRow({ lesson: { scheduledAt: NOW } }),
      );

      await expect(
        service.updateAttendance(
          admin as never,
          'lesson-1',
          records(['student-1', AttendanceStatus.PRESENT]),
        ),
      ).resolves.toMatchObject({ editable: true });
    });

    it('accepts a COMPLETED lesson of an open group', async () => {
      prisma.lesson.findFirst.mockResolvedValue(
        lessonRow({ lesson: { status: LessonStatus.COMPLETED } }),
      );

      await expect(
        service.updateAttendance(
          admin as never,
          'lesson-1',
          records(['student-1', AttendanceStatus.PRESENT]),
        ),
      ).resolves.toMatchObject({ editable: true });
    });

    it('rejects every student who is not an ACTIVE member, and writes nothing', async () => {
      enrollments[1].status = EnrollmentStatus.DROPPED;

      const error = await caught(
        service.updateAttendance(
          admin as never,
          'lesson-1',
          records(
            ['student-1', AttendanceStatus.PRESENT],
            ['student-2', AttendanceStatus.PRESENT],
            ['foreign-student', AttendanceStatus.PRESENT],
          ),
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [
          {
            field: 'records.1.studentId',
            message: ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE,
          },
          {
            field: 'records.2.studentId',
            message: ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE,
          },
        ],
      });
      expect(prisma.lessonAttendance.createMany).not.toHaveBeenCalled();
      expect(prisma.lessonAttendance.updateMany).not.toHaveBeenCalled();
    });

    it('checks membership within the group and the organization', async () => {
      await service.updateAttendance(
        admin as never,
        'lesson-1',
        records(['student-1', AttendanceStatus.PRESENT]),
      );

      expect(prisma.enrollment.findMany).toHaveBeenCalledWith({
        where: {
          groupId: 'group-1',
          status: EnrollmentStatus.ACTIVE,
          studentId: { in: ['student-1'] },
          student: { organizationId: 'org-1' },
        },
        select: { studentId: true },
      });
    });
  });
});
