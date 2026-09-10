import type Database from "better-sqlite3";
import type { Weather, WorldEvent, WorldEventKind, WorldLocation } from "../types.js";
import { TimeSystem } from "../time/timeSystem.js";
import { LOCATIONS, findLocation as findStaticLocation } from "./locations.js";
import { milestoneToLocation, nextMilestone, type CivicMilestone } from "./civicDevelopment.js";
import { randomUUID } from "node:crypto";

const WEATHER_TRANSITIONS: Record<Weather, Weather[]> = {
  clear: ["clear", "clear", "cloudy"],
  cloudy: ["cloudy", "clear", "rain"],
  rain: ["rain", "cloudy", "storm"],
  storm: ["storm", "rain", "cloudy"],
};

/**
 * Owns global world state: the clock, weather, the town's locations
 * (the original fixed layout plus anything the civic development
 * system has built since), and the log of world events (including
 * admin-injected ones). Agents perceive this state through normal
 * senses -- nothing here is pushed into their reasoning as "you are
 * being observed" or "the admin did X".
 */
export class WorldEngine {
  readonly time: TimeSystem;
  private weather: Weather;
  private readonly db: Database.Database;
  private dynamicLocations: WorldLocation[] = [];
  private civicFund = 0;

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

    const fundRow = this.db
      .prepare("SELECT value FROM world_state WHERE key = 'civic_fund'")
      .get() as { value: string } | undefined;
    if (fundRow) this.civicFund = Number(fundRow.value);

    const locRows = this.db.prepare("SELECT * FROM locations").all() as Array<Record<string, unknown>>;
    this.dynamicLocations = locRows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      type: r.type as WorldLocation["type"],
      x: r.x as number,
      z: r.z as number,
      radius: r.radius as number,
      modern: Boolean(r.modern),
    }));
  }

  persistState(): void {
    const upsert = this.db.prepare(
      `INSERT INTO world_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    upsert.run("weather", this.weather);
    upsert.run("total_minutes", String(this.time.getTotalMinutes()));
    upsert.run("multiplier", String(this.time.getMultiplier()));
    upsert.run("civic_fund", String(this.civicFund));
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

  // ---- Locations (static town layout + civic-development landmarks) ----

  allLocations(): WorldLocation[] {
    return [...LOCATIONS, ...this.dynamicLocations];
  }

  findLocation(id: string): WorldLocation | undefined {
    return findStaticLocation(id) ?? this.dynamicLocations.find((l) => l.id === id);
  }

  /** Public/park spots agents can wander to organically, including unlocked landmarks. */
  leisureLocations(): WorldLocation[] {
    return this.allLocations().filter((l) => l.type === "public" || l.type === "park");
  }

  private addLocation(loc: WorldLocation): void {
    this.dynamicLocations.push(loc);
    this.db
      .prepare(
        `INSERT INTO locations (id, name, type, x, z, radius, modern, created_at_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(loc.id, loc.name, loc.type, loc.x, loc.z, loc.radius, loc.modern ? 1 : 0, this.time.getTotalMinutes());
  }

  // ---- Civic development: the town grows from agents' own labor ----

  getCivicFund(): number {
    return this.civicFund;
  }

  getNextMilestone(): CivicMilestone | undefined {
    const builtIds = new Set(this.dynamicLocations.map((l) => l.id));
    return nextMilestone(builtIds);
  }

  /** Called whenever an agent gets paid; a slice of every wage builds the town. */
  contributeToCivicFund(amount: number): void {
    if (amount <= 0) return;
    this.civicFund += amount;
    const milestone = this.getNextMilestone();
    if (milestone && this.civicFund >= milestone.threshold) {
      this.addLocation(milestoneToLocation(milestone));
      this.logEvent("civic_development", {
        name: milestone.name,
        locationId: milestone.id,
        fundTotal: Math.round(this.civicFund),
      });
    }
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
