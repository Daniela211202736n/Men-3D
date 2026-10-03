# Pagos

La pasarela vive detrás de la interfaz `PaymentProvider`
([`apps/api/src/modules/payments/provider.ts`](../apps/api/src/modules/payments/provider.ts)),
así que el resto del sistema no sabe con quién cobra.

| Proveedor | Estado | Cómo cobra |
| --- | --- | --- |
| `mock` | Implementado | Aprueba al instante. Para demos y pruebas. |
| `mercadopago` | **Implementado** | Checkout Pro: redirección + webhook firmado. |
| `stripe` | Contrato definido, sin implementar | Payment Element (embebido). |

Se elige con `PAYMENTS_PROVIDER` en el `.env`.

---

## MercadoPago (Checkout Pro)

### Cómo funciona el cobro

```
  Comensal confirma el pedido
            │
            ▼
  POST /api/public/:slug/orders
            │   crea el pedido en PENDING_PAYMENT
            │   crea una preferencia con external_reference = id del pedido
            ▼
  La PWA redirige a init_point  ──────────────►  Checkout de MercadoPago
                                                        │
                      ┌─────────────────────────────────┤
                      │                                 │
         (A) vuelta del navegador          (B) webhook servidor a servidor
             a /m/:slug/pedido/:code            POST /api/payments/webhook/mercadopago
             — solo informativa                 — ESTA es la que paga el pedido
                      │                                 │
                      ▼                                 ▼
             pantalla "esperando"          verifica firma → consulta el cobro
             que se actualiza sola         → pedido a PAID → puntos → KDS
```

**La vuelta del navegador no acredita nada.** Dos razones, y las dos importan:
el comensal puede cerrar la pestaña antes de volver (y su pedido tiene que
entrar igual a cocina), y una URL de retorno es trivialmente manipulable por
quien la recibe. El pedido se da por pagado sólo cuando MercadoPago nos lo
notifica por su cuenta y nosotros confirmamos el cobro contra su API.

### Configuración

```bash
PAYMENTS_PROVIDER=mercadopago
MERCADOPAGO_ACCESS_TOKEN="TEST-0000..."      # panel → Tus integraciones → Credenciales
MERCADOPAGO_WEBHOOK_SECRET="..."             # panel → Tus integraciones → Webhooks
PUBLIC_API_URL="https://api.turestaurante.com"
```

La API **no arranca** si elegís `mercadopago` sin el token o sin `PUBLIC_API_URL`,
y en producción tampoco sin el secreto del webhook: es mejor descubrirlo al
desplegar que cuando un comensal intenta pagar.

Para comprobar la configuración sin esperar a que alguien pague:

```bash
curl localhost:4000/api/payments/webhook/mercadopago/health
```

```json
{
  "provider": "mercadopago",
  "ready": true,
  "missing": [],
  "details": {
    "sandbox": true,
    "signatureVerification": true,
    "notificationUrl": "https://api.turestaurante.com/api/payments/webhook/mercadopago"
  }
}
```

El `notificationUrl` que devuelve es exactamente el que hay que pegar en el panel
de MercadoPago, en **Tus integraciones → Webhooks**, suscripto al evento
**Pagos**. Esa pantalla es también la que da el `MERCADOPAGO_WEBHOOK_SECRET`.

### Probar en desarrollo

El webhook necesita que MercadoPago llegue a tu máquina, así que hace falta un
túnel:

```bash
ngrok http 4000
# y después, en el .env:
PUBLIC_API_URL="https://abc123.ngrok-free.app"
```

Con un access token `TEST-...` el adaptador usa `sandbox_init_point`
automáticamente, y se paga con las
[tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/test-cards)
de MercadoPago. Para forzar cada resultado se usa el nombre del titular:
`APRO` aprueba, `OTHE` rechaza por error general, `CONT` deja el pago pendiente.

Sin `MERCADOPAGO_WEBHOOK_SECRET` en desarrollo, el adaptador procesa la
notificación **sin verificar la firma** y lo avisa por consola. Es una comodidad
para probar sin panel; en producción está prohibido por configuración.

### Qué verifica el sistema antes de dar un pedido por pagado

1. **Firma de la notificación** — HMAC-SHA256 sobre
   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, comparado en tiempo
   constante. El `data.id` va en minúsculas y cada par se omite entero si falta
   su valor. Se rechaza también una firma fuera de una ventana de 15 minutos,
   lo que acota el reenvío de una notificación interceptada.
2. **El estado real del cobro** — la notificación sólo trae un id; el estado se
   consulta contra la API de MercadoPago. Aunque alguien lograra falsear una
   notificación, no podría inventar que el pago fue aprobado.
3. **El importe** — tiene que coincidir con el total del pedido. Si no, se
   registra el pago como fallido, se deja el pedido sin pagar y queda un error
   en el log.
4. **Idempotencia** — MercadoPago reintenta hasta recibir un 2xx, así que la
   misma notificación llega varias veces. Un pedido ya pagado no vuelve a
   acreditar puntos.

### Estados

| MercadoPago | Nuestro `PaymentStatus` | Qué pasa con el pedido |
| --- | --- | --- |
| `approved` | `SUCCEEDED` | Pasa a `PAID`, acredita puntos y entra al KDS |
| `pending`, `in_process`, `authorized`, `in_mediation` | `PROCESSING` | Sigue en `PENDING_PAYMENT` |
| `rejected`, `cancelled` | `FAILED` | Sigue en `PENDING_PAYMENT` |
| `refunded`, `charged_back` | `REFUNDED` | Se registra; el pedido no se toca |
| desconocido | `PROCESSING` | Nunca se interpreta como cobrado |

Un pago en efectivo por Rapipago puede tardar horas en acreditarse: por eso
`pending` **no** manda el pedido a la cocina.

### Códigos de respuesta del webhook

MercadoPago reintenta con espera creciente todo lo que no sea 2xx, así que el
código que devolvemos es una decisión, no un detalle:

| Código | Cuándo | Efecto |
| --- | --- | --- |
| `200` | Procesado, o reconocido y descartado por no interesarnos | No reintenta |
| `401` | La firma no verifica | No reintenta: la notificación no es legítima |
| `502` | No pudimos consultar el cobro contra MercadoPago | Reintenta: el pago puede ser real y el fallo, nuestro |
| `404` | Pasarela desconocida en la URL | No reintenta |

---

## Agregar otra pasarela

1. Implementar `PaymentProvider` en `apps/api/src/modules/payments/<nombre>.ts`.
2. Registrarla en el mapa `providers` de `provider.ts`.
3. Nada más: la ruta de webhooks la encuentra por nombre, y el ciclo de vida del
   pedido ya contempla el cobro diferido.

Los tres métodos del contrato:

- `createCharge(request)` → devuelve `checkoutUrl` (redirección) o
  `clientSecret` (embebida), más el estado inicial.
- `parseWebhook({ body, headers, query })` → verifica, consulta y devuelve
  `{ orderId, providerRef, status, amountCents }`, o `null` si el evento no
  mueve ningún pedido. Lanza si no se puede verificar.
- `describeConfiguration()` → para la sonda; nombra lo que falta, nunca lo que hay.

---

# El abono del restaurante

Hasta acá todo fue el cobro de **un pedido al comensal**. El abono mensual que
paga el restaurante es otra cosa: distinto webhook, distinto ciclo de vida, y
una decisión de producto que conviene entender antes de tocar el código.

## Si no paga, vuelve al plan gratuito. No se le apaga la carta

Es tentador cortar el acceso entero: es la palanca más fuerte. Pero el QR está
pegado en las mesas. Un comensal que lo escanea un viernes a las nueve de la
noche y encuentra una página muerta no concluye que el restaurante no nos pagó
—concluye que **el producto no anda**, delante de sus invitados. El lunes el
restaurante despega los QR de las mesas. Perdimos al cliente y la
recomendación, por un mes de abono.

Volver al plan gratuito mantiene en pie la carta y el visor 3D —lo que ve el
comensal— y apaga lo que usa el restaurante: pedidos, pagos, métricas,
traducción, marca propia. Lo siente quien decide pagar, no quien está cenando.
Nada de lo cargado se borra: al cobrar, vuelve todo tal cual.

## El camino de un cobro fallido

```
ACTIVE ──falla el cobro──▶ PAST_DUE ──vence la gracia──▶ SUSPENDED
   ▲                           │                            │
   └───────────── cobra ───────┴────────────────────────────┘
```

`PAST_DUE` no cambia nada para nadie: son los días de gracia. Existen porque la
causa más común de un cobro fallido es una tarjeta vencida, no una decisión de
irse. Son **7 días** (`DIAS_DE_GRACIA`), y se fijan una sola vez: si cada
reintento fallido corriera el plazo, la gracia sería infinita.

La suspensión se evalúa en dos lados: la tarea periódica la barre cada hora, y
también se calcula al leer el estado. Así, el dueño que entra el día 8 ve la
verdad aunque la tarea no haya corrido.

## MercadoPago: `preapproval`

```
POST   /api/admin/subscription     crea el preapproval → devuelve init_point
GET    /api/admin/subscription     estado, próximo cobro, días de gracia
DELETE /api/admin/subscription     baja (también en la pasarela)

POST /api/billing/webhook/mercadopago/subscription
```

El dueño autoriza el débito en `init_point`. **El plan se activa con el aviso
de la pasarela, nunca con la vuelta del navegador**: que el dueño vuelva a la
página no prueba que haya autorizado nada, y la URL de vuelta la puede escribir
cualquiera. Es la misma regla que en el cobro de pedidos.

`pending` no es activo: es "creada, todavía no autorizó". Tratarla como activa
regalaría el plan a quien abre el checkout y lo cierra.

Los avisos se guardan en `BillingEvent` antes de aplicarse. MercadoPago
reintenta y no garantiza orden ni unicidad: sin eso, el reintento del aviso de
un cobro correría el período dos veces y el restaurante tendría un mes gratis.

La firma se verifica con el mismo código que el webhook de pedidos. Sin
`MERCADOPAGO_WEBHOOK_SECRET` el webhook responde 401 en vez de aplicar a
ciegas: un aviso de "cobró" sin verificar es un plan regalado a quien sepa la
URL.

## La configuración inicial

Es el otro pedazo del modelo: un cobro **único**, más grande que el abono
(cubre la carga de la carta y el modelado 3D de los primeros platos).

```
POST /api/admin/subscription/setup-fee   → { checkoutUrl }   solo OWNER
POST /api/billing/webhook/mercadopago/setup
```

No es una suscripción sino un pago suelto, así que va por Checkout Pro
(`Preference`), no por `preapproval`. Y **no es un pedido**, así que no puede
entrar por el webhook de pedidos: ese busca un `Order` por la referencia
externa y no encontraría nada. Por eso tiene notificación propia, y la
referencia lleva el prefijo `setup:` para que los dos caminos no se confundan.

**El importe se verifica contra la pasarela.** Es lo que separa cobrar de
regalar: sin esa comprobación, cualquiera que supiera armar un pago de un peso
con nuestra referencia externa se llevaría la configuración gratis. La
notificación solo trae un id; el monto y el estado salen de consultar el cobro.
Pagar de más sí se acepta —propina o redondeo de la pasarela no son motivo para
negarle el servicio a alguien que pagó.

Como siempre: lo marca como pagado el aviso de la pasarela, nunca la vuelta del
navegador. La pantalla lo dice en lugar de dejar al dueño preguntándose si
funcionó.

## Lo que falta probar

El diálogo con MercadoPago necesita una cuenta real. Lo verificado es la
máquina de estados, la degradación, la idempotencia y el rechazo de avisos sin
firma —todo con pruebas— más los cuatro estados en el navegador. **La creación
del `preapproval` y los avisos de cobro reales no están probados contra la
pasarela.**
