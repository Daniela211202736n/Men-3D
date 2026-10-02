# Men-3D

**Carta digital en 3D y realidad aumentada para restaurantes.** PWA multi-tenant
lista para operar como SaaS: el comensal escanea un QR, gira el plato en 3D, lo
apoya en su mesa a escala real y pide desde el celular; el restaurante gestiona
carta, precios, pedidos y métricas desde un backoffice.

> ¿Y si pudieras ver el plato en 3D antes de pedirlo?

---

## Arrancar en un minuto

```bash
docker compose up -d   # PostgreSQL
npm run setup          # instala, genera los modelos 3D, migra y siembra
npm run dev            # API en :4000 y PWA en :5173
```

(`npm run setup` ya levanta la base por vos; el primer comando es por si querés
arrancarla sola.)

Abrí <http://localhost:5173> y entrá a cualquiera de las dos cartas de demostración.

**Cuentas del backoffice** (contraseña `men3d-demo-2026` en todas):

| Cuenta                   | Rol   | Plan    | Para ver                                     |
| ------------------------ | ----- | ------- | -------------------------------------------- |
| `pepe@donpepe.demo`      | OWNER | PRO     | Todo: métricas, pedidos, KDS, traducción     |
| `cocina@la-parrilla-de-don-pepe.demo` | STAFF | PRO | Solo la pantalla de cocina            |
| `hola@verdebowl.demo`    | OWNER | STARTER | Cómo se ve el producto con funciones bloqueadas |

No hace falta ninguna clave de API: los pagos corren con un proveedor simulado,
los modelos 3D se sirven desde la API, y la IA es opcional (sin
`ANTHROPIC_API_KEY` el sistema usa las reglas deterministas y las traducciones
manuales). Lo único que necesita es Docker, para la base.

**¿Querés verlo como en producción?** `docker compose -f docker-compose.yml -f
docker-compose.apps.yml up -d --build` levanta todo en contenedores en
<http://localhost:8080>. Ver [docs/DEPLOY.md](docs/DEPLOY.md).

---

## Qué incluye

### Para el comensal

- **Visor 3D y RA** — gira, acerca y coloca el plato en su mesa a escala real
  (WebXR / Scene Viewer en Android, AR Quick Look en iOS). Sin instalar nada.
- **Búsqueda incremental** por nombre, descripción e ingredientes.
- **Filtros de alérgenos y dietas** — celíacos, veganos, alérgicos: el filtro
  excluye también las trazas declaradas.
- **Opiniones** por plato y del local, con respuesta del restaurante.
- **Maridajes sugeridos** con el motivo a la vista.
- **Carta multilenguaje** que detecta el idioma del teléfono.
- **Pedido y pago** desde el celular (MercadoPago o cobro simulado), con
  seguimiento del estado que se actualiza solo mientras se acredita.
- **Puntos de fidelidad** canjeables por descuento.
- **Ficha del local** con mapa, horarios, redes y botón de compartir.

### Para el restaurante

- **Carta**: alta/baja de platos, precio editable en la fila, disponibilidad,
  destacados y reordenamiento.
- **Pantalla de cocina (KDS)** en vivo por SSE.
- **Métricas**: qué platos se miran en 3D y cuáles se venden —y los que no.
- **QR por mesa** en PDF listo para imprimir, con conteo de escaneos.
- **Compartir** por WhatsApp o mail.
- **Marca**: colores, logo, portada y fondo, con contraste calculado.
- **Traducción automática** de la carta.
- **Plan y uso**, con las funciones que cada plan habilita y los límites
  aplicados al cargar (no solo mostrados).
- **Equipo**: altas de encargados y mozos con su rol, baja lógica y traspaso de
  la propiedad del local.
- **Recuperación de contraseña** por correo, con enlace de un solo uso.

---

## Estructura

```
men-3d/
├── apps/
│   ├── api/                 Fastify + Prisma (API REST + SSE)
│   │   ├── prisma/          esquema y datos de demostración
│   │   └── src/
│   │       ├── modules/     un módulo por dominio
│   │       ├── plugins/     autenticación y resolución de tenant
│   │       └── lib/         errores, serializadores, helpers
│   └── web/                 React 19 + Vite (PWA)
│       └── src/
│           ├── components/  visor 3D, tarjetas, gráficos
│           ├── pages/       públicas (carta) y de administración
│           ├── store/       carrito, sesión, local, avisos
│           └── lib/         cliente API, analítica, i18n, marca
├── packages/shared/         tipos, esquemas zod y DTO compartidos
├── scripts/                 generador de modelos GLB de ejemplo
└── docs/                    arquitectura, base de datos, flujos, API
```

## Documentación

| Documento | Contenido |
| --------- | --------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura técnica, decisiones y camino a producción |
| [docs/DATABASE.md](docs/DATABASE.md)         | Esquema relacional tabla por tabla |
| [docs/UX-FLOWS.md](docs/UX-FLOWS.md)         | Flujos de usuario principales |
| [docs/API.md](docs/API.md)                   | Referencia de endpoints |
| [docs/PAYMENTS.md](docs/PAYMENTS.md)         | Pasarelas de pago: MercadoPago, webhooks y cómo agregar otra |
| [docs/DEPLOY.md](docs/DEPLOY.md)             | Despliegue: Docker, variables, migraciones, bucket y CDN |
| [docs/ROADMAP.md](docs/ROADMAP.md)           | Qué falta para producción, por prioridad |

---

## Comandos

| Comando | Qué hace |
| ------- | -------- |
| `npm run setup` | Instala, genera modelos, crea la base y la siembra |
| `npm run dev` | Levanta API y PWA juntas |
| `npm run dev:api` / `npm run dev:web` | Una sola |
| `npm run build` | Compila los tres paquetes |
| `npm run typecheck` | Chequeo de tipos de todo el monorepo |
| `npm test` | Pruebas de la API |
| `npm run e2e` | Recorrido del comensal en un navegador real (escanear → 3D → pedir → pagar) |
| `npm run db:up` / `npm run db:down` | Levanta o apaga PostgreSQL |
| `npm run db:migrate` | Crea y aplica una migración nueva |
| `npm run db:deploy` | Aplica las migraciones pendientes (producción) |
| `npm run db:seed` | Vuelve a sembrar los datos de demostración |
| `npm run db:reset` | Borra la base y la reconstruye desde las migraciones |
| `npm run db:studio` | Explorador visual de la base |
| `npm run models:sample` | Regenera los GLB de ejemplo |

## Configuración

Copiá `.env.example` a `.env`. Todo tiene valores por defecto que funcionan en
desarrollo contra la base de `docker compose`. Para producción, la lista completa
está en [docs/DEPLOY.md](docs/DEPLOY.md); la API se niega a arrancar con el
`JWT_SECRET` de desarrollo o con una pasarela elegida sin credenciales.

---

## Estado y límites conocidos

Esto es un MVP funcional de punta a punta, no un sistema en producción. Lo que
está deliberadamente sin terminar:

- **Pagos**: MercadoPago (Checkout Pro) está implementado, con webhook firmado
  y verificación del cobro contra su API — ver [docs/PAYMENTS.md](docs/PAYMENTS.md).
  Por defecto corre el proveedor simulado para que la demo funcione sin
  credenciales. El adaptador de Stripe sigue declarado sin implementar.
- **Base de datos**: PostgreSQL, con migraciones versionadas.
- **Assets**: en desarrollo se sirven desde la API; en producción van a un bucket
  compatible con S3 (AWS, Cloudflare R2, Spaces) con CDN delante, cambiando solo
  variables de entorno.
- **KDS**: el bus de eventos es en memoria, así que funciona con una sola
  instancia de la API. Con varias hay que cambiarlo por Redis pub/sub.
- **Auditoría de dependencias**: `npm audit` está limpio (0 vulnerabilidades).
  Prisma quedó fijado en 6.12.0, la última versión sin el aviso de
  `deepmerge-ts` en su cadena; conviene subirlo cuando publiquen la corrección.

