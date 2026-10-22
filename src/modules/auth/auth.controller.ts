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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
  CheckEmailDto,
  EmailAvailabilityResponseDto,
  GoogleIdTokenDto,
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RegisterDto,
  RegisterResponseDto,
  RegistrationFieldsValidationResponseDto,
  ValidateRegistrationFieldsDto,
} from './auth.dto';
import { EMAIL_ALREADY_EXISTS_MESSAGE } from './auth.service';
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
  @ApiOperation({
    operationId: 'registerDrivingSchool',
    summary: 'Зареєструвати автошколу',
    description:
      'Створює організацію і власника. Окремі поля можна перевірити до цього запиту: ' +
      'POST /api/auth/register/check-email і POST /api/auth/register/validate.',
  })
  @ApiOkResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({
    description:
      'Некоректне або порожнє поле. Тіло містить errors: [{ field, message }].',
  })
  @ApiConflictResponse({
    description:
      'Email уже зайнятий. Тіло містить errors: [{ field: email, message }].',
    schema: {
      example: {
        statusCode: 409,
        errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
      },
    },
  })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('register/check-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'checkRegistrationEmail',
    summary: 'Перевірити email перед реєстрацією автошколи',
    description:
      'Для поля email на формі UF01-03. Фронтенд викликає запит, коли адреса введена ' +
      'і фокус пішов з поля, ще до пароля і кнопки «Зареєструватись». ' +
      'Авторизація не потрібна. Адреса порівнюється так само, як при реєстрації: ' +
      'пробіли по краях прибираються, регістр ігнорується. Зайнятим вважається email ' +
      'існуючого користувача або автошколи, включно з видаленим акаунтом: ' +
      'унікальний індекс однаково не дасть створити школу. ' +
      '200 і available: true означає, що формат коректний і email вільний.',
  })
  @ApiOkResponse({ type: EmailAvailabilityResponseDto })
  @ApiBadRequestResponse({
    description:
      'Порожній або некоректний email. ' +
      "Порожнє поле: «Заповніть обов'язкове поле.» " +
      'Некоректний формат: «Введіть коректний email.» ' +
      'Тіло: { statusCode: 400, errors: [{ field: email, message }] }.',
    schema: {
      example: {
        statusCode: 400,
        errors: [{ field: 'email', message: 'Введіть коректний email.' }],
      },
    },
  })
  @ApiConflictResponse({
    description:
      'Акаунт або автошкола з таким email уже є. ' +
      'Тіло: { statusCode: 409, errors: [{ field: email, message }] }.',
    schema: {
      example: {
        statusCode: 409,
        errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
      },
    },
  })
  async checkRegistrationEmail(@Body() body: CheckEmailDto) {
    await this.authService.assertEmailAvailable(body.email);
    return { available: true };
  }

  @Post('register/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'validateRegistrationFields',
    summary: 'Перевірити окремі поля реєстрації автошколи',
    description:
      'Ті самі правила, що в POST /api/auth/register, але лише для полів, які є в тілі. ' +
      'Викликайте після виходу з конкретного поля і передавайте тільки його. ' +
      'organizationName, firstName, lastName: обов’язкові, без символів < і >. ' +
      'email: формат і зайнятість (409, якщо адреса вже є) — те саме, що check-email. ' +
      'phone: необов’язковий. null без помилки; непорожній рядок дає ' +
      '«Введіть коректний номер телефону.», якщо формат некоректний. ' +
      'password: щонайменше 8 символів, велика і мала літера, цифра та спецсимвол. ' +
      'passwordConfirmation: передавайте разом із password, інакше паролі не збігаються. ' +
      'termsAccepted: лише true. Порожнє тіло — 400. Авторизація не потрібна. ' +
      '200 і valid: true означає, що передані поля коректні.',
  })
  @ApiOkResponse({ type: RegistrationFieldsValidationResponseDto })
  @ApiBadRequestResponse({
    description:
      'Передане поле не пройшло ту саму перевірку, що й реєстрація, або тіло порожнє. ' +
      'Тіло: { statusCode: 400, errors: [{ field, message }] }. ' +
      'field збігається з ім’ям поля форми.',
    schema: {
      example: {
        statusCode: 400,
        errors: [
          { field: 'phone', message: 'Введіть коректний номер телефону.' },
        ],
      },
    },
  })
  @ApiConflictResponse({
    description:
      'У тілі є email, і він уже зайнятий. ' +
      'Тіло: { statusCode: 409, errors: [{ field: email, message }] }.',
    schema: {
      example: {
        statusCode: 409,
        errors: [{ field: 'email', message: EMAIL_ALREADY_EXISTS_MESSAGE }],
      },
    },
  })
  async validateRegistrationFields(
    @Body() body: ValidateRegistrationFieldsDto,
  ) {
    return this.authService.validateRegistrationFields(body);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@Body() body: RefreshTokenDto) {
    await this.refreshTokenService.logout(body.refreshToken);
    return { message: 'Ви вийшли з системи.' };
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
