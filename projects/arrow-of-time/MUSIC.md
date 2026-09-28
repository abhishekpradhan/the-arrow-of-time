# The Arrow of Time: score brief

The score is synthesized entirely in code (`score.py`, using the shared `audio/studio`
library) and is timed from `timeline.json`, the same file that times the visuals. Change
a cue there and both picture and music follow.

## Concept: "Clockwork Cosmos"

A ticking clock is the heartbeat of the film. The tempo of the clock *is* the pace of
events. It ticks calmly before the Big Bang and falls silent in the blast. It returns as the
universe organizes, then **accelerates** through human history up to NOW, where it cuts dead
(it falls silent above the clouds as the rocket leaves the Earth, and comes back from far away as
the Moon dissolves into night Earth).
It resumes for the future and **slows down** as the stars die, until the last tick at the
heat death. After a long silence, one final soft tick ends the film.

The palette is Interstellar-style pipe organ and sustained strings, Vangelis-style synth brass
for the epic reveals, glassy bells for stars, and huge booms for cosmic violence. It is
cinematic, emotional and uncluttered.

- **Key**: A minor (A4 = 440 Hz). Core progression **Am – Fmaj7 – C – G** (i–VI–III–VII),
  voiced with an **E pedal** on top wherever possible (a common tone that shimmers through
  every chord, like time flowing).
- **Tempo**: 60 BPM base (1 bar of 4/4 = 4 s), so beat boundaries in the timeline fall on bars.
- **Theme** (8 bars over the core progression, quarter note = 1 s unless fitted to a scene):
  `| E5 (2) D5 C5 | C5 (3) A4 | G4 (2) C5 E5 | D5 (4) | E5 (2) D5 C5 | A5 (3) G5 | E5 (2) D5 C5 | B4 (4) → A4 |`
  It is the thread through the film, in a different voice each time: horns and violins for the
  main title, violins over the Milky Way, a distant piano over the young oceans, violins at the
  mammals' dawn, solo piano for the first humans, the full orchestra from the rocket launch
  through Sputnik's sunrise, a far, slow piano as the camera looks up from the Moon to the Earth, a
  Lydian (major) variation over Mars, violins at the galaxy merger, and piano into the final
  Picardy chord.
- **Ending**: a Picardy third. The final chord is **A major** (C sharp), which lands on "That moment is now."

## Instruments (all synthesized)

| Instrument | Sound | Used for |
|---|---|---|
| Clock | tick/tock pair: short resonant clicks (bandpassed noise + damped sine ~1.2 kHz / ~0.95 kHz), small room | the pulse |
| Organ | additive ranks 16'/8'/4'/2' + mixture, slow attack, gentle tremulant | harmonic bed, majesty |
| Strings | detuned saw ensemble, lowpassed, slow swells, vibrato | swells, high shimmer |
| Piano | additive, inharmonic partials, hammer transient | theme, NOW notes |
| Synth brass | CS-80-like saw/pulse, filter envelope, vibrato | Milky Way, Earth, Moon landing |
| Bells | FM bells / celesta | stars igniting, stars dying |
| Choir | formant-filtered ensemble "aah" | Big Bang, cosmic awe, black holes |
| Pluck arp | Karplus-Strong / filtered saw | life, humanity drive |
| Drums | taiko/timpani, low toms | dinosaurs, civilization |
| FX | sub booms, noise risers, reverse swells, rumble, rain, wind, fire crackle | hits and atmosphere |

Mix: long convolution reverb (4–8 s hall/cathedral) on organ/strings/choir/bells, a short
room on clock and drums. Master bus: gentle glue compression, true-peak limiter, **−14 LUFS
integrated, −1 dBTP**. 48 kHz stereo.

## Cue sheet (times come from `timeline.json`; values below are current)

| Time | Beat | Music |
|---|---|---|
| 0–1 | prologue | silence |
| 1–13 | prologue | tick-tock at 1 Hz. Low organ A drone fades in (2–8 s). High string E6 shimmer from 8 s. Sparse piano: A3 (4 s), E4 (8 s), C4 (11 s). |
| 13–20 | prologue | **riser** (noise sweep + Shepard-tone rise), ticks accelerate 1 → 5 Hz, then a 0.35 s silent gap right before the bang |
| **20.0** | `bang` | **BIG BANG**: massive sub boom, noise burst, choir and organ tutti on Am (A1 to A4 spread), 10 s decay |
| 21–29 | bigbang | **main title**: organ and strings Am → F → C → G (2 s per chord) under **theme bars 1–4** in horns and violins |
| 30–50 | universe | organ progression, 1 chord per bar, over a flute-stop **organ arpeggio** in 8ths. Glittering bells over the first elements. Warm swell into C major at 42–44 (First Light). |
| 50–56 | darkages | nearly silent: low A drone, faint wind, ticks every 2 s and very soft |
| 56–64 | firststars | **one bell ping per `starIgnitions` time** (A minor pentatonic, high, long reverb). Organ re-enters. |
| 64–70 | galaxies | crescendo: organ and strings rising, a timpani roll |
| **70.0** | `milkyWayReveal` | **MILKY WAY**: synth brass, organ, strings and choir, F major → C, with **theme bars 5–6** in the violins |
| 80–86 | nebula | soft boom at `supernova` (81). Low piano ostinato in 8ths. |
| 86–100 | sun, earth | bright C major swell at `sunIgnite` (87); the ostinato continues; a battered, molten Earth |
| 100–102 | moon | tension: D minor strings and brass swell over a timpani roll and a riser, then a breath |
| **102.0** | `theia` | **IMPACT**: boom, sub drop, debris |
| 102.4–106.9 | moon | the graze and the tidal bridge: low D minor strings; a plucked figure circles the stereo field like debris in orbit |
| **106.9** | `theiaReturn` | Theia's remnant falls back: a second, smaller hit, timpani and a brass chord on B flat |
| 107–110.2 | moon | the arm winds into a disk: B flat to C sus, the figure faster and higher, a shimmer |
| 110.2 | `moonBorn` | years later, the Moon: C add9 with **theme bars 3–4** in the bells; their held D resolves to the E that opens the oceans' theme |
| 112–120 | oceans | calm; **theme bars 1–2** on a distant piano; rain from `rainStart` |
| 120–134 | life, oxygen | **life motif**: plucked 16th-note arpeggios over C – G/B – Am – F; brighter with the oxygen |
| 134–138 | snowball | sudden cold: the low-pass closes, glassy high tones |
| 138–152 | cambrian, land | the arpeggio returns fuller with bells and marimba; a cello line at `land` |
| 152–160 | dinosaurs | primal **taiko groove** plus low brass |
| 160.5–162 | `asteroidStreak` | ominous rising whoosh |
| **162.0** | `asteroidImpact` | **IMPACT**: a breath of silence, then a huge boom; long rumble tail |
| 166–172 | mammals | soft dawn chord (C add9) with **theme bars 3–4** in the violins |
| 172–180 | humans | **solo piano: theme bars 1–2**; soft fire crackle from `fire` |
| 180–186 | caves | breathy pad and soft taps |
| 186–211.6 | civilization | the clock accelerates from 60 BPM (`accelStart`) to 140 at the launch, with an accent (taiko, boom, stab) on every card: **pastoral** plucked arpeggios and hand drums (farming, cities, writing), **monumental** organ, taiko and choir (pyramids, philosophy, printing), a **mechanical** string ostinato with anvil clangs (industry, flight), brass stabs and a riser (the atom, space). Each age is wiped in by something passing the lens, with a whoosh from right to left into its accent, and each scene's own sounds land on its picture (they follow the shaders' animation formulas): the reed tapping the clay as the scribe presses each wedge, the press's platen coming down, a steam whistle and chuffing with the train, a deep thud on the Trinity flash |
| **211.6** | `launch` | no cut: a reverse swell and a timpani roll lead straight into **ignition**: sub boom, timpani and the engines' roar; **theme bars 1–2** (horns, violins, the organ in full) with the quarter at half the clock's 140 BPM, so that bar 3 lands on the staging |
| **214.3** | `clouds` | the clock falls silent above the clouds (until night Earth). The roar is close over the cloud deck, drops to a distant rumble under the long lens as bells glint on the rocket crossing the Moon, and comes back close in the chase |
| **218.4** | `staging` | bar 3 lands on the Korolev cross: timpani, a brass stab and a boom; in slow motion the roar falls away and high violins play the bar over a hushed choir; a whoosh as the core stage flies past the camera |
| **221.6** | `sputnik` | orbit: near silence, the fairing's muffled thump; Sputnik's beeps (a 0.3 s tone every 0.6 s, thin as a shortwave signal) until the Moon; a glass harmonica holds bar 4's D; strings, a riser and a timpani roll build to the dawn |
| **224.2** | `orbitalDawn` | the Sun breaks over the limb behind Sputnik in **C major** (choir, organ, strings, brass, timpani, a shimmer): **theme bar 5** as the glare dissolves to Sputnik blazing in full sunlight, **bar 6**'s high A on F major (227.6) as the camera turns to the Moon, then fading |
| 229.6–234.2 | moonlanding | the descent: a low pulse on the quarter (timpani and string stabs), a tense string cluster, Houston's Quindar tones (2525 Hz in, 2475 Hz out), the engine's rumble and the hiss of the dust, a riser and growling brass, all rising into |
| **234.2** | `eagleLands` | the engine stops and the tension opens (no cut) into **F major 7**: strings, a breath of choir, low horns and a soft swell, sinking to a hush; a soft, low thud as the lander drops onto its pads |
| 234.7 | `tranquilityBase` | **Armstrong's own voice** (NASA's recording of the air-to-ground loop): the Quindar tone that closed Houston's "We copy you down, Eagle", then "Houston, Tranquility Base here. The Eagle has landed."; the loop's squelch closes after it |
| **239.75** | `reflection` | a moment of reflection as the camera looks up from the lander to the Earth: **theme bars 1–2** on a far piano, slowed to fill the time to night Earth, over the Fmaj7 held since touchdown and then G6; a choir and a glass harmonica's high E enter with bar 2 as the Earth appears; its last note, A, becomes night Earth's A minor |
| 244.8–252 | nightearth | the clock comes back from far away through the dissolve from the Moon, its drums from the A minor on; the orchestra builds out of the reflection to peak intensity: brass on every chord change after the first, louder each time, riser into the cut |
| **252.0** | `now` | **HARD CUT TO SILENCE** |
| 253–260 | now | single soft piano notes with long reverb: A4 at `blueDot` (253), E5 at 256 |
| 260.5 | `resumeTick` | one tick; tick-tock resumes slowly |
| 264–278 | mars, drift | hopeful A major with a Lydian D sharp, slow arpeggios, and the **theme turned major** |
| 278–284 | hotearth | tension: warm low drone, creeping dissonance (added b6) |
| 284–292 | redgiant | **huge, heavy, dark**: low brass and organ pedal, swell from `redGiantSwell` |
| 292–298 | whitedwarf | delicate crystalline bells and a soft pad |
| 298–306 | merger | the last grand swell: strings and choir, **theme bars 5–6** in the violins |
| 306–314 | laststars | thinning; **one fading, descending bell per `starDeaths` time**; ticks slowing (60 → 30 BPM) |
| 314–322 | blackholes | deep sub drone, eerie low detuned choir |
| 322–330 | evaporation | faint rising shimmer; **bright bell and choir flash plus soft boom at `lastFlash`** |
| 330–340 | heatdeath | near silence; ticks at ever-longer intervals; **last tick at `lastTick`** |
| 340–353 | epilogue | soft organ Am returns, strings enter; **theme bars 1–3** on piano |
| **353.4** | `picardy` | **A major** blooms (strings, organ, choir): "That moment is now." |
| 357.4–361 | `finalTitle` | the final chord sustains and fades |
| 361.2 | `finalTick` | one final, soft tick |
