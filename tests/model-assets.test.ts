import assert from "node:assert/strict";
import test from "node:test";
import { Animation, AnimationGroup, AssetContainer, NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { instantiateActorModel } from "../packages/web/src/model-assets.ts";
import type { ViewActor } from "../packages/web/src/view.ts";

test("authored courier clips follow combat ticks and keep each actor's weapon socket independent", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const socket = new TransformNode("weapon_socket", scene);
    const container = new AssetContainer(scene);
    container.transformNodes.push(socket);
    scene.removeTransformNode(socket);
    for (const [name, reach] of [["Idle", 0], ["Staff_01", 26], ["Gauntlets_01", 52]] as const) {
      const group = new AnimationGroup(name, scene);
      const track = new Animation(name, "position.x", 60, Animation.ANIMATIONTYPE_FLOAT);
      track.setKeys([{ frame: 0, value: 0 }, { frame: 26, value: reach }]);
      group.addTargetedAnimation(track, socket);
      container.animationGroups.push(group);
      scene.removeAnimationGroup(group);
    }
    const asset = { container, animation: {
      clips: { idle: "Idle", attack1: "Staff_01" },
      families: { brick: { attack1: "Gauntlets_01" } }, weaponSocket: "weapon_socket",
    } };
    const first = instantiateActorModel(scene, "courier", asset);
    const second = instantiateActorModel(scene, "courier", asset);
    assert.ok(first.animation && first.weaponSocket && second.animation && second.weaponSocket);
    assert.notEqual(first.weaponSocket, second.weaponSocket);
    assert.equal(first.parts.size, 0);
    const state: ViewActor = {
      phase: "idle", family: "moth", age: 0, duration: 0, step: 0, moving: false, x: 0, y: 0, z: 0,
      facing: 1, name: "Courier", companion: "Neri", kind: "player", hp: 125, maxHp: 125, energy: 100,
      armed: false, connected: true, combo: 0, ack: 0, rank: 1, rescued: false, rescueTarget: "", rescueTicks: 0,
    };
    second.animation.pose(state, 0);
    const attack: ViewActor = { ...state, phase: "attack", armed: true, age: 9, duration: 26 };
    first.animation.pose(attack, 0);
    assert.equal(first.weaponSocket.position.x, 9);

    first.animation.pose(attack, .05);
    assert.ok(first.weaponSocket.position.x > 9 && first.weaponSocket.position.x < 10);
    first.animation.pose({ ...attack, age: 10 }, 0);
    assert.equal(first.weaponSocket.position.x, 10);
    assert.equal(second.weaponSocket.position.x, 0);

    first.animation.pose({ ...attack, age: 10, family: "brick" }, 0);
    assert.equal(first.weaponSocket.position.x, 20);
    first.animation.pose({ ...attack, step: 1 }, 0);
    assert.equal(first.weaponSocket.position.x, 0);

    first.dispose();
    second.dispose();
    assert.equal(scene.animationGroups.length, 0);
    container.dispose();
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
