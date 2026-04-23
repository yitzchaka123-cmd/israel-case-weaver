

## Make user vs assistant messages visually distinct

Right now both your messages and the assistant's replies render the same way: small left-aligned avatar, same text width, no background, only a tiny "You" / "Assistant" label above. That's why it feels flat. Here are **three options** — pick one (or mix) and I'll wire it up.

### Option A — Classic chat bubbles (recommended, most familiar)

What it looks like:
- **Your messages**: right-aligned, sit in a soft accent-colored bubble (`bg-accent/10`, rounded-2xl, max-width ~80%), avatar on the right.
- **Assistant messages**: left-aligned, sit in a neutral surface bubble (`bg-surface` with subtle border), full width for long-form content, avatar on the left.
- Tool receipts and quick-reply chips stay below the assistant bubble exactly like today.
- Works great on mobile.

```text
                                    ┌──────────────────┐
                                    │ Your prompt here │ 👤
                                    └──────────────────┘
🤖 ┌────────────────────────────────────────────────┐
   │ Assistant reply, longer-form, full width       │
   │ ✓ 2 actions performed                          │
   └────────────────────────────────────────────────┘
```

### Option B — Side-band markers (minimal, doc-like)

What it looks like:
- Both messages stay left-aligned and full-width (good for reading long replies).
- **Your messages** get a thick **accent-colored left border** (4px) + slightly indented + lighter background tint.
- **Assistant messages** get no border, plain background, the existing avatar.
- The "You" / "Assistant" label is upgraded to a bolder pill: **`YOU`** in accent, **`ASSISTANT`** in muted.
- Closest to today's layout — least visual disruption, just clearer separation.

### Option C — Two-column transcript (power-user)

What it looks like:
- Your message and the assistant's reply that *immediately follows it* render as a **paired card**: thin "Q:" header at the top with your prompt, then a divider, then "A:" with the assistant's response and tool receipts.
- Each turn is one self-contained card with a subtle border.
- Best when you want to scan "what did I ask → what did it do" at a glance and review long sessions. Slightly more work than A/B and changes the mental model.

### Other touches included in any option

- **Timestamp on hover** at the right edge of each message (relative: "2m ago", absolute on hover).
- **Copy-to-clipboard** button that appears on hover for assistant replies.
- **Better empty-state contrast** — keep the existing welcome card.
- Highlight ring (when you click an origin badge) keeps working in all three.

### Files touched

| File | Change |
|---|---|
| `src/features/project/AssistantSection.tsx` | Rework `MessageBubble` layout for the chosen option, add hover timestamp + copy button. No edge-function changes. |

**Pick A, B, or C** (and say if you want the timestamp + copy additions or not), and I'll implement it.

