# Textos legales

**Esto es un borrador técnico, no asesoramiento legal.** Lo escribió quien
escribió el código, y por eso tiene una ventaja y un límite.

La ventaja: cada afirmación sobre qué datos se guardan, con quién se comparten y
qué pasa al borrarlos está verificada contra la implementación, no copiada de una
plantilla. Cuando el texto dice que la analítica no se puede vincular a una
persona, es porque no existe la columna que las uniría. Cuando dice que los datos
de la tarjeta no pasan por Men-3D, es porque se puede leer el payload que se le
manda a MercadoPago.

El límite: hay párrafos que fijan responsabilidad y plazos, y esos no los puede
escribir un programador. Están **vacíos a propósito** y listados más abajo.

**Nada de esto se publica hasta que lo revise un profesional.**

---

## Dónde está cada cosa

| Archivo | Qué es |
| --- | --- |
| `apps/web/src/legal/privacidad.md` | Política de privacidad. |
| `apps/web/src/legal/terminos.md` | Términos del servicio (plataforma ↔ restaurante). |
| `apps/web/src/legal/terminos-comensal.md` | Términos para el comensal. |
| `apps/web/src/legal/empresa.ts` | **Los datos a completar.** Un solo lugar. |

Están en `apps/web/src` y no en `docs/` por una razón: son parte del producto y
se sirven desde ahí. El historial de git es el registro de cambios que la propia
política promete en su cláusula de cambios.

Se ven en `/legal/privacidad`, `/legal/terminos` y `/legal/terminos-comensal`,
enlazados desde el pie de la portada, desde el aviso de consentimiento y desde
la pantalla de datos del comensal.

---

## Mientras falte algo, la página lo dice

Los textos usan marcadores `{{ASI}}` que se completan desde `empresa.ts`.
Mientras alguno siga vacío:

- la página muestra arriba un aviso de borrador con la cuenta de lo que falta,
  agrupado por quién lo completa, y
- donde falta un dato, el texto dice **«FALTA: NOMBRE»** en lugar de inventarlo.

Es deliberado: una política de privacidad a medio llenar es peor que ninguna,
porque parece una. Hoy faltan **22** datos.

Cuando no falte ninguno, el aviso desaparece solo. Hay que acordarse de
actualizar las dos afirmaciones del final de `e2e/legal.spec.ts`, que hoy
comprueban justamente que el aviso **está**.

---

## 1. Lo que completás vos (15)

Datos y decisiones de negocio. No necesitan abogado.

| Marcador | Qué poner |
| --- | --- |
| `RAZON_SOCIAL` | El nombre legal de la sociedad o la persona que opera Men-3D. |
| `CUIT` | El CUIT de esa persona o sociedad. |
| `DOMICILIO` | Domicilio legal. Es obligatorio informarlo. |
| `EMAIL_PRIVACIDAD` | Casilla que alguien lea de verdad: la ley da 10 días corridos para contestar un pedido de acceso y 5 hábiles para una rectificación. |
| `EMAIL_LEGAL` | Casilla para los temas de contrato y baja. Puede ser la misma. |
| `FECHA_VIGENCIA` | La fecha desde la que rige la versión publicada. |
| `VERSION` | Un número de versión, p. ej. `1.0`. Sirve para saber qué aceptó cada quien. |
| `PROVEEDOR_ALMACENAMIENTO` | El proveedor S3 que quede configurado (`STORAGE_DRIVER=s3`). |
| `PLAZO_PEDIDOS` | Cuánto se conservan los pedidos. Lo condiciona el plazo de guarda de comprobantes de la AFIP, así que conviene confirmarlo con el contador. |
| `PLAZO_ANALITICA` | Cuánto se conservan los eventos. El panel anual necesita 12 meses; más que eso es decisión tuya. |
| `PLAZO_CUENTA` | Cuánto se conservan los datos de un restaurante después de la baja. |
| `PLAZO_LOGS` | Cuánto se conservan los registros del servidor, que incluyen direcciones IP. 30 o 90 días son lo habitual. |
| `PLAZO_REVOCACIONES` | Cuánto se conservan los pedidos del botón de arrepentimiento. Son el comprobante de un derecho ejercido: conviene que sea largo. |
| `PREAVISO_PRECIO` | Con cuánta anticipación avisás un aumento. |
| `PREAVISO_TERMINOS` | Con cuánta anticipación avisás un cambio de términos. |

Dos ya están completos y salen del código: `DIAS_GRACIA` (7, de
`billing/service.ts`) y `PROVEEDOR_CORREO` (Resend). Si cambia el código,
cambian acá.

## 2. Lo que necesita un abogado (7)

No están vacíos por falta de tiempo. Cada uno define quién paga cuando algo sale
mal, y escribirlos sin saber es exactamente el error que hace que un contrato no
sirva cuando hace falta.

| Marcador | La pregunta concreta |
| --- | --- |
| `TRANSFERENCIAS_INTERNACIONALES` | **El más importante.** Resend, el almacenamiento y Anthropic operan fuera del país. El art. 12 de la Ley 25.326 prohíbe transferir datos a países sin protección adecuada, salvo que se encuadre en una excepción o se firmen cláusulas contractuales. Hay que decidir el encuadre y redactar el párrafo. |
| `LIMITACION_RESPONSABILIDAD` | Hasta dónde responde Men-3D ante el restaurante. Un tope habitual es lo abonado en los últimos N meses. |
| `JURISDICCION` | Qué tribunales. Ojo: una cláusula de prórroga de jurisdicción puede ser abusiva frente a un consumidor. |
| `RESPONSABILIDAD_CADENA` | El art. 40 de la Ley 24.240 hace solidariamente responsable a toda la cadena frente al consumidor. Hay que decir con precisión qué rol asume Men-3D en la venta del restaurante al comensal, porque de eso depende si responde. |
| `REEMBOLSOS` | Si se devuelve proporcional al dar de baja, y qué pasa con el cargo de configuración inicial. |
| `SLA` | Si se compromete disponibilidad, y qué pasa si no se cumple. |
| `IMPUESTOS` | Si los precios publicados llevan IVA incluido. Cambia cómo se muestran. |

---

## 3. Tres deberes que el texto no resuelve

Esto apareció al verificar el marco y **no son textos**: son trámites y, uno de
ellos, código que todavía no existe.

### 3.1 Inscribir la base de datos — trámite

El art. 21 de la Ley 25.326 obliga a inscribir las bases de datos personales en
el **Registro Nacional de Bases de Datos** de la AAIP. Sólo quedan afuera las de
uso exclusivamente personal, que no es el caso. Se hace por Trámites a Distancia
(TAD) y hay que mantenerlo actualizado.

### 3.2 Acuerdo de encargado con cada restaurante — borrador legal

Men-3D trata los datos de los comensales **por cuenta del restaurante**: es
encargado del tratamiento, art. 25. Los términos del servicio ya lo declaran,
pero la **Resolución AAIP 47/2018** fija qué tiene que contener ese acuerdo
—finalidad, categorías de datos, medidas de seguridad, subcontratación,
devolución o destrucción al terminar—. Eso es un documento aparte, y lo redacta
un abogado.

Nota técnica para quien lo redacte: el encargado responde solidariamente por sus
subcontratistas. Los subcontratistas de hecho son los cinco proveedores de la
tabla de la política de privacidad.

### 3.3 Botón de arrepentimiento — **hecho**

La **Resolución 424/2020** de la Secretaría de Comercio Interior obliga a quien
vende bienes o servicios por web o aplicación a publicar un enlace llamado
**BOTÓN DE ARREPENTIMIENTO**. Está implementado, y así se cumple cada exigencia:

| Lo que pide la norma | Cómo se cumple |
| --- | --- |
| Acceso directo desde la página principal, destacado por tamaño y visibilidad | Un botón en la portada, con el nombre exacto de la norma. No es uno de los enlaces chicos del pie. |
| No exigirle registrarse ni ningún otro trámite | No hay sesión, no hay restaurante asociado, y los únicos campos obligatorios son el nombre y el correo. Identificar la contratación es opcional: *«si no lo tenés a mano, dejalo vacío»*. |
| Informarle el código de revocación dentro de 24 horas, por el mismo medio | Se le muestra en pantalla en el acto —mismo medio, cero horas— y además se le manda por correo. |

Vive en `/arrepentimiento`; el endpoint es `POST /api/arrepentimiento` y los
pedidos quedan en la tabla `RevocationRequest` con su código y su fecha.

**Dos cosas que hay que saber:**

- **Definí `LEGAL_EMAIL`.** El código se le informa solo, pero *honrar* la
  revocación —dar de baja y reintegrar— lo hace una persona. Sin esa casilla el
  pedido queda guardado y nadie se entera. Ver [DEPLOY.md](../DEPLOY.md).
- **Queda una pregunta para el abogado:** si esto aplica también a la venta del
  restaurante al comensal, además de a la suscripción del restaurante. Lo
  implementado cubre la segunda, donde Men-3D es claramente quien vende. Para la
  primera hay dos razones para dudar —un plato servido difícilmente admita
  revocación, y ahí quien vende es el local— pero el art. 40 de la Ley 24.240
  mete a toda la cadena, así que la respuesta no es obvia. Si la respuesta es
  que sí, hace falta un botón por carta y no uno en la portada.

## 4. Lo que el marco legal **no** obliga y hacemos igual

Para que quien revise no lo confunda con un requisito:

- **El consentimiento previo para medir.** Argentina no tiene una norma de
  cookies equivalente a la europea. El aviso que corta la analítica hasta que el
  comensal responde es una decisión del producto, no un deber.
- **El acceso y el borrado con un botón, en el momento.** La ley exige
  atenderlo en plazos; no exige automatizarlo. Está automatizado igual.

---

## 5. Cuando esté revisado

1. Completar `apps/web/src/legal/empresa.ts`.
2. Aplicar en los `.md` lo que marque el abogado.
3. Fijar `FECHA_VIGENCIA` y `VERSION`.
4. Actualizar las dos afirmaciones del final de `e2e/legal.spec.ts`, que hoy
   comprueban que el aviso de borrador está visible.
5. Verificar que el aviso ya no aparece: `npm run build && npm run e2e`.

El marco que se usó para redactar: **Ley 25.326** y su normativa complementaria
(Res. AAIP 47/2018), **Ley 24.240** de Defensa del Consumidor y la **Res.
424/2020 SCI**. Al momento de escribir esto la Ley 25.326 sigue vigente, con
tres proyectos de reforma presentados en el Congreso y ninguno votado: si alguno
se sanciona, hay que volver sobre la política de privacidad, porque los
proyectos agregan derechos nuevos —portabilidad y oposición a decisiones
automatizadas— que hoy el texto no menciona.
