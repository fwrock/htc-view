"use client"

import dynamic from "next/dynamic"

// Same SSR boundary as /simulator/live — the replay tree also touches browser-only APIs
// (Web Workers, WebGL via deck.gl/maplibre) throughout.
const ReplayViewer = dynamic(() => import("@/components/live/replay-viewer").then((m) => m.ReplayViewer), {
  ssr: false,
})

export default function SimulatorReplayPage() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <ReplayViewer />
    </div>
  )
}
