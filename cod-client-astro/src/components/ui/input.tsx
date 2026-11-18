import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";

export const inputClass =
  "h-8 w-full px-3 pointer-coarse:h-10 rounded-lg border border-input bg-card text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle-foreground hover:border-foreground/45 focus:border-ring focus:shadow-[0_0_0_1px_var(--ring)] disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60";

/** `ref` is an ordinary prop under React 19 — declared so callers can focus it. */
export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input {...props} className={`${inputClass} ${className}`} />;
}

export const textareaClass =
  "min-h-24 w-full resize-y px-3 py-2 rounded-lg border border-input bg-card text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle-foreground hover:border-foreground/45 focus:border-ring focus:shadow-[0_0_0_1px_var(--ring)] disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60";

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea {...props} className={`${textareaClass} ${className}`} />;
}
