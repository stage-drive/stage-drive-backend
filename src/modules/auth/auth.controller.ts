import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Redirect,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
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
  GoogleIdTokenDto,
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RegisterDto,
  RegisterResponseDto,
} from './auth.dto';
import { GoogleAuthService } from './google-auth.service';
import { GoogleOAuthConfig } from './google-oauth.config';
import { PasswordResetService } from './password-reset.service';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './password-reset.dto';
import { RefreshTokenService } from './refresh-token.service';
import { tryGetAccessTokenUserId } from './token';
import { MessageResponseDto } from '../users/users.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleAuthService: GoogleAuthService,
    private readonly googleOAuthConfig: GoogleOAuthConfig,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Невірний email або пароль (Invalid credentials).',
  })
  @ApiForbiddenResponse({
    description:
      'Користувача знайдено, але доступ заборонено: акаунт заблоковано/архівовано або організація заблокована.',
  })
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email ?? '', body.password ?? '');
  }

  @Post('register')
  @ApiOkResponse({ type: RegisterResponseDto })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    description:
      'Refresh token недійсний, прострочений або вже був використаний.',
  })
  async refresh(@Body() body: RefreshTokenDto) {
    return this.refreshTokenService.rotate(body.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async forgotPassword(@Body() body: RequestPasswordResetDto) {
    return this.passwordResetService.requestPasswordReset(body.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiUnauthorizedResponse({
    description:
      'Посилання для скидання пароля недійсне, прострочене або вже використане.',
  })
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.passwordResetService.resetPassword(body.token, body.password);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Увійти через Google ID token',
    description:
      'Для Postman і Google Identity Services: передайте валідний Google idToken. ' +
      'Користувач не створюється автоматично — email з токена має вже існувати ' +
      '(ACTIVE або INVITED). BLOCKED/ARCHIVED → 403. ' +
      'GET /api/auth/google — окремий браузерний Authorization Code + PKCE flow; ' +
      'його не можна пройти через Postman через redirect_uri.',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    description:
      'idToken відсутній, прострочений або не підписаний Google, ' +
      'або немає користувача з цим email.',
  })
  @ApiForbiddenResponse({
    description: 'Акаунт заблоковано або архівовано.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Вхід через Google не налаштовано (немає GOOGLE_* у середовищі).',
  })
  async googleIdToken(@Body() body: GoogleIdTokenDto, @Req() request: Request) {
    const userId = tryGetAccessTokenUserId(request.headers.authorization);
    return this.googleAuthService.completeWithIdToken(body.idToken, userId);
  }

  @Get('google')
  @Redirect()
  @ApiOperation({
    summary: 'Почати вхід через Google (OAuth 2.0 Authorization Code + PKCE)',
    description:
      'Це браузерний flow, не Postman. Відкрийте URL у браузері (window.location). ' +
      'redirect_uri_mismatch означає, що GOOGLE_REDIRECT_URI на сервері не збігається ' +
      'з Authorized redirect URI в Google Cloud Console ' +
      '(має бути {BACKEND_URL}/api/auth/google/callback). ' +
      'Для Postman використовуйте POST /api/auth/google з idToken. ' +
      'Для прив’язки Google до поточного акаунта передайте Bearer access token.',
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
      'Це не API для фронта і не для Postman/Swagger Try it out. Google сам ' +
      'відкриває цей URL після згоди (code + state). Без валідного одноразового ' +
      'state з GET /api/auth/google відповідь буде 401. Якщо Google-акаунт ' +
      'підтверджено, але в users немає цього email — 401 «Акаунт не знайдено». ' +
      'Якщо задано ' +
      'GOOGLE_OAUTH_SUCCESS_REDIRECT — замість JSON буде 302 на фронт ' +
      '(токени в URL hash, не в query).',
  })
  @ApiQuery({
    name: 'code',
    required: false,
    description:
      'Authorization code від Google. Без нього (або з error) — 401.',
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description:
      'Одноразовий state, виданий у GET /api/auth/google і збережений у БД.',
  })
  @ApiQuery({
    name: 'error',
    required: false,
    description:
      'Якщо користувач відхилив згоду, Google передає error=access_denied.',
  })
  @ApiOkResponse({
    type: RegisterResponseDto,
    description:
      'Сесія JSON. Лише якщо GOOGLE_OAUTH_SUCCESS_REDIRECT не задано.',
  })
  @ApiFoundResponse({
    description:
      'GOOGLE_OAUTH_SUCCESS_REDIRECT задано: Location на фронт, токени в hash ' +
      '(#accessToken=...&refreshToken=...).',
  })
  @ApiUnauthorizedResponse({
    description:
      'Немає code/state, прострочений/чужий state, Google відхилив обмін коду, ' +
      'або немає користувача з email з Google (Акаунт не знайдено).',
  })
  @ApiForbiddenResponse({
    description: 'Акаунт заблоковано або архівовано.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Немає GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET у середовищі.',
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
