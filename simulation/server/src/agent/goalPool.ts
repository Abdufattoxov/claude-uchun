import type { Goal } from "../types.js";

/**
 * Once a goal completes, agents don't just stop -- they pick up a new
 * one from here, scaled to roughly the same priority. This is what
 * keeps them "always working on themselves" instead of reaching a
 * finish line and going idle.
 */
const POOLS: Record<Goal["kind"], string[]> = {
  need: ["Kundalik turmush tartibini yaxshilash"],
  social: [
    "Yangi tanishlar orttirish",
    "Yaqin do'stlar davrasini kengaytirish",
    "Qo'shnilar bilan yaqinroq bo'lish",
    "Mahalladagi ko'proq odamni ismi bilan bilish",
  ],
  career: [
    "Kasbida yanada mohir bo'lish",
    "Ishda yangi mas'uliyat olish",
    "O'z sohasida eng yaxshilardan biriga aylanish",
    "Yosh hamkasblarga ustozlik qilish",
  ],
  personal: [
    "Ko'proq mablag' jamg'arish",
    "Yangi qiziqish yoki mashg'ulot topish",
    "Uzoq sayohatga pul yig'ish",
    "O'z his-tuyg'ularini yaxshiroq boshqarishni o'rganish",
  ],
  romantic: [
    "Munosabatni yanada mustahkamlash",
    "Kimnidir chuqurroq tushunishga harakat qilish",
    "Yurak amriga quloq solish",
  ],
};

export function pickNextGoal(kind: Goal["kind"], priorityHint: number): Omit<Goal, "id"> {
  const options = POOLS[kind];
  const description = options[Math.floor(Math.random() * options.length)];
  const priority = Math.min(0.9, Math.max(0.3, priorityHint + (Math.random() * 0.2 - 0.1)));
  return { description, kind, priority, progress: 0 };
}
