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

export const NEED_LABEL_UZ: Record<keyof Needs, string> = {
  hunger: "ochlik",
  energy: "energiya",
  social: "muloqot",
  fun: "ko'ngilochar",
  hygiene: "gigiena",
};
