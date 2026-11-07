/**
 * All business dates are calendar days in UTC, represented as 'YYYY-MM-DD' strings
 * in calculations and as `DATE` columns in MySQL. Timestamps (createdAt, etc.) are
 * full UTC instants.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toYmd(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}

export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function todayYmd(now: Date = new Date()): string {
  return toYmd(now);
}

export function addDaysYmd(ymd: string, days: number): string {
  return toYmd(new Date(ymdToDate(ymd).getTime() + days * MS_PER_DAY));
}

/** Whole days from a to b (b - a). Both are 'YYYY-MM-DD'. */
export function diffDaysYmd(a: string, b: string): number {
  return Math.round((ymdToDate(b).getTime() - ymdToDate(a).getTime()) / MS_PER_DAY);
}

export function maxYmd(...values: Array<string | null | undefined>): string | null {
  const present = values.filter((v): v is string => !!v);
  if (present.length === 0) return null;
  return present.reduce((acc, v) => (v > acc ? v : acc));
}

export function minYmd(...values: Array<string | null | undefined>): string | null {
  const present = values.filter((v): v is string => !!v);
  if (present.length === 0) return null;
  return present.reduce((acc, v) => (v < acc ? v : acc));
}

export function nullableDateToYmd(value: Date | null | undefined): string | null {
  return value ? toYmd(value) : null;
}
