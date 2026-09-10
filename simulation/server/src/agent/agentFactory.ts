import type { Agent, AgentSchedulePoint, Personality } from "../types.js";
import { findLocation } from "../world/locations.js";
import { randomUUID } from "node:crypto";

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
      { description: "Build a loyal circle of regulars and friends", kind: "social", priority: 0.6 },
      { description: "Save enough to expand the bakery", kind: "career", priority: 0.5 },
    ],
    beliefs: ["Kindness returns to you eventually", "A good morning routine sets the whole day"],
  },
  {
    name: "Marcus Webb",
    age: 34,
    personality: { openness: 0.4, conscientiousness: 0.65, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.25 },
    occupation: "farmer",
    homeId: "house_2",
    workId: "farm",
    goals: [
      { description: "Keep the farm profitable through the season", kind: "career", priority: 0.7 },
      { description: "Find someone to share quiet evenings with", kind: "romantic", priority: 0.4 },
    ],
    beliefs: ["Hard work is its own reward", "The land tells you what it needs if you listen"],
  },
  {
    name: "Sofia Chen",
    age: 24,
    personality: { openness: 0.85, conscientiousness: 0.5, extraversion: 0.8, agreeableness: 0.65, neuroticism: 0.45 },
    occupation: "cafe_barista",
    homeId: "house_3",
    workId: "cafe",
    goals: [
      { description: "Meet interesting people passing through town", kind: "social", priority: 0.65 },
      { description: "Save up to travel somewhere new", kind: "personal", priority: 0.5 },
    ],
    beliefs: ["Every stranger has a good story", "Routines are fine but adventure matters more"],
  },
  {
    name: "David Okafor",
    age: 41,
    personality: { openness: 0.5, conscientiousness: 0.85, extraversion: 0.3, agreeableness: 0.55, neuroticism: 0.2 },
    occupation: "carpenter",
    homeId: "house_4",
    workId: "workshop",
    goals: [
      { description: "Master a difficult new woodworking technique", kind: "personal", priority: 0.55 },
      { description: "Keep a peaceful, uncomplicated life", kind: "personal", priority: 0.4 },
    ],
    beliefs: ["Quality work speaks for itself", "Too much socializing is exhausting"],
  },
  {
    name: "Priya Nair",
    age: 31,
    personality: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.6, agreeableness: 0.85, neuroticism: 0.35 },
    occupation: "shopkeeper",
    homeId: "house_5",
    workId: "general_store",
    goals: [
      { description: "Know every regular customer by name", kind: "social", priority: 0.5 },
      { description: "Grow closer to someone she trusts", kind: "romantic", priority: 0.45 },
    ],
    beliefs: ["A well-run shop is the heart of a street", "People remember how you treat them"],
  },
];

export function defaultSchedule(homeId: string, workId: string): AgentSchedulePoint[] {
  return [
    { hour: 7, locationId: homeId, activity: "waking up" },
    { hour: 8, locationId: workId, activity: "working" },
    { hour: 12, locationId: "cafe", activity: "having lunch" },
    { hour: 13, locationId: workId, activity: "working" },
    { hour: 18, locationId: "square", activity: "unwinding in town" },
    { hour: 20, locationId: homeId, activity: "relaxing at home" },
    { hour: 22, locationId: homeId, activity: "sleeping" },
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
      emotion: { valence: 0.2, arousal: 0.3, label: "content" },
      beliefs: seed.beliefs,
      goals: seed.goals.map((g) => ({ id: randomUUID(), progress: 0, ...g })),
      money: 150,
      occupation: seed.occupation,
      homeId: seed.homeId,
      workId: seed.workId,
      position: { x: home.x, z: home.z },
      currentLocationId: seed.homeId,
      currentActivity: "sleeping",
      schedule: defaultSchedule(seed.homeId, seed.workId),
      createdAtMin: nowMinute,
      updatedAtMin: nowMinute,
    };
  });
}
