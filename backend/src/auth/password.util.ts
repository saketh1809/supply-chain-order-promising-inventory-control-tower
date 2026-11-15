import * as bcrypt from 'bcryptjs';

/** bcrypt work factor. 12 is a sensible default today (about 250 ms per hash). */
const COST = 12;

/** Passwords longer than 72 bytes are silently truncated by bcrypt, so we cap the length instead. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Compared against when the e-mail is unknown, so "no such user" costs as much time as "wrong password". */
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);
