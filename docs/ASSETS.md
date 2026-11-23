# Replace the game models

The client reads every actor model from `packages/web/public/models/`. Keep your Blender source and paint files alongside your working art. Put the exported `.glb` in the public models folder with a new name, then assign it to a slot in [`model-replacements.ts`](../packages/web/src/model-replacements.ts). The registry starts empty and the bundled GLBs remain available as fallbacks.

| Slot | What it replaces |
| --- | --- |
| `courier` | All couriers during gameplay |
| `moth`, `brick`, `heron`, `boar` | The companion's living model in each form |
| `moth-weapon`, `brick-weapon`, `heron-weapon`, `boar-weapon` | The held form for each weapon family |
| `skitter`, `guard`, `keeper` | The Signal Crawler, Gateback, or Switchkeeper. `guard` also supplies the practice target. |

All slots accept `file`, `yawDegrees`, `scale`, and `offset`. The latter is an `[x, y, z]` shift in world units under the actor or weapon mount. The default adjustment is a 180° yaw and scale 1. Try the model facing both directions and use the ground shadow to check foot placement. Keeping the geometry origin at ground level for a standing actor, or where a weapon should be gripped, makes this easier. The renderer falls back to the bundled version if loading or a configured courier clip or socket fails. Look in the browser console for the file and reason.

This workflow targets the models in the 3D world. The companion portraits used in the interface have their own PNG files and are outside this registry.

## Keep the existing pose rig

For a replacement that continues to use the game's existing poses, import the bundled GLB for that slot into Blender first. Preserve the named transforms and their local axes. Pose lookup is by exported node name, and the transforms must export as part of the hierarchy. A static replacement can use a single mesh, with visible motion limited to the parent actor movement.

- The procedural courier uses `torso`, `head`, `arm_near`, `arm_far`, `elbow_near`, `elbow_far`, `leg_near`, `leg_far`, `knee_near`, and `knee_far`. The staff grip also uses a `hand` directly under each elbow.
- Living forms use `plate_near`, `plate_far`, and `pulse_core` for idle, arm, and rescue motion. The client handles following and forming the weapon.
- Enemies use `organism`, `leg_near`, `leg_far`, `plate_near`, `plate_far`, `claw_near`, and `claw_far` where present. Check wind-up and recovery in combat with the sound muted.

## Author a skinned courier in Blender

Export one GLB with the mesh, armature, baked actions and base-color textures. Use the armature's exported Blender Action names as values in `clips`. Author in place and key the bones used by all clips so they can switch cleanly. The server still moves the courier, confirms contact, and decides recovery. The renderer samples timed actions against those same combat ticks. [Blender-to-glTF in Babylon](https://doc.babylonjs.com/preparingArtForBabylon/dccToGltf)

Use `animation` on the `courier` entry to turn on Blender clip playback. `idle` is required. Other keys can be added as the clips become ready. An omitted armed idle or armed run uses the ordinary variant, when configured. Other omitted states use the idle clip. Use `families` to override a specific key for one weapon family. An optional `weaponSocket` attaches the equipped weapon to an exported node or bone. Make the socket name unique and include it in the export even if it has zero skin weights. Omit it to use the existing held-weapon motion.

```ts
  courier: {
    file: "courier-v2.glb",
    yawDegrees: 180,
    scale: 1,
    offset: [0, 0, 0],
    animation: {
      clips: {
        idle: "Idle",
        run: "Run",
        armedIdle: "Staff_Ready",
        arm: "Staff_Draw",
        recall: "Staff_Recall",
        attack1: "Staff_01",
      },
      families: {
        brick: { armedIdle: "Gauntlets_Ready", attack1: "Gauntlets_01" },
      },
      weaponSocket: "weapon_socket",
    },
  },
```

The example assumes every named action and the socket exist in the export. For a first pass, start with `idle` and `attack1`. The remaining keys are `armedRun`, `attack2`, `attack3`, `skill`, `mastery`, `air`, `jump`, `dodge`, `hurt`, `down`, and `rescue`.

For the first Kite Moth strike, contact starts after 10 of its 26 simulation ticks. At 30 fps, if the Blender action spans frame 1 through 14, that puts contact near frame 6 and recovery near frame 8. Use the shared tables to check other moves before adding trails or impact flashes. [Combat timing tables](../packages/shared/src/content.ts)

## Check the replacement in the game

1. Validate the export and scrub each Action in a glTF viewer. [Khronos validator](https://github.khronos.org/glTF-Validator/) · [Babylon Sandbox](https://sandbox.babylonjs.com/)
2. Open the isolated preview and start the Practice Floor. Arm and recall with Q and start each chain step with J. Check idle, wind-up, contact, and recovery at normal play speed. [Isolated preview setup](../README.md#preview-changes-with-a-separate-save)
3. Review both facings at 4:3 and widescreen. Check foot placement, staff attachment, silhouette at camera distance, and a deliberate depth whiff. Play one encounter with effects and sound and one with sound muted.

For the score and combat cues, see [Replacing music and sounds](AUDIO.md).
