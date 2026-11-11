import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CourseMaterialType,
  CoursePublicationStatus,
  CourseStatus,
  EnrollmentStatus,
  LessonStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COURSE_NOT_PUBLISHED_MESSAGE } from '../courses/courses.service';
import { LESSON_NOT_FOUND_MESSAGE } from './lessons.dto';
import {
  THEORY_CONTENT_NOT_FOUND_MESSAGE,
  TheoryContentService,
} from './theory-content.service';

const actor = (role: UserRole, id = `${role.toLowerCase()}-1`) =>
  ({ id, role, organizationId: 'org-1' }) as never;

const material = {
  id: 'material-1',
  title: 'Знаки',
  type: CourseMaterialType.TEXT,
  body: 'Текст',
  position: 1,
};

function lessonRow(
  overrides: {
    courseId?: string | null;
    publicationStatus?: CoursePublicationStatus;
    status?: CourseStatus;
    courseLesson?: object | null;
  } = {},
) {
  const courseId =
    overrides.courseId === undefined ? 'course-1' : overrides.courseId;
  const courseLesson =
    overrides.courseLesson === undefined
      ? {
          id: 'course-lesson-1',
          courseId: 'course-1',
          chapterId: 'chapter-1',
          title: 'Дорожні знаки',
          description: null,
          position: 1,
          course: {
            organizationId: 'org-1',
            status: overrides.status ?? CourseStatus.ACTIVE,
            publicationStatus:
              overrides.publicationStatus ?? CoursePublicationStatus.PUBLISHED,
          },
          materials: [material],
        }
      : overrides.courseLesson;
  return {
    id: 'lesson-1',
    status: LessonStatus.SCHEDULED,
    courseLessonId: courseLesson ? 'course-lesson-1' : null,
    group: { id: 'group-1', teacherId: 'teacher-1', courseId },
    courseLesson,
  };
}

describe('TheoryContentService', () => {
  const prisma = {
    organization: { findUnique: jest.fn() },
    lesson: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn() },
  };
  let service: TheoryContentService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.lesson.findFirst.mockResolvedValue(lessonRow());
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'enrollment-1' });
    service = new TheoryContentService(prisma as unknown as PrismaService);
  });

  it.each([UserRole.OWNER, UserRole.INSTRUCTOR])(
    'forbids %s before reading the lesson',
    async (role) => {
      await expect(
        service.getForLesson(actor(role), 'lesson-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.lesson.findFirst).not.toHaveBeenCalled();
    },
  );

  it('returns linked materials to an enrolled student', async () => {
    await expect(
      service.getForLesson(actor(UserRole.STUDENT, 'student-1'), 'lesson-1'),
    ).resolves.toEqual({
      lessonId: 'lesson-1',
      lessonStatus: LessonStatus.SCHEDULED,
      courseId: 'course-1',
      courseLessonId: 'course-lesson-1',
      chapterId: 'chapter-1',
      title: 'Дорожні знаки',
      description: null,
      position: 1,
      materials: [material],
    });
    expect(prisma.enrollment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          studentId: 'student-1',
          status: EnrollmentStatus.ACTIVE,
          groupId: 'group-1',
        }),
      }),
    );
  });

  it('returns draft content to the group teacher', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      lessonRow({ publicationStatus: CoursePublicationStatus.DRAFT }),
    );

    await expect(
      service.getForLesson(actor(UserRole.TEACHER), 'lesson-1'),
    ).resolves.toMatchObject({ courseLessonId: 'course-lesson-1' });
    expect(prisma.enrollment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 for a lesson of another organization', async () => {
    prisma.lesson.findFirst.mockResolvedValue(null);

    await expect(
      service.getForLesson(actor(UserRole.ADMIN), 'lesson-1'),
    ).rejects.toMatchObject({ message: LESSON_NOT_FOUND_MESSAGE });
  });

  it('returns 404 when the lesson is not linked to the group course', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      lessonRow({ courseId: 'course-other' }),
    );

    await expect(
      service.getForLesson(actor(UserRole.ADMIN), 'lesson-1'),
    ).rejects.toMatchObject({ message: THEORY_CONTENT_NOT_FOUND_MESSAGE });
  });

  it('forbids a teacher of another group', async () => {
    await expect(
      service.getForLesson(actor(UserRole.TEACHER, 'teacher-2'), 'lesson-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a student who is not enrolled in the group', async () => {
    prisma.enrollment.findFirst.mockResolvedValue(null);

    await expect(
      service.getForLesson(actor(UserRole.STUDENT), 'lesson-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a student while the course is not published', async () => {
    prisma.lesson.findFirst.mockResolvedValue(
      lessonRow({ publicationStatus: CoursePublicationStatus.DRAFT }),
    );

    await expect(
      service.getForLesson(actor(UserRole.STUDENT), 'lesson-1'),
    ).rejects.toMatchObject({ message: COURSE_NOT_PUBLISHED_MESSAGE });
  });

  it('returns 404 when the organization is deleted', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: new Date(),
    });

    await expect(
      service.getForLesson(actor(UserRole.ADMIN), 'lesson-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.lesson.findFirst).not.toHaveBeenCalled();
  });
});
