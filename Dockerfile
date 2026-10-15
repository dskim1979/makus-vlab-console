# vlab-proxy: the console's static build served by nginx, which also terminates TLS and
# passes /api (and the VNC websocket under it) to vlab-engine. docs: deploy/README.md

FROM node:20.18.1-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27.3-alpine
RUN apk add --no-cache openssl
COPY deploy/nginx/vlab.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/10-vlab-cert.sh /docker-entrypoint.d/10-vlab-cert.sh
RUN chmod +x /docker-entrypoint.d/10-vlab-cert.sh && mkdir -p /etc/vlab/tls
COPY --from=build /src/dist /usr/share/nginx/html
COPY NOTICE.md /usr/share/nginx/html/NOTICE.md
EXPOSE 80 443
