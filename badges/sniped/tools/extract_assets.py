"""Cut the mascot's head and the Magic card out of the reference images.

Run:  python3 -I badges/sniped/tools/extract_assets.py
Needs: pillow, numpy, scipy, opencv-contrib-python-headless
Writes: badges/sniped/assets/dog-head.png, card.png
"""
import os
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REF = os.path.join(ROOT, "reference")
OUT = os.path.join(ROOT, "assets")
UP = 3  # supersample factor for the head cutout


def dog_head():
    gif = Image.open(os.path.join(REF, "first-fetch-badge.gif"))
    gif.seek(0)
    src = np.array(gif.convert("RGB"))
    # Region holding the head and neck ruff (reference pixel coords).
    x0, y0, x1, y1 = 92, 52, 330, 236
    crop = src[y0:y1, x0:x1].astype(np.uint8)

    # Soften the GIF palette banding before upscaling, keep edges.
    smooth = cv2.bilateralFilter(crop, 5, 18, 3)
    big = cv2.resize(smooth, None, fx=UP, fy=UP, interpolation=cv2.INTER_LANCZOS4)
    blur = cv2.GaussianBlur(big, (0, 0), 1.6)
    big = cv2.addWeighted(big, 1.55, blur, -0.55, 0)

    # Background = saturated purple/violet. The dog is black/white/grey;
    # its eyes, nose and tongue are coloured but sit well inside the head.
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    r, g, b = [crop[..., i].astype(np.float32) for i in range(3)]
    purple = (h > 245) & (h < 320) & (s > 0.32) & (v > 0.12)
    purpleish = (b > g + 22) & (r > g + 8)  # violet glow / dark purple
    bg = purple | purpleish
    fg = ~bg
    fg = ndi.binary_opening(fg, iterations=1)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    keep = 1 + int(np.argmax(sizes))
    fg = lab == keep
    fg = ndi.binary_fill_holes(fg)

    # Neckline: cut the bottom with a soft U so it tucks under the collar.
    H, W = fg.shape
    yy, xx = np.mgrid[0:H, 0:W]
    cx = 132.0
    # Chin/chest bib dips lower in the middle; the paws at the sides go.
    neck_y = 146 + 28 * np.exp(-(((xx - cx) / 46.0) ** 2))
    fg &= yy < neck_y
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    fg = lab == (1 + int(np.argmax(sizes)))
    fg = ndi.binary_fill_holes(fg)

    a = cv2.resize(fg.astype(np.float32), (W * UP, H * UP), interpolation=cv2.INTER_LINEAR)
    a = cv2.GaussianBlur(a, (0, 0), 1.1)
    a = np.clip((a - 0.5) * 2.2 + 0.5, 0, 1)
    # Feather the neck cut so it melts into the collar fur of the body.
    yyb, xxb = np.mgrid[0:H * UP, 0:W * UP] / UP
    ny = 146 + 28 * np.exp(-(((xxb - cx) / 46.0) ** 2))
    a *= np.clip((ny - yyb) / 9.0, 0, 1)

    # Kill purple spill on the fringe: desaturate toward grey near edges.
    edge = np.clip(1 - np.abs(a - 0.5) * 2, 0, 1)[..., None]
    grey = big.mean(axis=2, keepdims=True)
    big = big * (1 - 0.7 * edge) + grey * 0.7 * edge

    rgba = np.dstack([np.clip(big, 0, 255), a * 255]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, "dog-head.png"))
    print("dog-head.png", rgba.shape, "origin(ref px)", (x0, y0), "scale", UP)


def card():
    im = np.array(Image.open(os.path.join(REF, "mtg-card-back.png")).convert("RGB"))
    H, W = im.shape[:2]
    # The scan has white margins; trim to the black card border.
    dark = im.mean(axis=2) < 110
    rows = np.where(dark.mean(axis=1) > 0.5)[0]
    cols = np.where(dark.mean(axis=0) > 0.5)[0]
    y0, y1, x0, x1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    c = im[y0:y1, x0:x1]
    h, w = c.shape[:2]
    rad = int(w * 0.045)
    mask = np.zeros((h * 4, w * 4), np.uint8)
    cv2.rectangle(mask, (rad * 4, 0), ((w - rad) * 4, h * 4), 255, -1)
    cv2.rectangle(mask, (0, rad * 4), (w * 4, (h - rad) * 4), 255, -1)
    for px, py in [(rad, rad), (w - rad, rad), (rad, h - rad), (w - rad, h - rad)]:
        cv2.circle(mask, (px * 4, py * 4), rad * 4, 255, -1)
    mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_AREA)
    rgba = np.dstack([c, mask]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, "card.png"))
    print("card.png", rgba.shape, "trim", (x0, y0, x1, y1))


def dog_paw():
    """The mascot's right front paw, used gripping the rifle."""
    gif = Image.open(os.path.join(REF, "first-fetch-badge.gif"))
    gif.seek(0)
    src = np.array(gif.convert("RGB"))
    x0, y0, x1, y1 = 240, 196, 322, 246
    crop = src[y0:y1, x0:x1].astype(np.uint8)
    smooth = cv2.bilateralFilter(crop, 5, 18, 3)
    big = cv2.resize(smooth, None, fx=UP, fy=UP, interpolation=cv2.INTER_LANCZOS4)
    hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV).astype(np.float32)
    v = hsv[..., 2] / 255
    s = hsv[..., 1] / 255
    # paw = bright, unsaturated fur plus its dark outline
    fg = (v > 0.55) & (s < 0.25)
    fg = ndi.binary_closing(fg, iterations=2)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    fg = lab == (1 + int(np.argmax(sizes)))
    fg = ndi.binary_fill_holes(fg)
    fg = ndi.binary_dilation(fg, iterations=1)  # keep the cartoon outline
    H, W = fg.shape
    a = cv2.resize(fg.astype(np.float32), (W * UP, H * UP), interpolation=cv2.INTER_LINEAR)
    a = cv2.GaussianBlur(a, (0, 0), 1.0)
    a = np.clip((a - 0.5) * 2.2 + 0.5, 0, 1)
    rgba = np.dstack([np.clip(big, 0, 255), a * 255]).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, "dog-paw.png"))
    print("dog-paw.png", rgba.shape)


if __name__ == "__main__":
    dog_paw()
    dog_head()
    card()
