import { useEffect, useMemo, useRef, useState } from "react";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Icon } from "../components/ui/Icon";
import { Modal } from "../components/ui/Modal";
import { TextArea } from "../components/ui/Field";
import { Tabs } from "../components/ui/Nav";
import { TableSkeleton, ErrorState, EmptyState } from "../components/ui/States";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { useAsync } from "../hooks/useAsync";
import { useToast } from "../hooks/useToast";
import { photoRequestsRepository, type PhotoRequestFilter } from "../repositories/photoRequests.supabase";
import { formatDateTime, timeAgo } from "../utils/format";
import { CONDITION_LABELS } from "../utils/labels";
import type { CardCondition, PhotoRequest } from "../types";
import {
  PHOTO_REQUEST_MAX_PHOTOS,
  PHOTO_REQUEST_MAX_STAFF_MESSAGE,
  PHOTO_REQUEST_REPLY_HOURS,
  isPhotoRequestOverdue,
  photoRequestStatusLabel,
} from "../../store/lib/photoRequestTypes";

// Inventory → Photo requests. A shopper asked (from a card page) to see the
// actual copy of a listing. Staff pull the card — its storage location is
// shown — snap photos on a phone or upload them, and send: the shopper gets
// the photos as email attachments. Waiting requests are oldest-first, and
// anything past the 24-hour promise is flagged.

const FILTERS: { key: PhotoRequestFilter; label: string }[] = [
  { key: "open", label: "Waiting" },
  { key: "sent", label: "Sent" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

function printingLabel(r: PhotoRequest): string {
  return [
    r.setName ?? r.setCode?.toUpperCase(),
    r.collectorNumber ? `#${r.collectorNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function conditionLabel(c: string | null): string | null {
  if (!c) return null;
  return CONDITION_LABELS[c as CardCondition] ?? c;
}

function hoursLeft(createdAt: string): number {
  const due = new Date(createdAt).getTime() + PHOTO_REQUEST_REPLY_HOURS * 3_600_000;
  return Math.max(0, Math.round((due - Date.now()) / 3_600_000));
}

export function PhotoRequestsView({
  deepLinkId,
  onOpenCountChange,
}: {
  deepLinkId: string | null;
  onOpenCountChange: (count: number) => void;
}) {
  const [filter, setFilter] = useState<PhotoRequestFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkId);
  useEffect(() => {
    if (deepLinkId) setSelectedId(deepLinkId);
  }, [deepLinkId]);
  const requests = useAsync(() => photoRequestsRepository.list(filter), [filter]);
  const rows = useMemo(() => requests.data ?? [], [requests.data]);

  // A deep link to a request that isn't waiting anymore should still open it.
  const [deepLinked, setDeepLinked] = useState<PhotoRequest | null>(null);
  useEffect(() => {
    if (!deepLinkId || rows.some((r) => r.id === deepLinkId) || requests.loading) return;
    photoRequestsRepository
      .list("all")
      .then((all) => setDeepLinked(all.find((r) => r.id === deepLinkId) ?? null))
      .catch(() => undefined);
  }, [deepLinkId, rows, requests.loading]);

  useEffect(() => {
    photoRequestsRepository.openCount().then(onOpenCountChange).catch(() => undefined);
  }, [requests.data, onOpenCountChange]);

  const selected = selectedId
    ? (rows.find((r) => r.id === selectedId) ?? (deepLinked?.id === selectedId ? deepLinked : null))
    : null;

  function reload() {
    requests.reload();
  }

  return (
    <>
      <SectionCard title="">
        <div className="gg-photoreq-head">
          <Tabs
            items={FILTERS.map((f) => ({ key: f.key, label: f.label }))}
            active={filter}
            onChange={(k) => setFilter(k as PhotoRequestFilter)}
            ariaLabel="Photo request status"
          />
          <p className="gg-photoreq-promise">
            <Icon name="clock" size={14} /> Shoppers are promised a photo within {PHOTO_REQUEST_REPLY_HOURS} hours.
          </p>
        </div>

        {requests.loading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : requests.error ? (
          <ErrorState message={requests.error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="camera"
            title={filter === "open" ? "No one is waiting on a photo" : "Nothing here"}
            message={
              filter === "open"
                ? "When a shopper taps “Request a photo” on a card page, it shows up here and in your notifications."
                : "Requests will appear here once they reach this status."
            }
          />
        ) : (
          <ul className="gg-photoreq-list">
            {rows.map((r) => {
              const overdue = r.status === "new" && isPhotoRequestOverdue(r.createdAt);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className={`gg-photoreq-row${overdue ? " gg-photoreq-row--overdue" : ""}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    {r.listing?.imageUrl ? (
                      <img className="gg-photoreq-thumb" src={r.listing.imageUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="gg-photoreq-thumb gg-photoreq-thumb--empty" aria-hidden="true">
                        <Icon name="camera" />
                      </span>
                    )}
                    <span className="gg-photoreq-main">
                      <span className="gg-photoreq-card">
                        {r.status === "new" && <span className="gg-newdot" aria-hidden="true" />}
                        {r.cardName}
                      </span>
                      <span className="gg-photoreq-meta">
                        {[printingLabel(r), conditionLabel(r.condition), r.finish !== "nonfoil" ? r.finish : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <span className="gg-photoreq-meta">
                        {r.firstName} · {timeAgo(r.createdAt)}
                        {r.listing?.storageLocation ? ` · 📍 ${r.listing.storageLocation}` : ""}
                      </span>
                    </span>
                    <span className="gg-photoreq-status">
                      {r.status === "new" ? (
                        overdue ? (
                          <Badge tone="danger" dot>
                            Overdue
                          </Badge>
                        ) : (
                          <Badge tone="warning" dot>
                            {hoursLeft(r.createdAt)}h left
                          </Badge>
                        )
                      ) : (
                        <Badge tone={r.status === "sent" ? "success" : "neutral"}>
                          {photoRequestStatusLabel(r.status)}
                        </Badge>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {selected && (
        <PhotoRequestModal
          request={selected}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            setDeepLinked(null);
            reload();
          }}
        />
      )}
    </>
  );
}

interface PendingPhoto {
  key: string;
  file: File;
  previewUrl: string;
}

function PhotoRequestModal({
  request,
  onClose,
  onChanged,
}: {
  request: PhotoRequest;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [sentUrls, setSentUrls] = useState<string[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  // Free previews when the modal closes.
  const photosRef = useRef<PendingPhoto[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  useEffect(() => {
    let active = true;
    photoRequestsRepository.photoUrls(request.photoPaths).then((urls) => {
      if (active) setSentUrls(urls);
    });
    return () => {
      active = false;
    };
  }, [request.photoPaths]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const images = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => {
      const room = PHOTO_REQUEST_MAX_PHOTOS - prev.length;
      if (images.length > room) toast.error(`You can send up to ${PHOTO_REQUEST_MAX_PHOTOS} photos at a time.`);
      return [
        ...prev,
        ...images.slice(0, Math.max(0, room)).map((file) => ({
          key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ];
    });
  }

  function removePhoto(key: string) {
    setPhotos((prev) => {
      const found = prev.find((p) => p.key === key);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function send() {
    if (photos.length === 0) return;
    setSending(true);
    try {
      setProgress(`Uploading 0 of ${photos.length}…`);
      const paths = await photoRequestsRepository.uploadPhotos(
        request.id,
        photos.map((p) => p.file),
        (done) => setProgress(`Uploading ${done} of ${photos.length}…`),
      );
      setProgress("Emailing the shopper…");
      await photoRequestsRepository.send(request.id, paths, message);
      toast.success(`Photo${photos.length === 1 ? "" : "s"} sent to ${request.firstName}.`);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the photos.");
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  async function setStatus(status: "closed" | "new") {
    setStatusBusy(true);
    try {
      await photoRequestsRepository.setStatus(request.id, status);
      toast.success(status === "closed" ? "Request closed." : "Request reopened.");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the request.");
    } finally {
      setStatusBusy(false);
      setConfirmClose(false);
    }
  }

  const overdue = request.status === "new" && isPhotoRequestOverdue(request.createdAt);
  const canSend = request.status !== "closed";

  return (
    <>
      <Modal
        open
        onClose={sending ? () => undefined : onClose}
        title={`Photo request · ${request.referenceNumber}`}
        variant="drawer"
        size="md"
        footer={
          <div className="gg-btn-row gg-photoreq-footer">
            {request.status === "closed" ? (
              <Button variant="secondary" loading={statusBusy} onClick={() => void setStatus("new")}>
                Reopen
              </Button>
            ) : (
              <Button variant="ghost" disabled={sending} onClick={() => setConfirmClose(true)}>
                Close without sending
              </Button>
            )}
            {canSend && (
              <Button
                variant="primary"
                icon="mail"
                loading={sending}
                disabled={photos.length === 0 || sending}
                onClick={() => void send()}
              >
                {request.status === "sent" ? "Send more photos" : `Send to ${request.firstName}`}
              </Button>
            )}
          </div>
        }
      >
        <div className="gg-photoreq-detail">
          <div className="gg-photoreq-cardhead">
            {request.listing?.imageUrl && (
              <img className="gg-photoreq-cardimg" src={request.listing.imageUrl} alt="" />
            )}
            <div>
              <h3>{request.cardName}</h3>
              <p className="gg-photoreq-meta">
                {[printingLabel(request), conditionLabel(request.condition), request.finish !== "nonfoil" ? request.finish : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {request.listing ? (
                <p className="gg-photoreq-location">
                  <Icon name="box" size={14} />{" "}
                  {request.listing.storageLocation ? (
                    <>
                      Pull from <strong>{request.listing.storageLocation}</strong>
                    </>
                  ) : (
                    "No storage location set"
                  )}{" "}
                  · {request.listing.quantity} in stock
                </p>
              ) : (
                <p className="gg-photoreq-location">This listing has been deleted.</p>
              )}
              {request.listing && request.listing.quantity === 0 && (
                <p className="gg-alert-inline">This card has sold out — you may want to close the request.</p>
              )}
            </div>
          </div>

          <dl className="gg-photoreq-facts">
            <div>
              <dt>From</dt>
              <dd>
                {request.firstName} · <a href={`mailto:${request.email}`}>{request.email}</a>
              </dd>
            </div>
            <div>
              <dt>Asked</dt>
              <dd>
                {formatDateTime(request.createdAt)}{" "}
                {request.status === "new" &&
                  (overdue ? (
                    <Badge tone="danger">Overdue</Badge>
                  ) : (
                    <Badge tone="warning">{hoursLeft(request.createdAt)}h left</Badge>
                  ))}
              </dd>
            </div>
            {request.note && (
              <div>
                <dt>Their note</dt>
                <dd>&ldquo;{request.note}&rdquo;</dd>
              </div>
            )}
            {request.sentAt && (
              <div>
                <dt>Sent</dt>
                <dd>
                  {formatDateTime(request.sentAt)}
                  {request.sendCount > 1 ? ` (${request.sendCount} emails)` : ""}
                </dd>
              </div>
            )}
          </dl>

          {sentUrls.length > 0 && (
            <div>
              <h4 className="gg-photoreq-subhead">Already sent</h4>
              <div className="gg-photoreq-grid">
                {sentUrls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                    <img src={url} alt="Photo sent to the shopper" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {canSend && (
            <div>
              <h4 className="gg-photoreq-subhead">
                {request.status === "sent" ? "Send more photos" : "Photos to send"}
              </h4>
              <p className="gg-photoreq-hint">
                Front and back, plus a close-up of any wear, under good light. Up to {PHOTO_REQUEST_MAX_PHOTOS}{" "}
                photos; they&rsquo;re resized automatically.
              </p>
              <div className="gg-photoreq-grid">
                {photos.map((p) => (
                  <div className="gg-photoreq-pending" key={p.key}>
                    <img src={p.previewUrl} alt="Photo to send" />
                    <button
                      type="button"
                      className="gg-photoreq-remove"
                      aria-label="Remove photo"
                      onClick={() => removePhoto(p.key)}
                      disabled={sending}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="gg-btn-row">
                <Button
                  variant="secondary"
                  icon="camera"
                  disabled={sending || photos.length >= PHOTO_REQUEST_MAX_PHOTOS}
                  onClick={() => cameraRef.current?.click()}
                >
                  Take photo
                </Button>
                <Button
                  variant="ghost"
                  icon="upload"
                  disabled={sending || photos.length >= PHOTO_REQUEST_MAX_PHOTOS}
                  onClick={() => libraryRef.current?.click()}
                >
                  Choose photos
                </Button>
              </div>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={libraryRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <TextArea
                label="Message to the shopper (optional)"
                placeholder="e.g. Light whitening on the back corners — otherwise clean."
                maxLength={PHOTO_REQUEST_MAX_STAFF_MESSAGE}
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={sending}
              />
              {progress && (
                <p className="gg-photoreq-hint" role="status">
                  {progress}
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmClose}
        title="Close without sending?"
        message={`${request.firstName} won't get a photo. Use this if the card sold or you've already replied another way.`}
        confirmLabel="Close request"
        onConfirm={() => void setStatus("closed")}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  );
}
