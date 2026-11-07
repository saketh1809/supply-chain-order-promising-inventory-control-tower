import { execSync } from 'child_process';
import * as path from 'path';

/** Applies migrations to the dedicated TEST database before the integration suite runs. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'mysql://sct:sct_password@localhost:3306/sct_test';
  process.env.DATABASE_URL = url;
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url },
  });
}
