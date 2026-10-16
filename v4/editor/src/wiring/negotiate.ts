// Choosing one route per wire so that no two wires meet: pure, on options only.
import { WIRING } from './common';
import { touches, type Tube } from './tubes';

/** One way to route a wire; a lower rank is nearer the tiles. */
export interface Option {
  tube: Tube;
  rank: number;
}

/**
 * Picks an option for each wire. Wires negotiate, then what is left is
 * repaired in small groups. With `wide`, if any still meet, it starts again
 * with those wires placed first and keeps the best try. Returns each wire's
 * option index and how many wires still meet another.
 */
export function negotiate(options: Option[][], wide: boolean) {
  const all = options.map((_, i) => i);
  // Wires whose options can meet.
  const reach = options.map((list) => ({
    lo: [0, 1, 2].map((k) => Math.min(...list.map((o) => o.tube.lo[k]))),
    hi: [0, 1, 2].map((k) => Math.max(...list.map((o) => o.tube.hi[k]))),
  }));
  const near = all.map((i) =>
    all.filter(
      (j) =>
        j !== i &&
        [0, 1, 2].every(
          (k) => reach[i].lo[k] <= reach[j].hi[k] && reach[j].lo[k] <= reach[i].hi[k],
        ),
    ),
  );
  const ids = new Map<Tube, number>();
  options.flat().forEach((o, k) => ids.set(o.tube, k));
  const count = ids.size;
  const memo = new Map<number, boolean>();
  const meets = (a: Tube, b: Tube) => {
    const x = ids.get(a)!;
    const y = ids.get(b)!;
    const key = x < y ? x * count + y : y * count + x;
    let v = memo.get(key);
    if (v === undefined) memo.set(key, (v = touches(a, b)));
    return v;
  };
  const choice = options.map(() => 0);
  let history = options.map((list) => list.map(() => 0));
  const meetsAny = (i: number) =>
    near[i].some((j) => meets(options[i][choice[i]].tube, options[j][choice[j]].tube));

  // Each wire in turn takes its cheapest option, given the others' current
  // choices. Meeting another wire costs `penalty`, which grows each round,
  // plus what that option has cost in earlier rounds. After the first round
  // only the wires that meet another are moved, until none do.
  const run = (order: number[]) => {
    choice.fill(0);
    history = options.map((list) => list.map(() => 0));
    let penalty = WIRING.penalty;
    let moving = order;
    // Stop when the number meeting has not fallen for a while.
    let fewest = Infinity;
    let since = 0;
    for (let round = 0; round < WIRING.rounds && moving.length && since < WIRING.stall; round++) {
      for (const i of moving) {
        let best = Infinity;
        const list = options[i];
        for (let k = 0; k < list.length; k++) {
          // Options are in order of rank, and history only adds.
          if (list[k].rank >= best) break;
          let cost = list[k].rank + history[i][k];
          for (const j of near[i]) {
            if (cost >= best) break;
            if (meets(list[k].tube, options[j][choice[j]].tube)) cost += penalty;
          }
          if (cost < best) {
            best = cost;
            choice[i] = k;
          }
        }
      }
      const meeting = all.filter(meetsAny);
      if (meeting.length < fewest) {
        fewest = meeting.length;
        since = 0;
      } else since++;
      // A wire that meets another pays for its choice next round; so does each
      // wire in the way of its cheapest other options, so it moves aside.
      const next = new Set(meeting);
      for (const i of meeting) {
        history[i][choice[i]] += WIRING.historyCost;
        const cheapest = options[i]
          .map((o, k) => ({ k, cost: o.rank + history[i][k] }))
          .sort((x, y) => x.cost - y.cost)
          .slice(0, WIRING.blockerOptions);
        for (const { k } of cheapest)
          for (const j of near[i])
            if (meets(options[i][k].tube, options[j][choice[j]].tube)) {
              history[j][choice[j]] += WIRING.blockerCost;
              next.add(j);
            }
      }
      penalty *= WIRING.penaltyGrowth;
      moving = [...next];
    }
  };
  // Then repair what is left in small groups: two wires that meet, then
  // those two and the wire most in their way, each take the options that
  // together meet the fewest other wires, if that is fewer than now.
  const repair = (group: number[]) => {
    const inGroup = new Set(group);
    const outside = (i: number, k: number) => {
      let n = 0;
      for (const j of near[i])
        if (!inGroup.has(j) && meets(options[i][k].tube, options[j][choice[j]].tube)) n++;
      return n;
    };
    const lists = group.map((g) =>
      options[g]
        .map((o, k) => ({ k, n: outside(g, k), rank: o.rank }))
        .sort((x, y) => x.n - y.n || x.rank - y.rank),
    );
    const rest = lists.map((_, d) => lists.slice(d + 1).reduce((t, l) => t + l[0].n, 0));
    const mutual = (d: number, k: number, chosen: number[]) => {
      let n = 0;
      for (let e = 0; e < d; e++)
        if (meets(options[group[d]][k].tube, options[group[e]][chosen[e]].tube)) n++;
      return n;
    };
    const now = group.map((g) => choice[g]);
    let best = group.reduce((t, g, d) => t + outside(g, now[d]) + mutual(d, now[d], now), 0);
    let pick: number[] | undefined;
    let work = WIRING.repairWork;
    const chosen: number[] = [];
    const search = (d: number, n: number) => {
      if (d === group.length) {
        best = n;
        pick = [...chosen];
        return;
      }
      for (const o of lists[d]) {
        if (n + o.n + rest[d] >= best || --work < 0) break;
        const m = n + o.n + mutual(d, o.k, chosen);
        if (m + rest[d] >= best) continue;
        chosen[d] = o.k;
        search(d + 1, m);
      }
    };
    search(0, 0);
    if (!pick) return false;
    group.forEach((g, d) => (choice[g] = pick![d]));
    return true;
  };
  const repairAll = () => {
    for (let pass = 0; pass < WIRING.repairPasses; pass++) {
      let improved = false;
      for (const i of all.filter(meetsAny))
        for (const j of near[i]) {
          if (!meets(options[i][choice[i]].tube, options[j][choice[j]].tube)) continue;
          if (repair([i, j])) {
            improved = true;
            continue;
          }
          // The wire in the way of most of the pair's options.
          const inWay = new Map<number, number>();
          for (const g of [i, j])
            for (const o of options[g])
              for (const k of near[g])
                if (k !== i && k !== j && meets(o.tube, options[k][choice[k]].tube))
                  inWay.set(k, (inWay.get(k) ?? 0) + 1);
          const ways = [...inWay].sort((x, y) => y[1] - x[1]).map(([k]) => k);
          // Each of the wires most in the way with the pair, then two of them.
          const top = ways.slice(0, WIRING.repairBlockers);
          const groups = [
            ...top.map((k) => [i, j, k]),
            ...top.flatMap((k, n) => top.slice(n + 1).map((m) => [i, j, k, m])),
          ];
          for (const g of groups)
            if (repair(g)) {
              improved = true;
              break;
            }
        }
      if (!improved) break;
    }
  };
  let order = all;
  let best: { left: number; choice: number[] } | undefined;
  for (let attempt = 0; attempt <= (wide ? WIRING.restarts : 0); attempt++) {
    run(order);
    repairAll();
    const meeting = all.filter(meetsAny);
    if (!best || meeting.length < best.left) best = { left: meeting.length, choice: [...choice] };
    if (!meeting.length) break;
    const first = new Set(meeting);
    order = [...meeting, ...order.filter((i) => !first.has(i))];
  }
  return best!;
}
