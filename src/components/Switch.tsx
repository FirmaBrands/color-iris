import { cn } from "../lib/cn";

/**
 * Small animated on/off toggle (visual only — wrap it in a button/label that
 * owns the click). Used everywhere a boolean is toggled so the enable
 * metaphor is consistent across the app.
 */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-block w-7 h-4 rounded-full transition-colors shrink-0",
        on ? "bg-indigo-600" : "bg-neutral-300",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all",
          on ? "left-3.5" : "left-0.5",
        )}
      />
    </span>
  );
}
