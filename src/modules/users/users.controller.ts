import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  IMAGE_MAX_SIZE,
  imageFileFilter,
  imageStorage,
  publicUploadUrl,
} from '../../common/files/image-upload';
import { UsersService } from './users.service';
import {
  ChangePasswordDto,
  MessageResponseDto,
  PublicUserDto,
  UpdateProfileDto,
} from './users.dto';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOkResponse({ type: PublicUserDto })
  getMe(@CurrentUser() user: User) {
    return this.usersService.getMe(user);
  }

  @Patch('me')
  @ApiOkResponse({ type: PublicUserDto })
  updateMe(@CurrentUser() user: User, @Body() body: UpdateProfileDto) {
    return this.usersService.updateMe(user, body);
  }

  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: PublicUserDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageStorage('avatars'),
      fileFilter: imageFileFilter,
      limits: { fileSize: IMAGE_MAX_SIZE },
    }),
  )
  uploadAvatar(
    @CurrentUser() user: User,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.usersService.setAvatar(
      user,
      publicUploadUrl('avatars', file.filename),
    );
  }

  @Delete('me/avatar')
  @ApiOkResponse({ type: PublicUserDto })
  deleteAvatar(@CurrentUser() user: User) {
    return this.usersService.deleteAvatar(user);
  }

  @Patch('me/password')
  @ApiOkResponse({ type: MessageResponseDto })
  changePassword(@CurrentUser() user: User, @Body() body: ChangePasswordDto) {
    return this.usersService.changePassword(
      user,
      body.currentPassword ?? '',
      body.newPassword ?? '',
    );
  }

  @Post('me/email/change')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  changeEmail() {
    throw new HttpException('Поза MVP', HttpStatus.NOT_IMPLEMENTED);
  }

  @Post('me/email/verify')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  verifyEmail() {
    throw new HttpException('Поза MVP', HttpStatus.NOT_IMPLEMENTED);
  }
}
