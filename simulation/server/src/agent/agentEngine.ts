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
import { applyNurture, comingOfAge, createChildAgent } from "./lifecycle.js";
import { ADULT_AGE_YEARS, CHILD_PREP_COST, GESTATION_MIN, HOUSE_BUILD_COST, ageYears } from "./lifeConstants.js";
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
  lifespanYears: number;
  stage: Agent["stage"];
  spouseId?: string;
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
      lifespanYears: a.lifespanYears,
      stage: a.stage,
      spouseId: a.spouseId,
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

    this.advanceLifeCycle(now);

    for (const agent of this.agents.values()) {
      if (agent.stage === "child") {
        this.tickChild(agent, deltaMinutes, now);
        continue;
      }

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

  /**
   * Aging, coming-of-age, gestation completion, and natural death --
   * run once per tick, before any agent's normal behavior, so nobody
   * acts on a tick where they've just been born, grown up, or died.
   */
  private advanceLifeCycle(now: number): void {
    const births: string[] = [];
    const deaths: Agent[] = [];

    for (const agent of this.agents.values()) {
      agent.age = ageYears(now, agent.birthSimMinute);

      if (agent.stage === "child" && agent.age >= ADULT_AGE_YEARS) {
        this.performComingOfAge(agent, now);
      }

      if (agent.age >= agent.lifespanYears) {
        deaths.push(agent);
        continue;
      }

      // Only the lexicographically-smaller id of a couple triggers the
      // birth, so a shared pregnancy isn't processed twice.
      if (
        agent.expectingSinceMin !== undefined &&
        agent.spouseId &&
        agent.id < agent.spouseId &&
        now - agent.expectingSinceMin >= GESTATION_MIN
      ) {
        births.push(agent.id);
      }
    }

    for (const id of births) {
      const parent = this.agents.get(id);
      if (parent) this.performBirth(parent, now);
    }
    for (const agent of deaths) {
      this.performDeath(agent, now);
    }
  }

  /** Children aren't brain-driven yet -- they stay near home, cared for
   * by their parents, while nurture slowly shapes who they'll become. */
  private tickChild(agent: Agent, deltaMinutes: number, now: number): void {
    this.decayNeeds(agent, deltaMinutes * 0.5);
    const home = this.world.findLocation(agent.homeId);
    if (home) {
      agent.needs.hunger = clamp(agent.needs.hunger + 0.6 * deltaMinutes);
      agent.needs.hygiene = clamp(agent.needs.hygiene + 0.3 * deltaMinutes);
      agent.needs.social = clamp(agent.needs.social + 0.2 * deltaMinutes);
      agent.currentLocationId = agent.homeId;
      agent.currentActivity = ACTIVITY.playing;
      agent.position = { x: home.x + (Math.random() - 0.5) * 2, z: home.z + (Math.random() - 0.5) * 2 };
    }
    const parents = agent.parentIds
      .map((id) => this.agents.get(id))
      .filter((a): a is Agent => Boolean(a));
    applyNurture(agent, parents, deltaMinutes);
    agent.updatedAtMin = now;
  }

  private performComingOfAge(agent: Agent, now: number): void {
    comingOfAge(agent, now);
    for (const parentId of agent.parentIds) {
      const parent = this.agents.get(parentId);
      if (!parent) continue;
      this.memories.add({
        agentId: parent.id,
        simMinute: now,
        kind: "event",
        description: `Farzandi ${agent.name} voyaga yetib, mustaqil hayot boshladi.`,
        participants: [agent.id],
        locationId: parent.currentLocationId,
        importance: 0.7,
      });
    }
    this.world.logEvent("came_of_age", { agentId: agent.id, name: agent.name });
  }

  private performBirth(parentA: Agent, now: number): void {
    const parentB = parentA.spouseId ? this.agents.get(parentA.spouseId) : undefined;
    if (!parentB) {
      parentA.expectingSinceMin = undefined;
      return;
    }
    const child = createChildAgent(parentA, parentB, now);
    this.agents.set(child.id, child);
    this.extra.set(child.id, {});
    this.repo.upsert(child);

    parentA.expectingSinceMin = undefined;
    parentB.expectingSinceMin = undefined;

    this.relationships.setState(parentA.id, child.id, "family", now);
    this.relationships.setState(parentB.id, child.id, "family", now);

    for (const parent of [parentA, parentB]) {
      this.memories.add({
        agentId: parent.id,
        simMinute: now,
        kind: "event",
        description: `${child.name} ismli farzandi dunyoga keldi.`,
        participants: [child.id],
        locationId: parent.currentLocationId,
        importance: 0.95,
      });
    }
    this.world.logEvent("child_born", {
      parentAId: parentA.id,
      parentAName: parentA.name,
      parentBId: parentB.id,
      parentBName: parentB.name,
      childId: child.id,
      childName: child.name,
    });
  }

  /**
   * Natural death: legacy memories for whoever was close to them, and
   * their savings passed on to children (or a surviving spouse) --
   * the row is marked dead, never deleted, so lineage/history survives.
   */
  private performDeath(agent: Agent, now: number): void {
    const children = [...this.agents.values()].filter((a) => a.parentIds.includes(agent.id));
    const spouse = agent.spouseId ? this.agents.get(agent.spouseId) : undefined;

    const heirs = children.length > 0 ? children : spouse ? [spouse] : [];
    if (heirs.length > 0 && agent.money > 0) {
      const share = agent.money / heirs.length;
      for (const heir of heirs) heir.money += share;
    }

    const notifyIds = new Set<string>();
    for (const rel of this.relationships.allFor(agent.id)) {
      if (this.relationships.rank(rel.state) >= this.relationships.rank("friend")) {
        notifyIds.add(rel.agentA === agent.id ? rel.agentB : rel.agentA);
      }
    }
    for (const child of children) notifyIds.add(child.id);
    if (spouse) notifyIds.add(spouse.id);

    for (const id of notifyIds) {
      const other = this.agents.get(id);
      if (!other) continue;
      this.memories.add({
        agentId: other.id,
        simMinute: now,
        kind: "event",
        description: `${agent.name} ${Math.round(agent.age)} yoshida vafot etdi. Uni doim yodda saqlaydi.`,
        participants: [agent.id],
        locationId: other.currentLocationId,
        importance: 0.95,
      });
    }

    if (spouse) {
      spouse.spouseId = undefined;
      // An in-progress shared pregnancy can't complete without both parents.
      spouse.expectingSinceMin = undefined;
    }

    this.world.logEvent("agent_death", { agentId: agent.id, name: agent.name, age: Math.round(agent.age) });
    this.repo.markDead(agent.id, now);
    this.agents.delete(agent.id);
    this.extra.delete(agent.id);
  }

  /**
   * A safe simulation mechanic, exactly as specced: no physical process
   * is modeled here, only a discrete decision (this) followed by a
   * gestation timer (see advanceLifeCycle) and a birth event.
   */
  private startPregnancy(agent: Agent, spouseId: string, now: number): void {
    const spouse = this.agents.get(spouseId);
    if (!spouse) return;
    if (agent.expectingSinceMin !== undefined || spouse.expectingSinceMin !== undefined) return;
    if (agent.money + spouse.money < CHILD_PREP_COST) return;

    const fromAgent = Math.min(agent.money, CHILD_PREP_COST);
    const fromSpouse = CHILD_PREP_COST - fromAgent;
    agent.money -= fromAgent;
    spouse.money -= fromSpouse;
    if (fromAgent > 0) this.economy.record(agent.id, "expense", fromAgent, "chaqaloq uchun tayyorgarlik", now);
    if (fromSpouse > 0) this.economy.record(spouse.id, "expense", fromSpouse, "chaqaloq uchun tayyorgarlik", now);

    agent.expectingSinceMin = now;
    spouse.expectingSinceMin = now;

    for (const [self, other] of [[agent, spouse] as const, [spouse, agent] as const]) {
      this.memories.add({
        agentId: self.id,
        simMinute: now,
        kind: "event",
        description: `${other.name} bilan farzand ko'rishni orzu qilib, tayyorgarlik ko'rdi.`,
        participants: [other.id],
        locationId: self.currentLocationId,
        importance: 0.8,
      });
    }
  }

  private finalizeMarriage(initiator: Agent, targetId: string, now: number): void {
    const target = this.agents.get(targetId);
    if (!target || initiator.spouseId || target.spouseId) return;

    initiator.spouseId = target.id;
    target.spouseId = initiator.id;
    this.relationships.setState(initiator.id, target.id, "family", now);

    initiator.currentActivity = `${target.name} bilan turmush qurdi`;
    target.currentActivity = `${initiator.name} bilan turmush qurdi`;
    initiator.activityEndsAtMin = now + 30;
    target.activityEndsAtMin = now + 30;

    this.memories.add({
      agentId: initiator.id,
      simMinute: now,
      kind: "event",
      description: `${target.name} bilan turmush qurdi.`,
      participants: [target.id],
      locationId: initiator.currentLocationId,
      importance: 0.9,
    });
    this.memories.add({
      agentId: target.id,
      simMinute: now,
      kind: "event",
      description: `${initiator.name} bilan turmush qurdi.`,
      participants: [initiator.id],
      locationId: target.currentLocationId,
      importance: 0.9,
    });
    this.world.logEvent("married", { a: initiator.id, aName: initiator.name, b: target.id, bName: target.name });
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
    } else if (action.type === "propose_marriage" && action.targetAgentId) {
      this.finalizeMarriage(agent, action.targetAgentId, now);
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

    const spouse = agent.spouseId ? this.agents.get(agent.spouseId) : undefined;
    const marriageCandidates = agent.spouseId
      ? []
      : nearby.filter((n) => {
          const other = this.agents.get(n.id);
          if (!other || other.spouseId || other.stage !== "adult") return false;
          return this.relationships.get(agent.id, n.id).state === "partner";
        });
    const childrenCount = [...this.agents.values()].filter((a) => a.parentIds.includes(agent.id)).length;
    const familyNote = [
      `Yoshingiz: ${Math.round(agent.age)} (taxminiy umr: ${Math.round(agent.lifespanYears)} yil).`,
      spouse ? `Turmush o'rtog'ingiz: ${spouse.name}.` : "Hali turmush qurmagansiz.",
      childrenCount > 0 ? `${childrenCount} ta farzandingiz bor.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const options = buildDecisionOptions(agent, this.world, nearby, {
      marriageCandidates,
      spouse: spouse
        ? { id: spouse.id, name: spouse.name, expecting: Boolean(agent.expectingSinceMin || spouse.expectingSinceMin) }
        : undefined,
    });
    const memories = this.memories.recentShortTerm(agent.id, 6);
    const time = this.world.time.snapshot();
    const weather = this.world.getWeather();

    decideViaBrain(agent, options, memories, time, weather, familyNote)
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
    if (action.type === "want_child" && action.targetAgentId) {
      this.startPregnancy(agent, action.targetAgentId, now);
    }
    if (action.type === "build_house") {
      // The location doesn't exist until the agent actually decides to
      // build it -- create it now, then let the normal movement flow
      // below walk them to their brand-new home.
      const built = this.world.addPersonalHome(`${agent.name} oilasi uyi`);
      agent.money -= HOUSE_BUILD_COST;
      agent.homeId = built.id;
      agent.schedule = defaultSchedule(built.id, agent.workId ?? built.id);
      this.economy.record(agent.id, "expense", HOUSE_BUILD_COST, "yangi uy qurish", now);
      this.memories.add({
        agentId: agent.id,
        simMinute: now,
        kind: "event",
        description: "Ota-ona uyidan chiqib, o'zining alohida uyini qurdi.",
        participants: [],
        locationId: built.id,
        importance: 0.8,
      });
      this.world.logEvent("home_built", { agentId: agent.id, name: agent.name, locationId: built.id, locationName: built.name });
      action = { ...action, locationId: built.id, activityLabel: ACTIVITY.relaxingHome };
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
