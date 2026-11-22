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
