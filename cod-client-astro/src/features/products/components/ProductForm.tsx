import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  createProduct,
  createVariant,
  deleteProductImage,
  deleteVariant,
  getProduct,
  listProductGroups,
  listProductImages,
  listShippingProfiles,
  listVariants,
  reorderProductImages,
  saveProductImage,
  updateProduct,
  updateVariant,
} from "@/features/products/api";
import {
  apiVariantOptions,
  calcMargin,
  generateCombinations,
  optionalDescription,
  optionalId,
  optionalMoney,
  productErrorMessage,
  toSlug,
  variantLabel,
} from "@/features/products/model";
import type {
  ProductImage,
  ProductStatus,
  ShippingProfile,
  VariantOptionFormState,
} from "@/features/products/types";
import { Alert, Button, Card, FormPage, useConfirmDialog } from "@/components/ui";
import {
  ProductImageUploader,
  formImageId,
  type FormImage,
} from "@/features/products/components/ProductImageUploader";
import { ProductBasicInfoCard } from "@/features/products/components/ProductBasicInfoCard";
import { ProductPricingCard } from "@/features/products/components/ProductPricingCard";
import {
  ProductVariantsCard,
  type VariantRow,
} from "@/features/products/components/ProductVariantsCard";
import { ProductSettingsCard } from "@/features/products/components/ProductSettingsCard";
import {
  ProductPreview,
  type ProductPreviewStats,
} from "@/features/products/components/ProductPreview";
import { ProductCollectionsCard } from "@/features/products/components/ProductCollectionsCard";
import { ProductSeoCard } from "@/features/products/components/ProductSeoCard";
import { listCollections } from "@/features/collections/api";
import type { CollectionSummary } from "@/features/collections/types";

export function ProductForm({ productId }: { productId?: string }) {
  const t = useT("products");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const editing = Boolean(productId);
  const [initialLoading, setInitialLoading] = useState(editing);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [shippingProfileId, setShippingProfileId] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionFormat, setDescriptionFormat] = useState<"text" | "html">("html");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [price, setPrice] = useState("");
  const priceRef = useRef("");
  priceRef.current = price;
  const [compareAtPrice, setCompareAtPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [status, setStatus] = useState<ProductStatus>("ACTIVE");
  const [trackInventory, setTrackInventory] = useState(true);
  const [showInStore, setShowInStore] = useState(true);
  const [inventory, setInventory] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("5");

  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  /** Null when the merchant may not see collections: a save then leaves the product's alone. */
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [shippingProfiles, setShippingProfiles] = useState<ShippingProfile[]>([]);
  /** The product's images as the server holds them, in their order. */
  const [savedImages, setSavedImages] = useState<ProductImage[]>([]);
  /** The images as the editor shows them; Save makes the server match. */
  const [images, setImages] = useState<FormImage[]>([]);
  const shownSavedImages = images.flatMap((img) => (img.kind === "saved" ? [img.image] : []));

  const [hasVariantsSwitch, setHasVariantsSwitch] = useState(false);
  const [variantOptions, setVariantOptions] = useState<VariantOptionFormState[]>([]);
  const [variantRows, setVariantRows] = useState<VariantRow[]>([]);

  /** The shopper's view of the form as it stands, unsaved edits included. */
  const [previewOpen, setPreviewOpen] = useState(false);
  /** The saved product's own visibility mark; the form does not edit it. */
  const [productVisible, setProductVisible] = useState(true);
  const [reviewStats, setReviewStats] = useState<ProductPreviewStats | null>(
    null,
  );

  const canManage = canScope(identity, SCOPES.PRODUCTS_MANAGE);
  const canSave = editing
    ? canScope(identity, SCOPES.PRODUCTS_READ) && canManage
    : canScope(identity, SCOPES.PRODUCTS_CREATE);

  async function toggleVariants(nextChecked: boolean) {
    if (!nextChecked && editing && variantRows.length > 0) {
      if (
        !(await confirm({
          title: t("form.remove_variants_confirm"),
          description: t("form.remove_variants_confirm_desc"),
          confirmLabel: t("form.remove_variants_confirm_label"),
          tone: "danger",
        }))
      )
        return;
    }
    setHasVariantsSwitch(nextChecked);
    if (!nextChecked) setVariantOptions([]);
  }

  useEffect(() => {
    if (!editing && name) setSlug(toSlug(name));
  }, [name, editing]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      listProductGroups().catch(() => []),
      listShippingProfiles().catch(() => []),
      canScope(identity, SCOPES.COLLECTIONS_READ) ? listCollections().catch(() => null) : Promise.resolve(null),
    ])
      .then(([nextGroups, nextProfiles, nextCollections]) => {
        if (alive) {
          setGroups(nextGroups);
          setShippingProfiles(nextProfiles);
          setCollections(nextCollections);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  function canLoadExisting() {
    return (
      canScope(identity, SCOPES.PRODUCTS_READ) &&
      canScope(identity, SCOPES.PRODUCTS_MANAGE)
    );
  }

  useEffect(() => {
    if (!productId || !canLoadExisting()) return;
    let alive = true;
    Promise.all([
      getProduct(productId),
      listVariants(productId),
      listProductImages(productId),
    ])
      .then(([product, loadedVariants, loadedImages]) => {
        if (!alive || !product) return;
        setSavedImages(loadedImages);
        setImages(loadedImages.map((image) => ({ kind: "saved", image })));
        setName(product.name);
        setSlug(product.handle);
        setSku(product.sku ?? "");
        setCategoryId(product.categoryId ?? "");
        setShippingProfileId(product.shippingProfileId ?? "");
        setDescription(product.description ?? "");
        setDescriptionFormat(product.descriptionFormat ?? "text");
        setMetaTitle(product.metaTitle ?? "");
        setMetaDescription(product.metaDescription ?? "");
        setPrice(String(product.price));
        setCompareAtPrice(
          product.compareAtPrice ? String(product.compareAtPrice) : "",
        );
        setCostPrice(product.costPrice ? String(product.costPrice) : "");
        setStatus(product.status);
        setTrackInventory(product.trackInventory);
        setShowInStore(product.showInStore);
        setProductVisible(product.visibility);
        setReviewStats(
          product.reviewCount && product.reviewCount > 0
            ? {
                avgRating: product.avgRating ?? 0,
                reviewCount: product.reviewCount,
              }
            : null,
        );
        setCollectionIds(product.collectionIds ?? []);
        setInventory(String(product.inventory));
        setLowStockThreshold(String(product.lowStockThreshold ?? 5));
        if (product.hasVariants) {
          setHasVariantsSwitch(true);
          if (product.variantOptions) {
            setVariantOptions(
              product.variantOptions.map((option) => ({
                id: `tmp-${Math.random().toString(36).slice(2)}`,
                name: option.name,
                values: option.values.map((value) => ({
                  id: `tmp-${Math.random().toString(36).slice(2)}`,
                  value: value.value,
                  hexColor: value.hexColor ?? "",
                })),
              })),
            );
          }
          if (loadedVariants.length > 0) {
            setVariantRows(
              loadedVariants.map((variant) => ({
                key: Object.values(variant.variations).join(" / "),
                variations: variant.variations,
                price: String(variant.price),
                cost: variant.costPrice == null ? "" : String(variant.costPrice),
                sku: variant.sku ?? "",
                inventory: String(variant.inventory),
                lowStockThreshold: String(variant.lowStockThreshold ?? 5),
                active: variant.active,
                existingId: variant.id,
                imageId: variant.imageId ?? null,
              })),
            );
          }
        }
      })
      .catch((cause) => {
        if (alive) setMessage(productErrorMessage(cause, t));
      })
      .finally(() => {
        if (alive) setInitialLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [productId, identity?.role, identity?.scopes.join(",")]);

  useEffect(() => {
    const combos = generateCombinations(variantOptions);
    setVariantRows((prev) => {
      const byKey = Object.fromEntries(prev.map((row) => [row.key, row]));
      return combos.map((combo) => ({
        ...combo,
        price: byKey[combo.key]?.price ?? priceRef.current,
        cost: byKey[combo.key]?.cost ?? "",
        sku: byKey[combo.key]?.sku ?? "",
        inventory: byKey[combo.key]?.inventory ?? "0",
        lowStockThreshold: byKey[combo.key]?.lowStockThreshold ?? "5",
        active: byKey[combo.key]?.active ?? true,
        existingId: byKey[combo.key]?.existingId,
        imageId: byKey[combo.key]?.imageId ?? null,
      }));
    });
  }, [variantOptions]);

  function validate() {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t("form.error_name_price_required");
    if (!price || Number(price) < 0)
      next.price = t("form.error_name_price_required");
    else if (!Number.isInteger(Number(price)))
      next.price = t("form.error_price_integer");
    if (!hasVariantsSwitch && !sku.trim())
      next.sku = t("form.error_sku_required");
    if (hasVariantsSwitch && variantRows.some((row) => !row.sku.trim()))
      next.variantRowsSku = t("form.error_required_variant_sku");
    if (hasVariantsSwitch) {
      const skus = variantRows
        .map((row) => row.sku.trim())
        .filter(Boolean);
      if (new Set(skus).size !== skus.length)
        next.variantRowsSkuDuplicate = t("form.error_duplicate_variant_sku");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  /**
   * Makes the product's images what the editor shows. Each step is recorded as
   * it lands, so a retry after a failure resumes instead of repeating it. New
   * images are appended by the server, then one reorder sets the shown order.
   */
  async function saveImages(id: string) {
    const shownIds = new Set(images.map(formImageId));
    let saved = savedImages;
    let shown = images;
    for (const image of savedImages) {
      if (shownIds.has(image.id)) continue;
      await deleteProductImage(id, image.id);
      saved = saved.filter((item) => item.id !== image.id);
      setSavedImages(saved);
    }
    for (const image of images) {
      if (image.kind !== "new") continue;
      const created = (await saveProductImage(id, { mediaKey: image.key })).data;
      saved = [...saved, created];
      shown = shown.map((item) => (item === image ? { kind: "saved", image: created } : item));
      setSavedImages(saved);
      setImages(shown);
    }
    const order = shown.map(formImageId);
    if (order.join() !== saved.map((item) => item.id).join()) {
      setSavedImages((await reorderProductImages(id, order)).data);
    }
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    {
      const apiOptions = apiVariantOptions(variantOptions);
      const hasVariants = apiOptions.length > 0 && variantRows.length > 0;
      const variantsToDelete: string[] = [];
      const orphanedIds = new Set<string>();

      if (editing && productId) {
        const existingVariants = await listVariants(productId);
        if (!hasVariantsSwitch) {
          for (const variant of existingVariants) {
            variantsToDelete.push(variant.id);
            orphanedIds.add(variant.id);
          }
        } else {
          for (const variant of existingVariants) {
            const isStillValid =
              apiOptions.length > 0 &&
              Object.entries(variant.variations).every(
                ([optionName, optionValue]) => {
                  const match = apiOptions.find(
                    (option) => option.name === optionName,
                  );
                  return (
                    match !== undefined &&
                    match.values.some((value) => value.value === optionValue)
                  );
                },
              );
            if (!isStillValid) {
              variantsToDelete.push(variant.id);
              orphanedIds.add(variant.id);
            }
          }
        }
      }

      const data: Record<string, unknown> = {
        name,
        handle: slug || toSlug(name),
        sku: sku || undefined,
        categoryId: optionalId(categoryId, editing),
        shippingProfileId: optionalId(shippingProfileId, editing),
        description: optionalDescription(description, editing),
        descriptionFormat,
        metaTitle: metaTitle.trim(),
        metaDescription: metaDescription.trim(),
        price: Math.round(Number(price)),
        compareAtPrice: optionalMoney(compareAtPrice, editing),
        costPrice: optionalMoney(costPrice, editing),
        status,
        trackInventory,
        showInStore,
        ...(collections ? { collectionIds } : {}),
        ...(editing
          ? {}
          : { inventory: hasVariants ? 0 : Number(inventory) || 0 }),
        lowStockThreshold: hasVariants
          ? undefined
          : Number(lowStockThreshold) || 5,
        hasVariants,
        variantOptions: hasVariants ? apiOptions : null,
      };

      // Track how far the multi-step save got so the failure message can say
      // WHAT failed and the retry can never duplicate the product.
      let savedId: string | null = null;
      let failedStep: "variants" | "images" | null = null;
      let failedVariantLabel: string | null = null;
      try {
        if (editing && productId) {
          await updateProduct(productId, data as never);
          savedId = productId;
        } else {
          savedId = (await createProduct(data as never)).data.id;
        }

        if (hasVariants) {
          failedStep = "variants";
          for (const row of variantRows) {
            if (row.existingId && orphanedIds.has(row.existingId)) continue;
            const variantData = {
              variations: row.variations,
              price: Math.round(Number(row.price) || 0),
              costPrice: row.cost.trim() === "" ? null : Math.max(0, Math.round(Number(row.cost) || 0)),
              sku: row.sku.trim(),
              inventory: Number(row.inventory) || 0,
              lowStockThreshold: Number(row.lowStockThreshold) || 5,
              active: row.active,
              imageId: row.imageId ?? null,
            };
            failedVariantLabel = variantLabel(row.variations) || row.sku.trim();
            if (row.existingId)
              await updateVariant(savedId, row.existingId, variantData as never);
            else {
              const created = (await createVariant(savedId, variantData as never)).data;
              setVariantRows((rows) =>
                rows.map((item) => (item.key === row.key ? { ...item, existingId: created.id } : item)),
              );
            }
          }
          failedVariantLabel = null;
        }
        failedStep = "images";
        for (const variantId of variantsToDelete) {
          await deleteVariant(savedId, variantId);
        }
        await saveImages(savedId);
        failedStep = null;
        notify.flashSuccess(t(editing ? "form.success_edit" : "form.success_add"));
        window.location.assign("/products");
        return;
      } catch (cause) {
        const detail = productErrorMessage(cause, t);
        let message = detail;
        if (failedStep === "variants" && failedVariantLabel) {
          message = `${t("form.error_variant_row", { variant: failedVariantLabel })} — ${detail}`;
        }

        // Partial-save trap: the product row EXISTS (created or updated) but
        // a later step failed. Retrying "create" would duplicate the product —
        // send the merchant to the editor instead, where retry = update.
        if (savedId && !editing) {
          notify.error(
            t("form.partial_save_redirect", { message: detail }),
          );
          window.location.assign(
            `/products/${encodeURIComponent(savedId)}/edit`,
          );
          return;
        }

        setMessage(message);
        notify.error(message);
        setBusy(false);
      }
    }
  }

  if (!canSave || (editing && message && !name))
    return (
      <Alert role="alert" tone="critical">
        {message ?? auth("no_access")}
      </Alert>
    );

  if (initialLoading)
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <div className="h-20 shimmer rounded-xl" />
        <div className="h-72 shimmer rounded-xl" />
      </div>
    );

  const margin = calcMargin(price, costPrice);
  const showImageCol = editing && shownSavedImages.length > 0;
  const backHref = productId
    ? `/products/${encodeURIComponent(productId)}`
    : "/products";
  const previewImages = images.map((img) =>
    img.kind === "saved"
      ? { url: img.image.url, alt: img.image.altText ?? null }
      : { url: img.url, alt: null },
  );
  const previewVariants = variantOptions
    .map((option) => ({
      name: option.name,
      values: option.values
        .map((value) => value.value)
        .filter((value) => value.trim() !== ""),
    }))
    .filter((option) => option.name.trim() !== "" && option.values.length > 0);

  return (
    <>
      <FormPage
        title={editing ? t("form.title_edit") : t("form.title_add")}
        backHref={backHref}
        error={message}
        onSave={() => void save()}
        saving={busy}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye size={16} aria-hidden="true" />
            {t("preview.open")}
          </Button>
        }
        aside={
          <>
          <ProductSettingsCard
            status={status}
            setStatus={setStatus}
            inventory={inventory}
            setInventory={setInventory}
            lowStockThreshold={lowStockThreshold}
            setLowStockThreshold={setLowStockThreshold}
            trackInventory={trackInventory}
            setTrackInventory={setTrackInventory}
            showInStore={showInStore}
            setShowInStore={setShowInStore}
            hasVariantsSwitch={hasVariantsSwitch}
            editing={editing}
            busy={busy}
          />
          {collections && <ProductCollectionsCard collections={collections} selected={collectionIds} onChange={setCollectionIds} busy={busy} />}
          </>
        }
      >
          <ProductBasicInfoCard
            name={name}
            setName={setName}
            sku={sku}
            setSku={setSku}
            slug={slug}
            setSlug={setSlug}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            shippingProfileId={shippingProfileId}
            setShippingProfileId={setShippingProfileId}
            description={description}
            setDescription={setDescription}
            setDescriptionFormat={setDescriptionFormat}
            groups={groups}
            shippingProfiles={shippingProfiles}
            errors={errors}
            setErrors={setErrors}
            busy={busy}
            hasVariantsSwitch={hasVariantsSwitch}
          />
  
          <Card title={t("form.section_images")}>
            <ProductImageUploader
              images={images}
              disabled={busy}
              onAdd={(img) => setImages((prev) => [...prev, img])}
              onRemove={(id) => {
                setImages((prev) => prev.filter((item) => formImageId(item) !== id));
                setVariantRows((rows) =>
                  rows.map((row) => (row.imageId === id ? { ...row, imageId: null } : row)),
                );
              }}
              onReorder={setImages}
            />
          </Card>
  
          <ProductPricingCard
            price={price}
            setPrice={setPrice}
            compareAtPrice={compareAtPrice}
            setCompareAtPrice={setCompareAtPrice}
            costPrice={costPrice}
            setCostPrice={setCostPrice}
            margin={margin}
            hasVariantsSwitch={hasVariantsSwitch}
            errors={errors}
            busy={busy}
          />
  
          <ProductVariantsCard
            hasVariantsSwitch={hasVariantsSwitch}
            onToggleVariants={toggleVariants}
            variantOptions={variantOptions}
            setVariantOptions={setVariantOptions}
            variantRows={variantRows}
            setVariantRows={setVariantRows}
            existingImages={shownSavedImages}
            errors={errors}
            setErrors={setErrors}
            busy={busy}
            showImageCol={showImageCol}
            productCost={costPrice}
          />

          <ProductSeoCard
            metaTitle={metaTitle}
            setMetaTitle={setMetaTitle}
            metaDescription={metaDescription}
            setMetaDescription={setMetaDescription}
            name={name}
            description={description}
            handle={slug || toSlug(name)}
            busy={busy}
          />
      </FormPage>
      <ProductPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        productId={productId}
        name={name}
        handle={slug || toSlug(name)}
        description={description}
        descriptionFormat={descriptionFormat}
        price={price}
        compareAtPrice={compareAtPrice}
        stock={{
          tracked: trackInventory,
          quantity: Number(inventory) || 0,
          threshold: Number(lowStockThreshold) || 0,
        }}
        images={previewImages}
        variants={previewVariants}
        status={status}
        showInStore={showInStore}
        productVisible={productVisible}
        reviewStats={reviewStats}
      />
    </>
  );
}
