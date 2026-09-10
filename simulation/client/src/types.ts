export type Weather = "clear" | "cloudy" | "rain" | "storm";

export interface WorldTime {
  totalMinutes: number;
  day: number;
  hour: number;
  minute: number;
  isDaytime: boolean;
}

export type LocationType = "house" | "workplace" | "shop" | "cafe" | "park" | "public";

export interface WorldLocation {
  id: string;
  name: string;
  type: LocationType;
  x: number;
  z: number;
  radius: number;
  modern?: boolean;
}

export interface NextMilestone {
  name: string;
  threshold: number;
}

export interface WorldInfo {
  locations: WorldLocation[];
  civicFund: number;
  nextMilestone: NextMilestone | null;
}

export interface Needs {
  hunger: number;
  energy: number;
  social: number;
  fun: number;
  hygiene: number;
}

export interface Emotion {
  valence: number;
  arousal: number;
  label: string;
}

export interface Goal {
  id: string;
  description: string;
  kind: string;
  priority: number;
  progress: number;
}

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
  emotion: Emotion;
  money: number;
  goals: Goal[];
}

export interface StateMessage {
  type: "state";
  time: WorldTime;
  weather: Weather;
  paused: boolean;
  multiplier: number;
  agents: AgentPublicState[];
}

export interface MemoryRecord {
  id: string;
  agentId: string;
  simMinute: number;
  kind: string;
  description: string;
  participants: string[];
  locationId?: string;
  importance: number;
}

export interface RelationshipView {
  agentA: string;
  agentB: string;
  state: string;
  affinity: number;
  otherAgentId: string;
  otherName: string;
}

export interface AgentDetail {
  agent: AgentPublicState & { beliefs: string[]; personality: Record<string, number>; homeId: string; workId?: string };
  memories: { shortTerm: MemoryRecord[]; longTerm: MemoryRecord[] };
  relationships: RelationshipView[];
  transactions: Array<{ simMinute: number; kind: string; amount: number; reason: string }>;
  recentDecisions: Array<{ simMinute: number; action: string; reason: string }>;
}

export interface WorldEventView {
  id: string;
  simMinute: number;
  kind: string;
  payload: Record<string, unknown>;
}
