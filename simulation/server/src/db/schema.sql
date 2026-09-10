-- AI Civilization persistent world database schema
-- SQLite. Kept intentionally simple/relational so it scales by adding
-- indices/sharding later rather than a rewrite.

CREATE TABLE IF NOT EXISTS world_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  age           INTEGER NOT NULL,
  personality   TEXT NOT NULL, -- JSON: {openness,conscientiousness,extraversion,agreeableness,neuroticism}
  needs         TEXT NOT NULL, -- JSON: {hunger,energy,social,fun,hygiene}
  emotion       TEXT NOT NULL, -- JSON: {mood, valence, arousal, label}
  beliefs       TEXT NOT NULL, -- JSON array of strings
  goals         TEXT NOT NULL, -- JSON array of Goal
  money         REAL NOT NULL DEFAULT 0,
  skill         REAL NOT NULL DEFAULT 0,
  occupation    TEXT,
  home_id       TEXT,
  work_id       TEXT,
  pos_x         REAL NOT NULL DEFAULT 0,
  pos_z         REAL NOT NULL DEFAULT 0,
  current_location_id TEXT,
  current_activity     TEXT,
  activity_ends_at_min INTEGER,
  created_at_min       INTEGER NOT NULL,
  updated_at_min       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id             TEXT PRIMARY KEY,
  agent_id       TEXT NOT NULL,
  sim_minute     INTEGER NOT NULL,
  kind           TEXT NOT NULL, -- observation | conversation | reflection | event
  description    TEXT NOT NULL,
  participants   TEXT NOT NULL DEFAULT '[]', -- JSON array of agent ids
  location_id    TEXT,
  importance     REAL NOT NULL DEFAULT 0.3, -- 0..1
  last_recalled_min INTEGER,
  tier           TEXT NOT NULL DEFAULT 'long', -- short | long
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, sim_minute DESC);

CREATE TABLE IF NOT EXISTS relationships (
  agent_a   TEXT NOT NULL,
  agent_b   TEXT NOT NULL,
  state     TEXT NOT NULL DEFAULT 'stranger',
  affinity  REAL NOT NULL DEFAULT 0,
  last_interaction_min INTEGER,
  PRIMARY KEY (agent_a, agent_b)
);

CREATE TABLE IF NOT EXISTS transactions (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  sim_minute INTEGER NOT NULL,
  kind       TEXT NOT NULL, -- income | expense
  amount     REAL NOT NULL,
  reason     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions_log (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL,
  sim_minute INTEGER NOT NULL,
  action     TEXT NOT NULL,
  reason     TEXT NOT NULL,
  source     TEXT NOT NULL -- utility | llm
);
CREATE INDEX IF NOT EXISTS idx_decisions_agent ON decisions_log(agent_id, sim_minute DESC);

CREATE TABLE IF NOT EXISTS locations (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  x              REAL NOT NULL,
  z              REAL NOT NULL,
  radius         REAL NOT NULL,
  modern         INTEGER NOT NULL DEFAULT 0,
  created_at_min INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_events (
  id         TEXT PRIMARY KEY,
  sim_minute INTEGER NOT NULL,
  kind       TEXT NOT NULL, -- weather_change | unknown_event | admin_message | world_object
  payload    TEXT NOT NULL -- JSON
);
