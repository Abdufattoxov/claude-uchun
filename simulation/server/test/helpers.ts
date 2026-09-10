import type { SimulationController } from "../src/controller/simulationController.js";

/**
 * Agent decisions are now made by an async "brain" (agent/brain.ts) --
 * a real LLM call when reachable, or the deterministic instinct
 * fallback otherwise -- rather than resolved synchronously inside
 * tick(). Tests must yield back to the event loop between ticks so
 * those pending decisions actually get a chance to settle, the same
 * way the real tick-interval-based server loop naturally does.
 */
export async function runTicks(controller: SimulationController, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    controller.tick();
    await new Promise((resolve) => setImmediate(resolve));
  }
}
