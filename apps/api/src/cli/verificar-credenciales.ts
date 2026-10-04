/**
 * Verifica las credenciales de produccion contra los servicios de verdad.
 *
 *   npm run verificar                             # desde el fuente, con tsx
 *   npm run verificar:prod                        # desde dist, en la imagen
 *   npm run verificar -- --enviar-a vos@dominio   # y manda un correo de prueba
 *
 * El momento de correrlo es justo despues de desplegar y antes de darle la
 * direccion al primer restaurante. Sale con codigo distinto de cero si algo
 * falla, asi que sirve en un pipeline.
 *
 * Esto es solo el arranque; las comprobaciones estan en
 * modules/diagnostics/verificar.ts. La carga del modulo va con `import()` y no
 * con un import estatico a proposito: `env.ts` se niega a cargar cuando en
 * produccion falta una variable obligatoria, y asi el operador al que le falta
 * una —justo el que mas necesita este informe— recibe la linea que dice cual,
 * en vez de un stack trace de Node.
 */

/** El mensaje de un fallo, en una linea y sin el stack. */
function motivo(e: unknown): string {
  const texto = e instanceof Error ? e.message : String(e);
  return texto.split('\n')[0]?.trim() ?? 'sin detalle';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const i = args.indexOf('--enviar-a');
  const enviarA = i >= 0 ? args[i + 1] : undefined;

  let verificarCredenciales: (enviarA?: string) => Promise<number>;
  try {
    ({ verificarCredenciales } = await import('../modules/diagnostics/verificar.js'));
  } catch (e) {
    console.error('\nNo pude ni empezar: la configuracion no es valida.\n');
    console.error(`  NO  ${motivo(e)}`);
    console.error('       → corregí esa variable y volvé a correr esto.');
    console.error('          La API tampoco arranca así, por el mismo motivo.\n');
    process.exit(1);
    return;
  }

  const errores = await verificarCredenciales(enviarA);
  process.exit(errores > 0 ? 1 : 0);
}

void main().catch((e) => {
  console.error('\nEl verificador se cayo:', e);
  process.exit(1);
});
