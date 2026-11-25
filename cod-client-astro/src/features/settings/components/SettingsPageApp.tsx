import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getMyStore } from "@/features/settings/api";
import { settingsErrorMessage } from "@/features/settings/model";
import { saveMyStore } from "@/features/settings/store-summary";
import { categoryFromSearch, STORE_TRANSLATED_FIELDS, type CategoryId } from "@/features/settings/model";
import type { StoreConfig, UpdateStoreData } from "@/features/settings/types";
import { SettingsSidebar } from "@/features/settings/components/SettingsSidebar";
import { GeneralSettings } from "@/features/settings/components/GeneralSettings";
import { LanguagesSettings } from "@/features/settings/components/LanguagesSettings";
import { TranslationsCard } from "@/features/translations/components/TranslationsCard";
import { SeoSettings } from "@/features/settings/components/SeoSettings";
import { DeliveryPricingSettings } from "@/features/settings/components/DeliveryPricingSettings";
import { CartSettings } from "@/features/settings/components/CartSettings";

function SettingsContent() {
  const t = useT("settings");
  const auth = useT("auth");
  const common = useT("common");
  const identity = useIdentity();
  const [storeConfig, setStoreConfig] = useState<StoreConfig | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryId>(() => categoryFromSearch(window.location.search));

  const isAdmin = identity?.role === "admin";

  async function load() {
    setLoadError(null);
    try {
      setStoreConfig(await getMyStore());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (isAdmin) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  async function handleSave(payload: UpdateStoreData) {
    try {
      setStoreConfig(await saveMyStore(payload));
    } catch (cause) {
      throw new Error(settingsErrorMessage(cause, t));
    }
  }

  if (!isAdmin)
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  if (loadError)
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("store.error_load")}</p>
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
  if (storeConfig === null)
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex min-h-40 items-center justify-center"
      >
        <Loader2 size={22} className="animate-spin text-muted-foreground" />
      </div>
    );

  const languagesKey = storeConfig.languages.map((l) => l.locale).join(",");

  const renderCategoryView = () => {
    switch (activeCategory) {
      case "general":
        return (
          <div className="space-y-6">
            <GeneralSettings storeConfig={storeConfig} onSave={handleSave} />
            <TranslationsCard
              key={`${languagesKey}:${storeConfig.currencySymbol}`}
              resource="store"
              id="me"
              fields={STORE_TRANSLATED_FIELDS.general}
              canEdit
            />
          </div>
        );
      case "languages":
        return (
          <LanguagesSettings
            key={`${storeConfig.lang}:${storeConfig.languages.map((l) => `${l.locale}${l.published ? "+" : "-"}`).join(",")}`}
            storeConfig={storeConfig}
            onSave={handleSave}
          />
        );
      case "seo":
        return (
          <div className="space-y-6">
            <SeoSettings storeConfig={storeConfig} onSave={handleSave} />
            <TranslationsCard
              key={`${languagesKey}:${storeConfig.metaTitle}:${storeConfig.metaDescription}`}
              resource="store"
              id="me"
              fields={STORE_TRANSLATED_FIELDS.seo}
              canEdit
            />
          </div>
        );
      case "cart":
        return <CartSettings storeConfig={storeConfig} onSave={handleSave} />;
      case "delivery":
        return (
          <DeliveryPricingSettings storeConfig={storeConfig} onSave={handleSave} />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="md:hidden">
        <SettingsSidebar
          activeCategory={activeCategory}
          onCategoryChange={setActiveCategory}
          variant="mobile"
        />
      </div>
      <div className="flex items-start gap-6">
        <div className="hidden md:block">
          <SettingsSidebar
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            variant="desktop"
          />
        </div>
        <div className="min-w-0 w-full flex-1">{renderCategoryView()}</div>
      </div>
    </div>
  );
}

function Gated() {
  const t = useT("settings");
  return (
    <DashboardPage>
      <PageHeader title={t("store.title")} />
      <SettingsContent />
    </DashboardPage>
  );
}

export default function SettingsPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
