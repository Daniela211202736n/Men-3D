# Política de privacidad

**Vigente desde {{FECHA_VIGENCIA}}.** Versión {{VERSION}}.

Esta política explica qué datos personales trata {{RAZON_SOCIAL}} ("Men-3D",
"nosotros") al operar la plataforma de cartas 3D que usás, para qué los usa,
con quién los comparte y cómo podés controlarlos.

Está escrita para que la entienda la persona a la que le afecta. Donde hay algo
que puede sorprender —que borrar tus datos no borra el pedido, por ejemplo— lo
decimos en el lugar donde corresponde y no en una nota al pie.

El tratamiento se rige por la **Ley 25.326 de Protección de los Datos
Personales** de la República Argentina y su normativa complementaria.

---

## 1. Quién responde por tus datos

Hay dos relaciones distintas, y conviene no confundirlas porque de eso depende a
quién le reclamás.

**Si sos un comensal**, el **responsable** de tus datos es el restaurante cuya
carta estás mirando: es quien decide pedirte el nombre, quien usa tu pedido y
quien te vende la comida. Men-3D es el **encargado del tratamiento** en los
términos del artículo 25 de la Ley 25.326: tratamos esos datos por cuenta del
restaurante, siguiendo sus instrucciones y sólo para prestarle el servicio. No
los usamos para fines propios, no los vendemos y no los cruzamos entre
restaurantes.

**Si sos un restaurante** que contrató la plataforma, el responsable de los
datos de tu cuenta y de tu facturación es Men-3D.

El nombre y los datos de contacto del restaurante están en la página del local,
dentro de su propia carta. Los nuestros están al final de este documento.

---

## 2. Qué datos tratamos, y para qué

### 2.1 Si sos comensal

**Un identificador de tu dispositivo.** Al abrir la carta se genera un
identificador opaco al azar (lo llamamos `guestId`) y se guarda en el
almacenamiento local de tu navegador. No es una cookie de seguimiento, no viaja
a terceros y no dice nada de vos: sirve para que tu carrito sobreviva a una
recarga, para que puedas ver el estado de tu pedido y para que no puedas dejar
dos opiniones del mismo plato. Es **por restaurante**: el mismo dispositivo en
dos locales distintos son dos identificadores sin relación entre sí.

Si borrás los datos del sitio en tu navegador, ese identificador desaparece y
con él tu forma de volver a encontrar tus pedidos.

**Lo que escribís al pedir.** Nombre, teléfono y correo electrónico son
**opcionales** y los pide el restaurante para poder avisarte que tu pedido está
listo o entregártelo. Las aclaraciones del pedido las escribís vos, y las lee la
cocina. Esos campos, más los platos, las cantidades y el importe, forman el
pedido.

**Tus opiniones.** La puntuación, el comentario y el nombre con el que firmás
(por defecto "Anónimo"). Son públicas en la carta: eso es el punto de una
opinión. No publicamos tu identificador ni ningún otro dato tuyo junto a ella.

**Tu cuenta de puntos**, si el restaurante tiene fidelidad activa: el saldo, los
puntos acumulados y, si lo diste, un correo electrónico.

### 2.2 La analítica es anónima, y no es un modo de decir

El restaurante ve cuántas veces se abrió su carta, qué platos se miraron en 3D,
cuánto tiempo y qué se buscó. Para eso guardamos eventos con un identificador de
visita (`sessionId`) que agrupa lo que pasa en una ventana de treinta minutos.

Cada evento guarda: el tipo de evento, el plato, la duración en pantalla, el
término buscado y el idioma. **No guarda tu dirección IP, ni el modelo de tu
teléfono, ni el navegador, y no existe ninguna columna, en ninguna tabla, que
ate ese identificador de visita al identificador de tu dispositivo.**

Esa ausencia es deliberada y tiene una consecuencia honesta: **no podemos
decirte cuáles de esos eventos son tuyos, ni darte una copia, ni borrarlos.** No
es que no queramos buscarlos; es que no hay forma de saberlo, ni para nosotros
ni para el restaurante. Por eso la analítica no aparece en la descarga de tus
datos ni en el borrado.

Aun así, **no medimos sin preguntarte**: la primera vez que abrís una carta te
preguntamos, y si decís que no, no se envía ni un evento. Podés cambiar de
opinión cuando quieras desde *Tus datos*, en la carta del restaurante.

### 2.3 Si sos restaurante

Tu correo electrónico y tu nombre, la contraseña guardada como hash con bcrypt
(nunca en claro, ni recuperable), los datos del local que cargás vos (dirección,
teléfono, redes, horarios), tu carta, y los datos de tu suscripción: plan,
estado, períodos y los identificadores de los cobros en la pasarela.

### 2.4 Si usaste el botón de arrepentimiento

Lo que escribiste en el formulario: tu nombre, tu correo, y si los dejaste, tu
teléfono, la referencia de la contratación y el detalle. Más el código de
revocación que te dimos y la fecha.

No te pedimos cuenta ni registro para usarlo —no podemos, la Res. 424/2020 lo
prohíbe—, así que eso es todo lo que tenemos de ese pedido. Se conserva
**{{PLAZO_REVOCACIONES}}**: es el comprobante de que ejerciste un derecho, y nos
sirve tanto a vos como a nosotros que quede.

### 2.5 Registros técnicos

Nuestros servidores dejan registros de operación que, como cualquier servidor
web, incluyen la dirección IP de origen, la hora y la ruta solicitada. Sirven
para operar el servicio, encontrar fallas y detectar abuso. Se conservan
**{{PLAZO_LOGS}}** y después se descartan.

---

## 3. Con quién compartimos datos

No vendemos datos personales. No los cedemos para publicidad. No los cruzamos
entre restaurantes. Los únicos terceros que intervienen son los que hacen falta
para que el servicio funcione, y cada uno recibe lo mínimo:

| Quién | Qué recibe | Para qué |
| --- | --- | --- |
| **MercadoPago** | El importe y una referencia del pedido. En el abono del restaurante, además, el correo del titular. | Cobrar. |
| **{{PROVEEDOR_CORREO}}** | Tu correo y el detalle del pedido. | Mandarte la confirmación. |
| **{{PROVEEDOR_ALMACENAMIENTO}}** | Los modelos 3D y las imágenes de la carta. | Servirlos rápido. Ahí no hay datos personales. |
| **OpenStreetMap** | Tu dirección IP, cuando abrís el mapa en la página del local. | Mostrar el mapa. |
| **Anthropic** | Nombres y descripciones de **platos**. | Traducir la carta y sugerir maridajes. |

Dos aclaraciones que importan:

**Los datos de tu tarjeta no pasan por Men-3D.** El pago lo cobra MercadoPago en
su propio checkout. Nosotros le mandamos cuánto hay que cobrar y una referencia
del pedido; no vemos, ni guardamos, ni podríamos guardar el número de tu
tarjeta. Lo que recibimos de vuelta es si el pago se acreditó.

**A Anthropic no le mandamos datos personales.** Las traducciones y los
maridajes se calculan con los nombres y las descripciones de los platos. Ni tu
nombre, ni tu pedido, ni tus opiniones.

Además, podemos divulgar datos cuando una norma o una orden judicial lo exija.

### Transferencias fuera del país

Algunos de esos proveedores operan en el exterior, con lo cual hay
transferencia internacional de datos en los términos del artículo 12 de la Ley
25.326. {{TRANSFERENCIAS_INTERNACIONALES}}

---

## 4. Cuánto tiempo los guardamos

| Dato | Cuánto |
| --- | --- |
| Pedidos | {{PLAZO_PEDIDOS}} (son comprobantes de venta del restaurante). |
| Identificador del dispositivo | Mientras no borres los datos del sitio en tu navegador. |
| Opiniones | Hasta que las borres o el restaurante las oculte. |
| Cuenta de puntos | Mientras el restaurante tenga fidelidad activa. |
| Analítica | {{PLAZO_ANALITICA}}, sin vínculo con ninguna persona. |
| Cuenta del restaurante | Mientras el contrato esté vigente, y después {{PLAZO_CUENTA}}. |
| Pedidos de revocación | {{PLAZO_REVOCACIONES}}. |
| Registros técnicos | {{PLAZO_LOGS}}. |

---

## 5. Tus derechos, y cómo ejercerlos sin pedirle permiso a nadie

La Ley 25.326 te da derecho a **acceder** a tus datos (art. 14), a
**rectificarlos, actualizarlos y suprimirlos** (art. 16).

Para los dos que más se usan no hace falta que escribas a nadie ni que esperes:
en la carta de cada restaurante, en **Tus datos**, podés

- **ver** todo lo que ese restaurante tiene asociado a tu dispositivo y
  descargarlo en un archivo, y
- **borrarlo**, en el momento.

Para rectificar algo, o para cualquier otro derecho, escribinos a
**{{EMAIL_PRIVACIDAD}}**. Contestamos dentro de los plazos de la ley: diez días
corridos para el acceso y cinco días hábiles para la rectificación o supresión.
Si el pedido es sobre datos de un restaurante en particular, podemos derivarlo a
ese restaurante, que es el responsable, y te lo decimos.

> La Agencia de Acceso a la Información Pública, en su carácter de Órgano de
> Control de la Ley 25.326, tiene la atribución de atender las denuncias y
> reclamos que interpongan quienes resulten afectados en sus derechos por
> incumplimiento de las normas vigentes en materia de protección de datos
> personales.

### 5.1 Lo que el borrado no borra, y por qué

Cuando pedís que se borren tus datos, **el pedido no desaparece: se anonimiza.**

Se va todo lo que apunta a una persona —nombre, teléfono, correo, las
aclaraciones que escribiste y el vínculo con tu dispositivo— y queda la
transacción: la fecha, los platos y los importes. Tus opiniones y tu cuenta de
puntos, en cambio, se borran de verdad.

El motivo es que un pedido es el comprobante de una venta que el restaurante
está obligado a conservar por su contabilidad y ante la AFIP. Si pudiéramos
hacerlo desaparecer, le romperíamos los libros al restaurante. Lo que la ley
protege es que ese registro no te identifique, y eso es exactamente lo que
hacemos.

Te lo decimos antes de que confirmes, en la misma pantalla, no acá.

---

## 6. Seguridad

Tomamos las medidas técnicas y organizativas que exige el artículo 9 de la Ley
25.326. En concreto, y para que se pueda verificar:

- Todo el tráfico va cifrado con TLS.
- Las contraseñas se guardan con bcrypt (12 rondas). No son recuperables.
- Los datos de cada restaurante están aislados de los de los demás, y ese
  aislamiento está cubierto por pruebas automáticas que corren en cada cambio.
- El acceso al panel exige sesión y respeta roles: quien trabaja en la cocina no
  ve la facturación.
- Hacemos respaldos cifrados, y probamos la restauración de forma automática
  —un respaldo que nunca se restauró no es un respaldo.

Ningún sistema es invulnerable. Si detectamos un incidente que afecte tus datos,
te lo comunicaremos junto con el restaurante y a la autoridad cuando
corresponda.

---

## 7. Menores de edad

La plataforma está pensada para que la use una persona adulta. No pedimos la
edad ni tratamos datos de menores a sabiendas. Si creés que un menor a tu cargo
cargó datos, escribinos a {{EMAIL_PRIVACIDAD}} y los borramos.

---

## 8. Cambios

Si cambiamos esta política, publicamos la versión nueva acá con su fecha. Si el
cambio afecta de forma sustancial cómo tratamos tus datos, lo avisamos en la
aplicación antes de que entre en vigencia.

El historial completo de cambios de este texto está en el repositorio del
proyecto: cada modificación queda registrada con su fecha y su motivo.

---

## 9. Contacto

{{RAZON_SOCIAL}}
CUIT {{CUIT}}
{{DOMICILIO}}
Privacidad: **{{EMAIL_PRIVACIDAD}}**
