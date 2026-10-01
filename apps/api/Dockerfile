# syntax=docker/dockerfile:1
#
# Imagen de la API. Multi-etapa: las dependencias de desarrollo y el codigo
# fuente se quedan en la etapa de compilacion y no viajan a produccion.
#
# Se construye desde la RAIZ del monorepo, no desde esta carpeta:
#   docker build -f apps/api/Dockerfile -t men3d-api .

# ---------------------------------------------------------------- base
# Alpine: imagen chica y ya trae libssl3 y los certificados raiz, que es todo lo
# que el motor de Prisma necesita. El `binaryTarget` musl correspondiente esta
# declarado en prisma/schema.prisma — sin eso el motor no arranca aca dentro.
FROM node:22-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# -------------------------------------------------------- dependencias
FROM base AS deps
# Solo los manifiestos primero: mientras no cambien, esta capa se reutiliza y
# `npm ci` no se vuelve a ejecutar.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
# Redes que interceptan TLS (proxies corporativos) presentan su propio
# certificado y npm falla al verificarlo. Pasando el CA como secreto de
# compilacion, npm lo usa; sin pasarlo, esta linea no hace nada:
#   docker build --secret id=ca_bundle,src=/ruta/al/ca.crt ...
RUN --mount=type=secret,id=ca_bundle,target=/tmp/ca-bundle.crt \
    if [ -f /tmp/ca-bundle.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/ca-bundle.crt; fi; \
    npm ci --workspace @men3d/shared --workspace @men3d/api --include-workspace-root

# ---------------------------------------------------------- compilacion
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# `npm run ... -w` en vez de `npx`: el binario de prisma vive en el
# node_modules del workspace, no en el de la raiz, y npx intentaria descargarlo.
# El CA vuelve a montarse porque prisma puede bajar su motor de consultas.
RUN --mount=type=secret,id=ca_bundle,target=/tmp/ca-bundle.crt \
    if [ -f /tmp/ca-bundle.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/ca-bundle.crt; fi; \
    npm run build -w @men3d/shared \
    && npm run db:generate -w @men3d/api \
    && npm run build -w @men3d/api

# ------------------------------------------------------ poda de dev deps
# Encadenado despues de `build` a proposito: dos `npm ci` en etapas
# independientes corren en paralelo y npm falla con "Exit handler never called".
# Podar lo ya instalado evita la segunda instalacion por completo.
FROM build AS prod-deps
RUN --mount=type=secret,id=ca_bundle,target=/tmp/ca-bundle.crt \
    if [ -f /tmp/ca-bundle.crt ]; then export NODE_EXTRA_CA_CERTS=/tmp/ca-bundle.crt; fi; \
    npm prune --omit=dev && npm cache clean --force

# ------------------------------------------------------------ runtime
FROM base AS runtime
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
# Los dos node_modules: npm hoistea casi todo a la raiz, pero deja los
# binarios de cada workspace en el suyo (apps/api/node_modules/.bin/prisma es
# el que aplica las migraciones).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
# El esquema y las migraciones viajan con la imagen: son lo que `migrate deploy`
# aplica antes de arrancar.
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

# Usuario sin privilegios: la imagen de node ya trae `node` (uid 1000).
RUN mkdir -p /app/apps/api/storage && chown -R node:node /app/apps/api/storage
USER node

WORKDIR /app/apps/api
EXPOSE 4000

# Sonda: una API que responde pero no llega a la base no esta sana, y /health
# consulta la base a proposito.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
