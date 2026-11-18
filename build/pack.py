"""Pack film frames into a few binary files per tier + manifest.  python3 pack.py"""
import os, json
HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.join(HERE, '..', 'site', 'film')
PER = 36
man = {}
for tier, (w, h) in {'1080': (1920, 1080), '720': (1280, 720), 'p720': (720, 1280)}.items():
    src = os.path.join(HERE, 'out', tier)
    frames = sorted(os.listdir(src))
    os.makedirs(os.path.join(FILM, tier), exist_ok=True)
    packs = []
    for i in range(0, len(frames), PER):
        name = f'{tier}/{i // PER:02d}.bin'
        offs, data = [], bytearray()
        for f in frames[i:i + PER]:
            b = open(os.path.join(src, f), 'rb').read()
            offs.append([len(data), len(b)]); data += b
        open(os.path.join(FILM, name), 'wb').write(data)
        packs.append({'url': name, 'first': i, 'frames': offs, 'bytes': len(data)})
    man[tier] = {'w': w, 'h': h, 'count': len(frames), 'packs': packs}
json.dump(man, open(os.path.join(FILM, 'manifest.json'), 'w'), separators=(',', ':'))
print({t: sum(p['bytes'] for p in m['packs']) // 1024 // 1024 for t, m in man.items()}, 'MB')
