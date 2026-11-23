export const BELLHOUSE_CUES = ["bellhouse-low", "bellhouse-mid", "bellhouse-high"] as const;

const standaloneCues = ["plaza", "arm", "hit", "swing", "windup", "dodge", "observe", "clear", "departure", ...BELLHOUSE_CUES] as const;
type StandaloneCue = typeof standaloneCues[number];
type AudioCue = StandaloneCue | "lane" | "fight";

interface MissionScore {
  lane: string;
  fight: string;
  bpm: number;
}

interface AudioReplacements {
  cues?: Partial<Record<StandaloneCue, string>>;
  mission?: MissionScore;
}

// A file at packages/web/public/audio/example.wav is served at /audio/example.wav.
export const AUDIO_REPLACEMENTS: AudioReplacements = {};

const bundledScore: MissionScore = { lane: "/audio/lane.wav", fight: "/audio/fight.wav", bpm: 136 };

export async function loadAudioAssets<DecodedAudio extends { readonly length: number }>(
  decode: (path: string) => Promise<DecodedAudio>,
  replacements = AUDIO_REPLACEMENTS,
) {
  const buffers = new Map<AudioCue, DecodedAudio>();
  const loadCue = async (cue: StandaloneCue) => {
    const replacement = replacements.cues?.[cue];
    if (replacement) {
      try {
        buffers.set(cue, await decode(replacement));
        return;
      } catch (error) {
        console.warn(`Audio replacement for ${cue} failed. Using the bundled recording.`, error);
      }
    }
    buffers.set(cue, await decode(`/audio/${cue}.wav`));
  };
  const loadScore = async (score: MissionScore) => {
    if (!Number.isFinite(score.bpm) || score.bpm <= 0) throw new Error("Mission score BPM must be positive.");
    const [lane, fight] = await Promise.all([decode(score.lane), decode(score.fight)]);
    if (lane.length !== fight.length) throw new Error("Mission score stems must have the same decoded sample count.");
    buffers.set("lane", lane);
    buffers.set("fight", fight);
    return 60 / score.bpm;
  };
  const loadMissionScore = async () => {
    if (replacements.mission) {
      try {
        return await loadScore(replacements.mission);
      } catch (error) {
        console.warn("Mission score replacement failed. Using both bundled stems.", error);
      }
    }
    return loadScore(bundledScore);
  };
  const [missionBeat] = await Promise.all([loadMissionScore(), ...standaloneCues.map(loadCue)]);
  return { buffers, missionBeat };
}
