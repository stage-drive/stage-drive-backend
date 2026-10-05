import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CarListDto,
  CarListItemDto,
  CarSortField,
  CarSortOrder,
  ListCarsQueryDto,
} from './cars.dto';

export const CAR_LIST_ROLES = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
] as const;

const ORG_WIDE_CAR_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const DEFAULT_SORT_BY: CarSortField = 'plateNumber';
const DEFAULT_SORT_ORDER: CarSortOrder = 'asc';

const carListSelect = {
  id: true,
  organizationId: true,
  instructorId: true,
  plateNumber: true,
  category: true,
  transmission: true,
  createdAt: true,
  updatedAt: true,
  instructor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.CarSelect;

type CarListRow = Prisma.CarGetPayload<{ select: typeof carListSelect }>;

function contains(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

function assertCanListCars(actor: User): void {
  if (!(CAR_LIST_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function allowedCarScope(actor: User): Prisma.CarWhereInput {
  const scope: Prisma.CarWhereInput = {
    organizationId: actor.organizationId,
  };

  if (!(ORG_WIDE_CAR_ROLES as readonly UserRole[]).includes(actor.role)) {
    scope.instructorId = actor.id;
  }

  return scope;
}

function buildCarWhere(
  actor: User,
  query: ListCarsQueryDto,
): Prisma.CarWhereInput {
  const filters: Prisma.CarWhereInput[] = [allowedCarScope(actor)];

  if (query.category) {
    filters.push({ category: query.category });
  }
  if (query.transmission) {
    filters.push({ transmission: query.transmission });
  }
  if (query.instructorId) {
    filters.push({ instructorId: query.instructorId });
  }

  const search = query.search?.trim();
  if (search) {
    filters.push({ plateNumber: contains(search) });
  }

  return { AND: filters };
}

function buildOrderBy(
  sortBy: CarSortField,
  sortOrder: CarSortOrder,
): Prisma.CarOrderByWithRelationInput[] {
  const tieBreak: Prisma.CarOrderByWithRelationInput = { id: 'asc' };
  switch (sortBy) {
    case 'plateNumber':
      return [{ plateNumber: sortOrder }, tieBreak];
    case 'category':
      return [{ category: sortOrder }, tieBreak];
    case 'transmission':
      return [{ transmission: sortOrder }, tieBreak];
    case 'createdAt':
      return [{ createdAt: sortOrder }, tieBreak];
  }
}

function isVisibleCar(row: CarListRow, actor: User): boolean {
  if (row.organizationId !== actor.organizationId) {
    return false;
  }
  if (row.instructor.id !== row.instructorId) {
    return false;
  }
  if ((ORG_WIDE_CAR_ROLES as readonly UserRole[]).includes(actor.role)) {
    return true;
  }
  return row.instructorId === actor.id;
}

function toCarListItem(row: CarListRow): CarListItemDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    instructorId: row.instructorId,
    instructor: {
      id: row.instructor.id,
      firstName: row.instructor.firstName,
      lastName: row.instructor.lastName,
    },
    plateNumber: row.plateNumber,
    category: row.category,
    transmission: row.transmission,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class CarsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: User, query: ListCarsQueryDto): Promise<CarListDto> {
    assertCanListCars(actor);
    await this.requireOrganization(actor.organizationId);

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sortBy = query.sortBy ?? DEFAULT_SORT_BY;
    const sortOrder = query.sortOrder ?? DEFAULT_SORT_ORDER;
    const where = buildCarWhere(actor, query);

    const [rows, total] = await Promise.all([
      this.prisma.car.findMany({
        where,
        select: carListSelect,
        orderBy: buildOrderBy(sortBy, sortOrder),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.car.count({ where }),
    ]);

    return {
      cars: rows.filter((row) => isVisibleCar(row, actor)).map(toCarListItem),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
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
