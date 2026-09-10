import { randomUUID } from "node:crypto";
import type { Agent, Personality } from "../types.js";
import { findLocation } from "../world/locations.js";
import { ACTIVITY } from "./activityLabels.js";
import { defaultSchedule } from "./agentFactory.js";
import { pickNextGoal } from "./goalPool.js";
import { randomOccupation, workplaceForOccupation } from "./labels.js";
import { randomLifespanYears } from "./lifeConstants.js";

const CHILD_NAMES = [
  "Sardor", "Malika", "Aziz", "Nilufar", "Jasur", "Gulnora", "Botir", "Zarina",
  "Sanjar", "Madina", "Rustam", "Dilnoza", "Bekzod", "Shahnoza", "Farrux", "Ozoda",
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * A child inherits a blend of both parents' traits, plus some natural
 * variance -- nobody is a pure copy of either parent, same as real
 * families. Nurture (applyNurture, below) reshapes this further over
 * the years of actual upbringing.
 */
function blendPersonality(a: Personality, b: Personality): Personality {
  const blend = (x: number, y: number) => clamp01((x + y) / 2 + (Math.random() - 0.5) * 0.3);
  return {
    openness: blend(a.openness, b.openness),
    conscientiousness: blend(a.conscientiousness, b.conscientiousness),
    extraversion: blend(a.extraversion, b.extraversion),
    agreeableness: blend(a.agreeableness, b.agreeableness),
    neuroticism: blend(a.neuroticism, b.neuroticism),
  };
}

/** Safe simulation mechanic: birth happens as a discrete event after a
 * gestation timer, never as a modeled physical process (see AgentEngine's
 * startPregnancy/performBirth). */
export function createChildAgent(parentA: Agent, parentB: Agent, nowMinute: number): Agent {
  const name = CHILD_NAMES[Math.floor(Math.random() * CHILD_NAMES.length)];
  const home = findLocation(parentA.homeId) ?? findLocation(parentB.homeId);
  return {
    id: randomUUID(),
    name,
    age: 0,
    birthSimMinute: nowMinute,
    lifespanYears: randomLifespanYears(),
    stage: "child",
    personality: blendPersonality(parentA.personality, parentB.personality),
    needs: { hunger: 90, energy: 90, social: 80, fun: 85, hygiene: 90 },
    emotion: { valence: 0.4, arousal: 0.4, label: "mamnun" },
    beliefs: [],
    goals: [],
    money: 0,
    skill: 0,
    occupation: undefined,
    homeId: parentA.homeId,
    workId: undefined,
    parentIds: [parentA.id, parentB.id],
    spouseId: undefined,
    position: home ? { x: home.x, z: home.z } : { ...parentA.position },
    currentLocationId: parentA.homeId,
    currentActivity: ACTIVITY.playing,
    schedule: defaultSchedule(parentA.homeId, parentA.homeId),
    createdAtMin: nowMinute,
    updatedAtMin: nowMinute,
  };
}

const NURTURE_RATE_PER_MIN = 0.0000015;

/**
 * Ongoing upbringing, not just inherited traits: a child's personality
 * keeps drifting, slowly, toward whichever parents are actually raising
 * them -- so the same child would grow up differently around different
 * parents, the way a real person is shaped by how they're raised.
 */
export function applyNurture(child: Agent, parents: Agent[], deltaMinutes: number): void {
  if (parents.length === 0) return;
  const rate = NURTURE_RATE_PER_MIN * deltaMinutes;
  (Object.keys(child.personality) as Array<keyof Personality>).forEach((key) => {
    const parentAvg = parents.reduce((sum, p) => sum + p.personality[key], 0) / parents.length;
    child.personality[key] = clamp01(child.personality[key] + (parentAvg - child.personality[key]) * rate);
  });
}

/**
 * Coming of age: from here on the agent is a fully autonomous adult --
 * their own brain (agent/brain.ts) decides everything, the same as
 * anyone born into the founding generation. Mutates in place.
 */
export function comingOfAge(agent: Agent, nowMinute: number): void {
  agent.stage = "adult";
  const occupation = randomOccupation();
  agent.occupation = occupation;
  agent.workId = workplaceForOccupation(occupation);
  agent.skill = 5;
  agent.money = Math.max(agent.money, 60);
  agent.beliefs = [...agent.beliefs, "O'z kuchiga ishonib, mustaqil hayot yo'lini tanladi"];
  agent.goals = [
    { id: randomUUID(), ...pickNextGoal("career", 0.5) },
    { id: randomUUID(), ...pickNextGoal("personal", 0.45) },
  ];
  agent.schedule = defaultSchedule(agent.homeId, agent.workId);
  agent.updatedAtMin = nowMinute;
}
