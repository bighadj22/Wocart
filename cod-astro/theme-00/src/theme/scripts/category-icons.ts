import { bindEach } from "@wocart/theme/lifecycle";

const ICON_MAX = 128;

bindEach<HTMLImageElement>("[data-category-photo]", (image) => {
  const apply = () => {
    const small =
      image.complete &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0 &&
      image.naturalWidth <= ICON_MAX &&
      image.naturalHeight <= ICON_MAX;
    image.closest(".category-tile")?.classList.toggle("is-icon", small);
  };
  image.addEventListener("load", apply);
  apply();
  return () => image.removeEventListener("load", apply);
});
