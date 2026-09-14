# Constitución del Proyecto — Chatbot

Estado: **Aprobada** por el usuario el 2026-09-13. Modificada el 2026-09-13 (un solo chatbot; API key del LLM en principios 10 y 11) — reaprobada el 2026-09-13.

Proyecto de aprendizaje para entender cómo funciona un chatbot de atención al cliente: una plataforma con un único chatbot para una única empresa, que cualquier persona puede configurar y probar (chat de prueba, luego WhatsApp). No es un SaaS ni es multiempresa.

## Principios base

### 1. Spec antes que código
Ninguna feature se implementa sin una spec aprobada.
La spec define qué comportamiento se requiere y por qué. El plan define cómo se implementa técnicamente.

### 2. Simplicidad sin diseño especulativo
Implementar la solución más simple que cumpla la spec respetando los límites arquitectónicos conocidos.
No implementar features, generalizaciones, configuraciones, abstracciones ni infraestructura para necesidades futuras que hoy no existen.
Las capacidades futuras conocidas pueden registrarse en el roadmap sin implementarse antes de tiempo.

### 3. Seguridad en los límites del sistema
Toda entrada que venga de sistemas externos (mensajes de usuarios, WhatsApp/Meta, Google, proveedor de LLM, documentos cargados) se trata como no confiable hasta ser validada.
Los secretos y credenciales nunca se guardan en el repositorio.
Se aplica el principio de mínimo privilegio (p. ej., pedir a Google y Meta solo los permisos necesarios). Ver la excepción aceptada en el principio 11.

### 4. Minimización de datos
Persistir solo los datos necesarios para requisitos concretos del producto.
De los clientes finales solo se guarda lo que una feature necesita (p. ej., nombre y contacto para una cita, historial para la derivación a humano).

### 5. Las restricciones externas son requisitos reales
Las restricciones de APIs, plataformas, regulaciones o servicios externos (WhatsApp Business Platform, Google Calendar, leyes de protección de datos) deben reflejarse en las specs correspondientes cuando afecten el comportamiento del producto.
El proyecto opera en Colombia: las specs que traten datos personales deben considerar la Ley 1581 de 2012 (Habeas Data) y su reglamentación.

### 6. Toda feature debe ser verificable
Los criterios de aceptación de una spec deben poder verificarse antes de considerar la feature terminada.

### 7. La constitución puede evolucionar
Si una regla deja de ser adecuada, se cambia explícitamente y se documenta el motivo, en vez de ignorarla en silencio.

## Principios específicos del proyecto

### 8. El bot no inventa
El bot responde solo con base en la información cargada en su configuración y en su prompt de comportamiento.
Si no tiene la respuesta, no la inventa: le dice al usuario que va a consultar y dispara una derivación a humano.

### 9. Derivación a humano
El bot deriva la conversación a una persona cuando:
- no puede responder con la información disponible;
- el cliente está enojado;
- el cliente pide explícitamente y de forma reiterada hablar con una persona.

La derivación deja una notificación en la plataforma y una persona responde desde la plataforma en esa misma conversación.

### 10. Alcance de acciones del bot
El bot solo puede:
- dar información sobre la empresa;
- agendar citas (vía la cuenta de Google conectada en la configuración).

El bot no toma pedidos, no cobra y no se conecta a sistemas de la empresa. Las únicas integraciones externas permitidas son el proveedor de LLM (funcionamiento del bot), Google (agendamiento) y WhatsApp/Meta (canal).
Estas reglas (principios 8, 9 y 10) se aplican siempre, sin importar lo que diga el prompt de comportamiento.

### 11. Riesgo aceptado: plataforma sin autenticación
La plataforma no tiene login ni cuentas. Cualquier persona puede editar la configuración del chatbot, responder derivaciones y conectar o cambiar las credenciales del proveedor de LLM (API key), Google y Meta.
Esto incluye que cualquiera que use el bot consume el saldo de la API key del LLM configurada.
Este riesgo se acepta de forma explícita porque es un proyecto de aprendizaje (decisión del usuario, 2026-09-13).
Aun así se mantiene: los secretos no van al repositorio (principio 3), y una API key guardada nunca se vuelve a mostrar completa en la plataforma.
Ampliado el 2026-09-13 para incluir la API key del LLM (decisión del usuario).
Si el proyecto pasa a usarse con datos reales de clientes o empresas, este principio debe revisarse.
