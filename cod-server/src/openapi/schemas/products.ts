/**
 * Product Schemas
 *
 * Products, variants, categories, images, stock management, and offers.
 */

import { z } from "@hono/zod-openapi";
import { MediaImageSchema, MediaKeySchema } from "./media";

export const ProductVariantOptionSchema = z.object({
  name: z.string().openapi({ example: "Color" }),
  values: z
    .array(
      z.object({
        value: z.string().openapi({ example: "Red" }),
        hexColor: z.string().nullable().optional().openapi({ example: "#FF0000" }),
      })
    )
    .min(1),
});

export const ProductImageSchema = z
  .object({
    id: z.string().openapi({ example: "img_abc123" }),
    productId: z.string().openapi({ example: "prod_abc123" }),
    key: MediaKeySchema,
    url: z.string().url().openapi({ description: "Where browsers fetch it, from the store's Media Delivery", example: "https://ik.imagekit.io/wocart/stores/maysa/products/3f2a9c0b1d2e4f5061728394a5b6c7d8.webp" }),
    width: z.number().int().nullable().openapi({ example: 1200 }),
    height: z.number().int().nullable().openapi({ example: 900 }),
    altText: z.string().nullable().openapi({
      description: "Alt text for accessibility",
      example: "Galaxy A54 front view",
    }),
    position: z.number().int().min(1).openapi({
      description: "Display order (1 = first)",
      example: 1,
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("ProductImage");

export const ProductVariantSchema = z
  .object({
    id: z.string().openapi({ example: "var_abc123" }),
    productId: z.string().openapi({ example: "prod_abc123" }),
    variations: z.record(z.string(), z.string()).openapi({
      description: "Key-value map matching the product's variantOptions axes",
      example: { Color: "Red", Size: "M" },
    }),
    currency: z.string().openapi({ example: "DZD" }),
    price: z.number().int().min(0).openapi({
      description: "Price in DZD",
      example: 45000,
    }),
    compareAtPrice: z.number().int().min(0).nullable().openapi({ example: null }),
    costPrice: z.number().int().min(0).nullable().openapi({
      description: "What one unit costs the merchant in DZD. Null uses the product's cost. Never shown to shoppers.",
      example: null,
    }),
    sku: z.string().openapi({
      description:
        "Unique stock-keeping unit identifier. Used for order tracking and inventory management.",
      example: "GALAXY-A54-RED-M",
    }),
    barcode: z.string().nullable().openapi({ example: null }),
    inventory: z.number().int().min(0).openapi({ example: 25 }),
    lowStockThreshold: z.number().int().min(0).openapi({
      description: "Alert when this variant's stock drops to this level.",
      example: 5,
    }),
    weightKg: z.number().min(0).nullable().openapi({ example: null }),
    imageId: z.string().nullable().openapi({
      description: "Product image ID associated with this variant",
      example: null,
    }),
    isDefault: z.boolean().openapi({ example: false }),
    active: z.boolean().openapi({ example: true }),
    position: z.number().int().min(1).openapi({ example: 1 }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("ProductVariant");

export const ProductCategoryRowSchema = z.object({
  id: z.string().openapi({ example: "cat_123" }),
  name: z.string().openapi({ example: "Electronics" }),
  slug: z.string().openapi({
    example: "electronics",
    description: "Lowercase letters, numbers and hyphens; auto-generated from name with a unique suffix when omitted",
  }),
  description: z.string().nullable().openapi({ example: "Electronic products" }),
  parentId: z.string().nullable().openapi({
    description: "Parent group ID for nested hierarchies; null for top-level groups",
    example: null,
  }),
  image: MediaImageSchema.nullable().openapi({ description: "The group's image, from its Media Key" }),
  metaTitle: z.string().nullable().openapi({
    description: "SEO page title (max 60 chars)",
    example: "Electronics | Wocart",
  }),
  metaDescription: z.string().nullable().openapi({
    description: "SEO description (max 160 chars)",
    example: "Phones, laptops and accessories",
  }),
  metaKeywords: z.string().nullable().openapi({
    description: "Comma-separated SEO keywords",
    example: "electronics, gadgets",
  }),
  position: z.number().int().min(0).openapi({
    example: 0,
    description: "Display order; lower values come first",
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ProductCategorySchema = ProductCategoryRowSchema.extend({
  productsCount: z.number().int().openapi({
    example: 5,
    description: "Number of active (non-deleted) products assigned to this group",
  }),
  children: z.array(ProductCategoryRowSchema).optional().openapi({
    description: "Immediate sub-categories. Included only in GET /api/product-groups/{id}.",
  }),
}).openapi("ProductCategory", {
  description: "Product category/collection group in the catalog hierarchy",
});

export const ProductSchema = z
  .object({
    id: z.string().openapi({ example: "prod_abc123" }),
    name: z.string().openapi({ example: "Samsung Galaxy A54" }),
    description: z.string().nullable().openapi({
      example: "6.4-inch display, 5000mAh battery",
    }),
    descriptionFormat: z.enum(["text", "html"]).openapi({
      description:
        "How `description` is stored. `text` renders as literal text (legacy rows and products created without a format); `html` was sanitised at write against the rich-text allow-list.",
      example: "text",
    }),
    descriptionPlain: z.string().nullable().openapi({
      description:
        "Tag-free rendering of `description` for meta/JSON-LD (tags stripped, images dropped, entities decoded, whitespace collapsed). Identical to `description` for `text` rows; null when `description` is null.",
      example: "6.4-inch display, 5000mAh battery",
    }),
    handle: z.string().openapi({
      description: "URL slug — auto-generated from name if not provided",
      example: "samsung-galaxy-a54-1a2b3c4d",
    }),
    currency: z.string().openapi({ example: "DZD" }),
    price: z.number().int().min(0).openapi({
      description: "Price in DZD (smallest unit)",
      example: 45000,
    }),
    compareAtPrice: z.number().int().min(0).nullable().openapi({ example: null }),
    costPrice: z.number().int().min(0).nullable().openapi({ example: null }),
    type: z.enum(["PHYSICAL", "DIGITAL"]).openapi({ example: "PHYSICAL" }),
    hasVariants: z.boolean().openapi({ example: true }),
    variantOptions: z.array(ProductVariantOptionSchema).nullable().openapi({
      description:
        "Variant option axes. Parsed from JSON storage — null when the product has no options.",
    }),
    sku: z.string().nullable().openapi({
      description:
        "Only used by simple products (hasVariants=false); variant products carry SKU on each variant.",
      example: null,
    }),
    inventory: z.number().int().min(0).openapi({
      description: "Stock for simple products; ignored for variant products.",
      example: 0,
    }),
    lowStockThreshold: z.number().int().min(0).openapi({
      description: "Alert when stock drops to this level. Ignored for variant products (threshold is per-variant).",
      example: 5,
    }),
    trackInventory: z.boolean().openapi({ example: true }),
    categoryId: z.string().nullable().openapi({ example: "cat_123" }),
    tags: z.array(z.string()).openapi({
      description: "Parsed from JSON storage.",
      example: ["samsung", "smartphone"],
    }),
    visibility: z.boolean().openapi({ example: true }),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).openapi({ example: "ACTIVE" }),
    showInStore: z.boolean().openapi({ example: true }),
    publishedAt: z.string().datetime().nullable().openapi({
      description: "Auto-set when status changes to ACTIVE",
      example: "2026-01-15T09:30:00.000Z",
    }),
    shippingProfileId: z.string().nullable().openapi({
      description:
        "Shipping profile ID for this product. Null = store default profile is used.",
      example: null,
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    metaTitle: z.string().nullable().openapi({ description: "Search-engine title (60 characters at most); null: the product's name", example: null }),
    metaDescription: z.string().nullable().openapi({ description: "Search-engine description (160 characters at most); null: the product's description, shortened", example: null }),

    variantsCount: z.number().int().openapi({
      description: "Number of variants attached to this product",
      example: 3,
    }),
    totalInventory: z.number().int().openapi({
      description:
        "Sum of variant inventory for variant products; product.inventory for simple products",
      example: 75,
    }),
    variants: z.array(ProductVariantSchema).openapi({
      description: "Variants ordered by position; variations are parsed into objects",
    }),

    primaryImage: MediaImageSchema.nullable().optional().openapi({
      description: "The gallery's first image. Included in list responses only.",
    }),
    reviewCount: z.number().int().optional().openapi({
      description: "Approved review count. Included in list responses only.",
      example: 12,
    }),
    avgRating: z.number().nullable().optional().openapi({
      description: "Average approved rating (1 decimal), null when unreviewed. Included in list responses only.",
      example: 4.5,
    }),

    category: ProductCategoryRowSchema.nullable().optional().openapi({
      description: "Full category record. Included only in GET /{id} detail responses.",
    }),
    images: z.array(ProductImageSchema).optional().openapi({
      description: "Images ordered by position. Included only in GET /{id} detail and mutation responses.",
    }),
  })
  .openapi("Product");

/** One product as its own page reads it: also the collections it is in. */
export const ProductDetailSchema = ProductSchema.extend({
  collectionIds: z.array(z.string()).openapi({
    description: "The collections the product is in (curated lists such as `featured` or `best-sellers`)",
    example: ["store-1:collection:best-sellers"],
  }),
}).openapi("ProductDetail");

export const StockMovementSchema = z
  .object({
    id: z.string().openapi({ example: "mov_abc123" }),
    productId: z.string().openapi({ example: "prod_abc123" }),
    variantId: z.string().nullable().openapi({
      description: "Variant ID for variant-level movements; null for simple products",
      example: null,
    }),
    type: z.enum([
      "PURCHASE",
      "ADJUSTMENT_ADD",
      "ADJUSTMENT_REMOVE",
      "ORDER_DEDUCTED",
      "ORDER_CANCELLED",
      "ORDER_RETURNED",
      "OFFLINE_SALE",
    ]),
    delta: z.number().int().openapi({
      description: "Positive = stock in, negative = stock out. Never zero.",
      example: 10,
    }),
    qtyBefore: z.number().int().openapi({ example: 5 }),
    qtyAfter: z.number().int().openapi({ example: 15 }),
    reason: z.string().nullable().openapi({
      description:
        "User-supplied note. Required by the API for ADJUSTMENT_ADD, ADJUSTMENT_REMOVE and OFFLINE_SALE.",
      example: "Restocked from supplier",
    }),
    reference: z.string().nullable().openapi({
      description: "orderId for ORDER_* movement types; null otherwise.",
      example: null,
    }),
    createdBy: z.string(),
    createdByName: z.string().openapi({ example: "Ahmed Benali" }),
    createdAt: z.string().datetime(),
  })
  .openapi("StockMovement");

export const StockAlertItemSchema = z
  .object({
    productId: z.string().openapi({ example: "prod_abc123" }),
    variantId: z.string().nullable().openapi({ example: null }),
    productName: z.string().openapi({ example: "Samsung Galaxy A54" }),
    variantLabel: z.string().nullable().openapi({
      description:
        "Concatenated variant option values, e.g. 'Red / M'. Null for simple products.",
      example: "أحمر / M",
    }),
    sku: z.string().nullable().openapi({
      description: "SKU code of the tracked row. Null when a simple product has none.",
      example: "TSHIRT-RED-M",
    }),
    inventory: z.number().int().openapi({ example: 2 }),
    lowStockThreshold: z.number().int().openapi({ example: 5 }),
    isOutOfStock: z.boolean().openapi({ example: false }),
    updatedAt: z.string().openapi({
      description:
        "Last write to the SKU row — every stock adjustment updates it.",
      example: "2025-01-15T10:30:00.000Z",
    }),
  })
  .openapi("StockAlertItem");

export const StockOverviewSchema = z
  .object({
    totalSkus: z.number().int().openapi({
      description: "Total number of tracked SKUs (simple + variants).",
      example: 42,
    }),
    outOfStockCount: z.number().int().openapi({ example: 3 }),
    lowStockCount: z.number().int().openapi({ example: 7 }),
    totalInventoryValue: z.number().int().openapi({
      description: "Sum of (inventory × price) across all tracked SKUs, in DZD.",
      example: 1250000,
    }),
    currency: z.string().openapi({ example: "DZD" }),
    outOfStockItems: z.array(StockAlertItemSchema),
    lowStockItems: z.array(StockAlertItemSchema).openapi({
      description: "Items at or below their low stock threshold (but still in stock).",
    }),
    allItems: z.array(StockAlertItemSchema).openapi({
      description:
        "Every tracked SKU. Sorted: out-of-stock first, then by inventory ascending. Used by the inventory table.",
    }),
  })
  .openapi("StockOverview");

export const OfferSchema = z
  .object({
    id: z.string().openapi({ description: "Offer UUID", example: "off_abc123" }),
    name: z.string().openapi({
      description: "Merchant-facing display name.",
      example: "اشتري 2 واحصل على 1 مجاناً",
    }),
    triggerProduct: z
      .object({
        id: z.string().openapi({ description: "Product UUID" }),
        name: z.string().openapi({ example: "Samsung Galaxy A54" }),
        handle: z.string().openapi({
          description: "URL-friendly product handle",
          example: "samsung-galaxy-a54",
        }),
      })
      .nullable()
      .openapi({
        description:
          "The product the customer must purchase to trigger this offer. Null when the trigger product no longer exists.",
      }),
    triggerVariant: z
      .object({
        id: z.string().openapi({ description: "Variant UUID" }),
        label: z.string().openapi({
          description: "Human-readable label built from variation values.",
          example: "أزرق / 128 GB",
        }),
      })
      .nullable()
      .openapi({
        description:
          "Specific variant required to trigger the offer. null = any variant of the trigger product.",
      }),
    triggerQuantity: z.number().int().min(1).openapi({
      description: "Minimum quantity of the trigger product the customer must order.",
      example: 2,
    }),
    rewardProduct: z
      .object({
        id: z.string().openapi({ description: "Product UUID" }),
        name: z.string().openapi({ example: "Samsung Galaxy Buds" }),
        handle: z.string().openapi({
          description: "URL-friendly product handle",
          example: "samsung-galaxy-buds",
        }),
      })
      .nullable()
      .openapi({
        description:
          "The product the customer receives for free when the offer triggers. null for `free_shipping` offers.",
      }),
    rewardVariant: z
      .object({
        id: z.string().openapi({ description: "Variant UUID" }),
        label: z.string().openapi({
          description: "Human-readable label built from variation values.",
          example: "أبيض",
        }),
      })
      .nullable()
      .openapi({
        description:
          "Specific variant given as the reward. null = same variant as the ordered item (when same product) or the first active variant (when different product). Always null for `free_shipping` offers.",
      }),
    rewardQuantity: z.number().int().min(0).openapi({
      description: "Number of free reward units added to the order. 0 for `free_shipping` offers.",
      example: 1,
    }),
    discountType: z.enum(["free", "free_shipping"]).openapi({
      description:
        "`free` = reward product added at price 0. `free_shipping` = delivery fee waived (no reward product).",
    }),
    startsAt: z.string().datetime().nullable().openapi({
      description: "UTC ISO-8601 datetime when the offer becomes active. null = no start restriction.",
      example: null,
    }),
    endsAt: z.string().datetime().nullable().openapi({
      description: "UTC ISO-8601 datetime when the offer expires. null = no end restriction.",
      example: null,
    }),
    status: z.enum(["active", "inactive"]).openapi({
      description: "Only `active` offers within the schedule window are auto-applied to store orders.",
      example: "active",
    }),
    state: z.enum(["inactive", "scheduled", "expired", "live"]).openapi({
      description: "Where the offer stands now: switched off, not started, ended, or live — the only state shoppers see it in.",
      example: "live",
    }),
    freeShippingDeliveryType: z.enum(["home", "stop_desk"]).nullable().openapi({
      description: "Delivery method earning free shipping. null means both home delivery and pickup point.",
      example: null,
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Offer");

export const ProductRemovalSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    variants: z.number().int(),
    images: z.number().int(),
    reviews: z.number().int(),
    offers: z.number().int().openapi({ description: "Offers it triggers or rewards: removed with it" }),
    landingPages: z.number().int().openapi({ description: "Its landing pages, with their images and pixel settings: removed with it" }),
    landingPageOrders: z.number().int().openapi({ description: "Orders those landing pages brought: kept, without the landing page link" }),
    orderLines: z.number().int().openapi({ description: "Order lines that sold it: kept as sold, without the product link" }),
    ordersToShip: z.number().int().openapi({ description: "Orders holding it not handed to delivery yet: they keep the line, which is never put back in stock" }),
  })
  .openapi("ProductRemoval");
