import { Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentStatus, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GroupListDto } from './groups.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(admin: User): Promise<GroupListDto> {
    await this.requireOrganization(admin.organizationId);

    const groups = await this.prisma.group.findMany({
      where: { organizationId: admin.organizationId },
      include: {
        teacher: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: {
            enrollments: { where: { status: EnrollmentStatus.ACTIVE } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        status: group.status,
        startDate: group.startDate,
        endDate: group.endDate,
        teacher: group.teacher,
        studentsCount: group._count.enrollments,
        createdAt: group.createdAt,
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
