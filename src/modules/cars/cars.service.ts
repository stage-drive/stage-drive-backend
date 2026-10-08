import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CarStatus,
  LicenseCategory,
  Prisma,
  TrainingStatus,
  Transmission,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { isUniqueConstraintOn } from '../../common/prisma/unique-constraint';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CarListDto,
  CarListItemDto,
  CarSortField,
  CarSortOrder,
  CreateCarDto,
  ListCarsQueryDto,
  PLATE_FORMAT_MESSAGE,
  PLATE_LENGTH_MESSAGE,
  PLATE_MAX_LENGTH,
  PLATE_PATTERN,
  REQUIRED_FIELD_MESSAGE,
  UpdateCarDto,
  UpdateCarStatusDto,
  normalizePlateNumber,
} from './cars.dto';

export const CAR_LIST_ROLES = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.INSTRUCTOR,
] as const;

export const CAR_WRITE_ROLES = [UserRole.OWNER, UserRole.ADMIN] as const;

export const CAR_NOT_FOUND_MESSAGE = 'Car not found';
export const INSTRUCTOR_NOT_FOUND_MESSAGE = 'Instructor not found';
export const INSTRUCTOR_ROLE_MESSAGE = 'Користувач не має ролі INSTRUCTOR.';
export const INSTRUCTOR_NOT_ACTIVE_MESSAGE =
  'Інструктор має бути в статусі ACTIVE.';
export const PLATE_ALREADY_EXISTS_MESSAGE =
  'Автомобіль з таким номером уже є в цій автошколі.';
export const CAR_ASSIGNED_STUDENT_MESSAGE =
  'Автомобіль уже призначено студенту з іншою категорією, коробкою передач або інструктором.';
export const NO_CAR_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (plateNumber, category, transmission, instructorId).';
export const CAR_STATUS_TRANSITION_MESSAGE =
  'Недозволений перехід статусу автомобіля.';
export const CAR_STATUS_IN_PRACTICE_MESSAGE =
  'Не можна змінити статус: автомобіль призначено студенту на практиці.';

const CAR_STATUS_TRANSITIONS: Record<CarStatus, readonly CarStatus[]> = {
  [CarStatus.AVAILABLE]: [CarStatus.MAINTENANCE, CarStatus.INACTIVE],
  [CarStatus.MAINTENANCE]: [CarStatus.AVAILABLE, CarStatus.INACTIVE],
  [CarStatus.INACTIVE]: [CarStatus.AVAILABLE],
};

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
  status: true,
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

function assertCanWriteCars(actor: User): void {
  if (!(CAR_WRITE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function normalizedPlate(value: string): string {
  const plate = normalizePlateNumber(value);
  if (!plate) {
    throw fieldError('plateNumber', REQUIRED_FIELD_MESSAGE);
  }
  if (plate.length > PLATE_MAX_LENGTH) {
    throw fieldError('plateNumber', PLATE_LENGTH_MESSAGE);
  }
  if (!PLATE_PATTERN.test(plate)) {
    throw fieldError('plateNumber', PLATE_FORMAT_MESSAGE);
  }
  return plate;
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
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class CarsService {
  private readonly logger = new Logger(CarsService.name);

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

  async create(actor: User, payload: CreateCarDto): Promise<CarListItemDto> {
    assertCanWriteCars(actor);
    await this.requireOrganization(actor.organizationId);
    const plateNumber = normalizedPlate(payload.plateNumber);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.requireInstructor(tx, actor, payload.instructorId);
        await this.assertPlateAvailable(tx, actor.organizationId, plateNumber);
        return tx.car.create({
          data: {
            organizationId: actor.organizationId,
            instructorId: payload.instructorId,
            plateNumber,
            category: payload.category,
            transmission: payload.transmission,
            status: CarStatus.AVAILABLE,
          },
          select: carListSelect,
        });
      });

      this.logger.log(
        `Car created carId=${created.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
      );
      return toCarListItem(created);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isUniqueConstraintOn(error, 'plateNumber')) {
        throw this.plateAlreadyExists();
      }
      throw error;
    }
  }

  async update(
    actor: User,
    carId: string,
    payload: UpdateCarDto,
  ): Promise<CarListItemDto> {
    assertCanWriteCars(actor);
    await this.requireOrganization(actor.organizationId);
    if (
      payload.plateNumber === undefined &&
      payload.category === undefined &&
      payload.transmission === undefined &&
      payload.instructorId === undefined
    ) {
      throw fieldError('body', NO_CAR_FIELDS_MESSAGE);
    }

    const nextPlate =
      payload.plateNumber !== undefined
        ? normalizedPlate(payload.plateNumber)
        : undefined;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.car.findUnique({
          where: { id: carId },
          select: carListSelect,
        });
        if (!existing || existing.organizationId !== actor.organizationId) {
          throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
        }

        const data: Prisma.CarUncheckedUpdateInput = {};
        let instructorId = existing.instructorId;
        let category = existing.category;
        let transmission = existing.transmission;

        if (
          payload.instructorId !== undefined &&
          payload.instructorId !== existing.instructorId
        ) {
          await this.requireInstructor(tx, actor, payload.instructorId);
          data.instructorId = payload.instructorId;
          instructorId = payload.instructorId;
        }
        if (
          payload.category !== undefined &&
          payload.category !== existing.category
        ) {
          data.category = payload.category;
          category = payload.category;
        }
        if (
          payload.transmission !== undefined &&
          payload.transmission !== existing.transmission
        ) {
          data.transmission = payload.transmission;
          transmission = payload.transmission;
        }
        if (nextPlate !== undefined && nextPlate !== existing.plateNumber) {
          await this.assertPlateAvailable(
            tx,
            actor.organizationId,
            nextPlate,
            existing.id,
          );
          data.plateNumber = nextPlate;
        }

        const assignmentChanged =
          data.instructorId !== undefined ||
          data.category !== undefined ||
          data.transmission !== undefined;
        if (assignmentChanged) {
          await this.assertStudentsStillMatch(
            tx,
            existing.id,
            actor.organizationId,
            { instructorId, category, transmission },
          );
        }

        if (Object.keys(data).length === 0) {
          return existing;
        }

        const saved = await tx.car.update({
          where: { id: existing.id },
          data,
          select: carListSelect,
        });
        if (saved.organizationId !== actor.organizationId) {
          throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
        }
        return saved;
      });

      this.logger.log(
        `Car updated carId=${updated.id} organizationId=${actor.organizationId} actorId=${actor.id}`,
      );
      return toCarListItem(updated);
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      if (isUniqueConstraintOn(error, 'plateNumber')) {
        throw this.plateAlreadyExists();
      }
      throw error;
    }
  }

  async changeStatus(
    actor: User,
    carId: string,
    payload: UpdateCarStatusDto,
  ): Promise<CarListItemDto> {
    assertCanWriteCars(actor);
    await this.requireOrganization(actor.organizationId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.car.findUnique({
        where: { id: carId },
        select: carListSelect,
      });
      if (!existing || existing.organizationId !== actor.organizationId) {
        throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
      }

      const next = payload.status;
      if (!CAR_STATUS_TRANSITIONS[existing.status].includes(next)) {
        throw new ConflictException(
          `${CAR_STATUS_TRANSITION_MESSAGE} ${existing.status} → ${next}.`,
        );
      }

      if (next !== CarStatus.AVAILABLE) {
        const inPractice = await tx.student.findFirst({
          where: {
            carId: existing.id,
            organizationId: actor.organizationId,
            trainingStatus: TrainingStatus.PRACTICE,
          },
          select: { id: true },
        });
        if (inPractice) {
          throw new ConflictException(CAR_STATUS_IN_PRACTICE_MESSAGE);
        }
      }

      const saved = await tx.car.update({
        where: { id: existing.id },
        data: { status: next },
        select: carListSelect,
      });
      if (saved.organizationId !== actor.organizationId) {
        throw new NotFoundException(CAR_NOT_FOUND_MESSAGE);
      }

      this.logger.log(
        `Car status changed carId=${saved.id} from=${existing.status} to=${saved.status} actorId=${actor.id} organizationId=${actor.organizationId}`,
      );
      return saved;
    });

    return toCarListItem(updated);
  }

  private async requireInstructor(
    tx: Prisma.TransactionClient,
    actor: User,
    instructorId: string,
  ) {
    const instructor = await tx.user.findUnique({
      where: { id: instructorId },
    });
    if (
      !instructor ||
      instructor.deletedAt ||
      instructor.organizationId !== actor.organizationId
    ) {
      throw new NotFoundException(INSTRUCTOR_NOT_FOUND_MESSAGE);
    }
    if (instructor.role !== UserRole.INSTRUCTOR) {
      throw new ConflictException(INSTRUCTOR_ROLE_MESSAGE);
    }
    if (instructor.status !== UserStatus.ACTIVE) {
      throw new ConflictException(INSTRUCTOR_NOT_ACTIVE_MESSAGE);
    }
  }

  private async assertPlateAvailable(
    tx: Prisma.TransactionClient,
    organizationId: string,
    plateNumber: string,
    excludeCarId?: string,
  ) {
    const duplicate = await tx.car.findFirst({
      where: {
        organizationId,
        plateNumber: { equals: plateNumber, mode: 'insensitive' },
        ...(excludeCarId ? { NOT: { id: excludeCarId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw this.plateAlreadyExists();
    }
  }

  private async assertStudentsStillMatch(
    tx: Prisma.TransactionClient,
    carId: string,
    organizationId: string,
    next: {
      instructorId: string;
      category: LicenseCategory;
      transmission: Transmission;
    },
  ) {
    const mismatch = await tx.student.findFirst({
      where: {
        carId,
        organizationId,
        OR: [
          { instructorId: { not: next.instructorId } },
          { instructorId: null },
          { category: { not: next.category } },
          { category: null },
          { transmission: { not: next.transmission } },
          { transmission: null },
        ],
      },
      select: { id: true },
    });
    if (mismatch) {
      throw new ConflictException(CAR_ASSIGNED_STUDENT_MESSAGE);
    }
  }

  private plateAlreadyExists() {
    return new ConflictException({
      statusCode: 409,
      errors: [{ field: 'plateNumber', message: PLATE_ALREADY_EXISTS_MESSAGE }],
    });
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
