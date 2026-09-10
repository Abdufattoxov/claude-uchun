import { describe, it, expect } from "vitest";
import { openDatabase } from "../src/db/index.js";
import { SimulationController } from "../src/controller/simulationController.js";

describe("SimulationController + AgentEngine", () => {
  it("creates 5 initial agents", () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    expect(controller.agents.list().length).toBe(5);
  });

  it("advances time, keeps needs in bounds, and moves agents over many ticks", () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(60);

    const initialPositions = controller.agents.list().map((a) => ({ ...a.position }));

    for (let i = 0; i < 300; i++) {
      controller.tick();
    }

    for (const agent of controller.agents.list()) {
      for (const value of Object.values(agent.needs)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(Number.isFinite(agent.position.x)).toBe(true);
      expect(Number.isFinite(agent.position.z)).toBe(true);
    }

    const moved = controller.agents.list().some((agent, i) => {
      const start = initialPositions[i];
      return Math.hypot(agent.position.x - start.x, agent.position.z - start.z) > 0.01;
    });
    expect(moved).toBe(true);
    expect(controller.world.time.getTotalMinutes()).toBeGreaterThan(0);
  });

  it("persists agents to the database and reloads them", () => {
    const file = ":memory:";
    const db = openDatabase({ file });
    const controller = new SimulationController(db);
    for (let i = 0; i < 10; i++) controller.tick();
    controller.persist();

    const countRow = db.prepare("SELECT COUNT(*) as c FROM agents").get() as { c: number };
    expect(countRow.c).toBe(5);
  });

  it("records a decision log entry after enough ticks", () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(120);
    for (let i = 0; i < 50; i++) controller.tick();
    const row = db.prepare("SELECT COUNT(*) as c FROM decisions_log").get() as { c: number };
    expect(row.c).toBeGreaterThan(0);
  });

  it("agents actually meet and form at least one relationship over many simulated days", () => {
    const db = openDatabase({ file: ":memory:" });
    const controller = new SimulationController(db);
    controller.setSpeed(120);
    for (let i = 0; i < 800; i++) controller.tick();

    const relCount = (db.prepare("SELECT COUNT(*) as c FROM relationships").get() as { c: number }).c;
    expect(relCount).toBeGreaterThan(0);

    const conversationMemories = (
      db.prepare("SELECT COUNT(*) as c FROM memories WHERE kind = 'conversation'").get() as { c: number }
    ).c;
    expect(conversationMemories).toBeGreaterThan(0);
  });
});
