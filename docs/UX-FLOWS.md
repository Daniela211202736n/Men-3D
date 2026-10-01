# Flujos de usuario

## A. El comensal: del QR al pedido

```
  Escanea el QR de la mesa
            │  /m/don-pepe?t=<token>&mesa=5
            ▼
  ┌─────────────────────────────┐   La mesa queda recordada · se cuenta el escaneo
  │  CARTA                      │   Se detecta el idioma del teléfono
  │  buscador · filtros · lista │   Branding del restaurante aplicado
  └─────────┬───────────────────┘
            │ toca un plato
            ▼
  ┌─────────────────────────────┐
  │  FICHA DEL PLATO            │
  │  ┌───────────────────────┐  │   El visor carga al entrar en pantalla
  │  │   VISOR 3D            │  │   Arrastra para girar · pinza para acercar
  │  │   [Ver en mi mesa]    │──┼─► RA: el plato a escala real sobre la mesa
  │  └───────────────────────┘  │
  │  porción · kcal · alérgenos │
  │  ingredientes · opiniones   │
  │  "Combina bien con…"        │
  └─────────┬───────────────────┘
            │ Agregar al pedido
            ▼
  ┌─────────────────────────────┐
  │  PEDIDO                     │   Total calculado con la misma función
  │  cantidades · notas · puntos│   que usa el servidor al cobrar
  └─────────┬───────────────────┘
            │ Pagar
            ▼
  ┌─────────────────────────────┐
  │  SEGUIMIENTO  ·  código A7F3│   Se refresca cada 15 s mientras está vivo
  │  Pagado → En cocina → Listo │   (cada 5 s mientras se acredita el pago);
  └─────────────────────────────┘   deja de pedir al llegar a un estado final
```

**Con MercadoPago** el paso de pagar ocurre fuera de la app: el comensal sale al
checkout y vuelve al seguimiento de su pedido. Si vuelve antes de que el pago se
acredite, la pantalla lo dice con todas las letras —"si ya pagaste, puede tardar
unos segundos; no hace falta que pagues de nuevo"— y se actualiza sola. Y si
cierra la pestaña sin volver, el pedido entra a cocina igual: lo confirma el
webhook, no su navegador.

### Detalles que importan

**Buscar.** Se escribe en el buscador y la lista se filtra sola, con 260 ms de
espera: escribir "milanesa" son ocho pulsaciones y no tiene sentido pegarle ocho
veces al servidor desde un celular. Cada búsqueda queda registrada con cuántos
resultados devolvió, así que las que no encuentran nada aparecen en el panel del
restaurante como huecos de carta.

**Filtrar por alergia.** El panel de filtros muestra las 14 declaraciones
obligatorias y las dietas. El botón de aplicar dice cuántos platos quedan y se
actualiza mientras se tocan los filtros, para que nadie aplique a ciegas. Las
dietas se acumulan (celíaco **y** vegano); los alérgenos se excluyen, trazas
incluidas.

**Ver en 3D.** El visor aparece al entrar en pantalla, no antes. El botón de RA
solo se muestra si el dispositivo realmente puede: en una laptop no aparece, en
un celular sí. Si el modelo no carga, queda la foto en vez de un hueco.

**Cambiar de idioma.** Si el teléfono está en inglés y el restaurante ofrece
inglés, la carta abre en inglés —verificado en la prueba de navegador. El selector
permite cambiarlo y la elección se recuerda.

**Pedir.** Si el plan del restaurante no incluye pedido online, el carrito
directamente no existe en la interfaz.

---

## B. El dueño: de cero a carta publicada

```
  Crear cuenta ──► Crear categorías ──► Cargar platos ──► Subir modelos 3D
       │                                                         │
       │  14 días de plan Pro, sin tarjeta                        │ aviso si > 3 MB
       ▼                                                         ▼
  Personalizar marca ──► Generar QR por mesa ──► Imprimir el PDF ──► Publicada
       │                                                              │
       └─ colores, logo, portada                                      │
          (contraste del texto calculado)                             ▼
                                                        Compartir por WhatsApp/mail
```

**Cambiar un precio** —lo que un dueño hace diez veces por semana— es editar el
campo en la misma fila de la tabla y salir del campo. No abre ningún formulario.

**Marcar un plato agotado** es un toque en la columna de disponibilidad, con
respuesta optimista: el interruptor se mueve al instante y se revierte solo si el
servidor rechaza.

**Reordenar** la carta mueve el plato con las flechas y guarda el orden completo.

---

## C. La cocina: el turno

```
  ┌──────────┬──────────────┬──────────┬──────────┐
  │ Pagado   │ En cocina    │ Listo    │ Servido  │
  ├──────────┼──────────────┼──────────┼──────────┤
  │  A7F3    │  B2K9        │          │  (3 h)   │
  │  Mesa 5  │  Mesa 2      │          │          │
  │  2× Mila │  1× Provoleta│          │          │
  │  12 min  │  22 min ⚠    │          │          │
  │ [Tomar]  │ [Listo]      │          │          │
  └──────────┴──────────────┴──────────┴──────────┘
             ▲
             │ los pedidos nuevos entran solos (SSE)
```

Un pedido que lleva más de 15 minutos se marca con borde grueso además del color,
para que se lea sin depender de distinguir tonos. La columna de servidos se acota
a las últimas 3 horas y a 20 tickets: la cocina necesita ver el turno, no el
histórico del mes.

Si se corta la conexión, el indicador pasa a "Reconectando" y reintenta con
espera creciente hasta 30 segundos.

---

## D. El dueño mirando las métricas

El panel responde en el orden en que se pregunta:

1. **Cuánto entró** y cuánta gente vino (indicadores arriba).
2. **Qué platos se miran y cuáles se venden** —el gráfico principal, con la
   conversión de cada uno a la derecha de las barras.
3. **Cómo evolucionó** día a día.
4. **Dónde se cae la gente** entre abrir la carta y pedir.
5. **Qué busca y no encuentra.**

El hallazgo que justifica el producto se ve de un vistazo: en los datos de
demostración, el flan tiene 132 vistas en 3D y 2 ventas (1,5 %), contra 39,7 % de
la milanesa. Es un plato que gusta mirar y nadie pide —algo que un menú de papel
nunca podría contar.

Cada gráfico tiene un botón "Ver tabla" con los mismos datos en texto, tanto para
lectores de pantalla como para quien quiere el número exacto.

---

## E. Sumar al equipo y recuperar el acceso

Dos flujos que no se ven en una demostración pero deciden si un restaurante
puede operar solo, sin que alguien lo acompañe de la mano.

### Sumar a alguien

El dueño entra a **Equipo**, toca "+ Sumar a alguien", y carga nombre, email,
una contraseña inicial y el rol: **Administrador** (carta, precios, marca,
métricas y equipo) o **Cocina** (solo el KDS). La contraseña inicial se la pasa
él en persona; el otro la cambia después desde su propia cuenta.

Cada ficha muestra el último acceso, que responde la pregunta que de verdad se
hacen: *¿este sigue entrando?*

**Lo que la pantalla no ofrece** importa tanto como lo que ofrece. Nadie se ve
un botón para cambiarse el rol a sí mismo, ni para darse de baja, ni para
degradar al único dueño: son reglas que el servidor rechaza igual, y un botón
cuyo único efecto posible es un mensaje de error es una promesa rota. Un
administrador tampoco ve acciones sobre el dueño.

Traspasar la titularidad es la única forma de que haya un dueño nuevo, pide
confirmación, y es un intercambio: el dueño pasa a administrador en la misma
operación. Nunca hay dos dueños ni ninguno.

Un usuario de cocina no ve "Equipo" en el menú. La diferencia con una función
bloqueada por plan es deliberada: lo que falta por plan se muestra con candado
—está a un pago de distancia, mostrarlo es la oferta— pero un mozo no puede
comprarse el permiso. Si llega a la URL igual, la pantalla le explica de quién
depende el cambio en vez de mostrarle un error.

### Recuperar el acceso

En el login hay un enlace "Olvidé mi contraseña". Se pide con el email y la
respuesta es **siempre la misma**, exista o no la cuenta: "si existe una cuenta
con ese correo, va a recibir un enlace". Decir "ese email no está registrado"
sería cómodo para quien se equivocó de cuenta, y una lista de clientes para
cualquiera con tiempo.

El enlace vence en una hora y sirve una sola vez. Un enlace vencido, uno ya
usado y uno inventado dan exactamente el mismo mensaje, por lo mismo: probar
enlaces al azar no tiene que enseñar nada. Al fijar la contraseña nueva, el
sistema devuelve al login en vez de abrir la sesión solo —entrar con la
contraseña recién elegida es lo que confirma que quedó bien.

En desarrollo no hace falta un servidor de correo: con `MAIL_DRIVER=log` el
correo entero sale por la consola de la API, con el enlace listo para pegar.
