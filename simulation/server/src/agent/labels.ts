import type { Needs } from "../types.js";

/** Uzbek display labels for internal occupation slugs (kept in English
 * internally since they're also used as economy wage-lookup keys). */
export const OCCUPATION_LABEL_UZ: Record<string, string> = {
  baker: "novvoy",
  farmer: "fermer",
  carpenter: "duradgor",
  shopkeeper: "do'kondor",
  cafe_barista: "barista",
};

export function occupationLabel(occupation: string | undefined): string {
  if (!occupation) return "ishsiz";
  return OCCUPATION_LABEL_UZ[occupation] ?? occupation;
}

/** Which workplace a given occupation reports to -- used when a child
 * comes of age and picks up their first job. */
const OCCUPATION_WORKPLACE: Record<string, string> = {
  baker: "bakery",
  farmer: "farm",
  carpenter: "workshop",
  shopkeeper: "general_store",
  cafe_barista: "cafe",
};

export function randomOccupation(): string {
  const keys = Object.keys(OCCUPATION_WORKPLACE);
  return keys[Math.floor(Math.random() * keys.length)];
}

export function workplaceForOccupation(occupation: string): string {
  return OCCUPATION_WORKPLACE[occupation] ?? "general_store";
}

export const NEED_LABEL_UZ: Record<keyof Needs, string> = {
  hunger: "ochlik",
  energy: "energiya",
  social: "muloqot",
  fun: "ko'ngilochar",
  hygiene: "gigiena",
};

/**
 * Career mastery tiers. `skill` (0..100) grows slowly while an agent
 * works (see AgentEngine.applyActivityEffects); crossing a threshold
 * changes their displayed title and pays a real wage bonus, so
 * "working on themselves" has a visible, permanent payoff rather than
 * just a number going up in an inspector nobody opens.
 */
interface Tier {
  min: number;
  suffix: string; // combined with the base occupation label
  wageMultiplier: number;
}

const TIERS: Tier[] = [
  { min: 0, suffix: "", wageMultiplier: 1 },
  { min: 35, suffix: "usta ", wageMultiplier: 1.25 },
  { min: 70, suffix: "professional ", wageMultiplier: 1.5 },
  { min: 92, suffix: "bosh ", wageMultiplier: 1.8 },
];

function tierFor(skill: number): Tier {
  let current = TIERS[0];
  for (const tier of TIERS) {
    if (skill >= tier.min) current = tier;
  }
  return current;
}

/** e.g. "usta novvoy" once skill crosses 35, "bosh novvoy" past 92. */
export function occupationTitle(occupation: string | undefined, skill: number): string {
  if (!occupation) return "ishsiz";
  const base = OCCUPATION_LABEL_UZ[occupation] ?? occupation;
  const tier = tierFor(skill);
  return `${tier.suffix}${base}`;
}

export function skillWageMultiplier(skill: number): number {
  return tierFor(skill).wageMultiplier;
}

/** Returns the tier's minimum skill (for detecting a tier-up crossing) or -1. */
export function tierFloor(skill: number): number {
  return tierFor(skill).min;
}
