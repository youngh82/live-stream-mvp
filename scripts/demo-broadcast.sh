#!/usr/bin/env bash
#
# 데모 방송 송출 (README 스크린샷·GIF용).
#
# ffmpeg로 만든 9:16 합성 영상을 MediaMTX에 RTMP로 밀어넣는다.
# **평소 경로를 그대로 탄다** — /api/stream/auth 로 stream_key를 검증받고,
# on-publish 웹훅이 Redis ZSET을 채우고, 피드가 그걸 읽는다.
# 그래서 여기서 나온 스크린샷은 실제로 동작하는 파이프라인의 화면이다.
#
#   bash scripts/demo-broadcast.sh start   # 전부 송출 시작
#   bash scripts/demo-broadcast.sh stop    # 전부 종료
#   bash scripts/demo-broadcast.sh status  # 살아있는 프로세스 확인
#
# 선행 조건: pnpm tsx scripts/seed-demo.ts (.demo-streams 생성)
set -uo pipefail

cd "$(dirname "$0")/.."

MANIFEST=".demo-streams"
PIDFILE=".demo-broadcast.pids"
RTMP="rtmp://localhost:1935"
LOGDIR=".demo-logs"

# 방송자별 배경색. 스와이프 GIF에서 화면이 바뀐 것이 한눈에 보여야 한다.
COLORS=(0x1e1b4b 0x3b0764 0x431407 0x052e16 0x172554)

start() {
  [[ -f "$MANIFEST" ]] || { echo "$MANIFEST 이 없다. 먼저: npx tsx scripts/seed-demo.ts"; exit 1; }
  command -v ffmpeg >/dev/null || { echo "ffmpeg 가 필요하다: brew install ffmpeg"; exit 1; }

  stop >/dev/null 2>&1
  mkdir -p "$LOGDIR"
  : > "$PIDFILE"

  local i=0
  while IFS=$'\t' read -r nickname stream_id stream_key; do
    # '# password' / '# domain' 같은 머리말은 건너뛴다
    [[ -z "${stream_id:-}" || "$nickname" == \#* ]] && continue
    local color="${COLORS[$((i % ${#COLORS[@]}))]}"

    # 1080x1920(9:16). testsrc 대신 단색 + 큰 텍스트를 쓰는 이유:
    # 스크린샷에 어느 방송인지가 그대로 보여야 하고, 노이즈 패턴은
    # 저화질 인코딩에서 지저분하게 뭉개진다.
    #
    # -re 는 실시간 속도로 읽는다는 뜻이다. 없으면 ffmpeg가 최대 속도로
    # 밀어넣어 MediaMTX가 몇 초 만에 몇 분치를 받고 끝나버린다.
    ffmpeg -hide_banner -loglevel error \
      -re -f lavfi -i "color=c=${color}:s=1080x1920:r=30" \
      -f lavfi -i "sine=frequency=$((220 + i * 55)):sample_rate=48000" \
      -vf "drawtext=text='${nickname}':fontcolor=white@0.92:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2-120,\
drawtext=text='demo stream':fontcolor=white@0.45:fontsize=44:x=(w-text_w)/2:y=(h-text_h)/2+20,\
drawtext=text='%{pts\\:hms}':fontcolor=white@0.7:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2+140" \
      -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
      -b:v 2500k -g 60 -c:a aac -b:a 96k -shortest \
      -f flv "${RTMP}/${stream_id}?user=streamer&pass=${stream_key}" \
      > "${LOGDIR}/${nickname}.log" 2>&1 &

    echo "$! $nickname" >> "$PIDFILE"
    echo "  ▶ ${nickname}  (${stream_id})"
    i=$((i + 1))
  done < "$MANIFEST"

  echo
  echo "송출 중. 확인: https://localhost:3000/feed"
  echo "종료:  bash scripts/demo-broadcast.sh stop"
}

stop() {
  [[ -f "$PIDFILE" ]] || { echo "송출 중인 데모가 없다."; return 0; }
  while read -r pid nickname; do
    if kill "$pid" 2>/dev/null; then echo "  ■ ${nickname}"; fi
  done < "$PIDFILE"
  rm -f "$PIDFILE"
  # MediaMTX의 on-unpublish 웹훅이 Redis에서 빠지는 데 잠깐 걸린다
  sleep 1
  echo "종료했다."
}

status() {
  [[ -f "$PIDFILE" ]] || { echo "송출 중인 데모가 없다."; return 0; }
  while read -r pid nickname; do
    if kill -0 "$pid" 2>/dev/null; then echo "  ● ${nickname} (pid ${pid})"
    else echo "  ○ ${nickname} — 죽었다. ${LOGDIR}/${nickname}.log 확인"; fi
  done < "$PIDFILE"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|status}"; exit 1 ;;
esac
