import * as NodeOS from "node:os";
import {
  L3_LOCAL_MODEL,
  L3_OLLAMA_BASE_URL,
  l3CanonicalModelId,
  type HostResourcesSnapshot,
  type LocalModelStats,
} from "@t3tools/contracts";
import { readL3ModelRate } from "@t3tools/provider-opencode/server/L3ModelMeter";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import {
  groupProcesses,
  parseGpuClientTimes,
  parseProcessRows,
  shareUsage,
} from "./hostBreakdown.ts";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class HostResources extends Context.Service<
  HostResources,
  { readonly read: Effect.Effect<HostResourcesSnapshot> }
>()("t3/resourceTelemetry/HostResources") {}

// Linux CPU list syntax, as in Cpus_allowed_list: "0-3,8,10-11".
function parseCpuList(list: string): ReadonlySet<number> | null {
  const cpus = new Set<number>();
  for (const range of list.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(range.trim());
    if (!match) return null;
    for (let cpu = Number(match[1]); cpu <= Number(match[2] ?? match[1]); cpu++) cpus.add(cpu);
  }
  return cpus;
}

// os.cpus() compacts online CPUs, so its indices are not CPU ids; /proc/stat lines are keyed.
function pinnedCpu(stat: string, allowed: ReadonlySet<number>) {
  const cpu = { idle: 0, total: 0, count: 0 };
  for (const [, id, fields] of stat.matchAll(/^cpu(\d+) (.+)$/gm)) {
    if (!allowed.has(Number(id))) continue;
    const counters = (fields ?? "").trim().split(/\s+/).map(Number);
    const at = (index: number) => counters[index] ?? 0;
    // user nice system idle iowait irq softirq steal
    const idle = at(3) + at(4);
    cpu.idle += idle;
    cpu.total += idle + at(0) + at(1) + at(2) + at(5) + at(6) + at(7);
    cpu.count++;
  }
  return cpu.count > 0 ? cpu : null;
}

function readCpu() {
  const cpus = NodeOS.cpus();
  const cpu = cpus.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );
  return { ...cpu, count: cpus.length };
}

function darwinAvailableMemory(output: string): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  const free = /^Pages free:\s+(\d+)\./m.exec(output)?.[1];
  const inactive = /^Pages inactive:\s+(\d+)\./m.exec(output)?.[1];
  const speculative = /^Pages speculative:\s+(\d+)\./m.exec(output)?.[1];
  if (!pageSize || !free || !inactive || !speculative) return null;
  // vm_stat excludes speculative from free; add it once, without overlapping purgeable pages.
  const available = (Number(free) + Number(inactive) + Number(speculative)) * Number(pageSize);
  return Number.isSafeInteger(available) && Number(pageSize) > 0 ? available : null;
}

function cgroupNumber(text: string, pattern: RegExp): number | null {
  const value = pattern.exec(text)?.[1];
  return value === undefined ? null : Number(value);
}

// Apple GPUs report utilization through IOAccelerator without elevated privileges.
function darwinGpuUtilization(ioreg: string): number | null {
  const percent = /"Device Utilization %"=(\d+)/.exec(ioreg)?.[1];
  return percent === undefined ? null : Math.min(1, Math.max(0, Number(percent) / 100));
}

const OllamaRunningModels = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({ name: Schema.String, size_vram: Schema.optional(Schema.Number) }),
  ),
});
const decodeOllamaRunningModels = Schema.decodeUnknownEffect(OllamaRunningModels);
const OLLAMA_PS_URL = new URL("/api/ps", L3_OLLAMA_BASE_URL).toString();

const make = Effect.fn("makeHostResources")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = yield* HttpClient.HttpClient;

  const readGpu = () =>
    platform === "darwin"
      ? spawner
          .string(
            ChildProcess.make(
              "/usr/sbin/ioreg",
              ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"],
              {
                stdin: "ignore",
                stderr: "ignore",
              },
            ),
          )
          .pipe(
            Effect.timeout("1 second"),
            Effect.map(darwinGpuUtilization),
            Effect.orElseSucceed(() => null),
          )
      : Effect.succeed(null);

  const readLocalModel = Effect.fn("HostResources.readLocalModel")(function* () {
    const running = yield* http.execute(HttpClientRequest.get(OLLAMA_PS_URL)).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(decodeOllamaRunningModels),
      Effect.timeout("1 second"),
      Effect.option,
    );
    // Ollama not running: nothing to show.
    if (running._tag === "None") return null;
    const loaded = running.value.models.find(
      (model) => l3CanonicalModelId(model.name) === L3_LOCAL_MODEL,
    );
    const rate = readL3ModelRate(DateTime.toEpochMillis(yield* DateTime.now));
    return {
      name: L3_LOCAL_MODEL,
      memoryBytes: loaded?.size_vram === undefined ? null : Math.round(loaded.size_vram),
      generating: rate.generating,
      tokensPerSecond: rate.tokensPerSecond,
    } satisfies LocalModelStats;
  });

  const readFile = (path: string) => fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));

  const run = (command: string, args: ReadonlyArray<string>) =>
    spawner
      .string(ChildProcess.make(command, [...args], { stdin: "ignore", stderr: "ignore" }))
      .pipe(
        Effect.timeout("2 seconds"),
        Effect.orElseSucceed(() => ""),
      );
  // GPU time only means something as a change since the last sample.
  let previousGpuTimes: ReadonlyMap<number, number> | null = null;
  const readUsage = Effect.fn("HostResources.readUsage")(function* (input: {
    readonly cpuCount: number;
    readonly cpuUtilization: number | null;
    readonly gpuUtilization: number | null;
  }) {
    if (platform !== "darwin" && platform !== "linux") return null;
    const rows = parseProcessRows(yield* run("ps", ["-Ao", "pid=,ppid=,pcpu=,rss=,comm="]));
    if (rows.length === 0) return null;
    const gpuNow =
      platform === "darwin"
        ? parseGpuClientTimes(
            yield* run("/usr/sbin/ioreg", ["-r", "-c", "AGXDeviceUserClient", "-l", "-w", "0"]),
          )
        : new Map<number, number>();
    const usage = shareUsage({
      rows,
      groups: groupProcesses(rows, process.pid),
      ...input,
      gpuNow,
      gpuBefore: previousGpuTimes,
    });
    previousGpuTimes = gpuNow;
    return usage;
  });

  const sample = Effect.fn("HostResources.sample")(function* () {
    // cgroup v2 only; limits of the server's own cgroup, which is `/` inside a container.
    const cgroupPath =
      platform === "linux"
        ? /^0::(\/.*)$/m.exec(yield* readFile("/proc/self/cgroup"))?.[1]
        : undefined;
    const cgroup =
      cgroupPath === undefined ? null : `/sys/fs/cgroup${cgroupPath.replace(/\/$/, "")}`;
    const cpuMax = cgroup
      ? /^(\d+) (\d+)$/.exec((yield* readFile(`${cgroup}/cpu.max`)).trim())
      : null;
    const readCpuUsage = () =>
      cpuMax
        ? Effect.map(readFile(`${cgroup}/cpu.stat`), (stat) =>
            cgroupNumber(stat, /^usage_usec (\d+)$/m),
          )
        : Effect.succeed(null);
    // Affinity (cpuset) pins the server to some CPUs; idle CPUs outside it are of no use.
    const allowedCpus =
      platform === "linux"
        ? parseCpuList(
            /^Cpus_allowed_list:\s*(\S+)$/m.exec(yield* readFile("/proc/self/status"))?.[1] ?? "",
          )
        : null;

    const sampleCpu = () =>
      allowedCpus
        ? Effect.map(readFile("/proc/stat"), (stat) => pinnedCpu(stat, allowedCpus) ?? readCpu())
        : Effect.sync(readCpu);

    const previousCpu = yield* sampleCpu();
    const previousUsage = yield* readCpuUsage();
    const startedAt = yield* Clock.currentTimeMillis;
    yield* Effect.sleep("200 millis");
    const cpu = yield* sampleCpu();
    const usage = yield* readCpuUsage();
    const elapsedMicros = ((yield* Clock.currentTimeMillis) - startedAt) * 1000;
    const totalDelta = cpu.total - previousCpu.total;
    const idleDelta = cpu.idle - previousCpu.idle;
    let cpuCount = cpu.count;
    const hostUtilization =
      previousCpu.count === cpu.count && totalDelta > 0 && idleDelta >= 0
        ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
        : null;
    let cpuUtilization = hostUtilization;
    if (cpuMax) {
      const capacity = Math.min(Number(cpuMax[1]) / Number(cpuMax[2]), cpu.count);
      cpuCount = Math.max(1, Math.floor(capacity));
      const cgroupIdle =
        previousUsage !== null && usage !== null && elapsedMicros > 0
          ? capacity - (usage - previousUsage) / elapsedMicros
          : null;
      // Agents can run in sibling cgroups (agentScope.ts), so a busy host still counts.
      const hostIdle = hostUtilization === null ? null : cpu.count * (1 - hostUtilization);
      const idle =
        cgroupIdle === null || hostIdle === null
          ? (cgroupIdle ?? hostIdle)
          : Math.min(cgroupIdle, hostIdle);
      cpuUtilization = idle === null ? null : Math.min(1, Math.max(0, 1 - idle / capacity));
    }

    let totalMemoryBytes = NodeOS.totalmem();
    // On Windows libuv returns GlobalMemoryStatusEx.ullAvailPhys, including standby memory.
    let availableMemoryBytes = NodeOS.freemem();
    if (platform === "linux") {
      const meminfo = yield* readFile("/proc/meminfo");
      const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      if (available) availableMemoryBytes = Number(available) * 1024;
    } else if (platform === "darwin") {
      const output = yield* spawner
        .string(ChildProcess.make("/usr/bin/vm_stat", [], { stdin: "ignore", stderr: "ignore" }))
        .pipe(
          Effect.timeout("1 second"),
          Effect.orElseSucceed(() => ""),
        );
      availableMemoryBytes = darwinAvailableMemory(output) ?? availableMemoryBytes;
    }
    const memoryMax = cgroup
      ? cgroupNumber(yield* readFile(`${cgroup}/memory.max`), /^(\d+)$/m)
      : null;
    const memoryCurrent =
      memoryMax === null
        ? null
        : cgroupNumber(yield* readFile(`${cgroup}/memory.current`), /^(\d+)$/m);
    // Without usage, a capped total would read as a near-empty cgroup; keep host values instead.
    if (memoryMax !== null && memoryCurrent !== null) {
      totalMemoryBytes = Math.min(totalMemoryBytes, memoryMax);
      // inactive_file is page cache the kernel reclaims before hitting memory.max.
      const stat = yield* readFile(`${cgroup}/memory.stat`);
      const reclaimable = cgroupNumber(stat, /^inactive_file (\d+)$/m) ?? 0;
      availableMemoryBytes = Math.min(
        availableMemoryBytes,
        memoryMax - (memoryCurrent - reclaimable),
      );
    }
    const gpuUtilization = yield* readGpu();
    return {
      sampledAt: DateTime.toEpochMillis(yield* DateTime.now),
      cpuUtilization,
      cpuCount,
      availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
      totalMemoryBytes,
      gpuUtilization,
      localModel: yield* readLocalModel(),
      usage: yield* readUsage({ cpuCount, cpuUtilization, gpuUtilization }),
    };
  });

  const cache = yield* Cache.make({
    capacity: 1,
    lookup: (_key: "host") => sample(),
    // Short enough for the details panel's live tokens-per-second readout.
    timeToLive: "1500 millis",
  });
  return HostResources.of({ read: Cache.get(cache, "host") });
});

export const layer = Layer.effect(HostResources, make());
