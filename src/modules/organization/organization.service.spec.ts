import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Organization,
  OrganizationStatus,
  Prisma,
  User,
  UserRole,
} from '@prisma/client';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { ORGANIZATION_REQUIRED_FIELD_MESSAGE } from './organization.dto';
import {
  NO_ORGANIZATION_FIELDS_MESSAGE,
  ORGANIZATION_EMAIL_TAKEN_MESSAGE,
  ORGANIZATION_NOT_FOUND_MESSAGE,
  OrganizationService,
  UpdateOrganizationInput,
} from './organization.service';

function organizationRow(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 'org-1',
    name: 'Stage Drive School',
    slug: 'stage-drive-school',
    email: 'info@stagedrive.ua',
    phone: '+380441234567',
    address: 'м. Київ, вул. Хрещатик, 1',
    status: OrganizationStatus.ACTIVE,
    logoUrl: null,
    timezone: 'Europe/Kyiv',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

const actor = {
  id: 'user-1',
  role: UserRole.ADMIN,
  organizationId: 'org-1',
} as User;

function uniqueEmailError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['email'] },
  });
}

describe('OrganizationService', () => {
  let service: OrganizationService;
  let current: Organization;
  let emailOwner: { id: string } | null;
  const prisma = {
    organization: { findUnique: jest.fn(), update: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    current = organizationRow();
    emailOwner = null;
    prisma.organization.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; email?: string } }) =>
        Promise.resolve(where.email !== undefined ? emailOwner : current),
    );
    prisma.organization.update.mockImplementation(
      ({ data }: { data: Partial<Organization> }) =>
        Promise.resolve({ ...current, ...data }),
    );
    service = new OrganizationService(prisma as unknown as PrismaService);
  });

  describe('getCurrent', () => {
    it("returns the actor's organization with contact details", async () => {
      await expect(service.getCurrent(actor)).resolves.toEqual({
        id: 'org-1',
        name: 'Stage Drive School',
        email: 'info@stagedrive.ua',
        phone: '+380441234567',
        address: 'м. Київ, вул. Хрещатик, 1',
        logoUrl: null,
        timezone: 'Europe/Kyiv',
      });
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
    });

    it('does not expose internal fields', async () => {
      const result = await service.getCurrent(actor);

      expect(result).not.toHaveProperty('slug');
      expect(result).not.toHaveProperty('status');
      expect(result).not.toHaveProperty('deletedAt');
    });

    it.each([
      ['missing', null],
      ['deleted', organizationRow({ deletedAt: new Date('2026-11-01') })],
    ])('returns 404 for a %s organization', async (_label, row) => {
      prisma.organization.findUnique.mockResolvedValue(row);

      await expect(service.getCurrent(actor)).rejects.toThrow(
        new NotFoundException(ORGANIZATION_NOT_FOUND_MESSAGE),
      );
    });
  });

  describe('updateCurrent', () => {
    it("saves the allowed fields of the actor's organization", async () => {
      const result = await service.updateCurrent(actor, {
        name: '  Автошкола Drive ',
        email: ' New@StageDrive.UA ',
        phone: ' +380501112233 ',
        address: ' м. Львів, пл. Ринок, 1 ',
      });

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: {
          name: 'Автошкола Drive',
          email: 'new@stagedrive.ua',
          phone: '+380501112233',
          address: 'м. Львів, пл. Ринок, 1',
        },
      });
      expect(result).toMatchObject({
        id: 'org-1',
        name: 'Автошкола Drive',
        email: 'new@stagedrive.ua',
        phone: '+380501112233',
        address: 'м. Львів, пл. Ринок, 1',
      });
    });

    it('never writes fields outside the allowed list', async () => {
      const input = {
        phone: '+380501112233',
        timezone: 'America/New_York',
        status: OrganizationStatus.BLOCKED,
        slug: 'hijacked',
        id: 'org-2',
      } as UpdateOrganizationInput;

      await service.updateCurrent(actor, input);

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { phone: '+380501112233' },
      });
    });

    it('always updates the organization from the actor account', async () => {
      current = organizationRow({ id: 'org-7' });

      await service.updateCurrent(
        { ...actor, organizationId: 'org-7' },
        { name: 'Drive' },
      );

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-7' },
      });
      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-7' } }),
      );
    });

    it('clears phone and address', async () => {
      await service.updateCurrent(actor, { phone: null, address: '  ' });

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { phone: null, address: null },
      });
    });

    it.each(['name', 'email'] as const)('rejects a blank %s', async (field) => {
      const error = await service
        .updateCurrent(actor, { [field]: '   ' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field, message: ORGANIZATION_REQUIRED_FIELD_MESSAGE }],
      });
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('rejects a request without allowed fields', async () => {
      const error = await service
        .updateCurrent(actor, {})
        .catch((e: unknown) => e);

      expect((error as BadRequestException).getResponse()).toEqual({
        statusCode: 400,
        errors: [{ field: 'body', message: NO_ORGANIZATION_FIELDS_MESSAGE }],
      });
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('returns 404 and saves nothing for a deleted organization', async () => {
      current = organizationRow({ deletedAt: new Date('2026-11-01') });

      await expect(
        service.updateCurrent(actor, { name: 'Drive' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('rejects an email used by another organization with 409', async () => {
      emailOwner = { id: 'org-2' };

      const error = await service
        .updateCurrent(actor, { email: 'taken@example.com' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        errors: [{ field: 'email', message: ORGANIZATION_EMAIL_TAKEN_MESSAGE }],
      });
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('does not check availability when the email is unchanged', async () => {
      await service.updateCurrent(actor, { email: 'INFO@stagedrive.ua' });

      expect(prisma.organization.findUnique).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'info@stagedrive.ua' } }),
      );
      expect(prisma.organization.update).toHaveBeenCalled();
    });

    it('returns 409 when another organization takes the email concurrently', async () => {
      prisma.organization.update.mockRejectedValueOnce(uniqueEmailError());

      await expect(
        service.updateCurrent(actor, { email: 'race@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows unexpected database errors', async () => {
      prisma.organization.update.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.updateCurrent(actor, { name: 'Drive' }),
      ).rejects.toThrow('db down');
    });

    describe('logo', () => {
      let root: string;
      let cwd: jest.SpyInstance<string, []>;

      beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'organization-logo-'));
        await mkdir(join(root, 'uploads', 'logos'), { recursive: true });
        cwd = jest.spyOn(process, 'cwd').mockReturnValue(root);
      });

      afterEach(async () => {
        cwd.mockRestore();
        await rm(root, { recursive: true, force: true });
      });

      async function storedLogo(name: string): Promise<string> {
        await writeFile(join(root, 'uploads', 'logos', name), 'image');
        return `/uploads/logos/${name}`;
      }

      function onDisk(url: string): boolean {
        return existsSync(join(root, url.replace(/^\//, '')));
      }

      it('saves the new logo and then removes the previous file', async () => {
        const previous = await storedLogo('org-1-old.png');
        const next = await storedLogo('org-1-new.png');
        current = organizationRow({ logoUrl: previous });

        const result = await service.updateCurrent(actor, {}, next);

        expect(prisma.organization.update).toHaveBeenCalledWith({
          where: { id: 'org-1' },
          data: { logoUrl: next },
        });
        expect(result.logoUrl).toBe(next);
        expect(onDisk(next)).toBe(true);
        expect(onDisk(previous)).toBe(false);
      });

      it('keeps the previous logo when saving fails', async () => {
        const previous = await storedLogo('org-1-old.png');
        const next = await storedLogo('org-1-new.png');
        current = organizationRow({ logoUrl: previous });
        prisma.organization.update.mockRejectedValueOnce(new Error('db down'));

        await expect(service.updateCurrent(actor, {}, next)).rejects.toThrow(
          'db down',
        );
        expect(onDisk(previous)).toBe(true);
      });

      it('keeps the logo when only text fields change', async () => {
        const previous = await storedLogo('org-1-old.png');
        current = organizationRow({ logoUrl: previous });

        await service.updateCurrent(actor, { name: 'Drive' });

        expect(onDisk(previous)).toBe(true);
      });
    });
  });
});
