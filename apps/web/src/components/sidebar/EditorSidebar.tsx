import { FolderIcon, GitCompareArrowsIcon, MessagesSquareIcon, SearchIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { dispatchCommandPalette } from "../../commandPaletteStore";
import { cn } from "../../lib/utils";
import { type EditorSidebarView, useEditorViewStore } from "../../workspaceLayout";
import { overlayModeForCommand } from "../CommandPalette.logic";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarChromeHeader } from "./SidebarChrome";

const setExplorerSlot = (explorerSlot: HTMLDivElement | null) =>
  useEditorViewStore.setState({ explorerSlot });

const showView = (view: EditorSidebarView) => useEditorViewStore.setState({ view });

function openProjectSearch() {
  const mode = overlayModeForCommand("projectSearch.toggle");
  if (mode !== null) dispatchCommandPalette({ _tag: "ToggleMode", mode });
}

function RailTooltip(props: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>{props.children}</TooltipTrigger>
      <TooltipPopup side="right">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function RailView(props: {
  view: EditorSidebarView;
  label: string;
  icon: ComponentType<{ className?: string }>;
}) {
  const Icon = props.icon;
  const active = useEditorViewStore((state) => state.view === props.view);
  return (
    <RailTooltip label={props.label}>
      <Toggle
        variant="ghost"
        aria-label={props.label}
        pressed={active}
        onPressedChange={() => showView(props.view)}
      >
        <Icon className={cn("size-4.5", !active && "text-muted-foreground")} />
      </Toggle>
    </RailTooltip>
  );
}

/**
 * The window sidebar in the editor layout: a rail of views beside the file tree, which the thread
 * view portals into the explorer slot. Threads stay one click away on the rail.
 */
export function EditorSidebar(props: { isElectron: boolean; threads: ReactNode }) {
  const view = useEditorViewStore((state) => state.view);
  const openChanges = useEditorViewStore((state) => state.openChanges);
  return (
    <>
      <SidebarChromeHeader isElectron={props.isElectron} />
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Views"
          className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-sidebar-border pt-1"
        >
          <RailView view="explorer" label="Explorer" icon={FolderIcon} />
          <RailTooltip label="Search project contents">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search project contents"
              onClick={openProjectSearch}
            >
              <SearchIcon className="size-4.5 text-muted-foreground" />
            </Button>
          </RailTooltip>
          <RailTooltip label={openChanges ? "Source control" : "Source control is unavailable"}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Source control"
              disabled={!openChanges}
              onClick={() => openChanges?.()}
            >
              <GitCompareArrowsIcon className="size-4.5 text-muted-foreground" />
            </Button>
          </RailTooltip>
          <RailView view="threads" label="Threads" icon={MessagesSquareIcon} />
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={setExplorerSlot}
            className={cn("min-h-0 flex-1 flex-col", view === "explorer" ? "flex" : "hidden")}
          />
          {view === "threads" ? (
            <div className="flex min-h-0 flex-1 flex-col">{props.threads}</div>
          ) : null}
        </div>
      </div>
    </>
  );
}
