import type { Workspace } from '../types/platform';

/** Props every workspace module (corporate, research, legal, placement) receives from the workspace page. */
export interface WorkspaceModuleProps {
  ws: Workspace;
  reloadWs: () => Promise<void>;
}
