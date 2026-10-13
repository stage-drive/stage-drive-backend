import {
  buildEmailChangedNotice,
  emailChangeConfirmUrl,
} from './email-change.content';

describe('email-change content', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('builds the confirm link from FRONTEND_URL and encodes the token', () => {
    process.env.FRONTEND_URL = 'https://app.example.com/';

    expect(emailChangeConfirmUrl('a+b/c')).toBe(
      'https://app.example.com/confirm-email?token=a%2Bb%2Fc',
    );
  });

  it('escapes the new email in the notice HTML', () => {
    const notice = buildEmailChangedNotice('"><script>@example.com');

    expect(notice.html).not.toContain('<script>');
    expect(notice.html).toContain('&quot;&gt;&lt;script&gt;@example.com');
  });
});
