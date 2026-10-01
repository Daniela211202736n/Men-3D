# Esquema de base de datos

Definición ejecutable: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

## Portabilidad: SQLite en desarrollo, PostgreSQL en producción

El MVP usa **SQLite** para que `npm run setup` deje todo andando sin instalar
nada. El esquema evita a propósito todo lo que no es portable —enums nativos,
arrays, columnas `Json`— así que pasar a PostgreSQL es cambiar una línea:

```prisma
datasource db {
  provider = "postgresql"   // antes: "sqlite"
  url      = env("DATABASE_URL")
}
```

Dos consecuencias de esa decisión, documentadas donde importan:

- **Los enums viajan como `String`.** El vocabulario válido vive en
  `@men3d/shared` (`OrderStatus`, `Allergen`, `DietTag`…) y se valida con zod en
  el borde. En PostgreSQL se pueden promover a enums nativos sin tocar el código.
- **Las listas cortas se guardan separadas por comas** (`enabledLocales`,
  `serviceModes`, `features`). `lib/lists.ts` es el único archivo que conoce ese
  detalle; en PostgreSQL pasan a `text[]` cambiando solo ese archivo.

Un detalle más al migrar: en SQLite `contains` se traduce a `LIKE`, que ya ignora
mayúsculas en ASCII. En PostgreSQL hay que agregar `mode: 'insensitive'` en
`buildDishWhere()` —o, mejor, un índice trigram para búsqueda difusa.

## Mapa de tablas

```
Plan ──< Subscription >── Tenant ──┬──< User
                                   ├──< Branding (1-1)
                                   ├──< Category ──< Dish
                                   │                  ├──< DishAllergen
                                   │                  ├──< DishDietTag
                                   │                  ├──< DishIngredient
                                   │                  ├──< DishTranslation
                                   │                  └──< Pairing
                                   ├──< Review
                                   ├──< Order ──< OrderItem
                                   │        └──< Payment (1-1)
                                   ├──< AnalyticsEvent
                                   ├──< LoyaltyAccount ──< LoyaltyLedger
                                   └──< QrCode
```

Toda tabla de negocio lleva `tenantId`. Es la columna de aislamiento y la primera
de casi todos los índices.

---

## Plataforma y cuentas

### `Plan`

El catálogo comercial: `tier` (FREE/STARTER/PRO/ENTERPRISE), `monthlyCents`,
`setupFeeCents` (el cobro único de configuración inicial), los límites
`maxDishes` y `max3dModels` (0 = sin límite) y `features` como lista separada por
comas.

### `Tenant`

El restaurante, raíz del aislamiento. Agrupa su identidad (`slug` para la URL
pública `/m/:slug`), contacto, geolocalización (`latitude`, `longitude`,
`googlePlaceId`), redes sociales, y su operación: `currency`, `defaultLocale`
(el idioma en que se carga la carta, que es el texto origen de las traducciones),
`enabledLocales`, `taxRateBps` (IVA en *basis points*: 2100 = 21 %) y
`serviceModes`.

### `Branding` (1-1 con Tenant)

Logo, favicon, portada, fondo, colores y tipografía. El frontend los aplica sobre
variables de CSS, así que cambian la apariencia sin tocar el layout.

### `Subscription` (1-1) y `User`

La suscripción vincula tenant y plan con su estado y fechas. `User` es una cuenta
del backoffice con rol `OWNER | ADMIN | STAFF | SUPPORT`; el email es único a
nivel plataforma.

---

## La carta

### `Category` y `Dish`

`position` ordena; el dueño lo cambia arrastrando. `Dish` guarda el precio en
**centavos enteros** (`priceCents`) —nunca punto flotante para dinero—, el
`compareAtPriceCents` tachado de las promociones, las URLs del `modelGlbUrl` y
del `modelUsdzUrl`, y los datos que deciden la compra: `portionGrams`,
`calories`, `prepMinutes`.

Dos banderas de operación diaria: `isAvailable` (agotado hoy) e `isFeatured`
(subir en la carta).

**La baja es lógica** (`archivedAt`). Borrar de verdad un plato se llevaría
puestos los pedidos históricos y la analítica que lo referencian.

### `DishAllergen`, `DishDietTag`, `DishIngredient`

Tablas de unión, una fila por valor, con índice propio: así el filtro "sin
lactosa" es una consulta indexada y no un `LIKE` sobre una lista.

`DishAllergen.mayContain` distingue "contiene" de "puede contener trazas". **El
filtro excluye las dos**: ante una alergia, las trazas importan.

### `DishTranslation` y `CategoryTranslation`

Una fila por `(plato, idioma)` con `source: MANUAL | AUTO`. Lo corregido a mano
queda `MANUAL` y la traducción automática no lo vuelve a pisar.

### `Pairing`

Maridaje curado por el restaurante: `dishId` → `suggestedDishId` con `weight`
(0..100) y un `blurb` opcional. Es solo una de las tres señales del recomendador;
las otras dos se calculan (ver ARCHITECTURE.md §7).

---

## Reseñas

### `Review`

`dishId` nulo significa reseña general del local. `status` (`PENDING |
PUBLISHED | HIDDEN`) permite moderar, y `reply` guarda la respuesta pública del
restaurante. `guestId` sirve para evitar duplicados y **nunca sale en la API**.

Los promedios no se guardan: se calculan con un `groupBy` por tenant que resuelve
toda la carta en una consulta, en vez de una por plato.

---

## Pedidos

### `Order`

`code` es el identificador corto que el comensal canta en el mostrador ("A7F3"),
único por tenant, generado con un alfabeto sin caracteres ambiguos (sin 0/O ni
1/I). Guarda los cuatro importes desglosados y las marcas de tiempo `acceptedAt`
y `readyAt`, que son las que permiten medir el tiempo de cocina.

Ciclo de vida, con transiciones validadas en el servidor:

```
DRAFT → PENDING_PAYMENT → PAID → IN_KITCHEN → READY → SERVED
            ↓               ↓        ↓
         CANCELED ──────────┴────────┘
```

Un intento de retroceder (por ejemplo `READY → PAID`, típico de una pantalla
desincronizada) devuelve `409 CONFLICT`.

### `OrderItem`

Congela `nameSnapshot` y `unitPriceCents` al momento del pedido. Si mañana cambia
la carta, el histórico y los informes siguen siendo fieles a lo que realmente se
vendió y a qué precio.

### `Payment` (1-1 con Order)

`provider`, `providerRef`, `status` y el `rawPayload` serializado de la pasarela
para auditoría.

---

## Analítica

### `AnalyticsEvent`

Una fila por interacción: `type`, `dishId` opcional, `sessionId`, `durationMs`
(tiempo con el modelo 3D en pantalla), `query` (sólo en búsquedas) y `value`
(campo numérico genérico: cantidad de resultados, unidades agregadas…).

Índices pensados para los tres informes que existen:

| Índice | Sirve para |
| --- | --- |
| `(tenantId, createdAt)` | el rango de fechas del panel |
| `(tenantId, type, createdAt)` | totales y embudo |
| `(tenantId, dishId, type)` | la tabla de interés visual contra ventas |
| `(sessionId)` | reconstruir una visita |

Es una tabla de sólo-escritura en caliente. Para escalarla, ver ARCHITECTURE.md §6.

---

## Fidelidad

### `LoyaltyAccount` y `LoyaltyLedger`

El saldo **nunca se escribe a mano**: se asienta un movimiento en el libro mayor
y el saldo se actualiza en la misma transacción.

`LoyaltyLedger.dedupeKey` es la clave de idempotencia, con unicidad
`(accountId, dedupeKey)`. Es lo que evita que recargar la pantalla diez veces
acredite diez veces los puntos por ver un plato, o que un webhook repetido pague
dos veces el mismo pedido (`dedupeKey = "order:<id>"`).

Reglas por defecto (configurables): 1 punto por unidad monetaria gastada, 20 por
reseña, 1 por ver un plato (una vez por sesión); 100 puntos = 1 unidad monetaria
de descuento, es decir 1 % de devolución.

---

## QR

### `QrCode`

Un QR por mesa, con `token` corto url-safe y contadores `scans` / `lastScanAt`.
El menú abre con la mesa ya identificada (`/m/:slug?t=<token>&mesa=5`), así el
pedido entra sabiendo de dónde viene y el dueño ve qué mesas realmente usan el
menú digital.

---

## Decisiones transversales

| Decisión | Motivo |
| --- | --- |
| Dinero en centavos enteros | Elimina de raíz los errores de redondeo del punto flotante. El formateo a texto ocurre sólo en el borde de presentación. |
| Impuestos en *basis points* | 2100 en vez de 0.21: entero exacto, sin decimales que arrastren error. |
| Baja lógica en `Dish` | Preserva pedidos históricos y analítica. |
| Snapshot de nombre y precio en `OrderItem` | El histórico no se reescribe cuando cambia la carta. |
| `cuid()` como clave | No revela volumen de negocio (un id secuencial sí: `/orders/1234` dice cuántos pedidos van). |
| `onDelete: Cascade` desde `Tenant` | Dar de baja un restaurante limpia todo lo suyo en una operación. |
| `onDelete: Restrict` en `Dish` desde `OrderItem` | Impide borrar un plato que figura en un pedido. |
