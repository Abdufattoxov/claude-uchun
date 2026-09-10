import type Database from "better-sqlite3";
import type { Relationship, RelationshipState } from "../types.js";

/** Canonical (unordered-pair) key so (a,b) and (b,a) share one row. */
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const STATE_ORDER: RelationshipState[] = [
  "stranger",
  "acquaintance",
  "friend",
  "close_friend",
  "romantic_interest",
  "partner",
  "family",
];

/** Affinity thresholds that promote a relationship out of "stranger". */
function stateForAffinity(current: RelationshipState, affinity: number): RelationshipState {
  if (current === "partner" || current === "family") return current; // sticky, requires explicit action
  if (current === "romantic_interest" && affinity >= 70) return "partner";
  if (affinity >= 60) return "close_friend";
  if (affinity >= 30) return "friend";
  if (affinity >= 10) return "acquaintance";
  if (affinity <= -20) return "stranger";
  return current === "stranger" ? "acquaintance" : current;
}

export class RelationshipStore {
  constructor(private readonly db: Database.Database) {}

  get(a: string, b: string): Relationship {
    const [x, y] = pairKey(a, b);
    const row = this.db
      .prepare(`SELECT * FROM relationships WHERE agent_a = ? AND agent_b = ?`)
      .get(x, y) as Record<string, unknown> | undefined;
    if (!row) {
      return { agentA: x, agentB: y, state: "stranger", affinity: 0 };
    }
    return {
      agentA: row.agent_a as string,
      agentB: row.agent_b as string,
      state: row.state as RelationshipState,
      affinity: row.affinity as number,
      lastInteractionMin: (row.last_interaction_min as number) ?? undefined,
    };
  }

  allFor(agentId: string): Relationship[] {
    const rows = this.db
      .prepare(`SELECT * FROM relationships WHERE agent_a = ? OR agent_b = ?`)
      .all(agentId, agentId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      agentA: row.agent_a as string,
      agentB: row.agent_b as string,
      state: row.state as RelationshipState,
      affinity: row.affinity as number,
      lastInteractionMin: (row.last_interaction_min as number) ?? undefined,
    }));
  }

  /** Apply an affinity delta from an interaction and recompute state. */
  adjustAffinity(a: string, b: string, delta: number, nowMinute: number): Relationship {
    const current = this.get(a, b);
    const affinity = Math.max(-100, Math.min(100, current.affinity + delta));
    const state = stateForAffinity(current.state, affinity);
    const [x, y] = pairKey(a, b);
    this.db
      .prepare(
        `INSERT INTO relationships (agent_a, agent_b, state, affinity, last_interaction_min)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent_a, agent_b) DO UPDATE SET
           state = excluded.state, affinity = excluded.affinity, last_interaction_min = excluded.last_interaction_min`
      )
      .run(x, y, state, affinity, nowMinute);
    return { agentA: x, agentB: y, state, affinity, lastInteractionMin: nowMinute };
  }

  rank(state: RelationshipState): number {
    return STATE_ORDER.indexOf(state);
  }
}
