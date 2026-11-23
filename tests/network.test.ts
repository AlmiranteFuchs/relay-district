import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { runServer } from "../packages/server/src/http.ts";
import type { MissionRoom } from "../packages/server/src/rooms.ts";
import type { GameState, ActorState } from "../packages/server/src/wire.ts";
import { availableTrinkets, BAY_FOUR_TICKET, BELLHOUSE_SEAL, RELAY_PENNANT, type Action, type Family, type Mission,
  type Profile } from "../packages/shared/src/content.ts";
import { RESCUE_HEALTH, type CombatEvent } from "../packages/shared/src/combat.ts";
import { COMPANION_PLAY, SIGNAL_COUNT, SIGNAL_PLAYBACK_MS, SIGNAL_ROUND_MS,
  type CompanionPlayMessage, type CompanionPlayRequest, type Signal } from "../packages/shared/src/companion-play.ts";
import { DISPATCH_INVITE, DISPATCH_RECENT_CREW, DISPATCH_RECENT_CREW_TTL_MS,
  type DispatchInvitation, type DispatchRecentCrew } from "../packages/shared/src/dispatch.ts";
import { ANNEX_CASE_HOME, ANNEX_FILING_DESK, ARCHIVE_CHANNELS_COMPLETE, BAY_RELAY_CALLS_COMPLETE, BAY_RELAY_STAGGER_TICKS, BELLHOUSE_CALLS,
  BELLHOUSE_CALLS_COMPLETE, DEPARTURE_REINFORCEMENT_TICKS,
  LIFT_LEG_TICKS, LIFT_PHASE, PUMP_LANES, PUMP_PHASE, PUMP_TIMING, routeMarkers, TERMINAL_READERS_COMPLETE,
  type BellhouseCue, VIADUCT_RELAY_TICKS } from "../packages/shared/src/scene.ts";

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

function crewAssists(room: Socket) {
  return [...room.state.crewAssists].map(({ kind, source, target, station }) => ({ kind, source, target, station }));
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

test("Dispatch delivers private invitations from the mission leader and couriers can opt into the lobby", { timeout: 22000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  const remember = (room: Socket) => {
    rooms.push(room);
    return connectHandlers(room);
  };
  try {
    const [alpha, beta, gamma, observer, locked, outside] =
      await Promise.all(["Aster", "Beta", "Gamma", "Observer", "Locked", "Outside"].map((name) => player(origin, name)));
    for (const account of [alpha, beta, gamma, observer, outside]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "dispatch-unlock", "chapter");
    }
    const host = remember(await alpha.sdk.create("plaza") as Socket);
    const [blue, green, bystander, lockedCourier] = await Promise.all([beta, gamma, observer, locked].map(async (account) =>
      remember(await account.sdk.joinById(host.roomId) as Socket)));
    const otherPlaza = remember(await outside.sdk.create("plaza") as Socket);
    await Promise.all(rooms.map(local));
    const invitations = new Map<string, DispatchInvitation[]>();
    for (const room of [host, blue, green, bystander, lockedCourier, otherPlaza]) {
      const list: DispatchInvitation[] = [];
      invitations.set(room.sessionId, list);
      room.onMessage(DISPATCH_INVITE, (notice: DispatchInvitation) => { list.push(notice); });
    }
    const notices = (room: Socket) => {
      const list: string[] = [];
      room.onMessage("notice", (notice: string) => { list.push(notice); });
      return list;
    };
    const hostNotices = notices(host);
    const nonleaderNotices = notices(bystander);
    const mission = remember(await alpha.sdk.create("mission", { mission: "night" }) as Socket);
    await local(mission);
    const leaderNotices = notices(mission);
    const sendInvites = (room: Socket, targets: Socket[]) =>
      room.send(DISPATCH_INVITE, { roomId: mission.roomId, targets: targets.map((target) => target.sessionId) });

    sendInvites(bystander, [blue]);
    await until("the server rejects a nonleader invitation", () => nonleaderNotices.some((notice) => notice.includes("Only the leader")));
    sendInvites(host, [blue, green, bystander, lockedCourier]);
    await until("the server bounds the batch", () => hostNotices.some((notice) => notice.includes("up to three couriers")));
    sendInvites(host, [lockedCourier, otherPlaza]);
    await until("the host sees the progress and plaza filters", () => leaderNotices.some((notice) =>
      notice.includes("No invitations were sent") && notice.includes("locked for Locked") && notice.includes("no longer in this plaza")));
    await assert.rejects(locked.sdk.joinById(mission.roomId), /Clear The Last Crossing/);

    const training = remember(await alpha.sdk.create("mission", { mission: "training" }) as Socket);
    await local(training);
    const trainingNotices = notices(training);
    host.send(DISPATCH_INVITE, { roomId: training.roomId, targets: [blue.sessionId] });
    await until("solo practice declines invitations", () => trainingNotices.some((notice) => notice.includes("one courier")));

    assert.ok([...invitations.values()].every((list) => !list.length));
    sendInvites(host, [blue, blue, green]);
    sendInvites(host, [bystander]);
    await host.leave();
    await until("the invited couriers receive the offer", () =>
      invitations.get(blue.sessionId)?.length === 1 && invitations.get(green.sessionId)?.length === 1);
    await until("the lobby confirms two invites and blocks a second batch", () =>
      leaderNotices.some((notice) => notice.includes("sent to 2 couriers")) &&
      leaderNotices.some((notice) => notice.includes("already been sent")));
    const expected = { roomId: mission.roomId, inviter: "Aster", mission: "night" };
    assert.deepEqual(invitations.get(blue.sessionId), [expected]);
    assert.deepEqual(invitations.get(green.sessionId), [expected]);
    for (const room of [host, bystander, lockedCourier, otherPlaza]) assert.deepEqual(invitations.get(room.sessionId), []);
    assert.equal(mission.state.actors.size, 1);
    assert.equal(blue.state.kind, "plaza");
    assert.equal(green.state.kind, "plaza");

    const invitees = [{ account: beta, plaza: blue }, { account: gamma, plaza: green }];
    const accepted = await Promise.all(invitees.map(async ({ account, plaza }) => {
      const invite = invitations.get(plaza.sessionId)![0];
      const joined = remember(await account.sdk.joinById(invite.roomId) as Socket);
      await plaza.leave();
      return joined;
    }));
    const { id } = await (await observer.request("rooms/" + mission.state.code)).json() as { id: string };
    const manual = remember(await observer.sdk.joinById(id) as Socket);
    await Promise.all([...accepted, manual].map(local));
    await until("the invited and manual couriers are in the same lobby", () => mission.state.actors.size === 4);
    accepted[0].send("begin");
    await delay(150);
    assert.equal(mission.state.status, "lobby");
    mission.send("begin");
    await until("all four couriers see the leader start", () =>
      [mission, ...accepted, manual].every((room) => room.state.status === "approach"));
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("Dispatch remembers the last started crew across plaza sessions and keeps invites opt-in", { timeout: 22000 }, async (t) => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  const remember = (room: Socket) => {
    rooms.push(room);
    return connectHandlers(room);
  };
  const recentCrew = (plaza: Socket) => {
    const replies: DispatchRecentCrew[] = [];
    plaza.onMessage(DISPATCH_RECENT_CREW, (reply: DispatchRecentCrew) => { replies.push(reply); });
    return {
      replies,
      request: async () => {
        const index = replies.length;
        plaza.send(DISPATCH_RECENT_CREW);
        return until("Dispatch answers the recent crew request", () => replies[index]);
      },
    };
  };
  try {
    const [alpha, beta, gamma, delta, outsider] =
      await Promise.all(["Aster", "Beta", "Gamma", "Delta", "Outsider"].map((name) => player(origin, name)));
    const firstPlaza = remember(await alpha.sdk.create("plaza") as Socket);
    const teammates = await Promise.all([beta, gamma, delta].map(async (account) =>
      remember(await account.sdk.joinById(firstPlaza.roomId) as Socket)));
    const initialCouriers = [firstPlaza, ...teammates];
    const bystander = remember(await outsider.sdk.joinById(firstPlaza.roomId) as Socket);
    await Promise.all(rooms.map(local));

    const originalJob = remember(await alpha.sdk.create("mission", { mission: "chapter" }) as Socket);
    const originalCrew = [originalJob];
    for (const account of [beta, gamma, delta]) originalCrew.push(remember(await account.sdk.joinById(originalJob.roomId) as Socket));
    await Promise.all(originalCrew.map(local));
    assert.deepEqual(await recentCrew(firstPlaza).request(), { targets: [] });
    await Promise.all(initialCouriers.map((room) => room.leave()));
    originalJob.send("begin");
    await until("the first crew starts together", () => originalCrew.every((room) => room.state.status === "approach"));
    await Promise.all(originalCrew.map((room) => room.leave()));

    const host = remember(await alpha.sdk.joinById(bystander.roomId) as Socket);
    const green = remember(await gamma.sdk.joinById(bystander.roomId) as Socket);
    const blue = remember(await beta.sdk.joinById(bystander.roomId) as Socket);
    const elsewhere = remember(await delta.sdk.create("plaza") as Socket);
    await Promise.all([host, green, blue, elsewhere].map(local));
    for (const [index, room] of [host, blue, green, elsewhere].entries()) {
      assert.notEqual(room.sessionId, initialCouriers[index].sessionId);
    }

    const hostLookup = recentCrew(host);
    const blueLookup = recentCrew(blue);
    const bystanderLookup = recentCrew(bystander);
    const outsideLookup = recentCrew(elsewhere);
    const returning = { targets: [blue.sessionId, green.sessionId] };
    assert.deepEqual(await hostLookup.request(), returning);
    assert.equal(blueLookup.replies.length, 0);
    assert.equal(bystanderLookup.replies.length, 0);
    assert.equal(outsideLookup.replies.length, 0);
    assert.deepEqual(await blueLookup.request(), { targets: [host.sessionId, green.sessionId] });
    assert.deepEqual(await bystanderLookup.request(), { targets: [] });
    assert.deepEqual(await outsideLookup.request(), { targets: [] });

    for (const [mission, phase] of [["chapter", "approach"], ["training", "combat"]] as const) {
      const solo = remember(await alpha.sdk.create("mission", { mission }) as Socket);
      await local(solo);
      solo.send("begin");
      await until("solo or practice job starts", () => solo.state.status === phase);
      await solo.leave();
    }
    const selected = await hostLookup.request();
    assert.deepEqual(selected, returning);

    for (const account of [alpha, beta]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "night-unlock", "chapter");
    }
    const nextJob = remember(await alpha.sdk.create("mission", { mission: "night" }) as Socket);
    await local(nextJob);
    const invites: DispatchInvitation[] = [];
    const skipped: DispatchInvitation[] = [];
    const notices: string[] = [];
    blue.onMessage(DISPATCH_INVITE, (invite: DispatchInvitation) => { invites.push(invite); });
    green.onMessage(DISPATCH_INVITE, (invite: DispatchInvitation) => { skipped.push(invite); });
    bystander.onMessage(DISPATCH_INVITE, (invite: DispatchInvitation) => { skipped.push(invite); });
    nextJob.onMessage("notice", (note: string) => { notices.push(note); });
    host.send(DISPATCH_INVITE, { roomId: nextJob.roomId, targets: selected.targets });
    const offer = await until("an eligible former teammate receives an invite", () => invites[0]);
    await until("the progress gate still checks recent crew invites", () => notices.some((note) => note.includes("locked for Gamma")));
    assert.deepEqual(offer, { roomId: nextJob.roomId, mission: "night", inviter: "Aster" });
    assert.deepEqual(skipped, []);
    assert.equal(nextJob.state.actors.size, 1);
    assert.deepEqual(await hostLookup.request(), returning);

    const accepted = remember(await beta.sdk.joinById(offer.roomId) as Socket);
    await local(accepted);
    nextJob.send("begin");
    await until("the new crew starts their mission", () => [nextJob, accepted].every((room) => room.state.status === "approach"));
    assert.deepEqual(await hostLookup.request(), { targets: [blue.sessionId] });

    const realNow = Date.now.bind(Date);
    t.mock.method(Date, "now", () => realNow() + DISPATCH_RECENT_CREW_TTL_MS + 1);
    try {
      assert.deepEqual(await hostLookup.request(), { targets: [] });
    } finally { t.mock.restoreAll(); }
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("Signal Echo resolves private rounds once and shares the companion-care cooldown", { timeout: 25000 }, async (t) => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  type Round = Extract<CompanionPlayMessage, { type: "round" }>;
  type Result = Extract<CompanionPlayMessage, { type: "result" }>;
  const echo = (room: Socket) => {
    const rounds: Round[] = [];
    const results: Result[] = [];
    room.onMessage(COMPANION_PLAY, (message: CompanionPlayMessage) => {
      if (message.type === "round") rounds.push(message);
      else results.push(message);
    });
    return {
      rounds,
      results,
      async start(requestId: number) {
        room.send(COMPANION_PLAY, { type: "start", requestId } satisfies CompanionPlayRequest);
        const round = await until("the private four-cue round arrives", () => rounds.find((item) => item.requestId === requestId));
        assert.equal(round.signals.length, SIGNAL_COUNT);
        assert.deepEqual(new Set(round.signals), new Set(["short", "long"]));
        return round;
      },
      answer(round: Round, signals = round.signals) {
        room.send(COMPANION_PLAY, { type: "answer", roundId: round.roundId, signals } satisfies CompanionPlayRequest);
      },
      result(round: Round) {
        return until("the round result arrives", () => results.find((item) => item.roundId === round.roundId));
      },
    };
  };
  try {
    const [alpha, beta] = await Promise.all([player(origin, "Aster"), player(origin, "Beta")]);
    const betaId = server.store.session(beta.sdk.auth.token)!.id;
    server.store.reward([betaId], "companion-play-fixture", "chapter");
    const [beforeAlpha, beforeBeta] = await Promise.all([alpha.profile(), beta.profile()]);
    const first = connectHandlers(await alpha.sdk.create("plaza") as Socket);
    rooms.push(first);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all(rooms.map(local));
    const a = echo(first), b = echo(other);

    const superseded = await a.start(1);
    const [current, remote] = await Promise.all([a.start(2), b.start(1)]);
    assert.notEqual(superseded.roundId, current.roundId);
    assert.notEqual(current.roundId, remote.roundId);
    first.send(COMPANION_PLAY, { type: "start", requestId: 0 });
    a.answer(current);
    await delay(120);
    assert.deepEqual(a.results, []);
    assert.deepEqual(await alpha.profile(), beforeAlpha);
    assert.deepEqual(a.rounds, [superseded, current]);
    assert.deepEqual(b.rounds, [remote]);

    await delay(SIGNAL_PLAYBACK_MS);
    a.answer(superseded);
    a.answer(remote);
    first.send(COMPANION_PLAY, { type: "answer", roundId: current.roundId, signals: [...current.signals, "short"] });
    first.send(COMPANION_PLAY, { type: "answer", roundId: current.roundId, signals: ["wide", ...current.signals.slice(1)] });
    a.answer(current);
    assert.deepEqual(await a.result(current), { type: "result", roundId: current.roundId, outcome: "matched", bondAdded: true });
    assert.deepEqual(await alpha.profile(), { ...beforeAlpha, bond: beforeAlpha.bond + 1 });
    assert.equal(a.results.length, 1);
    assert.deepEqual(b.results, []);

    const wrong: Signal[] = [...remote.signals];
    wrong[0] = wrong[0] === "short" ? "long" : "short";
    b.answer(remote, wrong);
    assert.deepEqual(await b.result(remote), { type: "result", roundId: remote.roundId, outcome: "missed", bondAdded: false });
    assert.deepEqual(await beta.profile(), beforeBeta);
    b.answer(remote);

    a.answer(current);
    const cooldown = await a.start(3);
    assert.equal(a.results.length, 1);
    let played: Profile | undefined;
    first.onMessage("profile", (profile: Profile) => { played = profile; });
    first.send("customize", { play: true });
    assert.deepEqual(await until("ordinary care returns the shared cooldown's profile", () => played),
      { ...beforeAlpha, bond: beforeAlpha.bond + 1 });
    await delay(SIGNAL_PLAYBACK_MS);
    a.answer(cooldown);
    assert.deepEqual(await a.result(cooldown), { type: "result", roundId: cooldown.roundId, outcome: "matched", bondAdded: false });
    assert.deepEqual(await alpha.profile(), { ...beforeAlpha, bond: beforeAlpha.bond + 1 });

    const canceled = await a.start(4);
    first.send(COMPANION_PLAY, { type: "cancel", roundId: canceled.roundId } satisfies CompanionPlayRequest);
    const expired = await b.start(2);
    assert.equal(b.results.length, 1);
    const realNow = Date.now.bind(Date);
    t.mock.method(Date, "now", () => realNow() + SIGNAL_ROUND_MS + 1);
    try {
      a.answer(canceled);
      await a.start(5);
      assert.equal(a.results.length, 2);
      b.answer(expired);
      assert.deepEqual(await b.result(expired), { type: "result", roundId: expired.roundId, outcome: "expired", bondAdded: false });
      b.answer(expired);
      await b.start(3);
      assert.equal(b.results.length, 2);
    } finally { t.mock.restoreAll(); }
    assert.deepEqual(await beta.profile(), beforeBeta);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
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
      const reach = hostile.kind === "runner" ? 3.65 : 3;
      if (Math.abs(dz) < (hostile.kind === "keeper" ? 1.58 : 1.21) && Math.abs(dx) < reach)
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
    assert.deepEqual(rooms.map(crewAssists), [[], []], "other missions do not record Bay Four rescue credit");

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

test("Tidegate archive reads only the live channel and shares its recording after defense", { timeout: 80000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      for (const mission of ["chapter", "night", "return"] as const) server.store.reward([id], mission, mission);
      if (account !== guest) server.store.reward([id], "terminal", "terminal");
    }
    await assert.rejects(guest.sdk.create("mission", { mission: "archive" }), /Clear East Terminal/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "archive" }) as Socket);
    rooms.push(first);
    await assert.rejects(guest.sdk.joinById(first.roomId), /Clear East Terminal/);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all([local(first), local(other)]);

    const a = new TestCourier(first), b = new TestCourier(other);
    const [consolePoint] = routeMarkers("archive", 0);
    const [near, far] = routeMarkers("archive", 1);
    const [recording] = routeMarkers("archive", 3);
    const notices: string[] = [];
    other.onMessage("notice", (notice: string) => { notices.push(notice); });
    const observations: string[][] = rooms.map((room) => {
      const sources: string[] = [];
      room.onMessage("combat", (event: CombatEvent) => { if (event.type === "observe") sources.push(event.source); });
      return sources;
    });
    const stage = (stage: number, status: string) => rooms.every((room) => room.state.stage === stage && room.state.status === status);
    const recall = async (courier: TestCourier) => {
      await until("reader operator stands idle", () => courier.me.phase === "idle");
      if (courier.me.armed) courier.send(0, 0, "morph");
      await until("operator recalls their partner", () => !courier.me.armed && courier.me.phase === "idle");
    };

    first.send("begin");
    await until("both clients enter the archive", () => stage(0, "combat"));
    await fight([a, b], "signal", 22000);
    await Promise.all([a.go(consolePoint.x, consolePoint.z), b.go(far.x, far.z)]);
    await recall(a);
    if (!b.me.armed) b.send(0, 0, "morph");
    await until("far operator has their weapon", () => b.me.armed);
    first.send("interact");
    await until("both clients see the near channel live", () => stage(1, "route") && rooms.every((room) => room.state.wave === 0));
    other.send("interact");
    await until("quiet far channel gives timing feedback", () => notices.some((notice) => notice.includes("near channel is live")));
    assert.equal(first.state.readerMask, 0);
    await Promise.all([
      a.go(near.x, near.z),
      until("both clients see the far channel take over", () => rooms.every((room) => room.state.wave === 1)),
    ]);

    other.send("interact");
    await until("live far channel requires the recalled companion", () => notices.some((notice) => notice.includes("Recall your partner")));
    assert.equal(first.state.readerMask, 0);
    await recall(b);
    other.send("interact");
    await until("both clients see the far channel recorded first", () => rooms.every((room) => room.state.readerMask === far.readerBit));
    other.send("interact");
    await until("duplicate reading is rejected", () => notices.some((notice) => notice.includes("already recorded")));

    const reconnecting = new Promise<void>((resolve) => other.onReconnect.once(resolve));
    other.connection.close(4010, "test drop");
    await Promise.race([reconnecting, delay(4200).then(() => { throw new Error("Reconnect did not settle"); })]);
    await until("the recorded bit survives reconnect and the near channel opens", () =>
      other.state.readerMask === far.readerBit && b.me.connected && rooms.every((room) => room.state.wave === 0), 8000);
    first.send("interact");
    await until("both scans open the defense", () => stage(2, "combat") &&
      rooms.every((room) => room.state.readerMask === ARCHIVE_CHANNELS_COMPLETE));
    for (const account of [alpha, beta]) assert.equal((await account.profile()).lore.includes("archive"), false);

    await fight([a, b], "signal", 32000);
    await until("both clients can access the recording", () => stage(3, "signal"));
    const reader = a.me.hp > 0 ? a : b;
    await reader.go(recording.x, recording.z);
    await recall(reader);
    reader.room.send("interact");
    reader.room.send("interact");
    await until("the whole party clears the archive", () => stage(3, "complete"));
    for (const sources of observations) assert.deepEqual(sources, [first.sessionId, other.sessionId, first.sessionId, reader.room.sessionId]);
    for (const account of [alpha, beta]) {
      const profile = await account.profile();
      assert.deepEqual(profile.clears, ["chapter", "night", "return", "terminal", "archive"]);
      assert.deepEqual(profile.lore, ["register", "turnout", "manifest", "archive"]);
      assert.equal(profile.battleXp, 256);
      assert.equal(profile.bond, 28);
    }
    first.send("begin");
    await until("replay resets both channels", () => stage(0, "combat") && rooms.every((room) => room.state.readerMask === 0));
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("Dead Line Exchange teaches the Cable Runner and records the crew log for the party", { timeout: 70000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      for (const mission of ["chapter", "night", "return", "terminal"] as const) server.store.reward([id], mission, mission);
      if (account !== guest) server.store.reward([id], "archive", "archive");
    }
    await assert.rejects(guest.sdk.create("mission", { mission: "exchange" }), /Clear Tidegate Signal Archive/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "exchange" }) as Socket);
    rooms.push(first);
    await assert.rejects(guest.sdk.joinById(first.roomId), /Clear Tidegate Signal Archive/);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all([local(first), local(other)]);

    const a = new TestCourier(first), b = new TestCourier(other);
    const [control] = routeMarkers("exchange", 0);
    const [crewLog] = routeMarkers("exchange", 2);
    const stage = (stage: number, status: string) => rooms.every((room) => room.state.stage === stage && room.state.status === status);
    const events: CombatEvent[][] = [[], []];
    for (const [index, room] of rooms.entries()) {
      room.onMessage("combat", (event: CombatEvent) => { events[index].push(event); });
    }
    const enemies = () => [...first.state.actors.entries()].filter(([, actor]) => actor.kind !== "player");
    const readWithRecall = async (courier: TestCourier) => {
      await until("reader operator stands idle", () => courier.me.phase === "idle");
      if (courier.me.armed) courier.send(0, 0, "morph");
      await until("operator recalls their partner", () => !courier.me.armed && courier.me.phase === "idle");
      courier.room.send("interact");
    };

    first.send("begin");
    await until("both clients enter the exchange", () => stage(0, "combat"));
    const entrance = enemies();
    assert.deepEqual(entrance.map(([, actor]) => [actor.kind, actor.name]), [["runner", "Cable Runner"]]);
    const [runnerId] = entrance[0];
    const runnerDid = (type: CombatEvent["type"]) => events.every((items) =>
      items.some((event) => event.source === runnerId && event.type === type));
    await until("both clients receive the Cable Runner tell", () => runnerDid("windup"));
    const tells = events.map((items) => items.find((event) => event.source === runnerId && event.type === "windup"));
    assert.ok(tells[0]?.lunge);
    assert.deepEqual(tells[0].lunge, tells[1]?.lunge);
    a.send(0, -1, "dodge");
    b.send(0, 1, "dodge");
    await until("both clients receive the Cable Runner pounce", () => runnerDid("swing"));
    await fight([a, b], "signal", 22000);

    const operator = a.me.hp > 0 ? a : b;
    await operator.go(control.x, control.z);
    await until("transfer operator stands idle", () => operator.me.phase === "idle");
    if (!operator.me.armed) operator.send(0, 0, "morph");
    await until("the transfer operator's weapon is armed", () => operator.me.armed);
    let blocked = false;
    operator.room.onMessage("notice", (notice: string) => { blocked ||= notice.includes("Recall your partner"); });
    operator.room.send("interact");
    await until("the transfer control requires the companion recalled", () => blocked);
    assert.ok(stage(0, "signal"));
    const health = [a.me.hp, b.me.hp];
    await readWithRecall(operator);
    await until("the transfer control opens the second encounter", () => stage(1, "combat"));
    assert.deepEqual(enemies().map(([, actor]) => actor.kind).sort(), ["guard", "runner"]);
    assert.ok(!first.state.actors.has(runnerId));
    assert.deepEqual([a.me.hp, b.me.hp], health);

    await fight([a, b], "signal", 26000);
    await until("both clients can access the crew log", () => stage(2, "signal"));
    for (const account of [alpha, beta]) assert.equal((await account.profile()).lore.includes("exchange"), false);
    const reader = a.me.hp > 0 ? a : b;
    await reader.go(crewLog.x, crewLog.z);
    await readWithRecall(reader);
    reader.room.send("interact");
    await until("the whole party clears the exchange", () => stage(2, "complete"));
    for (const items of events) {
      assert.deepEqual(items.filter((event) => event.type === "observe").map((event) => event.source),
        [operator.room.sessionId, reader.room.sessionId]);
    }
    for (const account of [alpha, beta]) {
      const profile = await account.profile();
      assert.deepEqual(profile.clears, ["chapter", "night", "return", "terminal", "archive", "exchange"]);
      assert.deepEqual(profile.lore, ["register", "turnout", "manifest", "archive", "exchange"]);
      assert.equal(profile.battleXp, 304);
      assert.equal(profile.bond, 34);
    }
    first.send("begin");
    await until("replay returns to the Cable Runner entrance", () => stage(0, "combat"));
    assert.deepEqual(enemies().map(([, actor]) => actor.kind), ["runner"]);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("First Departure keeps the Switchkeeper across its reinforcement phase and saves the Bay Four Ticket", { timeout: 85000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      for (const mission of ["chapter", "night", "return", "terminal", "archive"] as const) server.store.reward([id], mission, mission);
      if (account !== guest) server.store.reward([id], "exchange", "exchange");
    }
    await assert.rejects(guest.sdk.create("mission", { mission: "departure" }), /Clear Dead Line Exchange/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "departure" }) as Socket);
    rooms.push(first);
    await assert.rejects(guest.sdk.joinById(first.roomId), /Clear Dead Line Exchange/);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all([local(first), local(other)]);

    const a = new TestCourier(first), b = new TestCourier(other), couriers = [a, b];
    const [signal] = routeMarkers("departure", 0);
    const [boarding] = routeMarkers("departure", 2);
    const stage = (stage: number, status: string) => [first, other].every((room) => room.state.stage === stage && room.state.status === status);
    const enemies = () => [...first.state.actors.entries()].filter(([, actor]) => actor.kind !== "player");
    const readWithRecall = async (courier: TestCourier) => {
      await until("reader operator stands idle", () => courier.me.phase === "idle");
      if (courier.me.armed) courier.send(0, 0, "morph");
      await until("operator recalls their partner", () => !courier.me.armed && courier.me.phase === "idle");
      courier.room.send("interact");
    };

    first.send("begin");
    await until("both clients enter Bay 4", () => stage(0, "combat"));
    assert.deepEqual(enemies().map(([, actor]) => actor.kind).sort(), ["guard", "skitter"]);
    await fight(couriers, "signal", 24000);
    const operator = a.me.hp > 0 ? a : b;
    await operator.go(signal.x, signal.z);
    const healthBeforeBoss = couriers.map((courier) => courier.me.hp);
    await readWithRecall(operator);
    await until("the Switchkeeper defends Bay 4", () => stage(1, "combat"));
    const [keeperId, keeper] = enemies()[0];
    assert.equal(keeper.kind, "keeper");
    assert.equal(enemies().length, 1);
    assert.deepEqual(couriers.map((courier) => courier.me.hp), healthBeforeBoss);

    await fight(couriers, "interlude", 26000);
    await until("both clients see the warning phase", () => stage(1, "interlude"));
    const interludeFrame = first.state.frame;
    const pausedHealth = couriers.map((courier) => courier.me.hp);
    const bossHealth = keeper.hp;
    assert.ok(bossHealth > 0 && bossHealth * 2 <= keeper.maxHp);
    assert.deepEqual(enemies().map(([id]) => id), [keeperId]);
    for (let n = 0; n < 18; n++) {
      for (const courier of couriers) courier.attack();
      await delay(34);
    }
    for (const courier of couriers) courier.send(0, 0);
    assert.equal(keeper.hp, bossHealth);
    assert.deepEqual(couriers.map((courier) => courier.me.hp), pausedHealth);
    await until("the Cable Runner joins after the warning", () => stage(1, "combat") && first.state.wave === 1);
    assert.ok(first.state.frame - interludeFrame >= DEPARTURE_REINFORCEMENT_TICKS - 8);
    assert.deepEqual(enemies().map(([, actor]) => actor.kind).sort(), ["keeper", "runner"]);
    assert.equal(first.state.actors.get(keeperId)?.hp, bossHealth);
    assert.equal(other.state.actors.get(keeperId)?.hp, bossHealth);
    assert.deepEqual(couriers.map((courier) => courier.me.hp), pausedHealth);

    await fight(couriers, "signal", 28000);
    await until("both clients can access the boarding reader", () => stage(2, "signal"));
    for (const account of [alpha, beta]) assert.equal((await account.profile()).lore.includes("departure"), false);
    const plaza = connectHandlers(await alpha.sdk.joinOrCreate("plaza") as Socket);
    rooms.push(plaza);
    await local(plaza);
    let updated: Profile | undefined;
    plaza.onMessage("profile", (profile: Profile) => { updated = profile; });
    const equipTicket = async () => {
      updated = undefined;
      plaza.send("customize", { trinket: BAY_FOUR_TICKET });
      return until("the companion room replies to the ticket choice", () => updated);
    };
    assert.equal((await equipTicket()).trinket, "Fare token");
    assert.equal(plaza.state.actors.get(plaza.sessionId)?.bayFourTicket, false);

    const reader = a.me.hp > 0 ? a : b;
    await reader.go(boarding.x, boarding.z);
    await readWithRecall(reader);
    reader.room.send("interact");
    await until("the whole party clears First Departure", () => stage(2, "complete"));
    for (const account of [alpha, beta]) {
      const profile = await account.profile();
      assert.deepEqual(profile.clears, ["chapter", "night", "return", "terminal", "archive", "exchange", "departure"]);
      assert.deepEqual(profile.lore, ["register", "turnout", "manifest", "archive", "exchange", "departure"]);
      assert.equal(profile.battleXp, 352);
      assert.equal(profile.bond, 40);
      assert.equal(profile.trinket, "Fare token");
    }
    assert.equal((await equipTicket()).trinket, BAY_FOUR_TICKET);
    await until("the equipped ticket reaches actor state", () => plaza.state.actors.get(plaza.sessionId)?.bayFourTicket);
    first.send("begin");
    await until("replay resets the approach and reinforcement", () => stage(0, "combat") && [first, other].every((room) => room.state.wave === 0));
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("South Viaduct expires a relay, supports a teammate handoff, and grants the ledger once", { timeout: 80000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    const party = [alpha, beta];
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter-unlock", "chapter");
      if (account !== guest) server.store.reward([id], "departure-unlock", "departure");
    }
    const initial = await Promise.all(party.map((account) => account.profile()));
    await assert.rejects(guest.sdk.create("mission", { mission: "viaduct" }), /Clear First Departure/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "viaduct" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear First Departure/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);

    const a = new TestCourier(first), b = new TestCourier(other);
    const [west, east] = routeMarkers("viaduct", 1);
    const [ledger] = routeMarkers("viaduct", 3);
    const notices = rooms.map((room) => {
      const messages: string[] = [];
      room.onMessage("notice", (notice: string) => { messages.push(notice); });
      return messages;
    });
    const phase = (stage: number, status: string) => rooms.every((room) => room.state.stage === stage && room.state.status === status);
    const patrol = (room: Socket) => [...room.state.actors.values()].filter((actor) => actor.kind !== "player").map((actor) => actor.kind).sort();
    const relays = (mask: number, deadline: number) => rooms.every((room) => room.state.readerMask === mask && room.state.readerUntil === deadline);
    const interactAndSync = async (courier: TestCourier) => {
      courier.room.send("interact");
      courier.send(0, 0);
      await until("the server has processed the call attempt", () => courier.me.ack === courier.seq);
    };

    first.send("begin");
    await until("both players enter the viaduct", () => phase(0, "combat"));
    assert.deepEqual(rooms.map(patrol), [["runner", "skitter"], ["runner", "skitter"]]);
    await fight([a, b], "signal", 24000);
    await until("both players see the crossing relays", () => phase(1, "signal"));
    assert.ok(a.me.hp > 0 && b.me.hp > 0);
    assert.ok(relays(0, 0));
    await Promise.all([a.go(west.x, west.z), b.go(east.x, east.z)]);
    await recallForReader(b);
    await interactAndSync(b);
    await until("East Relay reports that West must go first", () => notices[1].some((notice) => notice.includes("West Relay must open")));
    assert.ok(phase(1, "signal") && relays(0, 0));

    await until("the West operator stands idle", () => a.me.phase === "idle");
    if (!a.me.armed) a.send(0, 0, "morph");
    await until("the West operator holds a weapon", () => a.me.armed);
    await interactAndSync(a);
    await until("West Relay asks for a recalled companion", () => notices[0].some((notice) => notice.includes("Recall your partner")));
    assert.ok(relays(0, 0));
    await recallForReader(a);
    first.send("interact");
    const deadline = await until("both clients receive the live West signal", () => {
      const value = first.state.readerUntil;
      return value > 0 && relays(west.readerBit!, value) ? value : undefined;
    });
    const remainingTicks = deadline - first.state.frame;
    assert.ok(remainingTicks > VIADUCT_RELAY_TICKS - 24 && remainingTicks <= VIADUCT_RELAY_TICKS);
    await until("the relay window has advanced", () => first.state.frame >= deadline - VIADUCT_RELAY_TICKS + 10);
    await interactAndSync(a);
    await until("West Relay reports an existing live signal", () => notices[0].some((notice) => notice.includes("already live")));
    assert.ok(relays(west.readerBit!, deadline), "duplicate West cannot extend the authoritative deadline");
    await until("the server expires both clients' signal", () => first.state.frame >= deadline && relays(0, 0), 16000);
    assert.ok(phase(1, "signal"));
    notices[1].length = 0;
    await interactAndSync(b);
    await until("East Relay rejects the expired signal", () => notices[1].some((notice) => notice.includes("West Relay must open")));
    assert.ok(phase(1, "signal") && relays(0, 0));

    // An injured, low-energy operator makes a refill observable even after a clean patrol clear.
    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    Object.assign(mission["players"].get(first.sessionId)!.player, { hp: 64, energy: 43 });
    await until("West's current health reaches both clients", () => rooms.every((room) => room.state.actors.get(first.sessionId)?.hp === 64));
    first.send("interact");
    await until("the reopened West signal reaches both clients", () => first.state.readerUntil > deadline && relays(west.readerBit!, first.state.readerUntil));
    await a.go(-9.5, 4.4);
    await until("West waits clear of the runner's spawn", () => a.me.ack === a.seq && !a.me.moving);
    const positionsAndHealth = () => [a, b].map(({ me }) => ({ x: me.x, y: me.y, z: me.z, hp: me.hp }));
    const beforeHandoff = positionsAndHealth();
    other.send("interact");
    await until("East's answer starts the second patrol", () => phase(2, "combat") && relays(west.readerBit! | east.readerBit!, 0));
    assert.deepEqual(positionsAndHealth(), beforeHandoff);
    assert.ok(a.me.energy < 100, "the handoff does not refill energy");
    assert.deepEqual(rooms.map(patrol), [["guard", "runner"], ["guard", "runner"]]);
    await fight([a, b], "signal", 30000);
    await until("both players see the Signal Ledger", () => phase(3, "signal"));
    assert.deepEqual(await Promise.all(party.map((account) => account.profile())), initial);

    const reader = a.me.hp > 0 ? a : b;
    await reader.go(ledger.x, ledger.z);
    await until("the Ledger operator stands idle", () => reader.me.phase === "idle");
    if (!reader.me.armed) reader.send(0, 0, "morph");
    await until("the Ledger operator holds a weapon", () => reader.me.armed);
    const readerNotices = notices[rooms.indexOf(reader.room)];
    readerNotices.length = 0;
    await interactAndSync(reader);
    await until("the Signal Ledger asks for recall", () => readerNotices.some((notice) => notice.includes("Recall your partner")));
    assert.ok(phase(3, "signal"));
    await recallForReader(reader);
    reader.room.send("interact");
    reader.room.send("interact");
    await until("both clients see the viaduct clear", () => phase(3, "complete"));
    for (const [index, account] of party.entries()) {
      const profile = await account.profile();
      assert.equal(profile.companion, initial[index].companion);
      assert.equal(profile.battleXp, initial[index].battleXp + 48);
      assert.deepEqual(profile.lore, [...initial[index].lore, "viaduct"]);
      assert.deepEqual(profile.clears, [...initial[index].clears, "viaduct"]);
    }
    first.send("begin");
    await until("replay resets both relays and the deadline", () => phase(0, "combat") && relays(0, 0));
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

async function recallForReader(courier: TestCourier) {
  await until("reader operator stands idle", () => courier.me.phase === "idle");
  if (courier.me.armed) courier.send(0, 0, "morph");
  await until("reader operator recalls the companion", () => !courier.me.armed && courier.me.phase === "idle");
}

test("one courier can cross South Viaduct and read the ledger", { timeout: 65000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  let room: Socket | undefined;
  try {
    const account = await player(origin, "Solo");
    const { id } = server.store.session(account.sdk.auth.token)!;
    server.store.reward([id], "chapter-unlock", "chapter");
    server.store.reward([id], "departure-unlock", "departure");
    const route = room = connectHandlers(await account.sdk.create("mission", { mission: "viaduct" }) as Socket);
    await local(route);
    const courier = new TestCourier(route);
    const [west, east] = routeMarkers("viaduct", 1);
    const [ledger] = routeMarkers("viaduct", 3);
    route.send("begin");
    await until("solo viaduct combat starts", () => route.state.status === "combat");
    await fight([courier], "signal", 20000);
    assert.equal(route.state.stage, 1);
    await courier.go(west.x, west.z);
    await recallForReader(courier);
    route.send("interact");
    const deadline = await until("solo West Relay opens a window", () => route.state.readerUntil > 0 && route.state.readerUntil);
    await courier.go(east.x, east.z);
    assert.ok(route.state.frame < deadline);
    route.send("interact");
    await until("the same courier answers at East", () => route.state.stage === 2 && route.state.status === "combat");
    await fight([courier], "signal", 25000);
    assert.equal(route.state.stage, 3);
    await courier.go(ledger.x, ledger.z);
    await recallForReader(courier);
    route.send("interact");
    await until("the solo ledger completes the route", () => route.state.status === "complete");
    const profile = await account.profile();
    assert.equal(profile.clears.at(-1), "viaduct");
    assert.equal(profile.lore.at(-1), "viaduct");
  } finally {
    await room?.leave();
    await server.stop();
  }
});

test("Floodgate Lift requires a recalled brake reset and saves the log for the whole party", { timeout: 78000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "relay-lift-test-"));
  const database = join(directory, "profiles.sqlite");
  let server: Awaited<ReturnType<typeof runServer>> | undefined;
  const rooms: Socket[] = [];
  try {
    server = await runServer({ port: 0, database });
    const origin = "http://127.0.0.1:" + server.port;
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    const party = [alpha, beta];
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter-unlock", "chapter");
      server.store.reward([id], "departure-unlock", "departure");
      if (account !== guest) server.store.reward([id], "viaduct-unlock", "viaduct");
    }
    const initial = await Promise.all(party.map((account) => account.profile()));
    await assert.rejects(guest.sdk.create("mission", { mission: "lift" }), /Clear South Viaduct/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "lift" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear South Viaduct/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);
    const couriers = rooms.map((room) => new TestCourier(room));
    const [wheel] = routeMarkers("lift", 1);
    const [resetWheel] = routeMarkers("lift", 2);
    const [log] = routeMarkers("lift", 3);
    assert.deepEqual(resetWheel, wheel);
    const roomPhase = (stage: number, status: string) => rooms.every((room) => room.state.stage === stage && room.state.status === status);
    const liftPhase = (state: number, deadline: number) => rooms.every((room) =>
      room.state.readerMask === state && room.state.readerUntil === deadline);
    const waitForLeg = async (label: string, state: number) => {
      const deadline = await until(label, () => {
        const activeDeadline = first.state.readerUntil;
        return activeDeadline > 0 && liftPhase(state, activeDeadline) ? activeDeadline : undefined;
      });
      const ticks = deadline - first.state.frame;
      assert.ok(ticks > LIFT_LEG_TICKS - 24 && ticks <= LIFT_LEG_TICKS);
      return deadline;
    };

    first.send("begin");
    await until("both players enter the lift approach", () => roomPhase(0, "combat"));
    await fight(couriers, "signal", 23000);
    await until("the brake wheel becomes available", () => roomPhase(1, "signal") && liftPhase(LIFT_PHASE.idle, 0));
    const operator = couriers.find((courier) => courier.me.hp > 0)!;
    await operator.go(wheel.x, wheel.z);
    await recallForReader(operator);
    const notices: string[] = [];
    operator.room.onMessage("notice", (notice: string) => { notices.push(notice); });
    const interactAndSync = async () => {
      operator.room.send("interact");
      operator.send(0, 0);
      await until("the server has processed the wheel attempt", () => operator.me.ack === operator.seq);
    };
    operator.room.send("interact");
    const firstDeadline = await waitForLeg("both clients see the lift lowering", LIFT_PHASE.lowering);
    assert.ok(roomPhase(2, "combat"));
    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    const guards = [...mission["enemies"].values()];
    assert.ok(guards.length > 0 && guards.every((enemy) => enemy.hp > 0));
    // Keep the real guard alive during both timed legs so docking and combat can be checked independently.
    for (const enemy of guards) Object.assign(enemy, { phase: "recover", ticks: LIFT_LEG_TICKS * 3, target: "" });
    await interactAndSync();
    assert.ok(liftPhase(LIFT_PHASE.lowering, firstDeadline), "an early reset cannot skip or extend the first leg");
    await until("the brake jams after the first leg", () => first.state.frame >= firstDeadline && liftPhase(LIFT_PHASE.jammed, 0), 14000);
    assert.ok(roomPhase(2, "combat"));

    operator.send(0, 0, "morph");
    await until("the brake operator holds a weapon", () => operator.me.armed && operator.me.phase === "idle");
    await interactAndSync();
    await until("the jammed brake asks the operator to recall", () => notices.some((notice) => notice.includes("Recall your partner")));
    assert.ok(liftPhase(LIFT_PHASE.jammed, 0));
    await recallForReader(operator);
    operator.room.send("interact");
    const secondDeadline = await waitForLeg("both clients see the brake resume", LIFT_PHASE.resuming);
    await until("the lift docks after the second leg", () => first.state.frame >= secondDeadline && liftPhase(LIFT_PHASE.docked, 0), 14000);
    assert.ok(roomPhase(2, "combat"), "docking still requires defeating the lift guard");
    for (const enemy of guards) Object.assign(enemy, { phase: "idle", ticks: 0 });
    await fight(couriers, "signal", 26500);
    await until("both clients see the lift log", () => roomPhase(3, "signal"));
    assert.deepEqual(await Promise.all(party.map((account) => account.profile())), initial);

    const reader = couriers.find((courier) => courier.me.hp > 0)!;
    await reader.go(log.x, log.z);
    await recallForReader(reader);
    reader.room.send("interact");
    reader.room.send("interact");
    await until("both players receive the lift clear", () => roomPhase(3, "complete"));
    const finished = await Promise.all(party.map((account) => account.profile()));
    for (const [index, profile] of finished.entries()) {
      assert.equal(profile.companion, initial[index].companion);
      assert.equal(profile.battleXp, initial[index].battleXp + 48);
      assert.equal(profile.bond, initial[index].bond + 6);
      assert.deepEqual(profile.lore, [...initial[index].lore, "lift"]);
      assert.deepEqual(profile.clears, [...initial[index].clears, "lift"]);
    }

    await Promise.all(rooms.map((room) => room.leave()));
    rooms.length = 0;
    await server.stop();
    server = undefined;
    server = await runServer({ port: 0, database });
    for (const [index, account] of party.entries()) {
      const response: Response = await fetch("http://127.0.0.1:" + server.port + "/api/profile", {
        headers: { Authorization: "Bearer " + account.sdk.auth.token },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { profile: finished[index] });
    }
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Pump Court cycles its discharges, honors evasion, and awards one Pump Record clear", { timeout: 85000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    const party = [alpha, beta];
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter-unlock", "chapter");
      server.store.reward([id], "viaduct-unlock", "viaduct");
      if (account !== guest) server.store.reward([id], "lift-unlock", "lift");
    }
    const initial = await Promise.all(party.map((account) => account.profile()));
    await assert.rejects(guest.sdk.create("mission", { mission: "pump" }), /Clear Floodgate Lift/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "pump" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear Floodgate Lift/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);

    const a = new TestCourier(first), b = new TestCourier(other);
    const [control] = routeMarkers("pump", 1);
    const [record] = routeMarkers("pump", 3);
    const roomPhase = (stage: number, status: string) => rooms.every((room) => room.state.stage === stage && room.state.status === status);
    const enemies = (room: Socket) => [...room.state.actors.values()].filter((actor) => actor.kind !== "player");
    const notices = rooms.map((room) => {
      const messages: string[] = [];
      room.onMessage("notice", (notice: string) => { messages.push(notice); });
      return messages;
    });
    const rejectArmedReader = async (courier: TestCourier, stage: number) => {
      await until("the reader operator stands idle", () => courier.me.phase === "idle");
      if (!courier.me.armed) courier.send(0, 0, "morph");
      await until("the reader operator holds a weapon", () => courier.me.armed && courier.me.phase === "idle");
      const messages = notices[rooms.indexOf(courier.room)];
      const previous = messages.length;
      courier.room.send("interact");
      await until("the reader rejects the armed companion", () => messages.slice(previous).some((notice) => notice.includes("Recall your partner")));
      assert.ok(roomPhase(stage, "signal"));
    };
    const discharges = rooms.map((room) => {
      const hits: { target?: string; damage?: number }[] = [];
      const cues: CombatEvent[] = [];
      room.onMessage("combat", (event: CombatEvent) => {
        if (event.source !== "pump-discharge") return;
        if (event.type === "hit") hits.push({ target: event.target, damage: event.damage });
        if (event.type === "windup") cues.push(event);
      });
      return { hits, cues };
    });
    const waitForDischarge = (label: string, phase: number, lane?: number) => until(label, () => {
      const deadline = first.state.readerUntil;
      return deadline > 0 && roomPhase(2, "combat") && rooms.every((room) => room.state.readerMask === phase
        && room.state.readerUntil === deadline && (lane === undefined || room.state.wave === lane)) ? deadline : undefined;
    }, 9000);
    const [near, middle, far] = PUMP_LANES.keys();
    const laneCenter = (lane: number) => (PUMP_LANES[lane].minZ + PUMP_LANES[lane].maxZ) / 2;

    first.send("begin");
    await until("both players enter the pump entrance", () => roomPhase(0, "combat"));
    for (const room of rooms) assert.deepEqual(enemies(room).map((enemy) => enemy.kind).sort(), ["runner", "skitter"]);
    await fight([a, b], "signal", 24000);
    await until("both players see Intake Control", () => roomPhase(1, "signal"));
    assert.ok(a.me.hp > 18 && b.me.hp > 0);
    await a.go(control.x, control.z);
    await rejectArmedReader(a, 1);
    await recallForReader(a);
    first.send("interact");
    const firstDeadline = await waitForDischarge("both clients see the initial discharge delay", PUMP_PHASE.idle, near);
    assert.ok(firstDeadline - first.state.frame > PUMP_TIMING.initial - 24 && firstDeadline - first.state.frame <= PUMP_TIMING.initial);
    for (const room of rooms) assert.deepEqual(enemies(room).map((enemy) => enemy.kind), ["keeper"]);
    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    const [keeper] = mission["enemies"].values();
    // Delay the Switchkeeper while measuring the lane hazard, then fight it at full HP.
    Object.assign(keeper, { phase: "recover", ticks: 1800, target: "" });
    await Promise.all([a.go(-5, laneCenter(near)), b.go(3, laneCenter(middle))]);
    const health = [a.me.hp, b.me.hp];
    const nearWarning = await waitForDischarge("the near lane warns first", PUMP_PHASE.warning, near);
    assert.equal(nearWarning - firstDeadline, PUMP_TIMING.warning);
    const nearBurst = await waitForDischarge("both clients see the near burst", PUMP_PHASE.burst, near);
    assert.equal(nearBurst - nearWarning, PUMP_TIMING.burst);
    const nearHit = [{ target: first.sessionId, damage: 18 }];
    for (const feed of discharges) assert.deepEqual(feed.hits, nearHit);
    assert.deepEqual([a.me.hp, b.me.hp], [health[0] - 18, health[1]]);
    const nearGap = await waitForDischarge("the first burst ends", PUMP_PHASE.idle);
    assert.equal(nearGap - nearBurst, PUMP_TIMING.gap);
    for (const feed of discharges) assert.deepEqual(feed.hits, nearHit, "an active burst only hits once");

    await Promise.all([a.go(-5, laneCenter(far)), b.go(3, laneCenter(far))]);
    const farWarning = await waitForDischarge("far warns after near", PUMP_PHASE.warning, far);
    assert.equal(farWarning - nearGap, PUMP_TIMING.warning);
    await until("Ivo can jump into the far burst", () => mission.state.frame >= farWarning - 17);
    b.send(0, 0, "jump");
    await until("Aster can dodge through the far burst", () => mission.state.frame >= farWarning - 8);
    a.send(1, 0, "dodge");
    await waitForDischarge("both clients see the far burst", PUMP_PHASE.burst, far);
    assert.equal(a.me.phase, "dodge");
    assert.ok(a.me.z >= PUMP_LANES[far].minZ && b.me.z >= PUMP_LANES[far].minZ);
    assert.ok(b.me.y >= .42, "the jump cleared the water height");
    for (const feed of discharges) assert.deepEqual(feed.hits, nearHit, "the in-lane jump and dodge evade the burst");
    assert.deepEqual([a.me.hp, b.me.hp], [health[0] - 18, health[1]]);

    await waitForDischarge("middle warns after far", PUMP_PHASE.warning, middle);
    await waitForDischarge("middle water passes before the pattern repeats", PUMP_PHASE.burst, middle);
    await waitForDischarge("the sequence repeats at near", PUMP_PHASE.warning, near);
    for (const feed of discharges) {
      assert.equal(feed.cues.length, 4);
      assert.deepEqual(feed.hits, nearHit);
    }
    Object.assign(keeper, { phase: "idle", ticks: 0 });
    await fight([a, b], "signal", 32000);
    await until("killing the Switchkeeper stops the pump and unlocks the record", () => roomPhase(3, "signal")
      && rooms.every((room) => room.state.readerMask === PUMP_PHASE.idle && room.state.readerUntil === 0));
    assert.deepEqual(await Promise.all(party.map((account) => account.profile())), initial);

    const reader = a.me.hp > 0 ? a : b;
    await reader.go(record.x, record.z);
    await rejectArmedReader(reader, 3);
    await recallForReader(reader);
    reader.room.send("interact");
    reader.room.send("interact");
    await until("both clients see the Pump Record clear", () => roomPhase(3, "complete"));
    for (const [index, account] of party.entries()) {
      const profile = await account.profile();
      assert.equal(profile.companion, initial[index].companion);
      assert.equal(profile.battleXp, initial[index].battleXp + 48);
      assert.equal(profile.bond, initial[index].bond + 6);
      assert.deepEqual(profile.lore, [...initial[index].lore, "pump"]);
      assert.deepEqual(profile.clears, [...initial[index].clears, "pump"]);
    }
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("Bellhouse shares distinct name calls in either order with combat and unlocks the Seal on clear", { timeout: 95000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    const party = [alpha, beta];
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter-unlock", "chapter");
      server.store.reward([id], "lift-unlock", "lift");
      if (account !== guest) server.store.reward([id], "pump-unlock", "pump");
    }
    const initial = await Promise.all(party.map((account) => account.profile()));
    for (const profile of initial) assert.ok(!availableTrinkets(profile).includes(BELLHOUSE_SEAL));
    await assert.rejects(guest.sdk.create("mission", { mission: "bellhouse" }), /Clear Pump Court/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "bellhouse" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear Pump Court/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);
    const a = new TestCourier(first), b = new TestCourier(other);
    const [spindle, nacre, pith] = BELLHOUSE_CALLS;
    const [desk] = routeMarkers("bellhouse", 3);
    const phase = (stage: number, status: string, mask: number) => [first, other].every((room) =>
      room.state.stage === stage && room.state.status === status && room.state.readerMask === mask);
    const foes = (room: Socket) => [...room.state.actors.values()].filter((actor) => actor.kind !== "player" && actor.hp > 0);
    const expected: BellhouseCue[] = [];
    const heard = [first, other].map((room) => {
      const notes: BellhouseCue[] = [];
      room.onMessage("bell", (event: BellhouseCue) => { notes.push(event); });
      return notes;
    });
    const useWithCompanion = async (courier: TestCourier, marker: { x: number; z: number }) => {
      await courier.go(marker.x, marker.z);
      await recallForReader(courier);
    };
    const ring = (courier: TestCourier, note: BellhouseCue["note"], marker: { x: number; z: number }) => {
      expected.push({ note, source: courier.room.sessionId, x: marker.x, z: marker.z });
      courier.room.send("interact");
    };
    const confirmBells = async () => {
      await until("both clients hear each expected name call", () => heard.every((notes) => notes.length === expected.length));
      for (const notes of heard) assert.deepEqual(notes, expected);
    };
    const notices: string[] = [];
    first.onMessage("notice", (notice: string) => { notices.push(notice); });

    first.send("begin");
    await until("both players enter the Bellhouse", () => phase(0, "combat", 0));
    for (const room of [first, other]) assert.deepEqual(foes(room).map((foe) => foe.kind).sort(), ["skitter", "skitter"]);
    await fight([a, b], "signal", 23000);
    await until("the name calls are available", () => phase(1, "signal", 0));
    await Promise.all([a.go(nacre.x, nacre.z), useWithCompanion(b, pith)]);
    await until("Aster is ready at Nacre Call", () => a.me.phase === "idle");
    if (!a.me.armed) a.send(0, 0, "morph");
    await until("Aster holds a weapon", () => a.me.armed && a.me.phase === "idle");
    first.send("interact");
    await until("the armed name call asks for recall", () => notices.some((notice) => notice.includes("Recall your partner")));
    assert.ok(phase(1, "signal", 0));
    await confirmBells();

    await recallForReader(a);
    ring(a, 1, nacre);
    first.send("interact");
    a.send(0, 0);
    await until("Nacre starts the guard patrol and the duplicate is processed", () => phase(2, "combat", nacre.readerBit) && a.me.ack === a.seq);
    for (const room of [first, other]) assert.deepEqual(foes(room).map((foe) => foe.kind).sort(), ["guard", "runner"]);
    await confirmBells();
    ring(b, 2, pith);
    const twoCalls = nacre.readerBit | pith.readerBit;
    await until("Ivo rings Pith while guards are alive", () => phase(2, "combat", twoCalls));
    await confirmBells();

    await fight([a, b], "signal", 30000);
    await until("the quiet call floor keeps the missing name available", () => phase(2, "signal", twoCalls));
    assert.ok([first, other].every((room) => foes(room).length === 0));
    assert.deepEqual(await Promise.all(party.map((account) => account.profile())), initial);
    const partnerSession = other.sessionId;
    let reconnected = false;
    other.onReconnect.once(() => { reconnected = true; });
    other.connection.close(4010, "test drop at the name calls");
    await until("Ivo reconnects with both names still recorded", () => reconnected && other.sessionId === partnerSession
      && first.state.actors.get(partnerSession)?.connected && phase(2, "signal", twoCalls));
    await confirmBells();
    const caller = b.me.hp > 0 ? b : a;
    await useWithCompanion(caller, spindle);
    ring(caller, 0, spindle);
    await until("the final name opens the Roster Desk", () => phase(3, "signal", BELLHOUSE_CALLS_COMPLETE));
    await confirmBells();
    await useWithCompanion(caller, desk);
    caller.room.send("interact");
    caller.room.send("interact");
    await until("both clients see the Bellhouse clear", () => phase(3, "complete", BELLHOUSE_CALLS_COMPLETE));
    await confirmBells();
    for (const [index, account] of party.entries()) {
      const profile = await account.profile();
      assert.equal(profile.companion, initial[index].companion);
      assert.equal(profile.battleXp, initial[index].battleXp + 48);
      assert.equal(profile.bond, initial[index].bond + 6);
      assert.equal(profile.trinket, initial[index].trinket);
      assert.deepEqual(profile.lore, [...initial[index].lore, "bellhouse"]);
      assert.deepEqual(profile.clears, [...initial[index].clears, "bellhouse"]);
      assert.equal(availableTrinkets(profile).filter((item) => item === BELLHOUSE_SEAL).length, 1);
    }
    const plaza = connectHandlers(await alpha.sdk.joinOrCreate("plaza") as Socket);
    rooms.push(plaza);
    await local(plaza);
    let equipped: Profile | undefined;
    plaza.onMessage("profile", (profile: Profile) => { equipped = profile; });
    plaza.send("customize", { trinket: BELLHOUSE_SEAL });
    await until("the earned Seal can be equipped in the plaza", () => equipped?.trinket === BELLHOUSE_SEAL
      && plaza.state.actors.get(plaza.sessionId)?.bellhouseSeal);

    first.send("begin");
    await until("replay clears the name calls", () => phase(0, "combat", 0));
    await fight([a, b], "signal", 23000);
    await until("replay opens all three calls", () => phase(1, "signal", 0));
    await Promise.all([useWithCompanion(a, spindle), useWithCompanion(b, pith)]);
    ring(a, 0, spindle);
    await until("Spindle can also start the guard patrol", () => phase(2, "combat", spindle.readerBit));
    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    const guards = [...mission["enemies"].values()];
    // Hold the full-health guards here to test all three names before the fight is over.
    for (const enemy of guards) Object.assign(enemy, { phase: "recover", ticks: 600, target: "" });
    ring(b, 2, pith);
    await until("Pith responds to the replay crew", () => phase(2, "combat", spindle.readerBit | pith.readerBit));
    await useWithCompanion(a, nacre);
    ring(a, 1, nacre);
    await until("all names can ring before the guard falls", () => phase(2, "combat", BELLHOUSE_CALLS_COMPLETE));
    await confirmBells();
    assert.ok([first, other].every((room) => foes(room).length === 2));
    for (const enemy of guards) Object.assign(enemy, { phase: "idle", ticks: 0 });
    await fight([a, b], "signal", 30000);
    await until("defeating the guards last opens the same desk", () => phase(3, "signal", BELLHOUSE_CALLS_COMPLETE));
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("Registry Annex shares a recoverable case and requires both the patrol and filing to clear", { timeout: 85000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    const party = [alpha, beta];
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "chapter-unlock", "chapter");
      server.store.reward([id], "pump-unlock", "pump");
      if (account !== guest) server.store.reward([id], "bellhouse-unlock", "bellhouse");
    }
    const initial = await Promise.all(party.map((account) => account.profile()));
    await assert.rejects(guest.sdk.create("mission", { mission: "annex" }), /Clear Bellhouse/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "annex" }) as Socket);
    rooms.push(first);
    await local(first);
    const { id } = await (await beta.request("rooms/" + first.state.code)).json() as { id: string };
    await assert.rejects(guest.sdk.joinById(id), /Clear Bellhouse/);
    const other = connectHandlers(await beta.sdk.joinById(id) as Socket);
    rooms.push(other);
    await local(other);
    const a = new TestCourier(first), b = new TestCourier(other);
    const phase = (stage: number, status: string) => rooms.every((room) => room.state.stage === stage && room.state.status === status);
    const caseState = (carrier: string, filed = false) => rooms.every((room) =>
      room.state.rosterCase?.carrier === carrier && room.state.rosterCase?.filed === filed);
    const caseIn = (room: Socket) => {
      const snapshot = room.state.rosterCase;
      assert.ok(snapshot, "the room has a case snapshot");
      return snapshot;
    };
    const near = (one: { x: number; z: number }, two: { x: number; z: number }, tolerance = .001) =>
      Math.hypot(one.x - two.x, one.z - two.z) < tolerance;
    const held = (courier: TestCourier) => caseState(courier.room.sessionId);
    const foes = (room: Socket) => [...room.state.actors.values()].filter((actor) => actor.kind !== "player" && actor.hp > 0);
    const hitFeeds = rooms.map((room) => {
      const hits: CombatEvent[] = [];
      room.onMessage("combat", (event: CombatEvent) => { if (event.type === "hit") hits.push(event); });
      return hits;
    });
    const notices = rooms.map((room) => {
      const messages: string[] = [];
      room.onMessage("notice", (notice: string) => { messages.push(notice); });
      return messages;
    });
    const keepArmed = async (courier: TestCourier) => {
      await until("case operator stands idle", () => courier.me.phase === "idle");
      if (!courier.me.armed) courier.send(0, 0, "morph");
      await until("case operator holds a weapon", () => courier.me.armed && courier.me.phase === "idle");
    };
    const approachCase = async (courier: TestCourier) => {
      const floorCase = caseIn(courier.room);
      await courier.go(floorCase.x, floorCase.z);
      await until("the case pickup position is confirmed", () => courier.me.ack === courier.seq
        && !courier.me.moving && near(courier.me, floorCase, .85));
    };

    first.send("begin");
    await until("both players enter the Registry Annex", () => phase(0, "combat"));
    for (const room of rooms) assert.deepEqual(foes(room).map((foe) => foe.kind).sort(), ["runner", "skitter"]);
    await fight([a, b], "signal", 23000);
    await until("the roster case appears at its pickup site", () => phase(1, "signal") && caseState("")
      && rooms.every((room) => near(caseIn(room), ANNEX_CASE_HOME)));
    assert.ok(a.me.hp > 21 && b.me.hp > 0);
    await b.go(ANNEX_CASE_HOME.x - .5, ANNEX_CASE_HOME.z + 1.4);
    await keepArmed(a);
    await approachCase(a);
    first.send("interact");
    await until("the armed pickup starts the guard patrol", () => phase(2, "combat") && held(a));
    for (const room of rooms) assert.deepEqual(foes(room).map((foe) => foe.kind).sort(), ["guard", "runner"]);

    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    const patrol = [...mission["enemies"].values()];
    const spawns = patrol.map(({ x, z, facing }) => ({ x, z, facing }));
    const guard = patrol.find((enemy) => enemy.kind === "guard")!;
    // Park the patrol while making the hit and connection changes deterministic. Its actual fight follows below.
    for (const enemy of patrol) Object.assign(enemy, { phase: "recover", ticks: 1800, target: "" });
    await a.go(ANNEX_CASE_HOME.x + 1.5, ANNEX_CASE_HOME.z);
    await until("the courier moves with the case", () => a.me.ack === a.seq && !a.me.moving && held(a));
    assert.ok(Math.abs(a.me.x - ANNEX_CASE_HOME.x) > .95);
    assert.ok(rooms.every((room) => near(caseIn(room), ANNEX_CASE_HOME)), "the held case retains its last floor position");
    const carrier = mission["players"].get(first.sessionId)!.player;
    Object.assign(guard, { x: carrier.x + 1.05, z: carrier.z, facing: -1, phase: "windup", ticks: 10, target: first.sessionId });
    await until("both clients see the Gateback hit and dropped case", () => caseState("") && hitFeeds.every((hits) =>
      hits.some((event) => event.source === guard.id && event.target === first.sessionId && event.damage === 21)));
    assert.ok(a.me.hp > 0);
    assert.ok(rooms.every((room) => near(caseIn(room), room.state.actors.get(first.sessionId)!, .35)));
    Object.assign(guard, { phase: "recover", ticks: 1800, target: "" });
    await approachCase(b);
    other.send("interact");
    await until("Ivo can pick up the dropped case", () => held(b));

    await a.go(b.me.x + .7, b.me.z);
    const partnerSession = other.sessionId;
    let reconnected = false;
    other.reconnection.minDelay = 1200;
    other.onReconnect.once(() => { reconnected = true; });
    other.connection.close(4010, "test drop while carrying the case");
    await until("the disconnected carrier leaves the case on the floor", () => caseIn(first).carrier === ""
      && first.state.actors.get(partnerSession)?.connected === false);
    first.send("interact");
    await until("Aster reclaims the case while Ivo is offline", () => caseIn(first).carrier === first.sessionId
      && first.state.actors.get(partnerSession)?.connected === false);
    await until("Ivo reconnects and sees Aster holding the same case", () => reconnected && other.sessionId === partnerSession
      && first.state.actors.get(partnerSession)?.connected && held(a));

    await recallForReader(a);
    const casualty = mission["players"].get(partnerSession)!.player;
    Object.assign(casualty, { hp: 0, x: carrier.x + .7, z: carrier.z });
    await until("the downed courier reaches both clients", () => rooms.every((room) => room.state.actors.get(partnerSession)?.hp === 0));
    first.send("interact");
    await until("rescue takes priority over setting the held case down", () => a.me.rescueTarget === partnerSession && held(a));
    await until("the rescue completes without dropping the case", () => b.me.hp === RESCUE_HEALTH && held(a));
    first.send("interact");
    await until("a separate use away from the desk sets the case down", () => caseState("") && phase(2, "combat"));
    for (const [index, enemy] of patrol.entries()) Object.assign(enemy, { ...spawns[index], phase: "idle", ticks: 0 });
    await fight([a, b], "signal", 28000);
    await until("the defeated patrol still leaves the roster case to file", () => phase(2, "signal") && caseState(""));
    assert.deepEqual(await Promise.all(party.map((account) => account.profile())), initial);

    const filer = a.me.hp > 0 ? a : b;
    await keepArmed(filer);
    await approachCase(filer);
    filer.room.send("interact");
    await until("the final courier takes the case to file", () => held(filer));
    await filer.go(ANNEX_FILING_DESK.x, ANNEX_FILING_DESK.z);
    await until("the carrier stops at the Records Desk", () => filer.me.ack === filer.seq && !filer.me.moving && held(filer));
    const messages = notices[rooms.indexOf(filer.room)];
    const beforeArmedAttempt = messages.length;
    filer.room.send("interact");
    await until("the Records Desk asks for recall", () => messages.slice(beforeArmedAttempt).some((message) => message.includes("Recall your partner")));
    assert.ok(phase(2, "signal") && held(filer));
    await recallForReader(filer);
    filer.room.send("interact");
    filer.room.send("interact");
    await until("filing clears the Registry Annex once for the party", () => phase(3, "complete") && caseState("", true));
    for (const [index, account] of party.entries()) {
      const profile = await account.profile();
      assert.equal(profile.companion, initial[index].companion);
      assert.equal(profile.battleXp, initial[index].battleXp + 48);
      assert.equal(profile.bond, initial[index].bond + 6);
      assert.deepEqual(profile.lore, [...initial[index].lore, "annex"]);
      assert.deepEqual(profile.clears, [...initial[index].clears, "annex"]);
    }
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("Bay Four Relay calls interrupt the patrol and unlock the Relay Pennant after both answers", { timeout: 75000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const [alpha, beta, guest] = await Promise.all(["Aster", "Ivo", "Guest"].map((name) => player(origin, name)));
    const party = [alpha, beta];
    for (const account of [alpha, beta, guest]) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      for (const mission of ["chapter", "night", "return", "terminal", "archive", "exchange"] as const) {
        server.store.reward([id], mission, mission);
      }
      if (account === guest) continue;
      server.store.reward([id], "departure", "departure");
      assert.equal(server.store.morph(id, "brick", "moth").ok, true);
      server.store.reward([id], "night-prep", "night");
      server.store.reward([id], "return-prep", "return");
      assert.equal(server.store.morph(id, "moth", "brick").ok, true);
      server.store.reward([id], "chapter-prep", "chapter");
    }
    const initial = await Promise.all(party.map((account) => account.profile()));
    for (const profile of initial) {
      assert.equal(profile.catalyst, false);
      assert.deepEqual(profile.catalystProgress, ["chapter"]);
    }
    await assert.rejects(guest.sdk.create("mission", { mission: "bayrelay" }), /Clear First Departure/);
    const first = connectHandlers(await alpha.sdk.create("mission", { mission: "bayrelay" }) as Socket);
    rooms.push(first);
    await assert.rejects(guest.sdk.joinById(first.roomId), /Clear First Departure/);
    const other = connectHandlers(await beta.sdk.joinById(first.roomId) as Socket);
    rooms.push(other);
    await Promise.all([local(first), local(other)]);

    const a = new TestCourier(first), b = new TestCourier(other);
    const [west, east] = routeMarkers("bayrelay", 0);
    const missionState = (status: string) => [first, other].every((room) => room.state.status === status);
    const enemies = (room: Socket) => [...room.state.actors.values()].filter((actor) => actor.kind !== "player");
    const observes: number[][] = [[], []];
    const interrupted: string[][] = [[], []];
    for (const [index, room] of [first, other].entries()) {
      room.onMessage("combat", (event: CombatEvent) => {
        if (event.type === "observe") observes[index].push(event.x);
        if (event.type === "interrupt") interrupted[index].push(event.source);
      });
    }
    const notices: string[] = [];
    first.onMessage("notice", (notice: string) => { notices.push(notice); });
    const recall = async (courier: TestCourier) => {
      await until("call operator stands idle", () => courier.me.phase === "idle");
      if (courier.me.armed) courier.send(0, 0, "morph");
      await until("the call operator's companion is recalled", () => !courier.me.armed && courier.me.phase === "idle");
    };

    first.send("begin");
    await until("both players enter Bay Four Relay", () => missionState("combat"));
    assert.deepEqual(enemies(first).map((enemy) => enemy.kind).sort(), ["guard", "runner", "runner"]);
    await a.go(west.x, west.z);
    await until("west operator ready", () => a.me.phase === "idle");
    if (!a.me.armed) a.send(0, 0, "morph");
    await until("west operator armed", () => a.me.armed);
    first.send("interact");
    await until("the West Call requires recall", () => notices.some((notice) => notice.includes("Recall your partner")));
    assert.equal(first.state.readerMask, 0);
    await recall(a);
    await until("an attack is telegraphed before the call", () => enemies(first).some((enemy) => enemy.phase === "windup"));
    const before = enemies(first).map((enemy) => enemy.hp);
    first.send("interact");
    await until("everyone sees the West Call cancel the patrol's attacks", () => [first, other].every((room) =>
      room.state.readerMask === west.readerBit && enemies(room).every((enemy) => enemy.phase === "hurt")));
    for (const room of [first, other]) {
      assert.deepEqual(enemies(room).map((enemy) => enemy.hp), before);
      assert.ok(enemies(room).every((enemy) => enemy.age > BAY_RELAY_STAGGER_TICKS - 12 && enemy.age <= BAY_RELAY_STAGGER_TICKS));
    }
    const enemyIds = [...first.state.actors.entries()].filter(([, actor]) => actor.kind !== "player").map(([id]) => id).sort();
    assert.deepEqual(interrupted.map((sources) => sources.sort()), [enemyIds, enemyIds]);
    first.send("interact");
    await until("the West Call cannot be repeated", () => notices.some((notice) => notice.includes("already checked in")));
    assert.deepEqual(observes, [[west.x], [west.x]]);

    await fight([a, b], "signal", 36000);
    await until("both players still have a call left after the patrol is clear", () => missionState("signal"));
    assert.equal(first.state.readerMask, west.readerBit);
    const beforeLastCall = [first, other].map(crewAssists);
    for (const account of party) assert.equal((await account.profile()).bayRelayComplete, undefined);
    const plaza = connectHandlers(await alpha.sdk.joinOrCreate("plaza") as Socket);
    rooms.push(plaza);
    await local(plaza);
    let updated: Profile | undefined;
    plaza.onMessage("profile", (profile: Profile) => { updated = profile; });
    const equipPennant = async () => {
      updated = undefined;
      plaza.send("customize", { trinket: RELAY_PENNANT });
      return until("the companion room replies to the pennant choice", () => updated);
    };
    assert.equal((await equipPennant()).trinket, initial[0].trinket);

    const operator = b.me.hp > 0 ? b : a;
    await operator.go(east.x, east.z);
    await recall(operator);
    operator.room.send("interact");
    operator.room.send("interact");
    await until("the East Call completes the contract", () => missionState("complete") && first.state.readerMask === BAY_RELAY_CALLS_COMPLETE);
    assert.deepEqual(observes, [[west.x, east.x], [west.x, east.x]]);
    assert.deepEqual([first, other].map(crewAssists), beforeLastCall, "the post-fight call does not credit an assist");
    for (const [index, account] of party.entries()) {
      const profile = await account.profile();
      assert.equal(profile.bayRelayComplete, true);
      assert.equal(profile.battleXp, initial[index].battleXp + 32);
      assert.equal(profile.trinket, initial[index].trinket);
      assert.deepEqual(profile.lore, initial[index].lore);
      assert.deepEqual(profile.clears, initial[index].clears);
      assert.equal(profile.bond, initial[index].bond);
      assert.equal(profile.catalyst, false);
      assert.deepEqual(profile.catalystProgress, initial[index].catalystProgress);
    }
    assert.equal((await equipPennant()).trinket, RELAY_PENNANT);
    await until("the equipped pennant reaches actor state", () => plaza.state.actors.get(plaza.sessionId)?.relayPennant);
    first.send("begin");
    await until("replay resets both call boxes", () => missionState("combat") && [first, other].every((room) => room.state.readerMask === 0));
    assert.deepEqual([first, other].map(crewAssists), [[], []]);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
  }
});

test("Bay Four Relay shares call and rescue credits and resets them on retry", { timeout: 22000 }, async () => {
  const server = await runServer({ port: 0, database: ":memory:" });
  const origin = "http://127.0.0.1:" + server.port;
  const rooms: Socket[] = [];
  try {
    const party = await Promise.all(["Aster", "Ivo", "Sena"].map((name) => player(origin, name)));
    for (const account of party) {
      const { id } = server.store.session(account.sdk.auth.token)!;
      server.store.reward([id], "departure-unlock", "departure");
    }
    const first = connectHandlers(await party[0].sdk.create("mission", { mission: "bayrelay" }) as Socket);
    rooms.push(first);
    for (const account of party.slice(1)) rooms.push(connectHandlers(await account.sdk.joinById(first.roomId) as Socket));
    await Promise.all(rooms.map(local));
    const [a, b, c] = rooms.map((room) => new TestCourier(room));
    const [west, east] = routeMarkers("bayrelay", 0);
    const mission = matchMaker.getLocalRoomById(first.roomId) as MissionRoom;
    const place = (courier: TestCourier, x: number, z: number) =>
      Object.assign(mission["players"].get(courier.room.sessionId)!.player, { x, z, facing: 1 });
    const parkPatrol = () => {
      const patrol = [...mission["enemies"].values()];
      for (const enemy of patrol) Object.assign(enemy, { phase: "recover", ticks: 600, target: "", x: 9, z: -4 });
      return patrol;
    };
    const armIvo = async () => {
      if (!b.me.armed) b.send(0, 0, "morph");
      await until("Ivo has drawn the coil staff", () => b.me.armed && b.me.phase === "idle");
    };
    const awaitCall = (mask: number) => until("all clients see the call", () => rooms.every((room) => room.state.readerMask === mask));
    const assertShared = (expected: ReturnType<typeof crewAssists>) => {
      for (const room of rooms) assert.deepEqual(crewAssists(room), expected);
    };
    const hits: CombatEvent[] = [];
    b.room.onMessage("combat", (event: CombatEvent) => { if (event.type === "hit" && event.source === b.room.sessionId) hits.push(event); });
    const strike = async (enemyId: string) => {
      const before = hits.length;
      b.send(0, 0, "attack");
      await until("server confirmed Ivo's hit", () => hits.slice(before).some((event) => event.target === enemyId));
      return hits.slice(before);
    };
    const retry = async () => {
      for (const { player: actor } of mission["players"].values()) actor.hp = 0;
      await until("the test wipe reaches everyone", () => rooms.every((room) => room.state.status === "failed"));
      first.send("begin");
      await until("retry starts with empty boxes and record", () => rooms.every((room) => room.state.status === "combat"
        && room.state.readerMask === 0 && room.state.crewAssists.length === 0));
    };

    first.send("begin");
    await until("all clients enter the contract", () => rooms.every((room) => room.state.status === "combat"));
    const [runner, gateback] = parkPatrol();
    place(a, west.x, west.z);
    place(b, 0, 0);
    place(c, east.x, east.z);
    await armIvo();
    Object.assign(runner, { x: 1.25, z: 0, phase: "windup", ticks: 32, target: b.room.sessionId, strikeX: 0, strikeZ: 0 });
    await until("the runner's telegraph reaches the clients", () => rooms.every((room) => room.state.actors.get(runner.id)?.phase === "windup"));
    a.room.send("interact");
    await awaitCall(west.readerBit!);
    const westCredit = { kind: "call", source: "Aster", target: "Ivo", station: west.title } as const;
    assertShared([westCredit]);
    await strike(runner.id);
    await until("the follow-up swing ends", () => b.me.phase === "idle");
    assertShared([westCredit]);

    parkPatrol();
    Object.assign(gateback, { x: 1.25, z: 0 });
    c.room.send("interact");
    await awaitCall(BAY_RELAY_CALLS_COMPLETE);
    assertShared([westCredit]);
    await strike(gateback.id);
    await until("everyone sees the converted East Call", () => rooms.every((room) => room.state.crewAssists.length === 2));
    const eastCredit = { kind: "call", source: "Sena", target: "Ivo", station: east.title } as const;
    assertShared([westCredit, eastCredit]);

    parkPatrol();
    let reconnected = false;
    b.room.onReconnect.once(() => { reconnected = true; });
    b.room.connection.close(4010, "test drop at the call box");
    await until("Ivo reconnects with the crew record", () => reconnected && first.state.actors.get(b.room.sessionId)?.connected
      && b.room.state.crewAssists.length === 2);
    assertShared([westCredit, eastCredit]);

    place(a, 0, 0);
    const casualty = place(b, 1, 0);
    casualty.hp = 0;
    await until("the crew sees Ivo downed", () => first.state.actors.get(b.room.sessionId)?.hp === 0);
    a.room.send("interact");
    await until("the rescue begins", () => a.me.rescueTarget === b.room.sessionId);
    a.send(0, 0, "jump");
    await until("the canceling jump ends", () => !a.me.rescueTarget && a.me.phase === "idle");
    assert.equal(b.me.hp, 0);
    assertShared([westCredit, eastCredit]);
    a.room.send("interact");
    await until("the completed rescue reaches the crew", () => b.me.hp === RESCUE_HEALTH
      && rooms.every((room) => room.state.crewAssists.length === 3));
    const rescueCredit = { kind: "rescue", source: "Aster", target: "Ivo", station: "" } as const;
    assertShared([westCredit, eastCredit, rescueCredit]);

    await retry();
    const [selfTarget, followThrough] = parkPatrol();
    place(a, west.x, west.z);
    place(b, 0, 0);
    place(c, east.x, east.z);
    await armIvo();
    Object.assign(selfTarget, {
      x: west.x + 1.25, z: west.z, phase: "windup", ticks: 32, target: a.room.sessionId, strikeX: west.x, strikeZ: west.z,
    });
    a.room.send("interact");
    await awaitCall(west.readerBit!);
    assertShared([]);
    // The same stroke hits two affected enemies. Only the latest call can earn credit.
    Object.assign(selfTarget, { x: 1.25, z: -.2 });
    Object.assign(followThrough, { x: 1.25, z: .2 });
    c.room.send("interact");
    await awaitCall(BAY_RELAY_CALLS_COMPLETE);
    assertShared([]);
    const multiHit = await strike(followThrough.id);
    assert.deepEqual(multiHit.map((event) => event.target), [selfTarget.id, followThrough.id]);
    await until("everyone sees only the latest call credit", () => rooms.every((room) => room.state.crewAssists.length === 1));
    assertShared([eastCredit]);

    await retry();
    parkPatrol();
    place(a, west.x, west.z);
    place(b, 0, 0);
    await armIvo();
    a.room.send("interact");
    await awaitCall(west.readerBit!);
    const callFrame = first.state.frame;
    const beforeWhiff = hits.length;
    b.send(0, 0, "attack");
    await until("the server shows Ivo's whiff", () => b.me.phase === "attack");
    await until("the whiff ends", () => b.me.phase === "idle");
    assert.equal(hits.length, beforeWhiff);
    assertShared([]);
    await until("the window expires", () => first.state.frame > callFrame + BAY_RELAY_STAGGER_TICKS);
    const [lateTarget] = parkPatrol();
    Object.assign(lateTarget, { x: 1.25, z: 0 });
    await strike(lateTarget.id);
    await until("the late strike ends", () => b.me.phase === "idle");
    assertShared([]);
  } finally {
    await Promise.allSettled(rooms.map((room) => room.leave()));
    await server.stop();
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
