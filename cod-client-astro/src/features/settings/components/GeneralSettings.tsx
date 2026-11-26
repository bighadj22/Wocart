import { useState } from "react";
import { Store } from "lucide-react";
import { Input } from "@/components/ui";
import { useT } from "@/i18n/react";
import { ImageUploader } from "@/features/uploads/components/ImageUploader";
import type { MediaImage } from "@/features/uploads/api";
import type { StoreConfig, UpdateStoreData } from "@/features/settings/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

/** Who the store is, wherever it shows: its name, its logo, how it writes prices, and its address on the web. */
export function GeneralSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: Pick<UpdateStoreData, "name" | "logoKey" | "currencySymbol" | "domain">) => Promise<void>;
}) {
  const t = useT("settings");
  const [name, setName] = useState(storeConfig.name);
  const [logo, setLogo] = useState<MediaImage | null>(storeConfig.logo);
  const [currencySymbol, setCurrencySymbol] = useState(storeConfig.currencySymbol);
  const [domain, setDomain] = useState(storeConfig.domain ?? "");

  return (
    <SettingsSection
      icon={Store}
      title={t("store.general_title")}
      subtitle={t("store.general_subtitle")}
      onSave={async () => {
        await onSave({
          name: name.trim() || storeConfig.name,
          logoKey: logo?.key ?? null,
          currencySymbol: currencySymbol.trim() || storeConfig.currencySymbol,
          // Empty input clears the domain (links fall back to the deployment's
          // storefront URL); otherwise send the trimmed hostname.
          domain: domain.trim() === "" ? null : domain.trim(),
        });
      }}
    >
      <FieldRow label={t("store.name_label")}>
        <Input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder={t("store.name_placeholder")}
        />
      </FieldRow>
      <div className="ml-auto w-full max-w-xs">
        <FieldRow label={t("store.logo_label")} help={t("store.logo_hint")}>
          <ImageUploader value={logo} onChange={setLogo} alt={name} shape="logo" />
        </FieldRow>
      </div>
      <FieldRow label={t("store.currency_symbol_label")} help={t("store.currency_symbol_hint")}>
        <Input
          value={currencySymbol}
          onChange={(event) => setCurrencySymbol(event.currentTarget.value)}
          maxLength={10}
          className="max-w-32"
        />
      </FieldRow>
      <FieldRow label={t("store.domain_label")} help={t("store.domain_hint")}>
        <Input
          value={domain}
          onChange={(event) => setDomain(event.currentTarget.value)}
          placeholder={t("store.domain_placeholder")}
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
        />
      </FieldRow>
    </SettingsSection>
  );
}
