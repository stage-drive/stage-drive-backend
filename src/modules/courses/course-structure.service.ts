import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CourseMaterialType, Prisma, User, UserRole } from '@prisma/client';
import { isURL } from 'class-validator';
import { UNSAFE_TEXT_MESSAGE } from '../../common/validators/plain-text.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChapterDto,
  ChapterStructureDto,
  CourseStructureDto,
  CreateChapterDto,
  CreateLessonDto,
  CreateMaterialDto,
  LessonDto,
  LessonStructureDto,
  MATERIAL_BODY_LENGTH_MESSAGE,
  MATERIAL_BODY_MAX_LENGTH,
  MATERIAL_URL_MAX_LENGTH,
  MaterialDto,
  UpdateChapterDto,
  UpdateLessonDto,
  UpdateMaterialDto,
} from './course-structure.dto';
import {
  assertInsertPosition,
  assertMovePosition,
  shiftForInsert,
  shiftForMove,
} from './course-structure.order';
import {
  COURSE_MANAGE_ROLES,
  COURSE_NOT_FOUND_MESSAGE,
} from './courses.service';

export const CHAPTER_NOT_FOUND_MESSAGE = 'Chapter not found';
export const LESSON_NOT_FOUND_MESSAGE = 'Lesson not found';
export const MATERIAL_NOT_FOUND_MESSAGE = 'Material not found';
export const NO_CHAPTER_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (title, description, position).';
export const NO_LESSON_FIELDS_MESSAGE = NO_CHAPTER_FIELDS_MESSAGE;
export const NO_MATERIAL_FIELDS_MESSAGE =
  'Немає дозволених полів для оновлення (title, type, body, position).';
export const MATERIAL_URL_REQUIRED_MESSAGE =
  'Для посилання або відео вкажіть URL.';
export const MATERIAL_URL_MESSAGE = 'body має бути адресою http або https.';

const PLAIN_TEXT = /^[^<>]*$/u;

const chapterSelect = {
  id: true,
  courseId: true,
  title: true,
  description: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseChapterSelect;

const lessonSelect = {
  id: true,
  courseId: true,
  chapterId: true,
  title: true,
  description: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseLessonSelect;

const materialSelect = {
  id: true,
  courseId: true,
  lessonId: true,
  title: true,
  type: true,
  body: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseMaterialSelect;

const structureSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  chapters: {
    orderBy: { position: 'asc' },
    select: {
      ...chapterSelect,
      lessons: {
        orderBy: { position: 'asc' },
        select: {
          ...lessonSelect,
          materials: {
            orderBy: { position: 'asc' },
            select: materialSelect,
          },
        },
      },
    },
  },
} satisfies Prisma.CourseSelect;

type ChapterRow = Prisma.CourseChapterGetPayload<{
  select: typeof chapterSelect;
}>;
type LessonRow = Prisma.CourseLessonGetPayload<{ select: typeof lessonSelect }>;
type MaterialRow = Prisma.CourseMaterialGetPayload<{
  select: typeof materialSelect;
}>;
type StructureRow = Prisma.CourseGetPayload<{ select: typeof structureSelect }>;

function assertCanManage(actor: User): void {
  if (!(COURSE_MANAGE_ROLES as readonly UserRole[]).includes(actor.role)) {
    throw new ForbiddenException('Insufficient permissions');
  }
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    errors: [{ field, message }],
  });
}

function assertMaterialBody(
  type: CourseMaterialType,
  body: string | null,
): void {
  if (type === CourseMaterialType.TEXT) {
    if (body !== null && body.length > MATERIAL_BODY_MAX_LENGTH) {
      throw fieldError('body', MATERIAL_BODY_LENGTH_MESSAGE);
    }
    if (body !== null && !PLAIN_TEXT.test(body)) {
      throw fieldError('body', UNSAFE_TEXT_MESSAGE);
    }
    return;
  }
  if (body === null || body.length === 0) {
    throw fieldError('body', MATERIAL_URL_REQUIRED_MESSAGE);
  }
  if (
    body.length > MATERIAL_URL_MAX_LENGTH ||
    !isURL(body, { protocols: ['http', 'https'], require_protocol: true })
  ) {
    throw fieldError('body', MATERIAL_URL_MESSAGE);
  }
}

function byPosition<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.position - right.position);
}

function toChapter(chapter: ChapterRow): ChapterDto {
  return {
    id: chapter.id,
    courseId: chapter.courseId,
    title: chapter.title,
    description: chapter.description,
    position: chapter.position,
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt,
  };
}

function toLesson(lesson: LessonRow): LessonDto {
  return {
    id: lesson.id,
    courseId: lesson.courseId,
    chapterId: lesson.chapterId,
    title: lesson.title,
    description: lesson.description,
    position: lesson.position,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt,
  };
}

function toMaterial(material: MaterialRow): MaterialDto {
  return {
    id: material.id,
    courseId: material.courseId,
    lessonId: material.lessonId,
    title: material.title,
    type: material.type,
    body: material.body,
    position: material.position,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

function toLessonStructure(
  lesson: StructureRow['chapters'][number]['lessons'][number],
): LessonStructureDto {
  return {
    ...toLesson(lesson),
    materials: byPosition(lesson.materials).map(toMaterial),
  };
}

function toChapterStructure(
  chapter: StructureRow['chapters'][number],
): ChapterStructureDto {
  return {
    ...toChapter(chapter),
    lessons: byPosition(chapter.lessons).map(toLessonStructure),
  };
}

function toStructure(course: StructureRow): CourseStructureDto {
  return {
    id: course.id,
    name: course.name,
    description: course.description,
    status: course.status,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    chapters: byPosition(course.chapters).map(toChapterStructure),
  };
}

async function lockCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
  organizationId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM courses
    WHERE id = ${courseId}::uuid AND organization_id = ${organizationId}::uuid
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
  }
}

@Injectable()
export class CourseStructureService {
  private readonly logger = new Logger(CourseStructureService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStructure(
    actor: User,
    courseId: string,
  ): Promise<CourseStructureDto> {
    await this.prepare(actor);
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, organizationId: actor.organizationId },
      select: structureSelect,
    });
    if (!course) {
      throw new NotFoundException(COURSE_NOT_FOUND_MESSAGE);
    }
    return toStructure(course);
  }

  async createChapter(
    actor: User,
    courseId: string,
    payload: CreateChapterDto,
  ): Promise<ChapterDto> {
    await this.prepare(actor);
    const created = await this.withLockedCourse(actor, courseId, async (tx) => {
      const siblings = await tx.courseChapter.findMany({
        where: { courseId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' },
      });
      const position = assertInsertPosition(siblings.length, payload.position);
      await shiftForInsert(siblings, position, this.chapterPosition(tx));
      return tx.courseChapter.create({
        data: {
          courseId,
          title: payload.title,
          description: payload.description ?? null,
          position,
        },
        select: chapterSelect,
      });
    });
    this.logger.log(
      `Chapter created chapterId=${created.id} courseId=${courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toChapter(created);
  }

  async updateChapter(
    actor: User,
    courseId: string,
    chapterId: string,
    payload: UpdateChapterDto,
  ): Promise<ChapterDto> {
    await this.prepare(actor);
    if (
      payload.title === undefined &&
      payload.description === undefined &&
      payload.position === undefined
    ) {
      throw fieldError('body', NO_CHAPTER_FIELDS_MESSAGE);
    }

    const updated = await this.withLockedCourse(actor, courseId, async (tx) => {
      const existing = await this.requireChapter(tx, courseId, chapterId);
      const data: Prisma.CourseChapterUpdateInput = {};
      if (payload.title !== undefined && payload.title !== existing.title) {
        data.title = payload.title;
      }
      if (
        payload.description !== undefined &&
        payload.description !== existing.description
      ) {
        data.description = payload.description;
      }
      if (
        payload.position !== undefined &&
        payload.position !== existing.position
      ) {
        const siblings = await tx.courseChapter.findMany({
          where: { courseId },
          select: { id: true, position: true },
          orderBy: { position: 'asc' },
        });
        const position = assertMovePosition(siblings.length, payload.position);
        await shiftForMove(
          siblings,
          existing.id,
          existing.position,
          position,
          this.chapterPosition(tx),
        );
        data.position = position;
      }
      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.courseChapter.update({
        where: { id: existing.id },
        data,
        select: chapterSelect,
      });
    });

    this.logger.log(
      `Chapter updated chapterId=${updated.id} courseId=${courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toChapter(updated);
  }

  async createLesson(
    actor: User,
    courseId: string,
    chapterId: string,
    payload: CreateLessonDto,
  ): Promise<LessonDto> {
    await this.prepare(actor);
    const created = await this.withLockedCourse(actor, courseId, async (tx) => {
      await this.requireChapter(tx, courseId, chapterId);
      const siblings = await tx.courseLesson.findMany({
        where: { courseId, chapterId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' },
      });
      const position = assertInsertPosition(siblings.length, payload.position);
      await shiftForInsert(siblings, position, this.lessonPosition(tx));
      return tx.courseLesson.create({
        data: {
          courseId,
          chapterId,
          title: payload.title,
          description: payload.description ?? null,
          position,
        },
        select: lessonSelect,
      });
    });
    this.logger.log(
      `Lesson created lessonId=${created.id} chapterId=${chapterId} courseId=${courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toLesson(created);
  }

  async updateLesson(
    actor: User,
    courseId: string,
    chapterId: string,
    lessonId: string,
    payload: UpdateLessonDto,
  ): Promise<LessonDto> {
    await this.prepare(actor);
    if (
      payload.title === undefined &&
      payload.description === undefined &&
      payload.position === undefined
    ) {
      throw fieldError('body', NO_LESSON_FIELDS_MESSAGE);
    }

    const updated = await this.withLockedCourse(actor, courseId, async (tx) => {
      const existing = await this.requireLesson(
        tx,
        courseId,
        chapterId,
        lessonId,
      );
      const data: Prisma.CourseLessonUpdateInput = {};
      if (payload.title !== undefined && payload.title !== existing.title) {
        data.title = payload.title;
      }
      if (
        payload.description !== undefined &&
        payload.description !== existing.description
      ) {
        data.description = payload.description;
      }
      if (
        payload.position !== undefined &&
        payload.position !== existing.position
      ) {
        const siblings = await tx.courseLesson.findMany({
          where: { courseId, chapterId },
          select: { id: true, position: true },
          orderBy: { position: 'asc' },
        });
        const position = assertMovePosition(siblings.length, payload.position);
        await shiftForMove(
          siblings,
          existing.id,
          existing.position,
          position,
          this.lessonPosition(tx),
        );
        data.position = position;
      }
      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.courseLesson.update({
        where: { id: existing.id },
        data,
        select: lessonSelect,
      });
    });

    this.logger.log(
      `Lesson updated lessonId=${updated.id} chapterId=${chapterId} courseId=${courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toLesson(updated);
  }

  async createMaterial(
    actor: User,
    courseId: string,
    chapterId: string,
    lessonId: string,
    payload: CreateMaterialDto,
  ): Promise<MaterialDto> {
    await this.prepare(actor);
    const created = await this.withLockedCourse(actor, courseId, async (tx) => {
      await this.requireLesson(tx, courseId, chapterId, lessonId);
      const type = payload.type ?? CourseMaterialType.TEXT;
      assertMaterialBody(type, payload.body ?? null);
      const siblings = await tx.courseMaterial.findMany({
        where: { courseId, lessonId },
        select: { id: true, position: true },
        orderBy: { position: 'asc' },
      });
      const position = assertInsertPosition(siblings.length, payload.position);
      await shiftForInsert(siblings, position, this.materialPosition(tx));
      return tx.courseMaterial.create({
        data: {
          courseId,
          lessonId,
          title: payload.title,
          type,
          body: payload.body ?? null,
          position,
        },
        select: materialSelect,
      });
    });
    this.logger.log(
      `Material created materialId=${created.id} lessonId=${lessonId} courseId=${courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toMaterial(created);
  }

  async updateMaterial(
    actor: User,
    courseId: string,
    chapterId: string,
    lessonId: string,
    materialId: string,
    payload: UpdateMaterialDto,
  ): Promise<MaterialDto> {
    await this.prepare(actor);
    if (
      payload.title === undefined &&
      payload.type === undefined &&
      payload.body === undefined &&
      payload.position === undefined
    ) {
      throw fieldError('body', NO_MATERIAL_FIELDS_MESSAGE);
    }

    const updated = await this.withLockedCourse(actor, courseId, async (tx) => {
      await this.requireLesson(tx, courseId, chapterId, lessonId);
      const existing = await this.requireMaterial(
        tx,
        courseId,
        lessonId,
        materialId,
      );
      const nextType = payload.type ?? existing.type;
      const nextBody =
        payload.body !== undefined ? payload.body : existing.body;
      if (payload.type !== undefined || payload.body !== undefined) {
        assertMaterialBody(nextType, nextBody);
      }

      const data: Prisma.CourseMaterialUpdateInput = {};
      if (payload.title !== undefined && payload.title !== existing.title) {
        data.title = payload.title;
      }
      if (payload.type !== undefined && payload.type !== existing.type) {
        data.type = payload.type;
      }
      if (payload.body !== undefined && payload.body !== existing.body) {
        data.body = payload.body;
      }
      if (
        payload.position !== undefined &&
        payload.position !== existing.position
      ) {
        const siblings = await tx.courseMaterial.findMany({
          where: { courseId, lessonId },
          select: { id: true, position: true },
          orderBy: { position: 'asc' },
        });
        const position = assertMovePosition(siblings.length, payload.position);
        await shiftForMove(
          siblings,
          existing.id,
          existing.position,
          position,
          this.materialPosition(tx),
        );
        data.position = position;
      }
      if (Object.keys(data).length === 0) {
        return existing;
      }
      return tx.courseMaterial.update({
        where: { id: existing.id },
        data,
        select: materialSelect,
      });
    });

    this.logger.log(
      `Material updated materialId=${updated.id} lessonId=${lessonId} courseId=${courseId} organizationId=${actor.organizationId} actorId=${actor.id}`,
    );
    return toMaterial(updated);
  }

  private async prepare(actor: User): Promise<void> {
    assertCanManage(actor);
    await this.requireOrganization(actor.organizationId);
  }

  private withLockedCourse<T>(
    actor: User,
    courseId: string,
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await lockCourse(tx, courseId, actor.organizationId);
      return run(tx);
    });
  }

  private async requireChapter(
    tx: Prisma.TransactionClient,
    courseId: string,
    chapterId: string,
  ): Promise<ChapterRow> {
    const chapter = await tx.courseChapter.findFirst({
      where: { id: chapterId, courseId },
      select: chapterSelect,
    });
    if (!chapter) {
      throw new NotFoundException(CHAPTER_NOT_FOUND_MESSAGE);
    }
    return chapter;
  }

  private async requireLesson(
    tx: Prisma.TransactionClient,
    courseId: string,
    chapterId: string,
    lessonId: string,
  ): Promise<LessonRow> {
    const lesson = await tx.courseLesson.findFirst({
      where: { id: lessonId, chapterId, courseId },
      select: lessonSelect,
    });
    if (!lesson) {
      throw new NotFoundException(LESSON_NOT_FOUND_MESSAGE);
    }
    return lesson;
  }

  private async requireMaterial(
    tx: Prisma.TransactionClient,
    courseId: string,
    lessonId: string,
    materialId: string,
  ): Promise<MaterialRow> {
    const material = await tx.courseMaterial.findFirst({
      where: { id: materialId, lessonId, courseId },
      select: materialSelect,
    });
    if (!material) {
      throw new NotFoundException(MATERIAL_NOT_FOUND_MESSAGE);
    }
    return material;
  }

  private chapterPosition(tx: Prisma.TransactionClient) {
    return (id: string, position: number) =>
      tx.courseChapter
        .update({ where: { id }, data: { position } })
        .then(() => undefined);
  }

  private lessonPosition(tx: Prisma.TransactionClient) {
    return (id: string, position: number) =>
      tx.courseLesson
        .update({ where: { id }, data: { position } })
        .then(() => undefined);
  }

  private materialPosition(tx: Prisma.TransactionClient) {
    return (id: string, position: number) =>
      tx.courseMaterial
        .update({ where: { id }, data: { position } })
        .then(() => undefined);
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
