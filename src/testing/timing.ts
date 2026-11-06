/**
 * What redrawing a board of 2,000 objects may take in these tests, which is React's development build in jsdom,
 * with no layout or painting. It catches work that grows out of proportion. It is not the delay a user sees,
 * so it follows what a card has to hold: every go here costs well below it on a slow CI machine.
 */
export const REDRAW_BUDGET = 800;

/** How long a step takes. fireEvent runs React to the end of its commit, so a click is timed to the changed DOM. */
export function timeOf(step: () => void): number {
  const started = performance.now();
  step();
  return performance.now() - started;
}

/**
 * The fastest of three goes, for each of the times a go returns. A go has to leave things as it found them.
 *
 * What else the machine does only adds to a single time: other test files beside it, garbage collection,
 * code not yet optimized. The fastest go is closest to the work itself, and what is really slow is slow on every go.
 */
export function fastestOfThreeGoes(go: () => number[]): number[] {
  const goes = [go(), go(), go()];
  return goes[0].map((_, index) => Math.min(...goes.map((times) => times[index])));
}
