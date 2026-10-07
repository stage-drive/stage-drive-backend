import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

describe('GroupsController', () => {
  it('applies AuthGuard and RolesGuard to the whole controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GroupsController)).toEqual([
      AuthGuard,
      RolesGuard,
    ]);
  });

  it('restricts the group list to ADMIN', () => {
    const roles = new Reflector().get<UserRole[]>(
      ROLES_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- only reads decorator metadata, never invoked
      GroupsController.prototype.list,
    );

    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('passes the current user to the service', async () => {
    const response = { groups: [] };
    const groupsService = { list: jest.fn().mockResolvedValue(response) };
    const controller = new GroupsController(
      groupsService as unknown as GroupsService,
    );
    const user = { id: 'admin-1', organizationId: 'org-1' };

    await expect(controller.list(user as never)).resolves.toBe(response);
    expect(groupsService.list).toHaveBeenCalledWith(user);
  });
});
