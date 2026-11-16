import type { EnvironmentId } from "@t3tools/contracts";

import FileBrowserPanel from "./FileBrowserPanel";

/** The editor layout's file tree, shown in the window sidebar beside the view rail. */
export function EditorExplorer(props: {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  onOpenFile: (relativePath: string) => void;
  workspaceMutationId: string | null;
}) {
  return (
    <section aria-label="Explorer" className="flex min-h-0 flex-1 flex-col">
      <h2 className="flex h-8 shrink-0 items-center px-3 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        Explorer
      </h2>
      <div className="flex min-h-0 flex-1 flex-col">
        <FileBrowserPanel
          key={`${props.environmentId}:${props.cwd}`}
          environmentId={props.environmentId}
          cwd={props.cwd}
          projectName={props.projectName}
          selectedPath={props.selectedPath}
          selectedPathRevealId={0}
          onOpenFile={props.onOpenFile}
          workspaceMutationId={props.workspaceMutationId}
        />
      </div>
    </section>
  );
}
