// Módulo sin dependencias: lo usan el cliente y las server actions. El servicio importa la base
// de datos, así que una constante suya no puede viajar al navegador.

// Lo que escribe el equipo tiene el mismo tope que lo que escribe un cliente (spec 003, FR-004).
export const MAX_REPLY = 1000;
