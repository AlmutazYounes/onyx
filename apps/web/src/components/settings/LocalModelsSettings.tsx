import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, LocalModelInfo, LocalModelsSnapshot } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  AGENT_PROMPT_TOKENS,
  ANSWER_TOKENS,
  formatCount,
  formatDuration,
  formatRate,
  formatTokens,
  memoryFit,
  readingSpeed,
  writingSpeed,
  type MemoryFit,
  type Speed,
} from "./LocalModelsSettings.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

export function LocalModelsSettingsPanel() {
  const { environment } = useSettingsScope();
  return (
    <SettingsPageContainer width="wide">
      {environment ? (
        <LocalModels environmentId={environment.environmentId} />
      ) : (
        <p className="px-4 text-sm text-muted-foreground">
          Connect an environment to see its local models.
        </p>
      )}
    </SettingsPageContainer>
  );
}

function LocalModels({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const result = useAtomValue(serverEnvironment.localModels({ environmentId, input: {} }));
  if (result._tag !== "Success") {
    return (
      <p className="px-4 text-sm text-muted-foreground">
        {result._tag === "Failure" ? "Could not read local models." : "Reading local models…"}
      </p>
    );
  }
  const snapshot = result.value;
  return (
    <>
      <SettingsSection id="local-models-host" title="This machine" variant="plain">
        <HostSummary snapshot={snapshot} />
      </SettingsSection>
      <SettingsSection id="local-models" title="Models" variant="plain">
        {!snapshot.ollama.running ? (
          <p className="px-4 text-sm text-muted-foreground">
            Ollama is not answering on 127.0.0.1:11434. Start Onyx with scripts/l3, or run
            <code className="mx-1 font-mono">brew services start ollama</code>.
          </p>
        ) : null}
        <div className="grid gap-3 px-3 sm:px-4 lg:grid-cols-2">
          {snapshot.models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              snapshot={snapshot}
              environmentId={environmentId}
            />
          ))}
        </div>
      </SettingsSection>
    </>
  );
}

function HostSummary({ snapshot }: { readonly snapshot: LocalModelsSnapshot }) {
  const { host } = snapshot;
  return (
    <div className="space-y-1.5 px-4 text-sm">
      <p className="text-foreground">
        {host.chip} · {formatBytes(host.totalMemoryBytes)} memory · about{" "}
        {formatBytes(host.gpuMemoryBudgetBytes)} usable by the GPU
        {snapshot.ollama.version ? ` · Ollama ${snapshot.ollama.version}` : ""}
      </p>
      <p className="text-muted-foreground">
        Writing speed sets how fast a reply streams. Reading speed sets how long an agent waits
        before each turn starts, because it re-reads a prompt of about{" "}
        {formatTokens(AGENT_PROMPT_TOKENS)} tokens. Only one model fits in memory at a time here, so
        switching models reloads it.
      </p>
    </div>
  );
}

const FIT_LABEL: Record<MemoryFit, string> = {
  fits: "Fits",
  tight: "Tight",
  "too big": "Too big",
};
const FIT_BADGE: Record<MemoryFit, "success" | "warning" | "error"> = {
  fits: "success",
  tight: "warning",
  "too big": "error",
};
const FIT_BAR: Record<MemoryFit, string> = {
  fits: "bg-success",
  tight: "bg-warning",
  "too big": "bg-destructive",
};

function ModelCard({
  model,
  snapshot,
  environmentId,
}: {
  readonly model: LocalModelInfo;
  readonly snapshot: LocalModelsSnapshot;
  readonly environmentId: EnvironmentId;
}) {
  const writing = writingSpeed(model);
  const reading = readingSpeed(model);
  const fit = model.memoryBytes === null ? null : memoryFit(model.memoryBytes, snapshot.host);

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <header className="flex flex-wrap items-center gap-1.5">
        <h3 className="basis-full text-sm font-semibold">{model.name}</h3>
        {model.isDefault ? <Badge variant="info">Default</Badge> : null}
        {model.loadedMemoryBytes !== null ? <Badge variant="success">Loaded</Badge> : null}
        {!model.installed ? (
          <Badge variant="outline">Not installed</Badge>
        ) : model.inPicker ? (
          <Badge variant="secondary">In model picker</Badge>
        ) : (
          <Badge variant="outline">Ollama only</Badge>
        )}
      </header>

      {model.installed ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <SpeedStat label="writing" speed={writing} />
            <SpeedStat label="reading" speed={reading} />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatTokens(AGENT_PROMPT_TOKENS)}-token prompt{" "}
            <span className="text-foreground">
              {reading ? formatDuration(AGENT_PROMPT_TOKENS / reading.tokensPerSecond) : "?"}
            </span>
            {" · "}
            {ANSWER_TOKENS.toLocaleString()}-token answer{" "}
            <span className="text-foreground">
              {writing ? formatDuration(ANSWER_TOKENS / writing.tokensPerSecond) : "?"}
            </span>
          </p>
          {model.memoryBytes !== null && fit !== null ? (
            <MemoryBar model={model} snapshot={snapshot} fit={fit} />
          ) : null}
          <p className="text-xs text-muted-foreground">{specLine(model)}</p>
          <ModelConfig
            model={model}
            action={
              <div className="flex items-center gap-2">
                <LoadButton model={model} snapshot={snapshot} environmentId={environmentId} />
                <MeasureButton model={model} snapshot={snapshot} environmentId={environmentId} />
              </div>
            }
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Install it from the Onyx folder with{" "}
          <code className="font-mono text-foreground">{model.installCommand}</code>, then it appears
          in the model picker.
        </p>
      )}
    </article>
  );
}

function SpeedStat({ label, speed }: { readonly label: string; readonly speed: Speed | null }) {
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">
          {speed
            ? `${speed.source === "estimate" ? "~" : ""}${formatRate(speed.tokensPerSecond)}`
            : "?"}
        </span>
        <span className="text-xs text-muted-foreground">tok/s {label}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {speed === null
          ? "Measure to find out"
          : speed.source === "measured"
            ? "Measured"
            : speed.source === "in use"
              ? "Seen in use"
              : "Estimate"}
      </p>
    </div>
  );
}

function MemoryBar({
  model,
  snapshot,
  fit,
}: {
  readonly model: LocalModelInfo;
  readonly snapshot: LocalModelsSnapshot;
  readonly fit: MemoryFit;
}) {
  const total = snapshot.host.totalMemoryBytes;
  const used = Math.min(1, model.memoryBytes! / total);
  const budget = snapshot.host.gpuMemoryBudgetBytes / total;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          Memory {model.memoryEstimated ? "~" : ""}
          {formatBytes(model.memoryBytes!)} of {formatBytes(total)}
          {model.loadedMemoryBytes === null && !model.memoryEstimated ? " (last loaded)" : ""}
        </span>
        <Badge variant={FIT_BADGE[fit]} size="sm">
          {FIT_LABEL[fit]}
        </Badge>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", FIT_BAR[fit])}
          style={{ width: `${used * 100}%` }}
        />
        <div
          aria-hidden
          className="absolute inset-y-0 w-px bg-foreground/40"
          style={{ left: `${budget * 100}%` }}
        />
      </div>
    </div>
  );
}

function specLine(model: LocalModelInfo) {
  const parts: string[] = [];
  if (model.sizeBytes !== null) parts.push(`${formatBytes(model.sizeBytes)} on disk`);
  if (model.parameterCount !== null) {
    const active =
      model.activeParameterCount !== null && model.activeParameterCount < model.parameterCount
        ? ` (${formatCount(model.activeParameterCount)} active${model.experts ? `, ${model.experts.used} of ${model.experts.total} experts` : ""})`
        : "";
    parts.push(`${formatCount(model.parameterCount)} params${active}`);
  }
  if (model.quantization) {
    parts.push(
      `${model.quantization}${model.bitsPerWeight ? ` (${model.bitsPerWeight.toFixed(1)} bits)` : ""}`,
    );
  }
  if (model.contextTokens !== null) {
    parts.push(
      `${formatTokens(model.contextTokens)} context${model.maxContextTokens && model.maxContextTokens > model.contextTokens ? ` of ${formatTokens(model.maxContextTokens)}` : ""}`,
    );
  }
  return parts.join(" · ");
}

function ModelConfig({
  model,
  action,
}: {
  readonly model: LocalModelInfo;
  readonly action: ReactNode;
}) {
  const rows: Array<readonly [string, string]> = [
    ["Ollama name", model.id],
    ...(model.family ? [["Architecture", model.family] as const] : []),
    ...model.parameters.map((parameter) => [parameter.name, parameter.value] as const),
    ...(model.capabilities.length > 0
      ? [["Capabilities", model.capabilities.join(", ")] as const]
      : []),
    ...(model.license ? [["License", model.license] as const] : []),
    ...(model.benchmark
      ? [
          [
            "Last measured",
            `${new Date(model.benchmark.measuredAt).toLocaleString()} · ${model.benchmark.promptTokens.toLocaleString()} prompt tokens, ${model.benchmark.generatedTokens} written${model.benchmark.loadMs > 0 ? ` · loaded in ${formatDuration(model.benchmark.loadMs / 1000)}` : ""}`,
          ] as const,
        ]
      : []),
    ...(model.digest ? [["Digest", model.digest.slice(0, 12)] as const] : []),
  ];
  return (
    <Collapsible>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
          Config
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsiblePanel>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="min-w-0 break-words font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function LoadButton({
  model,
  snapshot,
  environmentId,
}: {
  readonly model: LocalModelInfo;
  readonly snapshot: LocalModelsSnapshot;
  readonly environmentId: EnvironmentId;
}) {
  const registry = useContext(RegistryContext);
  const setLoaded = useAtomCommand(serverEnvironment.setLocalModelLoaded);
  const allowed = useAtomValue(serverEnvironment.setLocalModelLoaded.permissionAtom(environmentId));
  const [pending, setPending] = useState(false);
  const loaded = model.loadedMemoryBytes !== null;
  const run = async () => {
    setPending(true);
    const result = await setLoaded({ environmentId, input: { model: model.id, loaded: !loaded } });
    setPending(false);
    registry.refresh(serverEnvironment.localModels({ environmentId, input: {} }));
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: loaded ? `Could not unload ${model.name}` : `Could not load ${model.name}`,
      description:
        typeof failure === "object" && failure !== null && "message" in failure
          ? String(failure.message)
          : String(failure),
    });
  };
  // Unloading mid-reply would cut the agent off.
  const blocked = loaded && snapshot.busy;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || blocked || !allowed}
            onClick={() => void run()}
          >
            {pending ? <Spinner /> : null}
            {pending ? (loaded ? "Unloading…" : "Loading…") : loaded ? "Unload" : "Load"}
          </Button>
        }
      />
      <TooltipPopup>
        {blocked
          ? "An agent is using this model right now."
          : loaded
            ? `Frees ${model.memoryBytes === null ? "its memory" : formatBytes(model.memoryBytes)} now. It loads again on your next message.`
            : "Loads it now so your next message starts at once. Ollama frees it after 10 idle minutes."}
      </TooltipPopup>
    </Tooltip>
  );
}

function MeasureButton({
  model,
  snapshot,
  environmentId,
}: {
  readonly model: LocalModelInfo;
  readonly snapshot: LocalModelsSnapshot;
  readonly environmentId: EnvironmentId;
}) {
  const registry = useContext(RegistryContext);
  const measure = useAtomCommand(serverEnvironment.measureLocalModel);
  const allowed = useAtomValue(serverEnvironment.measureLocalModel.permissionAtom(environmentId));
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    const result = await measure({ environmentId, input: { model: model.id } });
    setPending(false);
    registry.refresh(serverEnvironment.localModels({ environmentId, input: {} }));
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: `Could not measure ${model.name}`,
      description:
        typeof failure === "object" && failure !== null && "message" in failure
          ? String(failure.message)
          : String(failure),
    });
  };
  const evicts =
    model.loadedMemoryBytes === null && snapshot.models.some((m) => m.loadedMemoryBytes !== null);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={pending || snapshot.busy || !allowed}
            onClick={() => void run()}
          >
            {pending ? <Spinner /> : null}
            {pending ? "Measuring…" : "Measure speed"}
          </Button>
        }
      />
      <TooltipPopup>
        {snapshot.busy
          ? "An agent is using the local model right now."
          : evicts
            ? "Reads a 4K-token prompt and writes 256 tokens. This model replaces the loaded one, which reloads on the next agent turn."
            : "Reads a 4K-token prompt and writes 256 tokens, about half a minute."}
      </TooltipPopup>
    </Tooltip>
  );
}
