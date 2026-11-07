import { Injectable } from '@nestjs/common';
import { Tx } from '../prisma/prisma.service';

/**
 * Human-readable, gap-tolerant, unique numbers (EXC-000001, ADJ-000001...). Increments a row
 * under a row lock inside the caller's transaction, so numbers are unique under concurrency.
 */
@Injectable()
export class SequenceService {
  async next(tx: Tx, name: string): Promise<number> {
    await tx.sequence.upsert({
      where: { name },
      create: { name, value: 0 },
      update: {},
    });
    await tx.$executeRaw`UPDATE Sequence SET value = value + 1 WHERE name = ${name}`;
    const row = await tx.sequence.findUniqueOrThrow({ where: { name } });
    return row.value;
  }

  async formatted(tx: Tx, name: string, prefix: string, width = 6): Promise<string> {
    const n = await this.next(tx, name);
    return `${prefix}-${String(n).padStart(width, '0')}`;
  }
}
