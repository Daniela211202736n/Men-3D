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

### Pagos

Ver [PAYMENTS.md](PAYMENTS.md).

---

## Migraciones

**No se aplican al arrancar la API.** Con varias réplicas, todas competirían por
migrar la misma base. Es un paso aparte que termina:

```bash
npm run db:deploy          # = prisma migrate deploy
```

En `docker-compose.apps.yml` eso es el servicio `api-migrate`, y la API espera a
que haya terminado con éxito. En plataformas con *release command* (Fly, Render,
Railway) se configura ahí; la imagen de la API trae el CLI de Prisma justamente
para poder hacerlo.

Crear una migración nueva durante el desarrollo:

```bash
npm run db:migrate -- --name lo-que-cambiaste
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

Dos sondas que dicen qué falta, nunca qué hay:

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

- **El KDS no escala horizontalmente.** El bus de eventos es en memoria, así que
  con más de una réplica de la API una pantalla de cocina solo recibe los
  pedidos que entraron por *su* réplica. Hace falta Redis pub/sub; el resto del
  código solo conoce `publish` y `subscribe`.
- **No hay CSP.** `<model-viewer>` necesita WebAssembly y workers, y una política
  mal ajustada rompe el visor 3D en silencio. Hay que armarla midiendo.
- **Backups.** PostgreSQL gestionado los trae; si lo corrés vos, hace falta
  `pg_dump` programado y una restauración probada.
