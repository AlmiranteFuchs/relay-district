import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express, { type Request } from "express";
import { configureRooms, MissionRoom, PlazaRoom, roomByCode } from "./rooms.ts";
import { Store } from "./store.ts";

const productionAssets = fileURLToPath(new URL("../../../dist", import.meta.url));

function authToken(request: Request) {
  return request.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1];
}

function allowsOrigin(origin: string, host: string | undefined) {
  if (!host) return false;
  try {
    const server = new URL("http://" + host);
    const browser = new URL(origin);
    return browser.hostname === server.hostname && (browser.protocol === "http:" || browser.protocol === "https:");
  } catch { return false; }
}

export async function runServer(config: { host?: string; port?: number; database?: string; latency?: number } = {}) {
  const host = config.host ?? "127.0.0.1";
  const port = config.port ?? 2567;
  const store = new Store(config.database ?? ".relay/relay.sqlite");
  configureRooms(store);
  const transport = new WebSocketTransport({ maxPayload: 16384 });
  const game = new Server({
    transport, gracefullyShutdown: false, greet: false,
    express(app) {
      app.use("/api", (req, res, next) => {
        const origin = req.get("origin");
        if (origin && !allowsOrigin(origin, req.get("host"))) {
          res.status(403).json({ error: "Open the client from the same host as the relay server." });
          return;
        }
        if (origin) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        }
        if (req.method === "OPTIONS") { res.sendStatus(204); return; }
        res.setHeader("Cache-Control", "no-store");
        next();
      });
      app.use("/api", express.json({ limit: "8kb" }));
      app.get("/api/health", (_req, res) => res.json({ ok: true }));
      app.post("/api/session", (req, res) => {
        if (authToken(req)) {
          const existing = store.session(authToken(req));
          if (!existing) { res.status(401).json({ error: "This guest session has expired or its database was reset." }); return; }
          res.json({ profile: existing.profile });
          return;
        }
        const record = store.create(typeof req.body?.name === "string" ? req.body.name : "Courier");
        res.status(201).json({ token: record.token, profile: record.profile });
      });
      app.get("/api/profile", (req, res) => {
        const session = store.session(authToken(req));
        if (!session) { res.status(401).json({ error: "Guest session required." }); return; }
        res.json({ profile: session.profile });
      });
      app.get("/api/rooms/:code", (req, res) => {
        if (!store.session(authToken(req))) { res.status(401).json({ error: "Guest session required." }); return; }
        const id = roomByCode(req.params.code);
        if (!id) { res.status(404).json({ error: "That room code is no longer active." }); return; }
        res.json({ id });
      });
      if (existsSync(productionAssets)) app.use(express.static(productionAssets));
    },
  });
  game.define("plaza", PlazaRoom);
  game.define("mission", MissionRoom);
  await game.listen(port, host);
  if (config.latency) game.simulateLatency(config.latency);
  return {
    game, store,
    port: (transport.server?.address() as { port?: number } | null)?.port ?? port,
    async stop() { await game.gracefullyShutdown(false); store.close(); },
  };
}
