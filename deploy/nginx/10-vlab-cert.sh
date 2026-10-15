#!/bin/sh
# First start without a certificate: make a self-signed one so the console comes up on HTTPS.
# Mount your own as /etc/vlab/tls/tls.crt + tls.key to replace it.
set -e
CRT=/etc/vlab/tls/tls.crt
KEY=/etc/vlab/tls/tls.key
if [ ! -s "$CRT" ] || [ ! -s "$KEY" ]; then
  CN="${VLAB_HOSTNAME:-vlab.local}"
  echo "vlab: no TLS certificate found - creating a self-signed one for ${CN}"
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -subj "/CN=${CN}" -addext "subjectAltName=DNS:${CN}" \
    -keyout "$KEY" -out "$CRT" >/dev/null 2>&1
  chmod 600 "$KEY"
fi
