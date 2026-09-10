import type { Agent, AgentSchedulePoint, Personality } from "../types.js";
import { findLocation } from "../world/locations.js";
import { randomUUID } from "node:crypto";
import { ACTIVITY } from "./activityLabels.js";

interface Seed {
  name: string;
  age: number;
  personality: Personality;
  occupation: string;
  homeId: string;
  workId: string;
  goals: Array<{ description: string; kind: Agent["goals"][number]["kind"]; priority: number }>;
  beliefs: string[];
}

const SEEDS: Seed[] = [
  {
    name: "Elena Marsh",
    age: 29,
    personality: { openness: 0.6, conscientiousness: 0.8, extraversion: 0.75, agreeableness: 0.7, neuroticism: 0.3 },
    occupation: "baker",
    homeId: "house_1",
    workId: "bakery",
    goals: [
      { description: "Doimiy mijozlar va do'stlardan iborat sodiq davra yaratish", kind: "social", priority: 0.6 },
      { description: "Novvoyxonani kengaytirish uchun pul jamg'arish", kind: "career", priority: 0.5 },
    ],
    beliefs: ["Yaxshilik erta-yu kech o'ziga qaytadi", "Yaxshi tonggi tartib butun kunni belgilaydi"],
  },
  {
    name: "Marcus Webb",
    age: 34,
    personality: { openness: 0.4, conscientiousness: 0.65, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.25 },
    occupation: "farmer",
    homeId: "house_2",
    workId: "farm",
    goals: [
      { description: "Fasl davomida fermani foydali saqlash", kind: "career", priority: 0.7 },
      { description: "Tinch kechalarni birga o'tkazadigan kishini topish", kind: "romantic", priority: 0.4 },
    ],
    beliefs: ["Mehnat o'z mukofotini oladi", "Agar quloq solsang, yer senga nima kerakligini aytadi"],
  },
  {
    name: "Sofia Chen",
    age: 24,
    personality: { openness: 0.85, conscientiousness: 0.5, extraversion: 0.8, agreeableness: 0.65, neuroticism: 0.45 },
    occupation: "cafe_barista",
    homeId: "house_3",
    workId: "cafe",
    goals: [
      { description: "Shahardan o'tayotgan qiziqarli odamlar bilan tanishish", kind: "social", priority: 0.65 },
      { description: "Yangi joyga sayohat qilish uchun pul jamg'arish", kind: "personal", priority: 0.5 },
    ],
    beliefs: ["Har bir notanish odamning yaxshi hikoyasi bor", "Kundalik tartib yaxshi, lekin sarguzasht muhimroq"],
  },
  {
    name: "David Okafor",
    age: 41,
    personality: { openness: 0.5, conscientiousness: 0.85, extraversion: 0.3, agreeableness: 0.55, neuroticism: 0.2 },
    occupation: "carpenter",
    homeId: "house_4",
    workId: "workshop",
    goals: [
      { description: "Yog'ochsozlikning murakkab yangi usulini o'zlashtirish", kind: "personal", priority: 0.55 },
      { description: "Tinch va sodda hayotni saqlash", kind: "personal", priority: 0.4 },
    ],
    beliefs: ["Sifatli ish o'zi haqida gapiradi", "Ortiqcha muloqot charchatadi"],
  },
  {
    name: "Priya Nair",
    age: 31,
    personality: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.6, agreeableness: 0.85, neuroticism: 0.35 },
    occupation: "shopkeeper",
    homeId: "house_5",
    workId: "general_store",
    goals: [
      { description: "Har bir doimiy mijozni ismi bilan bilish", kind: "social", priority: 0.5 },
      { description: "Ishongan odamiga yaqinroq bo'lish", kind: "romantic", priority: 0.45 },
    ],
    beliefs: ["Yaxshi yuritilgan do'kon ko'chaning yuragidir", "Odamlar sen ularga qanday munosabatda bo'lganingni eslab qolishadi"],
  },
];

export function defaultSchedule(homeId: string, workId: string): AgentSchedulePoint[] {
  return [
    { hour: 7, locationId: homeId, activity: ACTIVITY.wakingUp },
    { hour: 8, locationId: workId, activity: ACTIVITY.working },
    { hour: 12, locationId: "cafe", activity: ACTIVITY.havingLunch },
    { hour: 13, locationId: workId, activity: ACTIVITY.working },
    { hour: 18, locationId: "square", activity: ACTIVITY.unwinding },
    { hour: 20, locationId: homeId, activity: ACTIVITY.relaxingHome },
    { hour: 22, locationId: homeId, activity: ACTIVITY.sleeping },
  ];
}

export function createInitialAgents(nowMinute: number): Agent[] {
  return SEEDS.map((seed) => {
    const home = findLocation(seed.homeId)!;
    return {
      id: randomUUID(),
      name: seed.name,
      age: seed.age,
      personality: seed.personality,
      needs: { hunger: 80, energy: 85, social: 60, fun: 60, hygiene: 90 },
      emotion: { valence: 0.2, arousal: 0.3, label: "mamnun" },
      beliefs: seed.beliefs,
      goals: seed.goals.map((g) => ({ id: randomUUID(), progress: 0, ...g })),
      money: 150,
      skill: 15,
      occupation: seed.occupation,
      homeId: seed.homeId,
      workId: seed.workId,
      position: { x: home.x, z: home.z },
      currentLocationId: seed.homeId,
      currentActivity: ACTIVITY.sleeping,
      schedule: defaultSchedule(seed.homeId, seed.workId),
      createdAtMin: nowMinute,
      updatedAtMin: nowMinute,
    };
  });
}
