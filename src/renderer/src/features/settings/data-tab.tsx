import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  RETENTION_DAYS,
  formatBytes,
  type RecordingsStats,
  type TransferResult,
} from "@shared/types.js";
import { Row, Section, Select, Toggle } from "./parts.js";
import type { SettingsStore } from "./use-settings.js";

/**
 * Export and import as JSON (§9).
 *
 * The copy is explicit about the two things people are most likely to assume
 * wrongly: the API key is not in the file, and importing adds to what is
 * already here rather than replacing it.
 */
export function DataTab({ settings, save }: SettingsStore) {
  const [busy, setBusy] = useState<"export" | "import" | "rebuild" | null>(
    null,
  );
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (which: "export" | "import") => {
    setBusy(which);
    setNote(null);
    setProblem(null);
    try {
      const result: TransferResult =
        which === "export"
          ? await window.dictateflow.data.export()
          : await window.dictateflow.data.import();

      // Cancelling a file dialog is a normal thing to do, not an outcome that
      // needs reporting back.
      if (result.status === "cancelled") return;
      if (result.status === "error") {
        setProblem(result.problem);
        return;
      }

      // Transforms are only named when there are some. A fresh install has
      // exactly one seeded rule and reporting "1 transform" on every export
      // would be noise about something the user never touched.
      const parts = [
        count(result.dictations, "transcript"),
        count(result.dictionary, "dictionary word"),
        ...(result.transforms > 0 ? [count(result.transforms, "transform")] : []),
      ];
      const listed = parts.length > 1
        ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
        : parts[0];

      setNote(
        which === "export"
          ? `Saved ${listed}.`
          : `Added ${listed}${result.skipped > 0 ? `. Skipped ${result.skipped} already here` : ""}.`,
      );
    } catch {
      setProblem("That did not finish. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    setBusy("rebuild");
    setNote(null);
    setProblem(null);
    try {
      await window.dictateflow.insights.rebuild();
      setNote("Statistics recalculated from your history.");
    } catch {
      setProblem("Could not recalculate the statistics.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Backup"
        description="Plain JSON readable, and yours. Your Groq API key is never written to it. It stays encrypted by Windows."
      >
        <Row
          label="Export everything"
          hint="Transcripts, dictionary, transforms and settings, in one file. Never your API keys."
        >
          <Button
            variant="secondary"
            onClick={() => void run("export")}
            disabled={busy !== null}
          >
            <Download size={14} />
            {busy === "export" ? "Exporting…" : "Export"}
          </Button>
        </Row>

        <Row
          label="Import a backup"
          hint="Adds to what is already here. Anything already present is skipped, so importing the same file twice is safe."
        >
          <Button
            variant="secondary"
            onClick={() => void run("import")}
            disabled={busy !== null}
          >
            <Upload size={14} />
            {busy === "import" ? "Importing…" : "Import"}
          </Button>
        </Row>
      </Section>

      <Recordings settings={settings} save={save} />

      <Section title="Maintenance">
        <Row
          label="Recalculate statistics"
          hint="Rebuilds the daily totals behind Insights from your transcripts. Nothing is deleted."
        >
          <Button
            variant="secondary"
            onClick={() => void rebuild()}
            disabled={busy !== null}
          >
            <RefreshCw
              size={14}
              className={busy === "rebuild" ? "animate-spin" : undefined}
            />
            Recalculate
          </Button>
        </Row>
      </Section>

      {note && <p className="text-sm text-ink-muted">{note}</p>}
      {problem && (
        <p className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert size={14} className="shrink-0" />
          {problem}
        </p>
      )}
    </div>
  );
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
}

const retentionLabel = (days: number): string =>
  days === 0 ? "Keep everything" : `Delete after ${days} days`;

/**
 * Recordings on disk (§8).
 *
 * The size is shown rather than left to be discovered: at roughly 1.9MB per
 * spoken minute this grows quietly, and a user meeting it for the first time
 * in Explorer is a user who has already lost trust in the app's housekeeping.
 */
function Recordings({
  settings,
  save,
}: Pick<SettingsStore, "settings" | "save">) {
  const [stats, setStats] = useState<RecordingsStats | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(() => {
    void window.dictateflow.recordings
      .stats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  useEffect(refresh, [refresh]);

  // A confirmation left sitting on a destructive button is a trap.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  const clear = async () => {
    setClearing(true);
    try {
      setStats(await window.dictateflow.recordings.clear());
    } catch {
      refresh();
    } finally {
      setClearing(false);
      setConfirming(false);
    }
  };

  const keeping = settings?.keepRecordings !== "false";
  const empty = !stats || stats.files === 0;

  return (
    <Section
      title="Recordings"
      description="The audio behind each transcript, kept locally so you can hear what was actually said when a transcript looks wrong."
    >
      <Row
        label="Keep recordings"
        hint="Turning this off stops new recordings. It does not delete the ones you already have."
      >
        <Toggle
          checked={keeping}
          onChange={(next) => void save("keepRecordings", String(next))}
          label="Keep recordings"
        />
      </Row>

      <Row
        label="Automatic cleanup"
        hint="Applied when the app starts. Favorites are never deleted automatically favoriting is how you say keep this."
        htmlFor="retention"
      >
        <Select
          id="retention"
          value={settings?.recordingRetentionDays ?? "0"}
          disabled={!keeping}
          onChange={(next) => void save("recordingRetentionDays", next)}
        >
          {RETENTION_DAYS.map((days) => (
            <option key={days} value={String(days)}>
              {retentionLabel(days)}
            </option>
          ))}
        </Select>
      </Row>

      <Row
        label="Storage used"
        hint={
          empty
            ? "Nothing stored yet."
            : `${count(stats.files, "recording")}. Transcripts are kept only the audio is removed.`
        }
      >
        {confirming ? (
          <div className="flex items-center gap-1">
            <Button
              variant="danger"
              onClick={() => void clear()}
              disabled={clearing}
            >
              {clearing ? "Deleting…" : "Delete all"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm tabular-nums text-ink">
              {formatBytes(stats?.bytes ?? 0)}
            </span>
            <Button
              variant="secondary"
              onClick={() => setConfirming(true)}
              disabled={empty}
            >
              Delete all
            </Button>
          </div>
        )}
      </Row>
    </Section>
  );
}
