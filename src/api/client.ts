import type { Asset, AssetPage, AssetQuery, BulkResult } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  code: string;
  retryAfterMs: number | null;
  retryable: boolean;
  requestId: string | null;

  constructor(
    message: string,
    status: number,
    code: string,
    retryAfterMs: number | null,
    requestId: string | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.retryable = status === 429 || status === 503 || status >= 500;
    this.requestId = requestId;
  }
}

type InflightRecord<T> = {
  promise: Promise<T>;
  controller: AbortController;
  consumers: number;
};
const inflight = new Map<string, InflightRecord<unknown>>();

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status?.length) params.set("status", query.status.join(","));
  if (query.kind?.length) params.set("kind", query.kind.join(","));
  if (query.tag?.length) params.set("tag", query.tag.join(","));
  if (query.collectionId) params.set("collectionId", query.collectionId);
  if (query.owner) params.set("owner", query.owner);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

function retryDelay(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return retryAfterMs;
  const base = Math.min(8000, 400 * 2 ** attempt);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { signal?: AbortSignal; retries?: number } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  let attempt = 0;

  while (true) {
    if (options.signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    try {
      const res = await fetch(path, {
        ...init,
        signal: options.signal,
        headers: {
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        let code = "http_error";
        let message = res.statusText || "Request failed";
        try {
          const body = (await res.json()) as {
            error?: { code?: string; message?: string };
          };
          code = body.error?.code ?? code;
          message = body.error?.message ?? message;
        } catch {
          /* non-json response */
        }
        const retryHeader = res.headers.get("retry-after");
        const retryAfterMs = retryHeader
          ? Math.max(0, Number(retryHeader) * 1000)
          : null;
        throw new ApiError(
          message,
          res.status,
          code,
          Number.isFinite(retryAfterMs ?? NaN) ? retryAfterMs : null,
          res.headers.get("x-request-id"),
        );
      }
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(
              "Network connection failed. Check your connection and try again.",
              0,
              "network_error",
              null,
              null,
            );
      const canRetry = apiError.retryable || apiError.code === "network_error";
      if (!canRetry || attempt >= retries || options.signal?.aborted)
        throw apiError;
      await sleep(retryDelay(attempt, apiError.retryAfterMs), options.signal);
      attempt += 1;
    }
  }
}

function deduped<T>(
  key: string,
  factory: (signal: AbortSignal) => Promise<T>,
  consumerSignal?: AbortSignal,
): Promise<T> {
  let record = inflight.get(key) as InflightRecord<T> | undefined;
  if (!record) {
    const controller = new AbortController();
    let createdRecord: InflightRecord<T>;
    const promise = factory(controller.signal).finally(() => {
      if (inflight.get(key) === createdRecord) inflight.delete(key);
    });
    createdRecord = { promise, controller, consumers: 0 };
    record = createdRecord;
    inflight.set(key, record);
  }
  record.consumers += 1;
  if (!consumerSignal) return record.promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      record!.consumers -= 1;
      if (record!.consumers <= 0) {
        record!.controller.abort();
        if (inflight.get(key) === record) inflight.delete(key);
      }
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    if (consumerSignal.aborted) return abort();
    consumerSignal.addEventListener("abort", abort, { once: true });
    record!.promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        consumerSignal.removeEventListener("abort", abort);
        record!.consumers -= 1;
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        consumerSignal.removeEventListener("abort", abort);
        record!.consumers -= 1;
        reject(error);
      },
    );
  });
}

export function listAssets(
  query: AssetQuery,
  signal?: AbortSignal,
): Promise<AssetPage> {
  const key = `GET /api/assets?${toSearchParams(query)}`;
  return deduped(
    key,
    (sharedSignal) =>
      request<AssetPage>(
        `/api/assets?${toSearchParams(query)}`,
        {},
        { signal: sharedSignal },
      ),
    signal,
  );
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, {}, { signal });
}

export function getAssetsByIds(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ items: Asset[]; missing: string[] }> {
  return request(`/api/assets/batch?ids=${ids.join(",")}`, {}, { signal });
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, "name" | "status" | "tags">>,
  signal?: AbortSignal,
): Promise<Asset> {
  return request<Asset>(
    `/api/assets/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ version, patch }),
    },
    { signal },
  );
}

export function bulkSetStatus(
  ids: string[],
  status: Asset["status"],
  signal?: AbortSignal,
): Promise<BulkResult> {
  return request<BulkResult>(
    "/api/assets/bulk-status",
    {
      method: "POST",
      body: JSON.stringify({ ids, status }),
    },
    { signal },
  );
}

export const thumbnailUrl = (id: string) => `/api/thumb/${id}.svg`;
