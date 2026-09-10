#!/usr/bin/env bash
# EC2를 정지했다 켜면 **공개 IPv4가 바뀐다** (IPv6는 유지된다).
# 부팅할 때마다 DNS를 현재 주소로 맞춘다. 안 하면 도메인이 죽은 IP를
# 가리키고, Caddy의 인증서 갱신(HTTP-01)까지 같이 실패한다.
set -euo pipefail

TOKEN=$(cat /etc/duckdns.token)
DOMAIN="${DUCKDNS_DOMAIN:-livestream-mvp}"

TOK=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
IPV4=$(curl -s -H "X-aws-ec2-metadata-token: $TOK" \
  http://169.254.169.254/latest/meta-data/public-ipv4)
IPV6=$(curl -s -H "X-aws-ec2-metadata-token: $TOK" \
  http://169.254.169.254/latest/meta-data/ipv6 || true)

curl -s "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=${IPV4}&ipv6=${IPV6}"
echo " <- duckdns ${DOMAIN} -> ${IPV4} / ${IPV6}"
