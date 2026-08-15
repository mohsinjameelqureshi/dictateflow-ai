import { useEffect, useState } from "react";
import { Check, Download, HardDrive, TriangleAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  MOONSHINE_MODELS,
  formatBytes,
  type MoonshineModelSize,
  type MoonshineStatus,
} from "@shared/types.js";

/**
 * The local speech model: what it costs, whether it is here, and how to get it.
 *
 * The download is hundreds of megabytes, so this is a real piece of UI rather
 * than a spinner — progress, a running byte count, cancel, and resume. A
 * cancelled download keeps what it fetched and says so, because the alternative
 * is a user who thinks they have to start 292MB again.
 */
export function ModelCard({ size }: { size: MoonshineModelSize }) {
  const [status, setStatus] = useState<MoonshineStatus | null>(null);
  const [file, setFile] = useState<string>("");
  const spec = MOONSHINE_MODELS[size];

  useEffect(() => {
    let live = true;
    void window.dictateflow.moonshine
      .status(size)
      .then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [size]);

  // Filtered, like onProgress below: a download running against another size
  // still announces, and this card speaks for exactly one model.
  useEffect(
    () =>
      window.dictateflow.moonshine.onStatus((s) => {
        if (s.size === size) setStatus(s);
      }),
    [size],
  );

  useEffect(
    () =>
      window.dictateflow.moonshine.onProgress((p) => {
        if (p.size !== size) return;
        setFile(p.file);
        setStatus((s) =>
          s
            ? { ...s, state: "downloading", bytes: p.bytes, totalBytes: p.totalBytes }
            : s,
        );
      }),
    [size],
  );

  const state = status?.state ?? "absent";
  const downloading = state === "downloading";
  const have = status?.bytes ?? 0;
  const want = status?.totalBytes ?? spec.bytes;
  const percent = want > 0 ? Math.min(100, Math.round((have / want) * 100)) : 0;

  return (
    <section className="rounded-panel border border-line bg-panel p-5">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink">
            {spec.label} model, English
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {spec.hint} {spec.wer} word error rate.
          </p>
        </div>
        <span className="shrink-0 pt-0.5 text-[13px] text-ink-muted">
          {formatBytes(spec.bytes)}
        </span>
      </div>

      {/* ---------------------------------------------------------- ready -- */}
      {state === "ready" && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Check size={14} className="shrink-0 text-success" />
            Downloaded. Dictation works with no connection.
          </p>
          <Button
            variant="secondary"
            onClick={() => void window.dictateflow.moonshine.remove(size)}
          >
            Remove
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------- downloading -- */}
      {downloading && (
        <div className="mt-4">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Model download"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="truncate text-[13px] text-ink-muted">
              {percent}% · {formatBytes(have)} of {formatBytes(want)}
              {file && ` · ${file}`}
            </p>
            <Button
              variant="secondary"
              onClick={() => void window.dictateflow.moonshine.cancel()}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ absent / partial -- */}
      {(state === "absent" || state === "partial") && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            {state === "partial" ? (
              <>
                <HardDrive size={14} className="shrink-0" />
                {/* Saying this out loud is the difference between "resume" and
                    "start 292MB over", which is what a bare progress bar at 0%
                    would imply after a cancelled download. */}
                {formatBytes(have)} already downloaded. It will pick up from
                there.
              </>
            ) : (
              <>
                <WifiOff size={14} className="shrink-0" />
                One download, then it runs offline forever.
              </>
            )}
          </p>
          <Button onClick={() => void window.dictateflow.moonshine.download(size)}>
            <Download size={14} />
            {state === "partial" ? "Resume" : "Download"}
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------------- error -- */}
      {state === "error" && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 text-sm text-danger">
            <TriangleAlert size={14} className="shrink-0" />
            {status?.problem ?? "The download failed."}
          </p>
          <Button onClick={() => void window.dictateflow.moonshine.download(size)}>
            Try again
          </Button>
        </div>
      )}
    </section>
  );
}
