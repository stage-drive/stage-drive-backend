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
  ApiOkResponse,
  ApiOperation,
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
  })
  async startGoogle(@Req() request: Request) {
    const userId = tryGetAccessTokenUserId(request.headers.authorization);
    const url = await this.googleAuthService.start(userId);
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Завершити вхід через Google' })
  @ApiOkResponse({ type: RegisterResponseDto })
  @ApiUnauthorizedResponse({ description: 'Не вдалося увійти через Google.' })
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
