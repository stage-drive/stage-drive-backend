import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicOrganizationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  logoUrl: string | null;

  @ApiProperty()
  timezone: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  name?: string;
}
