import { User } from '@prisma/client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  const notifications = {
    list: jest.fn(),
    unreadCount: jest.fn(),
    markRead: jest.fn(),
    markUnread: jest.fn(),
    markAllRead: jest.fn(),
    target: jest.fn(),
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
    notifications.markRead.mockResolvedValue({ id: 'n-1', unreadCount: 1 });

    await expect(controller.markRead(user, 'n-1')).resolves.toEqual({
      id: 'n-1',
      unreadCount: 1,
    });
    expect(notifications.markRead).toHaveBeenCalledWith(user, 'n-1');
  });

  it('marks a notification unread', async () => {
    notifications.markUnread.mockResolvedValue({ id: 'n-1', unreadCount: 2 });

    await expect(controller.markUnread(user, 'n-1')).resolves.toEqual({
      id: 'n-1',
      unreadCount: 2,
    });
    expect(notifications.markUnread).toHaveBeenCalledWith(user, 'n-1');
  });

  it('marks every notification of the current user as read', async () => {
    notifications.markAllRead.mockResolvedValue({ updated: 2, unreadCount: 0 });

    await expect(controller.markAllRead(user)).resolves.toEqual({
      updated: 2,
      unreadCount: 0,
    });
    expect(notifications.markAllRead).toHaveBeenCalledWith(user);
  });

  it('returns the related entity of the current user notification', async () => {
    notifications.target.mockResolvedValue({ type: 'PAYMENT', id: 'pay-1' });

    await expect(controller.target(user, 'n-1')).resolves.toEqual({
      type: 'PAYMENT',
      id: 'pay-1',
    });
    expect(notifications.target).toHaveBeenCalledWith(user, 'n-1');
  });
});
