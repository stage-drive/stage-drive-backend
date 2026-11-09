import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ImageContentPipe } from '../../common/files/image-content.pipe';
import {
  IMAGE_MAX_SIZE,
  imageFileFilter,
  imageStorage,
  publicUploadUrl,
} from '../../common/files/image-upload';
import { ImageUploadInterceptor } from '../../common/files/image-upload.interceptor';
import {
  ORGANIZATION_MANAGE_ROLES,
  OrganizationService,
} from './organization.service';
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  PublicOrganizationDto,
  UpdateOrganizationDto,
} from './organization.dto';

@ApiTags('organization')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Потрібен access token' })
@Controller('organization')
@UseGuards(AuthGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get()
  @ApiOperation({
    summary: 'Дані своєї автошколи',
    description:
      'Доступно всім ролям. Організація береться з облікового запису, ' +
      'тож дані іншої автошколи отримати неможливо.',
  })
  @ApiOkResponse({ type: PublicOrganizationDto })
  @ApiNotFoundResponse({ description: 'Автошколу не знайдено або видалено.' })
  getCurrent(@CurrentUser() user: User) {
    return this.organizationService.getCurrent(user);
  }

  @Patch()
  @ApiOperation({
    summary: 'Змінити налаштування своєї автошколи',
    description:
      'OWNER і ADMIN. Дозволені поля: name, email, phone, address і файл logo; ' +
      'інші поля (timezone, status, slug…) відхиляються. ' +
      'phone і address очищаються значенням null або порожнім рядком. ' +
      'Приймає JSON або multipart/form-data (для logo).',
  })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', maxLength: ORGANIZATION_NAME_MAX_LENGTH },
        email: { type: 'string', format: 'email' },
        phone: { type: 'string', nullable: true },
        address: { type: 'string', nullable: true },
        logo: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: PublicOrganizationDto })
  @ApiBadRequestResponse({
    description:
      'Невалідні поля, жодного дозволеного поля або недозволене поле в запиті.',
  })
  @ApiForbiddenResponse({ description: 'Роль не OWNER і не ADMIN.' })
  @ApiNotFoundResponse({ description: 'Автошколу не знайдено або видалено.' })
  @ApiConflictResponse({
    description: 'Email уже використовує інша автошкола.',
  })
  @ApiPayloadTooLargeResponse({ description: 'Логотип більший за 2 МБ.' })
  @UseGuards(RolesGuard)
  @Roles(...ORGANIZATION_MANAGE_ROLES)
  @UseInterceptors(
    new ImageUploadInterceptor('logo'),
    FileInterceptor('logo', {
      storage: imageStorage('logos', (req) => req.user?.organizationId),
      fileFilter: imageFileFilter,
      limits: { fileSize: IMAGE_MAX_SIZE },
    }),
  )
  updateCurrent(
    @CurrentUser() user: User,
    @Body() body: UpdateOrganizationDto,
    @UploadedFile(ImageContentPipe) file?: Express.Multer.File,
  ) {
    return this.organizationService.updateCurrent(
      user,
      body,
      file ? publicUploadUrl('logos', file.filename) : undefined,
    );
  }

  @Delete()
  @ApiOperation({
    summary: 'Видалити автошколу (soft delete)',
    description:
      'Лише OWNER. Після видалення ніхто з автошколи не входить у систему, ' +
      'а чинні токени перестають діяти.',
  })
  @ApiForbiddenResponse({ description: 'Роль не OWNER.' })
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteOrganization(@CurrentUser() user: User) {
    return this.organizationService.deleteOrganization(user);
  }
}
