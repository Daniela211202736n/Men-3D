# Referencia de la API

Base: `http://localhost:4000`. Todo es JSON salvo las descargas de QR.

## Autenticación

El backoffice usa JWT (`Authorization: Bearer <token>`, 12 h). Las rutas públicas
de la carta no requieren autenticación: el restaurante se resuelve por el slug de
la URL.

## Forma de los errores

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos enviados no son validos",
    "details": [{ "path": "items.0.quantity", "message": "minimo 1" }]
  }
}
```

| Código HTTP | Cuándo |
| --- | --- |
| 400 | Petición inválida con un motivo de negocio (`DISH_UNAVAILABLE`, `ORDERING_DISABLED`) |
| 401 | Falta el token, está vencido o el usuario fue dado de baja |
| 403 | El rol o el plan no habilitan la acción (incluye el motivo) |
| 404 | No existe **o no pertenece a tu restaurante** |
| 409 | Conflicto de estado (transición de pedido inválida, slug tomado) |
| 422 | Falló la validación del esquema |
| 429 | Límite de tasa (20 / 5 min en auth, 300 / min en el resto) |
| 501 | Proveedor de pagos no implementado |
| 502 | No se pudo hablar con la pasarela de pagos (la notificación se reintenta) |
| 503 | Falta configuración (pasarela sin credenciales, IA sin clave) |

---

## Salud

```
GET  /health
```

## Autenticación

```
POST /api/auth/register           alta de restaurante + dueño (14 días de Pro)
POST /api/auth/login              → { token, user, plan }
GET  /api/auth/me                 rehidrata la sesión   🔒
POST /api/auth/forgot-password    { email }        manda el enlace de recuperación
POST /api/auth/reset-password     { token, password }
POST /api/auth/change-password    { currentPassword, newPassword }   🔒
```

`forgot-password` responde siempre `{ ok: true }`, exista o no la cuenta: la
respuesta no puede servir para averiguar qué correos están registrados. El token
del enlace se guarda hasheado (SHA-256), vence en una hora y sirve una sola vez;
cualquier token vencido, usado o inexistente devuelve el mismo
`RESET_TOKEN_INVALID`, así que probar enlaces al azar no enseña nada.

## Carta pública — `/api/public/:slug`

```
GET  /venue                              datos del local, marca y features
GET  /menu                               carta con búsqueda y filtros
GET  /dishes/:dishId                     ficha de un plato
GET  /dishes/:dishId/pairings            maridajes sugeridos
GET  /reviews?dishId=                    opiniones (del plato o del local)
POST /reviews                            dejar una opinión
POST /events                             lote de eventos de analítica → 202
POST /scan                               contar el escaneo de un QR → 204
GET  /loyalty?guestId=                   saldo de puntos
POST /orders                             crear pedido y cobrar
GET  /orders/:code                       seguimiento por código corto
```

`POST /orders` devuelve `{ order, checkoutUrl, clientSecret }`. Con una pasarela
con redirección (MercadoPago) el pedido queda en `PENDING_PAYMENT` y hay que
mandar al comensal a `checkoutUrl`; lo pagado lo confirma el webhook.

### `GET /menu`

| Parámetro | Ejemplo | Qué hace |
| --- | --- | --- |
| `q` | `milanesa` | Busca en nombre, descripción, ingredientes y traducciones |
| `categoryId` | `cmx…` | Una categoría |
| `diets` | `VEGAN,GLUTEN_FREE` | El plato debe cumplir **todas** |
| `excludeAllergens` | `MILK,NUTS` | Excluye los que declaren cualquiera, trazas incluidas |
| `only3d` | `true` | Solo platos con modelo 3D |
| `locale` | `en` | Idioma de los textos |
| `sessionId` | `s-ab12…` | Registra la búsqueda con su cantidad de resultados |

Responde `{ venue, categories, dishes, locale, matchCount }`.

---

## Backoffice — `/api/admin` 🔒

El `tenantId` sale siempre del token, nunca de la petición.

### Carta

```
GET    /categories                 POST   /categories
PATCH  /categories/:id             DELETE /categories/:id
PUT    /categories/order           { ids: [...] }

GET    /dishes?includeArchived=    POST   /dishes
PATCH  /dishes/:id                 DELETE /dishes/:id        baja lógica
POST   /dishes/:id/restore
PATCH  /dishes/:id/price           { priceCents }            cambio en el momento
PATCH  /dishes/:id/availability    { isAvailable }
PUT    /dishes/order               { ids: [...] }

GET    /dishes/:id/pairings        POST   /dishes/:id/pairings
DELETE /pairings/:pairingId
```

### Equipo

```
GET    /users                      POST   /users        { name, email, password, role }
PATCH  /users/:id                  { name?, role?, isActive? }
DELETE /users/:id                  baja lógica (desactivar)
POST   /users/:id/transfer-ownership
```

Solo OWNER y ADMIN entran acá. El servidor además impide: cambiarse el rol a uno
mismo, desactivarse a uno mismo, dejar el local sin ningún OWNER activo, y que un
ADMIN toque a un OWNER. El alta solo crea `ADMIN` o `STAFF`; el único camino a
OWNER es `transfer-ownership`, que intercambia los dos roles en una transacción
—nunca quedan dos dueños ni ninguno.

### Local, marca y plan

```
GET /venue      PATCH /venue
GET /branding   PATCH /branding        requiere CUSTOM_BRANDING
GET /plan       PUT   /plan            solo OWNER
GET /plans
```

### Operación

```
GET   /orders?status=&limit=
GET   /kds/board                        columnas del tablero
PATCH /orders/:id/status                transiciones validadas
POST  /kds/ticket                       ticket de 60 s para el stream
GET   /kds/stream?ticket=…              SSE (se autentica con el ticket)
GET   /reviews?status=
PATCH /reviews/:id                      { status, reply }
```

El stream emite `order.created` y `order.updated` con el pedido completo, más un
comentario de latido cada 25 segundos.

### Métricas, QR y traducción

```
GET /analytics?days=30                  requiere ADVANCED_ANALYTICS
GET /analytics/qr                       escaneos por mesa
GET /qr?tables=1,2,3
GET /qr/download?format=pdf&tables=&perPage=4
GET /share                              enlaces de WhatsApp y mail
GET /translations/:locale
POST /translations                      { targetLocale, overwrite }  requiere AUTO_TRANSLATION
PUT  /translations/:dishId/:locale      corrección manual (queda MANUAL)
```

`POST /translations` responde `503 AI_NOT_CONFIGURED` con un mensaje claro si no
hay `ANTHROPIC_API_KEY`, en vez de fallar de forma rara.

## Webhooks de pago

```
POST /api/payments/webhook/:provider          notificación de la pasarela
GET  /api/payments/webhook/:provider/health   estado de configuración
```

Rutas públicas: las autentica la firma de la notificación, no un token. El
código de respuesta decide si la pasarela reintenta — ver
[PAYMENTS.md](PAYMENTS.md).

## Archivos

```
POST /api/admin/assets/upload-ticket  🔒  permiso de subida
POST /upload                          🔒  multipart (driver `local`)
GET  /media/:name                         solo nombres generados por el servidor
GET  /api/admin/assets/health         🔒  estado del almacenamiento
```

El backoffice pide primero un permiso de subida y manda el archivo a donde ese
permiso indique: a la API (driver `local`) o directo al bucket con una URL
firmada (driver `s3`), sin pasar por el servidor. Ver [DEPLOY.md](DEPLOY.md).

---

## Ejemplo completo

```bash
# 1. Buscar
curl "localhost:4000/api/public/la-parrilla-de-don-pepe/menu?q=milanesa"

# 2. Pedir
curl -X POST "localhost:4000/api/public/la-parrilla-de-don-pepe/orders" \
  -H 'content-type: application/json' \
  -d '{"items":[{"dishId":"<id>","quantity":2}],"tableLabel":"5","guestId":"g-abc123def456"}'

# 3. Entrar al backoffice
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"pepe@donpepe.demo","password":"men3d-demo-2026"}' | jq -r .token)

# 4. Métricas
curl "localhost:4000/api/admin/analytics?days=30" -H "authorization: Bearer $TOKEN"

# 5. QR de las mesas 1 a 4, listo para imprimir
curl "localhost:4000/api/admin/qr/download?format=pdf&tables=1,2,3,4" \
  -H "authorization: Bearer $TOKEN" -o qr-mesas.pdf
```
