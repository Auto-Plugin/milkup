#!/usr/bin/python3
"""Decode every PNG pixel with the installed Pillow, without changing the image."""
import hashlib, json, pathlib, sys
from PIL import Image

file = pathlib.Path(sys.argv[1])
expected = (int(sys.argv[2]), int(sys.argv[3]))
with Image.open(file) as image:
    assert image.format == 'PNG'
    assert image.size == expected
    assert getattr(image, 'n_frames', 1) == 1
    image.load()
    pixels = image.convert('RGBA').tobytes()
    assert len(pixels) == expected[0] * expected[1] * 4
    print(json.dumps({'decoder': 'Pillow', 'size': list(image.size),
                      'mode': image.mode, 'decodedBytes': len(pixels),
                      'rgbaSha256': hashlib.sha256(pixels).hexdigest()}))
