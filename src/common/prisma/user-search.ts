import { Prisma } from '@prisma/client';

function contains(value: string): Prisma.StringFilter {
  return { contains: value, mode: 'insensitive' };
}

/**
 * Пошук людини за ім'ям, прізвищем, email, телефоном або «Ім'я Прізвище»
 * (у будь-якому порядку). Спільний для списку студентів і оплат.
 */
export function searchConditions(search: string): Prisma.UserWhereInput[] {
  const conditions: Prisma.UserWhereInput[] = [
    { firstName: contains(search) },
    { lastName: contains(search) },
    { email: contains(search) },
    { phone: contains(search) },
  ];

  const parts = search.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const rest = parts.slice(1).join(' ');
    conditions.push(
      {
        AND: [{ firstName: contains(first) }, { lastName: contains(rest) }],
      },
      {
        AND: [{ firstName: contains(rest) }, { lastName: contains(first) }],
      },
    );
  }

  return conditions;
}
