// Next.js llama a register() una vez al iniciar el servidor: si el entorno es inválido, la app no arranca.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnv } = await import("./lib/env");
    checkEnv();
  }
}
