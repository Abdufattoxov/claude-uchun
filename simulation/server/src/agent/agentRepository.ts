import type Database from "better-sqlite3";
import type { Agent } from "../types.js";

export class AgentRepository {
  constructor(private readonly db: Database.Database) {}

  loadAll(): Agent[] {
    const rows = this.db.prepare(`SELECT * FROM agents WHERE alive = 1`).all() as Array<Record<string, unknown>>;
    return rows.map(rowToAgent);
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM agents WHERE alive = 1`).get() as { c: number };
    return row.c;
  }

  upsert(agent: Agent): void {
    this.db
      .prepare(
        `INSERT INTO agents (
           id, name, age, personality, needs, emotion, beliefs, goals, money, skill,
           occupation, home_id, work_id, pos_x, pos_z, current_location_id,
           current_activity, activity_ends_at_min, created_at_min, updated_at_min,
           birth_sim_minute, lifespan_years, stage, parent_ids, spouse_id, expecting_since_min
         ) VALUES (
           @id, @name, @age, @personality, @needs, @emotion, @beliefs, @goals, @money, @skill,
           @occupation, @homeId, @workId, @posX, @posZ, @currentLocationId,
           @currentActivity, @activityEndsAtMin, @createdAtMin, @updatedAtMin,
           @birthSimMinute, @lifespanYears, @stage, @parentIds, @spouseId, @expectingSinceMin
         )
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, age=excluded.age, personality=excluded.personality,
           needs=excluded.needs, emotion=excluded.emotion, beliefs=excluded.beliefs,
           goals=excluded.goals, money=excluded.money, skill=excluded.skill, occupation=excluded.occupation,
           home_id=excluded.home_id, work_id=excluded.work_id, pos_x=excluded.pos_x,
           pos_z=excluded.pos_z, current_location_id=excluded.current_location_id,
           current_activity=excluded.current_activity,
           activity_ends_at_min=excluded.activity_ends_at_min,
           updated_at_min=excluded.updated_at_min,
           birth_sim_minute=excluded.birth_sim_minute, lifespan_years=excluded.lifespan_years,
           stage=excluded.stage, parent_ids=excluded.parent_ids, spouse_id=excluded.spouse_id,
           expecting_since_min=excluded.expecting_since_min`
      )
      .run({
        id: agent.id,
        name: agent.name,
        age: agent.age,
        personality: JSON.stringify(agent.personality),
        needs: JSON.stringify(agent.needs),
        emotion: JSON.stringify(agent.emotion),
        beliefs: JSON.stringify(agent.beliefs),
        goals: JSON.stringify(agent.goals),
        money: agent.money,
        skill: agent.skill,
        occupation: agent.occupation ?? null,
        homeId: agent.homeId,
        workId: agent.workId ?? null,
        posX: agent.position.x,
        posZ: agent.position.z,
        currentLocationId: agent.currentLocationId ?? null,
        currentActivity: agent.currentActivity,
        activityEndsAtMin: agent.activityEndsAtMin ?? null,
        createdAtMin: agent.createdAtMin,
        updatedAtMin: agent.updatedAtMin,
        birthSimMinute: agent.birthSimMinute,
        lifespanYears: agent.lifespanYears,
        stage: agent.stage,
        parentIds: JSON.stringify(agent.parentIds),
        spouseId: agent.spouseId ?? null,
        expectingSinceMin: agent.expectingSinceMin ?? null,
      });
    // schedule isn't persisted per-row (static per seed); rebuilt from factory on load if missing.
  }

  /** Marks an agent dead (natural end of life) without deleting the row,
   * so lineage (parentIds, past relationships/memories) stays intact. */
  markDead(id: string, diedAtMin: number): void {
    this.db
      .prepare(`UPDATE agents SET alive = 0, updated_at_min = ? WHERE id = ?`)
      .run(diedAtMin, id);
  }
}

function rowToAgent(r: Record<string, unknown>): Agent {
  return {
    id: r.id as string,
    name: r.name as string,
    age: r.age as number,
    birthSimMinute: (r.birth_sim_minute as number) ?? 0,
    lifespanYears: (r.lifespan_years as number) ?? 90,
    stage: (r.stage as Agent["stage"]) ?? "adult",
    personality: JSON.parse(r.personality as string),
    needs: JSON.parse(r.needs as string),
    emotion: JSON.parse(r.emotion as string),
    beliefs: JSON.parse(r.beliefs as string),
    goals: JSON.parse(r.goals as string),
    money: r.money as number,
    skill: (r.skill as number) ?? 0,
    occupation: (r.occupation as string) ?? undefined,
    homeId: r.home_id as string,
    workId: (r.work_id as string) ?? undefined,
    parentIds: JSON.parse((r.parent_ids as string) ?? "[]"),
    spouseId: (r.spouse_id as string) ?? undefined,
    expectingSinceMin: (r.expecting_since_min as number) ?? undefined,
    position: { x: r.pos_x as number, z: r.pos_z as number },
    currentLocationId: (r.current_location_id as string) ?? undefined,
    currentActivity: r.current_activity as string,
    activityEndsAtMin: (r.activity_ends_at_min as number) ?? undefined,
    schedule: [],
    createdAtMin: r.created_at_min as number,
    updatedAtMin: r.updated_at_min as number,
  };
}
