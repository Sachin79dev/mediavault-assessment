import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listAssets, ApiError } from "@/api/client";
import type { Asset, AssetQuery } from "@/lib/types";

const DEBOUNCE_MS = 300;

interface State {
  items: Asset[];
  total: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
}

export function useAssets(query: AssetQuery) {
  const stableFilters = useMemo(
    () => ({
      status: query.status,
      kind: query.kind,
      tag: query.tag,
      collectionId: query.collectionId,
      owner: query.owner,
      sort: query.sort,
      limit: query.limit,
    }),
    [
      query.status,
      query.kind,
      query.tag,
      query.collectionId,
      query.owner,
      query.sort,
      query.limit,
    ],
  );
  const rawQ = query.q?.trim() ?? "";
  const [debouncedQ, setDebouncedQ] = useState(rawQ);
  const [state, setState] = useState<State>({
    items: [],
    total: 0,
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const requestKeyRef = useRef("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(rawQ), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [rawQ]);

  const effectiveQuery = useMemo(
    () => ({
      ...stableFilters,
      q: debouncedQ,
      limit: stableFilters.limit ?? 50,
    }),
    [stableFilters, debouncedQ],
  );

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestKey = JSON.stringify(effectiveQuery);
    requestKeyRef.current = requestKey;
    setState({
      items: [],
      total: 0,
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
    });

    listAssets(effectiveQuery, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || requestKeyRef.current !== requestKey)
          return;
        setState({
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestKeyRef.current !== requestKey)
          return;
        setState({
          items: [],
          total: 0,
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error:
            error instanceof ApiError
              ? error
              : new ApiError(
                  "Unable to load assets.",
                  0,
                  "unknown",
                  null,
                  null,
                ),
        });
      });

    return () => controller.abort();
  }, [effectiveQuery, refreshKey]);

  const loadMore = useCallback(() => {
    if (
      state.loading ||
      state.loadingMore ||
      !state.nextCursor ||
      state.items.length >= state.total
    )
      return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loadingMore: true, error: null }));
    listAssets(
      { ...effectiveQuery, cursor: state.nextCursor },
      controller.signal,
    )
      .then((page) => {
        if (requestKeyRef.current !== JSON.stringify(effectiveQuery)) return;
        setState((s) => ({
          ...s,
          items: [...s.items, ...page.items],
          total: page.total,
          nextCursor: page.nextCursor,
          loadingMore: false,
        }));
      })
      .catch((error: unknown) => {
        setState((s) => ({
          ...s,
          loadingMore: false,
          error:
            error instanceof ApiError
              ? error
              : new ApiError(
                  "Unable to load more assets.",
                  0,
                  "unknown",
                  null,
                  null,
                ),
        }));
      });
  }, [
    effectiveQuery,
    state.loading,
    state.loadingMore,
    state.nextCursor,
    state.items.length,
    state.total,
  ]);

  return {
    ...state,
    loadMore,
    refresh: () => setRefreshKey((v) => v + 1),
    debouncedQ,
  };
}
