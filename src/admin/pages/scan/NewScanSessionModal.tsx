import { useCallback, useRef, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { TextField, SelectField } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { scanRepository } from "../../repositories";
import { CURRENT_ADMIN } from "../../data/session.mock";
import type { ScanSession, ScanSourceType } from "../../types";
import type { UploadedScanFile } from "../../repositories/types";

// New scan session + batch import.
//
// The operator names the scanner, picks how the batch pairs (front-only, or
// front/back alternating as fi-8170 duplex emits), then drops a large number of
// files. Files are turned into UploadedScanFile records — the sequence hint
// preserves scanner order, and the side (front/back) drives pairing in the
// repository. Ingestion reports progress; one bad file never fails the batch.

type PairingMode = "front_only" | "front_back_pairs";

/** Derive a stable ordering key from a filename (numbers sort naturally). */
function orderKey(name: string): number {
  const m = name.match(/(\d+)/g);
  if (!m) return Number.MAX_SAFE_INTEGER;
  // Use the last number group — scanners usually suffix an incrementing index.
  return Number.parseInt(m[m.length - 1], 10);
}

/** Heuristic: does this filename look like a back scan? */
function looksLikeBack(name: string): boolean {
  return /(back|rear|_b\b|-b\b|\bb\.)/i.test(name);
}

export function NewScanSessionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (session: ScanSession) => void;
}) {
  const [scannerName, setScannerName] = useState("Ricoh fi-8170");
  const [sourceType, setSourceType] = useState<ScanSourceType>("scanner_export");
  const [pairing, setPairing] = useState<PairingMode>("front_only");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number; failed: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFiles([]);
    setProgress(null);
    setBusy(false);
    setPairing("front_only");
  }

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const imgs = Array.from(incoming).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|tiff?)$/i.test(f.name),
    );
    setFiles((prev) => [...prev, ...imgs]);
  }, []);

  /** Convert selected files into UploadedScanFile records with pairing hints. */
  function buildUploads(): UploadedScanFile[] {
    const sorted = [...files].sort((a, b) => orderKey(a.name) - orderKey(b.name));
    if (pairing === "front_only") {
      return sorted.map((f, i) => ({
        file: f,
        fileName: f.name,
        side: "front" as const,
        sequenceHint: i + 1,
      }));
    }
    // front_back_pairs: assign each file a side (by name heuristic, else
    // alternating) and a shared hint per pair so the repo merges them.
    const uploads: UploadedScanFile[] = [];
    let hint = 1;
    let expectingBack = false;
    for (const f of sorted) {
      const isBack = looksLikeBack(f.name) || (expectingBack && !looksLikeBack(f.name));
      if (isBack) {
        uploads.push({ file: f, fileName: f.name, side: "back", sequenceHint: hint });
        hint += 1;
        expectingBack = false;
      } else {
        uploads.push({ file: f, fileName: f.name, side: "front", sequenceHint: hint });
        expectingBack = true;
      }
    }
    return uploads;
  }

  async function handleStart() {
    setBusy(true);
    try {
      const session = await scanRepository.createSession({
        scannerName: scannerName.trim() || null,
        sourceType,
        createdBy: CURRENT_ADMIN.name,
      });

      if (files.length > 0) {
        const uploads = buildUploads();
        setProgress({ processed: 0, total: uploads.length, failed: 0 });
        await scanRepository.ingestBatch(session.id, uploads, (p) =>
          setProgress({ processed: p.processed, total: p.total, failed: p.failed }),
        );
        await scanRepository.updateSessionStatus(session.id, "reviewing");
      }

      const fresh = (await scanRepository.getSession(session.id)) ?? session;
      reset();
      onCreated(fresh);
    } finally {
      setBusy(false);
    }
  }

  const pct = progress && progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="New scan session"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleStart} loading={busy} icon="upload">
            {files.length > 0
              ? `Create & import ${files.length} file${files.length === 1 ? "" : "s"}`
              : "Create empty session"}
          </Button>
        </>
      }
    >
      <div className="gg-newscan">
        <div className="gg-form-grid">
          <TextField
            label="Scanner"
            value={scannerName}
            onChange={(e) => setScannerName(e.target.value)}
            hint="Recorded for the audit trail."
          />
          <SelectField
            label="Source"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as ScanSourceType)}
          >
            <option value="scanner_export">Scanner export</option>
            <option value="file_upload">File upload</option>
            <option value="folder_drop">Folder drop</option>
            <option value="scanner_bridge">Scanner bridge</option>
          </SelectField>
        </div>

        <SelectField
          label="Pairing"
          value={pairing}
          onChange={(e) => setPairing(e.target.value as PairingMode)}
          hint="How front/back scans map to cards. fi-8170 duplex emits front then back per card."
        >
          <option value="front_only">Front scans only (1 file = 1 card)</option>
          <option value="front_back_pairs">Front + back pairs (2 files = 1 card)</option>
        </SelectField>

        <div
          className={`gg-dropzone ${dragOver ? "gg-dropzone--over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <Icon name="upload" size={26} />
          <p className="gg-dropzone__title">Drag a batch here, or click to select</p>
          <p className="gg-dropzone__hint">
            Hundreds of files at once are fine. Scanner order is preserved.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && !progress && (
          <div className="gg-newscan__count">
            <Icon name="checkCircle" size={16} /> {files.length} file
            {files.length === 1 ? "" : "s"} ready
            <Button variant="ghost" size="sm" onClick={() => setFiles([])}>
              Clear
            </Button>
          </div>
        )}

        {progress && (
          <div className="gg-uploadprog" role="status" aria-live="polite">
            <div className="gg-uploadprog__bar">
              <div className="gg-uploadprog__fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="gg-uploadprog__text">
              {progress.processed} / {progress.total} processed
              {progress.failed > 0 && ` · ${progress.failed} failed`} · {pct}%
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
