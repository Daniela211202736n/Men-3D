# Arquitectura técnica

## 1. El resumen en una página

```
                          ┌───────────────────────────────┐
   Celular del comensal   │  PWA  (React 19 + Vite)        │
   ─────────────────────► │  /m/:slug  carta pública       │
   escanea el QR          │  /admin    backoffice (lazy)   │
                          │  Service worker + <model-viewer>│
                          └───────────┬───────────────────┘
                                      │ HTTPS  (REST + SSE)
                                      ▼
                          ┌───────────────────────────────┐
                          │  API  (Fastify 5 + TypeScript)│
                          │  ┌──────────┬────────────────┐│
                          │  │ público  │ backoffice     ││
                          │  │ sin auth │ JWT + plan     ││
                          │  └──────────┴────────────────┘│
                          │  módulos: menu · orders · ai  │
                          │  analytics · loyalty · qr     │
                          └───┬──────────────┬────────────┘
                              │ Prisma       │ opcional
                              ▼              ▼
                     ┌────────────────┐  ┌──────────────────┐
                     │ PostgreSQL     │  │ API de Claude    │
                     │ (SQLite en dev)│  │ traducción y copy│
                     └────────────────┘  └──────────────────┘

                     ┌────────────────┐
                     │ CDN / bucket   │  modelos GLB · USDZ · fotos
                     └────────────────┘
```

## 2. Por qué cada pieza

| Decisión | Alternativa descartada | Motivo |
| --- | --- | --- |
| **PWA en el navegador** | App nativa en las tiendas | El comensal escanea un QR mientras espera: no va a instalar nada. La RA del navegador alcanza en los dos sistemas. |
| **`<model-viewer>`** | three.js a mano | Resuelve los dos caminos de RA que existen hoy (WebXR/Scene Viewer en Android, Quick Look en iOS) y expone `canActivateAR`, que es lo que permite ocultar el botón cuando el dispositivo no puede. Con three.js habría que escribir y mantener esa compatibilidad. |
| **GLB (glTF binario)** | OBJ, FBX, USDZ como principal | Es el formato que el navegador entiende nativamente, comprime bien y soporta PBR. USDZ se ofrece como variante opcional para mejorar la RA de iOS. |
| **Fastify** | Express, NestJS | Rápido, con validación y tipado de primera clase, y plugins encapsulados: el guardia de autenticación se aplica a un grupo entero de rutas sin repetirlo en cada handler. NestJS agrega estructura que un MVP de este tamaño no necesita. |
| **Prisma** | SQL a mano, TypeORM | El esquema es la documentación, las migraciones son automáticas y el cliente tipado hace que un `select` mal escrito rompa en compilación. |
| **Multi-tenant en una sola base** | Una base por restaurante | Un restaurante son decenas de platos y miles de eventos: el aislamiento por fila alcanza de sobra y el costo operativo es una fracción. Si más adelante un cliente grande exige aislamiento físico, `tenantId` ya está en todas las tablas y la partición es mecánica. |
| **SSE para el KDS** | WebSocket | El flujo es de ida (servidor → pantalla de cocina), reconecta solo y viaja por HTTP común sin configuración extra en proxies. |
| **Diccionario i18n propio** | i18next | Son ~90 claves de interfaz. Una librería de i18n completa pesa más que todo el diccionario en la primera visita, que es justo lo que hay que cuidar en un celular con 4G. |
| **Hook `useAsync` propio** | react-query | Mismo razonamiento: quince pantallas con cargas simples no justifican una librería de caché en el bundle inicial. |

## 3. Monorepo

Tres paquetes con npm workspaces:

- **`packages/shared`** — enums de dominio, esquemas de validación (zod) y DTO.
  Es el contrato: la API valida con los mismos esquemas con los que la PWA valida
  sus formularios, y los DTO hacen que un cambio de contrato rompa el `tsc` del
  frontend en vez de romper en producción.
- **`apps/api`** — la API.
- **`apps/web`** — la PWA (carta pública y backoffice en el mismo build, con el
  backoffice cargado de forma diferida).

La función que calcula el total de un pedido (`computeOrderTotals`) vive en
`shared` y la usan los dos lados: el número que el comensal ve antes de pagar es
exactamente el que calcula el servidor al cobrar.

## 4. Aislamiento entre restaurantes

Tres capas, y las tres tienen que fallar para que haya una fuga:

1. **El token manda.** Ninguna ruta del backoffice acepta un `tenantId` por
   parámetro o por body: sale siempre del JWT.
2. **Toda consulta filtra.** Cada `update`/`delete` incluye `tenantId` en el
   `where`, así que un id adivinado de otro restaurante simplemente no encuentra
   nada (devuelve 404, no 403: no confirma que el recurso exista).
3. **Lo público se resuelve por slug.** La carta pública resuelve el tenant desde
   la URL y nunca toca datos de administración.

Verificado: un token del tenant B intentando cambiar el precio de un plato del
tenant A recibe `404 NOT_FOUND`.

## 5. El modelo de planes

`Plan` define el precio mensual, el cobro de configuración inicial, los límites y
la lista de funcionalidades. `getTenantFeatures()` las resuelve con una caché de
60 segundos, y dos guardias las aplican:

- `requireFeature(...)` en las rutas del backoffice → `403` con el motivo.
- La carta pública consulta las features del tenant para, por ejemplo, no mostrar
  el carrito si el plan no incluye pedido online.

El frontend no esconde lo que no está incluido: lo muestra bloqueado y dice desde
qué plan está disponible.

## 6. La analítica

### Qué se mide

`MENU_OPEN`, `SEARCH`, `DISH_OPEN`, `DISH_VIEW_3D`, `DISH_ROTATE`, `AR_LAUNCH`,
`ADD_TO_CART`, `CHECKOUT_START`, `PURCHASE`, `REVIEW_SUBMIT`, `SHARE`.

Dos identificadores opacos, los dos en el navegador del comensal y ninguno ligado
a una persona: `sessionId` (una visita, caduca a los 30 minutos de inactividad) y
`guestId` (el dispositivo, sostiene los puntos de fidelidad).

### Cómo se envía

La PWA encola los eventos y los manda en lote cada 2 segundos, o cuando la
pestaña se oculta (`visibilitychange`, el único evento confiable en iOS). Girar un
modelo 3D genera decenas de eventos; mandarlos sueltos se notaría en la red del
comensal.

### La métrica que justifica el producto

`lookToBookRate = unidades vendidas / vistas en 3D`. Un plato que se mira mucho y
se pide poco es un problema de precio, de descripción o de porción —y es un dato
que ningún menú de papel puede dar. En los datos de demostración el flan tiene
132 vistas y 2 ventas (1,5 %) contra 39,7 % de la milanesa.

### Escalar la analítica

Hoy los informes agregan en memoria sobre el rango pedido, lo que rinde de sobra
para un restaurante. A partir de ~1 millón de eventos por tenant conviene:

1. Tabla de rollup diario (`tenantId`, `date`, `dishId`, `type`, `count`,
   `durationSum`) escrita por un job nocturno; los informes leen de ahí.
2. Particionar `AnalyticsEvent` por mes en PostgreSQL y archivar lo viejo.
3. Si hace falta tiempo real sobre volúmenes grandes, mover la ingesta a una cola.

## 7. La capa de IA es opcional, no estructural

Dos usos, los dos con degradación limpia:

- **Traducción de la carta** (`translateDishes`) — salida estructurada para poder
  emparejar cada traducción con su plato sin parsear texto libre. Lo que el
  restaurante corrige a mano queda marcado `MANUAL` y la traducción automática no
  lo vuelve a pisar.
- **Copy de los maridajes** (`writePairingBlurb`) — solo el texto.

**Qué sugerir no lo decide la IA.** El recomendador es determinista y explicable,
y combina tres señales con su motivo a la vista: maridajes curados por el
restaurante, co-consumo histórico real (confianza = P(pedir B | se pidió A), con
un mínimo de pedidos para no concluir de dos casos sueltos) y complemento de
curso por categoría. Después filtra por compatibilidad de dieta: a quien eligió
un plato vegano no se le ofrece algo que no lo sea.

Sin `ANTHROPIC_API_KEY` todo esto sigue funcionando; solo faltan las traducciones
automáticas y el copy generado.

## 8. Rendimiento en el celular

Es el requisito que decide si el producto sirve: un menú que tarda no se usa.

- **El visor 3D se carga diferido.** `<model-viewer>` pesa ~300 KB comprimido y
  solo hace falta al abrir un plato, así que se importa cuando el componente
  entra en pantalla (`IntersectionObserver`, con 200 px de margen) y está excluido
  del precache del service worker. El precache quedó en 446 KB en vez de 1,4 MB.
- **El backoffice no viaja con la carta.** Va en chunks aparte cargados bajo
  demanda: un comensal que escanea un QR no descarga las pantallas de
  administración ni los gráficos.
- **Estrategias de caché por tipo**: los modelos 3D con *cache-first* (nombre con
  hash, no cambian nunca); la carta con *network-first* y 4 segundos de tiempo
  límite (los precios cambian, pero con mala señal se sirve la copia).
- **Los GLB de ejemplo pesan entre 19 y 131 KB.** El editor avisa cuando un
  modelo subido supera los 3 MB.

## 9. Paleta de datos del panel

Los gráficos usan una paleta validada para contraste y para los tres tipos de
daltonismo, en modo claro y oscuro (azul `#2a78d6`/`#3987e5` para interés visual,
naranja `#eb6834`/`#d95926` para ventas; separación CVD ΔE 24,7 en claro y 26,8
en oscuro, muy por encima del umbral de 8).

Reglas que se siguen en todos: un solo eje de valores —dos medidas de escala
distinta van en dos paneles, nunca en dos ejes Y sobre el mismo dibujo—, barras
finas con el extremo redondeado solo del lado del dato, leyenda siempre que haya
dos series, etiquetas selectivas en vez de un número en cada marca, texto con
tokens de tinta y nunca con el color de la serie, y vista de tabla en cada
gráfico para lectores de pantalla.

## 10. Seguridad

| Qué | Cómo |
| --- | --- |
| Contraseñas | bcrypt, 12 rondas. El login compara contra un hash ficticio cuando el email no existe, para que el tiempo de respuesta no delate qué emails están registrados. |
| Sesión | JWT de 12 h. Un token válido de un usuario dado de baja se rechaza igual: `requireAuth` verifica contra la base. |
| Stream del KDS | `EventSource` no acepta cabeceras. En vez de poner el token de sesión en la URL (donde termina en logs de proxy e historial), se emite un **ticket de 60 segundos** con alcance `kds` que no autoriza ninguna otra ruta. |
| Subida de archivos | Se valida la firma binaria real del archivo, no el `Content-Type` que declara el cliente: un ejecutable renombrado a `.glb` se rechaza. Límite de 25 MB. |
| Entrega de archivos | El nombre lo genera el servidor (32 hex + extensión) y la ruta solo acepta ese formato exacto. No hay listado de directorio ni se usa nada del nombre original: no hay superficie de *path traversal*. Verificado con `../../../etc/passwd` y su variante codificada. |
| Fuerza bruta | 20 intentos cada 5 minutos en `/api/auth`; 300 por minuto en el resto. |
| Dependencias | Se descartó `@fastify/static` por vulnerabilidades de *path traversal* y se sirve lo necesario con una ruta propia de lista blanca. |

## 11. Camino a producción

1. **Base**: cambiar el provider de Prisma a `postgresql` y correr las
   migraciones. El esquema ya es portable.
2. **Assets**: subir los GLB a un bucket con CDN y guardar la URL pública.
3. **Pagos**: implementar el adaptador real contra la interfaz `PaymentProvider`
   y su webhook; el ciclo del pedido ya contempla el cobro diferido.
4. **KDS**: cambiar el bus en memoria por Redis pub/sub para correr varias
   instancias.
5. **Despliegue**: la API en un contenedor detrás de un proxy (con `trustProxy`
   ya activado en producción), la PWA como estático en el CDN.
6. **Observabilidad**: los logs ya son estructurados; falta enviarlos y agregar
   trazas y alertas sobre la tasa de error del checkout.
