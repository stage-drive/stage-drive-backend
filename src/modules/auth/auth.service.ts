import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuthSession } from './auth-session';
import { RegisterDto } from './auth.dto';
import { randomSlugSuffix, slugify } from './slug';
import { signAccessToken, signRefreshToken } from './token';

const BCRYPT_ROUNDS = 10;
const MAX_SLUG_ATTEMPTS = 5;
const EMAIL_ALREADY_EXISTS_MESSAGE = 'Користувач з таким email уже існує.';
const ACCOUNT_NOT_ACTIVE_MESSAGE = 'Обліковий запис заблоковано або неактивний.';

export type CreateOwnerInput = {
  organizationName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  passwordHash: string | null;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string) {
    if (!email || !password) {
      throw new UnauthorizedException('Email and password are required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    this.assertActiveUser(user);

    return {
      accessToken: signAccessToken(user.id),
      refreshToken: signRefreshToken(user.id),
      tokenType: 'Bearer',
    };
  }

  assertActiveUser(user: Pick<User, 'status' | 'deletedAt'>): void {
    if (user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(ACCOUNT_NOT_ACTIVE_MESSAGE);
    }
  }

  async createOwnerUser(input: CreateOwnerInput): Promise<User> {
    const organizationName = input.organizationName.trim();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const email = input.email.trim().toLowerCase();
    const phone = input.phone?.trim() || null;
    const baseSlug = slugify(organizationName);

    for (let attempt = 0; ; attempt += 1) {
      const slug =
        attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;

      try {
        return await this.prisma.$transaction(async (tx) => {
          const organization = await tx.organization.create({
            data: {
              name: organizationName,
              slug,
              email,
              phone,
              status: 'ACTIVE',
            },
          });

          return tx.user.create({
            data: {
              organizationId: organization.id,
              email,
              passwordHash: input.passwordHash,
              firstName,
              lastName,
              phone,
              role: UserRole.OWNER,
              status: 'ACTIVE',
            },
          });
        });
      } catch (error) {
        if (isUniqueConstraintOn(error, 'email')) {
          throw new ConflictException({
            statusCode: 409,
            errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
          });
        }
        if (
          isUniqueConstraintOn(error, 'slug') &&
          attempt < MAX_SLUG_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  async register(payload: RegisterDto) {
    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    const user = await this.createOwnerUser({
      organizationName: payload.organizationName,
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone,
      passwordHash,
    });
    return toAuthSession(user);
  }
}
