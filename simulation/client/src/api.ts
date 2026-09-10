import type { AgentDetail, StateMessage, WorldEventView, WorldInfo } from "./types";

const API_BASE = "/api";

export async function fetchWorld(): Promise<WorldInfo> {
  const res = await fetch(`${API_BASE}/world`);
  return res.json();
}

export async function fetchAgentDetail(id: string): Promise<AgentDetail> {
  const res = await fetch(`${API_BASE}/agents/${id}`);
  return res.json();
}

export async function fetchEvents(since: number): Promise<WorldEventView[]> {
  const res = await fetch(`${API_BASE}/admin/events?since=${since}`);
  return res.json();
}

export async function setPaused(paused: boolean): Promise<void> {
  await fetch(`${API_BASE}/admin/${paused ? "pause" : "resume"}`, { method: "POST" });
}

export async function setSpeed(multiplier: number): Promise<void> {
  await fetch(`${API_BASE}/admin/speed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ multiplier }),
  });
}

export async function setWeather(weather: string): Promise<void> {
  await fetch(`${API_BASE}/admin/weather`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weather }),
  });
}

export async function injectEvent(description: string): Promise<{ reactions: Array<{ name: string; reaction: string }> }> {
  const res = await fetch(`${API_BASE}/admin/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
  return res.json();
}

export interface WebSocketHandlers {
  onMessage: (msg: StateMessage) => void;
  /** Fired once the socket actually connects (including on reconnect). */
  onOpen?: () => void;
  /** Fired when the socket drops -- a reconnect attempt is always scheduled regardless. */
  onClose?: () => void;
}

export function connectWebSocket(handlers: WebSocketHandlers): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => handlers.onOpen?.();
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as StateMessage;
      if (msg.type === "state") handlers.onMessage(msg);
    } catch {
      /* ignore malformed frame */
    }
  };
  ws.onclose = () => {
    handlers.onClose?.();
    setTimeout(() => connectWebSocket(handlers), 1500);
  };
  return ws;
}
