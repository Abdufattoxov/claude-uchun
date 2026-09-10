import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { openDatabase } from "./db/index.js";
import { SimulationController } from "./controller/simulationController.js";
import { LOCATIONS } from "./world/locations.js";
import type { Weather } from "./types.js";

const PORT = Number(process.env.PORT ?? 4000);

const db = openDatabase();
const controller = new SimulationController(db, { tickIntervalMs: 2000 });

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/world", (_req, res) => {
  res.json({ locations: LOCATIONS, time: controller.world.time.snapshot(), weather: controller.world.getWeather(), paused: controller.world.time.isPaused(), multiplier: controller.world.time.getMultiplier() });
});

app.get("/api/state", (_req, res) => {
  res.json({
    time: controller.world.time.snapshot(),
    weather: controller.world.getWeather(),
    paused: controller.world.time.isPaused(),
    multiplier: controller.world.time.getMultiplier(),
    agents: controller.agents.publicState(),
  });
});

app.get("/api/agents/:id", (req, res) => {
  const agent = controller.agents.get(req.params.id);
  if (!agent) return res.status(404).json({ error: "not found" });
  const now = controller.world.time.getTotalMinutes();
  const shortTerm = controller.agents.memories.recentShortTerm(agent.id, 12);
  const longTerm = controller.agents.memories.retrieveRelevant(agent.id, { nowMinute: now, limit: 10 });
  const relationships = controller.agents.relationships.allFor(agent.id).map((r) => {
    const otherId = r.agentA === agent.id ? r.agentB : r.agentA;
    const other = controller.agents.get(otherId);
    return { ...r, otherAgentId: otherId, otherName: other?.name ?? "unknown" };
  });
  res.json({
    agent,
    memories: { shortTerm, longTerm },
    relationships,
    transactions: controller.agents.economy.history(agent.id, 15),
    recentDecisions: controller.agents.recentDecisionsFor(agent.id),
  });
});

app.get("/api/admin/events", (req, res) => {
  const since = Number(req.query.since ?? 0);
  res.json(controller.world.recentEvents(since, 100));
});

app.post("/api/admin/pause", (_req, res) => {
  controller.pause();
  res.json({ paused: true });
});

app.post("/api/admin/resume", (_req, res) => {
  controller.resume();
  res.json({ paused: false });
});

app.post("/api/admin/speed", (req, res) => {
  const multiplier = Number(req.body?.multiplier);
  if (!multiplier || multiplier <= 0) return res.status(400).json({ error: "multiplier must be > 0" });
  controller.setSpeed(multiplier);
  res.json({ multiplier });
});

app.post("/api/admin/weather", (req, res) => {
  const weather = req.body?.weather as Weather;
  const valid: Weather[] = ["clear", "cloudy", "rain", "storm"];
  if (!valid.includes(weather)) return res.status(400).json({ error: `weather must be one of ${valid.join(", ")}` });
  const event = controller.world.setWeather(weather, "administrator tomonidan o'zgartirildi");
  res.json(event);
});

app.post("/api/admin/event", async (req, res) => {
  const description = String(req.body?.description ?? "").trim();
  if (!description) return res.status(400).json({ error: "description is required" });
  const event = controller.world.logEvent("unknown_event", { description });
  const reactions = await controller.agents.broadcastUnknownEvent(description);
  res.json({ event, reactions });
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

function broadcastState(): void {
  if (wss.clients.size === 0) return;
  const payload = JSON.stringify({
    type: "state",
    time: controller.world.time.snapshot(),
    weather: controller.world.getWeather(),
    paused: controller.world.time.isPaused(),
    multiplier: controller.world.time.getMultiplier(),
    agents: controller.agents.publicState(),
  });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

controller.start();
setInterval(broadcastState, 500);

httpServer.listen(PORT, () => {
  console.log(`AI Civilization server listening on http://localhost:${PORT}`);
});

function shutdown(): void {
  console.log("Shutting down, persisting world state...");
  controller.stop();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
