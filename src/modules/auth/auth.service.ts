import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { signAccessToken, signRefreshToken } from './token';
import { slugify, randomSlugSuffix } from './slug';
import { RegisterDto } from './auth.dto';

const BCRYPT_ROUNDS = 10;
const MAX_SLUG_ATTEMPTS = 5;
const EMAIL_ALREADY_EXISTS_MESSAGE = 'Користувач з таким email уже існує.';

function uniqueConstraintFields(
  error: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = error.meta as
    | {
        target?: string[];
        driverAdapterError?: {
          cause?: { constraint?: { fields?: string[] } };
        };
      }
    | undefined;
  return (
    meta?.target ?? meta?.driverAdapterError?.cause?.constraint?.fields ?? []
  );
}

function isUniqueConstraintOn(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    uniqueConstraintFields(error).includes(field)
  );
}

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
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      accessToken: signAccessToken(user.id),
      tokenType: 'Bearer',
    };
  }

  async register(payload: RegisterDto) {
    const organizationName = payload.organizationName.trim();
    const firstName = payload.firstName.trim();
    const lastName = payload.lastName.trim();
    const email = payload.email.trim().toLowerCase();
    const phone = payload.phone?.trim() || null;

    const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    const baseSlug = slugify(organizationName);

    for (let attempt = 0; ; attempt += 1) {
      const slug =
        attempt === 0 ? baseSlug : `${baseSlug}-${randomSlugSuffix()}`;

      try {
        const user = await this.prisma.$transaction(async (tx) => {
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
              passwordHash,
              firstName,
              lastName,
              phone,
              role: UserRole.OWNER,
              status: 'ACTIVE',
            },
          });
        });

        return {
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            status: user.status,
            organizationId: user.organizationId,
          },
          accessToken: signAccessToken(user.id),
          refreshToken: signRefreshToken(user.id),
        };
      } catch (error) {
        if (isUniqueConstraintOn(error, 'email')) {
          throw new ConflictException({
            statusCode: 409,
            errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
          });
        }
        if (isUniqueConstraintOn(error, 'slug') && attempt < MAX_SLUG_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }
  }
}
