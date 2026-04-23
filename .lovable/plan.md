

## Why the assistant isn't always showing quick-reply buttons

I traced your screenshot (5 Hebrew title options, no buttons under them) end-to-end. There are **three independent reasons** buttons go missing, and your Hebrew-titles message hits all of them. Here's the fix.

### Root causes

**1. Model forgot to call `propose_options`.**
The system prompt tells the model that whenever it writes a numbered 2–6-item choice list, it MUST also call the `propose_options` tool so the UI can render buttons. Some models (especially Claude variants and the Gemini 3 previews you've been testing) skip the tool call about half the time and just write the prose.

**2. The server-side prose synthesizer (safety net #1) only scans the LAST paragraph.**
We have a fallback in `assistant-chat/index.ts → synthesizeOptionsFromProse` that parses prose and creates buttons when the model forgot the tool. But the gate is too narrow — it splits the message on blank lines and only looks at the **last block**. Your titles message structure is:

```
Phase 1 step is: Hebrew title options based on this setup.

Here are 5 premium title options in Hebrew:

1) **מבחן סופי**
2) **אב‑טיפוס**
3) **דליפה בהרצליה**
4) **קו הגנה שבור**
5) **שעת החשיפה**

Pick one, or tell me to keep **final test** as the working title.
```

The numbered list sits in the **middle**; the last block is the "Pick one…" line. The synthesizer scans only that last block, finds zero numbered items, returns null → no buttons.

**3. The client-side synthesizer (safety net #2) has the SAME bug.**
`AssistantSection.tsx → synthesizeOptionsFromProse` is a mirror of the server function with the same "last block only" limitation, so it can't recover either.

### The fix

**A. Make both synthesizers smarter (catches ~all current misses)**

Replace the "scan last block only" rule with: scan the **entire message** for a contiguous run of numbered items (1, 2, 3, …) that:
- starts with `1.` or `1)`,
- has 2–6 sequential items,
- each item ≤ 120 chars,
- is preceded by a question-y line (or the whole message has a question marker / Hebrew "בחר/איזה/לאשר" verb).

Pull the question line from the line directly **above** the first numbered item (currently it's pulled from before the list inside the same block — same logic, just relative to the list's actual location).

This recovers your titles message, the "approve/revise/restart" prompts, the doc-mode question, and any other "intro paragraph + numbered list + closing nudge" pattern.

**B. Tighten the system prompt**

In `assistant-chat/index.ts` (and the `_shared/assistant-playbook.ts` mirror), add ONE more hard-rule line right next to the existing "TOOL-CALL-BEFORE-PROSE RULE 2":

> *Whenever your message includes any numbered list of 2–6 short choices — anywhere in the message, not just the last paragraph — you MUST also call `propose_options` in the same turn. The "I forgot" failure mode is the #1 cause of broken UX. If in doubt, call it.*

And add an explicit examples block right under the rule showing the title-options pattern as a positive example.

**C. Diagnostic surface (optional but worth it)**

Add a tiny dev-only console hint in `MessageBubble`: when an assistant message is the latest, has no `metadata.options`, and the synthesizer also returns null even though it contains a numbered list, log `"[assistant] missed quick-reply: <model> – <reason>"`. This makes it obvious in console which model (Claude vs Gemini vs OpenAI) is the worst offender so we can iterate on the prompt for that family specifically.

### Why the buttons sometimes work and sometimes don't (the pattern you're seeing)

| Message shape | Tool called? | Synth catches? | Buttons? |
|---|:-:|:-:|:-:|
| List in last paragraph, no closing line | Often | ✅ | ✅ |
| List in middle + closing line ("Pick one…") | Often skipped | ❌ (today) → ✅ (after fix) | ❌ today |
| Long list (>6) | Skipped (correct) | ❌ (correct) | ❌ (intentional) |
| Open-ended question | Skipped (correct) | ❌ (correct) | ❌ (intentional) |
| Yes/no after "approve / revise / restart" prose | Sometimes skipped | ✅ if last block, else ❌ | Inconsistent today |

After the fix, only rows 3 and 4 stay button-less, which is the correct behavior.

### Files touched

- `supabase/functions/assistant-chat/index.ts` — rewrite `synthesizeOptionsFromProse` to scan the whole message (not last block); add the new hard-rule line + positive example to the system prompt.
- `src/features/project/AssistantSection.tsx` — mirror the same scanning rewrite in the client-side `synthesizeOptionsFromProse`; add the dev-only diagnostic log.
- `src/lib/assistant-playbook.ts` and `supabase/functions/_shared/assistant-playbook.ts` — if the rule lives in a shared playbook fragment, mirror the wording change there too.

### Out of scope

- Forcing buttons for >6-item lists (intentionally excluded — too cramped).
- Per-model prompt-tuning beyond the one new hard-rule line — happy to do per-model overrides if the diagnostic logging shows one provider is still missing after this fix.
- The earlier "21 nodes failed" canvas tool-call investigation — still open, separate work.

