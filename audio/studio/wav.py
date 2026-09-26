"""WAV I/O: 24-bit PCM or 32-bit float RIFF/WAVE, written with the standard
library only (numpy for packing), streamed in chunks to keep memory low.

24-bit output is TPDF-dithered by default; dither is skipped on digital
silence, so silent passages stay exactly zero.
"""
from __future__ import annotations

import os
import struct

import numpy as np

from .core import F32, SR

_CHUNK = 1 << 20


def write_wav(path: str, x: np.ndarray, sr: int = SR, bits: int = 24, dither: bool = True) -> str:
    """Write ``x`` (mono ``(n,)`` or ``(channels, n)``) to ``path``.

    ``bits=24`` writes integer PCM (clipped to full scale); ``bits=32`` writes
    IEEE float. Parent directories are created. Returns ``path``.
    """
    x = np.asarray(x)
    if x.ndim == 1:
        x = x[None, :]
    ch, n = x.shape
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if bits == 24:
        fmt_tag, width = 1, 3
        extra = b''
    elif bits == 32:
        fmt_tag, width = 3, 4
        extra = struct.pack('<4sII', b'fact', 4, n)
    else:
        raise ValueError('bits must be 24 or 32')
    align = ch * width
    fmt = struct.pack('<HHIIHH', fmt_tag, ch, sr, sr * align, align, bits)
    if fmt_tag == 3:
        fmt += struct.pack('<H', 0)
    data_len = n * align
    riff_size = 4 + (8 + len(fmt)) + len(extra) + (8 + data_len)
    r = np.random.default_rng(24)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sI4s', b'RIFF', riff_size, b'WAVE'))
        f.write(struct.pack('<4sI', b'fmt ', len(fmt)))
        f.write(fmt)
        f.write(extra)
        f.write(struct.pack('<4sI', b'data', data_len))
        for a in range(0, n, _CHUNK):
            blk = x[:, a:a + _CHUNK]
            if bits == 24:
                y = blk.astype(np.float64) * 8388607.0
                if dither:
                    tp = r.random(y.shape) - r.random(y.shape)
                    tp[y == 0] = 0.0
                    y += tp
                q = np.clip(np.round(y), -8388608, 8388607).astype('<i4')
                inter = np.ascontiguousarray(q.T).reshape(-1)
                f.write(inter.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())
            else:
                f.write(np.ascontiguousarray(blk.T.astype('<f4')).tobytes())
    return path


def read_wav(path: str) -> tuple[np.ndarray, int]:
    """Read PCM 16/24/32-bit or float32 WAV -> ``((channels, n) float32, sr)``."""
    with open(path, 'rb') as f:
        data = f.read()
    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('not a WAV file')
    pos = 12
    tag = ch = sr = bps = None
    while pos + 8 <= len(data):
        cid, size = struct.unpack('<4sI', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            tag, ch, sr, _, _, bps = struct.unpack('<HHIIHH', body[:16])
            if tag == 0xFFFE and len(body) >= 26:      # WAVE_FORMAT_EXTENSIBLE
                tag = struct.unpack('<H', body[24:26])[0]
        elif cid == b'data':
            if tag is None:
                raise ValueError('data before fmt chunk')
            if bps == 16:
                y = np.frombuffer(body, '<i2').astype(F32) / 32768.0
            elif bps == 24:
                u = np.frombuffer(body, np.uint8).reshape(-1, 3).astype(np.int32)
                v = u[:, 0] | (u[:, 1] << 8) | (u[:, 2] << 16)
                v = np.where(v >= 1 << 23, v - (1 << 24), v)
                y = v.astype(F32) / F32(8388608.0)
            elif bps == 32 and tag == 3:
                y = np.frombuffer(body, '<f4').astype(F32)
            elif bps == 32:
                y = (np.frombuffer(body, '<i4') / 2147483648.0).astype(F32)
            else:
                raise ValueError(f'unsupported sample width {bps}')
            return y.reshape(-1, ch).T.copy(), sr
        pos += 8 + size + (size & 1)
    raise ValueError('no data chunk')
