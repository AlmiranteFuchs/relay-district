import { FORMS, MAX_ENERGY, TICK_RATE, type Action, type Family, type Strike } from "./content.ts";

export const DT = 1 / TICK_RATE;
export const PLAYER_SPEED = 5.2;
export const LIMITS = { x: 10.8, z: 4.75 };
export const ARM_TICKS = 20;
export const RESCUE_TICKS = 72;
export const RESCUE_RANGE = 1.55;
export const RESCUE_HEALTH = 40;
const BUFFER_TICKS = 18;
const MAX_HEALTH = 125;
const GRAVITY = 19;

export interface Axes { x: number; z: number }
export interface Input extends Axes { seq: number; action?: Action }
export interface Position { x: number; z: number; facing: number }
export type EnemyKind = "skitter" | "guard" | "keeper" | "dummy";
export const ENEMY_WINDUP_TICKS = { skitter: 32, guard: 38, keeper: 52, dummy: 1 } as const;
export interface CombatEvent {
  type: "hit" | "swing" | "windup" | "arm" | "dodge" | "down" | "observe" | "revive" | "clear";
  source: string;
  target?: string;
  damage?: number;
  heavy?: boolean;
  x: number;
  z: number;
}
export type MoveKind = "attack" | "skill" | "mastery" | "air" | "arm" | "recall" | "dodge";
export interface Move {
  kind: MoveKind;
  age: number;
  step: number;
  length: number;
  strike?: Strike;
  victims: Set<string>;
  dashX: number;
  dashZ: number;
}
export interface Player extends Position {
  id: string; name: string; companion: string; family: Family; armed: boolean;
  hp: number; energy: number; y: number; vy: number; move: Move | null;
  combo: number; comboTicks: number; stagger: number; lastHit: number;
  mastered: boolean; rank: number; buffer: { action: Action; until: number } | null;
  chainStep: number; chainUntil: number;
}
export interface Enemy extends Position {
  id: string; kind: EnemyKind; hp: number; maxHp: number; y: number; vy: number;
  phase: "idle" | "advance" | "windup" | "active" | "recover" | "hurt" | "down";
  ticks: number; target: string; strikeX: number; strikeZ: number; hit: Set<string>;
}

export function makePlayer(id: string, name: string, companion: string, family: Family): Player {
  return {
    id, name, companion, family, armed: false, x: -6, z: 0, facing: 1, y: 0, vy: 0,
    hp: MAX_HEALTH, energy: MAX_ENERGY, move: null, combo: 0, comboTicks: 0, stagger: 0,
    lastHit: -600, mastered: false, rank: 1, buffer: null, chainStep: 0, chainUntil: 0,
  };
}

export function resetPlayer(player: Player, index: number, full = true) {
  Object.assign(player, {
    x: -7.4, z: (index - 1.5) * 1.1, y: 0, vy: 0, facing: 1, move: null,
    combo: 0, comboTicks: 0, stagger: 0, buffer: null, chainStep: 0, chainUntil: 0,
  });
  player.hp = full ? MAX_HEALTH : Math.min(MAX_HEALTH, player.hp + 28);
  player.energy = full ? MAX_ENERGY : Math.min(MAX_ENERGY, player.energy + 36);
}

export function canRescueIn(status: string) {
  return ["combat", "interlude", "route", "signal"].includes(status);
}

export function rescueDistance(from: Axes, to: Axes) {
  return Math.hypot(from.x - to.x, from.z - to.z);
}

export function makeEnemy(id: string, kind: EnemyKind, x: number, z: number, players = 1): Enemy {
  const base = { skitter: 55, guard: 110, keeper: 280, dummy: 240 }[kind];
  const hp = Math.round(base * (1 + (players - 1) * 0.46));
  return { id, kind, x, z, hp, maxHp: hp, facing: -1, y: 0, vy: 0, phase: "idle",
    ticks: 0, target: "", strikeX: x, strikeZ: z, hit: new Set() };
}

export function sanitizeAxes(axes: Axes): Axes {
  const x = Number.isFinite(axes.x) ? Math.max(-1, Math.min(1, axes.x)) : 0;
  const z = Number.isFinite(axes.z) ? Math.max(-1, Math.min(1, axes.z)) : 0;
  const length = Math.hypot(x, z);
  return length > 1 ? { x: x / length, z: z / length } : { x, z };
}

export function clampPosition(position: Position) {
  position.x = Math.max(-LIMITS.x, Math.min(LIMITS.x, position.x));
  position.z = Math.max(-LIMITS.z, Math.min(LIMITS.z, position.z));
}

export function stepWalk(actor: Position, direction: Axes, dt = DT) {
  const axes = sanitizeAxes(direction);
  if (Math.abs(axes.x) > 0.1) actor.facing = Math.sign(axes.x);
  actor.x += axes.x * PLAYER_SPEED * dt;
  actor.z += axes.z * PLAYER_SPEED * dt;
  clampPosition(actor);
}

function gravity(actor: { y: number; vy: number }) {
  if (actor.y <= 0 && actor.vy <= 0) return;
  actor.y = Math.max(0, actor.y + actor.vy * DT);
  actor.vy = actor.y === 0 ? 0 : actor.vy - GRAVITY * DT;
}

export function inStrike(player: Player, enemy: Enemy, strike: Strike): boolean {
  const forward = (enemy.x - player.x) * player.facing;
  return forward >= (strike.area ? -strike.reach * 0.53 : -0.2)
    && forward <= strike.reach + (enemy.kind === "keeper" ? 0.35 : 0)
    && Math.abs(enemy.z - player.z) <= strike.depth
    && Math.abs(enemy.y - player.y) < (strike.lift && player.y === 0 ? 1.5 : 1.12);
}

function publish(events: CombatEvent[], type: CombatEvent["type"], actor: Position & { id: string }, extra?: Partial<CombatEvent>) {
  events.push({ type, source: actor.id, x: actor.x, z: actor.z, ...extra });
}

function selectMove(player: Player, kind: MoveKind, strike: Strike | undefined, step: number, length: number, direction: Axes) {
  player.move = {
    kind, age: 0, strike, step, length, victims: new Set(),
    dashX: direction.x || (!direction.z ? player.facing : 0), dashZ: direction.z,
  };
}

function canDodgeCancel(move: Move): boolean {
  return move.kind === "attack" && !!move.strike
    && move.age >= move.strike.startup + move.strike.active + 3
    && move.age < move.length - 1;
}

export function isInvulnerable(player: Player): boolean {
  return player.move?.kind === "dodge" && player.move.age >= 2 && player.move.age <= 12;
}

function tryAction(player: Player, action: Action, axes: Axes, tick: number, events: CombatEvent[]): boolean {
  if (player.stagger > 0) return false;
  if (player.move && !(action === "dodge" && canDodgeCancel(player.move))) return false;
  if (action === "morph") {
    selectMove(player, player.armed ? "recall" : "arm", undefined, 0, ARM_TICKS, axes);
    publish(events, "arm", player);
    return true;
  }
  if (action === "dodge" && player.y === 0) {
    selectMove(player, "dodge", undefined, 0, 22, axes);
    player.chainUntil = 0;
    publish(events, "dodge", player);
    return true;
  }
  if (action === "jump" && player.y === 0) {
    player.vy = 5.7;
    return true;
  }
  if (!player.armed || !["attack", "skill", "mastery"].includes(action)) return false;
  const form = FORMS[player.family];
  let step = 0;
  let kind: MoveKind = action as MoveKind;
  let strike: Strike;
  if (action === "attack") {
    if (player.y > 0.16) {
      kind = "air";
      strike = form.air;
    } else {
      step = player.chainUntil >= tick ? player.chainStep : 0;
      strike = form.chain[step];
    }
  } else {
    if (player.y > 0.16 || player.energy < (action === "skill" ? 28 : 40)) return false;
    if (action === "mastery" && (!player.mastered || player.rank < 3)) return false;
    player.energy -= action === "skill" ? 28 : 40;
    strike = action === "skill" ? form.skill : form.mastery;
  }
  selectMove(player, kind, strike, step, strike.startup + strike.active + strike.recovery, axes);
  return true;
}

function strikeTargets(player: Player, move: Move, enemies: Iterable<Enemy>, events: CombatEvent[]) {
  const strike = move.strike;
  if (!strike || move.age < strike.startup || move.age >= strike.startup + strike.active) return;
  if (move.age === strike.startup) publish(events, "swing", player, { heavy: move.step === 2 || move.kind !== "attack" });
  for (const enemy of enemies) {
    if (enemy.hp <= 0 || move.victims.has(enemy.id) || !inStrike(player, enemy, strike)) continue;
    const first = move.victims.size === 0;
    move.victims.add(enemy.id);
    const guarded = (enemy.kind === "keeper" || enemy.kind === "guard") && enemy.phase === "windup" && !strike.breakGuard;
    const damage = Math.min(enemy.hp, guarded ? Math.ceil(strike.damage * 0.5) : strike.damage);
    enemy.hp -= damage;
    player.combo += 1;
    player.comboTicks = 110;
    if (first) player.energy = Math.min(MAX_ENERGY, player.energy + 5);
    if (!guarded && enemy.kind !== "dummy") {
      enemy.phase = enemy.hp === 0 ? "down" : "hurt";
      enemy.ticks = strike.stagger;
      if (enemy.kind !== "keeper" && strike.lift && enemy.hp > 0) {
        enemy.vy = Math.max(enemy.vy, enemy.y > 0.4 ? strike.lift * 0.43 : strike.lift);
      }
      enemy.x += player.facing * (move.step === 2 ? 0.4 : 0.12);
      clampPosition(enemy);
    } else if (enemy.hp === 0) enemy.phase = "down";
    publish(events, "hit", player, { target: enemy.id, damage, x: enemy.x, z: enemy.z, heavy: move.step === 2 || move.kind === "mastery" });
    if (!enemy.hp) publish(events, "down", enemy);
  }
}

export function stepPlayer(player: Player, input: Axes, action: Action | undefined, tick: number, enemies: Iterable<Enemy>, events: CombatEvent[], safe: boolean) {
  if (!player.hp) return;
  const axes = sanitizeAxes(input);
  if (player.stagger > 0) player.stagger--;
  if (player.comboTicks > 0 && --player.comboTicks === 0) player.combo = 0;
  if (safe && !player.armed && !player.move) player.energy = Math.min(MAX_ENERGY, player.energy + 16 * DT);
  if (action) {
    if (tryAction(player, action, axes, tick, events)) player.buffer = null;
    else if (action === "attack" || action === "skill" || action === "dodge") {
      player.buffer = { action, until: tick + BUFFER_TICKS };
    }
  }
  if (player.buffer) {
    if (tick > player.buffer.until || tryAction(player, player.buffer.action, axes, tick, events)) player.buffer = null;
  }
  const move = player.move;
  if (!move) {
    if (player.stagger === 0) stepWalk(player, axes, player.y > 0 ? DT * 0.83 : DT);
  } else {
    move.age++;
    const drive = move.kind === "dodge" && move.age < 15 ? 9.7
      : move.strike && move.age >= move.strike.startup - 3
        && move.age < move.strike.startup + move.strike.active ? (move.strike.drive ?? 0) : 0;
    if (drive) {
      player.x += (move.kind === "dodge" ? move.dashX : player.facing) * drive * DT;
      if (move.kind === "dodge") player.z += move.dashZ * drive * DT;
      clampPosition(player);
    }
    strikeTargets(player, move, enemies, events);
    if (move.age >= move.length) {
      if (move.kind === "arm" || move.kind === "recall") player.armed = move.kind === "arm";
      if (move.kind === "attack") { player.chainStep = (move.step + 1) % 3; player.chainUntil = tick + 12; }
      player.move = null;
    }
  }
  gravity(player);
}

export function stepEnemy(
  enemy: Enemy, players: Iterable<Player>, tick: number, events: CombatEvent[],
  canWindUp: (target: string) => boolean = () => true,
) {
  gravity(enemy);
  if (!enemy.hp || enemy.kind === "dummy") return;
  if (enemy.ticks > 0) enemy.ticks--;
  if (enemy.phase === "hurt" || enemy.phase === "recover") {
    if (enemy.ticks === 0) enemy.phase = "idle";
    return;
  }
  if (enemy.y > 0.18) return;
  const size = enemy.kind === "keeper" ? 1.5 : enemy.kind === "guard" ? 1.15 : 1;
  if (enemy.phase === "windup") {
    if (enemy.ticks > 0) return;
    enemy.phase = "active";
    enemy.ticks = 8;
    enemy.hit.clear();
    publish(events, "swing", enemy, { heavy: size > 1 });
  }
  if (enemy.phase === "active") {
    for (const player of players) {
      if (!player.hp || player.y > 0.98 || isInvulnerable(player) || enemy.hit.has(player.id)) continue;
      const forward = (player.x - enemy.x) * enemy.facing;
      if (forward < -0.25 || forward > 1.77 * size || Math.abs(player.z - enemy.z) > 0.86 * size) continue;
      enemy.hit.add(player.id);
      const damage = Math.min(player.hp, size === 1.5 ? 25 : size === 1.15 ? 21 : 13);
      player.hp -= damage;
      player.stagger = 18;
      player.combo = 0;
      player.move = null;
      player.buffer = null;
      player.lastHit = tick;
      player.x += enemy.facing * 0.29;
      clampPosition(player);
      publish(events, "hit", enemy, { target: player.id, damage, x: player.x, z: player.z, heavy: size > 1 });
      if (!player.hp) publish(events, "down", player);
    }
    if (enemy.ticks === 0) { enemy.phase = "recover"; enemy.ticks = size === 1.5 ? 62 : size > 1 ? 45 : 32; }
    return;
  }
  let nearest: Player | undefined;
  let distance = Infinity;
  for (const player of players) {
    if (!player.hp) continue;
    const value = Math.hypot(player.x - enemy.x, (player.z - enemy.z) * 1.15);
    if (value < distance) { nearest = player; distance = value; }
  }
  if (!nearest) { enemy.phase = "idle"; return; }
  const dx = nearest.x - enemy.x;
  const dz = nearest.z - enemy.z;
  if (Math.abs(dx) > 0.1) enemy.facing = Math.sign(dx);
  if (Math.abs(dx) <= 1.44 * size && Math.abs(dz) <= 0.65 * size) {
    if (!canWindUp(nearest.id)) return;
    enemy.phase = "windup";
    enemy.ticks = ENEMY_WINDUP_TICKS[enemy.kind];
    enemy.target = nearest.id;
    enemy.strikeX = nearest.x;
    enemy.strikeZ = nearest.z;
    publish(events, "windup", enemy, { heavy: size > 1 });
    return;
  }
  const speed = (size > 1 ? 2.35 : 2.95) * DT / Math.max(0.02, Math.hypot(dx, dz));
  enemy.phase = "advance";
  enemy.x += dx * speed;
  enemy.z += dz * speed;
  clampPosition(enemy);
}
