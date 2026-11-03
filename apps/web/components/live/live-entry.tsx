"use client"
import dynamic from "next/dynamic"

const LiveViewer = dynamic(
  () => import("./live-viewer").then((module) => module.LiveViewer),
  { ssr: false }
)
const ManagedLiveViewer = dynamic(
  () =>
    import("./managed-live-viewer").then((module) => module.ManagedLiveViewer),
  { ssr: false }
)

export function LiveEntry({ runId }: { runId: string | null }) {
  return runId ? (
    <ManagedLiveViewer key={runId} runId={runId} />
  ) : (
    <LiveViewer />
  )
}
