import type { ExitInfo, SimMetrics } from './simulation';

export type Letter = 'A' | 'B' | 'C' | 'D' | 'F';

export interface Grade {
  letter: Letter;
  survival: number;
  findings: string[];
}

/**
 * Preliminary building grade from a single run. The thresholds are placeholders, to be calibrated
 * later against code egress requirements (e.g. NBC 2016 Part 4, NFPA 101).
 */
export function gradeRun(m: SimMetrics, exits: ExitInfo[]): Grade {
  const survival = m.total ? m.evacuated / m.total : 1;
  const t = m.t95 ?? Infinity;
  let letter: Letter;
  if (survival >= 0.99 && t <= 150) letter = 'A';
  else if (survival >= 0.97 && t <= 240) letter = 'B';
  else if (survival >= 0.9) letter = 'C';
  else if (survival >= 0.75) letter = 'D';
  else letter = 'F';

  const findings: string[] = [];
  if (m.dead > 0) findings.push(`${m.dead} of ${m.total} occupants did not survive.`);
  if (m.remaining > 0) findings.push(`${m.remaining} still inside after ${Math.round(m.time)} s.`);
  if (m.t95 !== null) findings.push(`95% evacuated in ${Math.round(m.t95)} s.`);
  if (exits.length === 1) {
    findings.push('Only one exit: a single blocked doorway traps everyone.');
  } else if (m.evacuated > 0) {
    const max = Math.max(...m.exitCounts);
    const share = max / m.evacuated;
    if (share > 0.7) {
      const label = exits[m.exitCounts.indexOf(max)].label;
      findings.push(`${label} carried ${Math.round(share * 100)}% of evacuees: load is unbalanced.`);
    }
  }
  return { letter, survival, findings };
}
