"""Score for __TITLE__.

Every time comes from timeline.json, so retiming the picture retimes the music.
Render with:  npm run audio -- __ID__
The instruments, effects and mastering are in audio/studio (see audio/README.md).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'audio'))

from studio import Mix, Timeline, fx, instruments as ins, master, wav  # noqa: E402

# A slow i-VI-III-VII progression (A minor) with an E held on top of every chord.
CHORDS = [
    ['A2', 'E3', 'A3', 'C4', 'E4'],
    ['F2', 'C3', 'A3', 'C4', 'E4'],
    ['C3', 'G3', 'C4', 'E4', 'G4'],
    ['G2', 'D3', 'B3', 'D4', 'E4'],
]
MOTIF = ['E5', 'D5', 'C5', 'B4', 'A4']


def compose(tl: Timeline) -> Mix:
    mix = Mix(tl.duration)
    mix.reverb('hall', fx.reverb_ir('hall'))
    organ = mix.track('organ', gain_db=-14, sends={'hall': -8})
    strings = mix.track('strings', gain_db=-16, sends={'hall': -5})
    piano = mix.track('piano', gain_db=-10, sends={'hall': -9})
    hits = mix.track('hits', gain_db=-6, sends={'hall': -14})

    hit = tl.cue('hit')
    bar = 4.0  # 60 BPM, 4/4
    t, i = 0.5, 0
    while t < tl.duration - 3.0:
        chord = CHORDS[i % len(CHORDS)]
        organ.add(t, ins.organ(chord, bar, reg='soft' if t < hit else 'principal'))
        if t >= hit:
            strings.add(t, ins.strings(chord[1:], bar))
        t += bar
        i += 1

    for k, note in enumerate(MOTIF):
        piano.add(1.5 + k * 1.2, ins.piano(note, dur=3.0, vel=0.45))

    hits.add(hit - 3.0, ins.riser(3.0, vel=0.7))
    hits.add(hit, ins.impact(vel=1.0, size=1.0, dur=6.0))
    return mix


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(ROOT / 'out' / '__ID__' / 'audio' / 'score.wav'))
    args = ap.parse_args()
    tl = Timeline.load(str(HERE / 'timeline.json'))
    y, report = master.master(compose(tl).render(), target_lufs=-14.0, tp_ceiling=-1.0)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    wav.write_wav(args.out, y)
    print(f"wrote {args.out}: {report.get('lufs', 0):.1f} LUFS, true peak {report.get('true_peak', 0):.1f} dBTP")


if __name__ == '__main__':
    main()
