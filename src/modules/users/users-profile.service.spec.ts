import { BadRequestException, Logger } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import {
  NO_MEMBER_FIELDS_MESSAGE,
  UpdateProfileInput,
  UsersService,
} from './users.service';

const EMPTY_FIELD_MESSAGE = "Заповніть обов'язкове поле.";

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Іван',
    lastName: 'Петренко',
    phone: null,
    avatarUrl: null,
    role: UserRole.STUDENT,
    organizationId: 'org-1',
    ...overrides,
  } as User;
}

describe('UsersService profile', () => {
  let service: UsersService;
  const prisma = {
    user: { update: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.update.mockImplementation(({ data }: { data: Partial<User> }) =>
      Promise.resolve(user({ ...data })),
    );
    service = new UsersService(
      prisma as unknown as PrismaService,
      {} as RefreshTokenService,
    );
  });

  describe('updateMe', () => {
    it('saves trimmed allowed fields and returns the updated public profile', async () => {
      const result = await service.updateMe(user(), {
        firstName: '  Олег ',
        lastName: ' Коваль ',
        phone: ' +380991234567 ',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          firstName: 'Олег',
          lastName: 'Коваль',
          phone: '+380991234567',
        },
      });
      expect(result).toEqual({
        id: 'user-1',
        email: 'user@example.com',
        firstName: 'Олег',
        lastName: 'Коваль',
        phone: '+380991234567',
        avatarUrl: null,
        role: UserRole.STUDENT,
        organizationId: 'org-1',
      });
    });

    it('never writes fields outside firstName, lastName and phone', async () => {
      const input = {
        firstName: 'Олег',
        role: UserRole.OWNER,
        email: 'other@example.com',
        organizationId: 'org-2',
        avatarUrl: '/uploads/avatars/other.png',
        status: 'ACTIVE',
      } as UpdateProfileInput;

      await service.updateMe(user(), input);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'Олег' },
      });
    });

    it('updates only the signed-in user', async () => {
      await service.updateMe(user({ id: 'user-7' }), { lastName: 'Шевченко' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-7' } }),
      );
    });

    it('clears the phone when null is sent', async () => {
      await service.updateMe(user({ phone: '+380991234567' }), { phone: null });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { phone: null },
      });
    });

    it.each(['firstName', 'lastName'] as const)(
      'rejects a whitespace-only %s with a field error',
      async (field) => {
        const error = await service
          .updateMe(user(), { [field]: '   ' })
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          statusCode: 400,
          errors: [{ field, message: EMPTY_FIELD_MESSAGE }],
        });
        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('rejects a request without allowed fields', async () => {
      const error = await service.updateMe(user(), {}).catch((e: unknown) => e);

      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_MEMBER_FIELDS_MESSAGE }],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('avatar', () => {
    let root: string;
    let cwd: jest.SpyInstance<string, []>;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'users-avatar-'));
      await mkdir(join(root, 'uploads', 'avatars'), { recursive: true });
      cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
    });

    afterEach(async () => {
      cwd.mockRestore();
      await rm(root, { recursive: true, force: true });
    });

    async function storedAvatar(name: string): Promise<string> {
      await writeFile(join(root, 'uploads', 'avatars', name), 'image');
      return `/uploads/avatars/${name}`;
    }

    function onDisk(url: string): boolean {
      return existsSync(join(root, url.replace(/^\//, '')));
    }

    it('saves the new avatar and then removes the previous file', async () => {
      const previous = await storedAvatar('user-1-old.png');
      const next = await storedAvatar('user-1-new.png');

      const result = await service.setAvatar(
        user({ avatarUrl: previous }),
        next,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarUrl: next },
      });
      expect(result.avatarUrl).toBe(next);
      expect(onDisk(next)).toBe(true);
      expect(onDisk(previous)).toBe(false);
    });

    it('never removes the file it has just saved when the URL did not change', async () => {
      const current = await storedAvatar('user-1-same.png');

      await service.setAvatar(user({ avatarUrl: current }), current);

      expect(onDisk(current)).toBe(true);
    });

    it('keeps the previous avatar when the database update fails', async () => {
      const previous = await storedAvatar('user-1-old.png');
      const next = await storedAvatar('user-1-new.png');
      prisma.user.update.mockRejectedValueOnce(new Error('database is down'));

      await expect(
        service.setAvatar(user({ avatarUrl: previous }), next),
      ).rejects.toThrow('database is down');
      expect(onDisk(previous)).toBe(true);
    });

    it('still returns the saved avatar when the previous file cannot be removed', async () => {
      // Каталог на місці файлу: unlinkSync кидає помилку.
      await mkdir(join(root, 'uploads', 'avatars', 'user-1-locked.png'));
      const next = await storedAvatar('user-1-new.png');
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const result = await service.setAvatar(
        user({ avatarUrl: '/uploads/avatars/user-1-locked.png' }),
        next,
      );

      expect(result.avatarUrl).toBe(next);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('user-1-locked.png'),
      );
      warn.mockRestore();
    });

    it('does not touch external avatar URLs', async () => {
      const next = await storedAvatar('user-1-new.png');

      const result = await service.setAvatar(
        user({ avatarUrl: 'https://lh3.googleusercontent.com/a/photo' }),
        next,
      );

      expect(result.avatarUrl).toBe(next);
    });

    it('clears the avatar and then removes its file', async () => {
      const current = await storedAvatar('user-1-current.png');

      const result = await service.deleteAvatar(user({ avatarUrl: current }));

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarUrl: null },
      });
      expect(result.avatarUrl).toBeNull();
      expect(onDisk(current)).toBe(false);
    });

    it('keeps the avatar file when clearing it in the database fails', async () => {
      const current = await storedAvatar('user-1-current.png');
      prisma.user.update.mockRejectedValueOnce(new Error('database is down'));

      await expect(
        service.deleteAvatar(user({ avatarUrl: current })),
      ).rejects.toThrow('database is down');
      expect(onDisk(current)).toBe(true);
    });
  });
});
