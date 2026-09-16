import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SendMailDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  to: string;

  @ApiProperty({ example: 'Запрошення стати адміністратором' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiProperty({ example: '<p>Вітаємо!</p>' })
  @IsString()
  @IsNotEmpty()
  html: string;
}
