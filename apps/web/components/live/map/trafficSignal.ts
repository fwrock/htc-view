import type { TrafficSignalConfig } from "../types/replay";

export type PhaseSignal = "Green" | "Red";

export interface PhaseStateNow {
  origin: string;
  state: PhaseSignal;
  /** Ticks remaining in the current state (green about to end, or red until this phase's
   * next green window starts). */
  remainingTicks: number;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Mirrors `TrafficSignalPhaseHandler.handlePhaseTransition` / `calcNewState` in the
 * simulator exactly: phase state at any tick is fully deterministic from the signal's
 * `cycleDuration`/`offset`/`startTick` and each phase's `greenStartTick`/`greenDurationTick` —
 * no event stream needed, this can be computed for any tick, including ticks the simulation
 * never actually reported an event for.
 *
 * Unverified against a real signal-bearing scenario — every fixture available while building
 * this had zero traffic signals configured (see docs/KNOWN_GAPS.md). Implemented directly from
 * the engine's source (`Phase.scala`/`TrafficSignalPhaseHandler.scala`), not from observed data.
 */
export function computeSignalPhases(signal: TrafficSignalConfig, tick: number): PhaseStateNow[] {
  const cycleTick = mod(tick - signal.startTick + signal.offset, signal.cycleDuration);

  return signal.phases.map((phase) => {
    const greenEnd = phase.greenStartTick + phase.greenDurationTick;
    const isGreen = cycleTick >= phase.greenStartTick && cycleTick < greenEnd;

    let remainingTicks: number;
    if (isGreen) {
      remainingTicks = greenEnd - cycleTick;
    } else if (cycleTick < phase.greenStartTick) {
      remainingTicks = phase.greenStartTick - cycleTick;
    } else {
      // Already past this cycle's green window — count down to next cycle's green start.
      remainingTicks = signal.cycleDuration - cycleTick + phase.greenStartTick;
    }

    return { origin: phase.origin, state: isGreen ? "Green" : "Red", remainingTicks };
  });
}
