import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { MemoryRecord } from "../types.js";

/**
 * Practical memory architecture: instead of stuffing an agent's whole
 * history into every LLM prompt, memories are persisted to SQLite and
 * retrieved on demand by a cheap score combining recency, importance,
 * and keyword overlap with the current situation. Only the top-K
 * results are ever handed to the LLM.
 */
const SHORT_TERM_CAPACITY = 12; // most recent raw memories kept "hot"
const RECENCY_HALF_LIFE_MIN = 60 * 12; // 12 sim-hours

export class MemoryStore {
  constructor(private readonly db: Database.Database) {}

  add(record: Omit<MemoryRecord, "id" | "tier">): MemoryRecord {
    const full: MemoryRecord = { ...record, id: randomUUID(), tier: "short" };
    this.db
      .prepare(
        `INSERT INTO memories (id, agent_id, sim_minute, kind, description, participants, location_id, importance, tier)
         VALUES (@id, @agentId, @simMinute, @kind, @description, @participants, @locationId, @importance, @tier)`
      )
      .run({
        id: full.id,
        agentId: full.agentId,
        simMinute: full.simMinute,
        kind: full.kind,
        description: full.description,
        participants: JSON.stringify(full.participants),
        locationId: full.locationId ?? null,
        importance: full.importance,
        tier: full.tier,
      });
    this.demoteOldShortTerm(full.agentId);
    return full;
  }

  /** Keep only the newest N memories tagged "short"; older ones age into "long". */
  private demoteOldShortTerm(agentId: string): void {
    const rows = this.db
      .prepare(
        `SELECT id FROM memories WHERE agent_id = ? AND tier = 'short' ORDER BY sim_minute DESC`
      )
      .all(agentId) as Array<{ id: string }>;
    if (rows.length <= SHORT_TERM_CAPACITY) return;
    const toDemote = rows.slice(SHORT_TERM_CAPACITY);
    const stmt = this.db.prepare(`UPDATE memories SET tier = 'long' WHERE id = ?`);
    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(id);
    });
    tx(toDemote.map((r) => r.id));
  }

  recentShortTerm(agentId: string, limit = SHORT_TERM_CAPACITY): MemoryRecord[] {
    return this.rowsToRecords(
      this.db
        .prepare(
          `SELECT * FROM memories WHERE agent_id = ? AND tier = 'short' ORDER BY sim_minute DESC LIMIT ?`
        )
        .all(agentId, limit)
    );
  }

  /**
   * Score-based retrieval over the full store. `keywords` are matched
   * loosely against the memory description; nowMinute drives recency
   * decay. This is intentionally simple (no embeddings/vector DB) so it
   * has zero extra infra cost and stays fast at 10k+ agents/memories.
   */
  retrieveRelevant(
    agentId: string,
    opts: { nowMinute: number; keywords?: string[]; limit?: number }
  ): MemoryRecord[] {
    const limit = opts.limit ?? 6;
    const all = this.rowsToRecords(
      this.db.prepare(`SELECT * FROM memories WHERE agent_id = ?`).all(agentId)
    );
    const keywords = (opts.keywords ?? []).map((k) => k.toLowerCase());

    const scored = all.map((m) => {
      const ageMin = Math.max(0, opts.nowMinute - m.simMinute);
      const recency = Math.pow(0.5, ageMin / RECENCY_HALF_LIFE_MIN);
      const desc = m.description.toLowerCase();
      const overlap = keywords.length
        ? keywords.filter((k) => desc.includes(k)).length / keywords.length
        : 0;
      const score = recency * 0.5 + m.importance * 0.35 + overlap * 0.15;
      return { m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit).map((s) => s.m);

    if (top.length) {
      const stmt = this.db.prepare(
        `UPDATE memories SET last_recalled_min = ? WHERE id = ?`
      );
      const tx = this.db.transaction((records: MemoryRecord[]) => {
        for (const r of records) stmt.run(opts.nowMinute, r.id);
      });
      tx(top);
    }
    return top;
  }

  private rowsToRecords(rows: unknown[]): MemoryRecord[] {
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      agentId: r.agent_id as string,
      simMinute: r.sim_minute as number,
      kind: r.kind as MemoryRecord["kind"],
      description: r.description as string,
      participants: JSON.parse((r.participants as string) ?? "[]"),
      locationId: (r.location_id as string) ?? undefined,
      importance: r.importance as number,
      lastRecalledMin: (r.last_recalled_min as number) ?? undefined,
      tier: r.tier as MemoryRecord["tier"],
    }));
  }
}
