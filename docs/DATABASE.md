# Esquema de base de datos

Definición ejecutable: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

## PostgreSQL, con migraciones versionadas

`docker compose up -d` levanta una base local; `npm run db:deploy` aplica las
migraciones de `apps/api/prisma/migrations/`.

El esquema evita enums nativos y arrays, y guarda las listas cortas como texto
separado por comas. No es herencia de una base anterior: es lo que mantiene las
migraciones baratas —agregar un valor a un enum nativo bloquea la tabla— y el
vocabulario en un solo lugar, `@men3d/shared`, validado con zod en el borde.

Dos consecuencias de esa decisión, documentadas donde importan:

- **Los enums viajan como `String`.** El vocabulario válido vive en
  `@men3d/shared` (`OrderStatus`, `Allergen`, `DietTag`…) y se valida con zod en
  el borde.
- **Las listas cortas se guardan separadas por comas** (`enabledLocales`,
  `serviceModes`, `features`). `lib/lists.ts` es el único archivo que conoce ese
  detalle.

**La búsqueda ignora mayúsculas y tildes.** La resuelve `buscarIdsDePlatos()`
en SQL crudo, porque Prisma no sabe expresar `unaccent`.

Es la diferencia entre que la carta se pueda buscar y que no. `mode:
'insensitive'` resuelve mayúsculas pero **no tildes**, y en español eso deja
afuera medio vocabulario gastronómico: quien escribe "cafe" en el teclado del
celular —sin tilde, como escribe casi todo el mundo— no encuentra "Café
cortado", y el restaurante nunca se entera de por qué ese plato no se pide. El
problema es fácil de no ver porque los datos de ejemplo solían estar escritos
sin tildes; ahora los llevan a propósito.

`men3d_unaccent()` normaliza los dos lados de la comparación: minúsculas y sin
diacríticos, con la `ñ` plegada a `n`. Es un envoltorio `IMMUTABLE` sobre
`unaccent()` —que de por sí es `STABLE`, y PostgreSQL no indexa expresiones que
no sean inmutables— con el diccionario fijado.

Hay índices GIN de trigramas (`pg_trgm`) sobre esa expresión en el nombre y la
descripción del plato, en los ingredientes y en las traducciones. Sin ellos, un
`LIKE '%texto%'` recorre la tabla entera.

### Si no encuentra nada, busca por parecido

Un comensal escribe rápido en el celular y se come una letra. Sin tolerancia a
eso se queda mirando "no encontramos nada" y concluye que el plato no está.

La búsqueda por parecido **solo corre si la exacta no devolvió nada**. Quien
escribe bien ve el orden que eligió el restaurante —destacados primero—, no un
orden por cercanía que no le aporta nada.

Usa `word_similarity` y no `similarity`, y la diferencia no es un detalle:
`similarity` compara las cadenas enteras, así que "milanesa" contra "Milanesa
napolitana con papas" saca 0.30 —apenas más que un error de tipeo— y obligaría
a un umbral tan bajo que entraría cualquier cosa. `word_similarity` mide contra
la palabra que mejor pega dentro del nombre, que es como escribe el comensal:
una palabra, no la frase entera.

El umbral de **0.5** y el mínimo de **4 caracteres** están medidos contra la
carta, no elegidos a ojo:

| Escrito | Plato | `word_similarity` |
| --- | --- | --- |
| `milanessa` | Milanesa napolitana | 0.727 |
| `provleta` | Provoleta a la parrilla | 0.583 |
| — **umbral 0.5** — | | |
| `pizza` | Provoleta a la parrilla | 0.167 |
| `sushi` | Milanesa napolitana | 0.000 |

Con tres letras el trigrama es ruido: `ana` —un pedazo sin sentido de
"napolitana"— da exactamente 0.5 contra la milanesa, justo el umbral. Con
cuatro vuelve a separar, y por eso ese es el mínimo.

Cuando los platos vienen por parecido se respeta el orden de la consulta (del
más parecido al menos), que ahí es lo único que importa.

La búsqueda devuelve ids y los filtros restantes los sigue armando Prisma
(dietas, alérgenos, categoría, archivados). Son dos consultas en vez de una,
pero evita duplicar en SQL reglas que ya están expresadas una sola vez.

## Dar de baja un restaurante

`prisma.tenant.delete()` **no alcanza**. La cascada intenta borrar los platos,
pero `OrderItem.dishId` y `Dish.categoryId` son `onDelete: Restrict` a propósito
—para que nadie borre un plato que figura en un pedido histórico— y PostgreSQL
no garantiza el orden en que resuelve las cascadas.

La salida no es aflojar las restricciones, que protegen el histórico de ventas,
sino hacer explícito el único camino legítimo: `deleteTenantCompletely()` en
`modules/tenants/service.ts` vacía de adentro hacia afuera (pedidos → platos →
categorías → tenant) en una transacción.

Para dejar de operar sin perder nada, `Tenant.isActive = false` saca al
restaurante de circulación y conserva todo.

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
