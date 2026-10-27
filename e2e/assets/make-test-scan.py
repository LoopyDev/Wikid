"""Writes test-scan.spz: a small Gaussian splat scan (4,000 points on a coloured sphere) in the SPZ
format, for the browser test that checks 3D scans render. Run with `python3 make-test-scan.py`."""
import gzip
import math
import random
import struct

random.seed(1)
POINTS = 4000
FRACTIONAL_BITS = 12  # positions are 24-bit fixed point


def fixed24(value):
    n = int(round(value * (1 << FRACTIONAL_BITS))) & 0xFFFFFF
    return bytes([n & 255, (n >> 8) & 255, (n >> 16) & 255])


positions, alphas, colours, scales, rotations = bytearray(), bytearray(), bytearray(), bytearray(), bytearray()
for _ in range(POINTS):
    z = random.uniform(-1, 1)
    angle = random.uniform(0, 2 * math.pi)
    radius = math.sqrt(1 - z * z)
    x, y = radius * math.cos(angle), radius * math.sin(angle)
    positions += fixed24(x) + fixed24(y) + fixed24(z)
    alphas.append(240)
    for channel in ((x + 1) / 2, (y + 1) / 2, (z + 1) / 2):  # colour from position
        dc = (channel - 0.5) / 0.28209  # spherical-harmonic DC term
        colours.append(max(0, min(255, int(round((dc * 0.15 + 0.5) * 255)))))
    scales += bytes([max(0, min(255, int(round((math.log(0.03) + 10) * 16))))] * 3)  # log scale
    rotations += bytes([128, 128, 128])  # identity quaternion (xyz; w derived)

header = struct.pack('<IIIBBBB', 0x5053474E, 2, POINTS, 0, FRACTIONAL_BITS, 0, 0)
with open('test-scan.spz', 'wb') as out:
    out.write(gzip.compress(bytes(header + positions + alphas + colours + scales + rotations)))
