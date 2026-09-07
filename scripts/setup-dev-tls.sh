#!/usr/bin/env bash
#
# 개발용 TLS 인증서 발급 + LAN IP 반영
#
# 모바일 웹 방송(WHIP)은 HTTPS가 필수다:
#   - getUserMedia(카메라)는 secure context에서만 동작
#   - HTTPS 페이지에서 http:// WHIP 엔드포인트 호출은 mixed content로 차단
# 앱(3000), 채팅(3001), 미디어(8891) 세 서버가 이 인증서를 공유한다.
#
# Wi-Fi를 옮기거나 DHCP로 IP가 바뀌면 다시 실행하면 된다.
#
# 실행: pnpm certs:dev
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert가 필요합니다:  brew install mkcert" >&2
  exit 1
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
if [ -z "$IP" ]; then
  echo "LAN IP를 찾지 못했습니다. Wi-Fi에 연결되어 있는지 확인해주세요." >&2
  exit 1
fi

echo "LAN IP: $IP"

# 로컬 CA가 시스템 신뢰 저장소에 없으면 알려준다 (sudo가 필요해 자동 실행하지 않는다)
if [ ! -f "$(mkcert -CAROOT)/rootCA.pem" ]; then
  echo "먼저 로컬 CA를 설치해주세요:  mkcert -install" >&2
  exit 1
fi

mkdir -p certs
mkcert -cert-file certs/dev.crt -key-file certs/dev.key \
  localhost 127.0.0.1 ::1 "$IP" >/dev/null 2>&1

echo "인증서 발급 완료: certs/dev.crt"

# .env.local의 IP 기반 주소를 갱신
python3 - "$IP" <<'PY'
import re, sys
ip = sys.argv[1]
path = '.env.local'

updates = {
    'NEXT_PUBLIC_WHEP_BASE_URL': f'https://{ip}:8891',
    'NEXT_PUBLIC_HLS_BASE_URL':  f'https://{ip}:8890',
    'NEXT_PUBLIC_WS_URL':        f'https://{ip}:3001',
    'CORS_ORIGIN':               f'https://localhost:3000,https://{ip}:3000',
    'APP_URL':                   'https://localhost:3000',
}

s = open(path).read()
for k, v in updates.items():
    if re.search(rf'^{k}=', s, re.M):
        s = re.sub(rf'^{k}=.*$', f'{k}={v}', s, flags=re.M)
    else:
        s = s.rstrip('\n') + f'\n{k}={v}\n'
open(path, 'w').write(s)
print('.env.local 갱신 완료')
PY

echo
echo "폰에서 접속할 주소:  https://$IP:3000"
echo "폰에 CA를 아직 설치하지 않았다면 이 파일을 전송해 설치하세요:"
echo "  $(mkcert -CAROOT)/rootCA.pem"
