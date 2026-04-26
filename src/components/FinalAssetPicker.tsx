// Final-asset selector — Generated image vs. Uploaded file. Disables the option
// whose URL is null. Used by every image surface so exports honor the user's
// explicit choice instead of guessing.
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface Props {
  value: string;
  onChange: (next: string) => void;
  generatedUrl: string | null;
  uploadedUrl: string | null;
  className?: string;
  /** Optional override for the radio labels (e.g. "Generated portrait"). */
  generatedLabel?: string;
  uploadedLabel?: string;
}

export function FinalAssetPicker({
  value,
  onChange,
  generatedUrl,
  uploadedUrl,
  className,
  generatedLabel = "Generated image",
  uploadedLabel = "Uploaded file",
}: Props) {
  // Auto-correct invalid selection if the chosen source got cleared.
  const safeValue = (() => {
    if (value === "uploaded" && !uploadedUrl) return "generated";
    if (value === "generated" && !generatedUrl && uploadedUrl) return "uploaded";
    return value || "generated";
  })();

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
        Final asset for export
      </Label>
      <RadioGroup
        value={safeValue}
        onValueChange={onChange}
        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
      >
        <Option value="generated" label={generatedLabel} disabled={!generatedUrl} current={safeValue} />
        <Option value="uploaded" label={uploadedLabel} disabled={!uploadedUrl} current={safeValue} />
      </RadioGroup>
    </div>
  );
}

function Option({ value, label, disabled, current }: { value: string; label: string; disabled: boolean; current: string }) {
  return (
    <label
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : current === value
            ? "border-accent bg-accent/5 cursor-pointer"
            : "hover:bg-muted/50 cursor-pointer"
      }`}
    >
      <RadioGroupItem value={value} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}
