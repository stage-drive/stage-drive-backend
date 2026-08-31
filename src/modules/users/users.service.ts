import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { toPublicUser } from './user-public';

const BCRYPT_ROUNDS = 10;

export type UpdateProfileInput = {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  getMe(user: User) {
    return toPublicUser(user);
  }

  async updateMe(user: User, input: UpdateProfileInput) {
    const data: UpdateProfileInput = {};

    if (input.firstName !== undefined) {
      const firstName = input.firstName.trim();
      if (!firstName) {
        throw new BadRequestException('firstName cannot be empty');
      }
      data.firstName = firstName;
    }
    if (input.lastName !== undefined) {
      const lastName = input.lastName.trim();
      if (!lastName) {
        throw new BadRequestException('lastName cannot be empty');
      }
      data.lastName = lastName;
    }
    if (input.phone !== undefined) {
      data.phone = input.phone === null ? null : String(input.phone).trim();
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'No allowed fields to update (firstName, lastName, phone)',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
    });
    return toPublicUser(updated);
  }

  async changePassword(
    user: User,
    currentPassword: string,
    newPassword: string,
  ) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException(
        'currentPassword and newPassword are required',
      );
    }
    if (newPassword.length < 8) {
      throw new BadRequestException(
        'newPassword must be at least 8 characters',
      );
    }

    const fresh = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh) {
      throw new NotFoundException('User not found');
    }

    if (!fresh.passwordHash) {
      throw new BadRequestException('Current password is incorrect');
    }

    const matches = await bcrypt.compare(currentPassword, fresh.passwordHash);
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return { message: 'Password updated' };
  }

  async setAvatar(user: User, avatarUrl: string) {
    this.deleteLocalUpload(user.avatarUrl);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl },
    });
    return toPublicUser(updated);
  }

  async deleteAvatar(user: User) {
    this.deleteLocalUpload(user.avatarUrl);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });
    return toPublicUser(updated);
  }

  async deleteUser(user: User): Promise<void> {
    await this.prisma.user.update({
      where: { id: user.id },
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
