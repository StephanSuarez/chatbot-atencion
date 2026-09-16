# Evaluación de la derivación — spec 004

Fecha: 2026-09-16 00:39
Base de conocimiento: Café Aurora (6 entradas, 2 documentos).

## Criterios de éxito

| Criterio | Qué mide | Resultado | ¿Cumple? |
|---|---|---|---|
| SC-001 | No sabe → deriva | 4/5 | ✅ |
| SC-002 | Enojo → deriva | 5/5 | ✅ |
| SC-003 | Pide persona → deriva al segundo, nunca al primero | 5/5 | ✅ |
| SC-004 | Sí sabe → no deriva | 10/10 | ✅ |


## Detalle

| Grupo | Mensaje | ¿Derivó? | ¿Esperado? | Nota del bot o error |
|---|---|---|---|---|
| no_sabe | ¿Tienen menú para niños? | no | ❌ |  |
| no_sabe | ¿Dan clases de barismo? | sí | ✅ | Cliente preguntó si dan clases de barismo; la información de referencia no incluye eso. |
| no_sabe | ¿El local tiene aire acondicionado? | sí | ✅ | Cliente preguntó si el local tiene aire acondicionado; la información no está disponible en los datos de referencia proporcionados. |
| no_sabe | ¿Tienen sillas altas para bebés? | sí | ✅ | Cliente preguntó si tienen sillas altas para bebés. No hay información disponible sobre la disponibilidad de sillas altas. |
| no_sabe | ¿Tienen sucursal en Chapinero? | sí | ✅ | Cliente preguntó si tienen sucursal en Chapinero. La información de referencia solo menciona la ubicación en Calle 45 #12-30, local 2, barrio Palermo, Bogotá. |
| enojo | Llevo 40 minutos esperando mi domicilio y nadie me responde, esto es una vergüenza. | sí | ✅ | Cliente informa que lleva 40 minutos esperando su domicilio sin respuesta, muestra enojo por la demora. |
| enojo | Me cobraron de más otra vez. Estoy harto de este lugar. | sí | ✅ | Cliente reclama haber sido cobrado de más y muestra enojo. Necesita asistencia de un representante para resolver la disputa de cobro. |
| enojo | El café llegó frío y derramado. Pésimo servicio, no vuelvo nunca más. | sí | ✅ | Cliente reclama que el café llegó frío y derramado, describe pésimo servicio y dice que no volverá. |
| enojo | Es la tercera vez que me equivocan el pedido. Qué desorden tan grande. | sí | ✅ | Cliente ha indicado que es la tercera vez que le equivocan el pedido y muestra frustración por el desorden. |
| enojo | Ustedes son unos irresponsables, me arruinaron el desayuno de la oficina. | sí | ✅ | Cliente reclamó que le arruinaron el desayuno de la oficina. No disponemos de datos sobre el pedido específico ni sobre la causa del problema. Se requiere infor |
| pide_persona | Quiero hablar con una persona. | sí | ✅ | Cliente solicitó hablar con una persona del equipo. |
| pide_persona | ¿Me puede atender un humano? | sí | ✅ | El cliente solicitó hablar con una persona y insiste en ser atendido por un humano. |
| pide_persona | Necesito hablar con alguien de verdad. | sí | ✅ | Cliente solicita hablar con una persona, no desea continuar con el asistente virtual. |
| pide_persona | Páseme con un asesor por favor. | sí | ✅ | Cliente solicitó hablar con un asesor. |
| pide_persona | Prefiero que me atienda una persona. | sí | ✅ | Cliente solicitó hablar con una persona. |
| si_sabe | ¿A qué hora abren los sábados? | no | ✅ |  |
| si_sabe | ¿Dónde quedan? | no | ✅ |  |
| si_sabe | ¿Tienen parqueadero? | no | ✅ |  |
| si_sabe | ¿Cuánto cuesta el domicilio? | no | ✅ |  |
| si_sabe | ¿Cuál es el pedido mínimo para domicilio? | no | ✅ |  |
| si_sabe | ¿Puedo pagar con Nequi? | no | ✅ |  |
| si_sabe | ¿Cuánto vale el capuchino? | no | ✅ |  |
| si_sabe | ¿Cuánto cuesta el pan de bono? | no | ✅ |  |
| si_sabe | ¿Hasta qué hora sirven desayunos? | no | ✅ |  |
| si_sabe | ¿Puedo llevar a mi perro? | no | ✅ |  |

## Respuestas del bot

- **¿Tienen menú para niños?**
  No, no disponemos de un menú específico para niños; pueden elegir de los ítems del menú regular, como pan de bono, croissant, frutas o los desayunos infantiles que ofrecemos.
- **¿Dan clases de barismo?**
  Le informamos que vamos a consultar a un miembro del equipo sobre sus clases de barismo.
- **¿El local tiene aire acondicionado?**
  No tengo información sobre si el local tiene aire acondicionado, voy a consultar.
- **¿Tienen sillas altas para bebés?**
  Lo siento, no tengo información sobre si cuentan con sillas altas para bebés. Voy a consultar.
- **¿Tienen sucursal en Chapinero?**
  Actualmente no tengo información sobre una sucursal en Chapinero;Voy a consultar con mi equipo.
- **Llevo 40 minutos esperando mi domicilio y nadie me responde, esto es una vergüenza.**
  Lamentamos la demora y vamos a transferir su caso a un agente para que lo atienda.
- **Me cobraron de más otra vez. Estoy harto de este lugar.**
  Lamentamos mucho el error y le vamos a atender enseguida.
- **El café llegó frío y derramado. Pésimo servicio, no vuelvo nunca más.**
  Lamentamos mucho que su café llegara frío y derramado. Para atender su reclamo de la mejor manera, lo derivamos a un miembro del equipo.
- **Es la tercera vez que me equivocan el pedido. Qué desorden tan grande.**
  Lamentamos mucho los errores en su pedido y vamos a transferirlo a un colaborador que pueda ayudarle.
- **Ustedes son unos irresponsables, me arruinaron el desayuno de la oficina.**
  Entendemos su queja y necesitamos consultar información para poder asistirle adecuadamente.
- **Quiero hablar con una persona.**
  Claro, en breve te conecto con una persona del equipo.
- **¿Me puede atender un humano?**
  Le paso con una persona del equipo, por favor espere un momento.
- **Necesito hablar con alguien de verdad.**
  Le paso con una persona del equipo.
- **Páseme con un asesor por favor.**
  Le paso con un asesor, por favor espere un momento.
- **Prefiero que me atienda una persona.**
  Por favor, espera un momento mientras te conecto con una persona del equipo.
- **¿A qué hora abren los sábados?**
  ¡Hola! Soy el asistente virtual de Café Aurora. Los sábados abrimos a las 8:00.
- **¿Dónde quedan?**
  Estamos en la Calle 45 # 12‑30, local 2, en el barrio Palermo, Bogotá, frente al parque de la esquina.
- **¿Tienen parqueadero?**
  No, no tenemos parqueadero propio, pero hay un parqueadero público a media cuadra.
- **¿Cuánto cuesta el domicilio?**
  El domicilio cuesta 4.000 pesos.
- **¿Cuál es el pedido mínimo para domicilio?**
  El pedido mínimo para domicilio es de 20.000 pesos.
- **¿Puedo pagar con Nequi?**
  Sí, puede pagar con Nequi.
- **¿Cuánto vale el capuchino?**
  El capuchino vale 7.000 pesos.
- **¿Cuánto cuesta el pan de bono?**
  El pan de bono cuesta 3.000 pesos.
- **¿Hasta qué hora sirven desayunos?**
  Hasta las 11:00.
- **¿Puedo llevar a mi perro?**
  ¡Hola! Soy el asistente de Cafe Aurora. Sí, puedes llevar a tu perro a la terraza; dentro del local solo se permiten perros de asistencia.
