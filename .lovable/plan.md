## Problem

When an assistant reply contains more than one numbered list (e.g. a recap or summary numbered list near the top, followed by the real question with its own short numbered choices near the end), the quick-reply buttons under the message are derived from the FIRST/longest numbered list — i.e. items from the beginning of the message — instead of the actual question the assistant just asked at the bottom.

## Root cause

In `src/features/project/AssistantSection.tsx` the prose-fallback `synthesizeOptionsFromProse` (around lines 1524–1589) scans the whole message and keeps the **longest** contiguous numbered run as `bestRun`:

```
if (!bestRun || run.length > bestRun.items.length) {
  bestRun = { startIdx, items: run };
}
```

So if an early recap like "1. Title locked  2. Genre locked  3. Setting locked  4. Year locked" appears before the real "1) Option A  2) Option B  3) Option C" gate at the end, the longer earlier list wins and its items become the buttons.

The metadata-options self-heal path (~lines 1029–1039) has the same blind spot in reverse: it only checks "do any option labels appear *somewhere* in the prose?" — a stale option label that happens to also appear in the recap section will pass the check.

## Fix

In `src/features/project/AssistantSection.tsx`:

1. **Prefer the LAST numbered run, not the longest.** In `synthesizeOptionsFromProse`, change the selection rule so the run closest to the end of the message wins (a question gate is almost always the closing element). Keep the existing 2–6 item bound and per-item length cap. This single change fixes the reported "buttons coming from the beginning of the message" symptom.

2. **Tighten the metadata-options validator.** In the `metaOptions` IIFE (~lines 1029–1039), instead of accepting metadata when *any* option label appears anywhere in the prose, require that the labels match items inside the LAST numbered run (using the same scanning logic as the synth). If they don't, drop the metadata and let the synth derive the right buttons from the closing list. This stops a stale `propose_options` from "passing" because its labels happen to match an early recap.

3. **Refactor the scanning helper.** Extract the numbered-run scanner into a small shared helper (`findNumberedRuns(text): Array<{ startIdx, items }>`) used by both `synthesizeOptionsFromProse` and the metaOptions validator, so the two stay in sync. No behavior changes outside what's described in (1) and (2).

## Out of scope

- No changes to `useAssistantRun.ts`, the live "Starting…" bubble, or the edge function.
- No changes to the server-side `propose_options` validation prompt rules.
- No DB or schema changes.

## Files to change

- `src/features/project/AssistantSection.tsx` — update `synthesizeOptionsFromProse` selection rule, tighten `metaOptions` validation, extract a small scanner helper.
