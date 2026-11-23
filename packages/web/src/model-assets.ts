import { LoadAssetContainerAsync, TransformNode, type AnimationGroup, type AssetContainer, type Scene } from "@babylonjs/core";
import { GLTFLoaderAnimationStartMode } from "@babylonjs/loaders/glTF/index.js";
import { RESCUE_TICKS } from "../../shared/src/combat.ts";
import { FORMS, PATCH_MS, TICK_RATE } from "../../shared/src/content.ts";
import { MODEL_REPLACEMENTS, type CourierClip, type CourierClips, type ModelReplacement, type ModelSlot } from "./model-replacements.ts";
import type { ViewActor } from "./view.ts";

export interface ModelAsset {
  container: AssetContainer;
  transform?: ModelReplacement;
  animation?: CourierClips;
}

export interface ActorModel {
  node: TransformNode;
  parts: Map<string, TransformNode>;
  animation?: CourierAnimation;
  weaponSocket?: TransformNode;
  dispose(): void;
}

export async function loadModelAsset(scene: Scene, slot: ModelSlot): Promise<ModelAsset> {
  const transform = MODEL_REPLACEMENTS[slot];
  const animation = slot === "courier" ? MODEL_REPLACEMENTS.courier?.animation : undefined;
  const load = (file: string) => LoadAssetContainerAsync("/models/" + file, scene, {
    pluginOptions: { gltf: { animationStartMode: GLTFLoaderAnimationStartMode.NONE } },
  });
  if (transform) {
    let container: AssetContainer | undefined;
    try {
      container = await load(transform.file);
      if (!container.meshes.some((mesh) => mesh.getTotalVertices() > 0)) throw new Error("The file contains no visible geometry.");
      if (animation) {
        const names = [...Object.values(animation.clips), ...Object.values(animation.families ?? {}).flatMap(Object.values)];
        for (const name of new Set(names)) {
          if (!container.animationGroups.some((group) => group.name === name && group.targetedAnimations.length)) {
            throw new Error(`Animation group '${name}' was not exported.`);
          }
        }
        if (animation.weaponSocket && ![...container.transformNodes, ...container.meshes].some((node) => node.name === animation.weaponSocket)) {
          throw new Error(`Weapon socket '${animation.weaponSocket}' was not exported.`);
        }
      }
      return { container, transform, animation };
    } catch (error) {
      container?.dispose();
      console.warn(`Could not load ${slot} replacement '${transform.file}'. Using the bundled model.`, error);
    }
  }
  return { container: await load(slot + ".glb") };
}

export function instantiateActorModel(scene: Scene, slot: ModelSlot, asset: ModelAsset): ActorModel {
  const node = new TransformNode(slot + " instance", scene);
  const mount = new TransformNode("Model mount", scene);
  mount.parent = node;
  mount.rotation.y = (asset.transform?.yawDegrees ?? 180) * Math.PI / 180;
  mount.scaling.setAll(asset.transform?.scale ?? 1);
  if (asset.transform?.offset) mount.position.set(...asset.transform.offset);
  const entries = asset.container.instantiateModelsToScene((name) => name, false, { doNotInstantiate: true });
  for (const root of entries.rootNodes) root.parent = mount;
  const exported = new Map(node.getChildTransformNodes(false).map((part) => [part.name, part]));
  const parts = asset.animation ? new Map<string, TransformNode>() : exported;

  for (const [name, part] of parts) {
    const authoredJoint = /^(torso|head|organism|(arm|elbow|leg|knee|plate)_(near|far))$/.test(name)
      || slot === "runner" && /^claw_(near|far)$/.test(name);
    if (authoredJoint && part.rotationQuaternion) {
      part.rotation.copyFrom(part.rotationQuaternion.toEulerAngles());
      part.rotationQuaternion = null;
    }
  }
  const socket = asset.animation?.weaponSocket;
  return {
    node, parts, weaponSocket: socket ? exported.get(socket) : undefined,
    animation: asset.animation ? new CourierAnimation(entries.animationGroups, asset.animation) : undefined,
    dispose() {
      entries.dispose();
      node.dispose();
    },
  };
}

function requestedClip(actor: ViewActor): CourierClip {
  switch (actor.phase) {
    case "attack": return (["attack1", "attack2", "attack3"] as const)[actor.step] ?? "attack1";
    case "arm": case "recall": case "air": case "skill": case "mastery":
    case "dodge": case "hurt": case "down": case "jump": return actor.phase;
    default:
      if (actor.rescueTarget) return "rescue";
      if (actor.moving) return actor.armed ? "armedRun" : "run";
      return actor.armed ? "armedIdle" : "idle";
  }
}

const loops = new Set<CourierClip>(["idle", "armedIdle", "run", "armedRun"]);
const substitute: Partial<Record<CourierClip, CourierClip>> = { armedRun: "run", armedIdle: "idle" };

class CourierAnimation {
  private readonly groups: Map<string, AnimationGroup>;
  private readonly config: CourierClips;
  private group?: AnimationGroup;
  private elapsed = 0;
  private interpolation = 0;
  private lastAge = -1;
  private lastKey?: CourierClip;

  constructor(groups: AnimationGroup[], config: CourierClips) {
    this.groups = new Map(groups.map((group) => [group.name, group]));
    this.config = config;
  }

  pose(actor: ViewActor, dt: number) {
    const requested = requestedClip(actor);
    const overrides = this.config.families?.[actor.family];
    const nameFor = (key: CourierClip) => overrides?.[key] ?? this.config.clips[key];
    const fallback = substitute[requested];
    const key = nameFor(requested) ? requested : fallback && nameFor(fallback) ? fallback : "idle";
    const group = this.groups.get(nameFor(key)!)!;
    const changed = this.group !== group || this.lastKey !== key;
    if (this.group !== group) {
      this.group?.stop(true);
      group.start();
      group.pause();
      this.group = group;
    }
    this.elapsed = changed ? 0 : this.elapsed + dt;
    const duration = key === "rescue" ? RESCUE_TICKS : actor.duration;
    let frame: number;
    if (loops.has(key) || duration === 0) {
      const frames = this.elapsed * (group.targetedAnimations[0]?.animation.framePerSecond ?? 60);
      const length = group.to - group.from;
      frame = group.from + (loops.has(key) && length > 0 ? frames % length : Math.min(frames, length));
    } else {
      const age = key === "rescue" ? actor.rescueTicks : actor.age;
      this.interpolation = changed || age !== this.lastAge ? 0 : Math.min(PATCH_MS / 1000, this.interpolation + dt);
      const form = FORMS[actor.family];
      const strike = actor.phase === "attack" ? form.chain[actor.step] : actor.phase === "skill" ? form.skill
        : actor.phase === "air" ? form.air : actor.phase === "mastery" ? form.mastery : undefined;
      // Interpolate between room patches without presenting contact ahead of the room tick.
      const limit = strike && age < strike.startup ? strike.startup - .01 : duration;
      const tick = Math.min(limit, age + this.interpolation * TICK_RATE);
      frame = group.from + (group.to - group.from) * (tick / duration);
      this.lastAge = age;
    }
    group.goToFrame(frame);
    this.lastKey = key;
  }
}
