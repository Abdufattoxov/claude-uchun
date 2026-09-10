import type Database from "better-sqlite3";
import { WorldEngine } from "../world/worldEngine.js";
import { AgentEngine } from "../agent/agentEngine.js";

export interface SimulationControllerOptions {
  /** Real-world ms between ticks. */
  tickIntervalMs?: number;
  /** Persist world/agent state every N ticks. */
  persistEveryNTicks?: number;
  onTick?: (info: { simMinute: number }) => void;
}

/**
 * The single authoritative loop. Everything else (agent decisions,
 * memory formation, weather drift) is driven from here so there is one
 * place that controls pacing, LOD, and persistence cadence.
 */
export class SimulationController {
  readonly world: WorldEngine;
  readonly agents: AgentEngine;
  private readonly db: Database.Database;
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private readonly tickIntervalMs: number;
  private readonly persistEveryNTicks: number;
  private readonly onTick?: (info: { simMinute: number }) => void;

  constructor(db: Database.Database, opts: SimulationControllerOptions = {}) {
    this.db = db;
    this.world = new WorldEngine(db);
    this.agents = new AgentEngine(db, this.world);
    this.tickIntervalMs = opts.tickIntervalMs ?? 2000;
    this.persistEveryNTicks = opts.persistEveryNTicks ?? 5;
    this.onTick = opts.onTick;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.persist();
  }

  pause(): void {
    this.world.time.pause();
  }

  resume(): void {
    this.world.time.resume();
  }

  setSpeed(multiplier: number): void {
    this.world.time.setMultiplier(multiplier);
  }

  /** Advance the world by exactly one tick. Exposed for tests. */
  tick(): void {
    const deltaMinutes = this.world.time.tick();
    if (deltaMinutes === 0) return; // paused

    this.tickCount += 1;

    // Weather drifts roughly every couple of sim hours, not every tick.
    if (Math.random() < deltaMinutes / (60 * 3)) {
      this.world.maybeDriftWeather();
    }

    this.agents.tick(deltaMinutes);

    if (this.tickCount % this.persistEveryNTicks === 0) {
      this.persist();
    }

    this.onTick?.({ simMinute: this.world.time.getTotalMinutes() });
  }

  persist(): void {
    this.world.persistState();
    this.agents.persistAll();
  }
}
