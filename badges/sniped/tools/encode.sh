#!/usr/bin/env bash
# Encode rendered frames into the delivery formats.
#   bash badges/sniped/tools/encode.sh            (expects build/frames-720 from render.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."
F=build/frames-720
OUT=dist
mkdir -p "$OUT"
IN=(-framerate 60 -i "$F/f_%04d.png")

# OBS / browser source: VP9 with real alpha, 60 fps, plays once
ffmpeg -y -loglevel error "${IN[@]}" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 22 \
  -row-mt 1 -auto-alt-ref 0 -metadata:s:v:0 alpha_mode=1 "$OUT/sniped-720-60fps.webm"

# Optional editing master: ProRes 4444 with alpha. ~350 MB, so it goes to
# build/ (not committed). Run with PRORES=1 to make it.
if [[ "${PRORES:-0}" == "1" ]]; then
  ffmpeg -y -loglevel error "${IN[@]}" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le \
    -vendor apl0 build/sniped-720-60fps-prores4444.mov
fi

# GIF fallback: the GIF format cannot store 60 fps (1/100 s ticks; 0.02 s is the
# smallest delay browsers honour), so this is 50 fps. 1-bit transparency.
ffmpeg -y -loglevel error -framerate 60 -i "$F/f_%04d.png" -filter_complex \
  "fps=50,scale=400:400:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full:max_colors=255[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=96" \
  -loop -1 "$OUT/sniped-400-50fps.gif"

# Final pose still
cp "$F/$(ls "$F" | tail -1)" "$OUT/sniped-final-pose-720.png"
ls -lh "$OUT"
