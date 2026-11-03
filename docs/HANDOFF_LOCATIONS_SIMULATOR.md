# Handoff: locations registry, dashboard, runs page, simulator page (Claude session, 2026-11-01)

For the other agent (Codex) working in the same tree. There is no git here: do not "restore" files to
undo anything, it wipes uncommitted work. Edit the files below in place and keep these behaviours.

## What was added or changed (only my work; replay/OSM/simedape-docs work is the other agent's)

New
- `htc-ui/apps/web/components/simulator/config-editor.tsx` (form/JSON editor of the selected scenario's simulation.json:
  apply to engine with paths rebased, or save in place with timestamped `.bak` and a sha256 stale-write check) and
  `components/simulator/output-panel.tsx` (report settings applicable live + generated config for a chosen output location).
  `components/simulator/env-settings-panel.tsx` (tab Ambiente: all application.conf keys, search/scope/group, export to
  .env/compose/k8s/HOCON/-D, apply the live-capable ones) over `htc_locations/engine_conf.py` and `/api/engine-settings*`. The Saída tab builds its keys from the same catalog and
  generator (only values differing from application.conf defaults) and hands them to the Ambiente tab; the pending changes
  live in the page (`envOverrides`, localStorage `htc.env-overrides`).
  Backend: `htc_locations/scenario_config.py`, `/api/scenarios/config` (GET/PUT), `/api/scenarios/engine-config`.
- `htc-locations/` (Python, stdlib only): registry of input/output locations and engines. See its README.
  CLI `htc` (`htc locations ...`, `htc engines ...`) and `simedape locations ...` share one file
  (`$HTC_LOCATIONS_FILE` or `~/.config/htc/locations.json`). `pytest` in that folder: 9 tests.
- `simedape/api/locations.py`: `/api/locations*`, `/api/engines*`, `/api/scenarios`, `/api/scenarios/engine-path`,
  `/api/fs/browse` (folder browser, confined to `$HTC_BROWSE_ROOT` or the home dir).
- `htc-ui/apps/web/app/locations/page.tsx` ("Locais": inputs, outputs, ClickHouse, engines, presets),
  `components/locations/folder-picker.tsx`, `app/simulator/runs/page.tsx` ("HTC · Execuções"),
  `components/htc-runs/native-htc.tsx` (moved from `app/simedape/native-htc.tsx`).
- `htc-ui/docs/` this file.

Edited (conflict hotspots, re-read before editing)
- `app/page.tsx`: dashboard rewritten (API status, swimlane flow diagram, 2 actions, recent runs).
- `app/simulator/page.tsx`: engine selector (registry), offline panel, scenario picker, layout
  (Engine / status / Execução / tabs). The former accordions are now tabs: Observação (Métricas, Logs) and Configuração
  (Cenário, Settings, Saída); one section visible, `?tab=` in the URL, arrow-key navigation, default metrics while running
  else Cenário. The user disliked the accordions; do not bring them back. The engine's own scenario tab was removed on
  purpose (the picker in Execução covers it). Pre-change copy: `/tmp/claude-1000/simulator-page.before.tsx` (may be gone).
- `app/simedape/page.tsx`: full-HTC-run form and results removed (now under Simulator → Execuções); native runs filtered out of its list.
- `components/app-sidebar.tsx`: Actuator removed, "Locais" added. `app/actuator/` deleted on purpose (out of scope).
- `lib/htc-api.ts`: base URL is now runtime (`setHtcApiBase`, `probeEngine`). `lib/simedape-api.ts`: locations/engines clients, 204 handling.
- `simedape/api/native.py`: scenarios may be `<location>:<scenario>`; catalogue lists input locations;
  `_execute`/`_summary` were deleted by mistake and RESTORED (`_summary` reconstructed from a real
  `receipt.json`/`dataset.npz`, output verified identical to an old run). Keep them.
- `simedape/api/app.py` (registers `locations_api`), `simedape/cli.py` (`locations` subcommand),
  `scripts/run-native-integration-demo.sh` (adds `htc-locations` to PYTHONPATH).
- `hyperbolic-time-chamber/simulations/input/native-two-corridors/`: copy of the demo scenario with relative paths (used to test `repo:`).

Metrics (see `METRICS_AND_NODES.md`): the Métricas tab is now `components/metrics/` (charts, dashboard, `lib/metrics-store.ts`,
`lib/metrics-export.ts`) over `app/api/metrics/all/route.ts`; the old `components/metrics-panel.tsx` and `/api/metrics` are unused
but kept. Libraries added to `apps/web`: `html-to-image`, `jspdf` (package-lock.json changed).

Engine (changed on the user's request, see `hyperbolic-time-chamber/docs/NODE_IDENTITY.md`): `core/cluster/NodeIdentity.scala` (new),
`ActorInteraction.senderNode` in `communication.proto` + `ActorInteractionEvent` + both serializers, receive accounting in
`SimulationBaseActor.handleInteractWith`, `ActorMetrics.messagesByNode`, `ReportEvent.node/fromNode` and the CSV/JSON/Parquet/ClickHouse
writers, `htc.node.*` in `application.conf`, test `NodeIdentitySpec`. The demo still runs the OLD jar (`target/.../hyperbolic-time-chamber-3.2.0.jar`);
a build with these changes was assembled to `/tmp/claude-1000/htc-node.jar` only for testing (the temp jar may be gone: `sbt assembly`).

SimEDaPE screen (`app/simedape/page.tsx`, rewritten at the user's request; the previous version is in `/tmp/claude-1000/simedape-page.before.tsx`
and may be gone): guided steps as tabs (Base, Treinar, Seleção, Parcial, Estimar, Execuções) instead of accordions, `?step=` in the URL, form
remembered in localStorage (`htc.simedape.form.v2`), presets and help text, and `components/simedape/results-view.tsx` (grouped bars of MAPE /
aggregate error / coverage, tables, per-panel export, PDF). Each step starts ONE pipeline run; later steps include `data_load` + `process_dataset`
because stages read `ctx.X`/`streets_info` from the same run. SNAPSHOTS: every training run writes the complete model (clustering, simulation_points,
labels, warping_paths) into its own directory `output/<scenario>/t<stamp>/`; selection and estimation runs set `input_dir` to that snapshot
and `output_dir` to a subdirectory of it (`selecao-<stamp>/`, `estimativa-<stamp>/`), so nothing is overwritten and each run is tied to the exact
training it used (stages read prior results from `ctx.input_dir or ctx.output_dir`: clustering, simulation_points_indexs, time_series_labels, warping_paths).
The snapshot's base must match the form's base or the step refuses to start. Config parsing of these paths was checked with `SimEDaPEConfig.from_dict`;
the pipeline itself was NOT run against real data (no ClickHouse or CSV base here). A step finds its run by marker stage (`clustering`, `selection`,
`estimation`) in `run.meta.stages`. The Parcial step is informational: the engine does not consume the selection manifest yet.

## Decisions
- Inputs and outputs are "locations" with a role; ClickHouse is output-only and its password is never stored (`password_env`).
- A scenario is referred to as `<location>:<scenario>` everywhere. Engines get the path *they* see (`container_path`).
- Multi-node: one control endpoint per cluster; every node must see the scenario at the same shared path.
  NOT verified: that `start` on one node's API starts the whole cluster.
- The engine/native workflow code was not touched except `native.py` listed above.

## Output destination cannot be changed live (engine limitation, verified)
`SimulatorSettingsRegistry.catalog` (what `PUT /settings` accepts) has only `htc.report-manager.enabled` and the JSON
reporter instance/batch settings. Report directories, `enabled-strategies` (no env var in application.conf) and the
ClickHouse host/db are read from application.conf/env at JVM start. The Saída tab therefore applies what the API allows and
generates the HOCON/env for the rest (valid on next engine start). Making it live needs an ENGINE change (not done, the
engine was left untouched): add SettingDefs for `htc.report-manager.{parquet,json,csv}.directory`,
`htc.report-manager.enabled-strategies` and `htc.report-manager.clickhouse.{host,port,database,username}` and have
`ReportManager`/the reporters read them through the registry when the simulation starts. Ask the user before doing it.

## Not done
- Runs do not yet write to a chosen output location (needs executor/engine config).
- ClickHouse never tested against a real server (stub HTTP server only); ssh and gcs providers untested for real.
- Simulator page metrics/logs panels use HTC View's own routes, not the selected engine.
- `npm run typecheck` may show a stale `.next/types/validator.ts` error about `app/actuator`; it disappears after a dev-server restart.

## Operating notes
- Restarting the demo: kill `scripts/run-native-integration-demo.sh`, wait until nothing listens or lingers (TIME-WAIT) on :3000/:5000
  (its port check fails otherwise), then run it again with `SIMEDAPE_PYTHON=/tmp/htc-simedape-e2e-venv/bin/python`. Jobs persist in `/tmp/htc-native-demo-1000`.
- The user's real registry has location `repo` (docker kind, host path = container path = `hyperbolic-time-chamber/simulations/input`).
- Python tests under `simedape/tests` fail at collection in this environment (also on files not touched here).


NOTE: `htc-ui/apps/web/app/page.tsx` was edited by another agent at 16:32 (an `htc_osm_*` workflow and `/simulator/import`); `tsc` reports `startsWith` on type `never` there until `RunSummary.meta.workflow` in `lib/simedape-api.ts` is widened. Not touched here.

## SimEDaPE: modelo compacto (`model.simedape`)

- Novo estágio `model_export` (último do treino) empacota clustering, labels, pontos de simulação, caminhos DTW e modelos PCA em **um ZIP** (`simedape/model_bundle.py`, formato `simedape.model.v1`: arrays `.npy` + `manifest.json`). Config `compact_model` (padrão `true`) deixa de gravar `dataset_cluster_*.json` e `warping_paths/*.json`; `model_precision` = `float64` (exato, padrão) ou `float32` (menor, com perda).
- Estimação/seleção leem o bundle primeiro e caem para os JSON legados. Testado: resultado idêntico ao legado (`tests/test_model_bundle.py`, `tests/test_api_model.py`); suíte completa 251 testes OK.
- API: `GET /api/runs/<id>/model` (resumo/tamanhos) e `/model/download`.
- UI (`app/simedape/page.tsx`, passo Treinar): escolha DTW/PCA, parâmetros avançados (semente, iterações, tamanho, separador, precisão), checklist de pré-requisitos, log ao vivo, painel "Resultado do treino". Passo Estimar: opção PCA conforme o snapshot. Form key agora `htc.simedape.form.v3`.
- NÃO verificado: execução do pipeline pela UI/API sobre dados reais (só base CSV sintética nos testes Python).

### Relatório de clusterização
- `simedape/clustering_report.py` calcula, no `model_export`, estatísticas por cluster (tamanho absoluto/%, distância ao centróide, RMSE e erro relativo em unidade original, DTW médio, % PCA não explicada, cluster mais vizinho), as 20 séries mais próximas e 20 mais distantes de cada cluster, histograma de distâncias e matriz de distância entre centróides. Fica em `report/*` dentro do `model.simedape`.
- API: `GET /api/runs/<id>/clustering-report[?cluster=k&near=X&far=Y]`. UI: `components/simedape/clustering-report.tsx`, exibido no passo Treinar com export por painel (CSV/JSON/imagem/PDF).
- Modelos treinados antes deste recurso não têm o relatório (a API responde 404 com mensagem). A API de jobs em execução precisa ser reiniciada para expor o endpoint.


## Parcial (etapa 4 do SimEDaPE) e campo no Simulator
- Engine: bloco `partial` no simulation.json (ver simedape/docs/PARTIAL_SIMULATION.md). API: `POST /api/scenarios/partial-config`, `GET /api/partial/report`.
- UI: `app/simedape/page.tsx` passo Parcial (cenário base da lista de Locais, seleção da etapa 3, classes filtráveis, engine, "Iniciar parcial") com `components/simulator/run-monitor.tsx` embutido e relatório do filtro. `app/simulator/page.tsx`: bloco "Simulação parcial (opcional)" ao escolher um cenário, e selo "Parcial · N de M" lido do `partial` da configuração carregada no engine.
- Não verificado: o início da simulação pela tela (não havia engine REST rodando). Falta: alterações (`htc.modifications.v1`), validador/editor, passo de referência 100% alterada.

## Modificações (what-if) e o que fica para o Codex (mapa/infraestrutura)
- Formato e semântica: `simedape/docs/MODIFICATIONS.md` (`htc.modifications.v1`: add/remove/edit por ids ou seletor). Validador: `simedape/modifications.py` (testes `tests/test_modifications.py`). API: `/api/modifications` (listar/ler/gravar/validar), `simedape/api/modifications.py`. UI: página `/modifications`, componente `components/modifications/modifications-editor.tsx`, passo "Alterações" do SimEDaPE.
- O engine ainda NÃO aplica o arquivo. Próximo: bloco `modifications` no simulation.json e aplicação na carga, antes do filtro parcial.
- **Codex — mapa e infraestrutura:** ops reservadas `map.add_node|remove_node|edit_node|add_edge|remove_edge|edit_edge` (o validador as aceita e avisa que não são aplicadas). Falta: regras de validação (nós existem, sem links soltos, semáforos/pontos/rotas que usam o link ou nó removido), aplicação no engine antes do `CityMapUtil` e, se quiser, seletor geográfico. Infraestrutura (semáforos, pontos, estações, metrô) já é ator comum: add/remove/edit cobre, só faltam as regras de consistência. Seção "Reserved for the map" do MODIFICATIONS.md.

- Descritores de atores (JSON Schema + `x-htc-*`): `hyperbolic-time-chamber/schemas/actors/`, doc em `hyperbolic-time-chamber/docs/ACTOR_DESCRIPTORS.md`. Formulário gerado: `components/schemas/actor-form.tsx`, usado no editor de modificações ("Editar um ator por formulário"). Faltam descritores de Bus/BusStop/BusStation/Subway/SubwayStation/RailLink/RoutingService (Codex, mapa e infraestrutura, deve começar por estes).

## Modificações no engine e nas telas
- Engine: bloco `modifications.files` (lista ordenada) no simulation.json; `ScenarioModifications` aplica add/remove/edit por ids, valida na carga e aborta se inválido; seletores `select` e `map.*` ainda não (seletor falha a carga, `map.*` é ignorado com aviso). O filtro parcial enxerga o cenário já modificado.
- API: `POST /api/scenarios/partial-config` aceita `modification_files` (e seleção opcional); `POST /api/modifications/validate` aceita `files` (validação conjunta, erros como `arquivo#n`).
- UI: `components/modifications/modification-picker.tsx` (lista ordenada) no passo Parcial e na página Simulator; botão "Rodar a completa alterada (referência)" no passo Parcial; selos "Parcial" e "Alterada" no monitor e no Simulator.
- Falta: seletores no engine, mapa/infra (Codex), passo/seletor de referência na etapa Estimar, estado "Concluída" da API REST do engine.

## Variações de estimação (etapa Estimar)
- Estágio `estimation_variants` (`simedape/stages/estimation_variants.py`), catálogo em `simedape/estimation_variants.py` (100 variações: DTW 28, PCA 28, PCA Δ 44). UI: `components/simedape/variant-picker.tsx` (matriz método × interpolação, filtro de autovalores, presets) e ranking em `results-view.tsx`. Os estágios antigos `estimation`/`pca_estimation` continuam existindo.
- Varredura (sweep): passo "Varredura" do SimEDaPE (`components/simedape/sweep-panel.tsx`): várias parciais já executadas (rótulo, local, % da amostra) × variações escolhidas; resultado: gráfico erro × % da parcial, ranking e cobertura, com exportação. `SweepStage` ganhou o parâmetro `variants`. Não gera gráficos PDF antigos (`generate_plots: false`).

- **Sessão 2026-11-01:** ponto de entrada consolidado em `docs/SESSION_HANDOFF_2026-11-01.md` (como rodar, o que foi/não foi verificado, pendências).
