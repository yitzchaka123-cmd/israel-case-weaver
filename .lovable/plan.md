## Problem

The **"Approve logic"** button currently shows whenever a `solution_summary` exists and `logic_approved_at` is null — it does **not** check whether the Logic Flow board actually has any nodes. That means the button appears even when there is literally nothing to approve (empty canvas), which is logically wrong and lets the user "approve" an empty graph.

This shows up in two places:
1. **`src/features/project/CanvasSection.tsx`** (line ~757) — the prominent "Approve logic" button on the Canvas toolbar.
2. **`src/features/project/AssistantSection.tsx`** (line ~540) — the inline approval banner above the chat composer.

## Fix

Add a "node count > 0 on the **logic** board" guard to both buttons. Approval requires:
- `solution_summary` is non-empty, **AND**
- `logic_approved_at` is null (not already approved), **AND**
- The logic board has at least one canvas node.

### 1. `src/features/project/CanvasSection.tsx`

The component already loads `nodes` for the currently selected board. The Approve block at line 757 sits inside `board === "logic"` so `nodes.length` here is the count on the logic board. Change the condition from:

```tsx
{project?.solution_summary?.trim() && !approved && (
  <Button ...>Approve logic</Button>
)}
```

to:

```tsx
{project?.solution_summary?.trim() && !approved && nodes.length > 0 && (
  <Button ...>Approve logic</Button>
)}
```

The existing truthful state badges (lines 680–724) already cover the "summary saved, no flow yet" case with the warning chip "Summary saved — generate logic flow", so the user still sees clear next-step guidance — they just won't see a misleading Approve button.

### 2. `src/features/project/AssistantSection.tsx`

The assistant-side banner has no node-count signal in scope. Add a lightweight query so the banner can hide itself when the logic board is empty:

```tsx
const { data: logicNodeCount } = useQuery({
  queryKey: ["logic-node-count", projectId],
  queryFn: async () => {
    const { count } = await supabase
      .from("canvas_nodes")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("board", "logic");
    return count ?? 0;
  },
  enabled: !!projectId,
  refetchInterval: 15000,
  refetchOnWindowFocus: true,
});
```

Then gate the banner:

```tsx
{!project?.logic_approved_at
  && project?.solution_summary?.trim()
  && (logicNodeCount ?? 0) > 0 && (
  <div className="...approval banner...">...</div>
)}
```

Also invalidate this query in the existing realtime subscription on `canvas_nodes` patches (already wired for the Case Board badge in `ProjectWorkspace.tsx`; here we just need the local query to refetch on focus / interval, which the config above handles).

### 3. Sanity check — no other stray approve buttons

`rg "Approve logic"` confirms only these two UI sites render an actual approve button. The `assistant-chat` edge function also offers an in-chat approval option via `propose_options`; that path already runs through `set_solution_summary({ mark_approved: true })` which the backend should refuse if the logic board is empty. **Optional hardening (recommended):** in `supabase/functions/assistant-chat/index.ts`, inside the `set_solution_summary` handler, when `mark_approved === true` also verify that at least one logic-board `canvas_nodes` row exists for the project; if not, return a tool error like `"Cannot approve: the Logic Flow board is empty. Generate the logic flow first."` so the assistant can't stamp `logic_approved_at` against an empty graph either.

## Files changed

- `src/features/project/CanvasSection.tsx` — add `&& nodes.length > 0` to the Approve button condition.
- `src/features/project/AssistantSection.tsx` — add `logic-node-count` query and gate the approval banner on it.
- `supabase/functions/assistant-chat/index.ts` — (optional hardening) reject `mark_approved: true` when the logic board is empty.

## What the user will see

- Empty Logic Flow board → **no Approve button** anywhere. Instead, the existing "Summary saved — generate logic flow" chip and the "Generate from solution summary" button stay visible, which is the correct next step.
- Logic board has nodes (drawn from the current summary) but not yet approved → **Approve button shows** in both the Canvas toolbar and the assistant banner, exactly as today.
- Logic board has nodes and is already approved → green "Logic approved" badge, no Approve button (unchanged).
