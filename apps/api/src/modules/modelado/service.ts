/**
 * De la foto del plato al modelo colgado de la carta.
 *
 * El recorrido completo, y por que cada paso esta donde esta:
 *
 *   1. Se valida la foto **contra su firma binaria**, no contra lo que declara
 *      el cliente. Lo mismo que hace la subida de assets: un archivo renombrado
 *      no puede terminar mandado a un tercero ni servido como imagen.
 *   2. Se guarda la foto en nuestro almacenamiento. Deja de ser un dato de paso
 *      y pasa a ser la imagen del plato —si el plato no tenia—, que es lo que
 *      el restaurante queria de todas formas.
 *   3. **Se crea la fila antes de llamar al proveedor.** Es la parte importante:
 *      el indice unico parcial `ModelJob_uno_en_curso_por_plato` es lo que
 *      impide que dos toques del boton generen dos modelos y cobren dos veces.
 *      Un `if` antes de llamar pierde esa carrera; la base, no.
 *   4. Se consulta y se avanza **cuando alguien pregunta**. No hay worker ni
 *      cron: el panel pregunta cada pocos segundos y esa misma peticion empuja
 *      el trabajo. Menos piezas moviles, y un trabajo olvidado no consume nada.
 *      El costo es que un trabajo que nadie mira se queda quieto —por eso
 *      existe `VENCIMIENTO_MS`, para que no quede en curso para siempre
 *      bloqueando el plato.
 *   5. Apenas esta listo, el GLB **se baja y se guarda**. Los proveedores
 *      borran lo que generan a los pocos dias; enlazar su URL seria una carta
 *      que se rompe sola.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { badRequest, conflict, notFound } from '../../lib/errors.js';
import {
  ACCEPTED_UPLOADS,
  CONTENT_TYPES,
  getStorage,
} from '../storage/index.js';
import { comprimirGlb } from './comprimir.js';
import { getProveedor3D } from './index.js';

/** 12 MB. Una foto de celular redimensionada no llega ni cerca. */
export const MAX_FOTO_BYTES = 12 * 1024 * 1024;

/** Solo imagenes: el resto de los tipos que acepta la subida no sirven de entrada. */
const FOTOS_ACEPTADAS = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Un trabajo en curso caduca a los 30 minutos.
 *
 * Los proveedores tardan entre uno y cinco. Media hora es holgado para un dia
 * malo del otro lado, y evita que un trabajo que quedo colgado —porque el panel
 * se cerro justo— deje el plato bloqueado para siempre por el indice unico.
 */
const VENCIMIENTO_MS = 30 * 60 * 1000;

export interface TrabajoDto {
  id: string;
  dishId: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  progress: number;
  photoUrl: string | null;
  glbUrl: string | null;
  error: string | null;
  createdAt: string;
}

type FilaTrabajo = {
  id: string;
  dishId: string;
  status: string;
  progress: number;
  photoUrl: string | null;
  glbUrl: string | null;
  error: string | null;
  createdAt: Date;
};

export function aDto(fila: FilaTrabajo): TrabajoDto {
  return {
    id: fila.id,
    dishId: fila.dishId,
    status: fila.status as TrabajoDto['status'],
    progress: fila.progress,
    photoUrl: fila.photoUrl,
    glbUrl: fila.glbUrl,
    error: fila.error,
    createdAt: fila.createdAt.toISOString(),
  };
}

const SELECT = {
  id: true,
  dishId: true,
  status: true,
  progress: true,
  photoUrl: true,
  glbUrl: true,
  error: true,
  createdAt: true,
} satisfies Prisma.ModelJobSelect;

/**
 * Guarda la foto y arranca el trabajo.
 *
 * Devuelve el trabajo recien creado; el panel lo sigue preguntando por
 * `avanzar`.
 */
export async function crearTrabajo(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    dishId: string;
    foto: { bytes: Buffer; contentType: string };
  },
): Promise<TrabajoDto> {
  const dish = await prisma.dish.findFirst({
    where: { id: input.dishId, tenantId: input.tenantId, archivedAt: null },
    select: { id: true, imageUrl: true },
  });
  if (!dish) throw notFound('Plato');

  const { bytes, contentType } = input.foto;
  if (bytes.byteLength === 0) throw badRequest('La foto esta vacia');
  if (bytes.byteLength > MAX_FOTO_BYTES) {
    throw badRequest(
      `La foto pesa ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB y el maximo son ${
        MAX_FOTO_BYTES / 1024 / 1024
      } MB`,
    );
  }
  if (!FOTOS_ACEPTADAS.includes(contentType as (typeof FOTOS_ACEPTADAS)[number])) {
    throw badRequest(`Tipo de foto no admitido: ${contentType}. Se aceptan JPG, PNG y WEBP.`);
  }
  const aceptado = ACCEPTED_UPLOADS[contentType as keyof typeof ACCEPTED_UPLOADS]!;
  // El tipo lo declara el cliente; la firma del archivo es la que manda.
  if (!bytes.subarray(0, aceptado.magic.length).equals(aceptado.magic)) {
    throw badRequest('El contenido del archivo no coincide con una imagen valida');
  }

  const proveedor = getProveedor3D();

  // Antes de la fila, se libera el lugar si el trabajo anterior quedo colgado.
  await caducarVencidos(prisma, input.dishId);

  // **La fila primero, la foto despues.** Guardar la foto antes seria lo
  // natural, pero el camino que mas se recorre aca es el del segundo toque del
  // boton: ese rebota contra el indice unico, y con el orden inverso dejaria
  // una foto huerfana en el almacenamiento cada vez. Crear la fila es lo
  // barato y lo que decide si seguimos.
  let trabajo;
  try {
    trabajo = await prisma.modelJob.create({
      data: {
        tenantId: input.tenantId,
        dishId: input.dishId,
        provider: proveedor.nombre,
        status: 'QUEUED',
      },
      select: SELECT,
    });
  } catch (causa) {
    if ((causa as { code?: string }).code === 'P2002') {
      throw conflict(
        'Ya hay un modelo generandose para este plato. Espera a que termine; ' +
          'cada intento consume creditos del proveedor.',
      );
    }
    throw causa;
  }

  try {
    const storage = getStorage();
    const ticket = await storage.createUploadTicket({
      extension: aceptado.ext,
      contentType: CONTENT_TYPES[aceptado.ext] ?? contentType,
    });
    await storage.save(ticket.key, bytes, CONTENT_TYPES[aceptado.ext] ?? contentType);
    const photoUrl = ticket.publicUrl;

    // Si el plato no tenia foto, esta pasa a serlo. Si ya tenia una, no se
    // pisa: puede ser una foto profesional y esta es la de trabajo.
    if (!dish.imageUrl) {
      await prisma.dish.update({ where: { id: dish.id }, data: { imageUrl: photoUrl } });
    }

    const providerTaskId = await proveedor.crear([{ bytes, contentType }]);
    const actualizado = await prisma.modelJob.update({
      where: { id: trabajo.id },
      data: { status: 'RUNNING', providerTaskId, photoUrl },
      select: SELECT,
    });
    return aDto(actualizado);
  } catch (causa) {
    // Importa que el trabajo quede en FAILED y no en QUEUED: si no, el indice
    // unico deja el plato bloqueado por un trabajo que nunca arranco.
    const motivo = causa instanceof Error ? causa.message : String(causa);
    const fallado = await prisma.modelJob.update({
      where: { id: trabajo.id },
      data: { status: 'FAILED', error: motivo, finishedAt: new Date() },
      select: SELECT,
    });
    return aDto(fallado);
  }
}

/** Marca como fallidos los trabajos de este plato que quedaron colgados. */
async function caducarVencidos(prisma: PrismaClient, dishId: string): Promise<void> {
  await prisma.modelJob.updateMany({
    where: {
      dishId,
      status: { in: ['QUEUED', 'RUNNING'] },
      createdAt: { lt: new Date(Date.now() - VENCIMIENTO_MS) },
    },
    data: {
      status: 'FAILED',
      error: 'El trabajo quedo sin respuesta del proveedor y se dio por vencido',
      finishedAt: new Date(),
    },
  });
}

/**
 * Pregunta al proveedor y, si termino, deja el modelo colgado del plato.
 *
 * Es idempotente: llamarla con un trabajo ya terminado devuelve lo que hay sin
 * tocar nada ni gastar una consulta.
 */
export async function avanzar(
  prisma: PrismaClient,
  tenantId: string,
  jobId: string,
): Promise<TrabajoDto> {
  const trabajo = await prisma.modelJob.findFirst({
    where: { id: jobId, tenantId },
    select: { ...SELECT, providerTaskId: true, provider: true },
  });
  if (!trabajo) throw notFound('Trabajo');
  if (trabajo.status === 'READY' || trabajo.status === 'FAILED') return aDto(trabajo);

  if (trabajo.createdAt.getTime() < Date.now() - VENCIMIENTO_MS) {
    await caducarVencidos(prisma, trabajo.dishId);
    return aDto(
      (await prisma.modelJob.findUniqueOrThrow({ where: { id: jobId }, select: SELECT })),
    );
  }

  if (!trabajo.providerTaskId) return aDto(trabajo);

  const proveedor = getProveedor3D();
  let remoto;
  try {
    remoto = await proveedor.consultar(trabajo.providerTaskId);
  } catch {
    // Una consulta que falla no mata el trabajo: el proveedor puede estar
    // teniendo un mal minuto y el modelo seguir generandose. Se informa el
    // progreso que habia y se vuelve a preguntar despues.
    return aDto(trabajo);
  }

  if (remoto.estado === 'RUNNING') {
    const actualizado = await prisma.modelJob.update({
      where: { id: jobId },
      data: { progress: remoto.progreso },
      select: SELECT,
    });
    return aDto(actualizado);
  }

  if (remoto.estado === 'FAILED') {
    const actualizado = await prisma.modelJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        error: remoto.error ?? 'El proveedor no pudo generar el modelo',
        credits: remoto.creditos ?? null,
        finishedAt: new Date(),
      },
      select: SELECT,
    });
    return aDto(actualizado);
  }

  return await guardarModelo(prisma, {
    jobId,
    dishId: trabajo.dishId,
    glbRemoto: remoto.glbUrl!,
    creditos: remoto.creditos,
  });
}

/** Baja el GLB, lo valida, lo comprime, lo guarda y lo cuelga del plato. */
async function guardarModelo(
  prisma: PrismaClient,
  input: { jobId: string; dishId: string; glbRemoto: string; creditos?: number },
): Promise<TrabajoDto> {
  const proveedor = getProveedor3D();
  try {
    const crudo = await proveedor.bajar(input.glbRemoto);

    // Lo que devuelve un tercero se trata como lo que manda un cliente: si no
    // empieza con la firma de un GLB, no se guarda ni se cuelga de una carta.
    if (!crudo.subarray(0, 4).equals(Buffer.from('glTF'))) {
      throw new Error('Lo que devolvio el proveedor no es un GLB valido');
    }

    const { bytes } = await comprimirGlb(crudo);

    const storage = getStorage();
    const ticket = await storage.createUploadTicket({
      extension: 'glb',
      contentType: CONTENT_TYPES.glb!,
    });
    await storage.save(ticket.key, bytes, CONTENT_TYPES.glb!);

    // `updateMany` con el estado en el `where`: si dos consultas simultaneas
    // llegaron hasta aca, la segunda no pisa lo que escribio la primera.
    const tocadas = await prisma.modelJob.updateMany({
      where: { id: input.jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: {
        status: 'READY',
        progress: 100,
        glbUrl: ticket.publicUrl,
        credits: input.creditos ?? null,
        finishedAt: new Date(),
      },
    });
    if (tocadas.count > 0) {
      await prisma.dish.update({
        where: { id: input.dishId },
        data: { modelGlbUrl: ticket.publicUrl },
      });
    }
  } catch (causa) {
    const motivo = causa instanceof Error ? causa.message : String(causa);
    await prisma.modelJob.updateMany({
      where: { id: input.jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', error: motivo, finishedAt: new Date() },
    });
  }

  return aDto(
    await prisma.modelJob.findUniqueOrThrow({ where: { id: input.jobId }, select: SELECT }),
  );
}

/** El ultimo trabajo de un plato, para que el panel pueda retomar al recargar. */
export async function ultimoTrabajo(
  prisma: PrismaClient,
  tenantId: string,
  dishId: string,
): Promise<TrabajoDto | null> {
  const fila = await prisma.modelJob.findFirst({
    where: { tenantId, dishId },
    orderBy: { createdAt: 'desc' },
    select: SELECT,
  });
  return fila ? aDto(fila) : null;
}
