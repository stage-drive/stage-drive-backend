import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseListDto } from './courses.dto';

export const COURSE_LIST_ROLES = [UserRole.ADMIN] as const;

function assertCanListCourses(actor: User): void {
  if (!(COURSE_LIST_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

@Injectable()
export class CoursesService {
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
