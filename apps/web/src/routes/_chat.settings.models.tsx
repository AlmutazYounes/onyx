import { createFileRoute } from "@tanstack/react-router";

import { LocalModelsSettingsPanel } from "../components/settings/LocalModelsSettings";

export const Route = createFileRoute("/_chat/settings/models")({
  component: LocalModelsSettingsPanel,
});
