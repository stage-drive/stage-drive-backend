import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SendMailDto {
  @IsEmail()
  to: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  html: string;
}