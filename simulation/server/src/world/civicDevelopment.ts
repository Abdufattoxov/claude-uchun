import type { WorldLocation } from "../types.js";

/**
 * The town literally grows as a visible consequence of agents' own
 * labor: a small share of every wage they earn goes into this shared
 * fund (see AgentEngine's wage settlement), and crossing a threshold
 * permanently adds a new landmark to the world -- persisted, rendered
 * in the 3D scene, and available to agents as a real destination.
 *
 * Placed at the town's edges so growth is spatial too: the town visibly
 * expands outward over time instead of just getting a denser center.
 */
export interface CivicMilestone {
  id: string;
  name: string;
  threshold: number;
  type: WorldLocation["type"];
  x: number;
  z: number;
  radius: number;
}

export const CIVIC_MILESTONES: CivicMilestone[] = [
  { id: "clinic", name: "Zamonaviy tibbiyot punkti", threshold: 400, type: "public", x: 28, z: -4, radius: 4 },
  { id: "library", name: "Shahar kutubxonasi", threshold: 1000, type: "public", x: 28, z: 8, radius: 4 },
  { id: "solar_park", name: "Quyosh energiyasi bog'i", threshold: 2200, type: "park", x: -28, z: -4, radius: 5 },
  { id: "innovation_hub", name: "Innovatsiya markazi", threshold: 4000, type: "public", x: -28, z: 8, radius: 4 },
  { id: "sky_tower", name: "Zamonaviy shahar minorasi", threshold: 7000, type: "public", x: 0, z: -32, radius: 5 },
];

export function milestoneToLocation(m: CivicMilestone): WorldLocation {
  return { id: m.id, name: m.name, type: m.type, x: m.x, z: m.z, radius: m.radius, modern: true };
}

/** Next not-yet-built milestone the fund hasn't reached, or undefined if all are built. */
export function nextMilestone(builtIds: Set<string>): CivicMilestone | undefined {
  return CIVIC_MILESTONES.find((m) => !builtIds.has(m.id));
}
