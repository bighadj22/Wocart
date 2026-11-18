import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useT } from "@/i18n/react";
import { Alert } from "./alert";
import { Button } from "./button";
import { LinkButton } from "./link-button";
import { PageHeader } from "./page-header";
import { StickyFormActions } from "./sticky-form-actions";

/**
 * Every create and edit screen: a header with the way back, the form's cards,
 * and one bar at the bottom — Cancel and Save — that stays in reach however
 * long the form is. `aside` adds a narrow second column for wide forms.
 */
export function FormPage({
  title,
  badges,
  backHref,
  error,
  onSave,
  saving = false,
  saveLabel,
  canSave = true,
  aside,
  actions,
  children,
}: {
  title: ReactNode;
  badges?: ReactNode;
  /** Where Back and Cancel go: the record, or the list it belongs to. */
  backHref: string;
  /** Why the last save failed. */
  error?: string | null;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  /** False while the form cannot be saved yet (nothing changed, or invalid). */
  canSave?: boolean;
  aside?: ReactNode;
  /** What the header carries beside the title: a preview, a copy link. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const common = useT("common");
  return (
    <div>
      <PageHeader
        title={title}
        badges={badges}
        backHref={backHref}
        backLabel={common("back")}
        actions={actions}
      />
      {error && (
        <Alert role="alert" tone="critical" className="mb-4">
          <span>{error}</span>
        </Alert>
      )}
      {aside ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">{children}</div>
          <aside className="space-y-4">{aside}</aside>
        </div>
      ) : (
        <div className="space-y-4">{children}</div>
      )}
      <StickyFormActions className="mt-4">
        <LinkButton href={backHref} variant="secondary">
          {common("cancel")}
        </LinkButton>
        <Button type="button" onClick={onSave} disabled={saving || !canSave}>
          {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {saving ? common("saving") : (saveLabel ?? common("save"))}
        </Button>
      </StickyFormActions>
    </div>
  );
}
