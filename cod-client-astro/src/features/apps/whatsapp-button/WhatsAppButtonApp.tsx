import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  CircleCheck,
  Image as ImageIcon,
  Loader2,
  Phone,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Field,
  InfoTip,
  Input,
  StickyFormActions,
  SwitchField,
  Textarea,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { IMAGE_ACCEPT, uploadFailure } from "@/features/uploads/api";
import { useImageUpload } from "@/features/uploads/useImageUpload";
import { getWhatsAppButtonApp, saveWhatsAppButtonApp } from "@/features/apps/whatsapp-button/api";
import type { AppBodyProps } from "@/features/apps/types";
import { TranslationsCard } from "@/features/translations/components/TranslationsCard";
import { getPhonePreview, isDirty, toDraft, toPayload, validateDraft } from "@/features/apps/whatsapp-button/model";
import type {
  SaveBlocker,
  WhatsAppWidgetCapabilities,
  WhatsAppWidgetDraft,
  WhatsAppWidgetResponse,
  WhatsAppWidgetSurfaces,
} from "@/features/apps/whatsapp-button/types";

/** The WhatsApp button App: the number, what its chat panel shows, and where the button appears. */
export default function WhatsAppButtonApp({ canManage, onSaved }: AppBodyProps) {
  const t = useT("whatsapp");
  const common = useT("common");

  const [saved, setSaved] = useState<Pick<WhatsAppWidgetResponse, "config" | "avatarUrl"> | null>(null);
  const [capabilities, setCapabilities] = useState<WhatsAppWidgetCapabilities | null>(null);
  const [draft, setDraft] = useState<WhatsAppWidgetDraft | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  /** Bumped on every save, so the translations below read the texts just saved. */
  const [revision, setRevision] = useState(0);

  // Avatar upload
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { upload: uploadAvatar, progress: uploadProgress } = useImageUpload("products");

  async function load() {
    setLoadError(null);
    try {
      const { config, avatarUrl, capabilities: caps } = await getWhatsAppButtonApp();
      setSaved({ config, avatarUrl });
      setCapabilities(caps);
      setDraft(toDraft(config, avatarUrl));
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("load_failed")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  }

  if (!draft || !saved || !capabilities) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-60 items-center justify-center">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  const max = (key: keyof WhatsAppWidgetCapabilities["textFields"]) => capabilities.textFields[key].max;
  const blockers: SaveBlocker[] = validateDraft(draft, capabilities);
  const dirty = isDirty(draft, saved.config);
  const phonePreview = getPhonePreview(draft.phone);

  function patch(next: Partial<WhatsAppWidgetDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function patchSurface(surfaceKey: keyof WhatsAppWidgetSurfaces, value: boolean) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        surfaces: {
          ...current.surfaces,
          [surfaceKey]: value,
        },
      };
    });
  }

  function insertToken(field: "prefillGeneral" | "prefillProduct" | "prefillThankYou", token: string) {
    setDraft((current) => {
      if (!current) return current;
      const currentVal = current[field];
      const nextVal = currentVal ? `${currentVal} {${token}}` : `{${token}}`;
      return {
        ...current,
        [field]: nextVal,
      };
    });
  }

  async function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadAvatar(file);
      patch({ avatar: { key: uploaded.key, url: uploaded.url } });
    } catch (cause) {
      notify.error(common(`feedback.${uploadFailure(cause)}`));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!draft || blockers.length > 0) return;
    setSaving(true);
    try {
      const { config, avatarUrl, capabilities: caps } = await saveWhatsAppButtonApp(toPayload(draft) as unknown as Record<string, unknown>);
      setSaved({ config, avatarUrl });
      setCapabilities(caps);
      setDraft(toDraft(config, avatarUrl));
      setRevision((current) => current + 1);
      notify.success(t("saved_toast"));
      onSaved();
    } catch (cause: any) {
      notify.error(cause?.message || t("save_failed"));
    } finally {
      setSaving(false);
    }
  }

  const allSurfacesOff = Object.values(draft.surfaces).every((on) => !on);

  const surfaceKeys: Array<{ key: keyof WhatsAppWidgetSurfaces; label: string; hint: string }> = [
    { key: "home", label: t("surface_home"), hint: t("surface_home_hint") },
    { key: "catalog", label: t("surface_catalog"), hint: t("surface_catalog_hint") },
    { key: "product", label: t("surface_product"), hint: t("surface_product_hint") },
    { key: "pages", label: t("surface_pages"), hint: t("surface_pages_hint") },
    { key: "thankYou", label: t("surface_thank_you"), hint: t("surface_thank_you_hint") },
    { key: "checkout", label: t("surface_checkout"), hint: t("surface_checkout_hint") },
    { key: "landing", label: t("surface_landing"), hint: t("surface_landing_hint") },
  ];

  return (
    <div className="space-y-4">
      <Card title={t("connect_title")} help={t("connect_subtitle")}>
        <div className="space-y-4">
          <SwitchField
            label={t("enable_label")}
            help={t("enable_description")}
            checked={draft.enabled}
            onChange={(enabled) => patch({ enabled })}
            disabled={!canManage}
          />
          <Field
            label={t("phone_label")}
            help={t("phone_hint")}
            error={draft.phone && !phonePreview.isValid ? t("phone_invalid_reason") : undefined}
          >
            <div className="relative">
              <Input
                type="tel"
                dir="ltr"
                disabled={!canManage}
                value={draft.phone}
                onChange={(e) => patch({ phone: e.target.value })}
                placeholder={t("phone_placeholder")}
                className="font-mono"
              />
              <Phone size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            </div>
            {phonePreview.isValid && phonePreview.e164 && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-tone-success-text">
                <CircleCheck size={13} className="shrink-0" aria-hidden="true" />
                <span>{t("phone_valid", { number: phonePreview.e164 })}</span>
              </p>
            )}
          </Field>
        </div>
      </Card>

      <Card title={t("identity_title")} help={t("identity_subtitle")}>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {draft.avatar ? (
              <div className="size-12 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
                <img src={draft.avatar.url} alt="" className="size-full object-cover" />
              </div>
            ) : (
              <div className="grid size-12 shrink-0 place-items-center rounded-full border border-dashed border-border bg-muted text-muted-foreground">
                <ImageIcon size={18} aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {t("avatar_label")}
                <InfoTip>{t("avatar_hint")}</InfoTip>
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => void handleAvatarFileSelect(e)}
              />
              <div className="mt-1.5 flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!canManage || uploadProgress !== null}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadProgress !== null ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {t("avatar_upload")}
                </Button>
                {draft.avatar && (
                  <Button type="button" variant="ghost" size="sm" disabled={!canManage} onClick={() => patch({ avatar: null })}>
                    <Trash2 size={13} />
                    {t("avatar_remove")}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LimitField label={t("agent_name_label")} help={t("agent_name_help")} length={draft.agentName.length} max={max("agentName")}>
              <Input
                disabled={!canManage}
                value={draft.agentName}
                maxLength={max("agentName")}
                onChange={(e) => patch({ agentName: e.target.value })}
                placeholder={t("agent_name_placeholder")}
              />
            </LimitField>
            <LimitField label={t("caption_label")} help={t("caption_help")} length={draft.caption.length} max={max("caption")}>
              <Input
                disabled={!canManage}
                value={draft.caption}
                maxLength={max("caption")}
                onChange={(e) => patch({ caption: e.target.value })}
                placeholder={t("caption_placeholder")}
              />
            </LimitField>
          </div>
        </div>
      </Card>

      <Card title={t("message_title")} help={t("message_subtitle")}>
        <div className="space-y-4">
          <LimitField label={t("welcome_label")} help={t("welcome_hint")} length={draft.welcomeMessage.length} max={max("welcomeMessage")}>
            <Textarea
              rows={2}
              disabled={!canManage}
              value={draft.welcomeMessage}
              maxLength={max("welcomeMessage")}
              onChange={(e) => patch({ welcomeMessage: e.target.value })}
              placeholder={t("welcome_placeholder")}
            />
          </LimitField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LimitField label={t("launcher_label")} help={t("launcher_help")} length={draft.launcherLabel.length} max={max("launcherLabel")}>
              <Input
                disabled={!canManage}
                value={draft.launcherLabel}
                maxLength={max("launcherLabel")}
                onChange={(e) => patch({ launcherLabel: e.target.value })}
                placeholder={t("launcher_placeholder")}
              />
            </LimitField>
            <LimitField label={t("cta_label")} help={t("cta_help")} length={draft.ctaLabel.length} max={max("ctaLabel")}>
              <Input
                disabled={!canManage}
                value={draft.ctaLabel}
                maxLength={max("ctaLabel")}
                onChange={(e) => patch({ ctaLabel: e.target.value })}
                placeholder={t("cta_placeholder")}
              />
            </LimitField>
          </div>

          <LimitField label={t("prefill_general_label")} help={<TemplateHelp text={t("prefill_general_help")} />} length={draft.prefillGeneral.length} max={max("prefillGeneral")}>
            <Textarea
              rows={2}
              disabled={!canManage}
              value={draft.prefillGeneral}
              maxLength={max("prefillGeneral")}
              onChange={(e) => patch({ prefillGeneral: e.target.value })}
              placeholder={t("prefill_general_placeholder")}
            />
            <TokenChips tokens={capabilities.prefillTokens} label={t("tokens_hint")} disabled={!canManage} onInsert={(token) => insertToken("prefillGeneral", token)} />
          </LimitField>

          <LimitField label={t("prefill_product_label")} help={<TemplateHelp text={t("prefill_product_help")} />} length={draft.prefillProduct.length} max={max("prefillProduct")}>
            <Textarea
              rows={2}
              disabled={!canManage}
              value={draft.prefillProduct}
              maxLength={max("prefillProduct")}
              onChange={(e) => patch({ prefillProduct: e.target.value })}
              placeholder={t("prefill_product_placeholder")}
            />
            <TokenChips tokens={capabilities.prefillTokens} label={t("tokens_hint")} disabled={!canManage} onInsert={(token) => insertToken("prefillProduct", token)} />
          </LimitField>
        </div>
      </Card>

      <Card title={t("thank_you_page_title")} help={t("thank_you_page_subtitle")}>
        <div className="space-y-4">
          <LimitField label={t("thank_you_button_label")} length={draft.thankYouButtonLabel.length} max={max("thankYouButtonLabel")}>
            <Input
              disabled={!canManage}
              value={draft.thankYouButtonLabel}
              maxLength={max("thankYouButtonLabel")}
              onChange={(e) => patch({ thankYouButtonLabel: e.target.value })}
              placeholder={t("thank_you_button_placeholder")}
            />
          </LimitField>
          <LimitField label={t("prefill_thank_you_label")} help={<TemplateHelp text={t("prefill_thank_you_help")} />} length={draft.prefillThankYou.length} max={max("prefillThankYou")}>
            <Textarea
              rows={2}
              disabled={!canManage}
              value={draft.prefillThankYou}
              maxLength={max("prefillThankYou")}
              onChange={(e) => patch({ prefillThankYou: e.target.value })}
              placeholder={t("prefill_thank_you_placeholder")}
            />
            <TokenChips tokens={capabilities.prefillTokens} label={t("tokens_hint")} disabled={!canManage} onInsert={(token) => insertToken("prefillThankYou", token)} />
          </LimitField>
        </div>
      </Card>

      <TranslationsCard key={revision} resource="whatsappWidget" id="me" canEdit={canManage} subtitle={t("translations_subtitle")} />

      <Card title={t("surfaces_title")} help={t("surfaces_subtitle")}>
        <div className="space-y-3">
          {allSurfacesOff && (
            <Alert tone="warning">
              <p className="text-xs">{t("surfaces_all_off_warning")}</p>
            </Alert>
          )}
          <div className="divide-y divide-border">
            {surfaceKeys.map(({ key, label, hint }) => (
              <div key={key} className="py-2.5 first:pt-0 last:pb-0">
                <SwitchField label={label} help={hint} checked={draft.surfaces[key]} onChange={(on) => patchSurface(key, on)} disabled={!canManage} />
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card title={t("look_title")} help={t("look_subtitle")}>
        <div className="space-y-4">
          <ChoiceGroup
            label={t("accent_label")}
            value={draft.accent}
            disabled={!canManage}
            onChange={(accent) => patch({ accent })}
            options={[
              { value: "whatsapp", label: t("accent_whatsapp"), swatch: "bg-[#25D366]" },
              { value: "primary", label: t("accent_primary"), swatch: "bg-primary" },
            ]}
          />
          <ChoiceGroup
            label={t("position_label")}
            value={draft.position}
            disabled={!canManage}
            onChange={(position) => patch({ position })}
            options={[
              { value: "right", label: t("position_right") },
              { value: "left", label: t("position_left") },
            ]}
          />
          <SwitchField label={t("attention_label")} help={t("attention_hint")} checked={draft.attention} onChange={(attention) => patch({ attention })} disabled={!canManage} />
        </div>
      </Card>

      {canManage && (
        <StickyFormActions
          info={
            blockers.length > 0 ? (
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle size={14} className="mt-px shrink-0" />
                <ul className="space-y-0.5">
                  {blockers.map((b) => (
                    <li key={b.field}>{t(b.message as any)}</li>
                  ))}
                </ul>
              </div>
            ) : dirty ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-full bg-warning" />
                <span className="font-semibold text-foreground">{t("status_unsaved")}</span>
                <InfoTip>{t("cache_notice")}</InfoTip>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleCheck size={13} className="text-tone-success-text" />
                {t("status_saved")}
                <InfoTip>{t("cache_notice")}</InfoTip>
              </span>
            )
          }
        >
          {dirty && (
            <Button type="button" variant="secondary" onClick={() => setDraft(toDraft(saved.config, saved.avatarUrl))} disabled={saving}>
              {t("reset")}
            </Button>
          )}
          <Button type="button" onClick={() => void handleSave()} disabled={saving || !dirty || blockers.length > 0}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t("save")}
          </Button>
        </StickyFormActions>
      )}
    </div>
  );
}

/** A field whose counter only shows when the merchant nears the limit, so it does not crowd every label. */
function LimitField({
  label,
  help,
  length,
  max,
  children,
}: {
  label: string;
  help?: React.ReactNode;
  length: number;
  max: number;
  children: React.ReactNode;
}) {
  const near = length >= Math.floor(max * 0.8);
  return (
    <Field
      label={label}
      help={help}
      hint={near ? <span className={length >= max ? "font-medium text-destructive" : ""}>{length}/{max}</span> : undefined}
    >
      {children}
    </Field>
  );
}

function TemplateHelp({ text }: { text: string }) {
  const t = useT("whatsapp");
  return (
    <>
      <span className="block">{text}</span>
      <span className="mt-1.5 block">{t("tokens_help")}</span>
    </>
  );
}

function TokenChips({
  tokens,
  label,
  disabled,
  onInsert,
}: {
  tokens: string[] | undefined;
  label: string;
  disabled: boolean;
  onInsert: (token: string) => void;
}) {
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {(tokens && tokens.length > 0 ? tokens : ["product", "url", "order", "store"]).map((token) => (
        <button
          key={token}
          type="button"
          disabled={disabled}
          onClick={() => onInsert(token)}
          className="inline-flex h-6 items-center rounded-md bg-muted px-1.5 font-mono text-xs text-foreground transition-colors hover:bg-foreground/10 disabled:opacity-50 pointer-coarse:h-8 pointer-coarse:px-2"
        >
          {`{${token}}`}
        </button>
      ))}
    </span>
  );
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; swatch?: string }[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={id} className="space-y-1">
      <span id={id} className="block text-sm font-medium text-foreground select-none">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
                selected ? "bg-accent font-medium text-foreground ring-1 ring-foreground/40" : "text-muted-foreground shadow-card hover:text-foreground"
              }`}
            >
              {option.swatch && <span className={`size-3 shrink-0 rounded-full ${option.swatch}`} aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
