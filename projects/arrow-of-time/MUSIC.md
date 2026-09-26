# The Arrow of Time: score brief

The score is synthesized entirely in code (`score.py`, using the shared `audio/studio`
library) and is timed from `timeline.json`, the same file that times the visuals. Change
a cue there and both picture and music follow.

## Concept: "Clockwork Cosmos"

A ticking clock is the heartbeat of the film. The tempo of the clock *is* the pace of
events. It ticks calmly before the Big Bang and falls silent in the blast. It returns as the
universe organizes, then **accelerates** through human history up to NOW, where it cuts dead.
It resumes for the future and **slows down** as the stars die, until the last tick at the
heat death. After a long silence, one final soft tick ends the film.

The palette is Interstellar-style pipe organ and sustained strings, Vangelis-style synth brass
for the epic reveals, glassy bells for stars, and huge booms for cosmic violence. It is
cinematic, emotional and uncluttered.

- **Key**: A minor (A4 = 440 Hz). Core progression **Am – Fmaj7 – C – G** (i–VI–III–VII),
  voiced with an **E pedal** on top wherever possible (a common tone that shimmers through
  every chord, like time flowing).
- **Tempo**: 60 BPM base (1 bar of 4/4 = 4 s), so beat boundaries in the timeline fall on bars.
- **Theme** (piano / lead, 8 bars over the core progression, quarter note = 1 s):
  `| E5 (2) D5 C5 | C5 (3) A4 | G4 (2) C5 E5 | D5 (4) | E5 (2) D5 C5 | A5 (3) G5 | E5 (2) D5 C5 | B4 (4) → A4 |`
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
| 21–30 | bigbang | title music: organ and strings, Am → F → C → G, 2 s per chord, majestic |
| 30–50 | universe | organ progression, 1 chord per bar (4 s). Glittering bell arpeggios over 36–42 (first elements). Warm swell into C major at 42–44 (First Light). |
| 50–56 | darkages | nearly silent: low A drone, faint wind, ticks every 2 s and very soft |
| 56–64 | firststars | **one bell ping per `starIgnitions` time** (random pitches from A minor pentatonic, high register, long reverb). Organ re-enters. |
| 64–70 | galaxies | crescendo: organ and strings rising |
| **70.0** | `milkyWayReveal` | **MILKY WAY**: synth brass and organ full chord (F major → C), the most majestic moment so far, sustain to 80 |
| 80–86 | nebula | soft boom at `supernova` (81). Low piano ostinato starts: 8th notes A2–E3 (2 per second) |
| 86–100 | sun, earth | bright C major swell at `sunIgnite` (87). Ostinato and pads continue through the progression. |
| 100–108 | moon | tension, then an impact hit at `theia` (102.0): boom plus debris noise. Afterwards, a wide shimmering pad. |
| 108–116 | oceans | calm; rain texture (filtered noise) from `rainStart`; warm pads |
| 116–130 | life, oxygen | **life motif**: bright plucked 16th-note arpeggios (4 per second) over C – G/B – Am – F; organic, hopeful; brighter at 124 |
| 130–134 | snowball | sudden cold: lowpass closes, glassy high tones, sparse |
| 134–148 | cambrian, land | arpeggio returns fuller with bells and marimba; add a warm cello-like line at 142 |
| 148–156 | dinosaurs | primal **taiko groove** plus low brass |
| 156.5–158 | `asteroidStreak` | ominous rising whoosh |
| **158.0** | `asteroidImpact` | **IMPACT**: huge boom; all music cuts; long rumble tail to 162 |
| 162–168 | mammals | soft dawn chord (C add9), gentle |
| 168–176 | humans | **solo piano: bars 1–2 of the theme**, intimate; soft fire crackle from `fire` |
| 176–182 | caves | breathy pad and soft taps |
| 182–196 | civilization | ticks return and **accelerate 60 → ~140 BPM**; a strong accent (hit + chord change) exactly on every `montage[].t`; drums, strings ostinato, organ building |
| 196–202 | moonlanding | triumphant synth-brass chord at `moonStep` (197), ticks continue fast |
| 202–208 | nightearth | peak intensity, everything playing |
| **208.0** | `now` | **HARD CUT TO SILENCE** at exactly 208.000 |
| 209–216 | now | single soft piano notes with long reverb: A4 at `blueDot` (209), E5 at 212 |
| 216.5 | `resumeTick` | one tick; tick-tock resumes slowly from 218 at 60 BPM |
| 220–234 | mars, drift | hopeful and ethereal: organ and strings in A major / Lydian colour (D sharp), slow arpeggios |
| 234–240 | hotearth | tension: warm low drone, creeping dissonance (added b6) |
| 240–248 | redgiant | **huge, heavy, dark**: low brass and organ pedal, swell from `redGiantSwell` |
| 248–254 | whitedwarf | delicate crystalline bells and a soft pad |
| 254–262 | merger | the last grand swell: sweeping strings and choir |
| 262–270 | laststars | thinning; **one fading, descending bell per `starDeaths` time**; ticks slowing (60 → 30 BPM) |
| 270–278 | blackholes | deep sub drone, eerie low detuned choir |
| 278–286 | evaporation | faint rising shimmer; **bright bell/choir flash plus soft boom at `lastFlash`**, then decay |
| 286–296 | heatdeath | near silence; ticks at ever-longer intervals; **last tick at `lastTick`** |
| 296–309 | epilogue | soft organ Am returns (pp), strings enter; theme bars 1–4 on piano |
| **309.4** | `picardy` | **A major** blooms (strings, organ, choir): "That moment is now." |
| 313.4–317 | `finalTitle` | final chord sustains and fades |
| 317.2 | `finalTick` | one final, soft tick |
