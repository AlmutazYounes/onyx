import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, HostResourcesSnapshot } from "@t3tools/contracts";
import { useContext, useEffect } from "react";

import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { splitUsage } from "./ThreadDetailsMachineStats.logic";
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

// Onyx and its model in their own colors; everything else on the Mac stays neutral.
const ONYX_BAR = "bg-info";
const MODEL_BAR = "bg-fuchsia-500";
const OTHER_BAR = "bg-muted-foreground";
const SOURCES = [
  { label: "Onyx", className: ONYX_BAR },
  { label: "Local model", className: MODEL_BAR },
  { label: "Other apps", className: OTHER_BAR },
] as const;

function SourceLines({
  parts,
  format,
}: {
  readonly parts: readonly [number, number, number];
  readonly format: (part: number) => string;
}) {
  return (
    <>
      {SOURCES.map((source, index) => (
        <span key={source.label} className="flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden className={cn("size-1.5 rounded-full", source.className)} />
          {source.label} {format(parts[index]!)}
        </span>
      ))}
    </>
  );
}

const segmentsOf = (parts: readonly [number, number, number]) =>
  parts.map((part, index) => ({ fill: part, className: SOURCES[index]!.className }));

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
  const usage = snapshot.usage ?? null;
  const cpuParts =
    cpu !== null && usage ? splitUsage(cpu, usage.onyx.cpu * 100, usage.model.cpu * 100) : null;
  const memoryParts =
    memory !== null && usage
      ? splitUsage(
          (usedMemory / snapshot.totalMemoryBytes) * 100,
          (usage.onyx.memoryBytes / snapshot.totalMemoryBytes) * 100,
          (usage.model.memoryBytes / snapshot.totalMemoryBytes) * 100,
        )
      : null;
  const gpuParts =
    gpu !== null && usage && usage.onyx.gpu !== null && usage.model.gpu !== null
      ? splitUsage(gpu, usage.onyx.gpu * 100, usage.model.gpu * 100)
      : null;
  const asPercent = (part: number) => `${Math.round(part)}%`;
  const asMemory = (part: number) => gib((part / 100) * snapshot.totalMemoryBytes);

  return (
    <div className="grid grid-cols-[auto_minmax(3rem,1fr)_auto] gap-x-3 py-1 text-xs">
      {cpu !== null ? (
        <UsageRow
          label="CPU"
          fill={cpu}
          {...(cpuParts ? { segments: segmentsOf(cpuParts) } : {})}
          tone={null}
          muted
          value={`${cpu}%`}
          tooltip={
            <>
              <span className="text-foreground">
                CPU: {cpu}% across {snapshot.cpuCount} cores
              </span>
              {cpuParts ? <SourceLines parts={cpuParts} format={asPercent} /> : null}
            </>
          }
        />
      ) : null}
      {memory !== null ? (
        <UsageRow
          label="RAM"
          fill={memory}
          {...(memoryParts ? { segments: segmentsOf(memoryParts) } : {})}
          tone={loadTone(memory)}
          muted
          value={`${gib(usedMemory)} / ${gib(snapshot.totalMemoryBytes)}`}
          ariaValue={`${memory}% used`}
          tooltip={
            <>
              <span className="text-foreground">RAM: {memory}% used</span>
              {memoryParts ? (
                <SourceLines parts={memoryParts} format={asMemory} />
              ) : model?.memoryBytes ? (
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
          {...(gpuParts ? { segments: segmentsOf(gpuParts) } : {})}
          tone={null}
          muted
          value={`${gpu}%`}
          tooltip={
            <>
              <span className="text-foreground">GPU: {gpu}% busy</span>
              {gpuParts ? <SourceLines parts={gpuParts} format={asPercent} /> : null}
            </>
          }
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
      {usage ? (
        <div className="col-span-3 flex items-center gap-3 px-2.5 pt-0.5 text-2xs text-muted-foreground">
          {SOURCES.map((source) => (
            <span key={source.label} className="flex items-center gap-1">
              <span aria-hidden className={cn("size-1.5 rounded-full", source.className)} />
              {source.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
