/**
 * Recuperacion de contraseña.
 *
 * Decisiones que importan:
 *
 *  - **Se guarda el hash del token, no el token.** El enlace lleva el secreto en
 *    claro, pero en la base solo queda su SHA-256: con acceso de lectura a la
 *    base no se puede fabricar el enlace de nadie.
 *  - **Pedir un restablecimiento siempre responde lo mismo**, exista o no la
 *    cuenta. Si no, el formulario se convierte en un detector de qué emails
 *    estan registrados. El cuerpo igual no alcanza: si la respuesta esperara al
 *    envio del correo, tardaria cientos de milisegundos con una cuenta real y
 *    unos pocos con una inexistente, y el reloj diria lo que el texto calla. Por
 *    eso el correo se despacha sin esperarlo.
 *  - **Un token sirve una vez y caduca en una hora.** Al usarlo se invalidan
 *    tambien los demas de ese usuario: si alguien pidio varios enlaces, el
 *    primero que se use cierra la puerta.
 */
import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { env } from '../../env.js';
import { badRequest } from '../../lib/errors.js';
import { prisma } from '../../prisma.js';
import { getMailer } from '../mail/index.js';

/** Una hora: suficiente para leer el correo, corto para un enlace con poder. */
const TTL_MINUTOS = 60;
const BCRYPT_ROUNDS = 12;

function hashDelToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Crea el token y manda el correo. No dice si la cuenta existe: quien llama
 * responde siempre lo mismo.
 */
export async function solicitarRestablecimiento(email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: { select: { name: true } } },
  });
  // Cuenta inexistente o dada de baja: no se hace nada, y el que llama responde
  // igual que si existiera.
  if (!user || !user.isActive) return;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TTL_MINUTOS * 60_000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashDelToken(token), expiresAt },
  });

  const enlace = new URL('/admin/nueva-clave', env.PUBLIC_WEB_URL);
  enlace.searchParams.set('token', token);

  // Sin await a proposito (ver la cabecera): el envio puede tardar cientos de
  // milisegundos y esa diferencia revelaria que la cuenta existe. El fallo se
  // registra, no se propaga —quien pidio el enlace no puede hacer nada con el.
  void getMailer()
    .send({
      to: user.email,
      subject: `Restablecer tu contraseña de ${user.tenant.name}`,
      text: [
        `Hola ${user.name},`,
        '',
        `Pediste restablecer la contraseña de tu cuenta en ${user.tenant.name}.`,
        'Abri este enlace para elegir una nueva:',
        '',
        enlace.toString(),
        '',
        `El enlace vence en ${TTL_MINUTOS} minutos y sirve una sola vez.`,
        'Si no fuiste vos, podes ignorar este correo: tu contraseña no cambia.',
      ].join('\n'),
    })
    .catch((error: unknown) => {
      console.error('[mail] fallo el envio del correo de recuperacion', error);
    });
}

/**
 * Cambia la contraseña si el token es valido.
 *
 * Invalida de paso el resto de los tokens del usuario: si pidio varios enlaces,
 * usar uno anula los demas.
 */
export async function restablecerContrasenia(
  token: string,
  nuevaContrasenia: string,
): Promise<void> {
  const registro = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashDelToken(token) },
    include: { user: { select: { id: true, isActive: true } } },
  });

  // Un solo mensaje para las tres formas de fallar —inexistente, usado,
  // vencido—: distinguirlas le diria a quien prueba enlaces cual acerto.
  const invalido = badRequest(
    'El enlace no es valido o ya vencio. Pedi uno nuevo.',
    'RESET_TOKEN_INVALID',
  );
  if (!registro) throw invalido;
  if (registro.usedAt) throw invalido;
  if (registro.expiresAt.getTime() < Date.now()) throw invalido;
  if (!registro.user.isActive) throw invalido;

  const passwordHash = await bcrypt.hash(nuevaContrasenia, BCRYPT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: registro.user.id },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: registro.id },
      data: { usedAt: new Date() },
    }),
    // Los demas enlaces pendientes de este usuario dejan de servir.
    prisma.passwordResetToken.updateMany({
      where: { userId: registro.user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
}

/** Cambio de contraseña desde dentro de la sesion, con la actual por delante. */
export async function cambiarContrasenia(
  userId: string,
  actual: string,
  nueva: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await bcrypt.compare(actual, user.passwordHash);
  if (!ok) throw badRequest('La contraseña actual no es correcta', 'WRONG_PASSWORD');

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(nueva, BCRYPT_ROUNDS) },
  });
}

/** Borra los tokens vencidos. Se puede llamar desde una tarea programada. */
export async function limpiarTokensVencidos(): Promise<number> {
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

export { hashDelToken, TTL_MINUTOS };
