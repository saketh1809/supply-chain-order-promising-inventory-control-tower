import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createTestContext, resetDatabase, TestContext } from './helpers';
import { hashPassword } from '../../src/auth/password.util';

const EMAIL = 'planner@test.local';
const PASSWORD = 'Correct-Horse-9';

describe('Authentication: JWT access + rotating refresh tokens (integration)', () => {
  let ctx: TestContext;
  const login = (email = EMAIL, password = PASSWORD) => ctx.anon.post('/api/v1/auth/login').send({ email, password });
  const refresh = (refreshToken: string) => ctx.anon.post('/api/v1/auth/refresh').send({ refreshToken });

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.prisma.user.update({ where: { id: 1 }, data: { passwordHash: await hashPassword(PASSWORD) } });
  });

  it('rejects requests without a token and keeps /health public', async () => {
    const res = await ctx.anon.get('/api/v1/settings');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_MISSING');
    expect((await ctx.anon.get('/api/v1/health')).status).toBe(200);
    // The old demo header no longer authenticates anyone.
    expect((await ctx.anon.get('/api/v1/settings').set('x-user-id', '1')).status).toBe(401);
  });

  it('stores only a bcrypt hash of the password', async () => {
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: 1 } });
    expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('logs in with valid credentials and the access token opens protected routes', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const { accessToken, refreshToken, expiresIn, user } = res.body.data;
    expect(expiresIn).toBe(900);
    expect(user).toEqual({ id: 1, email: EMAIL, name: 'Test Planner', role: 'PLANNER' });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const me = await ctx.anon.get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(1);
    expect((await ctx.anon.get('/api/v1/settings').set('Authorization', `Bearer ${accessToken}`)).status).toBe(200);

    // A refresh token must not work as an access token.
    const misuse = await ctx.anon.get('/api/v1/settings').set('Authorization', `Bearer ${refreshToken}`);
    expect(misuse.status).toBe(401);
    expect(misuse.body.error.code).toBe('TOKEN_INVALID');
  });

  it('the refresh token is stored hashed, never in clear text', async () => {
    const { refreshToken } = (await login()).body.data;
    const rows = await ctx.prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].tokenHash).not.toBe(refreshToken);
  });

  it('gives the same answer for a wrong password and an unknown e-mail', async () => {
    const wrong = await login(EMAIL, 'nope-nope-nope');
    const unknown = await login('nobody@test.local', PASSWORD);
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    }
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('cannot sign in a user that has no password yet', async () => {
    const res = await login('support@test.local', PASSWORD);
    expect(res.status).toBe(401);
  });

  it('rejects expired, tampered and wrongly signed access tokens', async () => {
    const jwt = ctx.app.get(JwtService);
    const secret = ctx.app.get(ConfigService).get('jwt').accessSecret as string;
    const expired = jwt.sign({ sub: 1, role: 'PLANNER', typ: 'access' }, { secret, expiresIn: -10 });
    const r1 = await ctx.anon.get('/api/v1/settings').set('Authorization', `Bearer ${expired}`);
    expect([r1.status, r1.body.error.code]).toEqual([401, 'TOKEN_EXPIRED']);

    const forged = jwt.sign({ sub: 1, role: 'ADMIN', typ: 'access' }, { secret: 'attacker-secret-attacker-secret-0000', expiresIn: 60 });
    const r2 = await ctx.anon.get('/api/v1/settings').set('Authorization', `Bearer ${forged}`);
    expect([r2.status, r2.body.error.code]).toEqual([401, 'TOKEN_INVALID']);

    const good = jwt.sign({ sub: 1, role: 'PLANNER', typ: 'access' }, { secret, expiresIn: 60 });
    const tampered = good.slice(0, -3) + (good.endsWith('AAA') ? 'BBB' : 'AAA');
    const r3 = await ctx.anon.get('/api/v1/settings').set('Authorization', `Bearer ${tampered}`);
    expect([r3.status, r3.body.error.code]).toEqual([401, 'TOKEN_INVALID']);
  });

  it('rotates the refresh token on every use', async () => {
    const first = (await login()).body.data;
    const res = await refresh(first.refreshToken);
    expect(res.status).toBe(200);
    const second = res.body.data;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).toBeTruthy();
    // Both rows belong to one session (family); the first is revoked, the second is live.
    const rows = await ctx.prisma.refreshToken.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].familyId).toBe(rows[1].familyId);
    expect(rows[0].revokedAt).not.toBeNull();
    expect(rows[1].revokedAt).toBeNull();
    expect((await refresh(second.refreshToken)).status).toBe(200);
  });

  it('detects a replayed (stolen) refresh token and revokes the whole session', async () => {
    const first = (await login()).body.data;
    const second = (await refresh(first.refreshToken)).body.data;
    // Pretend the first token was rotated a minute ago (outside the double-click grace window).
    await ctx.prisma.refreshToken.updateMany({ where: { revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });

    const replay = await refresh(first.refreshToken);
    expect([replay.status, replay.body.error.code]).toEqual([401, 'REFRESH_REUSED']);
    // The legitimate holder of the newest token is signed out too.
    expect((await refresh(second.refreshToken)).status).toBe(401);
    const audit = await ctx.prisma.auditLog.count({ where: { action: 'REFRESH_TOKEN_REUSE_DETECTED' } });
    expect(audit).toBe(1);
  });

  it('tolerates a double refresh within the grace window without logging the user out', async () => {
    const first = (await login()).body.data;
    const second = (await refresh(first.refreshToken)).body.data;
    const again = await refresh(first.refreshToken); // e.g. two browser tabs at once
    expect([again.status, again.body.error.code]).toEqual([401, 'REFRESH_REUSED']);
    expect((await refresh(second.refreshToken)).status).toBe(200);
  });

  it('only one of several simultaneous refreshes with the same token succeeds', async () => {
    const { refreshToken } = (await login()).body.data;
    const results = await Promise.all(Array.from({ length: 5 }, () => refresh(refreshToken)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(4);
  });

  it('refuses an expired refresh token', async () => {
    const { refreshToken } = (await login()).body.data;
    await ctx.prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await refresh(refreshToken);
    expect([res.status, res.body.error.code]).toEqual([401, 'REFRESH_INVALID']);
  });

  it('logout revokes the session and is idempotent', async () => {
    const { refreshToken } = (await login()).body.data;
    expect((await ctx.anon.post('/api/v1/auth/logout').send({ refreshToken })).status).toBe(200);
    expect((await refresh(refreshToken)).status).toBe(401);
    expect((await ctx.anon.post('/api/v1/auth/logout').send({ refreshToken })).status).toBe(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'LOGOUT' } })).toBe(1);
  });

  it('records the signed-in user on audit entries (no spoofing through headers)', async () => {
    const { accessToken } = (await login()).body.data;
    const res = await ctx.anon
      .post('/api/v1/skus')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-user-id', '2')
      .send({ skuCode: 'SKU-AUTH', name: 'Auth test' });
    expect(res.status).toBe(201);
    const entry = await ctx.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'Sku' }, orderBy: { id: 'desc' } });
    expect(entry.userId).toBe(1);
  });

  it('changes the password, revokes every session and requires the new password', async () => {
    const { accessToken, refreshToken } = (await login()).body.data;
    const auth = { Authorization: `Bearer ${accessToken}` };

    const wrong = await ctx.anon.post('/api/v1/auth/change-password').set(auth).send({ currentPassword: 'bad-password', newPassword: 'Brand-New-Pass-1' });
    expect([wrong.status, wrong.body.error.code]).toEqual([422, 'WRONG_PASSWORD']);
    const short = await ctx.anon.post('/api/v1/auth/change-password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(short.status).toBe(400);

    const ok = await ctx.anon.post('/api/v1/auth/change-password').set(auth).send({ currentPassword: PASSWORD, newPassword: 'Brand-New-Pass-1' });
    expect(ok.status).toBe(200);
    expect((await refresh(refreshToken)).status).toBe(401);
    expect((await login()).status).toBe(401);
    expect((await login(EMAIL, 'Brand-New-Pass-1')).status).toBe(200);
  });

  it('rate limits repeated login attempts for the same account', async () => {
    const previous = process.env.AUTH_RATE_LIMIT;
    process.env.AUTH_RATE_LIMIT = '10';
    const limited = await createTestContext();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        statuses.push((await limited.anon.post('/api/v1/auth/login').send({ email: 'victim@test.local', password: `guess-number-${i}` })).status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      // A different account is not affected.
      const other = await limited.anon.post('/api/v1/auth/login').send({ email: 'someone-else@test.local', password: 'whatever-it-is' });
      expect(other.status).toBe(401);
    } finally {
      process.env.AUTH_RATE_LIMIT = previous;
      if (previous === undefined) delete process.env.AUTH_RATE_LIMIT;
      await limited.close();
    }
  });
});
