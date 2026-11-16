import * as Schema from "effect/Schema";
import { createContext, use } from "react";
import { create } from "zustand";

import { useLocalStorage } from "./hooks/useLocalStorage";

/**
 * How a thread's window is arranged. `agents` puts the chat first with the workspace panel beside
 * it; `editor` makes the panel the main area, file tree on the left and terminal below, with the
 * chat docked on the right.
 */
export const WorkspaceLayout = Schema.Literals(["agents", "editor"]);
export type WorkspaceLayout = typeof WorkspaceLayout.Type;

const WORKSPACE_LAYOUT_STORAGE_KEY = "onyx:workspace-layout";

export function useWorkspaceLayoutPreference() {
  return useLocalStorage<WorkspaceLayout, WorkspaceLayout>(
    WORKSPACE_LAYOUT_STORAGE_KEY,
    "agents",
    WorkspaceLayout,
  );
}

/** The layout in effect for the panels below; `agents` wherever no thread view sets it. */
export const WorkspaceLayoutContext = createContext<WorkspaceLayout>("agents");

export const useWorkspaceLayout = () => use(WorkspaceLayoutContext);

const TOGGLE_REQUEST_EVENT = "onyx:workspace-layout-toggle";

/** Asks the open thread view to switch layouts; places like the command palette have no handle on it. */
export function requestWorkspaceLayoutToggle() {
  window.dispatchEvent(new Event(TOGGLE_REQUEST_EVENT));
}

export function onWorkspaceLayoutToggleRequest(listener: () => void) {
  window.addEventListener(TOGGLE_REQUEST_EVENT, listener);
  return () => window.removeEventListener(TOGGLE_REQUEST_EVENT, listener);
}

export type EditorSidebarView = "explorer" | "threads";

interface EditorViewState {
  /** True while a thread view shows the editor layout, which takes over the window sidebar. */
  readonly active: boolean;
  readonly view: EditorSidebarView;
  /** Where the thread view renders its file tree. */
  readonly explorerSlot: HTMLElement | null;
  readonly openChanges: (() => void) | null;
}

export const useEditorViewStore = create<EditorViewState>(() => ({
  active: false,
  view: "explorer",
  explorerSlot: null,
  openChanges: null,
}));
