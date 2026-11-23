# Replacing music and sounds

Store original recordings under `packages/web/public/audio/`. Keep the supplied recordings in place so the game can fall back to them during development. Use [audio-assets.ts](../packages/web/src/audio-assets.ts) to select a recording for a slot. A source file at `packages/web/public/audio/custom/chime.wav` uses the URL `/audio/custom/chime.wav`.

```ts
export const AUDIO_REPLACEMENTS: AudioReplacements = {
  cues: {
    plaza: "/audio/custom/repair-plaza.wav",
    arm: "/audio/custom/arm-coil.wav",
    windup: "/audio/custom/threat.wav",
  },
  mission: {
    lane: "/audio/custom/night-line.wav",
    fight: "/audio/custom/night-line-battle.wav",
    bpm: 128,
  },
};
```

| Slot | What plays it |
| --- | --- |
| `plaza` | Loop in the plaza |
| `arm` | Temporary arming or recall |
| `swing` | Strike begins |
| `hit` | Confirmed contact |
| `windup` | Enemy attack warning |
| `dodge` | Directional dodge |
| `observe` | Companion observation, care, or completed rescue |
| `clear` | Mission clear |
| `lane` and `fight` | Synchronized approach and battle stems |

The bundled files are WAV. Export both mission stems from the same project and sample rate. Start both at the same downbeat and render them to the same sample count, including silence where one layer rests. Export a complete loop with no trailing count-in or extra reverb tail. Set `bpm` to the arrangement's tempo so combat layers fade in on beat. If either stem fails to load or the decoded lengths differ, the game logs a browser warning and uses both bundled stems at their original tempo. Unavailable one-shots and plaza music fall back individually.

Use the [isolated preview](../README.md#preview-changes-with-a-separate-save). Turn Sound on in the plaza, enter a mission, and cross between an unoccupied lane and combat. Listen for seam clicks or changes in the beat. Test wind-up cues with the music active. The mix lowers the music around warnings and mission clears. Enemy poses and ground effects should still give the player time to react with Sound off.
