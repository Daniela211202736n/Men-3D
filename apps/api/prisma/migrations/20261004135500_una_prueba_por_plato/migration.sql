-- Un plato puede tener UNA prueba corriendo a la vez.
--
-- Va a mano porque es un indice unico PARCIAL y Prisma no sabe expresarlos: un
-- `@@unique([dishId, status])` del esquema tambien impediria tener dos pruebas
-- cerradas sobre el mismo plato, que es justamente el historial que uno quiere
-- conservar.
--
-- Sin esto, dos pruebas simultaneas sobre el mismo precio se pisan: cada
-- dispositivo recibe la variante de una o de otra segun el orden en que salgan
-- de la consulta, y los resultados de las dos quedan sin sentido. Es el tipo de
-- fallo que no se nota hasta que alguien toma una decision de precios con esos
-- numeros.
CREATE UNIQUE INDEX "Experiment_una_corriendo_por_plato"
  ON "Experiment" ("dishId")
  WHERE "status" = 'RUNNING';
