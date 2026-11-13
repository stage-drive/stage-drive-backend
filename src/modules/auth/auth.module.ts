import { Module, OnModuleInit } from '@nestjs/common';
import { validateAuthSecret } from './auth-secret';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOAuthConfig } from './google-oauth.config';
import { GoogleOidcClient } from './google-oidc.client';
import { RefreshTokenService } from './refresh-token.service';
import { RolesGuard } from './roles.guard';
import { MailModule } from '../mail/mail.module';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    RolesGuard,
    GoogleOAuthConfig,
    GoogleOidcClient,
    GoogleAuthService,
    RefreshTokenService,
    PasswordResetService,
  ],
  exports: [AuthService, AuthGuard, RolesGuard, RefreshTokenService],
})
export class AuthModule implements OnModuleInit {
  /**
   * Fail fast: without this the API boots normally and every authenticated
   * request is answered with 401, because AuthGuard turns signing errors into
   * "Invalid access token".
   */
  onModuleInit(): void {
    validateAuthSecret(process.env.AUTH_SECRET);
  }
}
