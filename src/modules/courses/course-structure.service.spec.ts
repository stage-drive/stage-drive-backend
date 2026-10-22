import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CourseMaterialType,
  CourseStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { positionRangeMessage } from './course-structure.order';
import {
  CHAPTER_NOT_FOUND_MESSAGE,
  CourseStructureService,
  LESSON_NOT_FOUND_MESSAGE,
  MATERIAL_NOT_FOUND_MESSAGE,
  MATERIAL_URL_MESSAGE,
  MATERIAL_URL_REQUIRED_MESSAGE,
  NO_CHAPTER_FIELDS_MESSAGE,
  NO_MATERIAL_FIELDS_MESSAGE,
} from './course-structure.service';
import { COURSE_NOT_FOUND_MESSAGE } from './courses.service';

async function caught(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject');
}

type Row = {
  id: string;
  position: number;
  courseId: string;
  title: string;
  description?: string | null;
  chapterId?: string;
  lessonId?: string;
  type?: CourseMaterialType;
  body?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createStore(prefix: string) {
  const items: Row[] = [];
  let sequence = 0;

  function matches(row: Row, where?: Record<string, unknown>) {
    if (!where) {
      return true;
    }
    return Object.entries(where).every(
      ([key, value]) => row[key as keyof Row] === value,
    );
  }

  return {
    items,
    findMany: jest.fn(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(
        items
          .filter((row) => matches(row, where))
          .sort((left, right) => left.position - right.position)
          .map((row) => ({ id: row.id, position: row.position })),
      ),
    ),
    findFirst: jest.fn(({ where }: { where?: Record<string, unknown> }) =>
      Promise.resolve(items.find((row) => matches(row, where)) ?? null),
    ),
    create: jest.fn(({ data }: { data: Partial<Row> }) => {
      const row: Row = {
        id: `${prefix}-${++sequence}`,
        position: 0,
        courseId: 'course-1',
        title: '',
        description: null,
        body: null,
        type: CourseMaterialType.TEXT,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      if (
        items.some(
          (item) => item.id !== row.id && item.position === row.position,
        )
      ) {
        return Promise.reject(new Error(`position collision ${row.position}`));
      }
      items.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(
      ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = items.find((item) => item.id === where.id);
        if (!row) {
          return Promise.reject(new Error(`missing ${where.id}`));
        }
        if (
          typeof data.position === 'number' &&
          items.some(
            (item) => item.id !== row.id && item.position === data.position,
          )
        ) {
          return Promise.reject(
            new Error(`position collision ${data.position}`),
          );
        }
        Object.assign(row, data);
        return Promise.resolve({ ...row });
      },
    ),
  };
}

const now = new Date('2026-10-20T10:00:00.000Z');

function stamp(
  partial: Omit<Row, 'createdAt' | 'updatedAt'> &
    Partial<Pick<Row, 'createdAt' | 'updatedAt'>>,
): Row {
  return { createdAt: now, updatedAt: now, description: null, ...partial };
}

function labels(items: Row[]) {
  return [...items]
    .sort((left, right) => left.position - right.position)
    .map((item) => [item.title, item.position]);
}

describe('CourseStructureService', () => {
  const admin = {
    id: 'admin-1',
    role: UserRole.ADMIN,
    organizationId: 'org-1',
  };
  const courseId = 'course-1';
  const chapters = createStore('chapter');
  const lessons = createStore('lesson');
  const materials = createStore('material');
  let courseVisible = true;

  const prisma = {
    organization: { findUnique: jest.fn() },
    course: { findFirst: jest.fn() },
    courseChapter: chapters,
    courseLesson: lessons,
    courseMaterial: materials,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  let service: CourseStructureService;

  function executedQuery(): { text: string; values: unknown[] } {
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const query = Prisma.sql(strings, ...values);
    return {
      text: query.text.replace(/\s+/g, ' ').trim(),
      values: query.values,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    chapters.items.splice(0, chapters.items.length);
    lessons.items.splice(0, lessons.items.length);
    materials.items.splice(0, materials.items.length);
    courseVisible = true;
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: null,
    });
    prisma.course.findFirst.mockResolvedValue(null);
    prisma.$queryRaw.mockImplementation(() =>
      Promise.resolve(courseVisible ? [{ id: courseId }] : []),
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new CourseStructureService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    UserRole.OWNER,
    UserRole.TEACHER,
    UserRole.INSTRUCTOR,
    UserRole.STUDENT,
  ])('forbids %s before touching the database', async (role) => {
    const actor = { ...admin, role };
    await expect(
      service.getStructure(actor as never, courseId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createChapter(actor as never, courseId, { title: 'Розділ' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createLesson(actor as never, courseId, 'chapter-1', {
        title: 'Урок',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createMaterial(
        actor as never,
        courseId,
        'chapter-1',
        'lesson-1',
        {
          title: 'Матеріал',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the organization is soft-deleted', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 'org-1',
      deletedAt: new Date(),
    });

    await expect(
      service.getStructure(admin as never, courseId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.course.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('structure', () => {
    it('returns chapters, lessons and materials ordered by position', async () => {
      const createdAt = now;
      prisma.course.findFirst.mockResolvedValue({
        id: courseId,
        name: 'Категорія B',
        description: null,
        status: CourseStatus.ACTIVE,
        createdAt,
        updatedAt: now,
        chapters: [
          {
            ...stamp({
              id: 'chapter-2',
              courseId,
              title: 'Будова',
              position: 2,
            }),
            lessons: [],
          },
          {
            ...stamp({
              id: 'chapter-1',
              courseId,
              title: 'ПДР',
              position: 1,
            }),
            lessons: [
              {
                ...stamp({
                  id: 'lesson-2',
                  courseId,
                  chapterId: 'chapter-1',
                  title: 'Розмітка',
                  position: 2,
                }),
                materials: [],
              },
              {
                ...stamp({
                  id: 'lesson-1',
                  courseId,
                  chapterId: 'chapter-1',
                  title: 'Знаки',
                  position: 1,
                }),
                materials: [
                  stamp({
                    id: 'material-2',
                    courseId,
                    lessonId: 'lesson-1',
                    title: 'Посилання',
                    type: CourseMaterialType.LINK,
                    body: 'https://example.com/pdr',
                    position: 2,
                  }),
                  stamp({
                    id: 'material-1',
                    courseId,
                    lessonId: 'lesson-1',
                    title: 'Текст',
                    type: CourseMaterialType.TEXT,
                    body: 'Знаки',
                    position: 1,
                  }),
                ],
              },
            ],
          },
        ],
      });

      await expect(
        service.getStructure(admin as never, courseId),
      ).resolves.toEqual({
        id: courseId,
        name: 'Категорія B',
        description: null,
        status: CourseStatus.ACTIVE,
        createdAt,
        updatedAt: now,
        chapters: [
          expect.objectContaining({
            id: 'chapter-1',
            courseId,
            position: 1,
            lessons: [
              expect.objectContaining({
                id: 'lesson-1',
                courseId,
                chapterId: 'chapter-1',
                position: 1,
                materials: [
                  expect.objectContaining({
                    id: 'material-1',
                    lessonId: 'lesson-1',
                    position: 1,
                  }),
                  expect.objectContaining({
                    id: 'material-2',
                    position: 2,
                  }),
                ],
              }),
              expect.objectContaining({ id: 'lesson-2', position: 2 }),
            ],
          }),
          expect.objectContaining({
            id: 'chapter-2',
            position: 2,
            lessons: [],
          }),
        ],
      });

      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: courseId, organizationId: 'org-1' },
        }),
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns 404 for a course of another organization', async () => {
      const error = await caught(
        service.getStructure(admin as never, 'course-foreign'),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(prisma.course.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'course-foreign', organizationId: 'org-1' },
        }),
      );
    });
  });

  describe('chapters', () => {
    it('appends a chapter to the actor course and locks that course first', async () => {
      chapters.items.push(
        stamp({
          id: 'chapter-a',
          courseId,
          title: 'Перший',
          position: 1,
        }),
      );

      const created = await service.createChapter(admin as never, courseId, {
        title: 'Другий',
      });

      expect(created).toMatchObject({
        courseId,
        title: 'Другий',
        description: null,
        position: 2,
      });
      expect(executedQuery()).toEqual({
        text: 'SELECT id FROM courses WHERE id = $1::uuid AND organization_id = $2::uuid FOR UPDATE',
        values: [courseId, 'org-1'],
      });
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        chapters.create.mock.invocationCallOrder[0],
      );
      expect(labels(chapters.items)).toEqual([
        ['Перший', 1],
        ['Другий', 2],
      ]);
    });

    it('inserts a chapter between existing ones', async () => {
      chapters.items.push(
        stamp({ id: 'a', courseId, title: 'A', position: 1 }),
        stamp({ id: 'b', courseId, title: 'B', position: 2 }),
      );

      await service.createChapter(admin as never, courseId, {
        title: 'Середина',
        position: 2,
      });

      expect(labels(chapters.items)).toEqual([
        ['A', 1],
        ['Середина', 2],
        ['B', 3],
      ]);
    });

    it('moves a chapter and keeps the order gapless', async () => {
      chapters.items.push(
        stamp({ id: 'a', courseId, title: 'A', position: 1 }),
        stamp({ id: 'b', courseId, title: 'B', position: 2 }),
        stamp({ id: 'c', courseId, title: 'C', position: 3 }),
      );

      const moved = await service.updateChapter(admin as never, courseId, 'a', {
        position: 3,
      });

      expect(moved).toMatchObject({ id: 'a', title: 'A', position: 3 });
      expect(labels(chapters.items)).toEqual([
        ['B', 1],
        ['C', 2],
        ['A', 3],
      ]);
    });

    it('rejects a position past the end and an empty update', async () => {
      const outOfRange = await caught(
        service.createChapter(admin as never, courseId, {
          title: 'Розділ',
          position: 2,
        }),
      );
      expect(outOfRange).toBeInstanceOf(BadRequestException);
      expect(outOfRange.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'position', message: positionRangeMessage(1) }],
      });
      expect(chapters.create).not.toHaveBeenCalled();
      prisma.$transaction.mockClear();

      chapters.items.push(
        stamp({ id: 'a', courseId, title: 'A', position: 1 }),
      );
      const empty = await caught(
        service.updateChapter(admin as never, courseId, 'a', {}),
      );
      expect(empty).toBeInstanceOf(BadRequestException);
      expect(empty.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_CHAPTER_FIELDS_MESSAGE }],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 404 when the course belongs to another organization', async () => {
      courseVisible = false;

      const error = await caught(
        service.createChapter(admin as never, 'course-foreign', {
          title: 'Чужий',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(COURSE_NOT_FOUND_MESSAGE);
      expect(chapters.create).not.toHaveBeenCalled();
    });

    it('returns 404 when the chapter belongs to another course', async () => {
      chapters.items.push(
        stamp({
          id: 'foreign-chapter',
          courseId: 'course-other',
          title: 'Чужий',
          position: 1,
        }),
      );

      const error = await caught(
        service.updateChapter(admin as never, courseId, 'foreign-chapter', {
          title: 'Спроба',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(CHAPTER_NOT_FOUND_MESSAGE);
      expect(chapters.update).not.toHaveBeenCalled();
    });

    it('does not write when the chapter values are unchanged', async () => {
      chapters.items.push(
        stamp({
          id: 'a',
          courseId,
          title: 'ПДР',
          description: 'Опис',
          position: 1,
        }),
      );

      await expect(
        service.updateChapter(admin as never, courseId, 'a', {
          title: 'ПДР',
          description: 'Опис',
          position: 1,
        }),
      ).resolves.toMatchObject({ id: 'a', title: 'ПДР', description: 'Опис' });
      expect(chapters.update).not.toHaveBeenCalled();
    });
  });

  describe('lessons', () => {
    beforeEach(() => {
      chapters.items.push(
        stamp({ id: 'chapter-1', courseId, title: 'ПДР', position: 1 }),
      );
    });

    it('binds a new lesson to the course and chapter from the path', async () => {
      lessons.items.push(
        stamp({
          id: 'lesson-old',
          courseId,
          chapterId: 'chapter-1',
          title: 'Перший',
          position: 1,
        }),
      );

      const created = await service.createLesson(
        admin as never,
        courseId,
        'chapter-1',
        { title: 'Новий', position: 1 },
      );

      expect(created).toMatchObject({
        courseId,
        chapterId: 'chapter-1',
        title: 'Новий',
        position: 1,
      });
      expect(labels(lessons.items)).toEqual([
        ['Новий', 1],
        ['Перший', 2],
      ]);
      expect(labels(chapters.items)).toEqual([['ПДР', 1]]);
    });

    it('returns 404 when the chapter is not in this course', async () => {
      chapters.items.push(
        stamp({
          id: 'other-chapter',
          courseId: 'course-other',
          title: 'Чужий',
          position: 1,
        }),
      );

      const error = await caught(
        service.createLesson(admin as never, courseId, 'other-chapter', {
          title: 'Урок',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(CHAPTER_NOT_FOUND_MESSAGE);
      expect(lessons.create).not.toHaveBeenCalled();
    });

    it('returns 404 when the lesson belongs to another chapter', async () => {
      lessons.items.push(
        stamp({
          id: 'lesson-1',
          courseId,
          chapterId: 'chapter-other',
          title: 'Інший',
          position: 1,
        }),
      );

      const error = await caught(
        service.updateLesson(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          { title: 'Спроба' },
        ),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(LESSON_NOT_FOUND_MESSAGE);
      expect(lessons.update).not.toHaveBeenCalled();
    });
  });

  describe('materials', () => {
    beforeEach(() => {
      chapters.items.push(
        stamp({ id: 'chapter-1', courseId, title: 'ПДР', position: 1 }),
      );
      lessons.items.push(
        stamp({
          id: 'lesson-1',
          courseId,
          chapterId: 'chapter-1',
          title: 'Знаки',
          position: 1,
        }),
      );
    });

    it('stores text and a video url on the lesson from the path', async () => {
      const text = await service.createMaterial(
        admin as never,
        courseId,
        'chapter-1',
        'lesson-1',
        { title: 'Конспект', body: 'Групи знаків' },
      );
      const video = await service.createMaterial(
        admin as never,
        courseId,
        'chapter-1',
        'lesson-1',
        {
          title: 'Відео',
          type: CourseMaterialType.VIDEO,
          body: 'https://example.com/video',
        },
      );

      expect(text).toMatchObject({
        courseId,
        lessonId: 'lesson-1',
        type: CourseMaterialType.TEXT,
        body: 'Групи знаків',
        position: 1,
      });
      expect(video).toMatchObject({
        type: CourseMaterialType.VIDEO,
        body: 'https://example.com/video',
        position: 2,
      });
    });

    it('rejects a link without a url and does not save it', async () => {
      const error = await caught(
        service.createMaterial(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          { title: 'ПДР', type: CourseMaterialType.LINK },
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: MATERIAL_URL_REQUIRED_MESSAGE }],
      });
      expect(materials.create).not.toHaveBeenCalled();
    });

    it('rejects a non-http url and unsafe text', async () => {
      const script = await caught(
        service.createMaterial(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          { title: 'Текст', body: '<b>жирний</b>' },
        ),
      );
      expect(script.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: expect.any(String) }],
      });

      const javascript = await caught(
        service.createMaterial(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          {
            title: 'Посилання',
            type: CourseMaterialType.LINK,
            body: 'javascript:alert(1)',
          },
        ),
      );
      expect(javascript.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: MATERIAL_URL_MESSAGE }],
      });
      expect(materials.create).not.toHaveBeenCalled();
    });

    it('rejects turning text into a link when the body is not a url', async () => {
      materials.items.push(
        stamp({
          id: 'material-1',
          courseId,
          lessonId: 'lesson-1',
          title: 'Конспект',
          type: CourseMaterialType.TEXT,
          body: 'Це текст',
          position: 1,
        }),
      );

      const error = await caught(
        service.updateMaterial(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          'material-1',
          { type: CourseMaterialType.LINK },
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: MATERIAL_URL_MESSAGE }],
      });
      expect(materials.update).not.toHaveBeenCalled();
    });

    it('edits the material title and body', async () => {
      materials.items.push(
        stamp({
          id: 'material-1',
          courseId,
          lessonId: 'lesson-1',
          title: 'Конспект',
          type: CourseMaterialType.TEXT,
          body: 'Було',
          position: 1,
        }),
      );

      await expect(
        service.updateMaterial(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          'material-1',
          { title: 'Новий конспект', body: 'Стало' },
        ),
      ).resolves.toMatchObject({
        id: 'material-1',
        title: 'Новий конспект',
        body: 'Стало',
      });
    });

    it('returns 404 when the material belongs to another lesson', async () => {
      materials.items.push(
        stamp({
          id: 'material-1',
          courseId,
          lessonId: 'lesson-other',
          title: 'Чужий',
          position: 1,
        }),
      );

      const error = await caught(
        service.updateMaterial(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          'material-1',
          { title: 'Спроба' },
        ),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe(MATERIAL_NOT_FOUND_MESSAGE);
      expect(materials.update).not.toHaveBeenCalled();
    });

    it('rejects an empty material update before opening a transaction', async () => {
      const error = await caught(
        service.updateMaterial(
          admin as never,
          courseId,
          'chapter-1',
          'lesson-1',
          'material-1',
          {},
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_MATERIAL_FIELDS_MESSAGE }],
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
