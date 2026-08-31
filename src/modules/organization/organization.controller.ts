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
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  IMAGE_MAX_SIZE,
  imageFileFilter,
  imageStorage,
  publicUploadUrl,
} from '../../common/files/image-upload';
import { OrganizationService } from './organization.service';
import {
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
  @ApiOkResponse({ type: PublicOrganizationDto })
  getCurrent(@CurrentUser() user: User) {
    return this.organizationService.getCurrent(user);
  }

  @Patch()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        logo: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({ type: PublicOrganizationDto })
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: imageStorage('logos', (req) => req.user?.organizationId),
      fileFilter: imageFileFilter,
      limits: { fileSize: IMAGE_MAX_SIZE },
    }),
  )
  updateCurrent(
    @CurrentUser() user: User,
    @Body() body: UpdateOrganizationDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.organizationService.updateCurrent(
      user,
      body,
      file ? publicUploadUrl('logos', file.filename) : undefined,
    );
  }

  @Delete()
  @UseGuards(RolesGuard)
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteOrganization(@CurrentUser() user: User) {
    return this.organizationService.deleteOrganization(user);
  }
}
