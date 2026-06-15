import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Centered modal dialog with a scrim. Esc and a backdrop click close it.
 * Used for confirmations and the PDF preview so the app never falls back to
 * jarring native browser dialogs.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[400] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          "bg-white rounded-xl shadow-2xl border border-neutral-200 flex flex-col max-h-[90vh] w-full",
          wide ? "max-w-[920px]" : "max-w-[420px]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 shrink-0 border-b border-neutral-200 flex items-center justify-between pl-5 pr-3">
          <span className="text-[12px] font-black uppercase tracking-[0.16em]">{title}</span>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-md text-neutral-500 hover:text-black hover:bg-neutral-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-neutral-200 px-5 py-3 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
