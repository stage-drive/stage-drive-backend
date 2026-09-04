import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { assertActiveUser } from './auth-access';
import { REFRESH_TOKEN_TTL_MS, signAccessToken } from './token';

const INVALID_REFRESH_TOKEN_MESSAGE = 'Invalid refresh token';

export type RefreshedSession = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
};

@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    const token = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return token;
  }

  async rotate(plainToken: string): Promise<RefreshedSession> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(plainToken) },
    });

    if (!record || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (record.usedAt || record.revokedAt) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: record.userId },
    });
    if (!user) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }
    assertActiveUser(user);

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return {
      accessToken: signAccessToken(user.id),
      refreshToken: await this.issue(user.id, record.familyId),
      tokenType: 'Bearer',
    };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
