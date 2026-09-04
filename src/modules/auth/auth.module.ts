import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOAuthConfig } from './google-oauth.config';
import { GoogleOidcClient } from './google-oidc.client';
import { RefreshTokenService } from './refresh-token.service';
import { RolesGuard } from './roles.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    RolesGuard,
    GoogleOAuthConfig,
    GoogleOidcClient,
    GoogleAuthService,
    RefreshTokenService,
  ],
  exports: [AuthService, AuthGuard, RolesGuard, RefreshTokenService],
})
export class AuthModule {}
