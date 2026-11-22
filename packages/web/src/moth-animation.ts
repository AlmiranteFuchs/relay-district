import { Matrix, Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import { ARM_TICKS } from "../../shared/src/combat.ts";
import { FORMS, PATCH_MS, TICK_RATE, type Strike } from "../../shared/src/content.ts";
import type { ViewActor } from "./view.ts";

interface Rig {
  node: TransformNode;
  parts: Map<string, TransformNode>;
}

interface StaffPose {
  forward: number;
  height: number;
  depth: number;
  pitch: number;
  sweep: number;
  turn: number;
  weight: number;
  brace: number;
}

type Stroke = readonly [windup: StaffPose, contact: StaffPose, followThrough: StaffPose];

const READY: StaffPose = { forward: .28, height: 1.13, depth: -.14, pitch: .43, sweep: -.14, turn: 0, weight: 0, brace: .12 };
const CHAINS: readonly Stroke[] = [
  [ // Crouch into a low forehand sweep, then open the chest.
    { forward: .08, height: 1.06, depth: .09, pitch: -.24, sweep: -2.24, turn: -.52, weight: -.48, brace: .55 },
    { forward: .39, height: 1.12, depth: -.12, pitch: .02, sweep: -.13, turn: .15, weight: .62, brace: .36 },
    { forward: .32, height: 1.15, depth: -.24, pitch: .2, sweep: .9, turn: .56, weight: .46, brace: .2 },
  ],
  [ // Reload beside the near shoulder, then cut back across the lane.
    { forward: .19, height: 1.36, depth: -.22, pitch: .86, sweep: 1.65, turn: .52, weight: -.34, brace: .31 },
    { forward: .42, height: 1.28, depth: -.05, pitch: .09, sweep: .03, turn: -.19, weight: .65, brace: .28 },
    { forward: .27, height: 1.23, depth: .12, pitch: -.19, sweep: -1.05, turn: -.58, weight: .37, brace: .44 },
  ],
  [ // Raise the coil above the shoulder before bringing it down.
    { forward: .04, height: 1.51, depth: -.04, pitch: 1.63, sweep: -.24, turn: -.27, weight: -.62, brace: .28 },
    { forward: .46, height: 1.26, depth: -.1, pitch: .14, sweep: -.04, turn: .16, weight: .88, brace: .58 },
    { forward: .34, height: 1.04, depth: -.11, pitch: -.28, sweep: .26, turn: .27, weight: .75, brace: .79 },
  ],
];

const LIFT: Stroke = [
  { forward: .13, height: 1.06, depth: -.11, pitch: -.61, sweep: -.38, turn: -.22, weight: -.35, brace: .61 },
  { forward: .43, height: 1.25, depth: -.06, pitch: .35, sweep: -.08, turn: .18, weight: .58, brace: .24 },
  { forward: .28, height: 1.5, depth: -.1, pitch: 1.23, sweep: .22, turn: .29, weight: .33, brace: 0 },
];
const MEET: StaffPose = { forward: .33, height: 1.3, depth: -.14, pitch: 1.13, sweep: -.26, turn: -.24, weight: -.28, brace: .38 };
const STOW: StaffPose = { forward: .25, height: 1.45, depth: -.12, pitch: 1.42, sweep: .38, turn: .16, weight: -.24, brace: .24 };
const NEAR_GRIP = new Vector3(.07, 0, 0);
const FAR_GRIP = new Vector3(-.23, 0, 0);

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const unit = (amount: number) => Math.max(0, Math.min(1, amount));
const ease = (amount: number) => amount * amount * (3 - 2 * amount);
const between = (value: number, start: number, end: number) => ease(unit((value - start) / (end - start)));

function blend(from: StaffPose, to: StaffPose, amount: number): StaffPose {
  return {
    forward: mix(from.forward, to.forward, amount), height: mix(from.height, to.height, amount),
    depth: mix(from.depth, to.depth, amount), pitch: mix(from.pitch, to.pitch, amount),
    sweep: mix(from.sweep, to.sweep, amount), turn: mix(from.turn, to.turn, amount),
    weight: mix(from.weight, to.weight, amount), brace: mix(from.brace, to.brace, amount),
  };
}

function strokePose([windup, contact, through]: Stroke, strike: Strike, age: number): StaffPose {
  const load = strike.startup * .65;
  const release = strike.startup + strike.active;
  if (age < load) return blend(READY, windup, between(age, 0, load));
  if (age < strike.startup) return blend(windup, contact, between(age, load, strike.startup));
  if (age < release) return blend(contact, through, between(age, strike.startup, release));
  return blend(through, READY, between(age, release, release + strike.recovery));
}

class GripArm {
  private readonly arm: TransformNode;
  private readonly elbow: TransformNode;
  private readonly side: number;
  private readonly upper: Vector3;
  private readonly lower: Vector3;
  private readonly upperLength: number;
  private readonly lowerLength: number;
  private readonly inverse = Matrix.Zero();
  private readonly aim = Vector3.Zero();
  private readonly bend = Vector3.Zero();
  private readonly upperAim = Vector3.Zero();
  private readonly lowerAim = Vector3.Zero();
  private readonly rotation = Quaternion.Identity();
  private readonly reverse = Quaternion.Identity();

  constructor(arm: TransformNode, elbow: TransformNode, hand: TransformNode, side: number) {
    this.arm = arm;
    this.elbow = elbow;
    this.side = side;
    this.upperLength = elbow.position.length();
    this.lowerLength = hand.position.length();
    this.upper = elbow.position.normalizeToNew();
    this.lower = hand.position.normalizeToNew();
  }

  aimAt(grip: Vector3, weight: number, walk: number) {
    const { arm, elbow, aim, bend, upperAim, lowerAim, rotation, reverse, inverse } = this;
    if (weight > .001) {
      const shoulderFrame = arm.parent as TransformNode;
      shoulderFrame.computeWorldMatrix(true).invertToRef(inverse);
      Vector3.TransformCoordinatesToRef(grip, inverse, aim);
      aim.subtractInPlace(arm.position);
      const distance = Math.max(Math.abs(this.upperLength - this.lowerLength) + .001,
        Math.min(aim.length(), this.upperLength + this.lowerLength - .001));
      aim.normalize();
      bend.set(-.21, -.64, this.side * .6);
      aim.scaleToRef(Vector3.Dot(aim, bend), upperAim);
      bend.subtractInPlace(upperAim).normalize();

      // The arm and forearm form a triangle with the shoulder-to-grip line.
      const along = (this.upperLength ** 2 - this.lowerLength ** 2 + distance ** 2) / (2 * distance);
      aim.scaleToRef(along, upperAim);
      bend.scaleInPlace(Math.sqrt(Math.max(0, this.upperLength ** 2 - along ** 2)));
      upperAim.addInPlace(bend);
      aim.scaleToRef(distance, lowerAim).subtractInPlace(upperAim).normalize();
      Quaternion.FromUnitVectorsToRef(this.upper, upperAim.normalize(), rotation);
      rotation.toEulerAnglesToRef(arm.rotation);
      rotation.conjugateToRef(reverse);
      lowerAim.applyRotationQuaternionInPlace(reverse);
      Quaternion.FromUnitVectorsToRef(this.lower, lowerAim, rotation);
      rotation.toEulerAnglesToRef(elbow.rotation);
    }
    arm.rotation.x = mix(walk * .38 * this.side, arm.rotation.x, weight);
    arm.rotation.y *= weight;
    arm.rotation.z = mix(-.1 * this.side, arm.rotation.z, weight);
    elbow.rotation.x *= weight;
    elbow.rotation.y *= weight;
    elbow.rotation.z = mix(.23, elbow.rotation.z, weight);
  }
}

export class MothAnimation {
  private readonly courier: Rig;
  private readonly creature: Rig;
  private readonly staff: Rig;
  private phase = "";
  private step = 0;
  private age = 0;
  private elapsed = 0;
  private initialized = false;
  private facing = 0;
  private hoverPhase = 0;
  private readonly follow = Vector3.Zero();
  private readonly target = Vector3.Zero();
  private readonly grip = Vector3.Zero();
  private readonly mount = Vector3.Zero();
  private readonly organScale?: Vector3;
  private readonly arms: { arm: GripArm; grip: Vector3 }[];

  constructor(courier: Rig, creature: Rig, staff: Rig) {
    this.courier = courier;
    this.creature = creature;
    this.staff = staff;
    this.organScale = this.creature.parts.get("pulse_core")?.scaling.clone();
    this.arms = ([["near", 1, NEAR_GRIP], ["far", -1, FAR_GRIP]] as const).flatMap(([suffix, side, grip]) => {
      const arm = courier.parts.get(`arm_${suffix}`);
      const elbow = courier.parts.get(`elbow_${suffix}`);
      const hand = elbow?.getChildTransformNodes(true).find((node) => /^hand(?:\.\d+)?$/.test(node.name));
      return arm && elbow && hand ? [{ arm: new GripArm(arm, elbow, hand, side), grip }] : [];
    });
  }

  private sampleAge(actor: ViewActor, dt: number, strike: Strike | undefined) {
    if (actor.phase !== this.phase || actor.age !== this.age || actor.step !== this.step) this.elapsed = 0;
    else this.elapsed = Math.min(PATCH_MS / 1000, this.elapsed + dt);
    this.phase = actor.phase;
    this.age = actor.age;
    this.step = actor.step;
    // Interpolate within a phase and let the authoritative tick announce contact.
    const limit = strike && actor.age < strike.startup ? strike.startup - .01 : actor.duration;
    return Math.min(limit, actor.age + this.elapsed * TICK_RATE);
  }

  pose(actor: ViewActor, time: number, dt: number, reaction: number, rescueTarget?: ViewActor) {
    const body = this.courier.node;
    const { phase } = actor;
    const form = FORMS.moth;
    const strike = phase === "skill" ? form.skill : phase === "mastery" ? form.mastery
      : phase === "air" ? form.air : phase === "attack" ? form.chain[actor.step] : undefined;
    const age = this.sampleAge(actor, dt, strike);
    const progress = unit(age / ARM_TICKS);
    const arming = phase === "arm";
    const recalling = phase === "recall";
    const wind = actor.moving ? Math.sin(time * 12) : 0;
    const stroke = phase === "skill" ? LIFT : CHAINS[phase === "mastery" ? 2 : actor.step] ?? CHAINS[0];
    const contactPose = strike ? strokePose(stroke, strike, age) : READY;
    const handoff = arming ? between(progress, 0, .27) * (1 - between(progress, .63, 1)) : recalling ? between(progress, 0, .38) : 0;
    const pose = arming || recalling ? blend(READY, arming ? MEET : STOW, handoff) : contactPose;
    const staffSize = arming ? between(progress, .48, .94) : recalling ? 1 - between(progress, .22, .63) : Number(actor.armed);
    const gripWeight = arming ? between(progress, .02, .38) : recalling ? 1 - between(progress, .48, .88) : Number(actor.armed);
    const expression = Math.max(gripWeight, arming ? handoff * .5 : 0);
    // Keep the actor origin on its interpolated world position and load the legs under it.
    body.rotation.z = phase === "down" ? -.97 : phase === "hurt" ? -.14 : phase === "dodge" ? .33 : -pose.weight * .14 * expression;
    body.position.y += Math.abs(wind) * .045 - pose.brace * .12 * expression;
    const set = (part: string, x: number, y: number, z: number) => this.courier.parts.get(part)?.rotation.set(x, y, z);
    set("torso", wind * .06, pose.turn * expression, -pose.weight * .16 * expression);
    set("head", reaction * .1, -pose.turn * .72 * expression, arming ? -.24 * handoff : .02 - pose.brace * .16 * expression);
    const inAir = actor.y > .18 ? 1 : 0;
    const stance = pose.brace * expression;
    set("leg_near", -.14 * stance, 0, wind * .52 + .36 * stance + .38 * inAir);
    set("leg_far", .16 * stance, 0, -wind * .52 - (.42 * stance + .035) - .15 * inAir);
    set("knee_near", 0, 0, -.12 - Math.max(0, wind) * .43 - .78 * stance - .46 * inAir);
    set("knee_far", 0, 0, -.1 + Math.min(0, wind) * .43 - .37 * stance);

    const weapon = this.staff.node;
    weapon.position.set(pose.forward, pose.height, pose.depth);
    weapon.rotation.set(0, pose.sweep, pose.pitch);
    weapon.scaling.setAll(Math.max(.025, staffSize));
    weapon.setEnabled(staffSize > .035 && actor.hp > 0);
    const staffFrame = weapon.computeWorldMatrix(true);
    for (const { arm, grip } of this.arms) {
      Vector3.TransformCoordinatesToRef(grip, staffFrame, this.grip);
      arm.aimAt(this.grip, gripWeight, wind);
    }
    Vector3.TransformCoordinatesToRef(NEAR_GRIP, staffFrame, this.mount);
    this.hover(actor, time, dt, reaction, progress, arming, recalling, rescueTarget);
  }

  private hover(actor: ViewActor, time: number, dt: number, reaction: number, progress: number,
    arming: boolean, recalling: boolean, rescueTarget?: ViewActor) {
    const body = this.courier.node;
    const companion = this.creature.node;
    const moving = actor.moving ? 1 : 0;
    const rhythm = this.hoverPhase += dt * (actor.moving ? 6.3 : 4.6);
    this.target.set(body.position.x - actor.facing * (1.01 + moving * .12),
      body.position.y + .43 + moving * .13 + Math.sin(rhythm) * .085 + reaction * .18, body.position.z - .57 + Math.sin(time * 3.8) * .08);
    if (rescueTarget) {
      const rescue = between(actor.rescueTicks, 0, 18);
      this.target.x = mix(this.target.x, rescueTarget.x, rescue);
      this.target.y = mix(this.target.y, rescueTarget.y + .5 + Math.sin(time * 13) * .055, rescue);
      this.target.z = mix(this.target.z, rescueTarget.z - .32, rescue);
    }
    const catchUp = this.target.x - this.follow.x;
    if (!this.initialized || Vector3.DistanceSquared(this.target, this.follow) > 9) {
      this.follow.copyFrom(this.target);
      this.facing = body.rotation.y;
      this.initialized = true;
    } else Vector3.LerpToRef(this.follow, this.target, 1 - Math.exp(-13 * dt), this.follow);
    const turn = body.rotation.y - this.facing;
    this.facing += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-12 * dt));

    const meet = arming ? between(progress, .02, .72) : recalling ? 1 - between(progress, .45, 1) : 0;
    const creatureSize = arming ? 1 - between(progress, .27, .76) : recalling ? between(progress, .37, .81) : Number(!actor.armed);
    const fold = arming ? between(progress, .08, .61) : recalling ? 1 - between(progress, .46, .9) : 0;
    Vector3.LerpToRef(this.follow, this.mount, meet, companion.position);
    companion.position.y += Math.sin(meet * Math.PI) * (arming ? .23 : .43);
    companion.position.z -= recalling ? Math.sin(meet * Math.PI) * .24 : 0;
    companion.setEnabled(creatureSize > .04 && actor.hp > 0);
    companion.scaling.setAll(Math.max(.025, creatureSize) * .92);
    companion.rotation.set(Math.sin(rhythm + .75) * .09, mix(this.facing, body.rotation.y, meet),
      Math.sin(rhythm) * .095 + Math.max(-.2, Math.min(.2, -catchUp * .38)) - fold * .37 + reaction * .15);
    for (const [suffix, direction] of [["near", 1], ["far", -1]] as const) {
      const plate = this.creature.parts.get(`plate_${suffix}`);
      const breathe = .14 + Math.sin(rhythm * 2.1 + direction * .23) * (.18 + moving * .12);
      if (plate) plate.rotation.x = -direction * (breathe * (1 - fold) + fold * 1.23 + reaction * .16);
    }
    const organ = this.creature.parts.get("pulse_core");
    if (organ && this.organScale) {
      const beat = (time * .72) % 1;
      const pulse = Math.max(0, 1 - Math.abs(beat - .16) * 14) + Math.max(0, .62 - Math.abs(beat - .34) * 12);
      const rescuePulse = rescueTarget ? .19 + .12 * Math.sin(time * 15) : 0;
      organ.scaling.copyFrom(this.organScale).scaleInPlace(1 + .15 * pulse + .19 * reaction + .24 * fold + rescuePulse);
    }
  }
}
