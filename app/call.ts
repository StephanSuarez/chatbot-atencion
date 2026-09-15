// Una server action puede fallar antes de responder (red caída, cuerpo que Next rechaza por tamaño):
// sin esto la pantalla se queda esperando para siempre.
export async function call<T>(action: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await action();
  } catch {
    return fallback;
  }
}
