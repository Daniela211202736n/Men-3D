# Revisión de seguridad

Revisión del código completo antes de que toque un cliente real. No es una
auditoría externa ni la reemplaza: es lo que se puede verificar desde adentro,
con el código a la vista y la aplicación corriendo.

**Dos hallazgos reales, los dos arreglados**, y varias propiedades que se
verificaron y están bien.

---

## Hallazgo 1: se podían leer los pedidos de otros comensales

**Dónde**: `GET /api/public/:slug/orders/:code`, pública y sin límite propio.

El código del pedido es de **4 caracteres sobre un alfabeto de 32** —poco más
de un millón de combinaciones— y la respuesta incluía `customerName` y `notes`.
Las aclaraciones son lo peor: ahí la gente escribe sus alergias.

Medido, probando códigos al azar con el límite general de 300 por minuto:

| pedidos en la base | acierta 1 de cada | pedidos ajenos por día |
| --- | --- | --- |
| 500 | 2.097 | ~205 |
| 2.000 | 524 | ~823 |
| 10.000 | 104 | ~4.119 |

**Por qué no se arregló alargando el código.** Es corto a propósito: se canta
en voz alta en el mostrador. Alargarlo rompe eso.

**El arreglo**: con el código solo salen el estado, los platos y el importe
—lo que hace falta para seguir el pedido y para que el mostrador lo busque—.
El nombre y las aclaraciones salen únicamente si quien pregunta manda el
`guestId` del dispositivo que lo hizo. Y la ruta tiene ahora un límite propio
de 30 cada diez minutos: un comensal mirando cómo va lo suyo no se acerca, y
enumerar deja de rendir.

Cubierto por `apps/api/test/order-lookup.test.ts`.

## Hallazgo 2: tres respuestas se servían sin cabeceras de seguridad

**Dónde**: `apps/web/nginx.conf`.

En nginx, un bloque que define sus propios `add_header` **descarta los
heredados**. Tres bloques definían el suyo para el cacheo —`/assets/`, los
`.glb`/`.usdz`, y `/sw.js`— y con eso perdían `X-Content-Type-Options`,
`X-Frame-Options` y `Referrer-Policy`.

El que más importa es **`/sw.js`**: un service worker controla todo el origen.

Verificado contra nginx de verdad, antes y después:

```
ANTES                                    DESPUÉS
/            nosniff: sí                 /            nosniff: sí
/sw.js       nosniff: NO                 /sw.js       nosniff: sí
/assets/*.js nosniff: NO                 /assets/*.js nosniff: sí
```

El arreglo repite las cabeceras en esos tres bloques, que es el camino que
deja nginx.

---

## Lo que se verificó y está bien

| Qué | Cómo quedó |
| --- | --- |
| **Inyección SQL** | Todas las consultas crudas son *tagged templates* parametrizados. No hay `$queryRawUnsafe` ni interpolación de strings en ninguna. |
| **Aislamiento entre restaurantes** | El `tenantId` sale siempre del token, nunca de la petición. Las consultas crudas nuevas (búsqueda, analítica, privacidad) filtran todas por él. 33 pruebas dedicadas. |
| **Webhooks de pago** | Los tres —pedidos, abono, configuración inicial— exigen firma y responden 401 sin el secreto, en vez de aplicar a ciegas. |
| **Importes** | Se verifican contra la pasarela, no contra el cuerpo del aviso. Un cobro de un peso no acredita nada. |
| **Idempotencia** | Los avisos se registran antes de aplicarse: un reintento no corre el período ni acredita dos veces. |
| **Ticket del KDS** | Viaja en una URL, así que **no** sirve como sesión del backoffice. Esto fue un agujero real que encontró la primera tanda de pruebas de aislamiento. |
| **Contraseñas** | bcrypt con 12 rondas, consistente en los tres lugares donde se hashea. Se compara contra un hash ficticio cuando el usuario no existe, para que el tiempo no delate qué correos están registrados. |
| **Recuperación de contraseña** | Token hasheado en la base, de un solo uso, vence en una hora. Vencido, usado e inexistente dan el mismo error. El correo se despacha sin esperarlo para que el reloj no delate si la cuenta existe. |
| **Subidas** | Lista blanca de tipos con verificación de *magic bytes*, nombres generados por el servidor (32 hex + extensión conocida), y una expresión regular que gatea las lecturas: no hay forma de pedir un archivo de afuera. Tope de 25 MB. |
| **Tipo servido** | Sale siempre de la extensión que generó el servidor, nunca de lo que mandó quien subió. No hay XSS almacenado por ahí. |
| **Errores** | Un 500 devuelve un mensaje genérico; el detalle solo va al log. No se filtra el esquema ni el stack. |
| **Secretos** | No se registran ni se devuelven. La API se niega a arrancar con el `JWT_SECRET` de desarrollo. |
| **CSP** | Medida contra la aplicación, sin violaciones en la carta, el visor 3D, el mapa y las siete pantallas del backoffice. |
| **Dependencias** | `npm audit` en cero. |

---

## Decisiones tomadas a conciencia

Cosas que un revisor podría marcar y que están así por una razón.

**El `guestId` alcanza para ver y borrar los datos del comensal.** Quien lo
conozca puede hacerlo. Es un valor al azar de 96 bits que solo existe en ese
navegador: no se manda por correo, no aparece en una URL compartible ni en el
ticket. La alternativa sería pedirle una cuenta al comensal, que es
exactamente el dato que el producto evita pedir. Las rutas llevan un límite más
estricto que el resto.

**El token de sesión vive en `localStorage`.** Queda expuesto a XSS. Se eligió
así porque la PWA habla con la API por otro origen en desarrollo y una cookie
`SameSite` complica ese camino. La mitigación real es la CSP, que no permite
scripts en línea. Si alguna vez se sirve todo desde el mismo origen, conviene
revisarlo.

**Con `s3` no se verifican los *magic bytes*.** El archivo va directo al bucket
con URL firmada y la API nunca ve los bytes. Lo acota que quien sube tiene que
estar autenticado en el backoffice y que el tipo servido sale de la extensión
que elige el servidor: lo peor que puede pasar es un modelo que no se ve.

---

## Lo que esta revisión no cubre

- **Una auditoría externa.** Esto es una revisión desde adentro.
- **Los cobros contra cuentas reales.** La lógica está verificada; una
  transacción real no.
- **La configuración del servidor donde se despliegue**: TLS, firewall, acceso
  a la base, rotación de secretos. Ver [LANZAMIENTO.md](LANZAMIENTO.md).
- **Ataques de denegación de servicio** más allá de los límites por IP.
