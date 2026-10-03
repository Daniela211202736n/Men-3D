#!/usr/bin/env bash
#
# Restauracion de un respaldo de Men-3D.
#
#   ./scripts/restore.sh backups/men3d-20261001-120000.dump postgresql://.../men3d_prueba
#   ./scripts/restore.sh backups/ultimo.dump                 (usa DATABASE_URL, pide confirmacion)
#
# El segundo argumento es el destino. Si falta, se usa DATABASE_URL —y entonces
# se pide confirmacion escrita, porque restaurar encima de la base en uso borra
# lo que haya.
set -euo pipefail

cd "$(dirname "$0")/.."

ARCHIVO="${1:-}"
if [[ -z "$ARCHIVO" || ! -f "$ARCHIVO" ]]; then
  echo "Uso: $0 <archivo.dump> [DATABASE_URL destino]" >&2
  echo "Respaldos disponibles:" >&2
  ls -1t backups/men3d-*.dump 2>/dev/null | head -5 >&2 || echo "  (ninguno)" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" && -f apps/api/.env ]]; then
  DATABASE_URL="$(grep -m1 '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"'"'"'')"
fi

DESTINO="${2:-${DATABASE_URL:-}}"
if [[ -z "$DESTINO" ]]; then
  echo "Falta el destino: pasalo como segundo argumento o define DATABASE_URL." >&2
  exit 1
fi
DESTINO="${DESTINO%%\?*}"

# Restaurar encima de la base en uso es destructivo. Si el destino es el mismo
# que DATABASE_URL, se pide confirmacion escrita: un error de tipeo no alcanza
# para borrar la carta de un cliente.
BASE_ACTUAL="${DATABASE_URL:-}"
BASE_ACTUAL="${BASE_ACTUAL%%\?*}"
if [[ "$DESTINO" == "$BASE_ACTUAL" && "${RESTORE_FORCE:-}" != "si" ]]; then
  echo "El destino es la base en uso: $(sed 's|://[^@]*@|://***@|' <<<"$DESTINO")"
  echo "Esto BORRA lo que haya ahi y lo reemplaza por el respaldo."
  read -r -p 'Escribi "restaurar" para seguir: ' RESPUESTA
  [[ "$RESPUESTA" == "restaurar" ]] || { echo "Cancelado."; exit 1; }
fi

version_mayor() { "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }
SERVIDOR="$(psql "$DESTINO" -tAc 'SHOW server_version' 2>/dev/null | grep -oE '^[0-9]+' || true)"
if [[ -z "$SERVIDOR" ]]; then
  echo "No puedo conectarme al destino." >&2
  exit 1
fi

LOCAL="$(version_mayor pg_restore || true)"
if [[ -n "$LOCAL" && "$LOCAL" -ge "$SERVIDOR" ]]; then
  restaurar() { pg_restore "$@"; }
elif docker compose ps --status running postgres 2>/dev/null | grep -q postgres; then
  echo "pg_restore local es ${LOCAL:-ninguno} y el servidor es $SERVIDOR: uso el del contenedor."
  restaurar() { docker compose exec -T postgres pg_restore "$@"; }
elif docker info >/dev/null 2>&1; then
  # Ver la nota equivalente en backup.sh. `-i` porque el volcado entra por la
  # entrada estandar.
  echo "pg_restore local es ${LOCAL:-ninguno} y el servidor es $SERVIDOR: uso un contenedor postgres:$SERVIDOR-alpine."
  restaurar() { docker run --rm -i --network host "postgres:$SERVIDOR-alpine" pg_restore "$@"; }
else
  echo "pg_restore local es ${LOCAL:-ninguno}, el servidor es $SERVIDOR." >&2
  echo "Instala postgresql-client-$SERVIDOR, o levanta docker." >&2
  exit 1
fi

# `--clean --if-exists` deja la base como estaba en el respaldo en vez de
# mezclar. Los avisos de objetos que no existian son normales en una base
# vacia, asi que no se trata el codigo de salida como fatal sin mirar: lo que
# decide es la comprobacion de abajo.
set +e
restaurar --clean --if-exists --no-owner --no-privileges --dbname "$DESTINO" < "$ARCHIVO" 2>/tmp/men3d-restore.log
CODIGO=$?
set -e

# Un respaldo que no se restaura no es un respaldo: se comprueba que haya datos.
PLATOS="$(psql "$DESTINO" -tAc 'SELECT count(*) FROM "Dish"' 2>/dev/null || echo 0)"
if [[ "${PLATOS:-0}" -eq 0 ]]; then
  echo "La restauracion no dejo datos. Detalle:" >&2
  tail -20 /tmp/men3d-restore.log >&2
  exit 1
fi

echo "Restaurado en $(sed 's|://[^@]*@|://***@|' <<<"$DESTINO"): $PLATOS platos."
if [[ $CODIGO -ne 0 ]]; then
  echo "(pg_restore devolvio $CODIGO; suele ser por objetos que no existian. Detalle en /tmp/men3d-restore.log)"
fi
