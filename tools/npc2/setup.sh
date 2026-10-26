#!/bin/bash
# Fetch everything tools/npc2/build.py needs into DIR (default tools/.cache/npc2), then print the env to use.
#   bash tools/npc2/setup.sh [DIR]
set -e
D=$(realpath -m "${1:-tools/.cache/npc2}")
R=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$D/zips" "$D/user" "$D/scans"
BL=blender-4.2.23-linux-x64
[ -x "$D/$BL/blender" ] || curl -fL https://download.blender.org/release/Blender4.2/$BL.tar.xz | tar xJ -C "$D"
get() { [ -f "$D/zips/$(basename "$1")" ] || curl -fL -o "$D/zips/$(basename "$1")" "$1"; }
get https://files.makehumancommunity.org/plugins/mpfb2-latest.zip
A=https://files.makehumancommunity.org/asset_packs
for z in makehuman_system_assets/makehuman_system_assets_cc0 suits02/suits02_cc0 dress03/dress03_cc-by shoes03/shoes03_ccby hats03/hats03_cc-by; do get "$A/$z.zip"; done
export BLENDER_USER_RESOURCES="$D/user"
"$D/$BL/blender" -b --command extension install-file -r user_default -e "$D/zips/mpfb2-latest.zip"
ASSETS="$D/user/extensions/.user/user_default/mpfb/data"
mkdir -p "$ASSETS"
# Asset files only (no code) from the packs.
python3 -I "$R/tools/npc2/unpack.py" "$ASSETS" "$D"/zips/*_cc*.zip | grep -v '^skip' || true
for s in eric nathan manuel claudia sophia face_grandpa; do cp "$R/public/models/npc/$s.json" "$D/scans/$s.gltf"; done
cp "$R"/public/models/npc/*.webp "$D/scans/"
echo "export BLENDER_USER_RESOURCES=$D/user NPC2_ASSETS=$ASSETS NPC2_SCANS=$D/scans"
echo "then: $D/$BL/blender -b --python tools/npc2/build.py -- BODY work/BODY.glb && npx tsx tools/npc2/pack.ts work BODY"
