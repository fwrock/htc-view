/** WebSocket URL for the live-simulation-visualization feed (htc-bus-live's `LiveApp`,
 * `GET /ws/live`). Overridable per-environment via `NEXT_PUBLIC_HTC_LIVE_WS_URL` — see
 * `.env.local.example`.
 */
export const LIVE_WS_URL = process.env.NEXT_PUBLIC_HTC_LIVE_WS_URL ?? "ws://localhost:8090/ws/live"
