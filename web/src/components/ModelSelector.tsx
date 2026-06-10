/**
 * Model selector: lets the user pick which small language model to run, showing
 * each model's size, chosen quantization, estimated memory use, popularity and
 * whether it fits the current device.
 *
 * By default it lists **only the models that actually fit this device** (the
 * most popular fitting one is recommended and selected by default). Models that
 * don't fit are hidden behind a "show models that don't fit" toggle; when
 * revealed they are shown disabled, each with the reason it can't run here.
 */

import { useMemo, useState } from 'react';
import type { EvaluatedModel } from '../models/registry';
import type { DeviceCapabilities, FitLevel } from '../models/device';
import { formatBytes, formatCount, fitsDevice } from '../models/device';
import { DTYPE_LABEL } from '../models/catalog';

interface ModelSelectorProps {
  models: EvaluatedModel[];
  caps: DeviceCapabilities | null;
  selectedId: string | null;
  /** Currently loaded model id (if any), to show a "loaded" badge. */
  loadedId: string | null;
  /** Disable interaction while a model is loading. */
  busy: boolean;
  onSelect: (id: string) => void;
}

const FIT_LABEL: Record<FitLevel, string> = {
  fits: 'Fits',
  tight: 'Tight',
  'too-large': 'Too large',
};

function DeviceSummary({ caps }: { caps: DeviceCapabilities }) {
  const parts: string[] = [];
  parts.push(
    caps.deviceMemoryGb != null
      ? `~${caps.deviceMemoryGb} GB RAM`
      : 'RAM: unknown'
  );
  if (caps.cpuCores != null) parts.push(`${caps.cpuCores} cores`);
  parts.push(caps.isMobile ? 'mobile' : 'desktop');
  // Report real acceleration: a usable adapter (not just the API surface).
  if (caps.webGpuAdapter) {
    parts.push('WebGPU ✓');
  } else if (caps.hasWebGpu) {
    parts.push('WebGPU (no adapter)');
  } else {
    parts.push('CPU/WASM');
  }
  const budget = caps.webGpuAdapter ? caps.gpuBudgetBytes : caps.memoryBudgetBytes;
  parts.push(`budget ~${formatBytes(budget)}`);

  return (
    <p className="device-summary" data-testid="device-summary">
      Your device: {parts.join(' · ')}
    </p>
  );
}

function ModelCard({
  model,
  selectedId,
  loadedId,
  busy,
  onSelect,
}: {
  model: EvaluatedModel;
  selectedId: string | null;
  loadedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const { entry, fit, dtype, downloadBytes, recommended } = model;
  const selected = entry.id === selectedId;
  const loaded = entry.id === loadedId;
  const disabled = busy || fit.level === 'too-large';
  const accel = fit.usesWebGpu ? 'WebGPU' : 'CPU';
  return (
    <li>
      <button
        type="button"
        className={`model-card fit-${fit.level}${selected ? ' selected' : ''}`}
        onClick={() => onSelect(entry.id)}
        disabled={disabled}
        aria-pressed={selected}
        data-testid={`model-card-${entry.id}`}
        title={fit.reason}
      >
        <div className="model-card-top">
          <span className="model-name">{entry.name}</span>
          <span className="model-badges">
            {recommended && (
              <span className="badge badge-recommended">Recommended</span>
            )}
            {loaded && <span className="badge badge-loaded">Loaded</span>}
            <span className={`badge badge-fit fit-${fit.level}`}>
              {FIT_LABEL[fit.level]}
            </span>
          </span>
        </div>

        <p className="model-description">{entry.description}</p>

        <div className="model-meta">
          <span title="Parameter count">
            {formatCount(entry.parameters)} params
          </span>
          {dtype && (
            <span title="Quantization selected for your device">
              {DTYPE_LABEL[dtype]}
            </span>
          )}
          <span title="Download size for the selected quantization">
            ⬇ {formatBytes(downloadBytes)}
          </span>
          <span title="Estimated memory while running">
            🧠 ~{formatBytes(fit.runtimeBytes)}
          </span>
          <span
            title={
              fit.usesWebGpu
                ? 'Runs with WebGPU acceleration'
                : 'Runs on CPU (WASM)'
            }
          >
            {fit.usesWebGpu ? '⚡' : '🖥'} {accel}
          </span>
          <span title="HuggingFace downloads">
            ↧ {formatCount(entry.popularity.downloads)}
          </span>
          <span title="HuggingFace likes">
            ♥ {formatCount(entry.popularity.likes)}
          </span>
        </div>

        <p className="model-fit-reason">{fit.reason}</p>
      </button>
    </li>
  );
}

export function ModelSelector({
  models,
  caps,
  selectedId,
  loadedId,
  busy,
  onSelect,
}: ModelSelectorProps) {
  const [showHidden, setShowHidden] = useState(false);

  // Split into models that fit this device (shown by default) and those that
  // don't (hidden behind a toggle). The selected/loaded model is always kept
  // visible so a model picked from the revealed list never disappears.
  const { fitting, hidden } = useMemo(() => {
    const fitting: EvaluatedModel[] = [];
    const hidden: EvaluatedModel[] = [];
    for (const m of models) {
      const keepVisible =
        fitsDevice(m.fit) ||
        m.entry.id === selectedId ||
        m.entry.id === loadedId;
      (keepVisible ? fitting : hidden).push(m);
    }
    return { fitting, hidden };
  }, [models, selectedId, loadedId]);

  return (
    <div className="model-selector" data-testid="model-selector">
      <div className="model-selector-header">
        <h2>Choose a model</h2>
        {caps && <DeviceSummary caps={caps} />}
      </div>

      {fitting.length > 0 ? (
        <ul className="model-list" data-testid="model-list-fitting">
          {fitting.map((m) => (
            <ModelCard
              key={m.entry.id}
              model={m}
              selectedId={selectedId}
              loadedId={loadedId}
              busy={busy}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : (
        <p className="model-empty" data-testid="model-empty">
          No models fit this device comfortably yet — the catalog is still
          loading, or your device is very constrained. You can still reveal and
          try the models below.
        </p>
      )}

      {hidden.length > 0 && (
        <div className="model-hidden-section">
          <button
            type="button"
            className="model-toggle-hidden"
            data-testid="toggle-hidden-models"
            aria-expanded={showHidden}
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? '▾ Hide' : '▸ Show'} {hidden.length}{' '}
            {hidden.length === 1 ? 'model' : 'models'} that don’t fit this device
          </button>

          {showHidden && (
            <>
              <p className="model-hidden-note" data-testid="model-hidden-note">
                These models are hidden because they don’t fit your device. Each
                card shows the reason — typically it needs more memory than this
                device can safely provide, or there isn’t enough free storage to
                cache the download.
              </p>
              <ul className="model-list model-list-hidden" data-testid="model-list-hidden">
                {hidden.map((m) => (
                  <ModelCard
                    key={m.entry.id}
                    model={m}
                    selectedId={selectedId}
                    loadedId={loadedId}
                    busy={busy}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
