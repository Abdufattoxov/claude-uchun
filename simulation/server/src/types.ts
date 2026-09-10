// Core domain types shared across simulation modules.

export type Weather = "clear" | "cloudy" | "rain" | "storm";

export interface WorldTime {
  /** Total simulated minutes elapsed since world genesis. Source of truth. */
  totalMinutes: number;
  day: number; // 1-based
  hour: number; // 0-23
  minute: number; // 0-59
  isDaytime: boolean;
}

export type LocationType =
  | "house"
  | "workplace"
  | "shop"
  | "cafe"
  | "park"
  | "public";

export interface WorldLocation {
  id: string;
  name: string;
  type: LocationType;
  x: number;
  z: number;
  /** Radius within which an agent is considered "at" this location. */
  radius: number;
  capacity?: number;
  /** True for landmarks built later by the civic development system. */
  modern?: boolean;
}

export interface Personality {
  openness: number; // 0..1 curiosity, novelty seeking
  conscientiousness: number; // 0..1 discipline, reliability
  extraversion: number; // 0..1 sociability
  agreeableness: number; // 0..1 warmth, cooperation
  neuroticism: number; // 0..1 emotional volatility
}

export interface Needs {
  hunger: number; // 0 = starving, 100 = full
  energy: number; // 0 = exhausted, 100 = rested
  social: number; // 0 = lonely, 100 = fulfilled
  fun: number; // 0 = bored, 100 = entertained
  hygiene: number; // 0 = filthy, 100 = clean
}

export interface Emotion {
  /** -1 (very negative) .. 1 (very positive) */
  valence: number;
  /** 0 (calm) .. 1 (highly activated) */
  arousal: number;
  label: string; // human-readable derived label, e.g. "content", "anxious"
}

export interface Goal {
  id: string;
  description: string;
  kind: "need" | "social" | "career" | "personal" | "romantic";
  priority: number; // 0..1, higher = more important
  progress: number; // 0..1
}

export type RelationshipState =
  | "stranger"
  | "acquaintance"
  | "friend"
  | "close_friend"
  | "romantic_interest"
  | "partner"
  | "family";

export interface Relationship {
  agentA: string;
  agentB: string;
  state: RelationshipState;
  affinity: number; // -100..100
  lastInteractionMin?: number;
}

export interface MemoryRecord {
  id: string;
  agentId: string;
  simMinute: number;
  kind: "observation" | "conversation" | "reflection" | "event";
  description: string;
  participants: string[];
  locationId?: string;
  importance: number; // 0..1
  lastRecalledMin?: number;
  tier: "short" | "long";
}

export interface AgentSchedulePoint {
  hour: number;
  locationId: string;
  activity: string;
}

export type LifeStage = "child" | "adult";

export interface Agent {
  id: string;
  name: string;
  age: number;
  /** Sim-minute the agent was born; age is derived from this each tick. */
  birthSimMinute: number;
  /** This individual's natural lifespan, randomized around ~85-105 years at birth. */
  lifespanYears: number;
  stage: LifeStage;
  personality: Personality;
  needs: Needs;
  emotion: Emotion;
  beliefs: string[];
  goals: Goal[];
  money: number;
  occupation?: string;
  /** Career mastery, 0..100. Grows while working; unlocks occupation tiers. */
  skill: number;
  homeId: string;
  workId?: string;
  /** Biological/adoptive parents, if any -- empty for the founding generation. */
  parentIds: string[];
  spouseId?: string;
  /** Sim-minute a pregnancy/gestation began, if one is currently underway. */
  expectingSinceMin?: number;
  position: { x: number; z: number };
  targetPosition?: { x: number; z: number };
  currentLocationId?: string;
  currentActivity: string;
  activityEndsAtMin?: number;
  schedule: AgentSchedulePoint[];
  createdAtMin: number;
  updatedAtMin: number;
}

export interface Transaction {
  id: string;
  agentId: string;
  simMinute: number;
  kind: "income" | "expense";
  amount: number;
  reason: string;
}

export interface DecisionLogEntry {
  id: string;
  agentId: string;
  simMinute: number;
  action: string;
  reason: string;
  source: "utility" | "llm";
}

export type WorldEventKind =
  | "weather_change"
  | "unknown_event"
  | "admin_message"
  | "world_object"
  | "civic_development"
  | "goal_completed"
  | "career_tier_up"
  | "married"
  | "child_born"
  | "came_of_age"
  | "agent_death"
  | "home_built";

export interface WorldEvent {
  id: string;
  simMinute: number;
  kind: WorldEventKind;
  payload: Record<string, unknown>;
}
