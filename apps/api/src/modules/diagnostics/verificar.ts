/**
 * Las comprobaciones del verificador de credenciales.
 *
 * El punto de entrada esta en src/cli/verificar-credenciales.ts, y esta
 * separacion no es decorativa: `env.ts` se niega a cargar si en produccion
 * falta una variable obligatoria, y el modulo que la importa se cae al
 * importarse. Si todo viviera en el entry, el operador que le falta una
 * variable —justo el que mas necesita este informe— recibiria un stack trace de
 * Node en vez de una linea que diga cual falta.
 *
 * **Por que existe, si cada proveedor ya tiene `describeConfiguration()`:**
 * porque eso solo dice que las variables estan puestas, y una variable puesta
 * con un valor equivocado se ve exactamente igual que una correcta. Un token de
 * prueba en produccion, un dominio sin verificar en Resend, un bucket que
 * acepta la subida y devuelve 403 al leerla: los tres pasan el chequeo de
 * configuracion y los tres se descubren con un cliente adentro.
 *
 * Asi que cada comprobacion hace el viaje completo: habla con el servicio, y en
 * el caso del almacenamiento sube un archivo, lo lee por la URL publica —que es
 * la que termina en el celular del comensal— y lo borra.
 *
 * Lo que NO hace: cobrar. Una transaccion real hay que hacerla a mano una vez,
 * y esta en docs/LANZAMIENTO.md.
 */
import { Redis } from 'ioredis';

import { env } from '../../env.js';
import { getMailer } from '../mail/index.js';
import { getPaymentProvider } from '../payments/provider.js';
import { getProveedor3D } from '../modelado/index.js';
import { getStorage } from '../storage/index.js';
import { prisma } from '../../prisma.js';

type Nivel = 'ok' | 'aviso' | 'error';

interface Linea {
  nivel: Nivel;
  texto: string;
  /** Que hacer. Obligatorio cuando el nivel no es `ok`: un fallo sin arreglo no sirve. */
  arreglo?: string;
}

interface Chequeo {
  titulo: string;
  lineas: Linea[];
}

const ok = (texto: string): Linea => ({ nivel: 'ok', texto });
const aviso = (texto: string, arreglo: string): Linea => ({ nivel: 'aviso', texto, arreglo });
const error = (texto: string, arreglo: string): Linea => ({ nivel: 'error', texto, arreglo });

/**
 * El motivo de un fallo, en UNA linea.
 *
 * Prisma devuelve seis lineas con saltos y sangria para decir "no conecta", y
 * pegadas tal cual convierten un informe que se lee de un vistazo en un muro.
 * Lo que importa de un fallo es la primera linea util y que haya un arreglo
 * debajo; el detalle completo lo da el servicio cuando se lo busca aparte.
 */
function motivo(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  const primera = texto
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.endsWith(':'));
  const linea = primera ?? texto.trim().split('\n')[0] ?? 'sin detalle';
  return linea.length > 160 ? `${linea.slice(0, 157)}...` : linea;
}

/**
 * PNG de 1x1 valido, que es lo que se sube como sonda.
 *
 * Tiene que ser una de las extensiones de la carta (ver ASSET_KEY): el driver
 * se niega a borrar cualquier otra, en silencio.
 */
const PNG_DE_UN_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/** Tiempo maximo para cada llamada: un servicio colgado no cuelga el chequeo. */
const TIMEOUT_MS = 15_000;

async function conTimeout<T>(promesa: Promise<T>, que: string): Promise<T> {
  const reloj = new Promise<never>((_, rechazar) =>
    setTimeout(() => rechazar(new Error(`${que} no respondio en ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS),
  );
  return Promise.race([promesa, reloj]);
}

// ----------------------------------------------------------------- base

async function verificarBase(): Promise<Chequeo> {
  const lineas: Linea[] = [];
  try {
    await conTimeout(prisma.$queryRaw`SELECT 1`, 'la base');
    lineas.push(ok('conecta'));

    // Las migraciones aplicadas, medidas por algo que solo existe si corrieron.
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'men3d_unaccent'
      ) AS existe
    `;
    lineas.push(
      filas[0]?.existe
        ? ok('las migraciones estan aplicadas')
        : error(
            'falta men3d_unaccent: las migraciones no corrieron',
            'npm run db:deploy (y despues npm run db:plans:prod)',
          ),
    );

    // Sin planes, quien se registra queda sin suscripcion y con los pedidos
    // deshabilitados. Es el fallo que no se nota hasta el primer alta.
    const planes = await prisma.plan.count();
    lineas.push(
      planes > 0
        ? ok(`catalogo de planes cargado (${planes})`)
        : error(
            'la tabla Plan esta vacia',
            'npm run db:plans:prod — sin planes, un restaurante nuevo estrena su carta con los pedidos deshabilitados',
          ),
    );
  } catch (e) {
    lineas.push(error(`no conecta: ${motivo(e)}`, 'revisa DATABASE_URL y que el servidor este levantado'));
  }
  return { titulo: 'Base de datos', lineas };
}

// ------------------------------------------------------------ mercadopago

interface CuentaMercadoPago {
  nickname?: string;
  site_id?: string;
  email?: string;
}

async function verificarPagos(): Promise<Chequeo> {
  const lineas: Linea[] = [];
  const provider = getPaymentProvider();

  if (provider.name !== 'mercadopago') {
    lineas.push(aviso(`la pasarela configurada es "${provider.name}"`, 'este chequeo solo sabe hablar con MercadoPago'));
    return { titulo: 'Pagos', lineas };
  }

  // Variable por variable, y no recorriendo `config.missing`: esa lista mezcla
  // lo obligatorio con lo opcional —el driver mete ahi el secreto del webhook,
  // que no impide cobrar— y tratarla toda como error da rojos falsos. Un
  // verificador que grita por algo que esta bien se deja de leer.
  if (!env.PUBLIC_API_URL) {
    lineas.push(error('falta PUBLIC_API_URL', 'sin ella no se puede armar la URL de avisos: ver docs/DEPLOY.md § Pagos'));
  }

  const token = env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    lineas.push(error('falta MERCADOPAGO_ACCESS_TOKEN', 'ver docs/DEPLOY.md § Pagos'));
    return { titulo: 'Pagos (MercadoPago)', lineas };
  }

  // El error mas caro del despliegue: quedarse con el token de prueba. Los
  // cobros "funcionan" y no entra un peso.
  if (token.startsWith('TEST-')) {
    lineas.push(
      env.NODE_ENV === 'production'
        ? error(
            'el token es de PRUEBA (TEST-) y esto es produccion',
            'cambialo por el de produccion en el panel de MercadoPago: con este token nadie te paga de verdad',
          )
        : aviso('el token es de prueba (TEST-)', 'correcto para desarrollo; en produccion hay que cambiarlo'),
    );
  } else {
    lineas.push(ok('el token es de produccion'));
  }

  try {
    const respuesta = await conTimeout(
      fetch('https://api.mercadopago.com/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      'MercadoPago',
    );
    if (!respuesta.ok) {
      lineas.push(
        error(
          `MercadoPago rechazo el token (HTTP ${respuesta.status})`,
          'el token no sirve o fue revocado: generá uno nuevo en el panel',
        ),
      );
    } else {
      const cuenta = (await respuesta.json()) as CuentaMercadoPago;
      lineas.push(
        ok(
          `el token sirve — cuenta ${cuenta.nickname ?? cuenta.email ?? '(sin nombre)'}` +
            (cuenta.site_id ? `, pais ${cuenta.site_id}` : ''),
        ),
      );
    }
  } catch (e) {
    lineas.push(error(`no pude hablar con MercadoPago: ${motivo(e)}`, 'revisa la salida a internet del servidor'));
  }

  lineas.push(
    env.MERCADOPAGO_WEBHOOK_SECRET
      ? ok('la firma de los avisos se verifica')
      : error(
          'falta MERCADOPAGO_WEBHOOK_SECRET',
          'sin esto cualquiera puede avisar que un pedido se pago: la API no puede distinguir un aviso legitimo',
        ),
  );

  // Esto no se puede verificar desde aca: hay que cargarlo en el panel. Se
  // imprime para poder comparar de un vistazo.
  if (env.PUBLIC_API_URL) {
    const url = new URL('/api/payments/webhook/mercadopago', env.PUBLIC_API_URL).toString();
    lineas.push(aviso(`la URL de avisos tiene que ser ${url}`, 'cargala en el panel de MercadoPago y compará que sea exactamente esa'));
  }

  return { titulo: 'Pagos (MercadoPago)', lineas };
}

// ----------------------------------------------------------------- correo

interface DominiosResend {
  data?: { name: string; status: string }[];
}

async function verificarCorreo(enviarA?: string): Promise<Chequeo> {
  const lineas: Linea[] = [];
  const mailer = getMailer();

  if (mailer.name === 'log') {
    lineas.push(
      env.NODE_ENV === 'production'
        ? error(
            'MAIL_DRIVER=log en produccion: no se envia NINGUN correo',
            'ponelo en resend — sin esto nadie puede recuperar su contraseña ni recibe la confirmacion de su pedido',
          )
        : aviso('MAIL_DRIVER=log', 'correcto para desarrollo: los correos salen por la consola'),
    );
    return { titulo: 'Correo', lineas };
  }

  if (!env.MAIL_FROM) {
    lineas.push(error('falta MAIL_FROM', 'ver docs/DEPLOY.md § Correo transaccional'));
  }
  if (!env.RESEND_API_KEY) {
    lineas.push(error('falta RESEND_API_KEY', 'ver docs/DEPLOY.md § Correo transaccional'));
    return { titulo: 'Correo (Resend)', lineas };
  }

  try {
    const respuesta = await conTimeout(
      fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      }),
      'Resend',
    );
    if (!respuesta.ok) {
      lineas.push(
        error(
          `Resend rechazo la clave (HTTP ${respuesta.status})`,
          'generá una nueva en resend.com y actualizá RESEND_API_KEY',
        ),
      );
    } else {
      const { data } = (await respuesta.json()) as DominiosResend;
      const dominios = data ?? [];
      lineas.push(ok(`la clave sirve — ${dominios.length} dominio(s) en la cuenta`));

      // El fallo clasico: la clave sirve, el dominio del remitente no esta
      // verificado, y cada envio se rechaza con un 403 que nadie mira.
      const remitente = env.MAIL_FROM ?? '';
      const dominioDelRemitente = remitente.includes('@')
        ? remitente.split('@').pop()?.replace(/>$/, '').trim().toLowerCase()
        : undefined;

      if (!dominioDelRemitente) {
        lineas.push(aviso(`no pude leer el dominio de MAIL_FROM ("${remitente}")`, 'tiene que ser "Nombre <correo@dominio>" o "correo@dominio"'));
      } else {
        const encontrado = dominios.find((d) => d.name.toLowerCase() === dominioDelRemitente);
        if (!encontrado) {
          lineas.push(
            error(
              `el dominio del remitente (${dominioDelRemitente}) no esta en la cuenta de Resend`,
              'agregalo y verificalo en resend.com/domains: si no, cada correo se rechaza',
            ),
          );
        } else if (encontrado.status !== 'verified') {
          lineas.push(
            error(
              `el dominio ${dominioDelRemitente} esta en estado "${encontrado.status}"`,
              'completá los registros DNS que pide Resend hasta que quede "verified"',
            ),
          );
        } else {
          lineas.push(ok(`el dominio del remitente (${dominioDelRemitente}) esta verificado`));
        }
      }
    }
  } catch (e) {
    lineas.push(error(`no pude hablar con Resend: ${motivo(e)}`, 'revisa la salida a internet del servidor'));
  }

  if (enviarA) {
    try {
      await conTimeout(
        mailer.send({
          to: enviarA,
          subject: 'Men-3D: prueba de configuracion',
          text:
            'Si estas leyendo esto, el correo transaccional de Men-3D funciona:\n' +
            'la clave sirve, el dominio del remitente esta verificado y el envio sale.\n\n' +
            'Lo mando el verificador de credenciales (npm run verificar).',
        }),
        'el envio de prueba',
      );
      lineas.push(ok(`envio de prueba despachado a ${enviarA} — revisa que llegue, y revisa el spam`));
    } catch (e) {
      lineas.push(error(`el envio de prueba fallo: ${motivo(e)}`, 'el detalle de arriba dice por donde empezar'));
    }
  } else {
    lineas.push(aviso('no se envio ningun correo de prueba', 'agregá --enviar-a tu@correo para mandar uno de verdad'));
  }

  return { titulo: 'Correo (Resend)', lineas };
}

// --------------------------------------------------------- almacenamiento

async function verificarAlmacenamiento(): Promise<Chequeo> {
  const lineas: Linea[] = [];
  const storage = getStorage();

  if (storage.name === 'local') {
    lineas.push(
      env.NODE_ENV === 'production'
        ? error(
            'STORAGE_DRIVER=local en produccion',
            'cada modelo 3D pasa por Node y el disco se borra al recrear el contenedor: pasá a s3',
          )
        : aviso('STORAGE_DRIVER=local', 'correcto para desarrollo'),
    );
    return { titulo: 'Almacenamiento', lineas };
  }

  const config = storage.describeConfiguration();
  if (!config.ready) {
    // `missing` del driver incluye el CDN, que es opcional: aca se piden solo
    // las tres sin las que no se puede subir nada.
    for (const falta of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      if (config.missing.includes(falta)) {
        lineas.push(error(`falta ${falta}`, 'ver docs/DEPLOY.md § Almacenamiento'));
      }
    }
    return { titulo: 'Almacenamiento (s3)', lineas };
  }

  // El CDN no impide nada: sin el, los modelos salen del bucket sin cache de
  // borde. Es un aviso, no un error.
  if (!env.CDN_PUBLIC_URL) {
    lineas.push(
      aviso(
        'sin CDN: los modelos 3D se sirven desde el bucket',
        'funciona, pero cada comensal se baja el GLB desde la region del bucket. Con CDN_PUBLIC_URL sale desde el borde',
      ),
    );
  }

  // El viaje completo, igual que lo hace el backoffice: pedir el permiso,
  // subir con la URL firmada, leer por la URL publica y borrar.
  let key: string | null = null;
  try {
    // Un PNG de 1x1 de verdad, y no un .txt: `remove()` valida la clave contra
    // ASSET_KEY —que solo acepta las extensiones de la carta— y con una
    // extension ajena NO BORRA Y NO AVISA. La primera version de esto usaba
    // .txt, dejaba el archivo de prueba en el bucket en cada corrida e
    // informaba que lo habia borrado.
    const contenido = PNG_DE_UN_PIXEL;
    const ticket = await conTimeout(
      storage.createUploadTicket({ extension: 'png', contentType: 'image/png' }),
      'la firma de subida',
    );
    key = ticket.key;
    lineas.push(ok('el bucket firma permisos de subida'));

    const subida = await conTimeout(
      fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: contenido }),
      'la subida al bucket',
    );
    if (!subida.ok) {
      lineas.push(
        error(
          `la subida con URL firmada fallo (HTTP ${subida.status})`,
          'las credenciales no tienen permiso de escritura en el bucket, o la region/endpoint no son los correctos',
        ),
      );
    } else {
      lineas.push(ok('la subida directa al bucket funciona'));

      // Esta es la que se rompe en silencio: el bucket acepta el archivo y
      // despues no deja leerlo. El comensal ve un plato sin modelo.
      const lectura = await conTimeout(fetch(ticket.publicUrl), 'la URL publica');
      if (!lectura.ok) {
        lineas.push(
          error(
            `la URL publica devuelve HTTP ${lectura.status} (${ticket.publicUrl})`,
            'el bucket acepta la subida pero no deja leerla: habilitá la lectura publica o revisá el CDN de S3_CDN_PUBLIC_URL. Sin esto, el comensal ve la carta sin modelos 3D',
          ),
        );
      } else {
        const vuelto = Buffer.from(await lectura.arrayBuffer());
        lineas.push(
          vuelto.equals(contenido)
            ? ok('la URL publica sirve el archivo, byte por byte')
            : error('la URL publica devuelve otro contenido', 'revisá si el CDN tiene cache de una version anterior'),
        );
      }
    }
  } catch (e) {
    lineas.push(error(`el viaje al bucket fallo: ${motivo(e)}`, 'revisa S3_ENDPOINT, S3_REGION y las credenciales'));
  } finally {
    if (key) {
      try {
        await storage.remove(key);
        // Se comprueba el EFECTO, no que no haya lanzado: `remove()` puede ser
        // un no-op silencioso. Se lee del origen y no de la URL publica, para
        // que el cache del CDN no haga parecer que quedo cuando ya no esta.
        const sigue = await storage.read(key);
        if (sigue) {
          sigue.stream.destroy();
          lineas.push(
            error(
              `el archivo de prueba ${key} sigue en el bucket`,
              'las credenciales no tienen permiso de borrado: borralo a mano y revisá la politica, porque los modelos reemplazados tampoco se van a borrar',
            ),
          );
        } else {
          lineas.push(ok('y el borrado tambien (no quedo basura en el bucket)'));
        }
      } catch (e) {
        lineas.push(
          aviso(
            `no pude borrar el archivo de prueba ${key}: ${motivo(e)}`,
            'borralo a mano; probablemente las credenciales no tengan permiso de borrado',
          ),
        );
      }
    }
  }

  return { titulo: 'Almacenamiento (s3)', lineas };
}

// ------------------------------------------------------------------ redis

async function verificarRedis(): Promise<Chequeo> {
  const lineas: Linea[] = [];
  if (!env.REDIS_URL) {
    lineas.push(
      aviso(
        'sin REDIS_URL: el bus del KDS vive en memoria',
        'alcanza con UNA sola instancia de la API. Con mas de una es obligatorio, y el fallo es mudo: una pantalla de cocina conectada a otra instancia nunca recibe los pedidos',
      ),
    );
    return { titulo: 'Redis', lineas };
  }

  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await conTimeout(redis.connect(), 'Redis');
    const pong = await conTimeout(redis.ping(), 'el ping de Redis');
    lineas.push(pong === 'PONG' ? ok('conecta y responde') : aviso(`respondio "${pong}"`, 'esperaba PONG'));
  } catch (e) {
    lineas.push(error(`no conecta: ${motivo(e)}`, 'revisa REDIS_URL y que el servidor este levantado'));
  } finally {
    redis.disconnect();
  }
  return { titulo: 'Redis', lineas };
}

// ------------------------------------------------------------ foto a 3D

/**
 * El generador de modelos 3D.
 *
 * Se comprueba por el saldo y no generando un modelo de prueba: generar uno
 * cuesta creditos, y un verificador que gasta plata cada vez que se corre no lo
 * corre nadie. El saldo prueba las dos cosas que importan —que la clave es
 * valida y que alcanza para el proximo plato—, que son justo las dos que fallan
 * en silencio: una clave vencida y una cuenta sin creditos dan exactamente el
 * mismo sintoma que todo bien, hasta que un restaurante saca una foto.
 */
async function verificarModelado(): Promise<Chequeo> {
  const lineas: Linea[] = [];
  const proveedor = getProveedor3D();

  if (proveedor.nombre === 'none') {
    lineas.push(
      aviso(
        'sin generador de modelos 3D (MODEL3D_PROVIDER=none)',
        'no rompe nada: los platos se cargan subiendo un GLB hecho aparte, que es gratis. Para que el restaurante pueda sacarle una foto al plato hay que contratar un proveedor y poner MODEL3D_PROVIDER y su clave (ver docs/DEPLOY.md)',
      ),
    );
    return { titulo: 'Modelos 3D desde foto', lineas };
  }

  try {
    const r = await conTimeout(proveedor.comprobar(), `el proveedor ${proveedor.nombre}`);
    lineas.push(
      r.ok
        ? ok(`${proveedor.nombre}: ${r.detalle}`)
        : error(
            `${proveedor.nombre}: ${r.detalle}`,
            'revisa la clave y el saldo en el panel del proveedor. Sin esto, el boton de "sacale una foto al plato" falla recien cuando un restaurante lo usa',
          ),
    );
  } catch (e) {
    lineas.push(
      error(
        `${proveedor.nombre}: ${motivo(e)}`,
        'revisa la clave y que el servicio sea alcanzable desde este servidor',
      ),
    );
  }
  return { titulo: 'Modelos 3D desde foto', lineas };
}

// ----------------------------------------------------------------- salida

function imprimir(chequeo: Chequeo): void {
  console.log(`\n${chequeo.titulo}`);
  for (const linea of chequeo.lineas) {
    const marca = linea.nivel === 'ok' ? '  ok ' : linea.nivel === 'aviso' ? '  !  ' : '  NO ';
    console.log(`${marca} ${linea.texto}`);
    if (linea.arreglo) console.log(`       → ${linea.arreglo}`);
  }
}

/**
 * Corre todo y lo imprime. Devuelve cuantos errores hubo, que es lo que el
 * entry convierte en codigo de salida.
 */
export async function verificarCredenciales(enviarA?: string): Promise<number> {
  console.log(`Verificando credenciales — NODE_ENV=${env.NODE_ENV}`);

  const chequeos = [
    await verificarBase(),
    await verificarPagos(),
    await verificarCorreo(enviarA),
    await verificarAlmacenamiento(),
    await verificarModelado(),
    await verificarRedis(),
  ];

  for (const chequeo of chequeos) imprimir(chequeo);

  const todas = chequeos.flatMap((c) => c.lineas);
  const errores = todas.filter((l) => l.nivel === 'error').length;
  const avisos = todas.filter((l) => l.nivel === 'aviso').length;

  console.log(
    `\n${errores === 0 ? 'Sin errores' : `${errores} error(es)`}` +
      `${avisos > 0 ? `, ${avisos} aviso(s)` : ''}.`,
  );
  if (errores > 0) {
    console.log('Los errores de arriba son cosas que no van a funcionar, no advertencias.');
  }

  await prisma.$disconnect();
  return errores;
}
