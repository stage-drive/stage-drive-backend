import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceStatus,
  EnrollmentStatus,
  GroupStatus,
  LessonStatus,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import { FieldError } from '../../common/validation/field-error';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AttendanceRecordDto,
  LessonAttendanceDto,
  LessonAttendanceStudentDto,
  UpdateLessonAttendanceDto,
} from './lesson-attendance.dto';
import {
  lessonPersonSelect,
  theoryLessonViewSelect,
  toPerson,
  toTheoryLessonDto,
} from './lesson-view';
import {
  LESSON_NOT_FOUND_MESSAGE,
  assertCanEditTheory,
  lockTheoryLessonWithGroup,
} from './lessons.service';

export const ATTENDANCE_LESSON_CANCELLED_MESSAGE =
  'Відвідування скасованого заняття не ведеться.';
export const ATTENDANCE_GROUP_CLOSED_MESSAGE =
  'Відвідування занять групи зі статусом COMPLETED або ARCHIVED змінювати не можна.';
export const ATTENDANCE_NOT_STARTED_MESSAGE =
  'Відвідування можна відмітити лише після початку заняття.';
export const ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE =
  'Студент не входить до складу групи заняття.';

const OPEN_GROUP_STATUSES: GroupStatus[] = [
  GroupStatus.PLANNED,
  GroupStatus.ACTIVE,
];

/** Надмножина theoryLessonViewSelect: статус і викладач групи потрібні перевіркам. */
const attendanceLessonSelect = {
  ...theoryLessonViewSelect,
  groupId: true,
  group: {
    select: {
      ...theoryLessonViewSelect.group.select,
      status: true,
      teacherId: true,
    },
  },
} satisfies Prisma.LessonSelect;

type AttendanceLessonRow = Prisma.LessonGetPayload<{
  select: typeof attendanceLessonSelect;
}>;

const nameCollator = new Intl.Collator('uk');

function byName(
  a: LessonAttendanceStudentDto,
  b: LessonAttendanceStudentDto,
): number {
  return (
    nameCollator.compare(a.lastName, b.lastName) ||
    nameCollator.compare(a.firstName, b.firstName) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function isOpenGroup(status: GroupStatus): boolean {
  return OPEN_GROUP_STATUSES.includes(status);
}

function assertTeachesGroup(actor: User, teacherId: string): void {
  if (actor.role === UserRole.TEACHER && teacherId !== actor.id) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

/**
 * null — відвідування можна змінювати; інакше виняток, який кине PATCH.
 * Порядок «статус → група → час», як у cancelTheory: скасоване заняття
 * закритої групи завжди повертає currentStatus. Межа часу та сама, що в
 * assertNotStarted: scheduledAt = now — заняття вже почалося.
 */
function attendanceBlocker(
  lesson: AttendanceLessonRow,
  now: Date,
): HttpException | null {
  if (lesson.status === LessonStatus.CANCELLED) {
    return new ConflictException({
      statusCode: 409,
      message: ATTENDANCE_LESSON_CANCELLED_MESSAGE,
      error: 'Conflict',
      currentStatus: lesson.status,
    });
  }
  if (!isOpenGroup(lesson.group.status)) {
    return new ConflictException(ATTENDANCE_GROUP_CLOSED_MESSAGE);
  }
  if (lesson.scheduledAt.getTime() > now.getTime()) {
    return new ConflictException(ATTENDANCE_NOT_STARTED_MESSAGE);
  }
  return null;
}

/**
 * Відвідування теоретичних занять. Один рядок на пару (заняття, студент) —
 * актуальний статус. Змінювати можна лише студентів з ACTIVE-зарахуванням у
 * групу заняття; відмітки тих, хто вибув, лишаються як історія.
 */
@Injectable()
export class LessonAttendanceService {
  private readonly logger = new Logger(LessonAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Список видно для заняття в будь-якому стані; editable каже, чи можна його змінити. */
  async getAttendance(
    actor: User,
    lessonId: string,
  ): Promise<LessonAttendanceDto> {
    assertCanEditTheory(actor);
    await this.requireOrganization(actor.organizationId);

    const lesson = await this.findLesson(this.prisma, actor, lessonId);
    return this.loadAttendance(this.prisma, actor, lesson, new Date());
  }

  /**
   * Пакет атомарний: одна помилка — нічого не збережено. Порядок блокувань той
   * самий, що в changeTheory і cancelTheory: група (FOR SHARE) → заняття
   * (FOR UPDATE). Перенесення того самого заняття чекає на цю транзакцію і
   * бачить збережені відмітки.
   */
  async updateAttendance(
    actor: User,
    lessonId: string,
    payload: UpdateLessonAttendanceDto,
  ): Promise<LessonAttendanceDto> {
    assertCanEditTheory(actor);
    await this.requireOrganization(actor.organizationId);
    const now = new Date();

    const { result, changed } = await this.prisma.$transaction(async (tx) => {
      await lockTheoryLessonWithGroup(tx, actor.organizationId, lessonId);
      const lesson = await this.findLesson(tx, actor, lessonId);
      const blocker = attendanceBlocker(lesson, now);
      if (blocker) {
        throw blocker;
      }
      await this.assertActiveMembers(
        tx,
        actor,
        lesson.groupId,
        payload.records,
      );

      const changed = await this.writeChanged(
        tx,
        actor,
        lesson.id,
        payload.records,
        now,
      );
      // Читання після запису в тій самій транзакції: відповідь — збережений стан.
      const result = await this.loadAttendance(tx, actor, lesson, now);
      return { result, changed };
    });

    this.logger.log(
      `Lesson attendance updated lessonId=${result.lesson.id} groupId=${result.lesson.group.id} changed=${changed} unchanged=${payload.records.length - changed} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return result;
  }

  /** Заняття іншої організації — 404, заняття чужої групи для TEACHER — 403. */
  private async findLesson(
    client: Prisma.TransactionClient,
    actor: User,
    lessonId: string,
  ): Promise<AttendanceLessonRow> {
    const lesson = await client.lesson.findFirst({
      where: {
        id: lessonId,
        group: { organizationId: actor.organizationId },
      },
      select: attendanceLessonSelect,
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    assertTeachesGroup(actor, lesson.group.teacherId);
    return lesson;
  }

  /**
   * Кожен studentId — ACTIVE-зарахування в групу заняття і студент своєї
   * організації. Одне повідомлення для всіх причин: не розкриває, чи існує
   * студент в іншій автошколі.
   */
  private async assertActiveMembers(
    tx: Prisma.TransactionClient,
    actor: User,
    groupId: string,
    records: AttendanceRecordDto[],
  ): Promise<void> {
    const members = await tx.enrollment.findMany({
      where: {
        groupId,
        status: EnrollmentStatus.ACTIVE,
        studentId: { in: records.map((record) => record.studentId) },
        student: { organizationId: actor.organizationId },
      },
      select: { studentId: true },
    });
    const memberIds = new Set(members.map((member) => member.studentId));
    const errors: FieldError[] = records.flatMap((record, index) =>
      memberIds.has(record.studentId)
        ? []
        : [
            {
              field: `records.${index}.studentId`,
              message: ATTENDANCE_STUDENT_NOT_IN_GROUP_MESSAGE,
            },
          ],
    );
    if (errors.length > 0) {
      throw new BadRequestException({ statusCode: 400, errors });
    }
  }

  /**
   * Записи з тим самим статусом не пишуться: markedAt і markedBy лишаються
   * старими. Не більше п'яти запитів: createMany для нових і updateMany на
   * кожен статус серед змінених. Блокування заняття серіалізує всі записи
   * цього заняття, тож createMany не наткнеться на унікальний індекс.
   */
  private async writeChanged(
    tx: Prisma.TransactionClient,
    actor: User,
    lessonId: string,
    records: AttendanceRecordDto[],
    now: Date,
  ): Promise<number> {
    const existing = await tx.lessonAttendance.findMany({
      where: {
        lessonId,
        studentId: { in: records.map((record) => record.studentId) },
      },
      select: { studentId: true, status: true },
    });
    const saved = new Map(existing.map((row) => [row.studentId, row.status]));
    const created = records.filter((record) => !saved.has(record.studentId));
    const updated = records.filter(
      (record) =>
        saved.has(record.studentId) &&
        saved.get(record.studentId) !== record.status,
    );

    if (created.length > 0) {
      await tx.lessonAttendance.createMany({
        data: created.map((record) => ({
          lessonId,
          studentId: record.studentId,
          status: record.status,
          markedById: actor.id,
          markedAt: now,
        })),
      });
    }
    for (const status of Object.values(AttendanceStatus)) {
      const studentIds = updated
        .filter((record) => record.status === status)
        .map((record) => record.studentId);
      if (studentIds.length > 0) {
        await tx.lessonAttendance.updateMany({
          where: { lessonId, studentId: { in: studentIds } },
          data: { status, markedById: actor.id, markedAt: now },
        });
      }
    }
    return created.length + updated.length;
  }

  /**
   * Склад заняття: ACTIVE-зарахування відкритої групи (COMPLETED — закритої:
   * закриття перевело в COMPLETED саме її склад) і кожен, кого вже відмічено.
   * Студент з відміткою без зарахування (видалений з групи) має
   * enrollmentStatus = null. Запити послідовні: у транзакції вони однаково
   * йдуть по одному з'єднанню.
   */
  private async loadAttendance(
    client: Prisma.TransactionClient,
    actor: User,
    lesson: AttendanceLessonRow,
    now: Date,
  ): Promise<LessonAttendanceDto> {
    const organizationId = actor.organizationId;
    const rosterStatus = isOpenGroup(lesson.group.status)
      ? EnrollmentStatus.ACTIVE
      : EnrollmentStatus.COMPLETED;

    const enrollments = await client.enrollment.findMany({
      where: {
        groupId: lesson.groupId,
        student: { organizationId },
        OR: [
          { status: rosterStatus },
          {
            student: { lessonAttendances: { some: { lessonId: lesson.id } } },
          },
        ],
      },
      select: { status: true, student: { select: lessonPersonSelect } },
    });
    const marks = await client.lessonAttendance.findMany({
      where: { lessonId: lesson.id, student: { organizationId } },
      select: {
        status: true,
        markedAt: true,
        student: { select: lessonPersonSelect },
        markedBy: { select: lessonPersonSelect },
      },
    });

    const students = new Map<string, LessonAttendanceStudentDto>();
    for (const enrollment of enrollments) {
      students.set(enrollment.student.id, {
        ...toPerson(enrollment.student),
        enrollmentStatus: enrollment.status,
        attendance: null,
      });
    }
    for (const mark of marks) {
      const student = students.get(mark.student.id) ?? {
        ...toPerson(mark.student),
        enrollmentStatus: null,
        attendance: null,
      };
      student.attendance = {
        status: mark.status,
        markedAt: mark.markedAt,
        markedBy: mark.markedBy ? toPerson(mark.markedBy) : null,
      };
      students.set(mark.student.id, student);
    }

    return {
      lesson: toTheoryLessonDto(lesson),
      editable: attendanceBlocker(lesson, now) === null,
      students: [...students.values()].sort(byName),
    };
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
