import { useRef, useState } from "react";
import { Loader2, RefreshCw, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui";
import { IMAGE_ACCEPT, MAX_UPLOAD_MB, partitionUploadFiles, uploadFailure, type MediaImage } from "@/features/uploads/api";
import { useImageUpload } from "@/features/uploads/useImageUpload";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";

/** How the chosen image is previewed: a category's banner, a link's share card, or a logo shown whole. */
export type ImageUploaderShape = "landscape" | "share" | "logo";

const PREVIEW: Record<ImageUploaderShape, { zone: string; frame: string; image: string }> = {
  landscape: { zone: "py-12", frame: "aspect-video max-w-md", image: "size-full object-cover" },
  share: { zone: "max-w-md py-10", frame: "aspect-[1200/630] max-w-md", image: "size-full object-cover" },
  logo: { zone: "max-w-xs py-6", frame: "h-28 max-w-xs p-4", image: "size-full object-contain" },
};

/** One image, uploaded to the store's media: a drop zone while empty, then the image with Replace and Remove. */
export function ImageUploader({
  value,
  onChange,
  alt,
  shape = "landscape",
  disabled,
}: {
  value: MediaImage | null;
  onChange: (image: MediaImage | null) => void;
  alt: string;
  shape?: ImageUploaderShape;
  disabled?: boolean;
}) {
  const common = useT("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { upload, progress } = useImageUpload("products");
  const uploading = progress !== null;
  const locked = disabled || uploading;
  const preview = PREVIEW[shape];

  async function handleFile(file: File) {
    const { accepted, unsupportedCount, tooLargeCount } = partitionUploadFiles([file]);
    if (unsupportedCount > 0) {
      notify.error(common("feedback.unsupported_file"));
      return;
    }
    if (tooLargeCount > 0) {
      notify.error(common("feedback.file_too_large"));
      return;
    }
    try {
      onChange(await upload(accepted[0]));
      notify.success(common("feedback.uploaded"));
    } catch (cause) {
      notify.error(common(`feedback.${uploadFailure(cause)}`));
    }
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={IMAGE_ACCEPT}
      className="hidden"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void handleFile(file);
      }}
      disabled={locked}
    />
  );

  if (value) {
    return (
      <div className="space-y-3">
        <div className={`overflow-hidden rounded-xl border border-border bg-muted ${preview.frame}`}>
          <img src={value.url} alt={alt} className={preview.image} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={locked} onClick={() => inputRef.current?.click()}>
            {uploading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
            {uploading ? common("image.uploading") : common("image.replace")}
          </Button>
          <Button type="button" variant="dangerOutline" size="sm" disabled={locked} onClick={() => onChange(null)}>
            <X size={14} aria-hidden="true" />
            {common("image.remove")}
          </Button>
        </div>
        {input}
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (locked) return;
        const file = event.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
      onClick={() => !locked && inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 transition-all ${preview.zone} ${dragging ? "scale-[1.01] border-primary bg-primary/5" : "border-border/50 hover:border-primary/50 hover:bg-muted/30"} ${locked ? "pointer-events-none cursor-not-allowed opacity-50" : ""}`}
    >
      {uploading ? (
        <Loader2 size={40} className="animate-spin text-primary" />
      ) : (
        <span className="grid size-14 place-items-center rounded-xl bg-primary/10">
          <UploadCloud size={28} className="text-primary" />
        </span>
      )}
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">
          {uploading ? common("image.uploading") : dragging ? common("image.drop_image") : common("image.pick_image")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{common("image.formats", { mb: MAX_UPLOAD_MB })}</p>
      </div>
      {input}
    </div>
  );
}
