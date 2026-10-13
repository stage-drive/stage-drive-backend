import { frontendBaseUrl } from '../../common/config/frontend-url';

export function emailChangeConfirmUrl(token: string): string {
  return `${frontendBaseUrl()}/confirm-email?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type EmailContent = { subject: string; html: string; text: string };

export function buildEmailChangeConfirmEmail(confirmUrl: string): EmailContent {
  const url = escapeHtml(confirmUrl);

  const subject = 'Підтвердження нової email-адреси';
  const text = [
    'Ви запросили зміну email-адреси для входу в акаунт автошколи.',
    '',
    'Щоб підтвердити нову адресу, перейдіть за посиланням:',
    confirmUrl,
    '',
    'Посилання дійсне 24 години.',
    'Якщо ви не запитували зміну — просто проігноруйте цей лист.',
  ].join('\n');
  const html = `
    <p>Ви запросили зміну email-адреси для входу в акаунт автошколи.</p>
    <p>Щоб підтвердити нову адресу, перейдіть за посиланням:<br />
    <a href="${url}">${url}</a></p>
    <p>Посилання дійсне 24 години.</p>
    <p>Якщо ви не запитували зміну — просто проігноруйте цей лист.</p>
  `.trim();

  return { subject, html, text };
}

export function buildEmailChangedNotice(newEmail: string): EmailContent {
  const email = escapeHtml(newEmail);

  const subject = 'Email вашого акаунта змінено';
  const text = [
    `Email для входу у ваш акаунт змінено на ${newEmail}.`,
    '',
    'Якщо це були не ви — негайно зверніться до адміністратора автошколи.',
  ].join('\n');
  const html = `
    <p>Email для входу у ваш акаунт змінено на <strong>${email}</strong>.</p>
    <p>Якщо це були не ви — негайно зверніться до адміністратора автошколи.</p>
  `.trim();

  return { subject, html, text };
}
