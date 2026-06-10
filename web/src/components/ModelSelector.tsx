/**
 * Model selector: lets the user pick which small language model to run, showing
 * each model's size, estimated memory use, popularity and whether it fits the
 * current device. The recommended (most popular model that fits) is highlighted
 * and selected by default.
 */

import type { EvaluatedModel } from '../models/registry';
import type { DeviceCapabilities, FitLevel } from '../models/device';
import { formatBytes, formatCount } from '../models/device';

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
  if (caps.hasWebGpu) parts.push('WebGPU');
  parts.push(`budget ~${formatBytes(caps.memoryBudgetBytes)}`);

  return (
    <p className="device-summary" data-testid="device-summary">
      Your device: {parts.join(' · ')}
    </p>
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
  return (
    <div className="model-selector" data-testid="model-selector">
      <div className="model-selector-header">
        <h2>Choose a model</h2>
        {caps && <DeviceSummary caps={caps} />}
      </div>

      <ul className="model-list">
        {models.map(({ entry, fit, downloadBytes, recommended }) => {
          const selected = entry.id === selectedId;
          const loaded = entry.id === loadedId;
          const disabled = busy || fit.level === 'too-large';
          return (
            <li key={entry.id}>
              <button
                type="button"
                className={`model-card fit-${fit.level}${
                  selected ? ' selected' : ''
                }`}
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
                      <span className="badge badge-recommended">
                        Recommended
                      </span>
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
                  <span title="Download size">
                    ⬇ {formatBytes(downloadBytes)}
                  </span>
                  <span title="Estimated memory while running">
                    🧠 ~{formatBytes(fit.runtimeBytes)}
                  </span>
                  <span title="HuggingFace downloads (last 30 days)">
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
        })}
      </ul>
    </div>
  );
}
