import { PASSWORD_MIN } from '../src/auth/password.util';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

/**
 * Password given to the seeded demo users (stored only as a bcrypt hash).
 *  - Set SEED_PASSWORD to choose it.
 *  - Without it, a well-known demo password is used ONLY for a local database. For any remote
 *    database (Aiven, Render, ...) SEED_PASSWORD is mandatory, so a public site never ships with a
 *    guessable password by accident.
 */
export function resolveSeedPassword(): string {
  const fromEnv = process.env.SEED_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < PASSWORD_MIN) throw new Error(`SEED_PASSWORD must be at least ${PASSWORD_MIN} characters.`);
    return fromEnv;
  }
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    /* handled below */
  }
  if (process.env.NODE_ENV !== 'production' && LOCAL_HOSTS.has(host)) {
    console.log('SEED_PASSWORD not set: using the local demo password "ChangeMe123!"');
    return 'ChangeMe123!';
  }
  throw new Error('SEED_PASSWORD is required when the database is not local. Example: SEED_PASSWORD="a-long-unique-password" npm run seed');
}
