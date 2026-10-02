-- Idioma en el que el comensal hizo el pedido.
--
-- Sin esto, el correo de confirmacion de alguien que navego la carta en ingles
-- saldria en español: el pedido no guardaba en que idioma se hizo.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "locale" TEXT;
