import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class PublicOrganizationDto {
  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111' })
  id: string;

  @ApiProperty({ example: 'Stage Drive School' })
  name: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  logoUrl: string | null;

  @ApiProperty({ example: 'Europe/Kyiv' })
  timezone: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'Автошкола Drive' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;
}
