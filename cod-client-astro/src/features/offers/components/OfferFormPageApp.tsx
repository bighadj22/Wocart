import { useEffect, useMemo, useState } from "react";
import { Gift, House, Layers, MapPin, Plus, Trash2, Truck } from "lucide-react";
import {
  canScope,
  RequireAuth,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { TranslationsCard } from "@/features/translations/components/TranslationsCard";
import { createOffer, getOffer, updateOffer } from "@/features/offers/api";
import { ELIGIBLE_DELIVERY_METHODS, eligibleDeliveryMethodsOf, formTiers, formTiersProblem, offerBody, offerErrorMessage, tierSaving } from "@/features/offers/model";
import { toLocalInput } from "@/lib/datetime-local";
import type { FreeShippingDeliveryMethod, OfferFormValues } from "@/features/offers/types";
import { listProducts } from "@/features/products/api";
import type { Product, ProductVariant } from "@/features/products/types";
import { Alert, Button, Card, Field, FormPage, IconButton, InfoTip, Input, Select, Switch } from "@/components/ui";
import { formatMoney } from "@/features/orders/model";

const EMPTY_FORM: OfferFormValues = {
  name: "",
  discountType: "free",
  triggerProductId: "",
  triggerVariantId: "",
  triggerQuantity: "2",
  rewardProductId: "",
  rewardVariantId: "",
  rewardQuantity: "1",
  tiers: [
    { quantity: "1", price: "", freeShipping: false, eligibleDeliveryMethods: [...ELIGIBLE_DELIVERY_METHODS] },
    { quantity: "2", price: "", freeShipping: false, eligibleDeliveryMethods: [...ELIGIBLE_DELIVERY_METHODS] },
  ],
  startsAt: "",
  endsAt: "",
  status: "active",
  eligibleDeliveryMethods: [...ELIGIBLE_DELIVERY_METHODS],
};

function variantLabel(variant: ProductVariant) {
  return Object.values(variant.variations).join(" / ");
}

const DELIVERY_METHOD_ICONS = { home: House, stop_desk: MapPin } as const;

function DeliveryMethodsPicker({
  name,
  value,
  onChange,
  disabled,
  compact = false,
  error,
}: {
  name: string;
  value: readonly FreeShippingDeliveryMethod[];
  onChange: (methods: FreeShippingDeliveryMethod[]) => void;
  disabled?: boolean;
  compact?: boolean;
  error?: string;
}) {
  const t = useT("offers");
  const toggle = (method: FreeShippingDeliveryMethod) =>
    onChange(value.includes(method) ? value.filter((entry) => entry !== method) : ELIGIBLE_DELIVERY_METHODS.filter((entry) => value.includes(entry) || entry === method));
  return (
    <fieldset disabled={disabled} className={compact ? "col-span-3 space-y-1.5" : "space-y-1.5"}>
      <legend className="text-sm font-medium text-foreground">{t("form.eligible_delivery_methods_label")}</legend>
      {!compact && <p className="text-xs text-muted-foreground">{t("form.eligible_delivery_methods_hint")}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ELIGIBLE_DELIVERY_METHODS.map((method) => {
          const Icon = DELIVERY_METHOD_ICONS[method];
          const selected = value.includes(method);
          return (
            <label
              key={method}
              className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                selected ? "border-primary bg-subtle font-medium text-foreground" : "border-border text-muted-foreground hover:bg-subtle"
              }`}
            >
              <input type="checkbox" name={name} value={method} checked={selected} onChange={() => toggle(method)} className="sr-only" />
              <Icon size={16} aria-hidden="true" className="shrink-0" />
              <span>{t(`form.eligible_delivery_${method}`)}</span>
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </fieldset>
  );
}

function OfferForm({ offerId }: { offerId?: string }) {
  const t = useT("offers");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const editing = Boolean(offerId);
  const [form, setForm] = useState<OfferFormValues>(EMPTY_FORM);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const canManage = canScope(identity, SCOPES.OFFERS_MANAGE);
  const canSave = editing
    ? canScope(identity, SCOPES.OFFERS_READ) && canManage
    : canManage;

  useEffect(() => {
    let alive = true;
    Promise.all([
      listProducts({ status: "ACTIVE" })
        .then((envelope) => envelope.data)
        .catch(() => []),
      offerId ? getOffer(offerId) : Promise.resolve(null),
    ])
      .then(([nextProducts, offer]) => {
        if (!alive) return;
        setProducts(nextProducts);
        if (offer)
          setForm({
            name: offer.name,
            discountType: offer.discountType,
            triggerProductId: offer.triggerProduct?.id ?? "",
            triggerVariantId: offer.triggerVariant?.id ?? "",
            triggerQuantity: String(offer.triggerQuantity),
            rewardProductId: offer.rewardProduct?.id ?? "",
            rewardVariantId: offer.rewardVariant?.id ?? "",
            rewardQuantity: String(offer.rewardQuantity),
            tiers: offer.tiers.length
              ? offer.tiers.map((tier) => ({ quantity: String(tier.quantity), price: String(tier.price), freeShipping: tier.freeShipping, eligibleDeliveryMethods: eligibleDeliveryMethodsOf(tier.freeShippingDeliveryType) }))
              : EMPTY_FORM.tiers,
            startsAt: toLocalInput(offer.startsAt),
            endsAt: toLocalInput(offer.endsAt),
            status: offer.status,
            eligibleDeliveryMethods: eligibleDeliveryMethodsOf(offer.freeShippingDeliveryType),
          });
      })
      .catch((cause) => {
        if (alive) setMessage(offerErrorMessage(cause, t));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [offerId, canSave]);

  function update<K extends keyof OfferFormValues>(
    key: K,
    value: OfferFormValues[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const triggerProduct = useMemo(
    () =>
      products.find((product) => product.id === form.triggerProductId) ?? null,
    [products, form.triggerProductId],
  );
  const rewardProduct = useMemo(
    () =>
      products.find((product) => product.id === form.rewardProductId) ?? null,
    [products, form.rewardProductId],
  );
  const triggerVariants: ProductVariant[] = useMemo(
    () =>
      triggerProduct?.hasVariants
        ? (triggerProduct.variants ?? []).filter((variant) => variant.active)
        : [],
    [triggerProduct],
  );
  const rewardVariants: ProductVariant[] = useMemo(
    () =>
      rewardProduct?.hasVariants
        ? (rewardProduct.variants ?? []).filter((variant) => variant.active)
        : [],
    [rewardProduct],
  );
  const rewardIsSameProduct = form.rewardProductId === form.triggerProductId;

  function validate() {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = t("form.error_name_required");
    if (!form.triggerProductId)
      next.triggerProductId = t("form.error_trigger_product_required");
    if (form.discountType === "free" && !form.rewardProductId)
      next.rewardProductId = t("form.error_reward_product_required");
    if (form.discountType === "free_shipping" && form.eligibleDeliveryMethods.length === 0)
      next.eligibleDeliveryMethods = t("form.error_eligible_delivery_methods");
    const triggerQty = parseInt(form.triggerQuantity, 10);
    if (form.discountType !== "quantity_price" && (Number.isNaN(triggerQty) || triggerQty < 1))
      next.triggerQuantity = t("form.error_trigger_qty");
    if (form.discountType === "quantity_price") {
      const problem = formTiersProblem(form);
      if (problem) next.tiers = t(`error_invalid.${problem}`);
      else if (form.tiers.some((tier) => tier.freeShipping && tier.eligibleDeliveryMethods.length === 0))
        next.tiers = t("form.error_tier_eligible_delivery_methods");
    }
    if (form.startsAt && form.endsAt && form.endsAt <= form.startsAt)
      next.endsAt = t("error_invalid.schedule_ends_before_start");
    if (form.discountType === "free") {
      const rewardQty = parseInt(form.rewardQuantity, 10);
      if (Number.isNaN(rewardQty) || rewardQty < 1)
        next.rewardQuantity = t("form.error_reward_qty");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = offerBody(form, editing);
      if (offerId) await updateOffer(offerId, body);
      else await createOffer(body);
      notify.flashSuccess(t(offerId ? "form.success_edit" : "form.success_add"));
      window.location.assign("/offers");
    } catch (cause) {
      const message = offerErrorMessage(cause, t);
      setMessage(message);
      notify.error(message);
      setBusy(false);
    }
  }
  if (!canSave || (editing && message && !form.name))
    return (
      <Alert role="alert" tone="critical">
        {message ?? auth("no_access")}
      </Alert>
    );
  if (loading)
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <div className="h-20 shimmer rounded-xl" />
        <div className="h-72 shimmer rounded-xl" />
      </div>
    );

  const productSelect = (
    key: "triggerProductId" | "rewardProductId",
    variantKey: "triggerVariantId" | "rewardVariantId",
    placeholder: string,
  ) => (
    <Select
      value={form[key]}
      onChange={(event) => {
        update(key, event.currentTarget.value);
        update(variantKey, "");
      }}
      disabled={busy}
    >
      <option value="">{placeholder}</option>
      {products.map((product) => (
        <option key={product.id} value={product.id}>
          {product.name}
        </option>
      ))}
    </Select>
  );
  const quantity = (key: "triggerQuantity" | "rewardQuantity") => (
    <Input type="number" min={1} value={form[key]} onChange={(event) => update(key, event.currentTarget.value)} className="max-w-32 tabular-nums" disabled={busy} />
  );

  return (
    <FormPage
      title={editing ? t("form.title_edit") : t("form.title_add")}
      backHref="/offers"
      error={message}
      onSave={() => void save()}
      saving={busy}
    >
      <Card>
        <div className="space-y-4">
          <Field label={t("form.name_label")} error={errors.name}>
            <Input value={form.name} onChange={(event) => update("name", event.currentTarget.value)} placeholder={t("form.name_placeholder")} disabled={busy} />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <span>{t("form.discount_type_label")}</span>
              <InfoTip>{t("form.free_shipping_note")}</InfoTip>
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(["free", "free_shipping", "quantity_price"] as const).map((type) => {
                const Icon = type === "free" ? Gift : type === "free_shipping" ? Truck : Layers;
                const selected = form.discountType === type;
                return (
                  <label
                    key={type}
                    className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                      selected ? "border-primary bg-subtle font-medium text-foreground" : "border-border text-muted-foreground hover:bg-subtle"
                    }`}
                  >
                    <input type="radio" name="discountType" checked={selected} onChange={() => update("discountType", type)} disabled={busy} className="sr-only" />
                    <Icon size={16} aria-hidden="true" className="shrink-0" />
                    <span>{t(`discount_type.${type}`)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <span id="offer-active" className="text-sm font-medium text-foreground">{t("form.status_active")}</span>
            <Switch
              checked={form.status === "active"}
              onChange={(on) => update("status", on ? "active" : "inactive")}
              disabled={busy}
              aria-labelledby="offer-active"
            />
          </div>
          {form.discountType === "free_shipping" && (
            <div className="border-t border-border pt-4">
              <DeliveryMethodsPicker
                name="eligibleDeliveryMethods"
                value={form.eligibleDeliveryMethods}
                onChange={(methods) => update("eligibleDeliveryMethods", methods)}
                disabled={busy}
                error={errors.eligibleDeliveryMethods}
              />
            </div>
          )}
        </div>
      </Card>

      <Card title={t("form.section_trigger")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("form.trigger_product_label")} error={errors.triggerProductId}>
            {productSelect("triggerProductId", "triggerVariantId", t("form.trigger_product_placeholder"))}
          </Field>
          {triggerVariants.length > 0 && (
            <Field label={t("form.trigger_variant_label")}>
              <Select
                value={form.triggerVariantId || "__any__"}
                onChange={(event) => update("triggerVariantId", event.currentTarget.value === "__any__" ? "" : event.currentTarget.value)}
                disabled={busy}
              >
                <option value="__any__">{t("form.trigger_variant_any")}</option>
                {triggerVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variantLabel(variant)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {form.discountType !== "quantity_price" && (
            <Field label={t("form.trigger_qty_label")} help={t("form.trigger_qty_hint")} error={errors.triggerQuantity} className="sm:col-span-2">
              {quantity("triggerQuantity")}
            </Field>
          )}
        </div>
      </Card>

      {form.discountType === "free" && (
        <Card title={t("form.section_reward")}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("form.reward_product_label")} error={errors.rewardProductId}>
              {productSelect("rewardProductId", "rewardVariantId", t("form.reward_product_placeholder"))}
            </Field>
            {rewardVariants.length > 0 && (
              <Field label={t("form.reward_variant_label")}>
                <Select
                  value={form.rewardVariantId || "__default__"}
                  onChange={(event) => update("rewardVariantId", event.currentTarget.value === "__default__" ? "" : event.currentTarget.value)}
                  disabled={busy}
                >
                  <option value="__default__">{rewardIsSameProduct ? t("form.reward_variant_same") : t("form.reward_variant_any")}</option>
                  {rewardVariants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variantLabel(variant)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t("form.reward_qty_label")} error={errors.rewardQuantity} className="sm:col-span-2">
              {quantity("rewardQuantity")}
            </Field>
          </div>
        </Card>
      )}

      {form.discountType === "quantity_price" && (
        <Card title={t("form.section_tiers")} subtitle={t("form.tiers_hint")}>
          <div className="space-y-3">
            {form.tiers.map((tier, index) => {
              const parsed = formTiers({ tiers: [tier] })?.[0];
              const unitPrice = triggerProduct?.price ?? null;
              const saving = parsed && unitPrice !== null && parsed.quantity > 0 ? tierSaving(parsed, unitPrice) : null;
              const set = (patch: Partial<typeof tier>) => update("tiers", form.tiers.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
              return (
                <div key={index} className="grid grid-cols-[6rem_1fr_auto] items-end gap-3 rounded-lg border border-border p-3">
                  <Field label={t("form.tier_quantity_label")}>
                    <Input type="number" min={1} value={tier.quantity} onChange={(event) => set({ quantity: event.currentTarget.value })} className="tabular-nums" disabled={busy} />
                  </Field>
                  <Field label={t("form.tier_price_label")} hint={saving ? (saving.saved > 0 ? t("form.tier_saving", { perUnit: formatMoney(saving.perUnit, locale), saved: formatMoney(saving.saved, locale) }) : t("form.tier_each", { perUnit: formatMoney(saving.perUnit, locale) })) : undefined}>
                    <Input type="number" min={0} value={tier.price} onChange={(event) => set({ price: event.currentTarget.value })} className="tabular-nums" disabled={busy} />
                  </Field>
                  <IconButton variant="danger" onClick={() => update("tiers", form.tiers.filter((_, at) => at !== index))} disabled={busy || form.tiers.length === 1} aria-label={t("form.tier_remove")} title={t("form.tier_remove")}>
                    <Trash2 size={15} />
                  </IconButton>
                  <label className="col-span-3 flex items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={tier.freeShipping} onChange={(event) => set({ freeShipping: event.currentTarget.checked })} disabled={busy} className="size-4 accent-[var(--primary)]" />
                    {t("form.tier_free_shipping")}
                  </label>
                  {tier.freeShipping && (
                    <DeliveryMethodsPicker
                      name={`tierDeliveryMethods-${index}`}
                      value={tier.eligibleDeliveryMethods}
                      onChange={(methods) => set({ eligibleDeliveryMethods: methods })}
                      disabled={busy}
                      compact
                    />
                  )}
                </div>
              );
            })}
            {errors.tiers && <p role="alert" className="text-sm text-destructive">{errors.tiers}</p>}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => update("tiers", [...form.tiers, { quantity: String(Math.max(0, ...form.tiers.map((entry) => Number(entry.quantity) || 0)) + 1), price: "", freeShipping: false, eligibleDeliveryMethods: [...ELIGIBLE_DELIVERY_METHODS] }])}
              disabled={busy || form.tiers.length >= 10}
            >
              <Plus size={14} aria-hidden="true" />
              {t("form.tier_add")}
            </Button>
          </div>
        </Card>
      )}

      <Card title={t("form.section_schedule")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("form.starts_at_label")}>
            <Input type="datetime-local" value={form.startsAt} onChange={(event) => update("startsAt", event.currentTarget.value)} disabled={busy} />
          </Field>
          <Field label={t("form.ends_at_label")} error={errors.endsAt}>
            <Input type="datetime-local" value={form.endsAt} onChange={(event) => update("endsAt", event.currentTarget.value)} disabled={busy} />
          </Field>
        </div>
      </Card>

      {offerId && <TranslationsCard resource="offer" id={offerId} canEdit={canManage} />}
    </FormPage>
  );
}

function Gated({ offerId }: { offerId?: string }) {
  return (
    <DashboardPage narrow>
      <OfferForm offerId={offerId} />
    </DashboardPage>
  );
}

export default function OfferFormPageApp({ offerId }: { offerId?: string }) {
  return (
    <RequireAuth>
      <Gated offerId={offerId} />
    </RequireAuth>
  );
}
