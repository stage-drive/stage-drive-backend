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
      'Це не API для фронта і не для Postman/Swagger Try it out. Google сам ' +
      'відкриває цей URL після згоди (code + state). Без валідного одноразового ' +
      'state з GET /api/auth/google відповідь буде 401. Новий Google-акаунт ' +
      'без існуючого користувача (Owner або запрошений email) — 403. Якщо задано ' +
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
      'Немає code/state, прострочений/чужий state, або Google відхилив обмін коду.',
  })
  @ApiForbiddenResponse({
    description:
      'Немає користувача з цим email (не Owner і не запрошений), або акаунт заблоковано.',
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
