import { defineComponent } from "@wocart/theme";
import { FIELD, GROUP, OPTION, SECTION } from "../labels";
import Marquee from "@/theme/components/home/Marquee.astro";
import { SCHEME_OF } from "@/theme/appearance";
import { schemeField } from "../shared";

/** A band of short promises that scrolls across the page; a shopper who asked for less motion sees it still. */
export const marquee = defineComponent({
  type: "marquee",
  capabilities: { insertable: true, surfaces: ["home", "page", "landing", "thank-you", "search", "track-order", "contact", "area:footer"] },
  component: Marquee,
  label: SECTION.marquee,
  group: GROUP.home,
  placement: "section",
  fields: [
    { key: "message1", kind: "text", label: FIELD.message(1), contentKey: "trust1Title" },
    { key: "message2", kind: "text", label: FIELD.message(2), contentKey: "trust2Title" },
    { key: "message3", kind: "text", label: FIELD.message(3), contentKey: "trust3Title" },
    { key: "message4", kind: "text", label: FIELD.message(4) },
    {
      key: "speed",
      kind: "select",
      label: FIELD.speed,
      options: ["slow", "normal", "fast"],
      optionLabels: { slow: OPTION.slow, normal: OPTION.normal, fast: OPTION.fast },
      default: "normal",
      display: "segmented",
    },
    schemeField(SCHEME_OF.saffron),
  ],
});
