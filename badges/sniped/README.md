# SNIPED — animated Whatnot / OBS badge

Plays when someone snipes an auction. 8.75 s, 60 fps, transparent background, plays once and ends on the final pose.

| Time | Scene |
| --- | --- |
| 0.00–2.10 | Scope opens, the focus pulls onto the Magic card, the crosshair drifts with the shooter's breathing and locks on |
| 2.10–2.90 | Shot: muzzle-flash blowout, recoil kick with motion blur, tracer, then the card shatters in slow motion (shards, sparks, debris, shockwave) |
| 2.86–4.72 | One continuous pull-out through the eyepiece: the dog is revealed from behind on the rifle, the badge assembles, SNIPED slams in |
| 4.98–5.75 | Head snaps over the shoulder: half-lidded eyes, one-sided smirk, eye glint |
| 5.75–8.75 | 3.0 s hold: smoke drift, light sweeps across SNIPED, sparkle twinkle, slow blink. Then it ends. |

## Files (`dist/`)

| File | Use |
| --- | --- |
| `sniped-720-60fps.webm` | **OBS** (Media Source) and browsers. VP9 with real alpha, true 60 fps. |
| `sniped-400-50fps.gif` | GIF fallback for uploads that need a GIF. The GIF format can't do 60 fps, so this is 50 fps, with hard-edged transparency. Plays once. |
| `sniped-final-pose-720.png` | Still of the final pose. |

## Rebuilding

```bash
python3 -I badges/sniped/tools/extract_assets.py   # only if the reference images change
node badges/sniped/tools/render.mjs --size 720     # 525 PNG frames -> badges/sniped/build/
bash badges/sniped/tools/encode.sh                 # frames -> dist/
PRORES=1 bash badges/sniped/tools/encode.sh        # also a ProRes 4444 + alpha master in build/ (~350 MB)
```

To preview live with a scrubber, serve the folder (`npx serve badges/sniped`) and open `sniped.html?preview`.
To check single moments: `node badges/sniped/tools/render.mjs --times 2.3,5.3 --out /tmp/check`.

## How it's made

- `sniped.html` draws every frame as a function of time (no randomness at run time), so the export steps it at exactly 1/60 s and every frame is identical on every run.
- The dog's face and paw are cut straight from the First Fetch badge (`reference/first-fetch-badge.gif`, frame 1) by `tools/extract_assets.py`. The smug expression is painted on top of that art. The back of the head and the body seen from behind are drawn in code, because the reference only shows the dog from the front.
- The card is `reference/mtg-card-back.png`, trimmed and with rounded corners.
- Font: Luckiest Guy (Apache 2.0, `assets/fonts/LuckiestGuy-LICENSE.txt`).
