#!/usr/bin/env python3
"""Verify a rendered soundtrack without listening to it.

    python audio/analyze.py out/<project>/audio/score.wav \\
        --timeline projects/<project>/timeline.json \\
        --png out/<project>/audio/spectrogram.png \\
        --onsets bang theia asteroidImpact lastFlash --cut now

Prints: format/duration, NaN/inf and clipping checks, DC offset, integrated
loudness (BS.1770-4), loudness range, true peak, onset alignment against
timeline cues, hard-cut checks, and a per-section level table (timeline
beats). Optionally writes a spectrogram PNG with section marks.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from studio import analysis, master, wav  # noqa: E402
from studio.timeline import Timeline  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('wav')
    ap.add_argument('--timeline', default=None)
    ap.add_argument('--png', default=None, help='write a spectrogram PNG')
    ap.add_argument('--onsets', nargs='*', default=[], help='cue names where a hit should start')
    ap.add_argument('--cut', nargs='*', default=[], help='cue names where the audio should cut to silence')
    ap.add_argument('--json', default=None, help='write the results as JSON')
    ap.add_argument('--tolerance-ms', type=float, default=20.0)
    args = ap.parse_args(argv)

    x, sr = wav.read_wav(args.wav)
    res: dict = {'file': args.wav, 'sample_rate': sr, 'channels': int(x.shape[0])}
    res.update(analysis.summary(x, sr))
    res['lra_lu'] = master.loudness_range(x, sr)
    st_t, st = master.short_term_loudness(x, sr, 0.1)
    res['max_short_term_lufs'] = float(st.max())
    ok = True
    print(f"file         {args.wav}")
    print(f"format       {sr} Hz, {x.shape[0]} ch, {res['samples']} samples = {res['duration_s']:.4f} s")
    print(f"finite       {res['finite']}")
    print(f"sample peak  {res['sample_peak_dbfs']:.2f} dBFS   clipped samples: {res['clipped_samples']}")
    print(f"true peak    {res['true_peak_dbtp']:.2f} dBTP")
    print(f"DC offset    L {res['dc_offset'][0]:+.2e}  R {res['dc_offset'][1]:+.2e}")
    print(f"loudness     {res['lufs_integrated']:.2f} LUFS integrated, LRA {res['lra_lu']:.1f} LU, "
          f"max short-term {res['max_short_term_lufs']:.1f} LUFS")
    tl = Timeline.load(args.timeline) if args.timeline else None
    if tl:
        if abs(res['duration_s'] - tl.duration) > 0.5 / sr:
            print(f"!! duration {res['duration_s']:.4f} s != timeline {tl.duration} s")
            ok = False
        res['onsets'] = {}
        for name in args.onsets:
            t = tl.cue(name)
            o = analysis.onset_near(x, t, sr)
            res['onsets'][name] = o
            flag = 'ok' if abs(o['error_ms']) <= args.tolerance_ms else 'OFF'
            ok &= flag == 'ok'
            print(f"onset        {name:<16} cue {t:8.3f}s  detected {o['onset']:8.4f}s  error {o['error_ms']:+6.1f} ms  "
                  f"jump {o['jump_db']:+5.1f} dB  [{flag}]")
        res['cuts'] = {}
        for name in args.cut:
            t = tl.cue(name)
            c = analysis.cut_check(x, t, sr)
            res['cuts'][name] = c
            flag = 'ok' if c['rms_after_db'] < -70 and abs(c['cut_error_ms']) <= args.tolerance_ms else 'CHECK'
            ok &= flag == 'ok'
            print(f"cut          {name:<16} cue {t:8.3f}s  last loud {c['last_loud']:8.4f}s ({c['cut_error_ms']:+5.1f} ms)  "
                  f"before {c['rms_before_db']:6.1f} dBFS  after {c['rms_after_db']:6.1f} dBFS (peak {c['peak_after_db']:6.1f})  [{flag}]")
        rows = analysis.section_table(x, [(b.id, b.start, b.end) for b in tl.beats], sr)
        res['sections'] = rows
        print(f"\n{'section':<13}{'start':>7}{'end':>7}{'RMS dBFS':>10}{'peak dBFS':>11}{'ST max LUFS':>13}")
        for r in rows:
            print(f"{r['section']:<13}{r['start']:7.1f}{r['end']:7.1f}{r['rms_db']:10.1f}{r['peak_db']:11.1f}{r['st_max_lufs']:13.1f}")
    if args.png:
        marks = [(b.start, b.id) for b in tl.beats] if tl else None
        analysis.spectrogram_png(x, args.png, sr, marks=marks, title=Path(args.wav).name)
        print(f"\nspectrogram  {args.png}")
    if args.json:
        Path(args.json).write_text(json.dumps(res, indent=2, default=float))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
