/**
 * Gives the existing users a password hash WITHOUT touching any other data. Use it on a database
 * that was seeded before authentication existed (the normal seed skips a database that already
 * has data).
 *
 *   SEED_PASSWORD="a-long-unique-password" npm run set-passwords           # only users without a password
 *   SEED_PASSWORD="a-long-unique-password" npm run set-passwords -- --all  # overwrite every user
 *   SEED_PASSWORD="..." npm run set-passwords -- --email dana.ortiz@northwind.example
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.util';
import { resolveSeedPassword } from './seed-password';

async function main() {
  const prisma = new PrismaClient();
  try {
    const all = process.argv.includes('--all');
    const emailFlag = process.argv.indexOf('--email');
    const email = emailFlag > -1 ? process.argv[emailFlag + 1]?.toLowerCase() : undefined;
    const hash = await hashPassword(resolveSeedPassword());
    const where = email ? { email } : all ? {} : { passwordHash: null };
    const res = await prisma.user.updateMany({ where, data: { passwordHash: hash } });
    console.log(`Updated ${res.count} user(s).`);
    const users = await prisma.user.findMany({ select: { email: true, role: true, passwordHash: true }, orderBy: { id: 'asc' } });
    for (const u of users) console.log(`  ${u.email.padEnd(36)} ${u.role.padEnd(8)} ${u.passwordHash ? 'can sign in' : 'NO PASSWORD'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
