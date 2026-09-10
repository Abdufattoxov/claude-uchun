# AI Civilization

A small, runnable 3D town simulation where a handful of autonomous
agents live out daily routines — waking up, working, eating, resting,
running into each other, forming relationships, earning and spending
money — where each agent's own reasoning (a real local LLM, when one
is connected) decides what they do and why, not a hardcoded script.

This lives in `simulation/` inside the repo, alongside (and independent
of) the existing content-writing files at the repo root — nothing there
was touched.

> **Connect Ollama for agents to actually think.** Every decision an
> agent makes is handed to its own "brain" (see below) -- but that
> brain only *reasons* when a real local model is reachable. Without
> Ollama running, agents fall back to plain instinct (the deterministic
> utility scoring in `decisionSystem.ts`) for every decision -- still
> autonomous and fully functional, just not deliberative. See
> "Configuring the LLM" below to turn real thinking on.

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
| 5. Decision system + LLM interface | ✅ | Agent's own LLM "brain" chooses freely from physically-available options; utility scoring demoted to instinct fallback — see below |
| 6. Communication & relationships | ✅ | Co-located agents converse; relationship state machine |
| Admin dashboard + unknown events | ✅ | Web UI: inspect agents, control time/weather, inject events |
| Self-improvement & civic development | ✅ | Agents grow career skill and complete/replace goals; the town itself expands from their collective labor — see below |
| 7-11 (economy depth, family/generations, 10k-agent scaling) | 📋 Planned | See `ROADMAP.md` |

### Every agent has its own mind, not a script

`decisionSystem.ts` used to *be* the decision-maker: a hand-tuned
formula that scored candidate actions and picked the winner. It's now
only the **instinct** an agent falls back on when nothing else is
available -- the actual decision-maker is `agent/brain.ts`.

At every decision point (idle, activity finished, arrived somewhere),
`AgentEngine.beginDecision`:
1. Puts the agent into a brief, visible "o'ylanib turibdi" (thinking)
   pause -- they stop, they don't act on autopilot.
2. Builds the *physical* menu of what someone standing here, with this
   job, these needs, and these people nearby, could concretely go do
   (`buildDecisionOptions`) -- this is the only place anything is
   "given" to the agent, and it's a list of real-world possibilities,
   never a ranking of them.
3. Hands that menu, plus the agent's full personality, needs, goals,
   beliefs, and recent memories, to `decideViaBrain`, which asks a real
   model to choose -- in character, in its own words, for its own
   reasons. Nothing here tells the model *when* to work, sleep, or
   socialize; it decides that itself, the way a person weighs their own
   day.
4. Commits whichever option the model picked, logging its stated
   reason verbatim (visible in the dashboard's "So'nggi qarorlar" and
   the 🧠 event-log entries) -- not a synthetic explanation I wrote.

If no model answers in a parseable way (most commonly: no Ollama
running, so the zero-cost `FallbackProvider` responds instead), the
agent's instinct (`decisionSystem.ts`'s utility scoring) takes over for
just that one decision -- the simulation is always fully autonomous and
runnable, but genuine deliberation requires a connected model. This
mirrors System-1/System-2 thinking: habit when you can't stop to
think, judgment when you can.

### Self-improvement and civic development

Two systems layered on top of the phase 1-6 MVP make agents feel like
they're perpetually striving, and make the town visibly grow as a
result of their own work rather than the admin dashboard:

- **Career skill & tiers** (`server/src/agent/labels.ts`,
  `AgentEngine.growSkill`): an agent's `skill` (0-100) grows slowly
  while they're on shift, scaled by conscientiousness. Crossing a
  threshold changes their displayed title (e.g. "novvoy" → "usta
  novvoy" → "professional novvoy" → "bosh novvoy") and raises their
  wage multiplier — a permanent, visible payoff for having worked, not
  just a number in an inspector.
- **Goals that never run out** (`AgentEngine.updateGoals`,
  `agent/goalPool.ts`): each goal's progress is recomputed from the
  agent's actual state (skill for career goals, relationship count for
  social goals, savings for personal goals, best relationship affinity
  for romantic goals). On completion it's logged as a memory and
  immediately replaced with a fresh goal from a pool matching that
  kind, so agents keep having something to work toward.
- **Civic development** (`server/src/world/civicDevelopment.ts`,
  `WorldEngine.contributeToCivicFund`): a fixed share of every wage an
  agent earns feeds a shared town fund. Crossing a milestone
  permanently and persistently adds a new landmark building at the
  town's edge (a clinic, a library, a solar park, an innovation hub, a
  tower) — the town literally expands outward over sim-time as a
  visible consequence of agents' own labor, not an admin action. New
  landmarks render with a distinct glass/glow look in the 3D view and
  become real destinations agents can wander to.
- **Reflections** (`AgentEngine.maybeReflect`,
  `agent/conversation.ts#generateReflection`): once per sim-day, an
  agent gets an LLM-generated moment of reflection on how their life
  is going, stored as a high-importance memory — this is what the
  `reflection` memory kind (defined from the start but previously
  unused) is for.

All of this is visible in the dashboard: the "Shahar rivojlanishi"
panel shows fund progress toward the next landmark, the event log
narrates tier-ups/goal completions/new buildings, and an agent's
inspector shows their current skill bar.

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
  `POST /api/admin/speed { "multiplier": 60 }`.
- The dropdown's first option, **"Normal (haqiqiy vaqt)"**, runs the
  clock at genuine real-time pace (1 sim-second per real second) so you
  can watch agents live without the day/night cycle or their schedules
  racing past — useful right after opening the dashboard, before
  switching to a faster option to fast-forward through quiet stretches.
  The other presets (10x-600x) are unchanged accelerations for that.
- At startup: `TimeSystem`'s `multiplier` option in
  `server/src/controller/simulationController.ts` / `WorldEngine`.
- Pause/resume: the "Pause" button, or `POST /api/admin/pause` /
  `POST /api/admin/resume`.

## Camera controls

The 3D view supports a free camera, not just a fixed angle:

- **Drag** (mouse or one finger) to orbit around the current look-at
  point.
- **Scroll wheel / pinch** (two fingers) to zoom in and out.
- **On-screen D-pad** (bottom-right) or **WASD / arrow keys** to pan
  across the whole map, relative to which way you're currently facing.
- The **⌂** button in the middle of the D-pad recenters the camera on
  the town.

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
npm test          # vitest: time system, world persistence, agent tick loop, decision logging,
                  # the LLM-brain decision path (mocked model + parse-failure fallback),
                  # skill/goal/civic-development growth over long simulated runs
npm run typecheck
```

The client is typechecked with `npm run typecheck` (via `tsc --noEmit`)
and built with `npm run build`.
