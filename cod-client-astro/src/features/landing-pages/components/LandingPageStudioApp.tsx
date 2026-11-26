import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Eye,
  Settings2,
  UploadCloud,
  X,
} from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialogProvider,
  Field,
  IconButton,
  Input,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  deleteLandingPageImage,
  getLandingPage,
  getLandingPageTracking,
  publishLandingPage,
  reorderLandingPageImages,
  saveLandingPageImage,
  unpublishLandingPage,
  updateLandingPage,
} from "@/features/landing-pages/api";
import {
  landingPageErrorMessage,
  landingPagePublicUrl,
  trackingView,
} from "@/features/landing-pages/model";
import { metaSwitches } from "@/features/apps/meta/api";
import { LandingPageTrackingDialog } from "@/features/landing-pages/components/LandingPageTrackingDialog";
import {
  TrackingBadge,
  inactiveReason,
} from "@/features/landing-pages/components/TrackingBadge";
import type { TrackingView } from "@/features/landing-pages/model";
import { useConversionEventLabel } from "@/components/tracking/ConversionEventPicker";
import { partitionUploadFiles, IMAGE_ACCEPT, uploadFailure } from "@/features/uploads/api";
import { useImageUpload } from "@/features/uploads/useImageUpload";
import type {
  LandingPage,
  LandingPageImage,
  LandingPageTracking,
  LandingPageTrackingActivity,
} from "@/features/landing-pages/types";
import type { StoreTrackingSwitches } from "../../../../../cod-shared/queries/tracking-config";

const AUTOSAVE_DELAY_MS = 800;
const SLUG_PATTERN = /^[a-z0-9-]{3,60}$/;

function swapAt<T>(arr: T[], i: number, j: number): T[] {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

type Pane = "edit" | "preview";

const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop() {
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setDesktop(query.matches);
    query.addEventListener("change", sync);
    sync();
    return () => query.removeEventListener("change", sync);
  }, []);
  return desktop;
}

/** On a phone the two panes are two screens; this bar, in thumb's reach, moves between them. */
function StudioTabBar({ pane, onChange }: { pane: Pane; onChange: (pane: Pane) => void }) {
  const t = useT("landing-pages");
  const items: { key: Pane; label: string; Icon: typeof Eye }[] = [
    { key: "edit", label: t("studio.tab_edit"), Icon: Pencil },
    { key: "preview", label: t("studio.tab_preview"), Icon: Eye },
  ];
  return (
    <nav
      aria-label={t("studio.tabs_label")}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map(({ key, label, Icon }) => {
        const active = pane === key;
        return (
          <button
            key={key}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onChange(key)}
            className={`flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${active ? "text-foreground" : "text-muted-foreground"}`}
          >
            <Icon size={20} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function SaveIndicator({ state, label }: { state: SaveState; label: string }) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {state === "saving" ? (
        <Loader2 size={13} className="animate-spin" />
      ) : state === "saved" ? (
        <Check size={13} className="text-[var(--success)]" />
      ) : state === "error" ? (
        <AlertCircle size={13} className="text-destructive" />
      ) : null}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

/**
 * The Studio's own chrome — deliberately NOT the dashboard layout.
 *
 * An editor surface owns the whole viewport: a compact studio bar (back,
 * identity, autosave, publish, link actions, slug editing) over a two-pane
 * work area, each pane scrolling independently. No main sidebar, no dashboard
 * topbar — the merchant is "inside" the page they're building. Authentication
 * and scope gating stay identical to every dashboard surface.
 */
function StudioShell({
  title,
  saveState,
  saveLabel,
  toolbar,
  pane,
  onPaneChange,
  children,
}: {
  title: string;
  saveState: SaveState;
  saveLabel: string;
  toolbar?: React.ReactNode;
  pane?: Pane;
  onPaneChange?: (pane: Pane) => void;
  children: React.ReactNode;
}) {
  const t = useT("landing-pages");
  return (
    <ConfirmDialogProvider>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-4">
          <a
            href="/landing-pages"
            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={t("page_title")}
          >
            <ArrowRight size={16} className="rtl:rotate-180" />
            <span className="hidden text-xs font-semibold lg:inline">{t("page_title")}</span>
          </a>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>
          <div className="flex-1" />
          {toolbar}
          <SaveIndicator state={saveState} label={saveLabel} />
        </header>
        <div className={`min-h-0 flex-1 overflow-y-auto lg:overflow-hidden ${pane ? "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0" : ""}`}>
          <div className="grid grid-cols-1 lg:h-full lg:grid-cols-[320px_minmax(0,1fr)]">
            {children}
          </div>
        </div>
        {pane && onPaneChange && <StudioTabBar pane={pane} onChange={onPaneChange} />}
      </div>
    </ConfirmDialogProvider>
  );
}

/**
 * Where this page's conversions go. A summary plus an Edit button rather
 * than a form: a pixel id, a credential and a four-option conversion picker
 * belong in a dialog, not beside the image stack.
 */
function TrackingSection({
  view,
  perPageAvailable,
  hasOwnPixel,
  lastEvent,
  canManage,
  canSeeMeta,
  onEdit,
}: {
  view: TrackingView;
  perPageAvailable: boolean;
  hasOwnPixel: boolean;
  lastEvent: LandingPageTrackingActivity | null;
  canManage: boolean;
  canSeeMeta: boolean;
  onEdit: () => void;
}) {
  const t = useT("landing-pages");
  const conversionEventLabel = useConversionEventLabel();

  return (
    <section className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("tracking.card_title")}</h2>
        <TrackingBadge view={view} />
      </div>

      {view.kind === "store" ? (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>{perPageAvailable ? t("tracking.card_store_hint") : t("tracking.inactive_master_switch")}</p>
          {!perPageAvailable && canSeeMeta && (
            <a
              href="/apps/meta"
              className="inline-flex items-center gap-1 font-semibold text-link underline-offset-4 hover:underline"
            >
              {t("tracking.open_meta_app")}
              <ArrowRight size={12} aria-hidden="true" className="rtl:rotate-180" />
            </a>
          )}
        </div>
      ) : (
        <>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t("tracking.card_pixel")}</dt>
              <dd className="truncate font-medium tabular-nums" dir="ltr">
                {view.pixelId}
              </dd>
            </div>
            {view.kind === "own" && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">{t("tracking.card_event")}</dt>
                <dd className="truncate font-semibold">{conversionEventLabel(view.conversionEvent)}</dd>
              </div>
            )}
          </dl>
          {view.kind === "inactive" && (
            <p className="mt-2 text-xs leading-relaxed text-tone-warning-text">
              {inactiveReason(view.reason, t)}
            </p>
          )}
        </>
      )}

      {/* Proof, not just configuration: a merchant who has just pointed a
          campaign at a new pixel wants to see an event land. A failure
          carries Meta's own message — a silent "nothing yet" when the
          token was rejected leaves them waiting instead of fixing it. */}
      {lastEvent && (
        <p
          className={`mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-xs leading-relaxed ${
            lastEvent.status === "failed" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {lastEvent.status === "failed"
            ? `${t("tracking.last_event_failed")} — ${lastEvent.error ?? ""}`
            : t("tracking.last_event_sent")}
          <span className="block tabular-nums opacity-80" dir="ltr">
            {lastEvent.eventName} · {new Date(lastEvent.sentAt).toLocaleString()}
            {lastEvent.pixelId ? ` · ••••${lastEvent.pixelId.slice(-4)}` : ""}
          </span>
        </p>
      )}

      {canManage && perPageAvailable && (
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onEdit}>
          <Settings2 size={13} aria-hidden="true" />
          {hasOwnPixel ? t("tracking.card_edit") : t("tracking.card_add")}
        </Button>
      )}
    </section>
  );
}

function Gated({ landingPageId }: { landingPageId: string }) {
  const t = useT("landing-pages");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();

  // ── ALL hooks, before any early return (hooks-order discipline) ──────────
  const [lp, setLp] = useState<LandingPage | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { upload, progress: uploadProgress } = useImageUpload("landing");
  const uploading = uploadProgress !== null;
  const [publishing, setPublishing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [name, setName] = useState("");

  // Slug editing: committed value (autosaved) + in-flight draft while editing
  const [slugDraft, setSlugDraft] = useState<string | null>(null);
  const [slugSaving, setSlugSaving] = useState(false);
  const slugInputRef = useRef<HTMLInputElement>(null);

  const [tracking, setTracking] = useState<LandingPageTracking | null>(null);
  const [lastEvent, setLastEvent] = useState<LandingPageTrackingActivity | null>(null);
  const [storeSwitches, setStoreSwitches] = useState<StoreTrackingSwitches | null>(null);
  const [trackingOpen, setTrackingOpen] = useState(false);

  const [publishOpen, setPublishOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("edit");
  const isDesktop = useIsDesktop();
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);

  const trackingState = trackingView(storeSwitches, tracking);
  // Editing is only offered once the store has asked for per-page pixels —
  // otherwise the merchant would configure something the server ignores.
  const perPageAvailable = storeSwitches?.enabled === true && storeSwitches.perPageTrackingEnabled;

  const canManage = canScope(identity, SCOPES.LANDING_PAGES_MANAGE);
  const canRead = canScope(identity, SCOPES.LANDING_PAGES_READ);
  const canSeeMeta = canScope(identity, SCOPES.META_READ);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await getLandingPage(landingPageId);
      setLp(data);
      setName(data.name);
      setSlugDraft(null);
      setSaveState("idle");
    } catch (cause) {
      setLoadError(cause);
    }
  }, [landingPageId]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load, identity?.role, identity?.scopes.join(",")]);

  // The page's own pixel, and the store switches that decide whether it is in
  // force. Both are needed to tell the merchant the truth rather than just
  // what they typed. Tracking is never load-bearing for the Studio itself, so
  // a failure here leaves the card absent instead of breaking the editor.
  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    void (async () => {
      try {
        const [page, switches] = await Promise.all([
          getLandingPageTracking(landingPageId),
          metaSwitches(canSeeMeta),
        ]);
        if (!alive) return;
        setTracking(page.config);
        setLastEvent(page.lastEvent);
        setStoreSwitches(switches);
      } catch {
        // Non-critical — the Studio must still open.
      }
    })();
    return () => {
      alive = false;
    };
  }, [canRead, canSeeMeta, landingPageId]);

  // Debounced autosave: the name persists 800ms after the last edit.
  useEffect(() => {
    if (!lp || !canManage) return;
    if (name.trim() === "" || name === lp.name) return;

    setSaveState("saving");
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const updated = await updateLandingPage(landingPageId, { name: name.trim() });
          setLp(updated.data);
          setSaveState("saved");
        } catch (cause) {
          setSaveState("error");
          notify.error(landingPageErrorMessage(cause, t));
        }
      })();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [lp, name, canManage, landingPageId, t]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      if (!canManage) return;
      const { accepted, unsupportedCount, tooLargeCount } = partitionUploadFiles(Array.from(files));
      if (unsupportedCount > 0) notify.error(common("feedback.unsupported_file"));
      if (tooLargeCount > 0) notify.error(common("feedback.file_too_large"));
      if (!accepted.length) return;

      try {
        for (const file of accepted) {
          const image = await upload(file).catch((cause: unknown) => {
            const message = common(`feedback.${uploadFailure(cause)}`);
            setActionError(message);
            notify.error(message);
            return null;
          });
          if (!image) return;
          const images = await saveLandingPageImage(landingPageId, { mediaKey: image.key });
          setLp((prev) => (prev ? { ...prev, images } : prev));
        }
        notify.success(common("feedback.uploaded"));
      } catch (cause) {
        setActionError(landingPageErrorMessage(cause, t));
        notify.error(landingPageErrorMessage(cause, t));
      }
    },
    [canManage, landingPageId, common, t, upload],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      void handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const onMove = useCallback(
    async (image: LandingPageImage, direction: -1 | 1) => {
      const images = lp?.images ?? [];
      const index = images.findIndex((img) => img.id === image.id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= images.length) return;
      const nextIds = swapAt(images, index, target).map((img) => img.id);
      try {
        const nextImages = await reorderLandingPageImages(landingPageId, nextIds);
        setLp((prev) => (prev ? { ...prev, images: nextImages } : prev));
      } catch (cause) {
        setActionError(landingPageErrorMessage(cause, t));
        notify.error(landingPageErrorMessage(cause, t));
      }
    },
    [lp, landingPageId, t],
  );

  const onRemove = useCallback(
    async (image: LandingPageImage) => {
      try {
        await deleteLandingPageImage(landingPageId, image.id);
        setLp((prev) =>
          prev ? { ...prev, images: prev.images.filter((img) => img.id !== image.id) } : prev,
        );
        notify.success(common("feedback.deleted"));
      } catch (cause) {
        setActionError(landingPageErrorMessage(cause, t));
        notify.error(landingPageErrorMessage(cause, t));
      }
    },
    [landingPageId, common, t],
  );

  const onTogglePublish = useCallback(async () => {
    if (!lp) return;
    setPublishing(true);
    setPublishOpen(false);
    try {
      const res =
        lp.status === "published"
          ? await unpublishLandingPage(landingPageId)
          : await publishLandingPage(landingPageId);
      setLp(res.data);
      notify.success(common("feedback.updated"));
    } catch (cause) {
      setActionError(landingPageErrorMessage(cause, t));
      notify.error(landingPageErrorMessage(cause, t));
    } finally {
      setPublishing(false);
    }
  }, [lp, landingPageId, common, t]);

  const onCopyLink = useCallback(() => {
    if (!lp) return;
    const url = landingPagePublicUrl(lp);
    void navigator.clipboard?.writeText(url).then(
      () => notify.success(t("list.link_copied")),
      () => notify.error(t("error_generic")),
    );
  }, [lp, t]);

  const startSlugEdit = useCallback(() => {
    if (!lp || !canManage) return;
    setSlugDraft(lp.slug);
    // Focus after the input mounts
    requestAnimationFrame(() => slugInputRef.current?.select());
  }, [lp, canManage]);

  const applySlug = useCallback(async () => {
    if (!lp || slugDraft === null) return;
    const next = slugDraft.trim();
    if (!SLUG_PATTERN.test(next)) {
      notify.error(t("studio.slug_invalid"));
      return;
    }
    if (next === lp.slug) {
      setSlugDraft(null);
      return;
    }
    setSlugSaving(true);
    try {
      const updated = await updateLandingPage(landingPageId, { slug: next });
      setLp(updated.data);
      setSlugDraft(null);
      notify.success(t("studio.saved"));
    } catch (cause) {
      notify.error(landingPageErrorMessage(cause, t));
    } finally {
      setSlugSaving(false);
    }
  }, [lp, slugDraft, landingPageId, t]);

  // ── Early returns AFTER every hook ────────────────────────────────────────
  const saveLabel =
    saveState === "saving"
      ? t("studio.saving")
      : saveState === "error"
        ? t("error_generic")
        : t("studio.saved");

  if (!canRead)
    return (
      <StudioShell title={t("studio.title")} saveState={saveState} saveLabel={saveLabel}>
        <div className="col-span-full p-6">
          <Alert role="alert" tone="critical">{auth("no_access")}</Alert>
        </div>
      </StudioShell>
    );

  if (loadError)
    return (
      <StudioShell title={t("studio.title")} saveState={saveState} saveLabel={saveLabel}>
        <div className="col-span-full p-6">
          <Alert role="alert" tone="critical">
            <div className="flex-1">
              <p className="font-semibold">{t("error_generic")}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 text-xs font-semibold underline underline-offset-4"
              >
                {common("retry")}
              </button>
            </div>
          </Alert>
        </div>
      </StudioShell>
    );

  if (lp === null)
    return (
      <StudioShell title={t("studio.title")} saveState={saveState} saveLabel={saveLabel}>
        <div className="col-span-full flex items-center justify-center py-24" role="status" aria-busy="true">
          <Loader2 size={22} className="animate-spin text-muted-foreground" />
        </div>
      </StudioShell>
    );

  // ── Render ─────────────────────────────────────────────────────────────────
  const isPublished = lp.status === "published";
  const publicUrl = landingPagePublicUrl(lp);
  const editingSlug = slugDraft !== null;

  const slugControl = (
      <div className={`flex items-center ${isDesktop ? "" : "w-full"}`} dir="ltr">
        {editingSlug ? (
          <>
            <span className="hidden font-mono text-xs text-muted-foreground sm:inline">/lp/</span>
            <input
              ref={slugInputRef}
              type="text"
              value={slugDraft}
              onChange={(event) => setSlugDraft(event.currentTarget.value.toLowerCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") void applySlug();
                if (event.key === "Escape") setSlugDraft(null);
              }}
              aria-label={t("studio.slug_label")}
              className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-8 lg:w-44 lg:flex-none lg:px-2 lg:text-xs"
              spellCheck={false}
              autoComplete="off"
              maxLength={60}
            />
            <button
              type="button"
              onClick={() => void applySlug()}
              disabled={slugSaving}
              className="ms-1 flex h-11 w-11 items-center justify-center gap-1 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 lg:h-8 lg:w-auto lg:px-2"
              title={t("studio.slug_apply")}
            >
              {slugSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
            </button>
            <button
              type="button"
              onClick={() => setSlugDraft(null)}
              className="ms-0.5 flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted lg:h-8 lg:w-8"
              title={common("cancel")}
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={startSlugEdit}
            disabled={!canManage}
            className="flex h-11 min-w-0 flex-1 items-center justify-between gap-1.5 rounded-lg border border-border bg-background px-3 font-mono text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground disabled:opacity-50 lg:h-8 lg:flex-none lg:justify-start lg:px-2 lg:text-xs"
            title={t("studio.slug_edit")}
          >
            <span className="max-w-40 truncate">/lp/{lp.slug}</span>
            {canManage && <Pencil size={12} className="shrink-0 opacity-70" />}
          </button>
        )}
      </div>
  );

  const linkActions = (labels: boolean) =>
    isPublished && (
        <>
          <button
            type="button"
            onClick={() => onCopyLink()}
            className={`flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-xs font-semibold transition-colors hover:bg-muted ${labels ? "h-11 flex-1 text-sm" : "h-8 px-2.5"}`}
            title={publicUrl}
          >
            <Copy size={14} />
            <span className={labels ? "" : "hidden md:inline"}>{t("list.copy_link")}</span>
          </button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-xs font-semibold transition-colors hover:bg-muted ${labels ? "h-11 flex-1 text-sm" : "h-8 px-2.5"}`}
            title={t("list.view")}
          >
            <ExternalLink size={14} />
            <span className={labels ? "" : "hidden md:inline"}>{t("list.view")}</span>
          </a>
        </>
    );

  const publishControl = (
      canManage && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setPublishOpen((open) => !open)}
            disabled={publishing}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {publishing ? <Loader2 size={13} className="animate-spin" /> : null}
            {isPublished ? t("status_published") : t("actions.publish")}
            <ChevronDown size={13} className={publishOpen ? "rotate-180 transition-transform" : "transition-transform"} />
          </button>
          {publishOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-label={common("cancel")}
                onClick={() => setPublishOpen(false)}
              />
              <div className="absolute end-0 top-9 z-20 w-52 rounded-xl border border-border bg-popover p-1.5 shadow-lg">
                <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {isPublished ? t("status_published") : t("status_draft")}
                </p>
                <button
                  type="button"
                  onClick={() => void onTogglePublish()}
                  disabled={publishing}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold hover:bg-muted"
                >
                  {isPublished ? <ChevronDown size={14} /> : <Check size={14} />}
                  {isPublished ? t("actions.unpublish") : t("actions.publish")}
                </button>
              </div>
            </>
          )}
        </div>
      )
  );

  const toolbar = isDesktop ? (
    <>
      {slugControl}
      {linkActions(false)}
      {publishControl}
    </>
  ) : (
    publishControl
  );

  return (
    <StudioShell title={lp.name} saveState={saveState} saveLabel={saveLabel} toolbar={toolbar} pane={pane} onPaneChange={setPane}>
      {actionError && (
        <div className="col-span-full px-4 pt-3">
          <Alert role="alert" tone="critical">
            <span className="flex-1">{actionError}</span>
          </Alert>
        </div>
      )}

      {/* LEFT — identity, tracking, upload & stack */}
      <aside className={`${pane === "edit" ? "flex" : "hidden"} flex-col divide-y divide-border bg-card lg:flex lg:min-h-0 lg:overflow-y-auto lg:border-e lg:border-border`}>
        <section className="space-y-3 p-4">
          <Field label={t("studio.name_label")}>
            <Input
              type="text"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              disabled={!canManage}
            />
          </Field>
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone={isPublished ? "success" : "warning"}>
              {isPublished ? t("status_published") : t("status_draft")}
            </Badge>
            {lp.product?.name && (
              <span className="truncate text-xs text-muted-foreground">{lp.product.name}</span>
            )}
          </div>
        </section>

        {!isDesktop && (
          <section className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t("studio.link_title")}</h2>
            {slugControl}
            {isPublished && <div className="flex gap-2">{linkActions(true)}</div>}
          </section>
        )}

        <TrackingSection
          view={trackingState}
          perPageAvailable={perPageAvailable}
          hasOwnPixel={tracking !== null}
          lastEvent={lastEvent}
          canManage={canManage}
          canSeeMeta={canSeeMeta}
          onEdit={() => setTrackingOpen(true)}
        />

        <section className="p-4">
          <h2 className="text-sm font-semibold">{t("studio.left_title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("studio.left_hint")}</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!canManage || uploading}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className="mt-3 flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-5 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                {t("studio.uploading")}
              </>
            ) : (
              <>
                <UploadCloud size={20} />
                {t("studio.upload")}
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.target.value = "";
            }}
          />

          <div className="mt-4 space-y-2 pb-2">
            {lp.images.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {t("studio.no_images")}
              </p>
            )}
            {lp.images.map((image, index) => (
              <div
                key={image.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-background p-2"
              >
                <span className="w-5 shrink-0 text-center text-[0.7rem] font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <img
                  src={image.url}
                  alt={image.altText ?? ""}
                  loading="lazy"
                  className="h-12 w-12 shrink-0 rounded object-cover"
                />
                <div className="flex-1" />
                {canManage && (
                  <div className="flex flex-col gap-0.5">
                    <IconButton
                      type="button"
                      aria-label={common("move_up")}
                      title={common("move_up")}
                      onClick={() => void onMove(image, -1)}
                      disabled={index === 0}
                      className="size-6 pointer-coarse:size-10"
                    >
                      <ChevronUp size={13} />
                    </IconButton>
                    <IconButton
                      type="button"
                      aria-label={common("move_down")}
                      title={common("move_down")}
                      onClick={() => void onMove(image, 1)}
                      disabled={index === lp.images.length - 1}
                      className="size-6 pointer-coarse:size-10"
                    >
                      <ChevronDown size={13} />
                    </IconButton>
                  </div>
                )}
                {canManage && (
                  <IconButton
                    type="button"
                    aria-label={t("studio.remove")}
                    title={t("studio.remove")}
                    onClick={() => void onRemove(image)}
                    className="size-7 text-destructive pointer-coarse:size-10"
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        </section>
      </aside>

      {/* CENTER — live preview of the page a shopper lands on.
          Fluid rather than pinned to one phone width: on a wide monitor the
          old 390px frame left most of this pane empty while the merchant was
          trying to judge a creative, and on a laptop it overflowed. It now
          fills the pane up to a comfortable reading width and shrinks below
          that, so the frame is wider where there is room and still fits where
          there is not. The cap keeps it honest — a landing page is a
          mobile-first surface, and a preview stretched to desktop width would
          flatter creatives that will never be seen that way. */}
      <section className={`${pane === "preview" ? "flex" : "hidden"} items-start justify-center bg-muted/40 sm:p-6 lg:flex lg:min-h-0 lg:overflow-y-auto`}>
        <div className="w-full overflow-hidden bg-background sm:max-w-[30rem] sm:rounded-[2rem] sm:border-8 sm:border-foreground/10 sm:shadow-lg">
          <div className="hidden h-6 items-center justify-center border-b border-border/40 sm:flex">
            <span className="h-1.5 w-16 rounded-full bg-foreground/15" />
          </div>
          {lp.images.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
              {t("studio.no_images")}
            </div>
          ) : (
            lp.images.map((image, index) => (
              <img
                key={image.id}
                src={image.url}
                alt={image.altText ?? ""}
                loading={index === 0 ? "eager" : "lazy"}
                className="block w-full"
                style={index === 0 ? undefined : { marginTop: `${lp.imageGap}px` }}
              />
            ))
          )}
          {/* Form stand-in — the real form renders on the storefront page */}
          <div className="m-4 rounded-xl border border-border bg-muted/30 p-5 text-center">
            <span className="block text-xs font-semibold text-muted-foreground">
              {lp.product?.name ?? ""}
            </span>
            <span className="mt-2 block h-10 rounded-lg bg-brand/10 text-[0.7rem] leading-10 font-semibold text-brand">
              {t("studio.preview_title")} — COD
            </span>
          </div>
        </div>
      </section>

      <LandingPageTrackingDialog
        landingPageId={landingPageId}
        existing={tracking}
        open={trackingOpen}
        onClose={() => setTrackingOpen(false)}
        onSaved={setTracking}
      />
    </StudioShell>
  );
}

export default function LandingPageStudioApp({ landingPageId }: { landingPageId: string }) {
  return (
    <RequireAuth>
      <Gated landingPageId={landingPageId} />
    </RequireAuth>
  );
}
