import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Actor } from '../common/actor/actor.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto } from './auth.dto';
import { Public } from './public.decorator';
import { AuthThrottlerGuard } from './auth-throttler.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto.email, dto.password, ua);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Headers('user-agent') ua?: string) {
    return this.auth.refresh(dto.refreshToken, ua);
  }

  /** Public on purpose: a user whose access token has already expired must still be able to sign out. */
  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { loggedOut: true };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@Actor() userId: number) {
    return this.auth.me(userId);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('change-password')
  async changePassword(@Body() dto: ChangePasswordDto, @Actor() userId: number) {
    await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
    return { changed: true };
  }
}
