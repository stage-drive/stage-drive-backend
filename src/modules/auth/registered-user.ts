import { User } from '@prisma/client';

export function toRegisteredUser(user: User) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    organizationId: user.organizationId,
  };
}
