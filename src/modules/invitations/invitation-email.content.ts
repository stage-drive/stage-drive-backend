import { UserRole } from '@prisma/client';

const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

const ROLE_TITLE_UK: Record<UserRole, string> = {
  [UserRole.OWNER]: 'власником',
  [UserRole.ADMIN]: 'адміністратором',
  [UserRole.TEACHER]: 'викладачем',
  [UserRole.INSTRUCTOR]: 'інструктором',
  [UserRole.STUDENT]: 'учнем',
};

function frontendBaseUrl(): string {
  const fromEnv = (
    process.env.FRONTEND_URL ??
    process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT ??
    DEFAULT_FRONTEND_URL
  ).trim();
  return (fromEnv || DEFAULT_FRONTEND_URL).replace(/\/$/, '');
}

export function invitationAcceptUrl(token: string): string {
  return `${frontendBaseUrl()}/invite?token=${encodeURIComponent(token)}`;
}

export function invitationRoleTitle(role: UserRole): string {
  return ROLE_TITLE_UK[role];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInvitationEmail(input: {
  firstName: string;
  organizationName: string;
  inviterName: string;
  roleTitle: string;
  acceptUrl: string;
  expiresAt: Date;
}): { subject: string; html: string; text: string } {
  const firstName = escapeHtml(input.firstName);
  const organizationName = escapeHtml(input.organizationName);
  const inviterName = escapeHtml(input.inviterName);
  const roleTitle = escapeHtml(input.roleTitle);
  const acceptUrl = escapeHtml(input.acceptUrl);
  const expiresAt = input.expiresAt.toLocaleString('uk-UA', {
    timeZone: 'Europe/Kyiv',
  });
  const expiresAtHtml = escapeHtml(expiresAt);

  const subject = `Запрошення стати ${input.roleTitle} — ${input.organizationName}`;
  const text = [
    `Вітаємо, ${input.firstName}!`,
    '',
    `${input.inviterName} запрошує вас стати ${input.roleTitle} автошколи «${input.organizationName}».`,
    '',
    'Щоб прийняти запрошення, перейдіть за посиланням:',
    input.acceptUrl,
    '',
    `Посилання дійсне до ${expiresAt}.`,
  ].join('\n');
  const html = `
<p>Вітаємо, ${firstName}!</p>
<p>${inviterName} запрошує вас стати ${roleTitle} автошколи «${organizationName}».</p>
<p>Щоб прийняти запрошення, перейдіть за посиланням:<br />
<a href="${acceptUrl}">${acceptUrl}</a></p>
<p>Посилання дійсне до ${expiresAtHtml}.</p>
`.trim();

  return { subject, html, text };
}
