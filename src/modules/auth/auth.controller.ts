import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Redirect,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LoginResponseDto,
  RegisterDto,
  RegisterResponseDto,
} from './auth.dto';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOAuthConfig } from './google-oauth.config';
import { tryGetAccessTokenUserId } from './token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly googleOAuthConfig: GoogleOAuthConfig,
  ) {}

  @Post('login')
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Невірний email або пароль' })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email ?? '', body.password ?? '');
  }

  @Post('register')
  @ApiOkResponse({ type: RegisterResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Get('google')
  @Redirect()
  @ApiOperation({
    summary: 'Почати вхід через Google (OAuth 2.0 Authorization Code + PKCE)',
    description:
      '302 на сторінку згоди Google. У браузері відкривайте цей URL напряму ' +
      '(window.location), а не через fetch/axios — інакше редірект на Google ' +
      'блокується CORS. Для прив’язки Google до поточного акаунта передайте Bearer access token.',
  })
  @ApiBearerAuth()
  @ApiFoundResponse({
    description: 'Перенаправлення на accounts.google.com (заголовок Location).',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Вхід через Google не налаштовано (немає GOOGLE_* у середовищі).',
  })
  async startGoogle(@Req() request: Request) {
    const userId = tryGetAccessTokenUserId(request.headers.authorization);
    const url = await this.googleAuthService.start(userId);
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Get('google/callback')
  @ApiOperation({
    summary: 'Завершити вхід через Google',
    description:
      'Google викликає цей URL після згоди. Не викликайте з фронтенду самостійно.',
  })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  @ApiOkResponse({ type: RegisterResponseDto })
  @ApiFoundResponse({
    description:
      'Якщо задано GOOGLE_OAUTH_SUCCESS_REDIRECT — 302 на фронт із токенами в hash.',
  })
  @ApiUnauthorizedResponse({ description: 'Не вдалося увійти через Google.' })
  @ApiServiceUnavailableResponse({
    description: 'Вхід через Google не налаштовано.',
  })
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.googleAuthService.complete({
      code,
      state,
      error,
    });

    if (this.googleOAuthConfig.successRedirect) {
      const url = new URL(this.googleOAuthConfig.successRedirect);
      url.hash = new URLSearchParams({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      }).toString();
      response.redirect(url.toString());
      return;
    }

    return session;
  }
}
