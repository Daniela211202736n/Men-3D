/**
 * Respaldo y restauracion.
 *
 * Un respaldo que nunca se restauro no es un respaldo: es un archivo. Esta
 * prueba corre los scripts de verdad —`scripts/backup.sh` y
 * `scripts/restore.sh`— contra la base real, restaura en una base limpia y
 * comprueba que lo que llego es lo que habia.
 *
 * Lo que verifica, mas alla de los datos:
 *
 *  - La URL de Prisma trae `?schema=public`, que pg_dump rechaza. Un script que
 *    pasa $DATABASE_URL tal cual falla, y es el primer tropiezo de cualquiera.
 *  - `men3d_unaccent()` y los indices GIN tienen que viajar en el volcado. Si
 *    no, la base restaurada arranca y la busqueda queda rota en silencio, que
 *    es la peor forma de descubrirlo: despues de un desastre.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { prisma } from '../src/prisma.js';
import { deleteTenantsBySlug } from '../src/modules/tenants/service.js';

const RAIZ = new URL('../../..', import.meta.url).pathname;
const BASE_PRUEBA = `men3d_restore_${Date.now()}`;
const SLUG = `respaldo-${Date.now()}`;
const PLATO = 'Ñoquis con tilde y eñe';

/** URL sin los parametros que le agrega Prisma. */
function urlLimpia(): string {
  const url = process.env.DATABASE_URL;
  assert.ok(url, 'falta DATABASE_URL');
  return url.split('?')[0]!;
}

function urlDe(base: string): string {
  const u = new URL(urlLimpia());
  u.pathname = `/${base}`;
  return u.toString();
}

function psql(url: string, sql: string): string {
  return execFileSync('psql', [url, '-tAc', sql], { encoding: 'utf8' }).trim();
}

function correr(script: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(join(RAIZ, 'scripts', script), args, {
    encoding: 'utf8',
    cwd: RAIZ,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let carpeta: string;

before(async () => {
  // Un restaurante propio como marcador. Comparar totales de la base no sirve:
  // `node --test` corre los archivos en paralelo, asi que otras pruebas crean y
  // borran restaurantes entre el volcado y la comparacion. Lo que tiene que
  // sobrevivir al respaldo es un dato concreto, no un numero que se mueve solo.
  const tenant = await prisma.tenant.create({
    data: { slug: SLUG, name: 'Respaldo', defaultLocale: 'es' },
  });
  const category = await prisma.category.create({
    data: { tenantId: tenant.id, name: 'Unica', position: 0 },
  });
  await prisma.dish.create({
    data: {
      tenantId: tenant.id,
      categoryId: category.id,
      name: PLATO,
      description: 'Con acentos, para ver que la codificacion viaja bien.',
      priceCents: 123_456,
      position: 0,
    },
  });

  // Fuera del repo: el respaldo de una prueba no es un entregable.
  carpeta = mkdtempSync(join(tmpdir(), 'men3d-backup-'));
  psql(urlDe('postgres'), `DROP DATABASE IF EXISTS "${BASE_PRUEBA}"`);
  psql(urlDe('postgres'), `CREATE DATABASE "${BASE_PRUEBA}"`);
});

after(async () => {
  await deleteTenantsBySlug([SLUG]);
  psql(urlDe('postgres'), `DROP DATABASE IF EXISTS "${BASE_PRUEBA}"`);
  rmSync(carpeta, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe('respaldo y restauracion', () => {
  let archivo: string;

  it('el respaldo produce un archivo con contenido', () => {
    const salida = correr('backup.sh', [], { BACKUP_DIR: carpeta });
    const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.dump'));
    assert.equal(archivos.length, 1, `esperaba un volcado, hay ${archivos.length}`);
    archivo = join(carpeta, archivos[0]!);
    assert.match(salida, /Respaldo:/);
  });

  it('la restauracion trae los datos que habia', () => {
    correr('restore.sh', [archivo, urlDe(BASE_PRUEBA)]);

    // El restaurante marcador, con su plato y su precio exacto.
    const nombre = psql(
      urlDe(BASE_PRUEBA),
      `SELECT name FROM "Tenant" WHERE slug = '${SLUG}'`,
    );
    assert.equal(nombre, 'Respaldo', 'el restaurante no llego al respaldo');

    const plato = psql(
      urlDe(BASE_PRUEBA),
      `SELECT d.name || '|' || d."priceCents" FROM "Dish" d
       JOIN "Tenant" t ON t.id = d."tenantId" WHERE t.slug = '${SLUG}'`,
    );
    // Los acentos y la eñe tambien: una restauracion con la codificacion mal
    // deja la carta ilegible sin que falle nada.
    assert.equal(plato, `${PLATO}|123456`);

    // Y la base restaurada tiene las tablas del esquema completo, no solo esas.
    const tablas = psql(
      urlDe(BASE_PRUEBA),
      "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    );
    assert.ok(Number(tablas) >= 19, `solo ${tablas} tablas en la base restaurada`);
  });

  it('la busqueda sin tildes sigue funcionando en la base restaurada', () => {
    // Si `men3d_unaccent` no viajara en el volcado, la base levantaria igual y
    // la busqueda fallaria recien cuando alguien la usara.
    assert.equal(psql(urlDe(BASE_PRUEBA), "SELECT men3d_unaccent('Café Ñandú')"), 'cafe nandu');

    const indices = psql(
      urlDe(BASE_PRUEBA),
      "SELECT count(*) FROM pg_indexes WHERE indexname LIKE '%sin_tildes%'",
    );
    assert.equal(indices, '4', 'faltan indices GIN en la base restaurada');
  });

  it('la rotacion conserva solo las copias pedidas', () => {
    // Tres respaldos mas, con tope de dos.
    for (let i = 0; i < 3; i += 1) {
      correr('backup.sh', [], { BACKUP_DIR: carpeta, BACKUP_KEEP: '2' });
    }
    const quedan = readdirSync(carpeta).filter((f) => f.endsWith('.dump'));
    assert.equal(quedan.length, 2, `quedaron ${quedan.length} copias en vez de 2`);
  });

  it('restaurar pide confirmacion si el destino es la base en uso', () => {
    // Sin destino explicito usa DATABASE_URL, y ahi tiene que frenar: un error
    // de tipeo no puede borrar la carta de un cliente.
    let fallo = false;
    try {
      execFileSync(join(RAIZ, 'scripts', 'restore.sh'), [archivo], {
        cwd: RAIZ,
        encoding: 'utf8',
        input: 'no\n',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      fallo = true;
    }
    assert.ok(fallo, 'restauro sobre la base en uso sin confirmacion');

    // Y la base en uso quedo intacta.
    assert.ok(Number(psql(urlLimpia(), 'SELECT count(*) FROM "Dish"')) > 0);
  });
});
