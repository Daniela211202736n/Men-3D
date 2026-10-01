/**
 * Alta y baja de restaurantes.
 */
import { prisma } from '../../prisma.js';

/**
 * Borra un restaurante y todo lo suyo.
 *
 * No alcanza con `prisma.tenant.delete()`. El borrado en cascada del tenant
 * intenta eliminar los platos, pero `OrderItem.dishId` y `Dish.categoryId`
 * estan declarados `onDelete: Restrict` a proposito —para que nadie borre un
 * plato que figura en un pedido historico, ni una categoria con platos dentro—
 * y PostgreSQL no garantiza el orden en que resuelve las cascadas, asi que la
 * operacion choca contra esas restricciones.
 *
 * La salida correcta no es aflojar las restricciones (protegen el historico de
 * ventas) sino hacer explicito el unico camino legitimo: vaciar de adentro
 * hacia afuera, en una transaccion.
 *
 * Nota: esto borra de verdad, incluido el historico de ventas. Para dejar de
 * operar sin perder los datos, `Tenant.isActive = false` saca el restaurante de
 * circulacion y conserva todo.
 */
export async function deleteTenantCompletely(tenantId: string): Promise<void> {
  await prisma.$transaction([
    // 1. Pedidos: arrastra en cascada sus items y su pago, que son los que
    //    retienen a los platos.
    prisma.order.deleteMany({ where: { tenantId } }),
    // 2. Platos: ya sin pedidos que los referencien. Arrastra alergenos,
    //    dietas, ingredientes, traducciones, maridajes y sus reseñas.
    prisma.dish.deleteMany({ where: { tenantId } }),
    // 3. Categorias: ya sin platos dentro.
    prisma.category.deleteMany({ where: { tenantId } }),
    // 4. El resto (usuarios, marca, suscripcion, reseñas del local, eventos,
    //    puntos y QR) sale por cascada al borrar el tenant.
    prisma.tenant.deleteMany({ where: { id: tenantId } }),
  ]);
}

/** Igual que la anterior, por slug. Devuelve cuantos restaurantes borro. */
export async function deleteTenantsBySlug(slugs: string[]): Promise<number> {
  if (slugs.length === 0) return 0;
  const tenants = await prisma.tenant.findMany({
    where: { slug: { in: slugs } },
    select: { id: true },
  });
  for (const tenant of tenants) {
    await deleteTenantCompletely(tenant.id);
  }
  return tenants.length;
}
