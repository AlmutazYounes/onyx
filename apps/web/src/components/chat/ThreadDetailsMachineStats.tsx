import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, HostResourcesSnapshot } from "@t3tools/contracts";
import { useContext, useEffect } from "react";

import { serverEnvironment } from "../../state/server";
import { UsageRow, type UsageTone } from "./ThreadDetailsUsage";

const POLL_MS = 2_000;
const GIB = 1024 ** 3;

const percent = (fraction: number) => Math.round(Math.max(0, Math.min(1, fraction)) * 100);
const gib = (bytes: number) => `${(bytes / GIB).toFixed(1)} GB`;
const loadTone = (used: number): UsageTone =>
  used >= 90 ? "error" : used >= 80 ? "warning" : null;

/** Live CPU, memory, GPU and local-model speed for the environment's machine. */
export function ThreadDetailsMachineStats({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const registry = useContext(RegistryContext);
  const result = useAtomValue(serverEnvironment.hostResources({ environmentId, input: {} }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the host on a timer only while the panel is open
  useEffect(() => {
    const timer = setInterval(
      () => registry.refresh(serverEnvironment.hostResources({ environmentId, input: {} })),
      POLL_MS,
    );
    return () => clearInterval(timer);
  }, [registry, environmentId]);

  const snapshot = result._tag === "Success" ? result.value : null;
  if (snapshot === null) return null;
  return <MachineStatsRows snapshot={snapshot} />;
}

function MachineStatsRows({ snapshot }: { readonly snapshot: HostResourcesSnapshot }) {
  const cpu = snapshot.cpuUtilization === null ? null : percent(snapshot.cpuUtilization);
  const usedMemory = snapshot.totalMemoryBytes - snapshot.availableMemoryBytes;
  const memory =
    snapshot.totalMemoryBytes > 0 ? percent(usedMemory / snapshot.totalMemoryBytes) : null;
  const gpu =
    snapshot.gpuUtilization === undefined || snapshot.gpuUtilization === null
      ? null
      : percent(snapshot.gpuUtilization);
  const model = snapshot.localModel ?? null;
  const rate = model?.tokensPerSecond ?? null;

  return (
    <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 py-1 text-xs">
      {cpu !== null ? (
        <UsageRow
          label="CPU"
          fill={cpu}
          tone={null}
          muted
          value={`${cpu}%`}
          tooltip={
            <span className="text-foreground">
              CPU: {cpu}% across {snapshot.cpuCount} cores
            </span>
          }
        />
      ) : null}
      {memory !== null ? (
        <UsageRow
          label="RAM"
          fill={memory}
          tone={loadTone(memory)}
          muted
          value={`${gib(usedMemory)} / ${gib(snapshot.totalMemoryBytes)}`}
          ariaValue={`${memory}% used`}
          tooltip={
            <>
              <span className="text-foreground">RAM: {memory}% used</span>
              {model?.memoryBytes ? (
                <span className="text-muted-foreground">
                  The model holds {gib(model.memoryBytes)}
                </span>
              ) : null}
            </>
          }
        />
      ) : null}
      {gpu !== null ? (
        <UsageRow
          label="GPU"
          fill={gpu}
          tone={null}
          muted
          value={`${gpu}%`}
          tooltip={<span className="text-foreground">GPU: {gpu}% busy</span>}
        />
      ) : null}
      {model ? (
        <UsageRow
          label={model.generating ? "Generating" : "Speed"}
          fill={null}
          tone={null}
          value={rate === null ? "Idle" : `${rate.toFixed(1)} tok/s`}
          ariaValue={rate === null ? "no response yet" : `${rate.toFixed(1)} tokens per second`}
          tooltip={
            <>
              <span className="text-foreground">
                {model.name}
                {model.memoryBytes === null ? " · not loaded" : ` · ${gib(model.memoryBytes)}`}
              </span>
              <span className="text-muted-foreground">
                {model.generating
                  ? "Tokens per second right now"
                  : rate === null
                    ? "Speed shows once the model answers"
                    : "Speed of the last response"}
              </span>
            </>
          }
        />
      ) : null}
    </div>
  );
}
