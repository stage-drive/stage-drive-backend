import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CourseStatus, Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CourseDto,
  CourseListDto,
  CreateCourseDto,
  UpdateCourseDto,
} from './courses.dto';

export const COURSE_LIST_ROLES = [UserRole.ADMIN] as const;
export const COURSE_MANAGE_ROLES = COURSE_LIST_ROLES;

export const COURSE_NOT_FOUND_MESSAGE = 'Course not found';
export const COURSE_NAME_TAKEN_MESSAGE =
  'Активний курс з такою назвою вже є в цій автошколі.';
export const NO_COURSE_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (name, description).';

const courseSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseSelect;

type CourseRow = Prisma.CourseGetPayload<{ select: typeof courseSelect }>;

function assertCanListCourses(actor: User): void {
  if (!(COURSE_LIST_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function assertCanManageCourses(actor: User): void {
  if (!(COURSE_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function toCourse(course: CourseRow): CourseDto {
  return {
    id: course.id,
    name: course.name,
    description: course.description,
    status: course.status,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Курси своєї організації, і ACTIVE, і ARCHIVED, за назвою. */
  async list(actor: User): Promise<CourseListDto> {
    assertCanListCourses(actor);
    await this.requireOrganization(actor.organizationId);

    const courses = await this.prisma.course.findMany({
      where: { organizationId: actor.organizationId },
      select: { id: true, name: true, status: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return {
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        status: course.status,
      })),
    };
  }

  async create(actor: User, payload: CreateCourseDto): Promise<CourseDto> {
    assertCanManageCourses(actor);
    await this.requireOrganization(actor.organizationId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.assertNameAvailable(tx, actor.organizationId, payload.name);
      return tx.course.create({
        data: {
          organizationId: actor.organizationId,
          name: payload.name,
          description: payload.description ?? null,
          status: CourseStatus.ACTIVE,
        },
        select: courseSelect,
      });
    });

    this.logger.log(
      `Course created courseId=${created.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toCourse(created);
  }

  async update(
    actor: User,
    courseId: string,
    payload: UpdateCourseDto,
  ): Promise<CourseDto> {
    assertCanManageCourses(actor);
    await this.requireOrganization(actor.organizationId);
    if (payload.name === undefined && payload.description === undefined) {
      throw fieldError('body', NO_COURSE_FIELDS_MESSAGE);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.requireCourse(tx, actor, courseId);
      const data: Prisma.CourseUpdateInput = {};

      if (payload.name !== undefined && payload.name !== existing.name) {
        if (existing.status === CourseStatus.ACTIVE) {
          await this.assertNameAvailable(
            tx,
            actor.organizationId,
            payload.name,
            existing.id,
          );
        }
        data.name = payload.name;
      }
      if (
        payload.description !== undefined &&
        payload.description !== existing.description
      ) {
        data.description = payload.description;
      }

      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.course.update({
        where: { id: existing.id },
        data,
        select: courseSelect,
      });
    });

    this.logger.log(
      `Course updated courseId=${updated.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toCourse(updated);
  }

  /** Курс іншої організації дає той самий 404, що й неіснуючий. */
  private async requireCourse(
    tx: Prisma.TransactionClient,
    actor: User,
    courseId: string,
  ): Promise<CourseRow> {
    const course = await tx.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: courseSelect,
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    return course;
  }

  private async assertNameAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    name: string,
    excludeCourseId?: string,
  ) {
    const duplicate = await tx.course.findFirst({
      where: {
        organizationId,
        status: CourseStatus.ACTIVE,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeCourseId ? { NOT: { id: excludeCourseId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        statusCode: 409,
        errors: [{ field: 'name', message: COURSE_NAME_TAKEN_MESSAGE }],
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
