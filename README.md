# RutaSur — logística de última milla orientada a eventos

Trabajo Práctico 7 de **Programación Avanzada (2026)**, Licenciatura en Sistemas de Información, FCyT - UADER.

RutaSur es una plataforma de seguimiento de envíos en tiempo real para un operador de última milla ficticio.
Cada cambio de estado de un envío es un **evento** en Apache Kafka; servicios Node.js independientes reaccionan a
esos eventos, MongoDB guarda las vistas de lectura y una interfaz Next.js las muestra en vivo.

> Hipótesis del caso: si cada cambio de estado se trata como un evento, la empresa puede intervenir durante la
> operación en lugar de analizar los fracasos al día siguiente.

## Arranque (un solo comando)

Requisitos: Docker Desktop (o Docker Engine + Compose v2). No hace falta Node.js en la máquina.

```bash
docker compose up -d --build
```

| Qué | URL |
| --- | --- |
| Torre de control, tracking, analítica y panel de demo | http://localhost:3000 |
| Kafka UI (topics, mensajes, DLQ, lag de cada grupo) | http://localhost:8080 |
| API del simulador | http://localhost:4000/estado |

Si un puerto ya está ocupado se cambia con variables de entorno, por ejemplo
`WEB_PORT=3100 docker compose up -d --build` (también `KAFKA_UI_PORT` y `SIMULADOR_PORT`).

Para empezar de cero (borra Kafka y MongoDB): `docker compose down -v`.

## Arquitectura

Kafka es el único punto de contacto entre los servicios: ninguno llama a otro en forma directa. MongoDB recibe
vistas derivadas y Next.js solo lee de ahí.

```
                 ┌──────────────────────────────┐      ┌─────────────────┐
 ┌───────────┐   │ Apache Kafka (KRaft, 1 nodo) │ ───▶ │ proyector       │──┐
 │ simulador │──▶│  envios.estados   (3 part.)  │ ◀──▶ │ notificaciones  │  │   ┌─────────────┐   ┌─────────┐
 └───────────┘   │  envios.promesas  (compact.) │ ◀──▶ │ reprogramacion  │  ├──▶│  MongoDB    │──▶│ Next.js │
                 │  envios.reprogramaciones     │ ◀──▶ │ monitor-sla     │  │   │ replica set │   │  (SSE)  │
                 │  alertas.sla                 │ ───▶ │ analitica       │──┘   └─────────────┘   └─────────┘
                 │  notificaciones.enviadas     │ ───▶ │ analitica-tiempos (replay)
                 │  envios.estados.dlq          │      └─────────────────┘
                 └──────────────────────────────┘
```

| Componente | Responsabilidad | Grupo de consumidores |
| --- | --- | --- |
| `simulador` | Genera envíos, promesas y cambios de estado con reloj acelerado y semilla fija | no consume |
| `proyector` | Mantiene `envios`, `alertas` y `notificaciones` en MongoDB | `proyector` |
| `notificaciones` | Registra avisos al destinatario ante fallos y alertas | `notificaciones` |
| `reprogramacion` | Decide el próximo intento tras una entrega fallida | `reprogramacion` |
| `monitor-sla` | Detecta envíos en riesgo y emite alertas | `monitor-sla` |
| `analitica` | Actualiza los agregados de `metricas_diarias` | `analitica` |
| `analitica-tiempos` | Cuarto indicador, se activa con el sistema en marcha (reprocesamiento) | `analitica-tiempos` |
| `web` | Torre de control, detalle, tracking público, analítica y panel de demo | no consume |

Cada servicio es un proceso Node.js en su propio contenedor (todos comparten la imagen `services/`), así que
se puede detener uno durante la demo sin afectar a los demás.

### Topics

| Topic | Clave | Produce | Consume | Retención |
| --- | --- | --- | --- | --- |
| `envios.estados` | shipmentId | simulador | proyector, monitor-sla, notificaciones, reprogramacion, analitica | 30 días |
| `envios.promesas` | shipmentId | simulador | monitor-sla | compactado |
| `envios.reprogramaciones` | shipmentId | reprogramacion | proyector | 30 días |
| `alertas.sla` | shipmentId | monitor-sla | proyector, notificaciones | 7 días |
| `notificaciones.enviadas` | shipmentId | notificaciones | proyector | 7 días |
| `envios.estados.dlq` | shipmentId | cualquier consumidor | revisión manual (Kafka UI) | 30 días |

Los crea el contenedor `kafka-init` (`services/src/init/topics.js`) antes de que arranque cualquier servicio.

### Colecciones de MongoDB

| Colección | Contenido | Escribe |
| --- | --- | --- |
| `envios` | Estado actual, promesa, intentos, historial embebido, última secuencia aplicada, última decisión | proyector |
| `alertas` | Alertas de SLA abiertas y cerradas, con causa y prioridad | proyector |
| `notificaciones` | Cada aviso simulado | proyector |
| `metricas_diarias` | Agregados por fecha + zona + franja (con su hub), con `$inc` atómicos | analitica |
| `metricas_tiempos_hub` | Cuarto indicador: suma de minutos y cantidad por fecha + hub | analitica-tiempos |
| `eventos_procesados` | `consumidor + eventId` únicos, TTL de 7 días | cada consumidor |
| `monitor_sla_estado` | Respaldo del estado en memoria del monitor | monitor-sla |

## Estructura del repositorio

```
docker-compose.yml        entorno completo
services/                 servicios Node.js (una imagen, un proceso por contenedor)
  src/lib/                config, dominio, validación de esquema, Kafka, MongoDB, logs
  src/simulador/          plan determinístico de cada envío + escenarios + API HTTP
  src/proyector/          CU1: proyección CQRS (orden por secuencia, duplicados, DLQ)
  src/notificaciones/     CU2/CU3: avisos al destinatario
  src/reprogramacion/     CU2: reglas de reprogramación
  src/monitor-sla/        CU3: reglas de riesgo con estado y reloj simulado
  src/analitica/          CU4: metricas_diarias
  src/analitica-tiempos/  CU4: cuarto indicador por reprocesamiento
  src/tools/              verificación e2e, recuento manual, reconstrucción de envios
  test/                   tests unitarios (node --test)
web/                      Next.js 15 (App Router): páginas server-side + SSE desde change streams
odd/tasks/rutasur.md      seguimiento del trabajo
```

## Casos de uso y cómo se cumplen

**CU1 — Ciclo de vida.** El proyector consume `envios.estados` y hace un *upsert condicional*: el filtro solo
coincide si `secuencia` es mayor a `ultimaSecuencia`; si no, el upsert choca con el índice único de `shipmentId`
y el evento se descarta (**regla de orden**). Cada efecto se aplica dentro de una transacción junto con el registro
`consumidor + eventId` en `eventos_procesados` (**regla de duplicados**). Un evento que no cumple el esquema se
publica en `envios.estados.dlq` con el motivo y el consumo continúa (**evento inválido**).

**CU2 — Entrega fallida.** Un `ENTREGA_FALLIDA` lo reciben en paralelo tres grupos que no se conocen:
`notificaciones` (aviso con opciones), `reprogramacion` (decisión) y `analitica` (agregados). Reglas:
AUSENTE → día hábil siguiente en la franja opuesta; DIRECCION_INCORRECTA → retenido; RECHAZADO → devolución;
tercer intento fallido → devolución. *Supuesto:* ZONA_INACCESIBLE se reprograma igual que AUSENTE (la consigna no
lo define). Los eventos que emiten tienen ids derivados del evento de origen (`ntf-…`, `rpg-…`), así un reintento
nunca produce un segundo aviso ni una segunda reprogramación.

**CU3 — Riesgo de SLA.** El monitor arma una tabla por envío con `envios.estados` y `envios.promesas`, la evalúa al
recibir cada evento y además cada 5 s reales (≈ 10 min simulados) para detectar la *ausencia* de eventos.

| Regla | Condición | Prioridad |
| --- | --- | --- |
| Sin ingreso | Faltan menos de 10 h y no ingresó al hub | Media |
| Sin salida | Faltan menos de 4 h y no está en reparto | Alta |
| Fallo en el día límite | ENTREGA_FALLIDA el día en que vence la promesa | Alta |
| Vencido | Pasó el vencimiento sin ENTREGADO | Crítica |

Usa el **reloj simulado que viaja en los eventos** (`ocurridoEn`), no el de la máquina. Cada regla alerta una sola
vez por envío; al llegar `ENTREGADO` emite el cierre de sus alertas abiertas. El estado se respalda en MongoDB y los
`alertaId` son determinísticos, por lo que un reinicio no pierde ni repite alertas.

**CU4 — Analítica.** `metricas_diarias` se actualiza con `$inc` atómicos (en la misma transacción que el registro
del `eventId`). La página de analítica muestra los tres indicadores con filtros por zona, hub y fecha, y señala la
zona y franja con peor tasa de entrega en primer intento.

## Simulador

| Variable | Default | Para qué sirve |
| --- | --- | --- |
| `ENVIOS_POR_MINUTO` | 20 | Volumen de la demo |
| `FACTOR_ACELERACION` | 120 | 1 hora simulada = 30 segundos |
| tasa de fallo por zona | 5 % a 30 % | Repartida entre las 9 zonas según la semilla (la mañana falla más que la tarde) |
| distribución de motivos | 60/20/15/5 | Ausente, dirección, rechazo, zona |
| `PROB_DEMORA_HUB` | 0.1 | Dispara alertas de SLA |
| `PROB_DUPLICADO` | 0.02 | Prueba la idempotencia |
| `PROB_FUERA_DE_ORDEN` | 0.02 | Prueba la regla de secuencia |
| `PROB_MALFORMADO` | 0.01 | Prueba la DLQ |
| `SEMILLA` | 2026 | Repite exactamente la misma corrida |

Se cambian al levantar, por ejemplo `SEMILLA=7 ENVIOS_POR_MINUTO=40 docker compose up -d`.

API (también la usa el panel de demo):

| Método y ruta | Efecto |
| --- | --- |
| `GET /estado` | Reloj simulado, corrida, semilla, envíos creados |
| `GET /lag` | Lag de cada grupo de consumidores |
| `POST /escenarios/{feliz,ausente,demorado,tercer-fallo,rafaga,invalido}` | Dispara un escenario |
| `POST /pausa?activa=true\|false` | Congela o reanuda el reloj simulado |
| `POST /flujo?activo=true\|false` | Activa o desactiva la creación continua de envíos |

Los escenarios *feliz*, *ausente*, *demorado* y *tercer fallo* usan tiempos compactos para que la demo sea breve.

## Guion de la demo

1. **Arranque.** `docker compose up -d --build` y abrir http://localhost:3000: los contadores se mueven.
2. **Envío feliz.** Panel de demo → *Envío feliz* → abrir el *tracking* del envío hasta *Entregado*.
3. **Ausente.** Disparar *Ausente* y abrir el detalle: aparecen casi a la vez la notificación, la reprogramación y
   el incremento en analítica.
4. **Demorado.** Disparar *Demorado*: a los ~3 min aparece la alerta *Sin salida* (alta) en la cola; al entregarse
   se cierra.
5. **Caída de un servicio.** `docker compose stop notificaciones`: el tracking y las alertas siguen y el lag del
   grupo `notificaciones` crece en el panel. `docker compose start notificaciones`: procesa lo pendiente sin
   duplicar avisos.
6. **Evento inválido.** Disparar *Evento inválido* y verlo en Kafka UI → Topics → `envios.estados.dlq`.
7. **Analítica.** Abrir *Analítica*: identifica la zona y franja con más fallos y propone la franja vespertina.
8. **Reprocesamiento.** `docker compose --profile replay up -d analitica-tiempos`: un grupo nuevo lee el log desde
   el inicio y el cuarto indicador se completa con datos anteriores a su creación.

Los logs de cada servicio muestran `eventId`, partición y offset: `docker compose logs -f proyector`.
El lag también se consulta por consola:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --all-groups
```

## Verificación

Tests unitarios de las reglas (sin Docker, Node 22+):

```bash
cd services && npm install && npm test
```

Verificación de punta a punta con el entorno levantado (dispara escenarios y comprueba los criterios de aceptación;
`--con-demorado` agrega la alerta de SLA y tarda unos minutos más):

```bash
docker compose exec simulador node src/tools/verificar.js --con-demorado
```

Recuento manual de los indicadores contra `metricas_diarias` (pausar primero para que el lag llegue a cero):

```bash
curl -X POST "http://localhost:4000/pausa?activa=true"
docker compose exec simulador node src/tools/recuento.js
```

Reconstrucción de `envios` (borrar y reprocesar deja la colección en el mismo estado):

```bash
curl -X POST "http://localhost:4000/pausa?activa=true"
docker compose exec simulador node src/tools/envios.js huella
docker compose stop proyector
docker compose exec simulador node src/tools/envios.js reconstruir
docker compose start proyector
# esperar a que el lag de "proyector" vuelva a 0
docker compose exec simulador node src/tools/envios.js huella   # misma huella
curl -X POST "http://localhost:4000/pausa?activa=false"
```

## Decisiones de diseño

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Garantía de entrega | Al menos una vez + consumidores idempotentes | Simple y no pierde eventos |
| Confirmación de offsets | Manual (`autoCommit: false`), después de escribir en MongoDB | Un fallo a mitad de proceso reintenta el evento |
| Particiones | 3 en cada topic (1 en la DLQ) | Muestra reparto de carga y rebalanceo |
| Formato | JSON validado en cada consumidor (`services/src/lib/esquema.js`) | Legible, sin Schema Registry |
| Monitor de SLA | Consumidor propio, estado en memoria con respaldo en MongoDB | La lógica queda a la vista |
| Kafka en local | Un broker en modo KRaft | Un contenedor, sin ZooKeeper |
| Tiempo real en la UI | Change streams de MongoDB + Server-Sent Events | El frontend no depende de Kafka |
| Productores que emiten eventos | Publicar y después marcar el `eventId` como procesado, con ids determinísticos | Un reinicio en el medio republica el mismo id y aguas abajo se descarta |
| Proyecciones | Sin `Date.now()`: todo sale de los eventos | Reprocesar el log produce exactamente la misma vista |
