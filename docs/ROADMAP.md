# Qué falta para producción

Ordenado por lo que bloquea cobrar el primer peso.

## 1. Bloqueante para operar de verdad

| Tema | Estado | Qué falta |
| --- | --- | --- |
| **Pasarela de pagos** | **MercadoPago implementado** (Checkout Pro, webhook firmado, importe verificado, idempotente). Stripe sigue sin implementar | Probar contra una cuenta real de MercadoPago: lo verificado hasta ahora son las piezas (firma, conversión de importes, liquidación del pedido) y el recorrido del frontend con la respuesta simulada, no una transacción de punta a punta. |
| **PostgreSQL** | **Hecho.** Migraciones versionadas, búsqueda sin tildes (`unaccent` + `pg_trgm` con índices GIN), baja de restaurantes en orden de dependencias | Búsqueda difusa por similitud (los índices de trigramas ya están puestos; falta el umbral y el orden por cercanía). |
| **Modelos en CDN** | **Hecho.** Driver `s3` con subida firmada directa al bucket; `local` sigue para desarrollo | Probarlo contra un bucket real: lo verificado es el cableado contra un doble, no una integración con AWS/R2. |
| **Imágenes y despliegue** | **Hecho.** Dockerfiles de API y PWA, compose completo, migraciones como paso aparte, CI que compila las imágenes | Elegir plataforma y publicar las imágenes en un registro. |
| **Correo transaccional** | **Recuperación de contraseña hecha** (driver `log` para desarrollo, Resend para producción) | Confirmación de pedido al comensal. Probar Resend con un dominio verificado. |

## 2. Necesario antes de abrir a clientes

- **Respaldos: hechos.** `scripts/backup.sh` y `scripts/restore.sh`, con una
  prueba que respalda, restaura en una base limpia y compara —incluida la
  función de búsqueda y sus índices, que si no viajaran dejarían la base
  restaurada rota en silencio. Falta agendarlo en el servidor que se elija y
  sincronizar las copias fuera de esa máquina (ver DEPLOY.md).

- **Pruebas automatizadas.** Hay 176 pruebas (`npm test`) más 5 de recorrido en navegador (`npm run e2e`): totales e IVA, canje de
  puntos, máquina de estados del pedido, el adaptador de MercadoPago completo,
  el almacenamiento local y S3, las de integración del camino del dinero
  (liquidación, idempotencia, importe manipulado, concurrencia), **el aislamiento
  entre tenants contra la base real** (33 pruebas: el token de A contra los datos
  de B en lectura, escritura, superficie pública y tokens) y las del onboarding
  (reglas del equipo, límites del plan, recuperación de contraseña). Esa primera
  tanda de aislamiento encontró un agujero real: el ticket del KDS —que viaja en
  una URL— servía como sesión completa del backoffice. **El *end-to-end* del comensal ya está**
  (`npm run e2e`, Playwright, en CI): escanear → buscar → ver en 3D → pedir →
  pagar → seguir, en un viewport de celular y contra la compilación de
  producción.
- **KDS multi-instancia: hecho.** Con `REDIS_URL` el bus pasa a Redis pub/sub y
  la API escala horizontalmente. Probado con dos buses contra un Redis real: un
  pedido publicado en uno llega a la cocina conectada al otro.
- **CSP: hecha**, midiendo. En `apps/web/nginx.conf`, verificada sin violaciones
  en la carta, el visor 3D, el mapa y las siete pantallas del backoffice,
  incluido el stream SSE del KDS. Ver DEPLOY.md.
- **Cumplimiento: hecho.** Aviso de medición con las dos respuestas pesando lo
  mismo —y que si dice que no, no sale ni un evento, comprobado contando las
  peticiones del navegador—, más una pantalla para ver, descargar y borrar los
  datos. Borrar anonimiza los pedidos en vez de borrarlos: son comprobantes de
  venta que el restaurante está obligado a conservar. Ver UX-FLOWS.md §F.
  Falta la parte que no es código: política de privacidad y términos escritos
  por alguien que sepa del marco legal de cada país donde se opere.
- **Facturación de la suscripción: hecha.** Débito mensual con MercadoPago
  (`preapproval`), período de gracia de 7 días y degradación al plan gratuito
  por impago —la carta del comensal nunca se apaga, ver PAYMENTS.md. El cobro de la configuración
  inicial también está (Checkout Pro, webhook propio, importe verificado contra
  la pasarela). Falta probar los dos contra una cuenta real.

## 3. Lo que sigue al producto

- **Optimización de modelos en el servidor**: comprimir con Draco al subir, para
  no depender de que el restaurante suba un GLB liviano.
- **Rollups de analítica** (ver ARCHITECTURE.md §6).
- **Fotogrametría asistida**: que el restaurante genere el modelo 3D desde el
  celular dando una vuelta alrededor del plato. Es lo que elimina el mayor costo
  de implantación.
- **Modo offline completo** para el comensal.
- **Integración con comandas y facturación** existentes.
- **Pruebas A/B de carta**: dos descripciones o dos precios para el mismo plato,
  midiendo con la analítica que ya está.

## 4. Deuda técnica conocida

| Qué | Dónde | Por qué quedó así |
| --- | --- | --- |
| Prisma fijado en 6.12.0 | `apps/api/package.json` | Las versiones posteriores arrastran el aviso de `deepmerge-ts` en `@prisma/config`. Fijarlo deja `npm audit` en cero; subir cuando Prisma publique la corrección. |
| `enabledLocales` / `serviceModes` como texto con comas | `apps/api/prisma/schema.prisma` | Portabilidad SQLite↔PostgreSQL. Pasan a `text[]` cambiando solo `lib/lists.ts`. |
| Los informes agregan en memoria | `modules/analytics/service.ts` | Rinde de sobra a escala de un restaurante; el camino a rollups ya está descrito. |
| Idiomas `fr`/`it`/`de` caen al diccionario en inglés | `apps/web/src/lib/i18n.ts` | La interfaz tiene es/en/pt completos. Agregar un idioma es agregar un objeto. |
| El reordenamiento usa flechas, no arrastre | `pages/admin/DishesPage.tsx` | Las flechas funcionan con teclado y en celular sin librería extra. El arrastre es una mejora, no un requisito. |
