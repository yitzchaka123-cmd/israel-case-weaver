import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadAsset, slugify, cn } from "@/lib/utils";

interface DownloadButtonProps {
  url?: string | null;
  filename?: string;
  /** A title used to derive a filename when `filename` isn't provided */
  title?: string;
  className?: string;
  size?: "icon" | "sm";
  variant?: "ghost" | "secondary" | "outline";
  label?: string;
}

/**
 * Tiny shared download button. Hidden when there is no URL.
 */
export function DownloadButton({
  url,
  filename,
  title,
  className,
  size = "icon",
  variant = "secondary",
  label,
}: DownloadButtonProps) {
  if (!url) return null;
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const name = filename || (title ? `${slugify(title)}` : undefined);
    void downloadAsset(url, name);
  };
  if (size === "sm") {
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        className={cn("gap-1.5", className)}
        onClick={onClick}
        title="Download"
      >
        <Download className="h-3.5 w-3.5" />
        {label ?? "Download"}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="icon"
      variant={variant}
      className={cn("h-7 w-7", className)}
      onClick={onClick}
      title="Download"
      aria-label="Download"
    >
      <Download className="h-3.5 w-3.5" />
    </Button>
  );
}
