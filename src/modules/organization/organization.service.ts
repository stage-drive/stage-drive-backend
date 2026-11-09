import {
  BadRequestException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(OrganizationService.name);

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
    let previousLogoUrl: string | null = null;
    if (logoUrl) {
      const current = await this.prisma.organization.findUnique({
        where: { id: user.organizationId },
      });
      previousLogoUrl = current?.logoUrl ?? null;
      data.logoUrl = logoUrl;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update (name, logo)');
    }

    const updated = await this.prisma.organization.update({
      where: { id: user.organizationId },
      data,
    });
    // Старий логотип видаляється лише після збереження нового в базі.
    if (previousLogoUrl && previousLogoUrl !== logoUrl) {
      this.deleteLocalUpload(previousLogoUrl);
    }
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
    try {
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to remove previous upload path=${fullPath}: ${String(error)}`,
      );
    }
  }
}
