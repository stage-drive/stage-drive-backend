import { User } from '@prisma/client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  const notifications = {
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
  };
  const controller = new NotificationsController(
    notifications as unknown as NotificationsService,
  );
  const user = { id: 'user-1', organizationId: 'org-1' } as User;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the current user notifications', async () => {
    const query = { page: 1 };
    notifications.list.mockResolvedValue({ items: [] });

    await expect(controller.list(user, query)).resolves.toEqual({ items: [] });
    expect(notifications.list).toHaveBeenCalledWith(user, query);
  });

  it('returns the unread count', async () => {
    notifications.unreadCount.mockResolvedValue({ count: 2 });

    await expect(controller.unreadCount(user)).resolves.toEqual({ count: 2 });
    expect(notifications.unreadCount).toHaveBeenCalledWith(user);
  });

  it('marks a notification read', async () => {
    notifications.markRead.mockResolvedValue({ id: 'n-1' });

    await expect(controller.markRead(user, 'n-1')).resolves.toEqual({
      id: 'n-1',
    });
    expect(notifications.markRead).toHaveBeenCalledWith(user, 'n-1');
  });
});
