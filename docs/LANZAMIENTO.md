# Puesta en marcha

Esto es el orden en que conviene hacer las cosas para salir a producción. No
explica qué hace cada variable —eso está en [DEPLOY.md](DEPLOY.md)— sino **qué
hacer primero y qué tarda**.

La regla que ordena todo: **empezá por lo que depende de terceros**, porque eso
no se acelera trabajando más rápido. Verificar una cuenta de MercadoPago puede
tardar días; propagar un DNS, horas. Si dejás eso para el final, el proyecto
queda listo y vos esperando.

---

## Semana 0 — lo que tarda, arrancalo hoy

Estas tres cosas corren solas mientras hacés el resto. Ninguna depende de las
otras.

### 1. Cuenta de MercadoPago

Necesitás una cuenta **de producción**, verificada, a nombre de quien va a
facturar. De ahí salen tres valores:

| Valor | Dónde está |
| --- | --- |
| `MERCADOPAGO_ACCESS_TOKEN` | Tus integraciones → la aplicación → Credenciales de producción |
| `MERCADOPAGO_WEBHOOK_SECRET` | La misma pantalla, al configurar las notificaciones |
| (modo sandbox) | Las credenciales de prueba, para probar antes de cobrar de verdad |

**Probá primero en sandbox.** Las credenciales de prueba cobran con tarjetas
ficticias y recorren el mismo camino. Es la única forma de ver una transacción
completa sin mover plata.

Al configurar las notificaciones hay que dar **tres URLs distintas**, que no son
intercambiables:

```
https://tu-api/api/payments/webhook/mercadopago              pedidos
https://tu-api/api/billing/webhook/mercadopago/subscription  abono mensual
https://tu-api/api/billing/webhook/mercadopago/setup         configuración inicial
```

Ver [PAYMENTS.md](PAYMENTS.md) para por qué están separadas.

### 2. Dominio y correo

Comprá el dominio y decidí los dos subdominios: uno para la carta (`PUBLIC_WEB_URL`)
y otro para la API (`PUBLIC_API_URL`).

Después abrí una cuenta en [Resend](https://resend.com) y verificá el dominio.
**Eso depende de propagación DNS**, así que puede tardar horas. Sin dominio
verificado, Resend no envía y nadie puede recuperar su contraseña.

De ahí salen `RESEND_API_KEY` y `MAIL_FROM`.

### 3. Bucket para los modelos 3D

Un GLB pesa megabytes y se sirve en el celular del comensal, con 4G. Sin CDN la
carta tarda y el visor se siente roto.

**Recomendación: Cloudflare R2.** No cobra salida de datos, que es justo el
costo que más se dispara acá: cada comensal que abre un plato descarga el
modelo. Los pasos están en [DEPLOY.md § El bucket y el CDN](DEPLOY.md).

---

## Decisiones que son tuyas, no técnicas

Resolvelas antes de desplegar, porque cambian datos que después hay que migrar.

- **Los precios.** Los del código son los de la demostración: $59.000 por mes y
  $199.000 de configuración inicial. Se cambian en
  `apps/api/src/modules/plans/catalogo.ts` y se aplican con `npm run db:plans`
  (o `db:plans:prod` dentro de la imagen). Son una decisión comercial, no una
  constante.
- **Qué incluye cada plan.** `PLAN_FEATURES` en `packages/shared/src/enums.ts`.
- **La moneda y el país** de cada restaurante.
- **La política de privacidad y los términos.** Hay **borradores escritos y
  publicados** en `/legal/privacidad`, `/legal/terminos` y
  `/legal/terminos-comensal`, redactados contra el marco argentino (Ley 25.326,
  Ley 24.240) y fieles a lo que el sistema hace de verdad. Lo que falta son 21
  datos: 14 los completás vos en `apps/web/src/legal/empresa.ts` y 7 los tiene
  que escribir un abogado, porque definen responsabilidad. Mientras falten, la
  página lo dice en pantalla en vez de publicar un texto con agujeros.
  **Hay además un botón de arrepentimiento obligatorio que todavía no existe en
  el producto** (Res. 424/2020 SCI). Todo en
  [legal/README.md](legal/README.md).

---

## Elegir dónde corre

El stack son dos contenedores (API y PWA), PostgreSQL y, si vas a correr más de
una instancia de la API, Redis.

Lo que **no** sirve: cualquier plataforma que corte las conexiones largas. El
KDS usa Server-Sent Events y la pantalla de cocina mantiene una conexión
abierta durante todo el turno. Un balanceador con *timeout* de 60 segundos la
corta sin parar.

Tres caminos razonables, de menos a más trabajo:

| Opción | Cuándo conviene |
| --- | --- |
| **Un VPS con Docker Compose** | Los primeros clientes. `docker-compose.apps.yml` ya levanta todo. Lo más barato y lo que menos partes móviles tiene. |
| **Plataforma administrada** (Railway, Render, Fly) | Cuando no quieras administrar el servidor. Verificá que soporte SSE sin cortar. |
| **Kubernetes o similar** | Recién cuando tengas varias instancias y lo necesites. Ahí `REDIS_URL` deja de ser opcional. |

Para el primer cliente, un VPS alcanza y sobra.

---

## El orden del primer despliegue

1. **Base de datos.** Si usás PostgreSQL administrado, creala y comprobá que
   podés crear las extensiones: `psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS unaccent; CREATE EXTENSION IF NOT EXISTS pg_trgm;"`.
   Si eso falla, el despliegue falla ahí —ver [DEPLOY.md § Extensiones](DEPLOY.md).
2. **Variables de entorno.** Las obligatorias están en
   [DEPLOY.md § Variables](DEPLOY.md). `JWT_SECRET` tiene que ser un valor al
   azar de 32 caracteres o más: la API se niega a arrancar con el de desarrollo.
3. **Migraciones y catálogo de planes**, como paso aparte del arranque:
   `npm run db:deploy` y después `npm run db:plans:prod`. Los dos: sin planes,
   quien se registra queda sin suscripción y le salen los pedidos
   deshabilitados —ver [DEPLOY.md § Migraciones](DEPLOY.md).
4. **Las imágenes.** `docker compose -f docker-compose.yml -f docker-compose.apps.yml build`
   y publicalas en un registro.
5. **Levantar y comprobar.** Las sondas de
   [DEPLOY.md § Comprobar que quedó bien configurado](DEPLOY.md) dicen qué
   falta, nunca qué hay.
6. **El respaldo programado.** `scripts/backup.sh` en un cron, y
   **sincronizá las copias fuera de esa máquina**: una copia en el mismo disco
   que la base no sobrevive a lo que más probablemente pase.
7. **Restaurá un respaldo en una base descartable.** La prueba automatizada
   cubre el mecanismo; lo que no cubre es que el respaldo de *ayer* en *tu*
   servidor sea bueno.

---

## Antes de cobrarle a alguien de verdad

Esto no se puede dar por hecho desde el código: hay que verlo pasar.

- [ ] Un **pedido completo en sandbox**: escanear, pedir, pagar, ver que la
      cocina lo recibe y que el estado cambia solo.
- [ ] El **webhook llega**. Si el pago entra pero el pedido no cambia de estado,
      la URL de notificación está mal o la firma no verifica. El log de la API
      lo dice.
- [ ] Un **cobro con el importe cambiado** no acredita nada. Está probado en
      código; verlo en sandbox confirma que la URL correcta está conectada.
- [ ] El **débito mensual** se autoriza y el plan queda activo.
- [ ] El **cobro de configuración inicial** marca `setupFeePaid`.
- [ ] Un **correo de recuperación** llega de verdad a una casilla real.
- [ ] La **carta carga en un celular con 4G**, no en wifi. Es donde se nota si
      el CDN está bien puesto.
- [ ] El **QR impreso** abre la carta del local correcto, con la mesa correcta.

---

## El primer restaurante

1. Dar de alta la cuenta y cargarle la carta.
2. Modelar los primeros platos en 3D —es el trabajo más caro de la implantación,
   y lo que cubre el cobro de configuración inicial.
3. Imprimir los QR por mesa desde el backoffice, en PDF.
4. Mostrarle a quien atiende cómo funciona la pantalla de cocina.
5. **Acompañar el primer servicio.** El primer viernes a la noche es cuando
   aparece todo lo que no se ve probando.

---

## Qué mirar la primera semana

El backoffice ya responde esto solo, en "Resumen":

- **Qué platos se miran y cuáles se venden.** El hallazgo que justifica el
  producto es un plato con muchas vistas en 3D y pocas ventas: gusta mirarlo y
  nadie lo pide. Un menú de papel nunca podría contarlo.
- **Dónde se cae la gente** entre abrir la carta y pedir.
- **Qué busca y no encuentra**, que es la lista de platos que faltan o están mal
  nombrados.
