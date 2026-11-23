import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { runServer } from "../packages/server/src/http.ts";
import type { MissionRoom } from "../packages/server/src/rooms.ts";
import type { GameState, ActorState } from "../packages/server/src/wire.ts";
import type { Action, Family, Mission, Profile } from "../packages/shared/src/content.ts";
import { RESCUE_HEALTH, type CombatEvent } from "../packages/shared/src/combat.ts";
import { routeMarkers, TERMINAL_READERS_COMPLETE } from "../packages/shared/src/scene.ts";

type Socket = Room<any, GameState>;

function connectHandlers(room: Socket) {
  room.reconnection.minUptime = 0;
  room.onMessage("profile", () => {});
  room.onMessage("story", () => {});
  room.onMessage("combat", () => {});
  room.onMessage("notice", () => {});
  return room;
}

async function until<T>(label: string, check: () => T | undefined | false, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = check();
    if (result) return result;
    await delay(20);
  }
  throw new Error("Timed out waiting for " + label);
}

async function player(origin: string, name: string) {
  const result = await fetch(origin + "/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  assert.equal(result.status, 201);
  const { token } = await result.json() as { token: string };
  const sdk = new Client(origin);
  sdk.auth.token = token;
  const request = (path: string) => fetch(origin + "/api/" + path, { headers: { Authorization: "Bearer " + token } });
  return {
    sdk, request,
    profile: async () => (await (await request("profile")).json() as { profile: Profile }).profile,
  };
}

function send(room: Socket, seq: number, x = 0, z = 0, action?: Action) {
  room.send("input", { seq, x, z, action });
}

async function local(room: Socket) {
  return until("local actor", () => room.state?.actors?.get(room.sessionId));
}

test("four clients join by code, rooms stay isolated, and a participant reconnects", { timeout: 18000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:", latency: 100 });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, gamma, delta, guest] = await Promise.all(["Alpha", "Beta", "Gamma", "Delta", "Guest"].map((name) => player(origin, name)));
    const party = connectHandlers(await alpha.sdk.create("mission", { mission: "chapter" }) as Socket);
    rooms.push(party);
    await local(party);
    const { id } = await (await beta.request("rooms/" + party.state.code)).json() as { id: string };
    assert.equal(id, party.roomId);
    const others = await Promise.all([beta, gamma, delta].map(async (account) => connectHandlers(await account.sdk.joinById(id) as Socket)));
    rooms.push(...others);
    const independent = connectHandlers(await guest.sdk.create("mission", { mission: "chapter" }) as Socket);
    rooms.push(independent);
    await local(independent);
    await until("all four party members", () => party.state.actors.size === 4);
    const member = others[0];
    const reconnecting = new Promise<void>((resolve) => member.onReconnect.once(resolve));
    member.connection.close(4010, "test drop");
    await Promise.race([reconnecting, delay(4200).then(() => { throw new Error("Reconnect did not settle"); })]);
    await until("connected remote actor", () => party.state.actors.get(member.sessionId)?.connected);
    member.send("begin");
    await delay(180);
    assert.equal(party.state.status, "lobby");
    party.send("begin");
    await until("leader start", () => member.state.status === "approach");
    assert.equal(independent.state.actors.size, 1);
    assert.equal(independent.state.status, "lobby");
    for (let n = 1; n <= 40; n++) {
      send(party, n, 1, 0, n === 1 ? "morph" : undefined);
      await delay(32);
    }
    await until("confirmed armed movement", () => {
      const actor = member.state.actors.get(party.sessionId);
      return actor?.armed && actor.x > -4;
    });
    await until("enemy wave hosted by the server", () => party.state.status === "combat");
    assert.equal(independent.state.status, "lobby");
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    server.game.simulateLatency(0);
    await server.stop();
  }
});

class TestCourier {
  seq = 0;
  readonly room: Socket;
  constructor(room: Socket) { this.room = room; }
  get me() { return this.room.state.actors.get(this.room.sessionId)!; }
  send(x: number, z: number, action?: Action) { send(this.room, ++this.seq, x, z, action); }
  async go(x: number, z: number, timeout = 8500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const dx = x - this.me.x, dz = z - this.me.z;
      if (Math.hypot(dx, dz) < .42) { this.send(0, 0); return; }
      this.send(Math.max(-1, Math.min(1, dx * 1.7)), Math.max(-1, Math.min(1, dz * 1.7)));
      await delay(35);
    }
    throw new Error("Could not move to the marker");
  }
  attack() {
    const actor = this.me;
    if (!actor.hp || !["idle", "jump"].includes(actor.phase)) { this.send(0, 0); return; }
    if (!actor.armed) { this.send(0, 0, "morph"); return; }
    const hostile = [...this.room.state.actors.values()].filter((item) => item.kind !== "player" && item.hp > 0)
      .sort((a, b) => this.distance(a) - this.distance(b))[0];
    if (!hostile) { this.send(0, 0); return; }
    const dx = hostile.x - actor.x, dz = hostile.z - actor.z;
    if (hostile.phase === "active" || (hostile.phase === "windup" && (hostile.kind !== "skitter" || hostile.age < 18))) {
      if (Math.abs(dz) < (hostile.kind === "keeper" ? 1.58 : 1.21) && Math.abs(dx) < 3)
        this.send(0, dz < -.08 ? 1 : dz > .08 ? -1 : actor.z > 0 ? 1 : -1, "dodge");
      else this.send(0, 0);
      return;
    }
    if (Math.abs(dz) > .56) { this.send(0, Math.sign(dz)); return; }
    if (dx * actor.facing < -.12) { this.send(Math.sign(dx), 0); return; }
    const max = actor.family === "brick" ? 1.23 : actor.family === "boar" ? 2.05 : 2.3;
    if (Math.abs(dx) > max) { this.send(Math.sign(dx), 0); return; }
    this.send(0, 0, actor.energy >= 28 && (hostile.kind !== "guard" || actor.family !== "moth") ? "skill" : "attack");
  }
  private distance(target: ActorState) { return Math.hypot(target.x - this.me.x, target.z - this.me.z); }
}

async function fight(couriers: TestCourier[], status: string, timeout = 36000) {
  const hub = couriers[0].room;
  const end = Date.now() + timeout;
  while (Date.now() < end && hub.state.status !== status) {
    if (hub.state.status === "failed") throw new Error("The party went down during the combat tour");
    for (const courier of couriers) courier.attack();
    await delay(37);
  }
  assert.equal(hub.state.status, status, "fight reached the expected phase");
}

test("a recalled companion can rescue a courier once, with the server confirming the result to both players", { timeout: 16000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:", latency: 100 });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta] = await Promise.all([player(origin, "Aster"), player(origin, "Mara")]);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "chapter" }) as Socket);
    rooms.push(first);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all([local(first), local(other)]);
    const confirmations: CombatEvent[][] = [[], []];
    for (const [index, connection] of rooms.entries()) {
      connection.onMessage("combat", (event: CombatEvent) => {
        if (event.type === "revive") confirmations[index].push(event);
      });
    }
    first.send("begin");
    await until("chapter entry", () => first.state.status === "approach");
    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    const helper = mission["players"].get(first.sessionId)!.player;
    const casualty = mission["players"].get(other.sessionId)!.player;
    // Seed a downed teammate between waves so no AI timing affects the interaction checks.
    mission.state.status = "interlude";
    Object.assign(helper, { x: -5, z: 0 });
    Object.assign(casualty, { x: -1, z: 0, hp: 0 });
    const a = new TestCourier(first), b = new TestCourier(other);
    await until("downed courier replicated", () => b.me.hp === 0);

    first.send("interact");
    await delay(220);
    assert.equal(a.me.rescueTarget, "", "out-of-range rescues are rejected");
    await a.go(-1.9, 0);
    a.send(0, 0, "morph");
    await until("helper armed", () => a.me.armed);
    first.send("interact");
    await delay(220);
    assert.equal(a.me.rescueTarget, "", "an armed companion cannot assist");
    a.send(0, 0, "morph");
    await until("helper recalled", () => !a.me.armed);

    first.send("interact");
    await until("channel visible to both players", () => a.me.rescueTicks > 0 && other.state.actors.get(first.sessionId)?.rescueTarget === other.sessionId);
    a.send(0, 1);
    await until("movement interrupted the rescue", () => a.me.rescueTarget === "");
    assert.equal(b.me.hp, 0);
    a.send(0, 0);
    await until("helper stationary", () => a.me.ack === a.seq && !a.me.moving);

    first.send("interact");
    await until("rescue is replicated", () => b.me.hp === RESCUE_HEALTH && b.me.rescued
      && first.state.actors.get(other.sessionId)?.hp === RESCUE_HEALTH);
    await until("both clients receive the rescue event", () => confirmations.every((events) => events.length === 1));
    const expected = { type: "revive", source: first.sessionId, target: other.sessionId, x: -1, z: 0 };
    assert.deepEqual(confirmations, [[expected], [expected]]);

    casualty.hp = 0;
    await until("courier downed again", () => b.me.hp === 0);
    first.send("interact");
    await delay(220);
    assert.equal(a.me.rescueTarget, "", "the same courier can only be rescued once per run");
    assert.equal(b.me.hp, 0);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    server.game.simulateLatency(0);
    await server.stop();
  }
});

test("the night platform unlocks after the chapter and records the register for the whole party", { timeout: 40000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all([player(origin, "Aster"), player(origin, "Mara"), player(origin, "Guest")]);
    await assert.rejects(alpha.sdk.create("mission", { mission: "night" }), /Clear The Last Crossing/);
    for (const account of [alpha, beta]) {
      const session = server.store.session(account.sdk.auth.token)!;
      server.store.reward([session.id], "chapter-unlock", "chapter");
    }
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "night" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear The Last Crossing/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);
    const a = new TestCourier(first), b = new TestCourier(other);
    first.send("begin");
    await until("platform arrival", () => first.state.status === "approach" && other.state.status === "approach");
    assert.equal(first.state.actors.size, 2);
    await Promise.all([a.go(-1.9, 0), b.go(-2.6, .65)]);
    await fight([a, b], "signal", 26000);
    for (const account of [alpha, beta]) assert.equal((await account.profile()).clears.includes("night"), false);

    const reader = a.me.hp > 0 ? a : b;
    await reader.go(8.25, 2.25);
    if (!reader.me.armed) reader.send(0, 0, "morph");
    await until("reader has their weapon armed", () => reader.me.armed);
    let blocked = false;
    reader.room.onMessage("notice", (message: string) => { blocked ||= message.includes("Recall your partner"); });
    reader.room.send("interact");
    await until("register asks for the recalled companion", () => blocked);
    assert.equal(first.state.status, "signal");
    reader.send(0, 0, "morph");
    await until("partner is recalled", () => !reader.me.armed && reader.me.phase === "idle");
    reader.room.send("interact");
    await until("both clients see the mission clear", () => first.state.status === "complete" && other.state.status === "complete");
    for (const account of [alpha, beta]) {
      const profile = await account.profile();
      assert.deepEqual(profile.clears, ["chapter", "night"]);
      assert.deepEqual(profile.lore, ["register"]);
      assert.deepEqual(profile.discovered, ["moth", "brick"]);
      assert.equal(profile.companion, "Neri");
      assert.equal(profile.battleXp, 112);
    }
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("return junction requires the night platform, preserves health between waves, and grants the turnout log once", { timeout: 65000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter-unlock", "chapter");
      if (account !== guest) server.store.reward([id], "night-unlock", "night");
    }
    await assert.rejects(guest.sdk.create("mission", { mission: "return" }), /Clear The Night Platform/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "return" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear The Night Platform/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);
    const a = new TestCourier(first), b = new TestCourier(other);
    const observations: number[][] = [[], []];
    for (const [index, room] of rooms.entries()) {
      room.onMessage("combat", (event: CombatEvent) => {
        if (event.type === "observe") observations[index].push(event.x);
      });
    }
    first.send("begin");
    await until("junction combat starts for both players", () => first.state.status === "combat" && other.state.status === "combat");
    await fight([a, b], "signal", 20000);
    assert.equal(first.state.wave, 0);

    const operator = a.me.hp > 0 ? a : b;
    await operator.go(8.25, 1.25);
    await until("operator is idle", () => operator.me.phase === "idle");
    if (!operator.me.armed) operator.send(0, 0, "morph");
    await until("operator is armed", () => operator.me.armed);
    let blocked = false;
    operator.room.onMessage("notice", (notice: string) => { blocked ||= notice.includes("Recall your partner"); });
    operator.room.send("interact");
    await until("signal rejects the armed companion", () => blocked);
    assert.equal(first.state.wave, 0);
    assert.equal(first.state.status, "signal");
    operator.send(0, 0, "morph");
    await until("operator's partner is recalled", () => !operator.me.armed && operator.me.phase === "idle");
    const health = [a.me.hp, b.me.hp];
    operator.room.send("interact");
    await until("the turnout opens the second wave", () => first.state.wave === 1 && other.state.wave === 1 && other.state.status === "combat");
    assert.deepEqual([a.me.hp, b.me.hp], health);
    for (const account of [alpha, beta]) assert.deepEqual((await account.profile()).lore, ["register"]);

    await fight([a, b], "signal", 30000);
    const reader = a.me.hp > 0 ? a : b;
    await reader.go(8.25, 1.25);
    await until("reader is idle", () => reader.me.phase === "idle");
    if (reader.me.armed) reader.send(0, 0, "morph");
    await until("reader's partner is recalled", () => !reader.me.armed && reader.me.phase === "idle");
    reader.room.send("interact");
    reader.room.send("interact");
    await until("both clients see the junction clear", () => first.state.status === "complete" && other.state.status === "complete");
    assert.deepEqual(observations, [[8.25, 8.25], [8.25, 8.25]]);
    for (const account of [alpha, beta]) {
      const profile = await account.profile();
      assert.deepEqual(profile.clears, ["chapter", "night", "return"]);
      assert.deepEqual(profile.lore, ["register", "turnout"]);
      assert.deepEqual(profile.discovered, ["moth", "brick"]);
      assert.equal(profile.companion, "Neri");
      assert.equal(profile.battleXp, 160);
      assert.equal(profile.bond, 16);
    }
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("East Terminal readers synchronize after reconnect and award a shared manifest", { timeout: 65000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter-unlock", "chapter");
      server.store.reward([id], "night-unlock", "night");
      if (account !== guest) server.store.reward([id], "junction-unlock", "return");
    }
    await assert.rejects(guest.sdk.create("mission", { mission: "terminal" }), /Clear Return Junction/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "terminal" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear Return Junction/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);

    const a = new TestCourier(first), b = new TestCourier(other);
    const [outbound, returning, manifest] = routeMarkers("terminal", 0);
    const notices: string[] = [];
    other.onMessage("notice", (notice: string) => { notices.push(notice); });
    const observations: string[][] = rooms.map((room) => {
      const sources: string[] = [];
      room.onMessage("combat", (event: CombatEvent) => { if (event.type === "observe") sources.push(event.source); });
      return sources;
    });
    first.send("begin");
    await until("both couriers enter East Terminal", () => first.state.status === "signal" && other.state.status === "signal");
    await Promise.all([a.go(outbound.x, outbound.z), b.go(manifest.x, manifest.z)]);
    other.send("interact");
    await until("manifest asks for both fare halves", () => notices.some((notice) => notice.includes("both halves")));
    assert.equal(first.state.readerMask, 0);

    await b.go(returning.x, returning.z);
    b.send(0, 0, "morph");
    await until("return reader operator arms", () => b.me.armed);
    other.send("interact");
    await until("return reader needs the partner recalled", () => notices.some((notice) => notice.includes("Recall your partner")));
    assert.equal(first.state.readerMask, 0);
    b.send(0, 0, "morph");
    await until("partner is recalled at the return reader", () => !b.me.armed && b.me.phase === "idle");
    other.send("interact");
    await until("both couriers see the return half", () => first.state.readerMask === returning.readerBit && other.state.readerMask === returning.readerBit);
    other.send("interact");
    await until("repeat use of the same reader is rejected", () => notices.some((notice) => notice.includes("already has its half")));
    assert.equal(first.state.status, "signal");

    const reconnecting = new Promise<void>((resolve) => other.onReconnect.once(resolve));
    other.connection.close(4010, "test drop");
    await Promise.race([reconnecting, delay(4200).then(() => { throw new Error("Reconnect did not settle"); })]);
    await until("reconnected courier still sees the latched reader", () => other.state.readerMask === returning.readerBit && b.me.connected);
    first.send("interact");
    await until("both fare halves activate the patrol", () => first.state.status === "combat" && other.state.status === "combat");
    assert.equal(first.state.readerMask, TERMINAL_READERS_COMPLETE);
    assert.equal(other.state.readerMask, TERMINAL_READERS_COMPLETE);
    for (const account of [alpha, beta]) assert.equal((await account.profile()).lore.includes("manifest"), false);

    await fight([a, b], "signal", 30000);
    const reader = a.me.hp > 0 ? a : b;
    await reader.go(manifest.x, manifest.z);
    await until("manifest reader stands idle", () => reader.me.phase === "idle");
    if (reader.me.armed) reader.send(0, 0, "morph");
    await until("manifest reader recalls their partner", () => !reader.me.armed && reader.me.phase === "idle");
    reader.room.send("interact");
    reader.room.send("interact");
    await until("both couriers see the chapter clear", () => first.state.status === "complete" && other.state.status === "complete");
    for (const sources of observations) assert.deepEqual(sources, [other.sessionId, first.sessionId, reader.room.sessionId]);
    for (const account of [alpha, beta]) {
      const profile = await account.profile();
      assert.deepEqual(profile.clears, ["chapter", "night", "return", "terminal"]);
      assert.deepEqual(profile.lore, ["register", "turnout", "manifest"]);
      assert.equal(profile.companion, "Neri");
      assert.equal(profile.battleXp, 208);
      assert.equal(profile.bond, 22);
    }
    first.send("begin");
    await until("replay resets both readers", () => first.state.status === "signal" && first.state.readerMask === 0);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("a solo courier can use both East Terminal readers and clear the patrol", { timeout: 55000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  let room: Socket | undefined;
  try {
    const account = await player("http://127.0.0.1:" + server.port, "Solo");
    const { id } = server.store.session(account.sdk.auth.token)!;
    for (const mission of ["chapter", "night", "return"] as const) server.store.reward([id], mission, mission);
    const terminal = room = connectHandlers(await account.sdk.create("mission", { mission: "terminal" }) as Socket);
    await local(terminal);
    const solo = new TestCourier(terminal);
    const [outbound, returning, manifest] = routeMarkers("terminal", 0);
    terminal.send("begin");
    await until("solo courier enters East Terminal", () => terminal.state.status === "signal");
    await solo.go(outbound.x, outbound.z);
    terminal.send("interact");
    await until("the outbound half is accepted first", () => terminal.state.readerMask === outbound.readerBit);
    await solo.go(returning.x, returning.z);
    terminal.send("interact");
    await until("the solo courier starts the patrol", () => terminal.state.status === "combat");
    await fight([solo], "signal", 30000);
    await solo.go(manifest.x, manifest.z);
    await until("manifest operator stands idle", () => solo.me.phase === "idle");
    if (solo.me.armed) solo.send(0, 0, "morph");
    await until("operator recalls their partner", () => !solo.me.armed && solo.me.phase === "idle");
    terminal.send("interact");
    await until("the solo courier clears East Terminal", () => terminal.state.status === "complete");
    assert.ok((await account.profile()).lore.includes("manifest"));
  } finally {
    try { await room?.leave(); }
    finally { await server.stop(); }
  }
});

test("Terminal Watch pays for each clear and requires a clean run for the Signal Tag", { timeout: 120000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter", "chapter");
      assert.equal(server.store.morph(id, "brick", "moth").ok, true);
      server.store.reward([id], "night", "night");
      server.store.reward([id], "return", "return");
      assert.equal(server.store.morph(id, "moth", "brick").ok, true);
      if (account !== guest) server.store.reward([id], "terminal", "terminal");
    }
    const party = [alpha, beta];
    const initial = await Promise.all(party.map((account) => account.profile()));
    for (const profile of initial) {
      assert.equal(profile.catalyst, false);
      assert.deepEqual(profile.catalystProgress, ["terminal"]);
    }

    await assert.rejects(guest.sdk.create("mission", { mission: "watch" }), /Clear East Terminal/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "watch" }) as Socket);
    rooms.push(first);
    await assert.rejects(guest.sdk.joinById(first.roomId), /Clear East Terminal/);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all([local(first), local(other)]);
    const a = new TestCourier(first), b = new TestCourier(other);
    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    const helper = mission["players"].get(first.sessionId)!.player;
    const casualty = mission["players"].get(other.sessionId)!.player;
    const begin = async () => {
      first.send("begin");
      await until("both clients in the first formation", () => [first, other].every((room) => room.state.status === "combat" && room.state.wave === 0));
    };
    const finish = async () => {
      const enemies = () => [...first.state.actors.values()].filter((actor) => actor.kind !== "player").map((actor) => actor.kind).sort();
      assert.deepEqual(enemies(), ["guard", "skitter"]);
      await fight([a, b], "interlude", 28000);
      await until("both clients in the second formation", () => [first, other].every((room) => room.state.status === "combat" && room.state.wave === 1));
      assert.deepEqual(enemies(), ["keeper", "skitter"]);
      await fight([a, b], "complete", 32000);
      await until("both clients see the contract clear", () => other.state.status === "complete");
    };
    const verifyRewards = async (clears: number, clean: boolean) => {
      for (const [index, account] of party.entries()) {
        const profile = await account.profile();
        assert.equal(profile.battleXp, initial[index].battleXp + clears * 28);
        assert.deepEqual(profile.lore, initial[index].lore);
        assert.equal(profile.catalyst, false);
        assert.deepEqual(profile.catalystProgress, initial[index].catalystProgress);
        assert.equal(profile.watchCommendation === true, clean);
        assert.equal(profile.trinket, initial[index].trinket);
      }
    };

    await begin();
    helper.hp = casualty.hp = 0;
    await until("the party can retry its wipe", () => first.state.status === "failed" && other.state.status === "failed");
    await verifyRewards(0, false);

    await begin();
    casualty.hp = 0;
    await until("both clients see a downed courier", () => !b.me.hp && first.state.actors.get(other.sessionId)?.hp === 0);
    first.send("interact");
    await until("the recalled companion performs a rescue", () => b.me.hp === RESCUE_HEALTH && b.me.rescued);
    await finish();
    await verifyRewards(1, false);

    const plaza = connectHandlers(await alpha.sdk.joinOrCreate("plaza") as Socket);
    rooms.push(plaza);
    await local(plaza);
    let updated: Profile | undefined;
    plaza.onMessage("profile", (profile: Profile) => { updated = profile; });
    const equipSignalTag = async () => {
      updated = undefined;
      plaza.send("customize", { trinket: "Signal Tag" });
      return until("the companion room replies to the keepsake change", () => updated);
    };
    assert.equal((await equipSignalTag()).trinket, initial[0].trinket);
    assert.equal(plaza.state.actors.get(plaza.sessionId)?.signalTag, false);

    await begin();
    await finish();
    await verifyRewards(2, true);
    assert.equal((await equipSignalTag()).trinket, "Signal Tag");
    assert.equal((await alpha.profile()).trinket, "Signal Tag");
    await until("the equipped keepsake is in actor state", () => plaza.state.actors.get(plaza.sessionId)?.signalTag);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("two players clear the chapter, see identical hit confirms, and keep rewards", { timeout: 85000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta] = await Promise.all([player(origin, "Aster"), player(origin, "Mara")]);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "chapter" }) as Socket);
    rooms.push(first);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all([local(first), local(other)]);
    const a = new TestCourier(first), b = new TestCourier(other);
    const confirmations: CombatEvent[][] = [[], []];
    for (const [index, connection] of [first, other].entries()) {
      connection.onMessage("combat", (event: CombatEvent) => { if (event.type === "hit") confirmations[index].push(event); });
    }
    first.send("begin");
    await until("chapter entry", () => first.state.status === "approach");
    await a.go(-4.2, 3);
    first.send("interact");
    await until("logged optional lore", asyncProfileProbe(alpha.profile, "log"));
    await Promise.all([a.go(-1.9, 0), b.go(-2.6, .65)]);
    await fight([a, b], "route");
    const entrant = a.me.hp > 0 ? a : b;
    await entrant.go(8.3, 0);
    entrant.room.send("interact");
    await until("relay room", () => other.state.stage === 1 && other.state.status === "combat");
    await fight([a, b], "signal");
    const survivor = a.me.hp > 0 ? a : b;
    await survivor.go(8.2, 0);
    survivor.room.send("interact");
    await until("chapter resolution", () => first.state.status === "complete" && other.state.status === "complete");
    assert.ok(confirmations[0].length > 5);
    assert.deepEqual(confirmations[0], confirmations[1]);
    for (const account of [alpha, beta]) {
      const progress = await account.profile();
      assert.equal(progress.battleXp, 64);
      assert.equal(progress.catalyst, true);
      assert.deepEqual(progress.discovered, ["moth", "brick"]);
    }
    await first.leave();
    const plaza = connectHandlers(await alpha.sdk.joinOrCreate("plaza") as Socket);
    rooms.push(plaza);
    await local(plaza);
    const visitor = new TestCourier(plaza);
    await visitor.go(-6.7, 2.8);
    plaza.send("changeFamily", { family: "brick", expectedFamily: "moth" });
    await until("gear changed", () => visitor.me.family === "brick");
    assert.equal((await alpha.profile()).battleXp, 0);
    assert.equal((await alpha.profile()).companion, "Neri");
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

function asyncProfileProbe(load: () => Promise<Profile>, lore: "log") {
  let result = false, loading = false;
  return () => {
    if (result) return true;
    if (!loading) {
      loading = true;
      void load().then((profile) => { result = profile.lore.includes(lore); }).finally(() => { loading = false; });
    }
    return false;
  };
}
