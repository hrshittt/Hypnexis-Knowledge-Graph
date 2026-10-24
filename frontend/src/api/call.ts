import { http } from '../lib/http';

// ── Call Paheli (OmniDimension outbound voice call) ─────────────────────────
export const callApi = {
  status: () => http<{ enabled: boolean }>('/api/call/status'),
  paheli: (phone: string) =>
    http<{ ok: boolean; to_number: string; request_id: string | number | null }>('/api/call/paheli', { body: { phone } }),
};
