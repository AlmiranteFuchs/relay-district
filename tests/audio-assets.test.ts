import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAudioAssets } from "../packages/web/src/audio-assets.ts";

test("mission score replacement supplies both aligned stems and the beat interval", async () => {
  const result = await loadAudioAssets(async (path) => ({ path, length: 96000 }), {
    cues: { plaza: "/audio/courtyard.wav", "bellhouse-mid": "/audio/bronze-mid.wav" },
    mission: { lane: "/audio/terminal.wav", fight: "/audio/terminal-fight.wav", bpm: 120 },
  });
  assert.equal(result.buffers.size, 14);
  assert.equal(result.buffers.get("plaza")?.path, "/audio/courtyard.wav");
  assert.equal(result.buffers.get("windup")?.path, "/audio/windup.wav");
  assert.equal(result.buffers.get("departure")?.path, "/audio/departure.wav");
  assert.equal(result.buffers.get("bellhouse-low")?.path, "/audio/bellhouse-low.wav");
  assert.equal(result.buffers.get("bellhouse-mid")?.path, "/audio/bronze-mid.wav");
  assert.equal(result.buffers.get("lane")?.path, "/audio/terminal.wav");
  assert.equal(result.buffers.get("fight")?.path, "/audio/terminal-fight.wav");
  assert.equal(result.missionBeat, .5);
});

test("unaligned score stems fall back as a pair and a failed cue falls back independently", async (context) => {
  const warning = context.mock.method(console, "warn", () => {});
  const result = await loadAudioAssets(async (path) => {
    if (path === "/audio/unavailable.wav") throw new Error("missing");
    return { path, length: path === "/audio/early.wav" ? 95000 : 96000 };
  }, {
    cues: { hit: "/audio/unavailable.wav", swing: "/audio/coil.wav", "bellhouse-high": "/audio/unavailable.wav" },
    mission: { lane: "/audio/new-lane.wav", fight: "/audio/early.wav", bpm: 120 },
  });
  assert.equal(result.buffers.size, 14);
  assert.equal(result.buffers.get("hit")?.path, "/audio/hit.wav");
  assert.equal(result.buffers.get("swing")?.path, "/audio/coil.wav");
  assert.equal(result.buffers.get("bellhouse-high")?.path, "/audio/bellhouse-high.wav");
  assert.equal(result.buffers.get("lane")?.path, "/audio/lane.wav");
  assert.equal(result.buffers.get("fight")?.path, "/audio/fight.wav");
  assert.equal(result.missionBeat, 60 / 136);
  assert.equal(warning.mock.callCount(), 3);
});
