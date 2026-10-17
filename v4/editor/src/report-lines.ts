import type { Report } from './solid';

/** One line of the clearance report: a name makes it a failure that can be isolated in the 3D view. */
export interface ReportLine {
  text: string;
  name?: string;
}
/** A key or part name as shown to people. */
export const prettyKey = (name: string) => name.replaceAll('_', ' ');

/** The report as the lines the editor lists and `test:fit` prints. */
export function reportLines(r: Report): ReportLine[] {
  const out: ReportLine[] = [],
    add = (text: string, name?: string) => out.push({ text, name });
  add(
    `${r.seats.filter((s) => s.passed).length}/${r.seats.length} flat switch seats pass thickness and clip-clearance checks.`,
  );
  add(
    r.pieces.length === 1
      ? 'The case is one piece without the bottom section.'
      : `The case is ${r.pieces.length} pieces without the bottom section.`,
  );
  for (let i = 1; i < r.pieces.length; i++)
    add(`loose piece ${i}: ${(r.pieces[i] / 1000).toFixed(1)} cm³`, `loose piece ${i}`);
  add(
    r.footprint.length === 1
      ? 'The case holds together along the parting line without the bottom section.'
      : `The case meets the parting line in ${r.footprint.length} separate pieces.`,
  );
  for (let i = 1; i < r.footprint.length; i++)
    add(`separate footprint ${i}: ${r.footprint[i].toFixed(0)} mm²`, `separate footprint ${i}`);
  add(
    r.roomCuts.length
      ? `${r.roomCuts.length} keycap rooms had to cut into the chassis.`
      : 'No chassis was built where a keycap goes.',
  );
  for (const c of r.roomCuts)
    add(
      `${prettyKey(c.name)}: its keycap room cut ${c.volume.toFixed(1)} mm³ out of the chassis`,
      `${c.name} keycap room`,
    );
  for (const seat of r.seats)
    if (!seat.passed)
      add(
        `${seat.name}: switch seat defect (${seat.missing.toFixed(2)} mm³ missing, ${seat.excess.toFixed(2)} mm³ outside seating planes, ${seat.clipBlocked.toFixed(2)} mm³ clip obstruction)`,
        seat.name,
      );
  for (const k of r.keycaps)
    if (!k.passed)
      add(
        `${prettyKey(k.name)}: ${k.atRest.toFixed(2)} mm³ at rest; ${k.swept.toFixed(2)} mm³ through travel + ${k.margin} mm clearance`,
        k.name,
      );
  for (const h of r.hardware)
    add(`${h.name}: ${h.volume.toFixed(2)} mm³ ${h.group}/chassis overlap`, h.name);
  add(
    r.wires.length
      ? `${r.wires.length} wires run into the chassis.`
      : `All ${r.wiring.wires} wires are clear of the chassis.`,
  );
  for (const w of r.wires) add(`${w.name}: ${w.volume.toFixed(2)} mm³ into the chassis`, w.name);
  add(
    r.crossings.length
      ? `${r.crossings.length} pairs of wires run into each other.`
      : 'No wire runs into another.',
  );
  for (const c of r.crossings) add(`${c} run into each other`, c);
  for (const o of r.openings)
    if (!o.passed)
      add(`${o.name}: incomplete opening (${o.covered}/9 probes, ${o.blocked} blocked)`, o.name);
  for (const g of r.capGaps)
    add(`Closest keycaps, ${g.between}: ${g.gap <= 0 ? 'touching' : g.gap.toFixed(1) + ' mm'}`);
  if (r.passed) add('No chassis intersections with the checked hardware and keycap envelopes.');
  return out;
}
