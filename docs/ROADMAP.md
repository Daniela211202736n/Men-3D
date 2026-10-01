# Qué falta para producción

Ordenado por lo que bloquea cobrar el primer peso.

## 1. Bloqueante para operar de verdad

| Tema | Estado | Qué falta |
| --- | --- | --- |
| **Pasarela de pagos** | **MercadoPago implementado** (Checkout Pro, webhook firmado, importe verificado, idempotente). Stripe sigue sin implementar | Probar contra una cuenta real de MercadoPago: lo verificado hasta ahora son las piezas (firma, conversión de importes, liquidación del pedido) y el recorrido del frontend con la respuesta simulada, no una transacción de punta a punta. |
| **PostgreSQL** | Esquema portable, corriendo en SQLite | Cambiar el provider, correr migraciones, agregar `mode: 'insensitive'` en la búsqueda o un índice trigram. |
| **Modelos en CDN** | Se sirven desde la API | Bucket + CDN, subida firmada desde el backoffice, y conservar el aviso de peso. |
| **KDS multi-instancia** | Bus en memoria | Redis pub/sub. El resto del código solo conoce `publish` y `subscribe`. |
| **Correo transaccional** | No existe | Confirmación de pedido y recuperación de contraseña. |

## 2. Necesario antes de abrir a clientes

- **Pruebas automatizadas.** Hay 64 pruebas (`npm test`) sobre las reglas que
  cobran mal si se rompen: totales e IVA, canje de puntos, máquina de estados del
  pedido, listas portables, clasificación del recomendador y todo el adaptador de
  MercadoPago (firma, conversión de importes, mapeo de estados). Faltan
  las de aislamiento entre tenants contra una base real y un *end-to-end* del
  flujo escanear → ver en 3D → pedir; la verificación de ese flujo hoy es un
  recorrido de navegador manual. El camino del dinero sí tiene pruebas de
  integración (liquidación, idempotencia, importe manipulado).
- **Recuperación de contraseña** y gestión de usuarios del equipo.
- **Backups** y un plan de restauración probado.
- **Cumplimiento**: aviso de cookies/analítica, exportación y borrado de datos del
  comensal (hoy son identificadores opacos en su navegador, lo que ayuda, pero el
  aviso hace falta igual).
- **Límites por plan aplicados en escritura.** Hoy se muestran en "Plan y uso"
  pero no se bloquea la carga al superarlos.

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
