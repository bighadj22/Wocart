import { useCallback, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, UploadCloud, X } from "lucide-react";
import { IMAGE_ACCEPT, MAX_UPLOAD_MB, partitionUploadFiles, uploadFailure } from "@/features/uploads/api";
import { useImageUpload } from "@/features/uploads/useImageUpload";
import type { ProductImage } from "@/features/products/types";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";

/** One tile of the editor, in the order the merchant sees: saved already, or uploaded and saved with the product. */
export type FormImage =
  | { kind: "saved"; image: ProductImage }
  | { kind: "new"; clientId: string; key: string; url: string };

export function formImageId(img: FormImage) {
  return img.kind === "saved" ? img.image.id : img.clientId;
}

function formImageSrc(img: FormImage) {
  return img.kind === "saved" ? img.image.url : img.url;
}

function swapAt<T>(arr: T[], i: number, j: number): T[] {
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function ProductImageUploader({ images, disabled, onAdd, onRemove, onReorder }: {
  images: FormImage[];
  disabled?: boolean;
  onAdd: (img: FormImage) => void;
  onRemove: (id: string) => void;
  onReorder: (reordered: FormImage[]) => void;
}) {
  const common = useT("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { upload, progress } = useImageUpload("products");
  const uploading = progress !== null;

  async function handleFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    const { accepted, unsupportedCount, tooLargeCount } = partitionUploadFiles(selected);
    if (unsupportedCount > 0) notify.error(common("feedback.unsupported_file"));
    if (tooLargeCount > 0) notify.error(common("feedback.file_too_large"));
    if (!accepted.length) return;
    try {
      for (const file of accepted) {
        const { key, url } = await upload(file);
        onAdd({ kind: "new", clientId: crypto.randomUUID(), key, url });
      }
      notify.success(common("feedback.uploaded"));
    } catch (cause) {
      notify.error(common(`feedback.${uploadFailure(cause)}`));
    }
  }

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    void handleFiles(event.dataTransfer.files);
  }, [disabled]);

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    onReorder(swapAt(images, index, target));
  }

  return <div className="space-y-4">
    {images.length > 0 && <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
      {images.map((img, index) => <div key={formImageId(img)} className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
        <img src={formImageSrc(img)} alt="" className="size-full object-cover" />
        <span className="absolute start-1.5 top-1.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-semibold text-white">{index + 1}</span>
        {img.kind === "new" && <span className="absolute end-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">{common("new_badge")}</span>}
        <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          {index > 0 && <button type="button" disabled={disabled} onClick={() => moveImage(index, -1)} className="absolute start-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white hover:bg-white/40 disabled:opacity-30" aria-label={common("image.move_earlier")}><ChevronLeft size={16} /></button>}
          {index < images.length - 1 && <button type="button" disabled={disabled} onClick={() => moveImage(index, 1)} className="absolute end-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white hover:bg-white/40 disabled:opacity-30" aria-label={common("image.move_later")}><ChevronRight size={16} /></button>}
          <button type="button" disabled={disabled} onClick={() => onRemove(formImageId(img))} className="absolute bottom-1.5 end-1.5 grid size-7 place-items-center rounded-full bg-destructive text-white hover:bg-destructive/80 disabled:opacity-50" aria-label={common("image.remove")}><X size={14} /></button>
        </div>
      </div>)}
    </div>}
    <div
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-all ${dragging ? "scale-[1.01] border-primary bg-primary/5" : "border-border/50 hover:border-primary/50 hover:bg-muted/30"} ${disabled || uploading ? "pointer-events-none cursor-not-allowed opacity-50" : ""}`}
    >
      {uploading ? <Loader2 size={32} className="animate-spin text-primary" /> : <span className="grid size-12 place-items-center rounded-xl bg-primary/10"><UploadCloud size={24} className="text-primary" /></span>}
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">{uploading ? common("image.uploading") : dragging ? common("image.drop_images") : common("image.pick_images")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{common("image.formats", { mb: MAX_UPLOAD_MB })}</p>
      </div>
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} multiple className="hidden" onChange={(event) => event.currentTarget.files && void handleFiles(event.currentTarget.files)} disabled={disabled || uploading} />
    </div>
  </div>;
}
