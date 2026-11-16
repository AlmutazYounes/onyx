/**
 * Grading. A case lists named criteria, so a run that does most of the work scores most of the
 * credit instead of the same zero as a run that does nothing.
 */

export interface Criterion {
  readonly name: string;
  /** A shell command that meets the criterion when it exits 0. */
  readonly check?: string;
  /**
   * A shell command that prints TAP (`ok 1 - name`, `not ok 2 - name`): credit is the share of
   * tests that pass. Without TAP lines it counts as a `check`.
   */
  readonly tests?: string;
  readonly weight?: number;
  /** Something that must stay true, such as tests still passing; breaking it scales the score down. */
  readonly guard?: boolean;
}

export interface CriterionResult {
  readonly name: string;
  readonly weight: number;
  readonly guard: boolean;
  /** 0 to 1. */
  readonly credit: number;
  readonly detail: string;
}

/** Top-level TAP results; subtests and the plan line do not count. */
export function parseTap(output: string) {
  const results = [...output.matchAll(/^(not ok|ok)\s+\d+\s*(?:-\s*)?(.*)$/gm)];
  if (results.length === 0) return null;
  const failed = results.filter((match) => match[1] === "not ok").map((match) => match[2]!.trim());
  return { passed: results.length - failed.length, total: results.length, failed };
}

export function gradeCriterion(
  criterion: Criterion,
  run: { readonly status: number | null; readonly stdout: string },
): CriterionResult {
  const weight = criterion.weight ?? 1;
  const guard = criterion.guard === true;
  const tap = criterion.tests === undefined ? null : parseTap(run.stdout);
  if (tap) {
    return {
      name: criterion.name,
      weight,
      guard,
      credit: tap.passed / tap.total,
      detail:
        `${tap.passed}/${tap.total} tests` +
        (tap.failed.length ? `; failed: ${tap.failed.slice(0, 6).join("; ")}` : ""),
    };
  }
  const met = run.status === 0;
  return {
    name: criterion.name,
    weight,
    guard,
    credit: met ? 1 : 0,
    detail: met ? "met" : "not met",
  };
}

/** Weighted share of credit, 0 to 100. */
export function scoreOf(results: ReadonlyArray<CriterionResult>): number {
  const weight = results.reduce((sum, result) => sum + result.weight, 0);
  if (weight === 0) return 0;
  return (100 * results.reduce((sum, result) => sum + result.weight * result.credit, 0)) / weight;
}

/**
 * A run's score, 0 to 100. Work criteria (the task itself) earn credit only for progress past
 * where the untouched project already stood, so regression checks inside a hidden suite give a
 * do-nothing run nothing. Guards (tests still pass, nothing else changed) earn nothing on their
 * own; the share of guard weight still held scales the work credit down.
 */
export function scoreRun(
  results: ReadonlyArray<CriterionResult>,
  start: ReadonlyArray<CriterionResult>,
) {
  const work = results.filter((result) => !result.guard);
  const guards = results.filter((result) => result.guard);
  const workScore = scoreOf(work);
  const workStart = scoreOf(start.filter((result) => !result.guard));
  const gained =
    workStart >= 100 ? workScore : Math.max(0, (100 * (workScore - workStart)) / (100 - workStart));
  const guardsHeld = guards.length ? scoreOf(guards) / 100 : 1;
  return { score: gained * guardsHeld, workScore, workStart, guardsHeld };
}
