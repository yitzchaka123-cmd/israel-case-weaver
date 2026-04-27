import { Handle, Position, type NodeProps } from "reactflow";
import {
  Search,
  User,
  Brain,
  AlertOctagon,
  Flame,
  Mail,
  FileText,
  Trophy,
  StickyNote,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { AssistantOriginBadge } from "@/components/AssistantOriginBadge";

export type CanvasNodeType =
  | "clue"
  | "suspect"
  | "deduction"
  | "contradiction"
  | "red_herring"
  | "envelope"
  | "document"
  | "solution"
  | "hint"
  | "note";

type Meta = {
  label: string;
  icon: LucideIcon;
  // Soft fill, strong border, accent text — derived from the node's color (HSL/oklch).
  // We use color-mix to keep theming consistent with semantic tokens.
  accent: string; // base color (oklch)
};

export const NODE_META: Record<CanvasNodeType, Meta> = {
  clue:          { label: "Clue",          icon: Search,        accent: "oklch(0.68 0.15 155)" },
  suspect:       { label: "Suspect",       icon: User,          accent: "oklch(0.62 0.20 30)"  },
  deduction:     { label: "Deduction",     icon: Brain,         accent: "oklch(0.65 0.18 285)" },
  contradiction: { label: "Contradiction", icon: AlertOctagon,  accent: "oklch(0.58 0.22 27)"  },
  red_herring:   { label: "Red Herring",   icon: Flame,         accent: "oklch(0.78 0.16 75)"  },
  envelope:      { label: "Envelope",      icon: Mail,          accent: "oklch(0.55 0.18 220)" },
  document:      { label: "Document",      icon: FileText,      accent: "oklch(0.50 0.05 260)" },
  solution:      { label: "Solution",      icon: Trophy,        accent: "oklch(0.45 0.15 285)" },
  hint:          { label: "Hint",          icon: Lightbulb,     accent: "oklch(0.78 0.16 75)"  },
  note:          { label: "Note",          icon: StickyNote,    accent: "oklch(0.70 0.02 260)" },
};

export function getNodeMeta(type?: string | null): Meta {
  const t = (type ?? "note") as CanvasNodeType;
  return NODE_META[t] ?? NODE_META.note;
}

export type CaseNodeData = {
  label: string;
  type?: string;
  color?: string | null;
  description?: string | null;
  createdByMessageId?: string | null;
  generationStatus?: string | null;
  envelopeNumber?: number;
  docType?: string;
  docNumber?: number;
  purpose?: string;
  linkedLogicTitles?: string[];
};

// Color buckets for the per-node status pill on the Final Flow board.
// Two strong signals the user reads at a glance:
//   • BLUE  = the document has been generated but not yet approved
//   • GREEN = the document has been approved (status === "final")
const BLUE  = { bg: "color-mix(in oklab, oklch(0.70 0.14 235) 26%, transparent)", fg: "oklch(0.40 0.16 235)" };
const GREEN = { bg: "color-mix(in oklab, oklch(0.62 0.18 155) 30%, transparent)", fg: "oklch(0.32 0.16 155)" };

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  ungenerated: { label: "Ungenerated", bg: "color-mix(in oklab, var(--color-muted) 70%, transparent)", fg: "var(--color-muted-foreground)" },
  "draft row created": { label: "Draft row", bg: "color-mix(in oklab, oklch(0.75 0.12 75) 22%, transparent)", fg: "oklch(0.45 0.15 75)" },
  // All "generated, awaiting approval" variants render BLUE.
  generated:         { label: "Generated", ...BLUE },
  "image generated": { label: "Image ready", ...BLUE },
  "file generated":  { label: "File ready",  ...BLUE },
  // All "approved / final" variants render GREEN.
  approved:  { label: "Approved",  ...GREEN },
  finalized: { label: "Finalized", ...GREEN },
};

function statusStyleFor(status?: string | null) {
  if (!status) return STATUS_STYLE.ungenerated;
  return STATUS_STYLE[status] ?? { label: status, bg: "color-mix(in oklab, var(--color-muted) 70%, transparent)", fg: "var(--color-muted-foreground)" };
}

/**
 * Custom React Flow node — colored header strip + icon + title.
 * Designed to read at a glance even at low zoom. Each node type has its own
 * icon and accent so the board feels like a proper detective wall.
 */
export function CaseNode({ data, selected }: NodeProps<CaseNodeData>) {
  const meta = getNodeMeta(data.type);
  const accent = data.color || meta.accent;
  const Icon = meta.icon;
  const isEnvelope = data.type === "envelope";
  const isSolution = data.type === "solution";
  const isDocument = data.type === "document";
  const envelopeNumber = data.envelopeNumber;

  return (
    <div
      className="group relative rounded-xl overflow-hidden bg-card text-card-foreground transition-all"
      style={{
        minWidth: isDocument ? 240 : isEnvelope ? 240 : 200,
        maxWidth: isDocument ? 280 : isEnvelope ? 280 : 240,
        border: `1.5px solid ${selected ? accent : "var(--color-border)"}`,
        boxShadow: selected
          ? `0 0 0 3px color-mix(in oklab, ${accent} 25%, transparent), 0 10px 24px -10px color-mix(in oklab, ${accent} 35%, transparent)`
          : "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px -6px rgba(0,0,0,0.08)",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: accent,
          border: "2px solid var(--color-card)",
          width: 10,
          height: 10,
        }}
      />

      {/* Colored header strip */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{
          background: `color-mix(in oklab, ${accent} 14%, var(--color-card))`,
          borderBottom: `1px solid color-mix(in oklab, ${accent} 30%, transparent)`,
        }}
      >
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-md shrink-0"
          style={{
            background: accent,
            color: "white",
            boxShadow: `0 1px 2px color-mix(in oklab, ${accent} 50%, transparent)`,
          }}
        >
          <Icon className="h-3 w-3" strokeWidth={2.5} />
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider truncate flex-1"
          style={{ color: `color-mix(in oklab, ${accent} 75%, var(--color-foreground))` }}
        >
          {isEnvelope && typeof envelopeNumber === "number"
            ? `Envelope #${envelopeNumber}`
            : isDocument && typeof data.docNumber === "number"
              ? `Doc #${data.docNumber}${data.docType ? ` · ${data.docType}` : ""}`
              : meta.label}
        </span>
        {data.createdByMessageId && (
          <AssistantOriginBadge messageId={data.createdByMessageId} label="" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2.5">
        <div className="text-[13px] font-medium leading-snug text-foreground line-clamp-3">
          {data.label || "(untitled)"}
        </div>

        {isDocument ? (
          <>
            {data.docType && (
              <div className="mt-1.5">
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    background: `color-mix(in oklab, ${accent} 18%, var(--color-card))`,
                    color: `color-mix(in oklab, ${accent} 70%, var(--color-foreground))`,
                    border: `1px solid color-mix(in oklab, ${accent} 30%, transparent)`,
                  }}
                >
                  {data.docType}
                </span>
              </div>
            )}
            {data.purpose && (
              <div className="mt-1.5 text-[11px] text-muted-foreground leading-snug line-clamp-3">
                {data.purpose}
              </div>
            )}
            {data.linkedLogicTitles && data.linkedLogicTitles.length > 0 && (
              <div className="mt-1.5 text-[10px] text-muted-foreground/90 leading-snug">
                <span className="font-semibold uppercase tracking-wider">Logic:</span>{" "}
                <span className="line-clamp-2">{data.linkedLogicTitles.join(" · ")}</span>
              </div>
            )}
            <div className="mt-2">
              {(() => {
                const s = statusStyleFor(data.generationStatus);
                return (
                  <span
                    className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: s.bg, color: s.fg }}
                  >
                    {s.label}
                  </span>
                );
              })()}
            </div>
          </>
        ) : (
          data.description && !isEnvelope && (
            <div
              className={`mt-1.5 text-[11px] text-muted-foreground leading-snug whitespace-pre-line ${
                isSolution ? "line-clamp-6" : "line-clamp-2"
              }`}
            >
              {data.description}
            </div>
          )
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: accent,
          border: "2px solid var(--color-card)",
          width: 10,
          height: 10,
        }}
      />
    </div>
  );
}

export const nodeTypes = { case: CaseNode };
