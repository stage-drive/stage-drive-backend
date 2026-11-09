import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Organization, Prisma, User, UserRole } from '@prisma/client';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { fieldBadRequest } from '../../common/validation/field-error';
import { PrismaService } from '../../prisma/prisma.service';
import { ORGANIZATION_REQUIRED_FIELD_MESSAGE } from './organization.dto';

/** Хто змінює налаштування автошколи. Переглядають їх усі ролі. */
export const ORGANIZATION_MANAGE_ROLES = [
  UserRole.OWNER,
  UserRole.ADMIN,
] as const;

export const ORGANIZATION_NOT_FOUND_MESSAGE =
  'Автошколу не знайдено або її видалено.';
export const NO_ORGANIZATION_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (name, email, phone, address, logo).';
export const ORGANIZATION_EMAIL_TAKEN_MESSAGE =
  'Цей email уже використовує інша автошкола.';

export type UpdateOrganizationInput = {
  name?: string;
  email?: string;
  phone?: string | null;
  address?: string | null;
};

export type PublicOrganization = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  timezone: string;
};

function toPublicOrganization(organization: Organization): PublicOrganization {
  return {
    id: organization.id,
    name: organization.name,
    email: organization.email,
    phone: organization.phone,
    address: organization.address,
    logoUrl: organization.logoUrl,
    timezone: organization.timezone,
  };
}

function emailTaken(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    errors: [{ field: 'email', message: ORGANIZATION_EMAIL_TAKEN_MESSAGE }],
  });
}

function requiredText(field: 'name' | 'email', value: string): string {
  const result = value.trim();
  if (!result) {
    throw fieldBadRequest(field, ORGANIZATION_REQUIRED_FIELD_MESSAGE);
  }
  return result;
}

function optionalText(value: string | null): string | null {
  return value === null ? null : value.trim() || null;
}

/**
 * Збирає лише дозволені поля. DTO вже валідує формат; тут — захист від
 * порожніх значень, якщо сервіс викличуть в обхід ValidationPipe.
 */
function organizationUpdate(
  input: UpdateOrganizationInput,
): Prisma.OrganizationUpdateInput {
  const data: Prisma.OrganizationUpdateInput = {};
  if (input.name !== undefined) {
    data.name = requiredText('name', input.name);
  }
  if (input.email !== undefined) {
    data.email = requiredText('email', input.email).toLowerCase();
  }
  if (input.phone !== undefined) {
    data.phone = optionalText(input.phone);
  }
  if (input.address !== undefined) {
    data.address = optionalText(input.address);
  }
  return data;
}

@Injectable()
export class OrganizationService {
  private readonly logger = new Logger(OrganizationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(user: User): Promise<PublicOrganization> {
    const organization = await this.requireOrganization(user.organizationId);
    return toPublicOrganization(organization);
  }

  /**
   * Організація завжди береться з облікового запису актора, а не із запиту,
   * тож змінити чужу автошколу неможливо.
   */
  async updateCurrent(
    user: User,
    input: UpdateOrganizationInput,
    logoUrl?: string,
  ): Promise<PublicOrganization> {
    const data = organizationUpdate(input);
    if (logoUrl) {
      data.logoUrl = logoUrl;
    }
    const fields = Object.keys(data);
    if (fields.length === 0) {
      throw fieldBadRequest('body', NO_ORGANIZATION_FIELDS_MESSAGE);
    }

    const current = await this.requireOrganization(user.organizationId);
    if (typeof data.email === 'string' && data.email !== current.email) {
      await this.assertEmailAvailable(data.email, current.id);
    }

    let updated: Organization;
    try {
      updated = await this.prisma.organization.update({
        where: { id: current.id },
        data,
      });
    } catch (error) {
      if (isUniqueConstraintOn(error, 'email')) {
        throw emailTaken();
      }
      throw error;
    }

    // Старий логотип видаляється лише після збереження нового в базі.
    if (logoUrl && current.logoUrl && current.logoUrl !== logoUrl) {
      this.deleteLocalUpload(current.logoUrl);
    }

    this.logger.log(
      `Organization updated organizationId=${current.id} actorId=${user.id} role=${user.role} fields=${fields.join(',')}`,
    );
    return toPublicOrganization(updated);
  }

  async deleteOrganization(user: User): Promise<void> {
    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: { deletedAt: new Date() },
    });
  }

  private async requireOrganization(
    organizationId: string,
  ): Promise<Organization> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.deletedAt) {
      throw new NotFoundException(ORGANIZATION_NOT_FOUND_MESSAGE);
    }
    return organization;
  }

  private async assertEmailAvailable(
    email: string,
    organizationId: string,
  ): Promise<void> {
    // deletedAt не відсікаємо: унікальний індекс зайнятий і після видалення.
    const owner = await this.prisma.organization.findUnique({
      where: { email },
      select: { id: true },
    });
    if (owner && owner.id !== organizationId) {
      throw emailTaken();
    }
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
