import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Transaction } from "../types.js";

const OCCUPATION_WAGES: Record<string, number> = {
  baker: 12,
  farmer: 10,
  carpenter: 14,
  shopkeeper: 11,
  cafe_barista: 9,
};

export function wageFor(occupation: string | undefined): number {
  if (!occupation) return 0;
  return OCCUPATION_WAGES[occupation] ?? 8;
}

export class EconomyStore {
  constructor(private readonly db: Database.Database) {}

  record(agentId: string, kind: Transaction["kind"], amount: number, reason: string, simMinute: number): Transaction {
    const tx: Transaction = { id: randomUUID(), agentId, simMinute, kind, amount, reason };
    this.db
      .prepare(
        `INSERT INTO transactions (id, agent_id, sim_minute, kind, amount, reason) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(tx.id, tx.agentId, tx.simMinute, tx.kind, tx.amount, tx.reason);
    return tx;
  }

  history(agentId: string, limit = 20): Transaction[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM transactions WHERE agent_id = ? ORDER BY sim_minute DESC LIMIT ?`
      )
      .all(agentId, limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      agentId: r.agent_id as string,
      simMinute: r.sim_minute as number,
      kind: r.kind as Transaction["kind"],
      amount: r.amount as number,
      reason: r.reason as string,
    }));
  }
}
