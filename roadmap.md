# Roadmap — Chatbot

Estado: **Aprobado** por el usuario el 2026-09-13. Modificado y reaprobado el 2026-09-13 (un solo chatbot; proveedor de LLM en 001).

Estado actual: 001, 002 y 003 terminadas; 004, 005 y 006 implementadas (Jira KAN-25, KAN-35 y KAN-41), pendientes de validación del usuario. La 006 además necesita credenciales de Google para conectarse de verdad.

Objetivo: una plataforma con un único chatbot para una única empresa, que cualquiera configura con la información de la empresa, lo prueba en un chat dentro de la app, deriva a humano cuando corresponde, agenda citas y, por último, atiende por WhatsApp.

| ID  | Feature | Objetivo | Depende de | Estado |
|-----|---------|----------|------------|--------|
| 001 | Configuración del chatbot | Editar la única configuración del chatbot: nombre de la empresa, prompt de comportamiento (con uno por defecto) y proveedor de LLM, modelo y API key | — | Terminada (Jira KAN-1, 2026-09-14) |
| 002 | Base de conocimiento (RAG) | Cargar información de la empresa como texto escrito o documentos en la configuración | 001 | Terminada (Jira KAN-10, 2026-09-15) |
| 003 | Chat de prueba | Chat dentro de la app, abierto a todos, que conversa con el chatbot y responde solo con su información (sin inventar) | 001, 002 | Terminada (Jira KAN-18, 2026-09-15) |
| 004 | Derivación a humano | Detectar cuándo derivar (no sabe, cliente enojado, pedido reiterado de una persona), avisar al usuario, notificar en la plataforma y permitir que una persona responda desde ahí. Guarda todas las conversaciones, con modo IA / humano | 003 | Implementada (Jira KAN-25, 2026-09-15); pendiente de validación del usuario |
| 005 | Aprendizaje desde respuestas humanas | Que lo que responde la persona en una derivación alimente la base de conocimiento del bot, con revisión humana antes de aprender | 002, 004 | Implementada (Jira KAN-35, 2026-09-15); pendiente de validación del usuario |
| 006 | Agendamiento con Google | Conectar una cuenta de Google en la configuración y permitir que el bot agende citas | 001, 003 | Implementada (Jira KAN-41, 2026-09-15); **falta conectar una cuenta real**: requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET del usuario (KAN-46) |
| 007 | Canal WhatsApp | Conectar la cuenta de Meta/WhatsApp de la empresa para que el chatbot atienda por ese número | 003, 004, 006 | Pendiente |
| 008 | Métricas de conversaciones | Ver cuántas conversaciones resolvió el bot frente a las derivadas, y cuáles son las preguntas más frecuentes | 004 | Implementada (Jira KAN-48, 2026-09-15); pendiente de validación del usuario |
| 009 | Simulaciones del chatbot | Correr conversaciones simuladas para evaluar al bot; se guardan con origen «Simulación» | 004 | En ejecución (spec y plan aprobados 2026-09-15) |
| 010 | Mensajes multimedia | Audios, imágenes y documentos en las conversaciones, como en WhatsApp | 004 | Pendiente |

## Notas de alcance

- **Fuera de alcance:** multiempresa (varias configuraciones o chatbots), login y cuentas, tomar pedidos, cobrar, integraciones con sistemas de la empresa (salvo el proveedor de LLM, Google para agendamiento y Meta para WhatsApp).
- **Capacidades futuras:** ninguna por ahora.
- **005** podría fusionarse con 004 si al especificarlas resultan inseparables.
- **010** conviene hacerla antes o junto con la 007, porque por WhatsApp los clientes mandan audios e imágenes.
- **007** depende de 004 y 006 solo porque WhatsApp debe soportar derivación y agendamiento; si se quiere antes, se puede especificar sin ellas.
