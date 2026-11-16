import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { liveModelStatus } from "./liveModelStatus.logic";

/**
 * "Reading the prompt · 25K tokens · 12s", then "Thinking · 410 tokens · 41 tok/s", for threads on
 * Onyx's local model; null elsewhere, so callers keep their own label.
 */
export function useLiveModelStatus(
  threadRef: ScopedThreadRef | null,
  active: boolean,
  writingLabel?: string,
) {
  const { data } = useEnvironmentQuery(
    threadRef === null || !active
      ? null
      : serverEnvironment.modelContext({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        }),
  );
  const live = data?.live;
  const running = active && live !== undefined && live.finishedAt === null;
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a one-second clock for the elapsed and rate readout, only while the model runs
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return running ? liveModelStatus(live, now, writingLabel) : null;
}
