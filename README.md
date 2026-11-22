# Relay District

Relay District is a browser-based co-op action RPG about one living biotech companion, a sealed transit line, and the city that tried to forget it. Play **The Last Crossing** solo or with up to four people on a local network. The repair plaza is shared by up to sixteen local players.

## Run the game

Use Node.js 24 LTS, version 24.15 or newer.

```sh
npm ci
npm run dev
```

Open [the local client](http://127.0.0.1:5173/). Open Dispatch, create a chapter room, and share its six-character code. A second tab in the same browser can open [a separate guest profile](http://127.0.0.1:5173/?guest=friend). Guests keep separate saves by browser origin and guest name.

Run `npm run dev:lan` to allow players on the same trusted network to open your machine’s port **5173**. The room and guest API use port **2567**. The browser infers the room-server address from the page host. For a local release build, run `npm run build` followed by `npm start`, then open [the bundled game](http://127.0.0.1:2567/). To test latency, set `RELAY_LATENCY_MS=100` before starting the server. Set `RELAY_DB` to use a different SQLite save file. The default save lives under the ignored `.relay/` folder.

## Play

| Controls | Action |
| --- | --- |
| WASD or arrows | Move across the lane |
| Q | Arm or recall the companion |
| J / K / L | Basic chain, signature skill, mastery follow-up |
| Space / Shift | Jump and directional dodge |
| E / Esc | Use the nearby station or clue, rescue a downed teammate, close a panel |

Start with Kite Moth and its coil staff. Clear the first chapter, listen at the final relay, then return to the plaza. Use **E** near the Morph Workbench to preview Brickback or spend the first catalyst to change form. Platform Sweep and Transformer Trial reveal Glass Heron and Cinder Boar.

After The Last Crossing, Dispatch opens **The Night Platform**, the next story mission. Follow the arriving train, clear the platform, then recall your companion with **Q** and inspect the return register. Everyone in the room receives the memory in their companion journal.

Clear The Night Platform to enter **Return Junction**. Use the return signal with your companion recalled to set the turnout, then defend it. Read the signal again to record the turnout log in each player's journal.

The companion keeps its name, personality, bond, trinket, room theme, memories, former forms, and mastery records through a morph. Battle XP starts at zero for the new form. Its basic chain and signature skill are available immediately. Complete a mastery drill and reach rank three to use the follow-up. Earn another catalyst by clearing two distinct missions and carry one at a time.

In the companion room, rename your partner, decorate its room, choose a keepsake, and play together. Inspect the closure plaque, maintenance log, and broken announcement to record the history of the Last Crossing. Open Sound to hear the original score and gameplay cues.

In co-op, recall your companion with **Q** if it is armed, stand beside a downed teammate, and press **E**. Stay still for 1.2 seconds while your companion revives them with 40 HP. Taking a hit, moving, or using another action interrupts the rescue. Each courier can receive one rescue per run.

## Development

- `npm test` runs the combat simulation, SQLite progression, and Colyseus room tests. The network tests connect real SDK clients and exercise the chapter and room lifecycle.
- `npm run build` type-checks the workspaces and builds the browser release into `dist/`.
- `npm run assets` regenerates the original score and effects. The plaza cue is 24 bars at 112 BPM. The route and combat cues are aligned 24-bar stereo stems at 136 BPM.
- `blender -b --factory-startup -t 2 --python scripts/models.py` regenerates the original GLB companions, weapons, player, and opponents. Add `-- --cast` for the courier and three enemies only. The built GLBs and WAVs are included for normal play.

The shared TypeScript module owns combat timing and hit tests. Babylon.js renders and predicts local motion. The room server owns hits, enemy turns, party state, and rewards. Guest profile tokens are opaque, and SQLite grants each reward once per eligible run. Treat the LAN mode as a development build for trusted peers.

## Creative references

The story, characters, creatures, stage art, music, sound effects, and interface are original. GhostX Ultimate informed the elevated combat camera, companion-to-weapon transformation, and era of PC graphics. Neopets informed the companion journal, keepsakes, and sense of caring for one persistent creature. [Period GhostX Ultimate gameplay and screenshots](https://buladifu.blogspot.com/2013/12/ghostx-ultimate-part-one.html) · [GhostX Ultimate companion feature](https://www.youtube.com/watch?v=JKJU5_y5-ZY) · [Neopets pet care](https://www.neopets.com/help/pethelp.phtml)
