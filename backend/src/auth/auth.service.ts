import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api/api-error';
import { AppConfig } from '../common/config/configuration';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.util';
import type { AccessTokenPayload } from './jwt-auth.guard';

/** A refresh token that was already rotated may be presented again within this window (two tabs
 *  refreshing at the same moment). After it, a repeat is treated as theft and the chain is revoked. */
const REUSE_GRACE_MS = 10_000;

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'PLANNER' | 'SUPPORT' | 'ADMIN';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: AuthUser;
}

interface RefreshPayload {
  sub: number;
  fam: string;
  jti: string;
  typ: 'refresh';
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly jwtConfig: AppConfig['jwt'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.jwtConfig = config.get('jwt', { infer: true });
  }

  /** Signs a short-lived access token. Also used by the integration tests. */
  signAccessToken(user: Pick<AuthUser, 'id' | 'role'>): string {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, typ: 'access' };
    return this.jwt.sign(payload, { secret: this.jwtConfig.accessSecret, expiresIn: this.jwtConfig.accessTtlSeconds, algorithm: 'HS256' });
  }

  async login(email: string, password: string, userAgent?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Always run bcrypt, even for unknown users, so response time does not reveal which e-mails exist.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) {
      throw ApiError.unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
    }
    const pair = await this.prisma.transact(async (tx) => {
      const issued = await this.issue(tx, user, randomUUID(), userAgent);
      await this.audit.record(tx, { userId: user.id, entityType: 'User', entityId: user.id, action: 'LOGIN', reason: 'Signed in' });
      return issued;
    });
    // Housekeeping: drop tokens that expired more than a day ago.
    void this.prisma.refreshToken
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } })
      .catch((e) => this.logger.warn(`Token cleanup failed: ${e instanceof Error ? e.message : e}`));
    return pair;
  }

  /** Exchanges a valid refresh token for a new pair. The presented token is revoked (rotation). */
  async refresh(refreshToken: string, userAgent?: string): Promise<TokenPair> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, { secret: this.jwtConfig.refreshSecret, algorithms: ['HS256'] });
      if (payload.typ !== 'refresh') throw new Error('wrong token type');
    } catch {
      throw ApiError.unauthorized('Your session expired. Sign in again.', 'REFRESH_INVALID');
    }

    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!row || row.userId !== payload.sub || row.expiresAt <= new Date()) {
      throw ApiError.unauthorized('Your session expired. Sign in again.', 'REFRESH_INVALID');
    }

    if (row.revokedAt) {
      // An already-used token came back. Either a harmless double refresh, or a stolen token.
      if (Date.now() - row.revokedAt.getTime() > REUSE_GRACE_MS) {
        await this.prisma.transact(async (tx) => {
          await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
          await this.audit.record(tx, { userId: row.userId, entityType: 'User', entityId: row.userId, action: 'REFRESH_TOKEN_REUSE_DETECTED', reason: 'A rotated refresh token was used again; the session was revoked' });
        });
        this.logger.warn(`Refresh token reuse detected for user ${row.userId}; family revoked`);
      }
      throw ApiError.unauthorized('Your session expired. Sign in again.', 'REFRESH_REUSED');
    }

    return this.prisma.transact(async (tx) => {
      // Conditional update: only one of several concurrent requests can flip revokedAt from NULL.
      const flipped = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (flipped.count !== 1) throw ApiError.unauthorized('Your session expired. Sign in again.', 'REFRESH_REUSED');
      return this.issue(tx, row.user, row.familyId, userAgent);
    });
  }

  /** Revokes the whole session (token family) the refresh token belongs to. Idempotent. */
  async logout(refreshToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row) return;
    await this.prisma.transact(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      if (revoked.count > 0) {
        await this.audit.record(tx, { userId: row.userId, entityType: 'User', entityId: row.userId, action: 'LOGOUT', reason: 'Signed out' });
      }
    });
  }

  async me(userId: number): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true } });
    if (!user) throw ApiError.unauthorized('Account no longer exists.', 'TOKEN_INVALID');
    return user;
  }

  /** Changes the password and signs the user out everywhere (all refresh tokens are revoked). */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw ApiError.unprocessable('WRONG_PASSWORD', 'The current password is not correct.');
    }
    if (currentPassword === newPassword) {
      throw ApiError.unprocessable('PASSWORD_UNCHANGED', 'Choose a password that is different from the current one.');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.transact(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, { userId, entityType: 'User', entityId: userId, action: 'PASSWORD_CHANGED', reason: 'Password changed; all sessions revoked' });
    });
  }

  /** Creates the access/refresh pair and stores the refresh token's hash. */
  private async issue(
    tx: Parameters<Parameters<PrismaService['transact']>[0]>[0],
    user: AuthUser & { passwordHash?: string | null },
    familyId: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const refreshPayload: RefreshPayload = { sub: user.id, fam: familyId, jti: randomUUID(), typ: 'refresh' };
    const refreshToken = this.jwt.sign(refreshPayload, { secret: this.jwtConfig.refreshSecret, expiresIn: this.jwtConfig.refreshTtlSeconds, algorithm: 'HS256' });
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.jwtConfig.refreshTtlSeconds * 1000),
        userAgent: userAgent?.slice(0, 255) ?? null,
      },
    });
    return {
      accessToken: this.signAccessToken(user),
      refreshToken,
      expiresIn: this.jwtConfig.accessTtlSeconds,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}
