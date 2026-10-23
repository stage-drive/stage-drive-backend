import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseStatus,
  EnrollmentStatus,
  GroupStatus,
  LessonStatus,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { lockGroup } from '../../common/prisma/group-lock';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import {
  AddGroupStudentDto,
  AssignGroupCourseDto,
  CreateGroupDto,
  GroupListDto,
  GroupListItemDto,
  GroupStudentDto,
  GroupStudentsDto,
  UpdateGroupDto,
  UpdateGroupStatusDto,
} from './groups.dto';

export const GROUP_MANAGE_ROLES = [UserRole.ADMIN] as const;

/** Склад групи з контактами студентів: ADMIN і викладач цієї групи. */
export const GROUP_ROSTER_ROLES = [UserRole.ADMIN, UserRole.TEACHER] as const;

export const GROUP_NOT_FOUND_MESSAGE = 'Group not found';
export const TEACHER_NOT_FOUND_MESSAGE = 'Teacher not found';
export const TEACHER_ROLE_MESSAGE = 'Користувач не має ролі TEACHER.';
export const TEACHER_NOT_ACTIVE_MESSAGE = 'Викладач має бути в статусі ACTIVE.';
export const GROUP_NAME_TAKEN_MESSAGE =
  'Відкрита група з такою назвою вже є в цій автошколі.';
export const GROUP_DATE_RANGE_MESSAGE =
  'Дата завершення не може бути раніше дати початку.';
export const GROUP_CLOSED_MESSAGE =
  'Групу зі статусом COMPLETED або ARCHIVED не можна редагувати.';
export const NO_GROUP_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (name, teacherId, startDate, endDate).';
export const GROUP_STATUS_TRANSITION_MESSAGE =
  'Недозволений перехід статусу групи.';
export const COURSE_NOT_FOUND_MESSAGE = 'Course not found';
export const GROUP_CLOSED_CANCELLATION_REASON =
  'Групу завершено або архівовано.';
export const COURSE_ARCHIVED_MESSAGE =
  'Архівований курс не можна призначити групі.';

const OPEN_GROUP_STATUSES: GroupStatus[] = [
  GroupStatus.PLANNED,
  GroupStatus.ACTIVE,
];

/**
 * Лише вперед. Повторне відкриття закритої групи заборонене: студент міг би
 * опинитися у двох відкритих групах одночасно (див. StudentsService.assignGroup).
 */
const GROUP_STATUS_TRANSITIONS: Record<GroupStatus, readonly GroupStatus[]> = {
  [GroupStatus.PLANNED]: [GroupStatus.ACTIVE, GroupStatus.ARCHIVED],
  [GroupStatus.ACTIVE]: [GroupStatus.COMPLETED, GroupStatus.ARCHIVED],
  [GroupStatus.COMPLETED]: [GroupStatus.ARCHIVED],
  [GroupStatus.ARCHIVED]: [],
};

const groupListInclude = {
  teacher: { select: { id: true, firstName: true, lastName: true } },
  course: { select: { id: true, name: true } },
  _count: {
    select: {
      enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
    },
  },
} satisfies Prisma.GroupInclude;

type GroupListRow = Prisma.GroupGetPayload<{
  include: typeof groupListInclude;
}>;

// Лише безпечні поля студента: без passwordHash та інших полів User.
const groupStudentSelect = {
  enrolledAt: true,
  student: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      studentProfile: { select: { trainingStatus: true } },
    },
  },
} satisfies Prisma.EnrollmentSelect;

type GroupStudentRow = Prisma.EnrollmentGetPayload<{
  select: typeof groupStudentSelect;
}>;

function assertCanManageGroups(actor: User): void {
  if (!(GROUP_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanViewRoster(actor: User): void {
  if (!(GROUP_ROSTER_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function isOpenGroup(status: GroupStatus): boolean {
  return OPEN_GROUP_STATUSES.includes(status);
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function assertDateRange(startDate: Date | null, endDate: Date | null): void {
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    throw fieldError('endDate', GROUP_DATE_RANGE_MESSAGE);
  }
}

function sameDate(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

function toGroupListItem(group: GroupListRow): GroupListItemDto {
  return {
    id: group.id,
    name: group.name,
    status: group.status,
    startDate: group.startDate,
    endDate: group.endDate,
    teacher: group.teacher,
    course: group.course,
    studentsCount: group._count.enrollments,
    createdAt: group.createdAt,
  };
}

function toGroupStudent(row: GroupStudentRow): GroupStudentDto {
  return {
    id: row.student.id,
    firstName: row.student.firstName,
    lastName: row.student.lastName,
    email: row.student.email,
    phone: row.student.phone,
    trainingStatus: row.student.studentProfile?.trainingStatus ?? null,
    enrolledAt: row.enrolledAt,
  };
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
  ) {}

  async list(admin: User): Promise<GroupListDto> {
    await this.requireOrganization(admin.organizationId);

    const groups = await this.prisma.group.findMany({
      where: { organizationId: admin.organizationId },
      include: groupListInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { groups: groups.map(toGroupListItem) };
  }

  async create(
    actor: User,
    payload: CreateGroupDto,
  ): Promise<GroupListItemDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);

    const startDate = toDate(payload.startDate ?? null);
    const endDate = toDate(payload.endDate ?? null);
    assertDateRange(startDate, endDate);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.requireTeacher(tx, actor.organizationId, payload.teacherId);
      await this.assertNameAvailable(tx, actor.organizationId, payload.name);
      return tx.group.create({
        data: {
          organizationId: actor.organizationId,
          name: payload.name,
          teacherId: payload.teacherId,
          startDate,
          endDate,
          status: GroupStatus.PLANNED,
        },
        include: groupListInclude,
      });
    });

    this.logger.log(
      `Group created groupId=${created.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toGroupListItem(created);
  }

  async update(
    actor: User,
    groupId: string,
    payload: UpdateGroupDto,
  ): Promise<GroupListItemDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);
    if (
      payload.name === undefined &&
      payload.teacherId === undefined &&
      payload.startDate === undefined &&
      payload.endDate === undefined
    ) {
      throw fieldError('body', NO_GROUP_FIELDS_MESSAGE);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireGroup(tx, actor, groupId);
      if (!isOpenGroup(existing.status)) {
        throw new ConflictException(GROUP_CLOSED_MESSAGE);
      }

      const startDate =
        payload.startDate === undefined
          ? existing.startDate
          : toDate(payload.startDate);
      const endDate =
        payload.endDate === undefined
          ? existing.endDate
          : toDate(payload.endDate);
      assertDateRange(startDate, endDate);

      const data: Prisma.GroupUncheckedUpdateInput = {};
      if (payload.name !== undefined && payload.name !== existing.name) {
        await this.assertNameAvailable(
          tx,
          actor.organizationId,
          payload.name,
          existing.id,
        );
        data.name = payload.name;
      }
      if (
        payload.teacherId !== undefined &&
        payload.teacherId !== existing.teacherId
      ) {
        await this.requireTeacher(tx, actor.organizationId, payload.teacherId);
        data.teacherId = payload.teacherId;
      }
      if (!sameDate(startDate, existing.startDate)) {
        data.startDate = startDate;
      }
      if (!sameDate(endDate, existing.endDate)) {
        data.endDate = endDate;
      }

      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.group.update({
        where: { id: existing.id },
        data,
        include: groupListInclude,
      });
    });

    this.logger.log(
      `Group updated groupId=${updated.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toGroupListItem(updated);
  }

  async changeStatus(
    actor: User,
    groupId: string,
    payload: UpdateGroupStatusDto,
  ): Promise<GroupListItemDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);

    return this.prisma.$transaction(async (tx) => {
      // Блокування до читання: паралельна зміна статусу або зарахування
      // студента чекає на цю транзакцію і бачить уже збережений статус.
      await lockGroup(tx, groupId, actor.organizationId, 'update');
      const existing = await this.requireGroup(tx, actor, groupId);

      const next = payload.status;
      if (!GROUP_STATUS_TRANSITIONS[existing.status].includes(next)) {
        throw new ConflictException({
          statusCode: 409,
          message: `${GROUP_STATUS_TRANSITION_MESSAGE} ${existing.status} → ${next}.`,
          error: 'Conflict',
          currentStatus: existing.status,
        });
      }

      // Закриття групи завершує активні зарахування. COMPLETED, а не DROPPED:
      // DROPPED блокує студенту зарахування в будь-яку іншу групу.
      let completedEnrollments = 0;
      let cancelledLessons = 0;
      if (!isOpenGroup(next)) {
        const enrollments = await tx.enrollment.updateMany({
          where: { groupId: existing.id, status: EnrollmentStatus.ACTIVE },
          data: { status: EnrollmentStatus.COMPLETED },
        });
        completedEnrollments = enrollments.count;

        // Минулі SCHEDULED-заняття не чіпаємо: це облік відвідування, а не розклад.
        const now = new Date();
        const lessons = await tx.lesson.updateMany({
          where: {
            groupId: existing.id,
            status: LessonStatus.SCHEDULED,
            scheduledAt: { gte: now },
          },
          data: {
            status: LessonStatus.CANCELLED,
            cancelledAt: now,
            cancelledById: actor.id,
            cancellationReason: GROUP_CLOSED_CANCELLATION_REASON,
          },
        });
        cancelledLessons = lessons.count;
      }

      const saved = await tx.group.update({
        where: { id: existing.id },
        data: { status: next },
        include: groupListInclude,
      });

      this.logger.log(
        `Group status changed groupId=${saved.id} from=${existing.status} to=${saved.status} completedEnrollments=${completedEnrollments} cancelledLessons=${cancelledLessons} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      return toGroupListItem(saved);
    });
  }

  /**
   * Призначає, змінює або знімає (courseId = null) теоретичний курс групи.
   * Курс має належати організації актора і бути ACTIVE. Курс закритої групи —
   * історія, його не змінюють.
   */
  async assignCourse(
    actor: User,
    groupId: string,
    payload: AssignGroupCourseDto,
  ): Promise<GroupListItemDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);

    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireGroup(tx, actor, groupId);
      if (!isOpenGroup(existing.status)) {
        throw new ConflictException(GROUP_CLOSED_MESSAGE);
      }
      if (payload.courseId === existing.courseId) {
        return existing;
      }
      if (payload.courseId !== null) {
        await this.requireCourse(tx, actor.organizationId, payload.courseId);
      }
      return tx.group.update({
        where: { id: existing.id },
        data: { courseId: payload.courseId },
        include: groupListInclude,
      });
    });

    this.logger.log(
      `Group course assigned groupId=${saved.id} courseId=${saved.courseId ?? 'none'} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return toGroupListItem(saved);
  }

  /**
   * Склад групи (ACTIVE-зарахування). ADMIN бачить будь-яку групу своєї
   * організації, TEACHER — лише групу, яку веде.
   */
  async listStudents(actor: User, groupId: string): Promise<GroupStudentsDto> {
    assertCanViewRoster(actor);
    await this.requireOrganization(actor.organizationId);

    const group = await this.requireGroup(this.prisma, actor, groupId);
    if (actor.role === UserRole.TEACHER && group.teacherId !== actor.id) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return {
      group: toGroupListItem(group),
      students: await this.findGroupStudents(actor, group.id),
    };
  }

  /**
   * Перевірки студента, групи й інваріантів зарахування робить
   * StudentsService.assignGroup — єдине місце, що змінює Enrollment.
   */
  async addStudent(
    actor: User,
    groupId: string,
    payload: AddGroupStudentDto,
  ): Promise<GroupStudentsDto> {
    assertCanManageGroups(actor);
    await this.requireOrganization(actor.organizationId);
    await this.requireGroup(this.prisma, actor, groupId);

    await this.studentsService.assignGroup(actor, payload.studentId, {
      groupId,
    });

    this.logger.log(
      `Student added to group studentId=${payload.studentId} groupId=${groupId} actorId=${actor.id} organizationId=${actor.organizationId}`,
    );
    return this.loadRoster(actor, groupId);
  }

  async removeStudent(
    actor: User,
    groupId: string,
    studentId: string,
  ): Promise<GroupStudentsDto> {
    assertCanManageGroups(actor);
    await this.studentsService.removeFromGroup(actor, studentId, groupId);
    return this.loadRoster(actor, groupId);
  }

  /** Читається після транзакції запису, тож бачить збережений склад. */
  private async loadRoster(
    actor: User,
    groupId: string,
  ): Promise<GroupStudentsDto> {
    const [group, students] = await Promise.all([
      this.requireGroup(this.prisma, actor, groupId),
      this.findGroupStudents(actor, groupId),
    ]);
    return { group: toGroupListItem(group), students };
  }

  private async findGroupStudents(
    actor: User,
    groupId: string,
  ): Promise<GroupStudentDto[]> {
    const rows = await this.prisma.enrollment.findMany({
      where: {
        groupId,
        status: EnrollmentStatus.ACTIVE,
        student: { organizationId: actor.organizationId },
      },
      select: groupStudentSelect,
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
        { student: { id: 'asc' } },
      ],
    });
    return rows.map(toGroupStudent);
  }

  private async requireGroup(
    tx: Prisma.TransactionClient,
    actor: User,
    groupId: string,
  ): Promise<GroupListRow> {
    const group = await tx.group.findFirst({
      where: { id: groupId, organizationId: actor.organizationId },
      include: groupListInclude,
    });
    if (!group) {
      throw new NotFoundException(GROUP_NOT_FOUND_MESSAGE);
    }
    return group;
  }

  private async requireTeacher(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teacherId: string,
  ) {
    const teacher = await tx.user.findUnique({
      where: { id: teacherId },
      select: {
        organizationId: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });
    if (
      !teacher ||
      teacher.deletedAt ||
      teacher.organizationId !== organizationId
    ) {
      throw new NotFoundException(TEACHER_NOT_FOUND_MESSAGE);
    }
    if (teacher.role !== UserRole.TEACHER) {
      throw new ConflictException(TEACHER_ROLE_MESSAGE);
    }
    if (teacher.status !== UserStatus.ACTIVE) {
      throw new ConflictException(TEACHER_NOT_ACTIVE_MESSAGE);
    }
  }

  /** Курс іншої організації дає той самий 404, що й неіснуючий. */
  private async requireCourse(
    tx: Prisma.TransactionClient,
    organizationId: string,
    courseId: string,
  ): Promise<void> {
    const course = await tx.course.findFirst({
      where: { id: courseId, organizationId },
      select: { status: true },
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    if (course.status !== CourseStatus.ACTIVE) {
      throw new ConflictException(COURSE_ARCHIVED_MESSAGE);
    }
  }

  private async assertNameAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    excludeGroupId?: string,
  ) {
    const duplicate = await tx.group.findFirst({
      where: {
        organizationId,
        status: { in: OPEN_GROUP_STATUSES },
        name: { equals: name, mode: 'insensitive' },
        ...(excludeGroupId ? { NOT: { id: excludeGroupId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        statusCode: 409,
        errors: [{ field: 'name', message: GROUP_NAME_TAKEN_MESSAGE }],
      });
    }
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
