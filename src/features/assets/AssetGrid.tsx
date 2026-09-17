import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { thumbnailUrl } from "@/api/client";
import { formatBytes, formatDate, statusLabel } from "@/lib/format";
import type { Asset } from "@/lib/types";

interface Props {
  assets: Asset[];
  selectedIds: Set<string>;
  activeId: string | null;
  focusedId: string | null;
  onToggleSelect: (id: string, extend?: boolean) => void;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
  onLoadMore: () => void;
}

const ROW_HEIGHT = 300;
const OVERSCAN = 3;

const AssetCard = memo(function AssetCard({
  asset,
  selected,
  active,
  tabIndex,
  onToggle,
  onOpen,
  onFocus,
  onMove,
}: {
  asset: Asset;
  selected: boolean;
  active: boolean;
  tabIndex: number;
  onToggle: (e: React.MouseEvent | React.ChangeEvent<HTMLInputElement>) => void;
  onOpen: () => void;
  onFocus: () => void;
  onMove: (key: string, shift: boolean) => void;
}) {
  const [broken, setBroken] = useState(!asset.hasThumbnail);
  return (
    <article
      className={`card${selected ? " card--selected" : ""}${active ? " card--active" : ""}`}
      role="gridcell"
      data-asset-id={asset.id}
      aria-selected={selected}
      tabIndex={tabIndex}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("input")) return;
        onOpen();
      }}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
        if (e.key === " ") {
          e.preventDefault();
          onToggle(e as unknown as React.MouseEvent);
        }
        if (
          ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)
        ) {
          e.preventDefault();
          onMove(e.key, e.shiftKey);
        }
      }}
    >
      <div className="card__media">
        {broken ? (
          <div className="thumb-placeholder" aria-hidden="true">
            <span>No preview</span>
          </div>
        ) : (
          <img
            className="card__thumb"
            src={thumbnailUrl(asset.id)}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        )}
        <label className="card__check-wrap">
          <input
            aria-label={`Select ${asset.name}`}
            type="checkbox"
            className="card__check"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggle}
          />
        </label>
        <span className={`pill pill--${asset.status}`}>
          <span aria-hidden="true" className="status-dot" />
          {statusLabel(asset.status)}
        </span>
      </div>
      <div className="card__body">
        <p className="card__name" title={asset.name}>
          {asset.name}
        </p>
        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} ·{" "}
          {formatDate(asset.updatedAt)}
        </p>
        <p className="card__tags">
          {asset.tags.slice(0, 2).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </p>
      </div>
    </article>
  );
});

export function AssetGrid({
  assets,
  selectedIds,
  activeId,
  focusedId,
  onToggleSelect,
  onOpen,
  onFocus,
  onLoadMore,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [width, setWidth] = useState(900);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      setScrollTop(el.scrollTop);
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 4)
        onLoadMore();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onLoadMore]);

  const columns = width >= 1200 ? 5 : width >= 900 ? 5 : width >= 600 ? 2 : 1;
  const rowCount = Math.ceil(assets.length / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleRows = Math.min(
    rowCount,
    Math.ceil((scrollerRef.current?.clientHeight ?? 700) / ROW_HEIGHT) +
      OVERSCAN * 2,
  );
  const endRow = Math.min(rowCount, startRow + visibleRows);
  const visible = useMemo(
    () => assets.slice(startRow * columns, endRow * columns),
    [assets, startRow, endRow, columns],
  );

  if (assets.length === 0)
    return (
      <div className="empty">
        <div className="empty-icon">⌕</div>
        <h2>No assets found</h2>
        <p className="muted">
          Try a different search or clear one of the filters.
        </p>
      </div>
    );

  return (
    <div className="grid-scroller" ref={scrollerRef}>
      <div
        className="grid-spacer"
        style={{ height: rowCount * ROW_HEIGHT }}
        role="grid"
        aria-rowcount={rowCount}
        aria-label="Media assets"
      >
        <div
          className="grid-window"
          style={{
            transform: `translateY(${startRow * ROW_HEIGHT}px)`,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {visible.map((asset, i) => {
            const index = startRow * columns + i;
            return (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={selectedIds.has(asset.id)}
                active={activeId === asset.id}
                tabIndex={
                  focusedId === asset.id || (!focusedId && index === 0) ? 0 : -1
                }
                onFocus={() => onFocus(asset.id)}
                onOpen={() => onOpen(asset.id)}
                onToggle={(e) =>
                  onToggleSelect(
                    asset.id,
                    "shiftKey" in e && Boolean(e.shiftKey),
                  )
                }
                onMove={(key, shift) => {
                  const direction =
                    key === "ArrowRight"
                      ? 1
                      : key === "ArrowLeft"
                        ? -1
                        : key === "ArrowDown"
                          ? columns
                          : -columns;
                  const next = Math.max(
                    0,
                    Math.min(assets.length - 1, index + direction),
                  );
                  const target = assets[next];
                  if (!target) return;
                  onFocus(target.id);
                  if (shift) onToggleSelect(target.id, true);
                  window.setTimeout(
                    () =>
                      document
                        .querySelector<HTMLElement>(
                          `[data-asset-id="${target.id}"]`,
                        )
                        ?.focus(),
                    0,
                  );
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
