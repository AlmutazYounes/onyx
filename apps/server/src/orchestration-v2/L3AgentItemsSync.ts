import { setL3AgentItems } from "@t3tools/provider-opencode/server/L3AgentItems";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

/** Keeps OpenCode's L3 permission rules in step with the agent items switched on in settings. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* ServerSettings.ServerSettingsService;
    // Set before any session builds its rules, so the first turn is already lean.
    setL3AgentItems((yield* settings.getSettings).l3AgentItems);
    yield* forkParked(
      Stream.runForEach(settings.streamChanges, (next) =>
        Effect.sync(() => setL3AgentItems(next.l3AgentItems)),
      ),
    );
  }),
);
