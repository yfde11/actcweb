#!/bin/sh
# 產生 Caddy 使用的自簽 TLS 憑證（含 IP SAN），供內網 https://IP/ 使用。
# 用法：CADDY_TLS_IP=192.168.1.156 ./scripts/init-caddy-certs.sh
# 或：./scripts/init-caddy-certs.sh 192.168.1.156
set -e
IP="${1:-${CADDY_TLS_IP:-192.168.1.156}}"
DIR="${CADDY_CERT_DIR:-./caddy-certs}"
mkdir -p "$DIR"
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout "$DIR/key.pem" \
  -out "$DIR/cert.pem" \
  -subj "/CN=${IP}" \
  -addext "subjectAltName=IP:${IP}"
echo "已寫入 $DIR/cert.pem 與 key.pem（CN/SAN=${IP}）。請 docker compose up -d 重載 Caddy。"
