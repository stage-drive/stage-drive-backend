import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  RegisterDto,
  RegisterResponseDto,
} from './auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(@Body() { refreshToken }: RefreshTokenDto) {
    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() { refreshToken }: RefreshTokenDto) {
    return this.authService.logout(refreshToken);
  }
}
