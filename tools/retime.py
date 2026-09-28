#!/usr/bin/env python3
"""Insert (or remove) time in a film's timeline.json.

    python3 tools/retime.py projects/<id>/timeline.json --at 108 --by 4 [--extend moon]

Every time at or after ``--at`` moves by ``--by`` seconds: beat starts and ends, cues, montage
times, the times cards leave (``until``, ``captionUntil``), time lists (e.g. ``starIgnitions``),
line and title-card times, and the duration.
``--extend <beat>`` lengthens that beat instead of moving it (its start stays). The file keeps
its layout: numbers are edited in place, so one-beat-per-line formatting survives.
Shots, captions and the score read the timeline, so they follow; check hard-coded times with
``grep`` afterwards (there should be none).
"""
import argparse
import json
import re
import sys


def fmt(x: float) -> str:
    return str(int(round(x))) if abs(x - round(x)) < 1e-9 else f'{x:.3f}'.rstrip('0').rstrip('.')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('timeline')
    ap.add_argument('--at', type=float, required=True, help='times >= this move')
    ap.add_argument('--by', type=float, required=True, help='seconds to insert (negative removes)')
    ap.add_argument('--extend', default=None, help='beat id whose end moves while its start stays')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    src = open(a.timeline).read()
    before = json.loads(src)

    def shift(v: float) -> float:
        return v + a.by if v >= a.at - 1e-9 else v

    out = []
    # Walk the text; for each number, decide from its key or context whether it is a time.
    time_keys = {'start', 'end', 't', 'until', 'captionUntil', 'duration'}
    list_re = re.compile(r'"(\w+)":\s*\[([0-9.,\s-]+)\]')
    # 1. numeric lists of times (e.g. starIgnitions), except those not made of times
    def fix_list(m):
        key, body = m.group(1), m.group(2)
        vals = [float(x) for x in body.split(',') if x.strip()]
        return f'"{key}": [' + ', '.join(fmt(shift(v)) for v in vals) + ']'
    text = list_re.sub(fix_list, src)
    # 2. cues block: every value is a time
    cues = re.search(r'"cues":\s*\{[^}]*\}', text)
    if cues:
        block = re.sub(r'("\w+":\s*)(-?[0-9.]+)', lambda m: m.group(1) + fmt(shift(float(m.group(2)))), cues.group(0))
        text = text[:cues.start()] + block + text[cues.end():]
    # 3. start / end / t / until / duration fields anywhere; --extend keeps that beat's start and moves its end
    def fix_field(m):
        key, val = m.group(1), float(m.group(2))
        return f'"{key}": {fmt(shift(val))}'
    if a.extend:
        beat = re.search(r'\{\s*"id":\s*"' + re.escape(a.extend) + r'"[^\n]*', text)
        if not beat:
            sys.exit(f'no beat {a.extend!r}')
        line = beat.group(0)
        new = re.sub(r'"end":\s*(-?[0-9.]+)', lambda m: f'"end": {fmt(float(m.group(1)) + a.by)}', line, count=1)
        text = text[:beat.start()] + new.replace('"end":', '"end@":', 1) + text[beat.end():]
    # (outside the cues block, which step 2 already moved: a cue may be called "end")
    field = re.compile(r'"(' + '|'.join(time_keys) + r')":\s*(-?[0-9.]+)')
    cues = re.search(r'"cues":\s*\{[^}]*\}', text)
    if cues:
        text = field.sub(fix_field, text[:cues.start()]) + cues.group(0) + field.sub(fix_field, text[cues.end():])
    else:
        text = field.sub(fix_field, text)
    text = text.replace('"end@":', '"end":')
    after = json.loads(text)
    if a.dry_run:
        print(text)
        return
    open(a.timeline, 'w').write(text)
    print(f'{a.timeline}: moved every time >= {a.at:g} s by {a.by:+g} s'
          f'{f", extended {a.extend!r}" if a.extend else ""}; duration {before.get("duration")} -> {after.get("duration")}')


if __name__ == '__main__':
    main()
