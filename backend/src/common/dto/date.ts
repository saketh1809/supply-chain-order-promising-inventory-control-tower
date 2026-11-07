import { BadRequestException } from '@nestjs/common';

/** Accepts 'YYYY-MM-DD' or any ISO timestamp; returns a Date or throws a 400. */
export function parseDateInput(value: string, field: string): Date {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${field} must be a valid date`);
  }
  return d;
}
