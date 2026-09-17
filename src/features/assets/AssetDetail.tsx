import { useEffect, useRef, useState } from "react";
import { ApiError, getAsset, thumbnailUrl, updateAsset } from "@/api/client";
import {
  formatBytes,
  formatDate,
  formatDuration,
  statusLabel,
} from "@/lib/format";
import type { Asset, AssetStatus } from "@/lib/types";

const STATUSES: AssetStatus[] = ["draft", "in_review", "approved", "archived"];

interface Props {
  id: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}

export function AssetDetail({ id, onClose, onSaved }: Props) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setAsset(null);
    setError(null);
    getAsset(id, controller.signal)
      .then(setAsset)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof ApiError
              ? e
              : new ApiError(
                  "Unable to load this asset.",
                  0,
                  "unknown",
                  null,
                  null,
                ),
          );
      });
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    panelRef.current?.focus();
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function setStatus(status: AssetStatus) {
    if (!asset) return;
    const previous = asset;
    setSaving(true);
    setError(null);
    setAsset({ ...asset, status });
    try {
      const updated = await updateAsset(asset.id, asset.version, { status });
      setAsset(updated);
      onSaved(updated);
    } catch (e: unknown) {
      const apiError =
        e instanceof ApiError
          ? e
          : new ApiError("Save failed.", 0, "unknown", null, null);
      if (apiError.code === "version_conflict") {
        setError(
          new ApiError(
            "This asset changed elsewhere. We kept your edit from overwriting newer data. Reload the latest version and try again.",
            409,
            apiError.code,
            null,
            apiError.requestId,
          ),
        );
        getAsset(asset.id)
          .then((latest) => setAsset(latest))
          .catch(() => undefined);
      } else {
        setAsset(previous);
        setError(apiError);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      className="panel"
      ref={panelRef}
      tabIndex={-1}
      aria-label="Asset details"
    >
      <div className="panel__head">
        <div>
          <p className="eyebrow">MediaVault</p>
          <h2>Asset detail</h2>
        </div>
        <button ref={closeRef} onClick={onClose}>
          Close
        </button>
      </div>
      {error && (
        <div className="state state--error" role="alert">
          <strong>
            {error.code === "version_conflict"
              ? "Asset changed"
              : "Could not save"}
          </strong>
          <span>{error.message}</span>
          {error.code === "version_conflict" && (
            <button
              onClick={() =>
                getAsset(id)
                  .then(setAsset)
                  .catch((e: unknown) =>
                    setError(e instanceof ApiError ? e : null),
                  )
              }
            >
              Reload latest
            </button>
          )}
        </div>
      )}
      {!asset && !error && (
        <div className="state">
          <span className="spinner" />
          Loading asset…
        </div>
      )}
      {asset && (
        <div className="panel__body">
          {asset.hasThumbnail ? (
            <img
              className="panel__thumb"
              src={thumbnailUrl(asset.id)}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="panel__thumb thumb-placeholder">
              <span>No preview available</span>
            </div>
          )}
          <p className="eyebrow">{asset.kind}</p>
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>ID</dt>
            <dd>{asset.id}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>
          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          <div className="section-heading">
            <span>Status</span>
            <span className="muted">
              {saving ? "Saving…" : "Changes save immediately"}
            </span>
          </div>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={saving || status === asset.status}
                onClick={() => setStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
