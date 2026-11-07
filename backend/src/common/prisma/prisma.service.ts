import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '../api/api-error';

export type Tx = Prisma.TransactionClient;

const MAX_TX_ATTEMPTS = 4;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to MySQL');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs `fn` inside a transaction at READ COMMITTED isolation (so each statement sees the latest
   * committed data after acquiring its row locks). Deadlocks and serialization failures are retried
   * a bounded number of times; the transaction body must therefore be safe to re-run.
   */
  async transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await this.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 10_000,
          timeout: 30_000,
        });
      } catch (err) {
        if (isRetryableTxError(err) && attempt < MAX_TX_ATTEMPTS) {
          this.logger.warn(`Retrying transaction after write conflict (attempt ${attempt})`);
          await new Promise((r) => setTimeout(r, 25 * attempt));
          continue;
        }
        if (isRetryableTxError(err)) {
          throw ApiError.conflict('CONCURRENT_UPDATE', 'The record was modified concurrently. Please retry.');
        }
        throw err;
      }
    }
  }
}

function isRetryableTxError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2034';
  }
  const message = err instanceof Error ? err.message : '';
  return /Deadlock found|Lock wait timeout/i.test(message);
}
