import type Database from "better-sqlite3";
import type { Weather, WorldEvent, WorldEventKind } from "../types.js";
import { TimeSystem } from "../time/timeSystem.js";
import { randomUUID } from "node:crypto";

const WEATHER_TRANSITIONS: Record<Weather, Weather[]> = {
  clear: ["clear", "clear", "cloudy"],
  cloudy: ["cloudy", "clear", "rain"],
  rain: ["rain", "cloudy", "storm"],
  storm: ["storm", "rain", "cloudy"],
};

/**
 * Owns global world state: the clock, weather, and the log of world
 * events (including admin-injected ones). Agents perceive this state
 * through normal senses -- nothing here is pushed into their reasoning
 * as "you are being observed" or "the admin did X".
 */
export class WorldEngine {
  readonly time: TimeSystem;
  private weather: Weather;
  private readonly db: Database.Database;

  constructor(db: Database.Database, time?: TimeSystem) {
    this.db = db;
    this.time = time ?? new TimeSystem();
    this.weather = "clear";
    this.loadState();
  }

  private loadState(): void {
    const row = this.db
      .prepare("SELECT value FROM world_state WHERE key = 'weather'")
      .get() as { value: string } | undefined;
    if (row) this.weather = row.value as Weather;

    const clockRow = this.db
      .prepare("SELECT value FROM world_state WHERE key = 'total_minutes'")
      .get() as { value: string } | undefined;
    if (clockRow) this.time.setTotalMinutes(Number(clockRow.value));

    const speedRow = this.db
      .prepare("SELECT value FROM world_state WHERE key = 'multiplier'")
      .get() as { value: string } | undefined;
    if (speedRow) this.time.setMultiplier(Number(speedRow.value));
  }

  persistState(): void {
    const upsert = this.db.prepare(
      `INSERT INTO world_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    upsert.run("weather", this.weather);
    upsert.run("total_minutes", String(this.time.getTotalMinutes()));
    upsert.run("multiplier", String(this.time.getMultiplier()));
  }

  getWeather(): Weather {
    return this.weather;
  }

  /** Deterministic weather drift, called occasionally (not every tick). */
  maybeDriftWeather(): void {
    const options = WEATHER_TRANSITIONS[this.weather];
    const next = options[Math.floor(Math.random() * options.length)];
    if (next !== this.weather) {
      this.setWeather(next, "tabiiy o'zgarish");
    }
  }

  setWeather(weather: Weather, cause: string): WorldEvent {
    this.weather = weather;
    return this.logEvent("weather_change", { weather, cause });
  }

  logEvent(kind: WorldEventKind, payload: Record<string, unknown>): WorldEvent {
    const event: WorldEvent = {
      id: randomUUID(),
      simMinute: this.time.getTotalMinutes(),
      kind,
      payload,
    };
    this.db
      .prepare(
        "INSERT INTO world_events (id, sim_minute, kind, payload) VALUES (?, ?, ?, ?)"
      )
      .run(event.id, event.simMinute, event.kind, JSON.stringify(event.payload));
    return event;
  }

  recentEvents(sinceMinute: number, limit = 50): WorldEvent[] {
    const rows = this.db
      .prepare(
        "SELECT id, sim_minute, kind, payload FROM world_events WHERE sim_minute >= ? ORDER BY sim_minute DESC LIMIT ?"
      )
      .all(sinceMinute, limit) as Array<{
      id: string;
      sim_minute: number;
      kind: WorldEventKind;
      payload: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      simMinute: r.sim_minute,
      kind: r.kind,
      payload: JSON.parse(r.payload),
    }));
  }
}
