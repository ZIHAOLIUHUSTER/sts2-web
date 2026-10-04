#!/usr/bin/env python3
"""Add MP3 siblings for every indexed Opus sample. Run after audio_index.py; requires ffmpeg.

Prefer the original extracted WAV when available; an existing checkout can also be
converted directly from its Ogg files. Logical sample paths and aliases stay Ogg.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
OUT, WORK = ROOT / 'assets/audio', ROOT / '_work/audio'
MUSIC_KBPS, SFX_KBPS = 48, 32


def encode(file):
    ogg = OUT / file
    wav = (WORK / file).with_suffix('.wav')
    source = wav if wav.is_file() else ogg
    mp3 = ogg.with_suffix('.mp3')
    if mp3.is_file() and mp3.stat().st_mtime >= max(source.stat().st_mtime, Path(__file__).stat().st_mtime):
        return 'cached', mp3.stat().st_size
    kbps = SFX_KBPS if 'sfx' in Path(file).parts[0].lower() else MUSIC_KBPS
    temp = mp3.with_suffix('.tmp.mp3')
    try:
        # Keep Xing/LAME gapless metadata: the event timelines depend on sample timing.
        subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', str(source),
                        '-map_metadata', '-1', '-ac', '1', '-ar', '48000', '-c:a', 'libmp3lame',
                        '-b:a', f'{kbps}k', '-threads', '1', '-write_xing', '1', str(temp)],
                       check=True, capture_output=True)
        temp.replace(mp3)
        return 'encoded', mp3.stat().st_size
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f'{file}: {e.stderr.decode(errors="replace")}') from e
    finally:
        temp.unlink(missing_ok=True)


def main():
    files = json.loads((OUT / 'index.json').read_text())['files']
    counts = {'cached': 0, 'encoded': 0}
    size = 0
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as pool:
        for i, (status, length) in enumerate(pool.map(encode, files), 1):
            counts[status] += 1
            size += length
            if i % 250 == 0:
                print(f'{i}/{len(files)} MP3 samples ready', flush=True)
    print(f'MP3: {counts["encoded"]} encoded, {counts["cached"]} cached, {size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
