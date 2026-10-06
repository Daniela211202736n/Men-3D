# Despliegue

La aplicación son dos imágenes y dos servicios externos:

```
          ┌──────────────────┐
  :80/443 │  web  (nginx)    │  PWA estática + proxy de /api hacia la API
          │                  │  Mismo origen: la PWA no necesita CORS
          └────────┬─────────┘
                   │ /api, /upload, /media
          ┌────────▼─────────┐
    :4000 │  api  (Node)     │
          └───┬──────────┬───┘
              │          │
     ┌────────▼──┐   ┌───▼──────────────┐
     │ PostgreSQL│   │ Bucket + CDN      │  modelos 3D e imágenes
     └───────────┘   └──────────────────┘
```

---

## Probarlo entero en local

```bash
CA_BUNDLE_FILE=/dev/null \
  docker compose -f docker-compose.yml -f docker-compose.apps.yml up -d --build
npm run db:seed          # datos de demostración
```

La PWA queda en <http://localhost:8080> con la API detrás del mismo origen.

Para el día a día conviene el modo normal (`docker compose up -d` solo para la
base, y `npm run dev`): recarga en caliente y arranque instantáneo.

---

## Construir las imágenes

Las dos se construyen **desde la raíz del repositorio**, no desde su carpeta:

```bash
docker build -f apps/api/Dockerfile -t men3d-api:$(git rev-parse --short HEAD) .
docker build -f apps/web/Dockerfile -t men3d-web:$(git rev-parse --short HEAD) .
```

Tamaños: API ~490 MB (incluye el motor de Prisma y su CLI, que es lo que aplica
las migraciones), PWA ~105 MB (nginx + estáticos).

### Si tu red intercepta TLS

En redes corporativas con proxy que reemplaza los certificados, `npm ci` falla
dentro del contenedor. Los dos Dockerfiles aceptan el CA como secreto opcional:

```bash
docker build --secret id=ca_bundle,src=/ruta/al/ca.crt -f apps/api/Dockerfile -t men3d-api .
```

Sin pasarlo, la línea no hace nada.

---

## Variables de entorno

### Obligatorias en producción

| Variable | Qué es |
| --- | --- |
| `DATABASE_URL` | `postgresql://usuario:clave@host:5432/base?schema=public` |
| `JWT_SECRET` | Mínimo 32 caracteres. **La API se niega a arrancar con el valor de desarrollo.** |
| `PUBLIC_WEB_URL` | Dominio público de la PWA. Se usa en los QR y en las vueltas del pago. |
| `PUBLIC_API_URL` | Dominio público de la API. MercadoPago notifica ahí. |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma. |

### Almacenamiento

| Variable | Valor |
| --- | --- |
| `STORAGE_DRIVER` | `s3` en producción |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credenciales del bucket |
| `S3_REGION` | `auto` para R2; la región real para AWS |
| `S3_ENDPOINT` | Solo para R2, Spaces o MinIO. Vacío = AWS S3. |
| `S3_FORCE_PATH_STYLE` | `true` para R2 y MinIO |
| `CDN_PUBLIC_URL` | Dominio del CDN. Es la URL que termina cargando el celular del comensal. |

Con `STORAGE_DRIVER=local` en producción la API avisa por consola: los modelos
se sirven desde Node (lento en 4G) y viven en el disco del contenedor, así que
se pierden al recrearlo.

### Límites

| Variable | Valor |
| --- | --- |
| `AUTH_RATE_LIMIT_MAX` | Intentos de autenticación por IP cada 5 minutos (por defecto 20) |
| `REVOCATION_RATE_LIMIT_MAX` | Pedidos del botón de arrepentimiento por IP cada 10 minutos (por defecto 5) |

Cubre login, registro y recuperación de contraseña. El valor por defecto frena
la fuerza bruta sin molestar a nadie, con una salvedad: el límite es **por IP**,
y todo el equipo de un local sale por el mismo wifi. En un restaurante con
mucho personal que entra al mismo tiempo —un cambio de turno— conviene subirlo.

### Correo transaccional

| Variable | Valor |
| --- | --- |
| `MAIL_DRIVER` | `resend` en producción; `log` solo en desarrollo |
| `MAIL_FROM` | Remitente, en un dominio verificado en Resend |
| `RESEND_API_KEY` | Clave de la API de Resend |
| `LEGAL_EMAIL` | Casilla que recibe los pedidos del botón de arrepentimiento |

**`LEGAL_EMAIL` conviene definirla.** La Res. 424/2020 obliga a informarle al
consumidor su código de revocación dentro de las 24 horas, y eso lo hace el
sistema solo —en pantalla y por correo—. Pero *honrar* la revocación, es decir
dar de baja y reintegrar, lo hace una persona, y sin esta casilla nadie se
entera de que hay un pedido esperando: queda guardado en la tabla
`RevocationRequest` y el aviso se escribe en el log. Ver
[legal/README.md](legal/README.md).

Con `MAIL_DRIVER=log` la API no envía nada: imprime el correo entero en la
consola. En desarrollo eso es lo cómodo —el enlace de recuperación sale listo
para copiar— pero en producción significa que **nadie puede recuperar su
contraseña**, así que cada correo no enviado queda registrado con una
advertencia explícita en el log.

La API no arranca con `MAIL_DRIVER=resend` si falta `RESEND_API_KEY` o
`MAIL_FROM`: es mejor que falle al desplegar que al primer cliente que se
olvide la clave.

El enlace del correo se construye sobre `PUBLIC_WEB_URL`, así que si esa
variable está mal, los enlaces llegan apuntando a ninguna parte.

### Modelos 3D a partir de una foto

| Variable | Valor |
| --- | --- |
| `MODEL3D_PROVIDER` | `none` (por defecto) o `meshy` |
| `MESHY_API_KEY` | Clave de la API de Meshy, si se usa ese proveedor |
| `MESHY_AI_MODEL` | Versión del modelo: `latest` (por defecto), `meshy-6`, `meshy-5` |

Con esto configurado, el restaurante le saca una foto al plato desde el panel y
el modelo 3D aparece solo un par de minutos después. Sin esto, la función no se
ofrece y los platos se cargan subiendo un GLB hecho aparte, que es el camino que
no cuesta nada.

**Esto cuesta plata por uso.** Cada modelo generado consume créditos del
proveedor —del orden de 20 a 30 por plato, que a los precios de hoy son unos
20 a 30 centavos de dólar—. Son pocos centavos por plato, pero una carta de
sesenta platos generada dos veces ya es una cifra, y el botón está en un
celular dentro de un restaurante. Por eso hay tres frenos y conviene conocerlos:

1. La función está detrás de la *feature* `PHOTO_TO_3D`, que no incluye el plan
   gratis.
2. Un plato no puede tener dos modelos generándose a la vez. El guard es un
   índice único parcial en la base (`ModelJob_uno_en_curso_por_plato`), no un
   `if`: dos toques del botón no pueden cobrar dos veces.
3. La ruta tiene su propio límite, más duro que el general de la API: 12 fotos
   por hora y por IP.

**El alta de la feature no es automática en una base ya desplegada.** Las
*features* de cada plan viven en la tabla `Plan`, así que después de migrar hay
que volver a aplicar el catálogo:

```bash
npm run db:plans:prod
```

Sin eso, el panel le dice a todos los restaurantes que la función no está en su
plan.

**La alternativa gratis, que para muchos casos da mejor resultado.** Un celular
moderno escanea un objeto real mucho mejor de lo que cualquier modelo reconstruye
desde una sola foto: aplicaciones como Polycam o Scaniverse —y Object Capture en
iPhone— generan un GLB dando una vuelta alrededor del plato. Ese archivo se sube
desde el mismo editor y no consume créditos de nadie. La foto única es para
cuando hay sesenta platos y poco tiempo; el escaneo, para los cinco platos que
venden.

### Pagos

Ver [PAYMENTS.md](PAYMENTS.md).

---

## Migraciones

**No se aplican al arrancar la API.** Con varias réplicas, todas competirían por
migrar la misma base. Es un paso aparte que termina:

```bash
npm run db:deploy          # = prisma migrate deploy
npm run db:plans:prod      # el catálogo de planes
```

**Los dos pasos, no sólo el primero.** El catálogo de planes (FREE, STARTER,
PRO, ENTERPRISE) es dato de referencia, no de demostración: vive en
`apps/api/src/modules/plans/catalogo.ts` y una base recién migrada no lo tiene.
Sin planes, quien se registra queda sin suscripción y le aparece la carta con
los pedidos deshabilitados. Es idempotente, así que corre en cada despliegue y
de paso actualiza precios y topes si los cambiaste. La variante `:prod` corre
con `node` sobre `dist`, porque la imagen de producción no lleva `tsx`; en
desarrollo es `npm run db:plans`.

En `docker-compose.apps.yml` eso es el servicio `api-migrate`, que corre los dos
pasos, y la API espera a que haya terminado con éxito. En plataformas con *release command* (Fly, Render,
Railway) se configura ahí; la imagen de la API trae el CLI de Prisma justamente
para poder hacerlo.

Crear una migración nueva durante el desarrollo:

```bash
npm run db:migrate -- --name lo-que-cambiaste
```

---

## Varias instancias de la API

Con **una** instancia no hace falta nada. Apenas hay **dos**, `REDIS_URL` deja
de ser opcional.

| Variable | Valor |
| --- | --- |
| `REDIS_URL` | `redis://host:6379`. Vacío = bus en memoria (una sola instancia) |

El bus que empuja los pedidos a la pantalla de cocina (SSE) vive en memoria por
defecto. Con dos instancias detrás de un balanceador, el mozo carga el pedido
contra una y la pantalla de cocina está conectada a la otra: **el pedido se
guarda bien, la API responde bien, y la cocina nunca se entera.** No hay error,
ni en el log ni en pantalla; el pedido aparece cuando alguien va a preguntar.
Es el peor tipo de fallo que puede tener un KDS.

Con `REDIS_URL` el bus pasa a Redis pub/sub, un canal por restaurante.

Detalles que importan si hay que tocarlo:

- **Dos conexiones, no una.** Una conexión suscrita a Redis entra en modo
  suscriptor y deja de aceptar otros comandos: con una sola, el primer
  `publish` después de un `subscribe` falla.
- **Publicar no espera.** El flujo del pedido no puede quedar colgado ni fallar
  porque el bus falle: el pedido ya está guardado en PostgreSQL y esa es la
  verdad. Si Redis no responde se pierde el aviso y se registra; la pantalla
  recupera el estado al reconectar, que es lo que hace al abrirse.
- **Redis caído no tumba la API.** La carta, los pedidos y el backoffice siguen
  funcionando; lo único que se degrada es el refresco en vivo del KDS.

El stream es SSE, así que el balanceador no puede cortar conexiones largas ni
acumularlas en un buffer. Para nginx está resuelto en `apps/web/nginx.conf`
(`proxy_buffering off`); con otro balanceador hay que configurar lo mismo.

---

## Política de seguridad de contenido (CSP)

Está puesta en `apps/web/nginx.conf`, y **se midió contra la aplicación real**
en lugar de copiarla: se cargaron la carta, el visor 3D, la ficha del local y
las siete pantallas del backoffice con la cabecera puesta, escuchando
`securitypolicyviolation`, hasta no quedar ninguna.

Lo que justifica cada directiva poco obvia:

| Directiva | Por qué |
| --- | --- |
| `'wasm-unsafe-eval'` | `<model-viewer>` compila WebAssembly para decodificar la malla |
| `blob:` en `worker-src` e `img-src` | Los workers de decodificación y las texturas |
| `'unsafe-inline'` **solo** en `style-src` | React escribe los estilos como atributo `style`. No habilita scripts |
| `frame-src openstreetmap.org` | El mapa del local es un iframe suyo |

Un detalle medido que conviene saber: **sin `'wasm-unsafe-eval'` el visor no se
rompe**, cae a un decodificador en JavaScript. Lo que deja es una violación
(`script-src ← wasm-eval`) en la consola cada vez que alguien abre un plato, y
un decodeo más lento en el celular. Es justo el tipo de degradación que no se
nota probando a mano.

**Si se agrega una fuente externa** —una tipografía, un pixel de analítica, un
widget— hay que volver a medir. El síntoma de no hacerlo es un recurso que no
carga sin ningún error visible para el usuario.

---

## Respaldos

Un respaldo que nunca se restauró no es un respaldo: es un archivo. Por eso hay
dos scripts y una prueba que los corre de punta a punta
(`apps/api/test/backup.test.ts`): respalda, restaura en una base limpia y
compara.

```bash
./scripts/backup.sh                       # a ./backups, conserva 14 copias
BACKUP_DIR=/mnt/backups BACKUP_KEEP=30 ./scripts/backup.sh

./scripts/restore.sh backups/men3d-20261001-120000.dump postgresql://.../destino
```

El volcado va en formato `custom` de PostgreSQL: comprimido, y permite
restaurar tablas sueltas.

**Dos cosas que hacen fallar a cualquier script de respaldo escrito a las
apuradas**, y que estos resuelven:

1. **La URL de Prisma lleva `?schema=public`.** `pg_dump` la rechaza con
   `invalid URI query parameter`. Pasar `$DATABASE_URL` tal cual no funciona.
2. **`pg_dump` se niega a volcar un servidor más nuevo que él.** Si tu cliente
   es 16 y el servidor 17, no hay respaldo. El script lo comprueba antes de
   escribir nada y busca el cliente correcto por su cuenta: primero el local,
   si sirve; si no, el del contenedor de `docker compose`; y si tampoco —un
   servidor de verdad, o la integración continua— un contenedor descartable
   `postgres:<versión>-alpine`, que trae el cliente de la misma versión mayor
   que el servidor. Sólo se rinde si no hay ninguno de los tres, y entonces te
   dice qué paquete instalar.

Restaurar encima de la base en uso pide confirmación escrita. Un error de
tipeo no puede borrar la carta de un cliente.

### Automatizarlo

Un respaldo diario a las 3:30, con los últimos 30 días:

```cron
30 3 * * * cd /ruta/a/men-3d && BACKUP_DIR=/mnt/backups BACKUP_KEEP=30 ./scripts/backup.sh >> /var/log/men3d-backup.log 2>&1
```

**El respaldo tiene que salir de la máquina.** Una copia en el mismo disco que
la base no sobrevive a lo que más probablemente pase: que se pierda esa
máquina. Sincronizá `BACKUP_DIR` a un bucket:

```bash
aws s3 sync /mnt/backups s3://tu-bucket-respaldos/men3d/ --delete
```

### Lo que el volcado NO incluye

Los modelos 3D y las imágenes. Con `STORAGE_DRIVER=s3` viven en el bucket, y
ahí lo que corresponde es **activar versionado en el bucket**, que protege
también del borrado accidental. Con `STORAGE_DRIVER=local` están en el disco
del contenedor y se pierden al recrearlo: una razón más para no usar `local` en
producción.

### Probar la restauración, de verdad

Agendá restaurar un respaldo en una base descartable cada tanto. La prueba
automatizada cubre el mecanismo; lo que no cubre es que el respaldo de **ayer**
en **tu** servidor sea bueno.

---

## Extensiones de PostgreSQL

La primera migración ejecuta `CREATE EXTENSION unaccent` y `pg_trgm`, que son
lo que hace que la búsqueda ignore tildes. **Si el usuario de la base no puede
crearlas, el despliegue falla ahí.**

En PostgreSQL 13 y posteriores las dos son *trusted*, así que al dueño de la
base le alcanza. En un servicio administrado puede no alcanzar:

- **RDS, Cloud SQL, Azure**: hay que habilitarlas desde el panel o con un
  usuario con permisos, una sola vez.
- **Supabase, Neon, Railway**: vienen disponibles; se crean solas.
- **Alguno más restringido**: pedile al proveedor que las habilite, o corré
  `CREATE EXTENSION` a mano con un usuario con permisos antes de migrar.

Comprobarlo antes de desplegar es un comando:

```bash
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

---

## El bucket y el CDN

El bucket necesita **lectura pública** (los modelos los pide el navegador del
comensal directo al CDN) y **CORS** para aceptar la subida firmada desde el
backoffice:

```json
[
  {
    "AllowedOrigins": ["https://tu-dominio.com"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type", "Cache-Control"],
    "MaxAgeSeconds": 3000
  }
]
```

Los `AllowedHeaders` no son opcionales: la URL firmada incluye `Content-Type` y
`Cache-Control`, y si el navegador no puede enviarlos, el bucket rechaza la
subida.

Los objetos se guardan con `Cache-Control: public, max-age=31536000, immutable`.
Es seguro porque el nombre es un hash aleatorio que nunca se reutiliza: si un
plato cambia de modelo, cambia la URL.

### Cloudflare R2

```bash
STORAGE_DRIVER=s3
S3_BUCKET=men3d-assets
S3_REGION=auto
S3_ENDPOINT=https://<id-de-cuenta>.r2.cloudflarestorage.com
S3_FORCE_PATH_STYLE=true
CDN_PUBLIC_URL=https://cdn.tu-dominio.com
```

---

## Comprobar que quedó bien configurado

### Un comando, antes de darle la dirección al primer restaurante

```bash
npm run verificar:prod -w @men3d/api          # dentro de la imagen
npm run verificar                             # desde el fuente, en desarrollo
npm run verificar -- --enviar-a vos@dominio   # y manda un correo de prueba
```

**Habla con los servicios de verdad**, que es la diferencia con mirar si las
variables están puestas: una variable con el valor equivocado se ve exactamente
igual que una correcta. Verifica, en este orden:

| Qué | Cómo |
| --- | --- |
| Base de datos | Conecta, las migraciones corrieron y el catálogo de planes está cargado. |
| MercadoPago | Pregunta a su API quién es el dueño del token. Avisa **en rojo** si es un token `TEST-` y `NODE_ENV=production`: con ese token los cobros "funcionan" y no entra un peso. |
| Resend | Valida la clave y comprueba que el dominio de `MAIL_FROM` esté **verificado**, que es el fallo que rechaza cada envío sin que nadie lo mire. |
| Bucket S3 | Hace el viaje completo: firma el permiso, sube con la URL firmada, **lee por la URL pública** —la que termina en el celular del comensal— y borra. Comprueba que el borrado pasó de verdad, no que no haya dado error. |
| Redis | Conecta y responde. |

Lo que **no** hace es cobrar: una transacción real hay que hacerla a mano una
vez, y está en [LANZAMIENTO.md](LANZAMIENTO.md).

Sale con código distinto de cero si algo falla, así que sirve en un pipeline de
despliegue. Los avisos (`!`) no lo hacen fallar: son cosas que funcionan y
conviene saber, como que no haya CDN delante del bucket.

### Las sondas, para un monitor

Dicen qué falta, nunca qué hay:

```bash
curl https://tu-api/api/payments/webhook/mercadopago/health
curl https://tu-api/api/admin/assets/health -H "authorization: Bearer <token>"
```

Y la sonda de vida, que consulta la base a propósito —una API que responde pero
no llega a la base no está sana—:

```bash
curl https://tu-api/health
```

Las dos imágenes traen `HEALTHCHECK`, así que Docker, Compose y los
orquestadores saben solos cuándo un contenedor está listo.

---

## Cosas que no están resueltas

Lo que antes estaba acá —el KDS sin escalar, la falta de CSP y los backups— ya
está hecho y documentado más arriba. Lo que sigue abierto:

- **Los cobros no se probaron contra cuentas reales.** Están verificadas la
  lógica, la firma de los webhooks, la verificación de importes y la
  idempotencia, con pruebas. Lo que falta es una transacción de verdad: ni el
  pago de un pedido, ni el débito mensual, ni el cobro de configuración inicial
  pasaron por una cuenta de MercadoPago real.
- **El driver `s3` tampoco.** Lo verificado es el cableado contra un doble, no
  una integración con AWS o R2.
- **Stripe no está implementado.** Solo MercadoPago y el proveedor simulado.
- **La política de privacidad y los términos no están escritos.** El mecanismo
  está (consentimiento que corta de verdad, exportación y borrado); el texto
  legal lo tiene que escribir alguien que conozca el marco del país donde
  operes.
