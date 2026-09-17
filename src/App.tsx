import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, bulkSetStatus } from "@/api/client";
import { AssetDetail } from "@/features/assets/AssetDetail";
import { AssetGrid } from "@/features/assets/AssetGrid";
import { useAssets } from "@/features/assets/useAssets";
import { statusLabel } from "@/lib/format";
import type { Asset, AssetKind, AssetQuery, AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];
const KINDS: AssetKind[] = ["image", "video", "document"];
const SORTS: Array<{ value: NonNullable<AssetQuery["sort"]>; label: string }> =
  [
    { value: "updatedAt:desc", label: "Recently updated" },
    { value: "name:asc", label: "Name A–Z" },
    { value: "sizeBytes:desc", label: "Largest first" },
    { value: "createdAt:desc", label: "Newest" },
  ];

function readUrl(): {
  q: string;
  status: AssetStatus[];
  kind: AssetKind[];
  sort: NonNullable<AssetQuery["sort"]>;
  tag: string;
} {
  const p = new URLSearchParams(window.location.search);
  const status =
    p
      .get("status")
      ?.split(",")
      .filter((x): x is AssetStatus => STATUSES.includes(x as AssetStatus)) ??
    [];
  const kind =
    p
      .get("kind")
      ?.split(",")
      .filter((x): x is AssetKind => KINDS.includes(x as AssetKind)) ?? [];
  const sort = SORTS.some((x) => x.value === p.get("sort"))
    ? (p.get("sort") as NonNullable<AssetQuery["sort"]>)
    : "updatedAt:desc";
  return { q: p.get("q") ?? "", status, kind, sort, tag: p.get("tag") ?? "" };
}

function humanError(error: ApiError | null): string | null {
  if (!error) return null;
  if (error.code === "network_error")
    return "You appear to be offline. Reconnect and try again.";
  if (error.status === 429)
    return "Too many requests right now. We’ll wait briefly before trying again.";
  if (error.status === 503)
    return "The search service is temporarily unavailable. Retrying automatically.";
  return "We couldn’t load the asset library. Try again.";
}

export function App() {
  const initial = useMemo(readUrl, []);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState(initial.status);
  const [kind, setKind] = useState(initial.kind);
  const [sort, setSort] = useState(initial.sort);
  const [tagText, setTagText] = useState(initial.tag);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [failed, setFailed] = useState<
    Array<{ id: string; code: string; message?: string }>
  >([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [optimisticAssets, setOptimisticAssets] = useState<Map<string, Asset>>(
    new Map(),
  );
  const [bulkStatus, setBulkStatus] = useState<AssetStatus | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const tag = useMemo(
    () =>
      tagText
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    [tagText],
  );
  const query = useMemo(
    () => ({ q, status, kind, tag, sort, limit: 50 }),
    [q, status, kind, tag, sort],
  );
  const {
    items: serverItems,
    total,
    loading,
    loadingMore,
    error,
    loadMore,
    refresh,
  } = useAssets(query);
  const items = useMemo(
    () => serverItems.map((a) => optimisticAssets.get(a.id) ?? a),
    [serverItems, optimisticAssets],
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status.length) p.set("status", status.join(","));
    if (kind.length) p.set("kind", kind.join(","));
    if (tag.length) p.set("tag", tag.join(","));
    p.set("sort", sort);
    const next = `${window.location.pathname}?${p.toString()}`;
    window.history.replaceState(null, "", next);
  }, [q, status, kind, sort]);
  useEffect(() => {
    setSelectedIds(new Set());
    setFocusedId(null);
  }, [q, status, kind, sort, tagText]);
  useEffect(() => {
    if (!activeId && originRef.current) {
      originRef.current.focus();
      originRef.current = null;
    }
  }, [activeId]);

  const toggleSelect = useCallback(
    (id: string, extend = false) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (!extend) {
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        }
        const anchor = focusedId
          ? serverItems.findIndex((a) => a.id === focusedId)
          : -1;
        const target = serverItems.findIndex((a) => a.id === id);
        if (anchor >= 0 && target >= 0) {
          const [start, end] =
            anchor < target ? [anchor, target] : [target, anchor];
          for (let i = start; i <= end; i++) {
            const asset = serverItems[i];
            if (asset) next.add(asset.id);
          }
        } else next.add(id);
        return next;
      });
      setFocusedId(id);
    },
    [focusedId, serverItems],
  );

  async function runBulk(ids: string[], nextStatus: AssetStatus) {
    if (!ids.length || !online) return;
    setBulkBusy(true);
    setBulkStatus(nextStatus);
    setNotice(`Updating ${ids.length} assets…`);
    setFailed([]);
    const snapshots = new Map<string, Asset>();
    for (const id of ids) {
      const a = items.find((x) => x.id === id);
      if (a) {
        snapshots.set(id, a);
        setOptimisticAssets((m) =>
          new Map(m).set(id, { ...a, status: nextStatus }),
        );
      }
    }
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
    const results: Array<{
      id: string;
      ok: boolean;
      code?: string;
      message?: string;
    }> = [];
    let cursor = 0;
    async function worker() {
      while (cursor < chunks.length) {
        const chunk = chunks[cursor++];
        if (!chunk) break;
        try {
          const r = await bulkSetStatus(chunk, nextStatus);
          results.push(...r.results);
        } catch (e: unknown) {
          const err =
            e instanceof ApiError
              ? e
              : new ApiError(
                  "Bulk update failed.",
                  0,
                  "network_error",
                  null,
                  null,
                );
          results.push(
            ...chunk.map((id) => ({
              id,
              ok: false,
              code: err.code,
              message: err.message,
            })),
          );
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({
        id: r.id,
        code: r.code ?? "unknown",
        message: r.message,
      }));
    setOptimisticAssets((m) => {
      const next = new Map(m);
      for (const r of results) {
        if (r.ok) {
          next.delete(r.id);
        } else {
          const snap = snapshots.get(r.id);
          if (snap) next.set(r.id, snap);
        }
      }
      return next;
    });
    setFailed(failures);
    setSelectedIds(new Set());
    setBulkBusy(false);
    setNotice(
      failures.length
        ? `${ids.length - failures.length} updated. ${failures.length} could not be changed.`
        : `${ids.length} assets updated successfully.`,
    );
    refresh();
  }

  function open(id: string) {
    originRef.current = document.activeElement as HTMLElement | null;
    setActiveId(id);
  }
  function saveAsset(asset: Asset) {
    setOptimisticAssets((m) => {
      const next = new Map(m);
      next.set(asset.id, asset);
      return next;
    });
    refresh();
  }
  const selectedLoaded =
    selectedIds.size > 0 &&
    selectedIds.size === items.length &&
    items.length < total
      ? `All ${items.length} loaded assets selected`
      : `${selectedIds.size} selected`;
  const retryableFailed = failed.filter((f) => f.code !== "legal_hold");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <h1>MediaVault</h1>
            <span>Asset library</span>
          </div>
        </div>
        <div className="search-wrap">
          <span aria-hidden="true">⌕</span>
          <input
            className="search"
            type="search"
            aria-label="Search assets"
            placeholder="Search by name or tag…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          aria-label="Sort assets"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </header>
      {!online && (
        <div className="offline" role="status">
          <strong>You’re offline.</strong> Search and bulk actions are paused
          until the connection returns.
        </div>
      )}
      <div className="filters">
        <div className="filter-group">
          <span className="filter-label">Status</span>
          {STATUSES.map((s) => (
            <label key={s} className="filter-chip">
              <input
                type="checkbox"
                checked={status.includes(s)}
                onChange={(e) =>
                  setStatus((prev) =>
                    e.target.checked
                      ? [...prev, s]
                      : prev.filter((x) => x !== s),
                  )
                }
              />
              {statusLabel(s)}
            </label>
          ))}
        </div>
        <div className="filter-group">
          <label className="tag-filter">
            Tag{" "}
            <input
              aria-label="Filter by tags"
              placeholder="hero, raw…"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
            />
          </label>
        </div>
        <div className="filter-group">
          <span className="filter-label">Type</span>
          {KINDS.map((k) => (
            <label key={k} className="filter-chip">
              <input
                type="checkbox"
                checked={kind.includes(k)}
                onChange={(e) =>
                  setKind((prev) =>
                    e.target.checked
                      ? [...prev, k]
                      : prev.filter((x) => x !== k),
                  )
                }
              />
              {k}
            </label>
          ))}
        </div>
        <span className="result-count" aria-live="polite">
          {loading
            ? "Loading…"
            : `${items.length.toLocaleString()} loaded · ${total.toLocaleString()} total`}
        </span>
      </div>
      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <strong>{selectedLoaded}</strong>
          <button
            disabled={bulkBusy || !online}
            onClick={() =>
              runBulk(
                items.map((a) => a.id).filter((id) => selectedIds.has(id)),
                "approved",
              )
            }
          >
            Approve
          </button>
          <button
            disabled={bulkBusy || !online}
            onClick={() =>
              runBulk(
                items.map((a) => a.id).filter((id) => selectedIds.has(id)),
                "in_review",
              )
            }
          >
            In review
          </button>
          <button
            disabled={bulkBusy || !online}
            onClick={() =>
              runBulk(
                items.map((a) => a.id).filter((id) => selectedIds.has(id)),
                "archived",
              )
            }
          >
            Archive
          </button>
          <button
            className="button-ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
          <button
            className="button-ghost"
            onClick={() => setSelectedIds(new Set(items.map((a) => a.id)))}
          >
            Select loaded
          </button>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          {retryableFailed.length > 0 && (
            <button
              onClick={() =>
                runBulk(
                  retryableFailed.map((x) => x.id),
                  bulkStatus ?? "approved",
                )
              }
            >
              Retry retryable failures
            </button>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div className="failure-list" role="alert">
          <strong>Some changes were not applied.</strong>
          {failed.slice(0, 5).map((f) => (
            <span key={f.id}>
              {f.id}:{" "}
              {f.code === "legal_hold"
                ? "Protected by legal hold."
                : (f.message ?? "Temporary failure.")}
            </span>
          ))}
          {failed.length > 5 && <span>+ {failed.length - 5} more</span>}
        </div>
      )}
      {error && !loading && (
        <div className="state state--error" role="alert">
          <strong>{humanError(error)}</strong>
          <button onClick={refresh}>Try again</button>
        </div>
      )}
      <main className="content">
        <div className="grid-area">
          <AssetGrid
            assets={items}
            selectedIds={selectedIds}
            activeId={activeId}
            focusedId={focusedId}
            onToggleSelect={toggleSelect}
            onOpen={open}
            onFocus={setFocusedId}
            onLoadMore={loadMore}
          />
          {loadingMore && (
            <div className="load-more">
              <span className="spinner" />
              Loading more assets…
            </div>
          )}
        </div>
        {activeId && (
          <AssetDetail
            id={activeId}
            onClose={() => setActiveId(null)}
            onSaved={saveAsset}
          />
        )}
      </main>
      <div className="sr-only" aria-live="polite">
        {notice ?? ""}
      </div>
    </div>
  );
}
