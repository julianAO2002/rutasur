# RutaSur — TP7 Programación Avanzada

Objective: event-driven last-mile tracking platform (Kafka + Node.js + MongoDB + Next.js) that runs entirely on Docker Compose, per `TP7_RutaSur_especificacion_del_caso_practico.pdf`.
Branch: `feat/rutasur` · Delivery: single-pr (separate repo, user decides push/PR) · Test runner: `node --test` (services) + e2e script against the running stack.

## Specs

- S1. Separate repository named after the app: "realizar tp7 en un repo aparte que haga alucion a la app, y que corra sobre docker".
- S2. Stack: "Apache Kafka como log de eventos, Node.js para los servicios, MongoDB como modelo de lectura y Next.js para la interfaz. Todo corre en local con Docker Compose." Kafka single broker in KRaft mode; MongoDB as single-node replica set (change streams).
- S3. Six topics keyed by `shipmentId`: `envios.estados` (3 partitions, 30 d), `envios.promesas` (compacted), `envios.reprogramaciones` (30 d), `alertas.sla` (7 d), `notificaciones.enviadas` (7 d), `envios.estados.dlq` (30 d).
- S4. Simulator with configurable parameters (20 envíos/min, 1 h simulada = 30 s, fallo por zona 5–30 %, motivos 60/20/15/5, demora hub 10 %, duplicado 2 %, fuera de orden 2 %, malformado 1 %, semilla fija) and on-demand scenarios: Envío feliz, Ausente, Demorado, Tercer fallo, Ráfaga (500 envíos).
- S5. CU1 Proyector: "Regla de orden: un evento con secuencia menor o igual a la ya aplicada se descarta." "Regla de duplicados: un eventId ya registrado no se vuelve a aplicar." "Evento inválido: si no cumple el esquema, va a envios.estados.dlq con el motivo y el consumo continúa."
- S6. CU2: one `ENTREGA_FALLIDA` → notificaciones, reprogramación and analítica as independent groups. Rules: "AUSENTE: nuevo intento al día hábil siguiente, en la franja opuesta a la del fallo." "DIRECCION_INCORRECTA: el envío queda retenido hasta una corrección; no se reprograma solo." "RECHAZADO: se marca para devolución al comercio." "Tercer intento fallido, cualquiera sea el motivo: devolución al comercio." Assumption: ZONA_INACCESIBLE is reprogrammed like AUSENTE.
- S7. CU3 Monitor de SLA: Sin ingreso (<10 h, no ingresó) Media; Sin salida (<4 h, no en reparto) Alta; Fallo en el día límite Alta; Vencido Crítica. Evaluate on each event and periodically; close on ENTREGADO; no repetition; survive restarts; use the simulated clock carried by events.
- S8. CU4 Analítica: tasa de entrega en primer intento (zona, franja, día), distribución de motivos (zona, motivo), cumplimiento de SLA (hub, día) in `metricas_diarias` with atomic increments; 4th indicator (tiempo medio INGRESADO_HUB → EN_REPARTO por hub) via a new group reading from the beginning.
- S9. Next.js: Torre de control, Detalle del envío, Tracking público (live via SSE + change streams), Analítica (filters zona, hub, fecha), Panel de demo. Reads only MongoDB.
- S10. Non-functional: manual offset commit after writing to MongoDB; idempotent consumers; logs with eventId, partition, offset; group lag observable; whole environment starts with one command.

## Tasks

| ID | Specs | Route | Status | Evidence |
| --- | --- | --- | --- | --- |
| T1 | S1–S3, S10 | inline | done | compose + shared lib |
| T2 | S4 | inline | done | simulator + unit tests |
| T3 | S5–S8 | inline | done | five consumers + replay consumer + unit tests |
| T4 | S9 | inline | done | Next.js app |
| T5 | S1–S10 | inline | done | `docker compose up -d --build` + e2e verification |

Route evidence: no Writer trigger fired (single coherent design, no disjoint parallel units worth a subagent); work stays inline.

## Log

- L1 (2026-10-29): "realizar tp7 en un repo aparte que haga alucion a la app, y que corra sobre docker"
- L2: TP7 identified as `FACU/TP7_RutaSur_especificacion_del_caso_practico.pdf` (Programación Avanzada 2026). Repo created at `FACU/rutasur`. Engram mirror pending (memory tools unavailable in this session).
