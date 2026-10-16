import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CoursesService } from './courses.service';

describe('CoursesService', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };

  const organization = { id: 'org-1', deletedAt: null };

  const prisma = {
    organization: { findUnique: jest.fn() },
    course: { findMany: jest.fn() },
  };

  let service: CoursesService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findUnique.mockResolvedValue(organization);
    prisma.course.findMany.mockResolvedValue([]);
    service = new CoursesService(prisma as unknown as PrismaService);
  });

  it('returns an empty list when the school has no courses', async () => {
    await expect(service.list(admin as never)).resolves.toEqual({
      courses: [],
    });
  });

  it('lists only courses of the admin organization, sorted by name', async () => {
    await service.list(admin as never);

    expect(prisma.course.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      select: { id: true, name: true, status: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('returns ACTIVE and ARCHIVED courses with id, name and status only', async () => {
    prisma.course.findMany.mockResolvedValue([
      {
        id: 'course-1',
        name: 'Теоретичний курс, категорія B',
        status: CourseStatus.ACTIVE,
        description: 'internal',
        organizationId: 'org-1',
      },
      {
        id: 'course-2',
        name: 'Старий курс',
        status: CourseStatus.ARCHIVED,
      },
    ]);

    await expect(service.list(admin as never)).resolves.toEqual({
      courses: [
        {
          id: 'course-1',
          name: 'Теоретичний курс, категорія B',
          status: CourseStatus.ACTIVE,
        },
        { id: 'course-2', name: 'Старий курс', status: CourseStatus.ARCHIVED },
      ],
    });
  });

  it.each([
    UserRole.OWNER,
    UserRole.TEACHER,
    UserRole.INSTRUCTOR,
    UserRole.STUDENT,
  ])('forbids %s without touching the database', async (role) => {
    await expect(
      service.list({ ...admin, role } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.course.findMany).not.toHaveBeenCalled();
  });

  it.each([null, { ...organization, deletedAt: new Date() }])(
    'returns 404 when the organization is missing or soft-deleted (%p)',
    async (found) => {
      prisma.organization.findUnique.mockResolvedValue(found);

      await expect(service.list(admin as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.course.findMany).not.toHaveBeenCalled();
    },
  );
});
