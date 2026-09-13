process.env.AUTH_SECRET ??= 'test-auth-secret';
process.env.DATABASE_URL ??=
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI ??=
  'http://localhost:3000/api/auth/google/callback';
delete process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT;
process.env.MAIL_HOST ??= 'smtp.example.com';
process.env.MAIL_PORT ??= '587';
process.env.MAIL_USER ??= 'test@example.com';
process.env.MAIL_PASSWORD ??= 'test-password';
process.env.MAIL_FROM ??= 'test@example.com';
process.env.FRONTEND_URL ??= 'http://localhost:5173';
