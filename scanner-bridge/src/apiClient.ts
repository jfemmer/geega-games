// Authenticated fetch against the deployed Geega app's staff-gated
// /api/admin/* endpoints — the exact same endpoints and bearer-token
// pattern the browser's adminFetch (src/admin/repositories/apiClient.ts)
// uses, just with a full base URL instead of a same-origin relative path.

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function createApiClient(baseUrl: string, getAccessToken: () => Promise<string>) {
  async function call<T>(
    path: string,
    init: { method: string; body?: unknown } = { method: "GET" },
  ): Promise<T> {
    const token = await getAccessToken();
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: init.body != null ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
      let message = `Request to ${path} failed (${res.status}).`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) message = body.message;
      } catch {
        /* ignore — use the generic message */
      }
      throw new ApiError(message, res.status);
    }
    return (await res.json()) as T;
  }

  return { call };
}

export type ApiClient = ReturnType<typeof createApiClient>;
