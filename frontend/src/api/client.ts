// Lightweight API client for the Ageing Monitor backend.
const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

if (!BASE_URL) {
  // Fail fast: missing env makes every call useless.
  console.warn("EXPO_PUBLIC_BACKEND_URL is not configured");
}

export type Experiment = {
  id: string;
  batch: string;
  researcher: string;
  condition: string;
  hours: number;
  start_time: number;
  end_time: number;
  removed_at: number | null;
  email_notified_at?: number | null;
  notes?: string | null;
  photo_base64?: string | null;
  created_at: string;
};

export type Researcher = { id: string; name: string; created_at: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}/api${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  // CSV endpoint returns text
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    // @ts-expect-error generic narrowed below
    return (await res.text()) as T;
  }
  return (await res.json()) as T;
}

export const api = {
  listExperiments: () => request<Experiment[]>("/experiments"),
  getExperiment: (id: string) => request<Experiment>(`/experiments/${id}`),
  createExperiment: (body: {
    batch: string;
    researcher: string;
    condition: string;
    hours: number;
  }) =>
    request<Experiment>("/experiments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateExperiment: (
    id: string,
    body: { notes?: string; photo_base64?: string; removed_at?: number },
  ) =>
    request<Experiment>(`/experiments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  markRemoved: (id: string) =>
    request<Experiment>(`/experiments/${id}/remove`, { method: "POST" }),
  deleteExperiment: (id: string) =>
    request<{ deleted: boolean }>(`/experiments/${id}`, { method: "DELETE" }),
  exportCsv: () => request<string>("/experiments/export/csv"),

  listResearchers: () => request<Researcher[]>("/researchers"),
  createResearcher: (name: string) =>
    request<Researcher>("/researchers", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  deleteResearcher: (id: string) =>
    request<{ deleted: boolean }>(`/researchers/${id}`, { method: "DELETE" }),
};
