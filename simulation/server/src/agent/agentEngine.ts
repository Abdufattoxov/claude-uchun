import type Database from "better-sqlite3";
import type { Agent, Goal, Needs } from "../types.js";
import { WorldEngine } from "../world/worldEngine.js";
import { AgentRepository } from "./agentRepository.js";
import { createInitialAgents, defaultSchedule } from "./agentFactory.js";
import { decideNextAction, type AgentAction } from "../decision/decisionSystem.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { RelationshipStore } from "../relationship/relationshipStore.js";
import { EconomyStore, wageFor } from "../economy/economyStore.js";
import { generateConversationLine, generateReflection, interpretUnknownEvent } from "./conversation.js";
import { ACTIVITY, isTalkingActivity, talkingWithLabel, walkingToLabel } from "./activityLabels.js";
import { NEED_LABEL_UZ, occupationTitle, skillWageMultiplier, tierFloor } from "./labels.js";
import { pickNextGoal } from "./goalPool.js";
import { buildDecisionOptions, decideViaBrain } from "./brain.js";
import { randomUUID } from "node:crypto";

const REFLECTION_INTERVAL_MIN = 24 * 60; // once per sim-day per agent
const SKILL_GROWTH_PER_MIN = 0.0035;
const CIVIC_CONTRIBUTION_RATE = 0.08; // share of every wage that builds the town

const MOVE_SPEED_PER_TICK = 3.2; // world units; decoupled from sim-time multiplier
const ARRIVE_EPSILON = 0.4;
const SOCIAL_RADIUS = 5; // agents within this distance can notice/greet each other

const BASE_DECAY_PER_MIN: Needs = { hunger: 0.05, energy: 0.035, social: 0.03, fun: 0.03, hygiene: 0.02 };

/** Per-activity need effects, applied per sim-minute while the activity runs. */
const ACTIVITY_EFFECTS: Record<string, Partial<Needs>> = {
  eat: { hunger: 1.3 },
  sleep: { energy: 0.7 },
  relax_fun: { fun: 0.9 },
  relax_hygiene: { hygiene: 1.6 },
  socialize: { social: 1.1 },
  work: { energy: -0.2 },
  shop: { fun: 0.3, hygiene: 0.1 },
};

export interface AgentPublicState {
  id: string;
  name: string;
  age: number;
  occupation?: string;
  skill: number;
  position: { x: number; z: number };
  currentLocationId?: string;
  currentActivity: string;
  needs: Needs;
  emotion: Agent["emotion"];
  money: number;
  goals: Agent["goals"];
}

interface RuntimeExtra {
  pendingAction?: AgentAction;
  talkingWith?: string;
  lastReflectionMin?: number;
  /** True while the agent's own brain (LLM) is deliberating over what to do next. */
  thinking?: boolean;
}

export class AgentEngine {
  private agents: Map<string, Agent> = new Map();
  private extra: Map<string, RuntimeExtra> = new Map();
  private readonly repo: AgentRepository;
  readonly memories: MemoryStore;
  readonly relationships: RelationshipStore;
  readonly economy: EconomyStore;
  private readonly recentDecisions: Map<
    string,
    { simMinute: number; action: string; reason: string; source: "llm" | "utility" }[]
  > = new Map();

  constructor(private readonly db: Database.Database, private readonly world: WorldEngine) {
    this.repo = new AgentRepository(db);
    this.memories = new MemoryStore(db);
    this.relationships = new RelationshipStore(db);
    this.economy = new EconomyStore(db);
    this.bootstrap();
  }

  private bootstrap(): void {
    const now = this.world.time.getTotalMinutes();
    let loaded = this.repo.loadAll();
    if (loaded.length === 0) {
      loaded = createInitialAgents(now);
      for (const a of loaded) this.repo.upsert(a);
    }
    for (const a of loaded) {
      a.schedule = defaultSchedule(a.homeId, a.workId ?? a.homeId);
      this.agents.set(a.id, a);
      this.extra.set(a.id, {});
    }
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  publicState(): AgentPublicState[] {
    return this.list().map((a) => ({
      id: a.id,
      name: a.name,
      age: a.age,
      occupation: a.occupation,
      skill: a.skill,
      position: a.position,
      currentLocationId: a.currentLocationId,
      currentActivity: a.currentActivity,
      needs: a.needs,
      emotion: a.emotion,
      money: a.money,
      goals: a.goals,
    }));
  }

  recentDecisionsFor(agentId: string) {
    return this.recentDecisions.get(agentId) ?? [];
  }

  persistAll(): void {
    for (const a of this.agents.values()) this.repo.upsert(a);
  }

  /** Main per-tick update for every agent. Called from SimulationController. */
  tick(deltaMinutes: number): void {
    const now = this.world.time.getTotalMinutes();

    for (const agent of this.agents.values()) {
      this.decayNeeds(agent, deltaMinutes);
      this.stepMovement(agent);

      const runtime = this.extra.get(agent.id)!;
      const arrived = !agent.targetPosition;

      if (arrived && agent.currentActivity && agent.activityEndsAtMin !== undefined) {
        this.applyActivityEffects(agent, deltaMinutes);
      }

      const needsDecision =
        arrived &&
        (agent.activityEndsAtMin === undefined || now >= agent.activityEndsAtMin) &&
        !runtime.talkingWith &&
        !runtime.thinking;

      if (needsDecision) {
        this.updateGoals(agent, now);
        this.beginDecision(agent, now);
      }

      this.maybeReflect(agent, now);
      agent.updatedAtMin = now;
    }

    this.resolveConversations(now);
  }

  private decayNeeds(agent: Agent, deltaMinutes: number): void {
    (Object.keys(BASE_DECAY_PER_MIN) as Array<keyof Needs>).forEach((key) => {
      agent.needs[key] = clamp(agent.needs[key] - BASE_DECAY_PER_MIN[key] * deltaMinutes);
    });
    this.updateEmotion(agent);
  }

  private updateEmotion(agent: Agent): void {
    const avgNeed = (agent.needs.hunger + agent.needs.energy + agent.needs.social + agent.needs.fun + agent.needs.hygiene) / 5;
    const valence = (avgNeed - 50) / 50; // -1..1
    const arousal = 1 - avgNeed / 100;
    agent.emotion = { valence, arousal, label: labelFor(valence, arousal) };
  }

  private stepMovement(agent: Agent): void {
    if (!agent.targetPosition) return;
    const dx = agent.targetPosition.x - agent.position.x;
    const dz = agent.targetPosition.z - agent.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= ARRIVE_EPSILON) {
      agent.position = { ...agent.targetPosition };
      agent.targetPosition = undefined;
      this.onArrive(agent);
      return;
    }
    const step = Math.min(MOVE_SPEED_PER_TICK, dist);
    agent.position = {
      x: agent.position.x + (dx / dist) * step,
      z: agent.position.z + (dz / dist) * step,
    };
  }

  private onArrive(agent: Agent): void {
    const runtime = this.extra.get(agent.id)!;
    const action = runtime.pendingAction;
    if (!action) return;
    const now = this.world.time.getTotalMinutes();
    agent.currentLocationId = action.locationId;
    agent.currentActivity = action.activityLabel;
    agent.activityEndsAtMin = now + action.durationMin;

    if (action.type === "socialize" && action.targetAgentId) {
      this.tryStartConversation(agent, action.targetAgentId, now);
    }
    runtime.pendingAction = undefined;
  }

  private applyActivityEffects(agent: Agent, deltaMinutes: number): void {
    const key = activityEffectKey(agent);
    const effects = ACTIVITY_EFFECTS[key];
    if (effects) {
      (Object.keys(effects) as Array<keyof Needs>).forEach((need) => {
        const delta = (effects[need] ?? 0) * deltaMinutes;
        agent.needs[need] = clamp(agent.needs[need] + delta);
      });
    }

    if (key === "work" && agent.occupation) {
      this.growSkill(agent, deltaMinutes);
    }
  }

  /** "Working on themselves": skill compounds slowly while on shift, permanently. */
  private growSkill(agent: Agent, deltaMinutes: number): void {
    const beforeTier = tierFloor(agent.skill);
    const rate = SKILL_GROWTH_PER_MIN * (0.6 + agent.personality.conscientiousness * 0.8);
    agent.skill = clamp(agent.skill + rate * deltaMinutes);
    if (tierFloor(agent.skill) === beforeTier) return;

    const now = this.world.time.getTotalMinutes();
    const title = occupationTitle(agent.occupation, agent.skill);
    this.memories.add({
      agentId: agent.id,
      simMinute: now,
      kind: "reflection",
      description: `Mahorati oshib, endi "${title}" darajasiga yetdi.`,
      participants: [],
      locationId: agent.currentLocationId,
      importance: 0.6,
    });
    this.world.logEvent("career_tier_up", { agentId: agent.id, name: agent.name, title });
  }

  /**
   * This is where an agent's own mind takes over: it's handed off to
   * decideViaBrain (agent/brain.ts), which lets a real model reason
   * through the agent's needs/personality/goals/memories and choose
   * for itself -- nothing here ranks the options for them. The agent
   * visibly pauses ("thinking") for the (usually few-second) duration
   * of that reasoning rather than freezing the whole tick loop, since
   * this is awaited per-agent, not blocking other agents' ticks.
   *
   * decisionSystem.ts's utility scoring is kept only as the instinct
   * agents fall back on when no real model answers in a parseable way
   * (e.g. the zero-cost FallbackProvider, which never runs when Ollama
   * is reachable) -- the same way a person falls back on habit when
   * they can't stop to deliberate.
   */
  private beginDecision(agent: Agent, now: number): void {
    const runtime = this.extra.get(agent.id)!;
    if (runtime.thinking) return;
    runtime.thinking = true;
    const previousActivity = agent.currentActivity;
    agent.currentActivity = ACTIVITY.thinking;
    agent.activityEndsAtMin = undefined;

    const nearbyAgentIds = this.nearbyAgents(agent);
    const nearby = nearbyAgentIds
      .map((id) => this.agents.get(id))
      .filter((a): a is Agent => Boolean(a))
      .map((a) => ({ id: a.id, name: a.name }));
    const options = buildDecisionOptions(agent, this.world, nearby);
    const memories = this.memories.recentShortTerm(agent.id, 6);
    const time = this.world.time.snapshot();
    const weather = this.world.getWeather();

    decideViaBrain(agent, options, memories, time, weather)
      .then(({ option, reason, provider }) => {
        this.commitDecision(agent, previousActivity, option.action, reason, "llm");
        this.world.logEvent("admin_message", { kind: "thought", agent: agent.name, line: reason, provider });
      })
      .catch(() => {
        const fallback = decideNextAction({
          agent,
          time,
          nearbyAgentIds,
          leisureLocations: this.world.leisureLocations(),
        });
        this.commitDecision(agent, previousActivity, fallback, describeReason(agent, fallback), "utility");
      })
      .finally(() => {
        runtime.thinking = false;
      });
  }

  private commitDecision(
    agent: Agent,
    previousActivity: string,
    action: AgentAction,
    reason: string,
    source: "llm" | "utility"
  ): void {
    const now = this.world.time.getTotalMinutes();

    // Settle wages if finishing a work shift (fixed 4h shifts, see decisionSystem/brain).
    // Skill (grown continuously during the shift, see growSkill) raises the wage --
    // and a slice of every wage funds the town's own civic development.
    if (previousActivity === ACTIVITY.working && agent.occupation) {
      const pay = Math.round(wageFor(agent.occupation) * skillWageMultiplier(agent.skill) * 4 * 100) / 100;
      agent.money += pay;
      this.economy.record(agent.id, "income", pay, `${occupationTitle(agent.occupation, agent.skill)} sifatida ish haqi`, now);
      this.world.contributeToCivicFund(pay * CIVIC_CONTRIBUTION_RATE);
    }
    if (action.type === "eat" && action.locationId === "cafe") {
      const cost = 6;
      if (agent.money >= cost) {
        agent.money -= cost;
        this.economy.record(agent.id, "expense", cost, "kafeda tushlik", now);
      }
    }
    if (action.type === "shop") {
      const cost = 8;
      if (agent.money >= cost) {
        agent.money -= cost;
        this.economy.record(agent.id, "expense", cost, "do'konda xarid", now);
      }
    }

    const loc = this.world.findLocation(action.locationId);
    const runtime = this.extra.get(agent.id)!;
    runtime.pendingAction = action;
    if (loc && distance(agent.position, loc) <= 0.5) {
      // Already there -- resolve arrival immediately instead of waiting for a movement tick.
      agent.position = { x: loc.x, z: loc.z };
      this.onArrive(agent);
    } else if (loc) {
      agent.targetPosition = { x: loc.x, z: loc.z };
      agent.currentActivity = walkingToLabel(loc.name);
      agent.activityEndsAtMin = undefined;
    }

    this.logDecision(agent.id, now, action.type, reason, source);
  }

  /**
   * Physical proximity, not exact location-id/arrival-state matching.
   * Using distance means two agents converging on the same public spot
   * count as "nearby" while still finishing their approach, not only
   * after both have reached the exact same coordinates on the same
   * tick -- which, given short public-space stays, would make chance
   * encounters vanishingly rare.
   */
  private nearbyAgents(agent: Agent): string[] {
    const result: string[] = [];
    for (const other of this.agents.values()) {
      if (other.id === agent.id) continue;
      if (distance(agent.position, other.position) <= SOCIAL_RADIUS) {
        result.push(other.id);
      }
    }
    return result;
  }

  private tryStartConversation(initiator: Agent, targetId: string, now: number): void {
    const target = this.agents.get(targetId);
    const runtimeInit = this.extra.get(initiator.id)!;
    const runtimeTarget = this.extra.get(targetId);
    if (!target || !runtimeTarget) return;
    if (runtimeTarget.talkingWith) return;

    runtimeInit.talkingWith = targetId;
    runtimeTarget.talkingWith = initiator.id;
    target.targetPosition = undefined; // stop wherever they are to chat
    initiator.currentActivity = talkingWithLabel(target.name);
    target.currentActivity = talkingWithLabel(initiator.name);
    initiator.activityEndsAtMin = now + 20;
    target.activityEndsAtMin = now + 20;

    const relationship = this.relationships.adjustAffinity(initiator.id, target.id, 4, now);
    const loc = this.world.findLocation(initiator.currentLocationId ?? "square")?.name ?? "ko'chada";

    this.memories.add({
      agentId: initiator.id,
      simMinute: now,
      kind: "conversation",
      description: `${loc}da ${target.name} bilan uchrashib, birozdan gaplashdi.`,
      participants: [target.id],
      locationId: initiator.currentLocationId,
      importance: 0.35,
    });
    this.memories.add({
      agentId: target.id,
      simMinute: now,
      kind: "conversation",
      description: `${loc}da ${initiator.name} bilan uchrashib, birozdan gaplashdi.`,
      participants: [initiator.id],
      locationId: target.currentLocationId,
      importance: 0.35,
    });

    // Fire-and-forget: the actual dialogue line is flavor text, generated
    // off the critical path so a slow/offline model never stalls the tick loop.
    const memoriesForPrompt = this.memories.recentShortTerm(initiator.id, 4);
    generateConversationLine(initiator, target, memoriesForPrompt, relationship, loc)
      .then(({ line, provider }) => {
        this.world.logEvent("admin_message", {
          kind: "dialogue",
          speaker: initiator.name,
          listener: target.name,
          line,
          provider,
          simMinute: now,
        });
      })
      .catch(() => void 0);
  }

  /**
   * Recomputed from current state rather than incrementally accumulated --
   * simpler and self-correcting (e.g. if a relationship later sours, a
   * social goal's progress drops back down instead of staying "stuck" at
   * a stale high value). Completing a goal immediately queues a fresh
   * one so an agent's ambitions never just run out.
   */
  private updateGoals(agent: Agent, now: number): void {
    for (let i = 0; i < agent.goals.length; i++) {
      const goal = agent.goals[i];
      goal.progress = this.computeGoalProgress(agent, goal);
      if (goal.progress < 1) continue;

      this.memories.add({
        agentId: agent.id,
        simMinute: now,
        kind: "reflection",
        description: `Maqsadiga erishdi: "${goal.description}".`,
        participants: [],
        locationId: agent.currentLocationId,
        importance: 0.7,
      });
      this.world.logEvent("goal_completed", { agentId: agent.id, name: agent.name, description: goal.description });
      agent.goals[i] = { id: randomUUID(), ...pickNextGoal(goal.kind, goal.priority) };
    }
  }

  private computeGoalProgress(agent: Agent, goal: Goal): number {
    switch (goal.kind) {
      case "career":
        return agent.skill / 100;
      case "personal":
        return Math.min(1, agent.money / 400);
      case "social": {
        const rels = this.relationships.allFor(agent.id);
        const friendRank = this.relationships.rank("friend");
        const friendCount = rels.filter((r) => this.relationships.rank(r.state) >= friendRank).length;
        return Math.min(1, friendCount / 3);
      }
      case "romantic": {
        const rels = this.relationships.allFor(agent.id);
        if (rels.some((r) => r.state === "partner")) return 1;
        const bestAffinity = rels.reduce((max, r) => Math.max(max, r.affinity), 0);
        return Math.max(0, Math.min(1, bestAffinity / 80));
      }
      default:
        return goal.progress;
    }
  }

  /** Once a sim-day, off the critical path: a quiet moment to think, not a tick-loop cost. */
  private maybeReflect(agent: Agent, now: number): void {
    const runtime = this.extra.get(agent.id)!;
    const last = runtime.lastReflectionMin ?? agent.createdAtMin;
    if (now - last < REFLECTION_INTERVAL_MIN) return;
    runtime.lastReflectionMin = now; // set before awaiting so a slow model can't cause repeat fires

    const memories = this.memories.recentShortTerm(agent.id, 8);
    generateReflection(agent, memories)
      .then(({ line, provider }) => {
        this.memories.add({
          agentId: agent.id,
          simMinute: now,
          kind: "reflection",
          description: line,
          participants: [],
          locationId: agent.currentLocationId,
          importance: 0.75,
        });
        this.world.logEvent("admin_message", { kind: "reflection", agent: agent.name, line, provider, simMinute: now });
      })
      .catch(() => void 0);
  }

  private resolveConversations(now: number): void {
    for (const [id, runtime] of this.extra.entries()) {
      if (!runtime.talkingWith) continue;
      const agent = this.agents.get(id)!;
      if (agent.activityEndsAtMin !== undefined && now >= agent.activityEndsAtMin) {
        runtime.talkingWith = undefined;
      }
    }
  }

  private logDecision(agentId: string, simMinute: number, action: string, reason: string, source: "llm" | "utility"): void {
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO decisions_log (id, agent_id, sim_minute, action, reason, source) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, agentId, simMinute, action, reason, source);
    const list = this.recentDecisions.get(agentId) ?? [];
    list.unshift({ simMinute, action, reason, source });
    this.recentDecisions.set(agentId, list.slice(0, 10));
  }

  /** Used by the admin "unknown event" endpoint: have each agent react via the LLM. */
  async broadcastUnknownEvent(description: string): Promise<Array<{ agentId: string; name: string; reaction: string; provider: string }>> {
    const now = this.world.time.getTotalMinutes();
    const results = [];
    for (const agent of this.agents.values()) {
      const memories = this.memories.recentShortTerm(agent.id, 4);
      const { line, provider } = await interpretUnknownEvent(agent, memories, description);
      this.memories.add({
        agentId: agent.id,
        simMinute: now,
        kind: "event",
        description: `G'alati bir narsani ko'rdi: ${description}. Munosabati: ${line}`,
        participants: [],
        locationId: agent.currentLocationId,
        importance: 0.8,
      });
      results.push({ agentId: agent.id, name: agent.name, reaction: line, provider });
    }
    return results;
  }
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function activityEffectKey(agent: Agent): string {
  const activity = agent.currentActivity;
  if (activity === ACTIVITY.eating) return "eat";
  if (activity === ACTIVITY.sleeping) return "sleep";
  if (activity === ACTIVITY.relaxingFun) return "relax_fun";
  if (activity === ACTIVITY.freshening) return "relax_hygiene";
  if (isTalkingActivity(activity)) return "socialize";
  if (activity === ACTIVITY.working) return "work";
  if (activity === ACTIVITY.shopping) return "shop";
  return "";
}

function describeReason(agent: Agent, action: AgentAction): string {
  const needs = agent.needs;
  const lowest = (Object.entries(needs) as Array<[keyof Needs, number]>).sort((a, b) => a[1] - b[1])[0];
  return `${action.activityLabel} (eng past ehtiyoj: ${NEED_LABEL_UZ[lowest[0]]} — ${Math.round(lowest[1])})`;
}

function labelFor(valence: number, arousal: number): string {
  if (valence > 0.4) return arousal > 0.5 ? "hayajonlangan" : "mamnun";
  if (valence < -0.4) return arousal > 0.5 ? "xavotirli" : "charchagan";
  return "beparvo";
}
