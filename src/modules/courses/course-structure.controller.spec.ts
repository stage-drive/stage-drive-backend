import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CourseStructureController } from './course-structure.controller';
import { CourseStructureService } from './course-structure.service';

describe('CourseStructureController', () => {
  const user = { id: 'admin-1', organizationId: 'org-1' };
  const response = { id: 'saved-1' };
  const structure = {
    getStructure: jest.fn().mockResolvedValue(response),
    createChapter: jest.fn().mockResolvedValue(response),
    updateChapter: jest.fn().mockResolvedValue(response),
    createLesson: jest.fn().mockResolvedValue(response),
    updateLesson: jest.fn().mockResolvedValue(response),
    createMaterial: jest.fn().mockResolvedValue(response),
    updateMaterial: jest.fn().mockResolvedValue(response),
  };
  const controller = new CourseStructureController(
    structure as unknown as CourseStructureService,
  );

  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CourseStructureController),
    ).toEqual([AuthGuard, RolesGuard]);
  });

  it.each([
    'getStructure',
    'createChapter',
    'updateChapter',
    'createLesson',
    'updateLesson',
    'createMaterial',
    'updateMaterial',
  ] as const)('restricts %s to ADMIN', (method) => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      CourseStructureController.prototype[method],
    );

    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it.each(['createChapter', 'createLesson', 'createMaterial'] as const)(
    'answers 201 when %s creates a record',
    (method) => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
          CourseStructureController.prototype[method],
        ),
      ).toBe(HttpStatus.CREATED);
    },
  );

  it('passes the course id to the structure query', async () => {
    await expect(
      controller.getStructure(user as never, 'course-1'),
    ).resolves.toBe(response);
    expect(structure.getStructure).toHaveBeenCalledWith(user, 'course-1');
  });

  it('passes chapter, lesson and material writes through to the service', async () => {
    const chapter = { title: 'Розділ' };
    const lesson = { title: 'Урок' };
    const material = { title: 'Матеріал' };

    await controller.createChapter(user as never, 'course-1', chapter);
    await controller.updateChapter(user as never, 'course-1', 'chapter-1', {
      title: 'Нова',
    });
    await controller.createLesson(
      user as never,
      'course-1',
      'chapter-1',
      lesson,
    );
    await controller.updateLesson(
      user as never,
      'course-1',
      'chapter-1',
      'lesson-1',
      { description: null },
    );
    await controller.createMaterial(
      user as never,
      'course-1',
      'chapter-1',
      'lesson-1',
      material,
    );
    await controller.updateMaterial(
      user as never,
      'course-1',
      'chapter-1',
      'lesson-1',
      'material-1',
      { title: 'Новий матеріал' },
    );

    expect(structure.createChapter).toHaveBeenCalledWith(
      user,
      'course-1',
      chapter,
    );
    expect(structure.updateChapter).toHaveBeenCalledWith(
      user,
      'course-1',
      'chapter-1',
      { title: 'Нова' },
    );
    expect(structure.createLesson).toHaveBeenCalledWith(
      user,
      'course-1',
      'chapter-1',
      lesson,
    );
    expect(structure.updateLesson).toHaveBeenCalledWith(
      user,
      'course-1',
      'chapter-1',
      'lesson-1',
      { description: null },
    );
    expect(structure.createMaterial).toHaveBeenCalledWith(
      user,
      'course-1',
      'chapter-1',
      'lesson-1',
      material,
    );
    expect(structure.updateMaterial).toHaveBeenCalledWith(
      user,
      'course-1',
      'chapter-1',
      'lesson-1',
      'material-1',
      { title: 'Новий матеріал' },
    );
  });
});
