/** One decoded WebSocket frame from htc-bus-live (see `LiveEventCodec` there). `data` is the
 * same `Map[String, Any]` the engine already sends to Parquet — the label decides its shape
 * (see htc-replay's docs/ETL_SCHEMA.md "How a segment's (...) is derived" section; the live
 * path below mirrors that logic, incrementally instead of from a whole file). */
export interface LiveEnvelope {
  simulationId: string;
  entityId: string;
  tick: number;
  lamportTick: number;
  label: string;
  data: Record<string, unknown>;
}

export type LiveConnectionState = "connecting" | "open" | "closed" | "error";
