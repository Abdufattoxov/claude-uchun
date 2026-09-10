# AI Civilization

A small, runnable 3D town simulation where a handful of autonomous
agents live out daily routines — waking up, working, eating, resting,
running into each other, forming relationships, earning and spending
money — driven by a deterministic needs/goals engine plus an optional
local LLM for dialogue and reasoning about unusual events.

This lives in `simulation/` inside the repo, alongside (and independent
of) the existing content-writing files at the repo root — nothing there
was touched.

> **Scientific note:** agents simulate emotions, beliefs, and
> decision-making computationally. Nothing here implies real
> subjective experience or consciousness; it's a testbed for emergent,
> apparently-autonomous behavior.

## What's implemented

| Phase | Status | Notes |
|---|---|---|
| 1. Project skeleton + sim loop | ✅ | `server/` — time system, persistence, tick loop |
| 2. 3D world | ✅ | `client/` — three.js town, day/night, weather, roads |
| 3. 5 autonomous agents | ✅ | Identity, personality, needs, goals, schedules |
| 4. Persistent memory | ✅ | SQLite-backed short/long-term memory, scored retrieval |
| 5. Decision system + LLM interface | ✅ | Utility AI + pluggable LLM (Ollama / deterministic fallback) |
| 6. Communication & relationships | ✅ | Co-located agents converse; relationship state machine |
| Admin dashboard + unknown events | ✅ | Web UI: inspect agents, control time/weather, inject events |
| 7-11 (economy depth, family/generations, 10k-agent scaling) | 📋 Planned | See `ROADMAP.md` |

## Architecture

```
simulation/
  server/           Node.js + TypeScript backend (the authoritative simulation)
    src/
      time/         TimeSystem — deterministic simulated clock, configurable speed
      world/        WorldEngine — weather, world events, static town layout
      agent/        Agent identity, factory (initial population), AgentEngine (tick loop)
      memory/       MemoryStore — persistent, scored recall (recency + importance + keywords)
      relationship/ RelationshipStore — stranger -> ... -> partner/family state machine
      economy/      EconomyStore — wages, transactions, balances
      decision/     Deterministic utility-based action selection (no LLM)
      llm/          LLMInterface — Ollama provider + zero-cost deterministic fallback
      controller/   SimulationController — the single tick loop tying it all together
      db/           SQLite schema + connection (better-sqlite3)
      index.ts      Express REST API + WebSocket state broadcast
  client/           Vite + TypeScript + three.js frontend
    src/
      scene.ts      3D town rendering, agent movement, day/night, weather VFX
      main.ts        Admin dashboard wiring (agent list, inspector, controls, event log)
      api.ts        REST + WebSocket client
  docs/, README.md, ROADMAP.md
```

Each module talks to the others through plain TypeScript interfaces
(`src/types.ts`) — the decision system, for instance, has no idea the
LLM interface exists, and the LLM interface has no idea SQLite exists.
That's what makes phases 7-11 additive rather than a rewrite.

### Why agents don't call an LLM constantly

Every tick, each agent's needs decay and their position updates
deterministically — no model call. An agent only triggers the
(optional) LLM when it actually starts a conversation or when the
admin injects an "unknown event." Routine movement, scheduling, need
decay, and physics are 100% programmatic. This is what keeps the
architecture viable from 5 agents up toward thousands (see
`ROADMAP.md`).

### Agents don't know they're simulated

Prompts sent to the LLM (see `server/src/agent/conversation.ts`) frame
the agent purely as a person living in the town — their personality,
beliefs, mood, and recent memories — and never mention "AI," "agent,"
or "simulation." The admin dashboard is a separate observation layer;
injecting an event (e.g., "a glowing message appears in the sky")
creates a world event agents perceive and react to with their own
beliefs. They are never told an administrator caused it.

## Requirements

- Node.js 18+ (tested on 22)
- npm
- (Optional) [Ollama](https://ollama.com) running locally for real LLM-driven
  dialogue and event interpretation. Without it, the simulation runs
  fully and deterministically using a built-in fallback that produces
  varied, personality-flavored text — the app never blocks or breaks
  waiting for a model.

## Install & run

```bash
# Terminal 1 — backend
cd simulation/server
npm install
npm run dev          # starts on http://localhost:4000

# Terminal 2 — frontend
cd simulation/client
npm install
npm run dev           # starts on http://localhost:5173, proxies /api and /ws to :4000
```

Open http://localhost:5173. You should see a small town with 5 agents
moving between homes, workplaces, the cafe, the shop, and the park,
plus:

- A left-hand list of all agents with live needs bars, current
  activity, and money — click any card (or click an agent in the 3D
  view) to open a full inspector (personality, goals, relationships,
  memories, recent decisions).
- A top bar to pause/resume, change simulation speed, and change
  weather.
- A bottom-left admin panel to inject an "unknown event" — every agent
  independently reacts and forms a memory of it; watch the event log
  for their differing interpretations.

## Configuring the LLM

Set these environment variables before starting the server (defaults shown):

```bash
export OLLAMA_HOST=http://localhost:11434
export OLLAMA_MODEL=llama3.2
```

Install Ollama and pull a small model to get real generative dialogue:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2
ollama serve   # if not already running as a service
```

If Ollama isn't reachable, `server/src/llm/llmInterface.ts` automatically
uses `FallbackProvider` — a deterministic, zero-cost text generator so
the simulation is always fully runnable and testable without any
external dependency or API key.

To swap in a different backend entirely (a hosted API, a different
local runtime), implement the `LLMProvider` interface in
`server/src/llm/llmInterface.ts` and add it to `LLMInterface`. No other
module needs to change.

## Changing simulation speed

- At runtime: the "Speed" dropdown in the dashboard, or
  `POST /api/admin/speed { "multiplier": 60 }` (1 real minute = 60 sim
  minutes at the default).
- At startup: `TimeSystem`'s `multiplier` option in
  `server/src/controller/simulationController.ts` / `WorldEngine`.
- Pause/resume: the "Pause" button, or `POST /api/admin/pause` /
  `POST /api/admin/resume`.

## Adding agents

Initial population is defined in `server/src/agent/agentFactory.ts`
(`SEEDS` array — name, age, personality, occupation, home/workplace,
goals, beliefs). Add an entry there and delete `server/data/world.db`
(or just don't create it yet) to have it picked up on next boot — the
population is only created once, on first run, when the `agents` table
is empty.

Scaling beyond hand-authored seeds (10, 50, 100, 1,000+) is covered in
`ROADMAP.md`.

## How persistence works

All world state lives in a single SQLite file at
`server/data/world.db` (WAL mode): agent state, memories, relationships,
transactions, decision log, and world events/weather/clock. The
`SimulationController` persists every few ticks and on graceful
shutdown (`SIGINT`/`SIGTERM`). On restart, `WorldEngine` and
`AgentEngine` reload directly from this file — stop the process and
start it again, and the town picks up exactly where it left off
(same simulated day/hour, same agent needs, money, memories, and
relationships). Delete `server/data/world.db` to reset the world.

## Admin dashboard / API reference

| Endpoint | Purpose |
|---|---|
| `GET /api/state` | Full snapshot: time, weather, all agents (public state) |
| `GET /api/world` | Static town layout + current time/weather |
| `GET /api/agents/:id` | Full detail for one agent: personality, needs, memories, relationships, transactions, recent decisions |
| `GET /api/admin/events?since=<simMinute>` | Recent world events (weather changes, injected events, generated dialogue lines) |
| `POST /api/admin/pause` / `/resume` | Pause/resume the clock |
| `POST /api/admin/speed { multiplier }` | Change simulation speed |
| `POST /api/admin/weather { weather }` | Force weather to `clear`/`cloudy`/`rain`/`storm` |
| `POST /api/admin/event { description }` | Inject an "unknown event"; every agent reacts via the LLM interface and forms a memory of it |
| `ws://.../ws` | Live state broadcast (~2/sec) for the 3D view |

The dashboard is intentionally external: nothing an admin does is
announced to agents as coming from an administrator. Weather changes,
injected events, etc. are just world events agents perceive and reason
about with their own beliefs.

## Testing

```bash
cd simulation/server
npm test          # vitest: time system, world persistence, agent tick loop, decision logging
npm run typecheck
```

The client is typechecked with `npm run typecheck` (via `tsc --noEmit`)
and built with `npm run build`.
