import test from "node:test";
import assert from "node:assert/strict";
import { ARM_TICKS, inStrike, isInvulnerable, makeEnemy, makePlayer, stepEnemy, stepPlayer, type CombatEvent, type Move } from "../packages/shared/src/combat.ts";
import { FORMS, type Family, type Action } from "../packages/shared/src/content.ts";

function floor(family: Family = "moth") {
  const p = makePlayer("courier", "Courier", "Neri", family);
  p.x = 0;
  const target = makeEnemy("guard", "dummy", 1.2, 0);
  const events: CombatEvent[] = [];
  let tick = 0;
  const step = (ticks: number, action?: Action) => {
    for (let i = 0; i < ticks; i++) {
      stepPlayer(p, { x: 0, z: 0 }, i === 0 ? action : undefined, ++tick, [target], events, false);
      stepEnemy(target, [], tick, events);
    }
  };
  return { p, target, events, step };
}

test("arming and recall complete for each family and keep the same companion", () => {
  for (const family of Object.keys(FORMS) as Family[]) {
    const { p, step } = floor(family);
    step(ARM_TICKS - 1, "morph");
    assert.equal(p.armed, false);
    step(1);
    assert.equal(p.armed, true);
    step(ARM_TICKS, "morph");
    assert.equal(p.armed, false);
    assert.equal(p.companion, "Neri");
    assert.equal(p.family, family);
  }
});

test("an attack whiffs at the wrong depth or height and counts once inside range", () => {
  const { p, target, step, events } = floor();
  const opening = FORMS.moth.chain[0];
  p.armed = true;
  target.z = 1.65;
  assert.equal(inStrike(p, target, opening), false);
  step(27, "attack");
  assert.equal(target.hp, target.maxHp);
  target.z = 0;
  target.y = 1.6;
  assert.equal(inStrike(p, target, opening), false);
  target.y = 0;
  step(35, "attack");
  assert.equal(events.filter((e) => e.type === "hit").length, 1);
  assert.equal(p.combo, 1);
});

test("buffer links a three-hit chain and permits a dodge in recovery", () => {
  const { p, step, events } = floor();
  p.armed = true;
  step(20, "attack");
  step(29, "attack");
  step(33, "attack");
  assert.deepEqual(events.filter((e) => e.type === "hit").map((e) => e.damage), [17, 21, 31]);
  step(2, "dodge");
  assert.equal(p.move?.kind, "dodge");
  assert.equal(isInvulnerable(p), true);
  step(12);
  assert.equal(isInvulnerable(p), false);
});

test("a launcher lifts its target, the player can jump and hit, and both can land", () => {
  const { p, target, step, events } = floor();
  p.armed = true;
  target.kind = "skitter";
  step(36, "skill");
  assert.ok(target.y > 0);
  step(8, "jump");
  assert.ok(p.y > 0);
  step(7, "attack");
  assert.equal(p.move?.kind, "air");
  assert.ok(events.filter((e) => e.type === "hit").length >= 2);
  step(90);
  assert.equal(p.y, 0);
  assert.equal(target.y, 0);
});

test("a mastery record requires battle rank three after a morph", () => {
  const { p, step } = floor("heron");
  p.armed = true; p.mastered = true;
  step(1, "mastery");
  assert.equal(p.move, null);
  p.rank = 3;
  step(1, "mastery");
  assert.equal((p.move as Move | null)?.kind, "mastery");
  assert.equal(p.energy, 60);
});

test("an enemy waits for the target's next attack opening when that slot is occupied", () => {
  const player = makePlayer("target", "Courier", "Neri", "moth");
  player.x = 0;
  const enemy = makeEnemy("crawler", "skitter", 1, 0);
  const events: CombatEvent[] = [];
  stepEnemy(enemy, [player], 1, events, () => false);
  assert.notEqual(enemy.phase, "windup");
  assert.equal(events.length, 0);
  stepEnemy(enemy, [player], 2, events, (id) => id === player.id);
  assert.equal(enemy.phase, "windup");
  assert.equal(events[0]?.type, "windup");
});
