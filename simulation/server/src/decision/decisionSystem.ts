import type { Agent, Needs, WorldLocation, WorldTime } from "../types.js";
import { LOCATIONS, findLocation } from "../world/locations.js";
import { ACTIVITY } from "../agent/activityLabels.js";

export type ActionType =
  | "go_to"
  | "work"
  | "eat"
  | "sleep"
  | "socialize"
  | "shop"
  | "relax"
  | "wander";

export interface AgentAction {
  type: ActionType;
  locationId: string;
  activityLabel: string;
  /** How long the activity should run, in sim minutes. */
  durationMin: number;
  targetAgentId?: string;
}

interface DecisionContext {
  agent: Agent;
  time: WorldTime;
  nearbyAgentIds: string[];
  /** Public/park spots, including any landmarks civic development has unlocked. */
  leisureLocations?: WorldLocation[];
}

const NEED_DECAY_WEIGHT: Record<keyof Needs, number> = {
  hunger: 1.0,
  energy: 0.9,
  social: 0.6,
  fun: 0.5,
  hygiene: 0.4,
};

interface Candidate {
  action: AgentAction;
  score: number;
}

/**
 * Deterministic, LLM-free utility system. Every tick where a decision
 * is actually needed (idle / activity finished / need critical), this
 * scores a handful of candidate actions from needs + goals + schedule +
 * personality, and returns the winner. The LLM is never consulted here
 * -- it only colors *how* an already-chosen social action plays out.
 */
export function decideNextAction(ctx: DecisionContext): AgentAction {
  const { agent, time } = ctx;
  const candidates: Candidate[] = [];

  const scheduled = scheduledLocationFor(agent, time.hour);

  // 1. Needs-driven candidates.
  candidates.push({
    action: mkAction("eat", pickFoodLocation(agent), ACTIVITY.eating),
    score: needScore(agent.needs.hunger) * NEED_DECAY_WEIGHT.hunger,
  });
  candidates.push({
    action: mkAction("sleep", agent.homeId, ACTIVITY.sleeping, 6 * 60),
    score: needScore(agent.needs.energy) * NEED_DECAY_WEIGHT.energy * (time.isDaytime ? 0.4 : 1.1),
  });
  candidates.push({
    action: mkAction("relax", "park", ACTIVITY.relaxingFun),
    score: needScore(agent.needs.fun) * NEED_DECAY_WEIGHT.fun * (0.6 + agent.personality.openness * 0.4),
  });
  candidates.push({
    action: mkAction("relax", agent.homeId, ACTIVITY.freshening, 30),
    score: needScore(agent.needs.hygiene) * NEED_DECAY_WEIGHT.hygiene,
  });

  // 2. Social candidate: stronger pull for extraverts and when lonely.
  if (ctx.nearbyAgentIds.length > 0) {
    const socialDrive =
      needScore(agent.needs.social) * NEED_DECAY_WEIGHT.social * (0.5 + agent.personality.extraversion * 0.5);
    candidates.push({
      action: mkAction("socialize", agent.currentLocationId ?? "square", ACTIVITY.talkingWithSomeone, 20, ctx.nearbyAgentIds[0]),
      score: socialDrive,
    });
  }

  // 3. Work: follows schedule + career goal priority, but only during work hours.
  if (agent.workId && scheduled?.locationId === agent.workId) {
    const careerGoal = agent.goals.find((g) => g.kind === "career");
    const drive = 0.55 + (careerGoal?.priority ?? 0) * 0.3 + agent.personality.conscientiousness * 0.2;
    candidates.push({ action: mkAction("work", agent.workId, ACTIVITY.working, 4 * 60), score: drive });
  }

  // 3b. Curiosity about what the town's own growth has built recently --
  // open-ended, stronger for curious (open) agents. Bypasses mkAction's
  // static-location lookup since these ids come straight from the world
  // engine's authoritative (static + civic-built) location list.
  const modernSpots = (ctx.leisureLocations ?? []).filter((l) => l.modern);
  if (modernSpots.length > 0) {
    const spot = modernSpots[Math.floor(Math.random() * modernSpots.length)];
    candidates.push({
      action: { type: "relax", locationId: spot.id, activityLabel: ACTIVITY.relaxingFun, durationMin: 45 },
      score: needScore(agent.needs.fun) * 0.45 * (0.5 + agent.personality.openness * 0.7),
    });
  }

  // 4. Shopping: mild, occasional pull, mostly need-independent.
  candidates.push({ action: mkAction("shop", "general_store", ACTIVITY.shopping, 30), score: 0.2 });

  // 5. Default: follow the routine schedule if nothing urgent wins.
  if (scheduled) {
    candidates.push({
      action: mkAction("go_to", scheduled.locationId, scheduled.activity, 60),
      score: 0.45,
    });
  }

  candidates.push({ action: mkAction("wander", "square", ACTIVITY.wandering), score: 0.15 });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].action;
}

/** Higher when the need is more depleted; 0 once fully satisfied. */
function needScore(value: number): number {
  const deficit = Math.max(0, 100 - value) / 100; // 0..1
  return Math.pow(deficit, 1.4); // convex: urgency ramps up sharply near empty
}

function pickFoodLocation(agent: Agent): string {
  return agent.needs.hunger < 30 ? "cafe" : agent.homeId;
}

function scheduledLocationFor(agent: Agent, hour: number) {
  let best = agent.schedule[0];
  for (const point of agent.schedule) {
    if (point.hour <= hour) best = point;
  }
  return best;
}

function mkAction(
  type: ActionType,
  locationId: string,
  activityLabel: string,
  durationMin = 45,
  targetAgentId?: string
): AgentAction {
  const loc: WorldLocation | undefined = findLocation(locationId);
  return { type, locationId: loc ? loc.id : LOCATIONS[0].id, activityLabel, durationMin, targetAgentId };
}
