/**
 * Shared numeric constants for the agent life-cycle (aging, marriage,
 * childbirth, coming-of-age, self-built housing). Kept dependency-free
 * so both agentFactory.ts and lifecycle.ts can import it without a
 * circular import between them.
 */

export const MINUTES_PER_YEAR = 365 * 24 * 60;

/** Age at which a child agent becomes a fully autonomous adult. */
export const ADULT_AGE_YEARS = 18;

/** How long a pregnancy/gestation lasts. A safe, non-literal simulation
 * mechanic (see agent/lifecycle.ts) -- not modeling human gestation. */
export const GESTATION_MIN = 4 * 24 * 60;

/** Combined savings a couple must set aside to prepare for a child. */
export const CHILD_PREP_COST = 60;

/** Personal savings an adult needs to build their own house. */
export const HOUSE_BUILD_COST = 320;

/** Every agent's natural lifespan is randomized once, near birth, so
 * death is inevitable but never exactly predictable -- averaging out
 * around a century, per a real human lifespan. */
export function randomLifespanYears(): number {
  return 85 + Math.random() * 20; // 85..105
}

/** Age derived fresh from birth minute each tick, never stored/accumulated. */
export function ageYears(nowMinute: number, birthSimMinute: number): number {
  return Math.max(0, (nowMinute - birthSimMinute) / MINUTES_PER_YEAR);
}
