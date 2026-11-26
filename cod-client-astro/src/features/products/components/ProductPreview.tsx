import { useEffect, useState } from "react";
import { BadgeCheck, ExternalLink, Eye, ImageOff } from "lucide-react";
import { storefrontPath } from "../../../../../cod-shared/storefront/routes";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { Badge, Button, Dialog } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useT } from "@/i18n/react";
import { toSlug } from "@/features/products/model";
import type { ProductStatus } from "@/features/products/types";
import { formatMoneyValue } from "@/features/products/model";
import { StarRating } from "@/features/reviews/components/ReviewCard";
import { ReviewPhotos, ReviewVoiceNote } from "@/features/reviews/components/ReviewMediaView";
import { formatReviewDate, photosOf, voiceOf } from "@/features/reviews/model";
import { listReviews } from "@/features/reviews/api";
import type { Review } from "@/features/reviews/types";
import { cachedStoreSummary, readStoreSummary } from "@/features/settings/store-summary";
import { previewDescriptionDocument } from "./preview-description";

export interface ProductPreviewImage {
  url: string;
  alt?: string | null;
}

export interface ProductPreviewVariant {
  name: string;
  values: string[];
}

export interface ProductPreviewStats {
  avgRating: number;
  reviewCount: number;
}

export interface ProductPreviewProps {
  open: boolean;
  onClose: () => void;
  productId?: string;
  name: string;
  handle: string;
  description: string;
  descriptionFormat: "text" | "html";
  price: string;
  compareAtPrice: string;
  stock: { tracked: boolean; quantity: number; threshold: number };
  images: ProductPreviewImage[];
  variants: ProductPreviewVariant[];
  status: ProductStatus;
  showInStore: boolean;
  productVisible: boolean;
  reviewStats: ProductPreviewStats | null;
}

/**
 * The product page as a shopper receives it, read from the form's current
 * values: an edit can be looked at before it is saved or published, which is
 * the one thing the live page cannot show. The description renders in a
 * sandboxed document, so pasted markup stays inside the preview.
 */
export function ProductPreview({
  open,
  onClose,
  productId,
  name,
  handle,
  description,
  descriptionFormat,
  price,
  compareAtPrice,
  stock,
  images,
  variants,
  status,
  showInStore,
  productVisible,
  reviewStats,
}: ProductPreviewProps) {
  const t = useT("products");
  const common = useT("common");
  const locale = useLocale();
  const identity = useIdentity();
  const isAdmin = identity?.role === "admin";
  const canReadReviews = canScope(identity, SCOPES.REVIEWS_READ);

  const [domain, setDomain] = useState<string | null>(() => (isAdmin ? cachedStoreSummary()?.domain ?? null : null));
  const [activeImage, setActiveImage] = useState(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  useEffect(() => {
    if (!open || !isAdmin) return;
    let alive = true;
    readStoreSummary().then(
      (store) => {
        if (alive) setDomain(store.domain);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [open, isAdmin]);

  useEffect(() => {
    setActiveImage(0);
  }, [open, images.length]);

  useEffect(() => {
    if (!open || !productId || !canReadReviews) {
      setReviews([]);
      setReviewsTotal(0);
      setReviewsLoading(false);
      return;
    }
    let alive = true;
    setReviews([]);
    setReviewsTotal(0);
    setReviewsLoading(true);
    listReviews({ productId, status: "approved", limit: 3, withMedia: true })
      .then(
        ({ rows, total }) => {
          if (!alive) return;
          setReviews(rows);
          setReviewsTotal(total);
        },
        () => undefined,
      )
      .finally(() => {
        if (alive) setReviewsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, productId, canReadReviews]);

  const slug = handle.trim() || toSlug(name) || "product";
  const path = storefrontPath("product", { handle: slug });
  const liveUrl = domain ? `https://${domain}${path}` : null;
  const warning =
    status === "DRAFT"
      ? t("preview.draft")
      : status === "ARCHIVED"
        ? t("preview.archived")
        : !showInStore || !productVisible
          ? t("preview.hidden")
          : null;
  const live = Boolean(productId && liveUrl && !warning);

  const amount = Number(price);
  const compare = Number(compareAtPrice);
  const hasPrice = Number.isFinite(amount) && amount >= 0;
  const hasCompare = hasPrice && Number.isFinite(compare) && compare > amount && amount > 0;
  const discount = hasCompare ? Math.round(((compare - amount) / compare) * 100) : 0;
  const currentImage = images[Math.min(activeImage, Math.max(images.length - 1, 0))];

  const stockTone =
    !stock.tracked || stock.quantity > stock.threshold ? "in" : stock.quantity <= 0 ? "out" : "low";
  const stockLabel =
    stockTone === "in" ? t("preview.in_stock") : stockTone === "low" ? t("preview.low_stock") : t("preview.out_of_stock");
  const stockClass =
    stockTone === "in"
      ? "text-tone-success-text"
      : stockTone === "low"
        ? "text-tone-warning-text"
        : "text-destructive";

  const average = reviewStats?.avgRating ?? (reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null);
  const reviewCount = reviewStats?.reviewCount ?? reviewsTotal;
  const title = name.trim() || t("preview.untitled");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={<Eye size={18} aria-hidden="true" />}
      title={t("preview.title")}
      description={t("preview.description")}
      className="max-w-5xl"
      footer={
        <>
          {live && (
            <a
              href={liveUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary" })}
              title={t("preview.live_hint")}
            >
              <ExternalLink size={15} aria-hidden="true" />
              {t("preview.open_live")}
            </a>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            {common("close")}
          </Button>
        </>
      }
    >
      {warning && (
        <p className="mb-4 rounded-lg bg-tone-warning-bg px-3 py-2 text-sm font-medium text-tone-warning-text">
          {warning}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-2">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
            <span className="size-2 rounded-full bg-foreground/15" />
          </span>
          <span dir="ltr" className="min-w-0 truncate text-xs text-muted-foreground">
            {domain ? `${domain}${path}` : path}
          </span>
        </div>

        <div className="space-y-6 bg-card p-4 sm:p-5">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <div className="aspect-square overflow-hidden rounded-xl bg-muted">
                {currentImage ? (
                  <img src={currentImage.url} alt={currentImage.alt || title} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <ImageOff size={28} aria-hidden="true" />
                    {t("preview.no_image")}
                  </span>
                )}
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {images.map((image, index) => (
                    <button
                      key={`${image.url}-${index}`}
                      type="button"
                      onClick={() => setActiveImage(index)}
                      aria-label={t("preview.show_photo", { index: index + 1 })}
                      aria-pressed={index === activeImage}
                      className={`size-14 shrink-0 overflow-hidden rounded-lg border-2 bg-muted transition-colors ${
                        index === activeImage ? "border-foreground" : "border-transparent hover:border-border"
                      }`}
                    >
                      <img src={image.url} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-4">
              <h3 className="text-2xl font-semibold leading-tight text-foreground" dir="auto">
                {title}
              </h3>

              {average !== null && reviewCount > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <StarRating rating={Math.round(average)} />
                  <span className="font-semibold text-foreground">{average.toFixed(1)}</span>
                  <span className="text-muted-foreground">({reviewCount})</span>
                </div>
              )}

              {hasPrice && (
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {formatMoneyValue(amount, locale, common("currency.symbol"))}
                  </span>
                  {hasCompare && (
                    <span className="text-sm tabular-nums text-muted-foreground line-through">
                      {formatMoneyValue(compare, locale, common("currency.symbol"))}
                    </span>
                  )}
                  {discount > 0 && <Badge tone="critical">{t("preview.off", { percent: discount })}</Badge>}
                </div>
              )}

              <p className={`inline-flex items-center gap-1.5 text-sm font-medium ${stockClass}`}>
                <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                {stockLabel}
              </p>

              {variants.length > 0 && (
                <div className="space-y-3">
                  {variants.map((option) => (
                    <div key={option.name} className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground" dir="auto">
                        {option.name}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {option.values.map((value, index) => (
                          <span
                            key={`${option.name}-${value}`}
                            dir="auto"
                            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                              index === 0
                                ? "border-foreground bg-foreground text-background"
                                : "border-border bg-card text-foreground"
                            }`}
                          >
                            {value}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                  {t("preview.order")}
                </div>
                <p className="mt-2 text-center text-xs text-muted-foreground">{t("preview.cod")}</p>
              </div>
            </div>
          </div>

          {description.trim() && (
            <section className="space-y-2 border-t border-border pt-5">
              <h4 className="text-sm font-semibold text-foreground">{t("preview.description_label")}</h4>
              {descriptionFormat === "html" ? (
                <iframe
                  title={t("preview.description_label")}
                  srcDoc={previewDescriptionDocument(description)}
                  sandbox=""
                  className="h-80 w-full rounded-lg border border-border bg-white"
                />
              ) : (
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground" dir="auto">
                  {description}
                </p>
              )}
            </section>
          )}

          <section className="space-y-3 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-foreground">{t("preview.reviews")}</h4>
              {reviewCount > 0 && <span className="text-xs tabular-nums text-muted-foreground">({reviewCount})</span>}
            </div>

            {reviewsLoading ? (
              <div role="status" aria-busy="true" className="space-y-2">
                <div className="h-20 shimmer rounded-lg" />
                <div className="h-16 shimmer rounded-lg" />
              </div>
            ) : reviews.length > 0 ? (
              <ul className="space-y-2">
                {reviews.map((review) => (
                  <li key={review.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <StarRating rating={review.rating} />
                      <time dateTime={review.createdAt} className="text-xs text-muted-foreground">
                        {formatReviewDate(review.createdAt, locale)}
                      </time>
                    </div>
                    {review.title && (
                      <p className="text-sm font-semibold text-foreground" dir="auto">
                        {review.title}
                      </p>
                    )}
                    {review.body && (
                      <p className="text-sm leading-relaxed text-foreground" dir="auto">
                        {review.body}
                      </p>
                    )}
                    {voiceOf(review) && <ReviewVoiceNote voice={voiceOf(review)!} />}
                    {photosOf(review).length > 0 && <ReviewPhotos photos={photosOf(review)} customerName={review.customerName} />}
                    <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground" dir="auto">
                        {review.customerName}
                      </span>
                      {review.verified && (
                        <span className="inline-flex items-center gap-1 text-tone-success-text">
                          <BadgeCheck size={12} aria-hidden="true" />
                          {t("preview.verified")}
                        </span>
                      )}
                    </footer>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t("preview.reviews_empty")}
              </p>
            )}
          </section>
        </div>
      </div>
    </Dialog>
  );
}
