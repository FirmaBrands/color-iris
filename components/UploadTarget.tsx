import { useRef, useState } from "react";
import { cn } from "../lib/cn";

export function readSvgFile(file: File | undefined, onText: (text: string) => void) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") onText(reader.result);
  };
  reader.readAsText(file);
}

/** Click-or-drop SVG upload wrapper around arbitrary content. */
export function UploadTarget({
  onLoad,
  title,
  className,
  children,
}: {
  onLoad: (svgText: string) => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        readSvgFile(e.dataTransfer?.files?.[0], onLoad);
      }}
      className={cn(className, isDragOver && "ring-2 ring-indigo-500 ring-offset-1")}
      title={title}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          readSvgFile(e.target.files?.[0], onLoad);
          e.target.value = "";
        }}
      />
      {children}
    </div>
  );
}
