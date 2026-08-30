#!/bin/bash
# SPIKE runner: vite once, then app binary per (corpus, mode); peak RSS via ps.
set -u
cd "$(dirname "$0")/.."
BIN=src-tauri/target/debug/simplemd
mkdir -p spike/results

npm run dev >/tmp/spike-vite.log 2>&1 &
VITE_PID=$!
until curl -s -o /dev/null http://localhost:1420; do sleep 0.5; done

for corpus in 1k 10k 50k; do
  for mode in widgets in-place; do
    name="${corpus}-${mode}"
    rm -f "spike/results/${name}.json"
    printf '{"corpus":"%s","mode":"%s"}\n' "$corpus" "$mode" > spike/config.json
    "$BIN" >/dev/null 2>&1 &
    APP_PID=$!
    peak=0
    for i in $(seq 1 360); do   # 3 min cap per run
      rss=$(ps -o rss= -p $APP_PID 2>/dev/null | tr -d ' ')
      [ -z "$rss" ] && break
      [ "$rss" -gt "$peak" ] && peak=$rss
      [ -f "spike/results/${name}.json" ] && sleep 1 && break
      sleep 0.5
    done
    kill $APP_PID 2>/dev/null
    if [ -f "spike/results/${name}.json" ]; then
      python3 -c "
import json
d=json.load(open('spike/results/${name}.json')); d['peakRssMb']=round($peak/1024,1)
json.dump(d,open('spike/results/${name}.json','w'),indent=2)"
      echo "DONE ${name}: peakRSS=$((peak/1024))MB"
    else
      echo "TIMEOUT/FAIL ${name}"
    fi
  done
done
rm -f spike/config.json
kill $VITE_PID 2>/dev/null
echo "MATRIX COMPLETE"
