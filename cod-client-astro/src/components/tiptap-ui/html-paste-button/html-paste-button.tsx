import * as React from "react"
import type { Editor } from "@tiptap/react"

// --- Tiptap UI ---
import { Button as TiptapButton } from "@/components/tiptap-ui-primitive/button"

// --- Icons ---
import { Code2Icon } from "@/components/tiptap-icons/code2-icon"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- UI ---
import { Button, Dialog, Textarea } from "@/components/ui"
import { useT } from "@/i18n/react"

// --- Lib ---
import { cleanPastedHtml } from "@/components/tiptap-ui/html-paste-button/clean-pasted-html"

export interface HtmlPasteButtonProps {
  editor?: Editor | null
}

/**
 * Opens a box for HTML source and inserts it as formatted content.
 *
 * The editor keeps pasted markup source as literal text, which is what a
 * merchant who copied a description from a supplier page or an AI chat sees.
 * Parsing it here turns that source into the same nodes the toolbar writes, so
 * it renders instead of showing tags. The stored description is still
 * sanitised by the server before it is saved.
 */
export function HtmlPasteButton({ editor: providedEditor }: HtmlPasteButtonProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const t = useT("products")
  const common = useT("common")
  const [open, setOpen] = React.useState(false)
  const [html, setHtml] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  if (!editor) return null

  const cleaned = cleanPastedHtml(html)
  const ready = cleaned.length > 0

  const close = () => {
    setOpen(false)
    setHtml("")
  }

  const apply = (mode: "insert" | "replace") => {
    if (!ready) return
    const applied =
      mode === "replace"
        ? editor.chain().focus().setContent(cleaned, { emitUpdate: true }).run()
        : editor.chain().focus().insertContent(cleaned).run()
    if (applied) close()
  }

  return (
    <>
      <TiptapButton
        type="button"
        data-style="ghost"
        role="button"
        tabIndex={-1}
        disabled={!editor.isEditable}
        aria-label={t("toolbar.paste_html")}
        tooltip={t("toolbar.paste_html")}
        onClick={() => setOpen(true)}
      >
        <Code2Icon className="tiptap-button-icon" />
      </TiptapButton>

      <Dialog
        open={open}
        onClose={close}
        icon={<Code2Icon className="size-4" />}
        title={t("toolbar.paste_html_title")}
        description={t("toolbar.paste_html_description")}
        initialFocusRef={textareaRef}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              {common("cancel")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => apply("replace")}
              disabled={!ready}
            >
              {t("toolbar.paste_html_replace")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => apply("insert")}
              disabled={!ready}
            >
              {t("toolbar.paste_html_insert")}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            value={html}
            onChange={(event) => setHtml(event.currentTarget.value)}
            placeholder={t("toolbar.paste_html_placeholder")}
            dir="ltr"
            spellCheck={false}
            rows={12}
            className="min-h-56 resize-y font-mono text-xs leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">{t("toolbar.paste_html_kept")}</p>
        </div>
      </Dialog>
    </>
  )
}
