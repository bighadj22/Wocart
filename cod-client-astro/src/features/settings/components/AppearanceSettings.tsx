import { useEffect, useState } from "react";
import { Check, Loader2, Palette, SlidersHorizontal, Type } from "lucide-react";
import { Alert, Badge, Field, Input, Select, SwitchField, Textarea } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { getAppearance, saveAppearance, type SaveAppearanceInput } from "@/features/settings/api";
import { SettingsSection, FieldRow } from "@/features/settings/components/SettingsSection";
import type { StoreAppearance } from "@/features/settings/types";
import {
  APPEARANCE_COLOR_ROLES,
  APPEARANCE_HEADER_HTML_MAX,
  APPEARANCE_TEXT_KEYS,
  APPEARANCE_TEXT_LIMITS,
  APPEARANCE_HEX,
  type AppearanceColorRole,
  type AppearanceColorScheme,
  type AppearanceTextKey,
} from "../../../../../cod-shared/stores/appearance";
import { STORE_LOCALE_INFO, type StoreLocale } from "../../../../../cod-shared/i18n/locales";

const COLOR_LABEL_KEYS: Record<AppearanceColorRole, string> = {
  background: "store.appearance_color_background",
  text: "store.appearance_color_text",
  heading: "store.appearance_color_heading",
  accent: "store.appearance_color_accent",
  button: "store.appearance_color_button",
  buttonText: "store.appearance_color_buttonText",
  border: "store.appearance_color_border",
};

const TEXT_FIELDS: { key: AppearanceTextKey; labelKey: string }[] = [
  { key: "heroTitle", labelKey: "store.appearance_text_heroTitle" },
  { key: "heroSubtitle", labelKey: "store.appearance_text_heroSubtitle" },
  { key: "heroCtaPrimary", labelKey: "store.appearance_text_heroCtaPrimary" },
  { key: "heroCtaSecondary", labelKey: "store.appearance_text_heroCtaSecondary" },
  { key: "bannerTag", labelKey: "store.appearance_text_bannerTag" },
  { key: "bannerTitle", labelKey: "store.appearance_text_bannerTitle" },
  { key: "bannerSub", labelKey: "store.appearance_text_bannerSub" },
];

const LOOKS = [
  { id: "scheme-1", labelKey: "store.appearance_look_original", swatch: "#ffffff" },
  { id: "scheme-6", labelKey: "store.appearance_look_olive", swatch: "#4b5b2c" },
  { id: "scheme-5", labelKey: "store.appearance_look_midnight", swatch: "#0f1626" },
] as const;

/** A scheme's name is a plain string, or the same name in several languages. */
function schemeName(name: AppearanceColorScheme["name"], locale: string): string {
  if (typeof name === "string") return name;
  return name[locale] ?? Object.values(name)[0] ?? "";
}

function cloneSchemes(schemes: AppearanceColorScheme[]): AppearanceColorScheme[] {
  return JSON.parse(JSON.stringify(schemes)) as AppearanceColorScheme[];
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  function commit(raw: string) {
    const next = raw.trim().toLowerCase();
    setText(raw);
    if (APPEARANCE_HEX.test(next)) onChange(next);
  }

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value.toLowerCase())}
        aria-label={label}
        className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-card p-0.5"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
      <Input
        value={text}
        onChange={(event) => commit(event.target.value)}
        onBlur={() => setText(value)}
        aria-label={`${label} hex`}
        spellCheck={false}
        maxLength={7}
        className="h-7 w-24 shrink-0 px-2 font-mono text-xs uppercase"
      />
    </div>
  );
}

function AppearancePreview({
  scheme,
  title,
  subtitle,
  cta,
}: {
  scheme: AppearanceColorScheme | undefined;
  title: string;
  subtitle: string;
  cta: string;
}) {
  const t = useT("settings");
  if (!scheme) return null;
  const colors = scheme.colors;

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-foreground">{t("store.appearance_preview")}</span>
      <div
        className="rounded-xl border p-4"
        style={{ background: colors.background, borderColor: colors.border, color: colors.text }}
      >
        <p className="text-base font-bold leading-snug" style={{ color: colors.heading }}>
          {title}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: colors.text }}>
          {subtitle}
        </p>
        <p className="mt-3 text-sm font-bold" style={{ color: colors.accent }}>
          {t("store.appearance_preview_price")}
        </p>
        <div
          className="mt-3 rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: colors.border, color: colors.text }}
        >
          {t("store.appearance_preview_field")}
        </div>
        <div
          className="mt-2 rounded-lg px-3 py-2 text-center text-xs font-bold"
          style={{ background: colors.button, color: colors.buttonText }}
        >
          {cta}
        </div>
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  const t = useT("settings");
  const common = useT("common");
  const locale = useLocale();
  const [data, setData] = useState<StoreAppearance | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [schemes, setSchemes] = useState<AppearanceColorScheme[]>([]);
  const [pageScheme, setPageScheme] = useState("");
  const [selected, setSelected] = useState("");
  const [textLocale, setTextLocale] = useState<StoreLocale>("ar");
  const [drafts, setDrafts] = useState<Partial<Record<StoreLocale, Record<string, string>>>>({});
  const [controls, setControls] = useState({
    hideLogo: false,
    searchEnabled: true,
    hideHeroImages: false,
    headerHtml: "",
  });

  function applySaved(saved: StoreAppearance, initial = false) {
    setData(saved);
    setSchemes(cloneSchemes(saved.colorSchemes));
    setPageScheme(saved.pageScheme);
    setSelected((id) => (saved.colorSchemes.some((scheme) => scheme.id === id) ? id : saved.colorSchemes[0]?.id ?? ""));
    if (initial) {
      setTextLocale(saved.primaryLocale);
      setDrafts(saved.texts);
    }
    setControls({
      hideLogo: saved.hideLogo,
      searchEnabled: saved.searchEnabled,
      hideHeroImages: saved.hideHeroImages,
      headerHtml: saved.headerHtml,
    });
  }

  async function load() {
    setLoadError(null);
    try {
      applySaved(await getAppearance(), true);
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
          <p className="font-semibold">{t("store.appearance_load_error")}</p>
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

  if (data === null) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-40 items-center justify-center">
        <Loader2 size={22} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const current = schemes.find((scheme) => scheme.id === selected) ?? schemes[0];
  const localeDrafts = drafts[textLocale] ?? {};

  function updateColor(role: AppearanceColorRole, value: string) {
    if (!current) return;
    setSchemes((list) =>
      list.map((scheme) =>
        scheme.id === current.id ? { ...scheme, colors: { ...scheme.colors, [role]: value } } : scheme,
      ),
    );
  }

  function appearancePayload(overrides: Partial<SaveAppearanceInput> = {}): SaveAppearanceInput {
    return {
      colorSchemes: schemes,
      pageScheme,
      hideLogo: controls.hideLogo,
      searchEnabled: controls.searchEnabled,
      hideHeroImages: controls.hideHeroImages,
      headerHtml: controls.headerHtml,
      ...overrides,
    };
  }

  async function saveColors() {
    applySaved(await saveAppearance(appearancePayload()));
  }

  async function saveControls() {
    applySaved(await saveAppearance(appearancePayload()));
  }

  async function saveTexts() {
    const values: Record<string, string> = {};
    for (const key of APPEARANCE_TEXT_KEYS) values[key] = localeDrafts[key] ?? "";
    const saved = await saveAppearance({
      ...appearancePayload({
        colorSchemes: data!.colorSchemes,
        pageScheme: data!.pageScheme,
        hideLogo: data!.hideLogo,
        searchEnabled: data!.searchEnabled,
        hideHeroImages: data!.hideHeroImages,
        headerHtml: data!.headerHtml,
        texts: { locale: textLocale, values },
      }),
    });
    applySaved(saved);
    setDrafts((all) => ({ ...all, [textLocale]: saved.texts[textLocale] ?? {} }));
  }

  function updateText(key: AppearanceTextKey, value: string) {
    setDrafts((all) => ({
      ...all,
      [textLocale]: { ...(all[textLocale] ?? {}), [key]: value },
    }));
  }

  const previewTitle = localeDrafts.heroTitle?.trim() || t("store.appearance_preview_title");
  const previewSubtitle = localeDrafts.heroSubtitle?.trim() || t("store.appearance_preview_text");
  const previewCta = localeDrafts.heroCtaPrimary?.trim() || t("store.appearance_preview_cta");

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-card px-5 py-4 shadow-card">
        <h2 className="text-sm font-semibold text-foreground">{t("store.appearance_title")}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("store.appearance_subtitle")}</p>
      </div>

      <SettingsSection
        icon={Palette}
        title={t("store.appearance_colors_title")}
        subtitle={t("store.appearance_colors_subtitle")}
        onSave={saveColors}
      >
        <div className="mb-5 space-y-2">
          <div>
            <span className="block text-sm font-medium text-foreground">
              {t("store.appearance_looks_label")}
            </span>
            <p className="text-xs text-muted-foreground">{t("store.appearance_looks_hint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {LOOKS.map((look) => {
              if (!schemes.some((scheme) => scheme.id === look.id)) return null;
              const active = pageScheme === look.id;
              return (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => {
                    setPageScheme(look.id);
                    setSelected(look.id);
                  }}
                  aria-pressed={active}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active ? "border-primary/50 bg-primary/[0.06] text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="size-3 rounded-full border border-black/10" style={{ background: look.swatch }} />
                  {t(look.labelKey)}
                  {active && <Check size={13} className="text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-foreground">
                {t("store.appearance_schemes_label")}
              </span>
              <p className="text-xs text-muted-foreground">{t("store.appearance_schemes_hint")}</p>
            </div>
            <div className="space-y-1.5">
              {schemes.map((scheme) => {
                const active = scheme.id === current?.id;
                return (
                  <button
                    key={scheme.id}
                    type="button"
                    onClick={() => setSelected(scheme.id)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-start transition-colors ${
                      active
                        ? "border-primary/50 bg-primary/[0.06] shadow-xs"
                        : "border-border bg-card hover:bg-muted/60"
                    }`}
                  >
                    <span
                      className="grid size-7 shrink-0 place-items-center rounded-md border"
                      style={{ background: scheme.colors.background, borderColor: scheme.colors.border }}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: scheme.colors.button }} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {schemeName(scheme.name, locale)}
                    </span>
                    {pageScheme === scheme.id && (
                      <Badge tone="neutral" size="sm">
                        {t("store.appearance_page_badge")}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
            <FieldRow
              label={t("store.appearance_page_scheme_label")}
              help={t("store.appearance_page_scheme_hint")}
            >
              <Select value={pageScheme} onChange={(event) => setPageScheme(event.target.value)}>
                {schemes.map((scheme) => (
                  <option key={scheme.id} value={scheme.id}>
                    {schemeName(scheme.name, locale)}
                  </option>
                ))}
              </Select>
            </FieldRow>
          </div>

          <div className="space-y-4">
            <div className="grid gap-2.5 xl:grid-cols-2">
              {APPEARANCE_COLOR_ROLES.map((role) => (
                <ColorField
                  key={role}
                  label={t(COLOR_LABEL_KEYS[role])}
                  value={current?.colors[role] ?? "#ffffff"}
                  onChange={(value) => updateColor(role, value)}
                />
              ))}
            </div>
            <AppearancePreview
              scheme={current}
              title={previewTitle}
              subtitle={previewSubtitle}
              cta={previewCta}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={SlidersHorizontal}
        title={t("store.appearance_storefront_title")}
        subtitle={t("store.appearance_storefront_subtitle")}
        onSave={saveControls}
      >
        <div className="space-y-5">
          <SwitchField
            label={t("store.appearance_control_hideLogo")}
            help={t("store.appearance_control_hideLogo_hint")}
            checked={controls.hideLogo}
            onChange={(hideLogo) => setControls((current) => ({ ...current, hideLogo }))}
          />
          <SwitchField
            label={t("store.appearance_control_searchEnabled")}
            help={t("store.appearance_control_searchEnabled_hint")}
            checked={controls.searchEnabled}
            onChange={(searchEnabled) => setControls((current) => ({ ...current, searchEnabled }))}
          />
          <SwitchField
            label={t("store.appearance_control_hideHeroImages")}
            help={t("store.appearance_control_hideHeroImages_hint")}
            checked={controls.hideHeroImages}
            onChange={(hideHeroImages) => setControls((current) => ({ ...current, hideHeroImages }))}
          />
          <Field
            label={t("store.appearance_control_headerHtml")}
            hint={`${controls.headerHtml.length}/${APPEARANCE_HEADER_HTML_MAX}`}
          >
            <Textarea
              value={controls.headerHtml}
              maxLength={APPEARANCE_HEADER_HTML_MAX}
              rows={3}
              spellCheck={false}
              onChange={(event) => setControls((current) => ({ ...current, headerHtml: event.target.value }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("store.appearance_control_headerHtml_hint")}
            </p>
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={Type}
        title={t("store.appearance_texts_title")}
        subtitle={t("store.appearance_texts_subtitle")}
        onSave={saveTexts}
      >
        <FieldRow label={t("store.appearance_language_label")} help={t("store.appearance_text_hint")}>
          <Select
            value={textLocale}
            onChange={(event) => setTextLocale(event.target.value as StoreLocale)}
          >
            {data.locales.map((code) => (
              <option key={code} value={code}>
                {STORE_LOCALE_INFO[code].nativeName}
              </option>
            ))}
          </Select>
        </FieldRow>

        <div className="grid gap-4 xl:grid-cols-2">
          {TEXT_FIELDS.map((field) => {
            const limit = APPEARANCE_TEXT_LIMITS[field.key];
            const value = localeDrafts[field.key] ?? "";
            return (
              <Field
                key={field.key}
                label={t(field.labelKey)}
                hint={`${value.length}/${limit.max}`}
                className={limit.multiline ? "xl:col-span-2" : ""}
              >
                {limit.multiline ? (
                  <Textarea
                    value={value}
                    maxLength={limit.max}
                    onChange={(event) => updateText(field.key, event.target.value)}
                  />
                ) : (
                  <Input
                    value={value}
                    maxLength={limit.max}
                    onChange={(event) => updateText(field.key, event.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>

        <AppearancePreview
          scheme={current}
          title={previewTitle}
          subtitle={previewSubtitle}
          cta={previewCta}
        />
      </SettingsSection>

      <p className="text-xs text-muted-foreground">
        {t("store.appearance_reload_hint")}
      </p>
    </div>
  );
}
