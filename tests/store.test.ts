import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../packages/server/src/store.ts";

test("one companion survives chapter, mastery, morph, and a database restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-test-"));
  const file = join(dir, "profile.sqlite");
  let store = new Store(file);
  try {
    const account = store.create("Courier");
    store.customize(account.id, { companion: "Pebble", play: true, trinket: "Copper ribbon", roomTheme: "Moss glass" });
    store.discoverLore(account.id, "log");
    store.reward([account.id], "training-a", "training", "moth");
    store.reward([account.id, account.id], "job-a", "chapter");
    store.reward([account.id], "job-a", "chapter");
    assert.equal(store.profile(account.id).battleXp, 98);
    assert.equal(store.morph(account.id, "boar", "moth").ok, false);
    const result = store.morph(account.id, "brick", "moth");
    assert.equal(result.ok, true);
    assert.equal(result.profile.battleXp, 0);
    assert.equal(result.profile.catalyst, false);
    assert.deepEqual(result.profile.mastery, ["moth"]);
    assert.deepEqual(result.profile.history, ["moth", "brick"]);
    assert.deepEqual(result.profile.lore, ["log"]);
    assert.equal(result.profile.companion, "Pebble");
    assert.equal(result.profile.trinket, "Copper ribbon");
    assert.equal(result.profile.roomTheme, "Moss glass");
    assert.ok(result.profile.bond > 0);
    assert.equal(store.morph(account.id, "moth", "brick").ok, false);
    store.reward([account.id], "repeat-a", "chapter");
    store.reward([account.id], "repeat-b", "chapter");
    assert.equal(store.profile(account.id).catalyst, false);
    store.reward([account.id], "challenge-a", "platform");
    assert.equal(store.profile(account.id).catalyst, true);
    assert.equal(store.morph(account.id, "moth", "brick").profile.battleXp, 0);
    store.close();
    store = new Store(file);
    assert.equal(store.session(account.token)?.profile.companion, "Pebble");
    assert.deepEqual(store.session(account.token)?.profile.history, ["moth", "brick", "moth"]);
    assert.equal(store.session("x".repeat(43)), null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a practice preview cannot grant XP, mastery, or a catalyst", () => {
  const store = new Store(":memory:");
  try {
    const { id, profile } = store.create("Practice");
    store.reward([id], "preview-a", "training", "moth", true);
    assert.deepEqual(store.profile(id), profile);
  } finally { store.close(); }
});

test("the complete roster can be discovered and mastered without changing companion identity", () => {
  const store = new Store(":memory:");
  try {
    const { id } = store.create("Courier");
    store.reward([id], "first-chapter", "chapter");
    assert.equal(store.morph(id, "brick", "moth").ok, true);
    for (const [current, next, mission] of [["brick", "heron", "platform"], ["heron", "boar", "transformer"]] as const) {
      store.reward([id], "drill-" + current, "training", current);
      store.reward([id], "chapter-" + next, "chapter");
      store.reward([id], "challenge-" + next, mission);
      const result = store.morph(id, next, current);
      assert.equal(result.ok, true);
      assert.equal(result.profile.battleXp, 0);
    }
    store.reward([id], "drill-boar", "training", "boar");
    store.reward([id], "return-chapter", "chapter");
    store.reward([id], "return-platform", "platform");
    assert.equal(store.morph(id, "moth", "boar").ok, true);
    store.reward([id], "drill-moth", "training", "moth");
    const final = store.profile(id);
    assert.equal(final.companion, "Neri");
    assert.deepEqual(final.discovered, ["moth", "brick", "heron", "boar"]);
    assert.deepEqual(final.history, ["moth", "brick", "heron", "boar", "moth"]);
    assert.equal(final.mastery.length, 4);
  } finally { store.close(); }
});
