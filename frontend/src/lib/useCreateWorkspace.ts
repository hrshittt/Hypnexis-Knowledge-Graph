import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspacesApi } from '../api/platform';
import type { WorkspaceType } from '../types/platform';
import { useAuth } from './auth';
import { errorMessage } from './http';
import { useToast } from './toast';
import { TYPE_INFO } from './workspaceTypes';

/** Creates a workspace of the given type, refreshes the session's workspace list and opens it. */
export function useCreateWorkspace() {
  const { refreshWorkspaces } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState<WorkspaceType | null>(null);

  const create = async (type: WorkspaceType, name?: string, description?: string) => {
    setCreating(type);
    try {
      const ws = await workspacesApi.create({ type, name, description });
      await refreshWorkspaces();
      toast.success(`${ws.name} is ready.`);
      nav(`/app/w/${ws.id}?welcome=1`);
      return ws;
    } catch (e) {
      toast.error(`Couldn’t create the ${TYPE_INFO[type].label} workspace: ${errorMessage(e)}`);
      return null;
    } finally {
      setCreating(null);
    }
  };

  return { create, creating };
}
