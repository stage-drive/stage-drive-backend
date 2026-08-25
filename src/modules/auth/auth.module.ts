import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOAuthConfig } from './google-oauth.config';
import { GoogleOidcClient } from './google-oidc.client';
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
  ],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
