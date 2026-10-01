# syntax=docker/dockerfile:1
#
# Imagen de la PWA: se compila con Node y se sirve con nginx. El resultado es
# estatico, asi que la imagen final no lleva Node ni nada ejecutable.
#
#   docker build -f apps/web/Dockerfile -t men3d-web .

# ---------------------------------------------------------- compilacion
FROM node:22-alpine AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Ver la nota sobre `ca_bundle` en apps/api/Dockerfile.

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=secret,id=ca_bundle,target=/tmp/ca-bundle.crt \
    if [ -f /tmp/ca-bundle.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/ca-bundle.crt; fi; \
    npm ci --workspace @men3d/shared --workspace @men3d/web --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
COPY scripts ./scripts

# Los modelos 3D de ejemplo se generan en la compilacion: son parte de la carta
# de demostracion y no tiene sentido versionar binarios.
RUN node scripts/generate-sample-models.mjs \
    && npm run build -w @men3d/shared \
    && npm run build -w @men3d/web

# ------------------------------------------------------------- runtime
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
