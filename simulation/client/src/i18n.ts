// Uzbek display labels for the small set of fixed enum-like values the
// server sends in English (needs keys, emotion labels already arrive
// pre-translated from the server, relationship states, goal kinds,
// occupations, weather codes). Free-form generated text (activities,
// memories, dialogue) is produced directly in Uzbek server-side.

export const WEATHER_UZ: Record<string, string> = {
  clear: "Ochiq",
  cloudy: "Bulutli",
  rain: "Yomg'irli",
  storm: "Bo'ronli",
};

export const NEED_LABEL_UZ: Record<string, string> = {
  hunger: "ochlik",
  energy: "energiya",
  social: "muloqot",
  fun: "ko'ngilochar",
  hygiene: "gigiena",
  skill: "mahorat",
};

export const GOAL_KIND_UZ: Record<string, string> = {
  need: "ehtiyoj",
  social: "ijtimoiy",
  career: "karyera",
  personal: "shaxsiy",
  romantic: "romantik",
};

export const RELATIONSHIP_STATE_UZ: Record<string, string> = {
  stranger: "notanish",
  acquaintance: "tanish",
  friend: "do'st",
  close_friend: "yaqin do'st",
  romantic_interest: "yoqtirgan odam",
  partner: "hamroh",
  family: "oila a'zosi",
};

export const OCCUPATION_UZ: Record<string, string> = {
  baker: "novvoy",
  farmer: "fermer",
  carpenter: "duradgor",
  shopkeeper: "do'kondor",
  cafe_barista: "barista",
};

export function needLabel(key: string): string {
  return NEED_LABEL_UZ[key] ?? key;
}

export function goalKindLabel(kind: string): string {
  return GOAL_KIND_UZ[kind] ?? kind;
}

export function relationshipStateLabel(state: string): string {
  return RELATIONSHIP_STATE_UZ[state] ?? state.replace("_", " ");
}

export function occupationLabel(occupation: string | undefined): string {
  if (!occupation) return "ishsiz";
  return OCCUPATION_UZ[occupation] ?? occupation;
}

/** Mirrors the server's career tiers (server/src/agent/labels.ts) for display. */
const SKILL_TIERS: Array<{ min: number; suffix: string }> = [
  { min: 0, suffix: "" },
  { min: 35, suffix: "usta " },
  { min: 70, suffix: "professional " },
  { min: 92, suffix: "bosh " },
];

export function occupationTitle(occupation: string | undefined, skill: number): string {
  if (!occupation) return "ishsiz";
  let tier = SKILL_TIERS[0];
  for (const t of SKILL_TIERS) if (skill >= t.min) tier = t;
  return `${tier.suffix}${occupationLabel(occupation)}`;
}

export function weatherLabel(weather: string): string {
  return WEATHER_UZ[weather] ?? weather;
}

export const ACTION_TYPE_UZ: Record<string, string> = {
  go_to: "borish",
  work: "ishlash",
  eat: "ovqatlanish",
  sleep: "uxlash",
  socialize: "suhbatlashish",
  shop: "xarid qilish",
  relax: "dam olish",
  wander: "sayr qilish",
  propose_marriage: "turmush qurishni taklif qilish",
  want_child: "farzand ko'rish orzusi",
  build_house: "o'z uyini qurish",
};

export function lifeStageLabel(stage: string): string {
  return stage === "child" ? "bola" : "kattalar";
}

export function actionTypeLabel(type: string): string {
  return ACTION_TYPE_UZ[type] ?? type;
}
