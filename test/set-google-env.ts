process.env.AUTH_SECRET ??= 'test-auth-secret';
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI ??=
  'http://localhost:3000/api/auth/google/callback';
delete process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT;
