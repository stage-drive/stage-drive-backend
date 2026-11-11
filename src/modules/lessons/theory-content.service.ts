import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COURSE_NOT_PUBLISHED_MESSAGE } from '../courses/courses.service';
import { LESSON_NOT_FOUND_MESSAGE } from './lessons.dto';
import { TheoryLessonContentDto } from './theory-content.dto';

export const THEORY_CONTENT_ROLES = [
  UserRole.ADMIN,
  UserRole.TEACHER,
  UserRole.STUDENT,
] as const;

export const THEORY_CONTENT_NOT_FOUND_MESSAGE = 'Course content not found';

const contentSelect = {
  id: true,
  status: true,
  courseLessonId: true,
  group: {
    select: { id: true, teacherId: true, courseId: true },
  },
  courseLesson: {
    select: {
      id: true,
      courseId: true,
      chapterId: true,
      title: true,
      description: true,
      position: true,
      course: {
        select: {
          organizationId: true,
          status: true,
          publicationStatus: true,
        },
      },
      materials: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          title: true,
          type: true,
          body: true,
          position: true,
        },
      },
    },
  },
} satisfies Prisma.LessonSelect;

type ContentRow = Prisma.LessonGetPayload<{ select: typeof contentSelect }>;

function assertCanReadContent(actor: User): void {
  if (!(THEORY_CONTENT_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

/**
 * Контент уроку курсу, прив’язаний до очного теоретичного заняття.
 * Студент бачить його лише за активним зарахуванням і лише якщо курс опубліковано.
 */
@Injectable()
export class TheoryContentService {
  constructor(private readonly prisma: PrismaService) {}

  async getForLesson(
    actor: User,
    lessonId: string,
  ): Promise<TheoryLessonContentDto> {
    assertCanReadContent(actor);
    await this.requireOrganization(actor.organizationId);

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, organizationId: actor.organizationId },
      select: contentSelect,
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    await this.assertAccess(actor, lesson);
    return this.toContent(lesson);
  }

  private async assertAccess(actor: User, lesson: ContentRow): Promise<void> {
    if (
      actor.role === UserRole.TEACHER &&
      lesson.group.teacherId !== actor.id
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    if (actor.role === UserRole.STUDENT) {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          groupId: lesson.group.id,
          studentId: actor.id,
          status: EnrollmentStatus.ACTIVE,
          student: { organizationId: actor.organizationId },
        },
        select: { id: true },
      });
      if (!enrollment) {
        throw new ForbiddenException('Insufficient permissions');
      }
    }

    const linked = this.linkedCourseLesson(actor, lesson);
    if (!linked) {
      throw new NotFoundException(THEORY_CONTENT_NOT_FOUND_MESSAGE);
    }
    if (
      actor.role === UserRole.STUDENT &&
      (linked.course.publicationStatus !== CoursePublicationStatus.PUBLISHED ||
        linked.course.status !== CourseStatus.ACTIVE)
    ) {
      throw new ForbiddenException(COURSE_NOT_PUBLISHED_MESSAGE);
    }
  }

  private linkedCourseLesson(actor: User, lesson: ContentRow) {
    const courseLesson = lesson.courseLesson;
    if (
      !courseLesson ||
      courseLesson.courseId !== lesson.group.courseId ||
      courseLesson.course.organizationId !== actor.organizationId
    ) {
      return null;
    }
    return courseLesson;
  }

  private toContent(lesson: ContentRow): TheoryLessonContentDto {
    const courseLesson = lesson.courseLesson;
    if (!courseLesson) {
      throw new NotFoundException(THEORY_CONTENT_NOT_FOUND_MESSAGE);
    }
    return {
      lessonId: lesson.id,
      lessonStatus: lesson.status,
      courseId: courseLesson.courseId,
      courseLessonId: courseLesson.id,
      chapterId: courseLesson.chapterId,
      title: courseLesson.title,
      description: courseLesson.description,
      position: courseLesson.position,
      materials: courseLesson.materials.map((material) => ({
        id: material.id,
        title: material.title,
        type: material.type,
        body: material.body,
        position: material.position,
      })),
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
