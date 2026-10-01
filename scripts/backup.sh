#!/usr/bin/env bash
#
# Respaldo de la base de Men-3D.
#
#   ./scripts/backup.sh                  respalda la base de DATABASE_URL
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#   BACKUP_KEEP=30 ./scripts/backup.sh   conserva 30 copias en vez de 14
#
# Produce un archivo en formato `custom` de PostgreSQL (comprimido, y permite
# restaurar tablas sueltas). Ver docs/DEPLOY.md para la restauracion y para
# como automatizarlo.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${BACKUP_DIR:=backups}"
: "${BACKUP_KEEP:=14}"

# --- la URL -----------------------------------------------------------------
# DATABASE_URL puede venir del entorno o de apps/api/.env.
if [[ -z "${DATABASE_URL:-}" && -f apps/api/.env ]]; then
  DATABASE_URL="$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"'"'"'')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Falta DATABASE_URL (ni en el entorno ni en apps/api/.env)." >&2
  exit 1
fi

# Prisma le agrega parametros propios —`?schema=public`, `connection_limit`— que
# pg_dump rechaza con "invalid URI query parameter". Es el primer tropiezo de
# cualquier script de respaldo que pase $DATABASE_URL tal cual.
URL_LIMPIA="${DATABASE_URL%%\?*}"

# --- el cliente correcto ----------------------------------------------------
# pg_dump se niega a volcar un servidor mas nuevo que el. Un script que no lo
# comprueba "anda" en la maquina de quien lo escribio y no deja nada en el
# servidor de verdad.
version_mayor() { "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }

SERVIDOR="$(psql "$URL_LIMPIA" -tAc 'SHOW server_version' 2>/dev/null | grep -oE '^[0-9]+' || true)"
if [[ -z "$SERVIDOR" ]]; then
  echo "No puedo conectarme a la base. Revisa DATABASE_URL y que el servidor este levantado." >&2
  exit 1
fi

LOCAL="$(version_mayor pg_dump || true)"
if [[ -n "$LOCAL" && "$LOCAL" -ge "$SERVIDOR" ]]; then
  volcar() { pg_dump "$@"; }
elif docker compose ps --status running postgres 2>/dev/null | grep -q postgres; then
  # En desarrollo el cliente que hace falta ya esta dentro del contenedor.
  echo "pg_dump local es ${LOCAL:-ninguno} y el servidor es $SERVIDOR: uso el del contenedor."
  volcar() { docker compose exec -T postgres pg_dump "$@"; }
else
  echo "pg_dump local es ${LOCAL:-ninguno}, el servidor es $SERVIDOR." >&2
  echo "Instala postgresql-client-$SERVIDOR, o levanta el contenedor (docker compose up -d)." >&2
  exit 1
fi

# --- volcado ----------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
ARCHIVO="$BACKUP_DIR/men3d-$(date -u +%Y%m%d-%H%M%S).dump"

volcar --format=custom --no-owner --no-privileges "$URL_LIMPIA" > "$ARCHIVO"

# Un volcado vacio es peor que ninguno: parece que hay respaldo.
if [[ ! -s "$ARCHIVO" ]]; then
  rm -f "$ARCHIVO"
  echo "El volcado salio vacio. No se guardo nada." >&2
  exit 1
fi

echo "Respaldo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# --- rotacion ---------------------------------------------------------------
# Se borran los mas viejos y se deja el ultimo recien hecho.
if [[ "$BACKUP_KEEP" -gt 0 ]]; then
  mapfile -t VIEJOS < <(ls -1t "$BACKUP_DIR"/men3d-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))")
  for v in "${VIEJOS[@]:-}"; do
    # `if` y no `&&`: con `set -e`, un `&&` que falla —y falla cuando no hay
    # nada que rotar— termina el script con error despues de un respaldo bueno.
    if [[ -n "$v" ]]; then
      rm -f "$v"
      echo "  (rotado: $(basename "$v"))"
    fi
  done
fi
