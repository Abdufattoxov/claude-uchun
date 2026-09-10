import type { WorldLocation } from "../types.js";

/**
 * Static town layout. Small and hand-authored for the MVP; at larger
 * agent populations this would be generated/streamed, but a fixed list
 * keeps phase 1-6 simple and testable.
 */
export const LOCATIONS: WorldLocation[] = [
  { id: "house_1", name: "Maple House", type: "house", x: -18, z: -10, radius: 3 },
  { id: "house_2", name: "Birch House", type: "house", x: -18, z: 0, radius: 3 },
  { id: "house_3", name: "Cedar House", type: "house", x: -18, z: 10, radius: 3 },
  { id: "house_4", name: "Willow House", type: "house", x: 18, z: -10, radius: 3 },
  { id: "house_5", name: "Aspen House", type: "house", x: 18, z: 10, radius: 3 },

  { id: "bakery", name: "Riverside Bakery", type: "workplace", x: 0, z: -18, radius: 4 },
  { id: "farm", name: "Green Valley Farm", type: "workplace", x: 12, z: -18, radius: 5 },
  { id: "workshop", name: "Old Mill Workshop", type: "workplace", x: -12, z: -18, radius: 4 },

  { id: "general_store", name: "General Store", type: "shop", x: 6, z: 0, radius: 3 },
  { id: "cafe", name: "Sunny Cafe", type: "cafe", x: -6, z: 0, radius: 3 },
  { id: "park", name: "Town Park", type: "park", x: 0, z: 12, radius: 6 },
  { id: "square", name: "Town Square", type: "public", x: 0, z: 0, radius: 5 },
];

export function findLocation(id: string): WorldLocation | undefined {
  return LOCATIONS.find((l) => l.id === id);
}

export function locationsByType(type: WorldLocation["type"]): WorldLocation[] {
  return LOCATIONS.filter((l) => l.type === type);
}
