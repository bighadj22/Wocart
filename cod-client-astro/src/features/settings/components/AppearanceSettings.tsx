import { useEffect, useState } from "react";
import { Eye, Image as ImageIcon, Loader2, Palette, Type } from "lucide-react";
import { Alert, Badge, Field, Input, Select, Textarea } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { ImageUploader } from "@/features/uploads/components/ImageUploader";
import type { MediaImage } from "@/features/uploads/api";
import { getAppearance, saveAppearance } from "@/features/settings/api";
import { SettingsSection, FieldRow } from "@/features/settings/components/SettingsSection";
import type { StoreAppearance } from "@/features/settings/types";
import {
  APPEARANCE_COLOR_ROLES,
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

const visibilityValue = (value: boolean | null) => (value === null ? "" : value ? "show" : "hide");
const parseVisibility = (value: string): boolean | null => (value === "" ? null : value === "show");

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
  const [heroImage, setHeroImage] = useState<MediaImage | null>(null);
  const [bannerImage, setBannerImage] = useState<MediaImage | null>(null);
  const [categoryCardsImage, setCategoryCardsImage] = useState<MediaImage | null>(null);
  const [heroVisible, setHeroVisible] = useState<boolean | null>(null);
  const [categoryCardsVisible, setCategoryCardsVisible] = useState<boolean | null>(null);

  async function load() {
    setLoadError(null);
    try {
      const appearance = await getAppearance();
      setData(appearance);
      setSchemes(cloneSchemes(appearance.colorSchemes));
      setPageScheme(appearance.pageScheme);
      setSelected(appearance.colorSchemes[0]?.id ?? "");
      setTextLocale(appearance.primaryLocale);
      setDrafts(appearance.texts);
      setHeroImage(appearance.images.heroImage);
      setBannerImage(appearance.images.bannerImage);
      setCategoryCardsImage(appearance.images.categoryCardsImage);
      setHeroVisible(appearance.visibility.heroVisible);
      setCategoryCardsVisible(appearance.visibility.categoryCardsVisible);
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

  async function saveColors() {
    const saved = await saveAppearance({ colorSchemes: schemes, pageScheme });
    setData(saved);
    setSchemes(cloneSchemes(saved.colorSchemes));
    setPageScheme(saved.pageScheme);
    setSelected((id) => (saved.colorSchemes.some((scheme) => scheme.id === id) ? id : saved.colorSchemes[0]?.id ?? ""));
  }

  async function saveTexts() {
    const values: Record<string, string> = {};
    for (const key of APPEARANCE_TEXT_KEYS) values[key] = localeDrafts[key] ?? "";
    const saved = await saveAppearance({
      colorSchemes: data!.colorSchemes,
      pageScheme: data!.pageScheme,
      texts: { locale: textLocale, values },
    });
    setData(saved);
    setDrafts((all) => ({ ...all, [textLocale]: saved.texts[textLocale] ?? {} }));
  }

  async function saveImages() {
    const ref = (image: MediaImage | null) =>
      image ? { key: image.key, width: image.width ?? undefined, height: image.height ?? undefined } : null;
    const saved = await saveAppearance({
      colorSchemes: data!.colorSchemes,
      pageScheme: data!.pageScheme,
      images: {
        heroImage: ref(heroImage),
        bannerImage: ref(bannerImage),
        categoryCardsImage: ref(categoryCardsImage),
      },
    });
    setData(saved);
    setHeroImage(saved.images.heroImage);
    setBannerImage(saved.images.bannerImage);
    setCategoryCardsImage(saved.images.categoryCardsImage);
  }

  async function saveVisibility() {
    const saved = await saveAppearance({
      colorSchemes: data!.colorSchemes,
      pageScheme: data!.pageScheme,
      visibility: { heroVisible, categoryCardsVisible },
    });
    setData(saved);
    setHeroVisible(saved.visibility.heroVisible);
    setCategoryCardsVisible(saved.visibility.categoryCardsVisible);
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

      <SettingsSection
        icon={Eye}
        title={t("store.appearance_sections_title")}
        subtitle={t("store.appearance_sections_subtitle")}
        onSave={saveVisibility}
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <FieldRow label={t("store.appearance_section_heroVisible")} help={t("store.appearance_visibility_hint")}>
            <Select value={visibilityValue(heroVisible)} onChange={(event) => setHeroVisible(parseVisibility(event.target.value))}>
              <option value="">{t("store.appearance_visibility_default")}</option>
              <option value="show">{t("store.appearance_visibility_show")}</option>
              <option value="hide">{t("store.appearance_visibility_hide")}</option>
            </Select>
          </FieldRow>
          <FieldRow label={t("store.appearance_section_categoryCardsVisible")} help={t("store.appearance_visibility_hint")}>
            <Select value={visibilityValue(categoryCardsVisible)} onChange={(event) => setCategoryCardsVisible(parseVisibility(event.target.value))}>
              <option value="">{t("store.appearance_visibility_default")}</option>
              <option value="show">{t("store.appearance_visibility_show")}</option>
              <option value="hide">{t("store.appearance_visibility_hide")}</option>
            </Select>
          </FieldRow>
        </div>
      </SettingsSection>

      <SettingsSection
        icon={ImageIcon}
        title={t("store.appearance_images_title")}
        subtitle={t("store.appearance_images_subtitle")}
        onSave={saveImages}
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <FieldRow label={t("store.appearance_image_heroImage")} help={t("store.appearance_image_hint")}>
            <ImageUploader value={heroImage} onChange={setHeroImage} alt={t("store.appearance_image_heroImage")} />
          </FieldRow>
          <FieldRow label={t("store.appearance_image_bannerImage")} help={t("store.appearance_image_hint")}>
            <ImageUploader value={bannerImage} onChange={setBannerImage} alt={t("store.appearance_image_bannerImage")} />
          </FieldRow>
          <FieldRow label={t("store.appearance_image_categoryCardsImage")} help={t("store.appearance_image_hint")}>
            <ImageUploader value={categoryCardsImage} onChange={setCategoryCardsImage} alt={t("store.appearance_image_categoryCardsImage")} />
          </FieldRow>
        </div>
      </SettingsSection>

      <p className="text-xs text-muted-foreground">
        {t("store.appearance_reload_hint")}
      </p>
    </div>
  );
}
