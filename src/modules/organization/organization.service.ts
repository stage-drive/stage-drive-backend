import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';

function toPublicOrganization(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    logoUrl: organization.logoUrl,
    timezone: organization.timezone,
  };
}

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(user: User) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: user.organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return toPublicOrganization(organization);
  }

  async updateCurrent(user: User, input: { name?: string }, logoUrl?: string) {
    const data: { name?: string; logoUrl?: string } = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new BadRequestException('name cannot be empty');
      }
      data.name = name;
    }
    if (logoUrl) {
      const current = await this.prisma.organization.findUnique({
        where: { id: user.organizationId },
      });
      this.deleteLocalUpload(current?.logoUrl);
      data.logoUrl = logoUrl;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update (name, logo)');
    }

    const updated = await this.prisma.organization.update({
      where: { id: user.organizationId },
      data,
    });
    return toPublicOrganization(updated);
  }

  async deleteOrganization(user: User): Promise<void> {
    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { deletedAt: new Date() },
    });
  }

  private deleteLocalUpload(url?: string | null) {
    if (!url?.startsWith('/uploads/')) {
      return;
    }
    const relative = url.replace(/^\//, '');
    const fullPath = join(process.cwd(), relative);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  }
}
