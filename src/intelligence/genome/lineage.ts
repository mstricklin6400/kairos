/**
 * Lineage-aware evidence counting — the piece of the Genome that stops the
 * same fact being counted several times.
 *
 * THE PROBLEM
 * ------------------------------------------------------------------------
 * One experiment produces a `PostMeasurement`. The Science Engine turns
 * that into an `ExperimentObservation` and then a `Finding`. Intelligence
 * Transfer builds a `TransferAssessment` from that `Finding`. A Social
 * Prescription cites the assessment.
 *
 * That is FIVE records and ONE piece of evidence. A Genome that counted
 * records would report five-fold support for a claim resting on a single
 * experiment — which is how a system talks itself into false confidence.
 *
 * THE RULE
 * ------------------------------------------------------------------------
 * Every piece of Genome evidence declares `lineageRoots`: the primitive
 * evidence ids it ultimately derives from. Independent-evidence counts are
 * computed over the **union of those roots**, never over record count.
 *
 * This complements — and does not replace — the distinct profile and
 * experiment counts in `aggregate.ts`. Lineage stops derived records from
 * inflating a count; distinct-source counting is what actually gates
 * promotion.
 *
 * Deliberately decoupled from the Genome's own types: it operates on any
 * record carrying `lineageRoots`, so the same rule can be reused elsewhere
 * without dragging the whole domain model along.
 */

/** The minimum shape lineage counting needs. */
export interface LineageBearing {
  readonly recordId: string;
  readonly lineageRoots: readonly string[];
}

/**
 * The roots one record rests on. A record with no declared lineage becomes
 * its own root, so it is counted exactly once rather than vanishing.
 */
function rootsOf(item: LineageBearing): readonly string[] {
  return item.lineageRoots.length > 0 ? item.lineageRoots : [`record:${item.recordId}`];
}

/** The union of every lineage root across a set. */
export function collectLineageRoots(evidence: readonly LineageBearing[]): Set<string> {
  const roots = new Set<string>();
  for (const item of evidence) {
    for (const root of rootsOf(item)) roots.add(root);
  }
  return roots;
}

/**
 * The number of INDEPENDENT pieces of evidence — the size of the union of
 * all lineage roots, not the number of records.
 */
export function countIndependentEvidence(evidence: readonly LineageBearing[]): number {
  return collectLineageRoots(evidence).size;
}

/** Whether two records rest on any shared primitive evidence. */
export function sharesLineage(a: LineageBearing, b: LineageBearing): boolean {
  const bRoots = new Set(rootsOf(b));
  return rootsOf(a).some((root) => bRoots.has(root));
}

/**
 * Groups records into sets that share lineage, transitively.
 *
 * Union-find, so a chain (A shares a root with B, B with C) collapses into
 * one group even when A and C do not directly overlap. Returns one array
 * per independent group, in first-seen order.
 */
export function groupByLineage<T extends LineageBearing>(evidence: readonly T[]): T[][] {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const item of evidence) {
    const roots = rootsOf(item);
    for (const root of roots) if (!parent.has(root)) parent.set(root, root);
    for (let i = 1; i < roots.length; i += 1) union(roots[0]!, roots[i]!);
  }

  const groups = new Map<string, T[]>();
  for (const item of evidence) {
    const group = find(rootsOf(item)[0]!);
    const existing = groups.get(group);
    if (existing) existing.push(item);
    else groups.set(group, [item]);
  }
  return [...groups.values()];
}

/**
 * Collapses lineage-sharing records to one representative per group,
 * chosen by the caller's preference function (higher wins).
 *
 * Given a first-party finding and a transfer assessment derived from it,
 * a caller preferring first-party evidence keeps the finding — the more
 * direct record — because keeping both would double-count one experiment.
 */
export function deduplicateByLineage<T extends LineageBearing>(
  evidence: readonly T[],
  preference: (item: T) => number = () => 0,
): T[] {
  return groupByLineage(evidence).map((group) =>
    group.reduce((best, item) => (preference(item) > preference(best) ? item : best)),
  );
}
