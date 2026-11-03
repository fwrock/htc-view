# Como subir tudo (live viz + replay bridge)

Para **runs gerenciados MICRO, MESO ou mistos**, use o novo
[runbook managed live](MANAGED_LIVE_RUNS.md): geometria do próprio run e barreira de
readiness antes do JVM. O roteiro abaixo descreve o viewer geral do engine.
O bridge agora também assina `simulation.metrics.v1`, que transporta `micro_update`.

Runbook para subir a cadeia completa de visualização ao vivo + replay no `htc-ui`:
**Redpanda → htc-bus-live → hyperbolic-time-chamber (engine, API mode) → htc-ui (Next.js)**,
mais a ponte de replay `/api/replay/*` que lê geometria de cenário e Parquet do filesystem do
engine.

O caminho de referência é o script `scripts/run-live-demo.sh` na raiz do platform — use-o se
quiser subir tudo de uma vez. As seções abaixo mostram o passo a passo manual equivalente e os
detalhes de configuração.

---

## 1. Pré-requisitos

- **Node ≥ 20** + `npm` (o `htc-ui` é um monorepo npm workspaces + Turbo).
- **sbt** (sdkman) + **JDK** — para o engine, o `htc-bus-live` e o ETL.
- **Docker** — para o Redpanda (Kafka) usado pelo demo.
- **Cenários de fixture** em `/home/dean/hyperbolic-time-chamber/simulations/input/`
  (cada subdir com `simulation.json` + `data/`). `htc_hybrid_demo` e `htc_qa_full` já estão lá.
- Para **replay**: o projeto `htc-replay/etl` (o jar compilado é *thin* — sem dependências — então
  ele é sempre rodado via `sbt run`, nunca `java -jar`).

---

## 2. Subida rápida (um comando)

```bash
cd /home/dean/workspace/phd/htc-platform
scripts/run-live-demo.sh            # default: htc_hybrid_demo
scripts/run-live-demo.sh htc_qa_full
```

O script sobe, na ordem certa (importante: o `htc-bus-live` assina o Kafka com
`auto.offset.reset=latest`, então ele precisa estar de pé **antes** do engine começar a produzir):

1. Redpanda (`docker compose up -d redpanda`, porta **9092**);
2. `htc-bus-live` (`sbt "live/run"`, porta **8090** `/ws/live`);
3. Engine em modo REST API (`sbt "runMain org.interscity.htc.main"`, porta **9804**);
4. `htc-ui` (`npm run dev`, porta **3000**).

Logs vão para `/tmp/htc-bus-live.log`, `/tmp/htc-engine.log` e `/tmp/htc-ui-dev.log`.
`Ctrl+C` derruba tudo.

> **Atenção (replay):** o `run-live-demo.sh` cobre o caminho **live** (Kafka). Para o **replay**
> (Parquet), o engine também precisa gravar Parquet no diretório canônico — veja a §3.

---

## 3. Subida manual (passo a passo)

### 3.1 Redpanda

```bash
cd /home/dean/workspace/phd/htc-platform/hyperbolic-time-chamber
docker compose up -d redpanda
# aguarda localhost:9092
```

### 3.2 htc-bus-live (bridge Kafka → WebSocket)

```bash
cd /home/dean/workspace/phd/htc-platform/htc-bus
HTC_BUS_KAFKA_BROKERS=localhost:9092 sbt "live/run"
# aguarda localhost:8090
```

### 3.3 Engine (hyperbolic-time-chamber, modo REST API)

```bash
cd /home/dean/workspace/phd/htc-platform/hyperbolic-time-chamber
SCENARIO=htc_hybrid_demo
HTC_API_ENABLED=true \
HTC_API_PORT=9804 \
HTC_SCENARIOS_DIR=/home/dean/hyperbolic-time-chamber/simulations/input \
HTC_KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
HTC_MICRO_UPDATE_REPORT_EVERY=1 \
HTC_MOBILITY_CITY_MAP_FILE=/home/dean/hyperbolic-time-chamber/simulations/input/$SCENARIO/data/city_map.json \
HTC_REPORT_KAFKA_BATCH_SIZE=1 \
HTC_REPORT_PARQUET_DIRECTORY=/home/dean/hyperbolic-time-chamber/output/reports/parquet \
sbt "runMain org.interscity.htc.main"
# aguarda localhost:9804
```

`HTC_REPORT_PARQUET_DIRECTORY` é o que faz o Parquet cair no diretório **canônico**
`/home/dean/hyperbolic-time-chamber/output/reports/parquet` (default do `application.conf` é o path
de container `/app/hyperbolic-time-chamber/output/reports/parquet`, mapeado do host pelo
`docker-compose.yml`). Para **live puro** essa env é opcional; para **replay** ela é necessária.

### 3.4 htc-ui (Next.js)

```bash
cd /home/dean/workspace/phd/htc-platform/htc-ui/apps/web
npm install          # só na primeira vez
npm run dev
```

Crie um `.env.local` a partir de `.env.local.example` se precisar apontar para outros hosts/portas
(`NEXT_PUBLIC_HTC_API_URL`, `NEXT_PUBLIC_HTC_LIVE_WS_URL`, e os `HTC_*` da ponte de replay).

---

## 4. Fluxo de uso (live)

1. Abra `http://localhost:3000/simulator`.
2. No painel **Cenários**, escolha o cenário e **Load** (carrega `simulation.json` no engine).
3. Clique **Iniciar**.
4. Quando estiver `Running`, clique **Ver visualização ao vivo** → abre
   `/simulator/live?scenario=<name>` mostrando os veículos em tempo real.
5. Na tela live, use a barra inferior (play/pause, scrubber, velocidade, **Ao vivo**) para
   controlar o **tempo de visualização** desacoplado da taxa de chegada.

### Replay (simulação já terminada)

1. Clique **Ver replay** no `/simulator` (botão ao lado de "Ver visualização ao vivo") → abre
   `/simulator/replay?scenario=<name>`.
2. A tela carrega `segments.arrow` (via `/api/replay/<scenario>/segments.arrow`) e reproduz com
   scrubber de intervalo fixo `[tickMin, tickMax]` (play/pause/velocidade).
3. Se o `segments.arrow` não existir, aparece **Gerar replay** — clicando, a ponte roda o ETL
   (`POST /api/replay/<scenario>`) e recarrega quando `ready`.

---

## 5. Replay bridge (`/api/replay/*`)

A ponte serve, para o browser, arquivos que ficam no filesystem do host do engine (inacessíveis
diretamente). Endpoints:

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/replay` | Lista cenários e o que localiza para cada (geometria `data/`, nº de Parquet, artefatos gerados) + os paths resolvidos |
| GET | `/api/replay/<scenario>` | Status: `not_generated` \| `generating` \| `ready` \| `error` |
| POST | `/api/replay/<scenario>` | Roda o ETL (`sbt run`) para derivar `segments.arrow` + geometria a partir do Parquet (assíncrono) |
| GET | `/api/replay/<scenario>/<file>` | Serve um artefato (gerado primeiro, senão o bundle em `public/data/`) |

Artefatos servidos: `manifest.json`, `links.arrow`, `nodes.arrow`, `segments.arrow`,
`signals.json`, `stops.json`, `rail_links.arrow`.

**Gerar artefatos de replay para um cenário** (ex.: `htc_qa_full`):

```bash
curl -X POST http://localhost:3000/api/replay/htc_qa_full     # 202 generating
# aguarde ~15-30s (sbt run) e confira:
curl http://localhost:3000/api/replay/htc_qa_full             # status: ready (com manifest)
```

Os artefatos saem em `HTC_REPLAY_OUT_DIR/<scenario>/` (default
`/home/dean/hyperbolic-time-chamber/output/replay`).

### Env vars da ponte (server-side, `apps/web/lib/replay-config.ts`)

| Variável | Default |
|---|---|
| `HTC_SCENARIOS_DIR` | `/home/dean/hyperbolic-time-chamber/simulations/input` |
| `HTC_REPORT_PARQUET_DIRECTORY` | `/home/dean/hyperbolic-time-chamber/output/reports/parquet` |
| `HTC_REPLAY_OUT_DIR` | `/home/dean/hyperbolic-time-chamber/output/replay` |
| `HTC_REPLAY_ETL_DIR` | `/home/dean/workspace/phd/htc-platform/htc-replay/etl` |

---

## 6. Portas

| Serviço | Porta |
|---|---|
| Redpanda (Kafka API) | 9092 |
| htc-bus-live (`GET /ws/live`) | 8090 |
| Engine REST API | 9804 |
| Engine metrics (Prometheus) | 9001 |
| htc-ui (Next.js dev) | 3000 |

---

## 7. Gotchas conhecidos

- **Porta 3000 vs 3001:** já houve um `next-server` antigo (outra versão) segurando a 3000; nesse
  caso o dev server sobe na **3001**. Confirme com `ss -ltnp` / `curl`. Mate o processo antigo se
  quiser a 3000.
- **Parquet canônico vs scratch:** o diretório canônico é
  `/home/dean/hyperbolic-time-chamber/output/reports/parquet`. Os cenários de demo
  (`htc_hybrid_demo`, `htc_qa_full`) chegaram a gravar Parquet no scratch antigo
  `output_local/reports/parquet/` — mova para o canônico (ou re-rogue o cenário com
  `HTC_REPORT_PARQUET_DIRECTORY` correto).
- **ETL thin jar:** `java -jar htc-replay-etl_3-*.jar` falha com
  `NoClassDefFoundError: scopt.OptionParser`. Use sempre `sbt "run --scenario ..."` (ou a ponte, que
  já faz isso).
- **`auto.offset.reset=latest`:** o `htc-bus-live` assina o Kafka do fim — abra a tela live antes ou
  durante a execução, senão os eventos iniciais se perdem. Para "a run já terminou", use o replay
  (Parquet + ETL).
- **Não-bloqueante (pré-existente):** `BusStation`/`Subway` crasham por tick
  (`Map[Long,Long]` desserializado como `String`). Carros e pessoas não são afetados.
- **Ids já convertidos:** os fixtures `htc_hybrid_demo`/`htc_qa_full` já passaram por
  `tools/convert_htcaid_ids_to_long.py` (backups em `_backups_id_conversion_*`).

---

## 8. Verificação

```bash
# engine de pé
curl http://localhost:9804/api/v1/scenarios | python3 -m json.tool

# ponte localizando arquivos
curl http://localhost:3000/api/replay | python3 -m json.tool | grep -E '"name"|parquetFiles'

# status/geração de replay
curl -X POST http://localhost:3000/api/replay/htc_qa_full
curl http://localhost:3000/api/replay/htc_qa_full
```

---

Consulte `htc-ui/docs/LIVE_VISUALIZATION_STATUS.md` para o status técnico/limitações e
`htc-ui/README.md` para o resumo das features.

