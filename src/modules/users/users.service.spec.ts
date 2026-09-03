import { BadRequestException } from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { UsersService } from './users.service';

jest.mock('bcrypt');

describe('UsersService.changePassword', () => {
  let service: UsersService;
  const user = { id: 'user-1' } as User;
  const fresh = { id: 'user-1', passwordHash: 'stored-hash' } as User;

  const prisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
  };
  const refreshTokenService = {
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(fresh);
    prisma.user.update.mockResolvedValue(fresh);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

    service = new UsersService(
      prisma as unknown as PrismaService,
      refreshTokenService as unknown as RefreshTokenService,
    );
  });

  it('sets tokensInvalidBefore and revokes all refresh tokens on success', async () => {
    await service.changePassword(user, 'CurrentPass1', 'NewPassword1');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: 'new-hash',
        tokensInvalidBefore: expect.any(Date),
      },
    });
    expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('does not invalidate sessions when the current password is wrong', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.changePassword(user, 'WrongPass1', 'NewPassword1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('does not invalidate sessions when the new password is too short', async () => {
    await expect(
      service.changePassword(user, 'CurrentPass1', 'short'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(refreshTokenService.revokeAllForUser).not.toHaveBeenCalled();
  });
});
