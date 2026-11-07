/**
 * Time-phased ATP projection (pure).
 *
 *   ATP(d) = onHand + Σ eligible inbound qty arriving on or before d
 *                   - Σ allocated demand shipping on or before d
 *
 * Negative values mean the committed demand due by day d exceeds the supply that will exist by d,
 * i.e. a projected shortage. Inbound receipts that are RECEIVED or CANCELED must not be passed in.
 */
import { addDaysYmd, diffDaysYmd } from '../common/dates';

export interface AtpInbound {
  date: string;
  quantity: number;
  reference: string;
}

export interface AtpDemand {
  date: string;
  quantity: number;
  reference: string;
}

export interface AtpPoint {
  date: string;
  supply: number;
  demand: number;
  atp: number;
  /** Net change vs the previous point, for display. */
  delta: number;
}

export function projectAtp(params: {
  asOfDate: string;
  horizonDays: number;
  onHand: number;
  inbound: AtpInbound[];
  demand: AtpDemand[];
}): AtpPoint[] {
  const points: AtpPoint[] = [];
  let prev = params.onHand;
  for (let i = 0; i <= params.horizonDays; i++) {
    const date = addDaysYmd(params.asOfDate, i);
    const supply = params.inbound
      .filter((r) => r.date <= date)
      .reduce((sum, r) => sum + r.quantity, 0);
    const demand = params.demand
      .filter((d) => d.date <= date)
      .reduce((sum, d) => sum + d.quantity, 0);
    const atp = params.onHand + supply - demand;
    points.push({ date, supply, demand, atp, delta: atp - prev });
    prev = atp;
  }
  return points;
}

/** First day on which the projected ATP drops below zero, or null when it never does. */
export function firstShortageDate(points: AtpPoint[]): string | null {
  const hit = points.find((p) => p.atp < 0);
  return hit ? hit.date : null;
}

export function daysBetween(a: string, b: string): number {
  return diffDaysYmd(a, b);
}
