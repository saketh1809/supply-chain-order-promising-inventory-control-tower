import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_MIN } from './password.util';

export class LoginDto {
  @IsEmail() @MaxLength(255) email!: string;
  @IsString() @Length(1, PASSWORD_MAX) password!: string;
}

export class RefreshDto {
  @IsString() @Length(20, 2048) refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString() @Length(1, PASSWORD_MAX) currentPassword!: string;
  @IsString() @Length(PASSWORD_MIN, PASSWORD_MAX, { message: `newPassword must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters` })
  newPassword!: string;
}
