

## Two assistant fixes: stale option buttons + invisible edit button

### Issue 1 — Buttons under the message don't match the message

**Root cause (confirmed in the DB):** the model wrote prose asking *"Pick the setting: Haifa / Tel Aviv / Jerusalem / Be'er Sheva / Ashdod"* but the `propose_options` tool call it made in the same turn carried the **previous turn's** arguments (`Late 1980s / 1990s / …`). Looking at row `19187ff4` in `chat_messages`:

- `content`: cities list (Haifa…Ashdod)
- `metadata.options`: year/era buttons (Late 1980s…Present day)

The current model (`openai-5.4` per the screenshot) copied the previous `propose_options` call from conversation context instead of rewriting it for the new question. The system prompt warns about forgetting the call entirely but does NOT warn about reusing stale arguments.

**Fix — three layers (defense in depth):**

**A. Server-side validation in `executeTool` (`supabase/functions/assistant-chat/index.ts`, the `propose_options` branch around line 843).** When the model returns from a tool round, run a lightweight **prose↔options consistency check** before attaching options to the final message:
- Take `finalText` (the prose the model is about to send).
- Take `cleaned.options[].label`.
- If the prose contains a numbered list (`/^\s*\d+[\.\)]\s+(.+)$/m`) AND none of the option labels appear (case-insensitively, fuzzy contains) in any of the listed prose items → **reject** the options as stale, log a warning, and fall through to the prose synthesizer (`synthesizeOptionsFromProse(finalText)`) to derive the correct buttons from the actual prose. The synthesizer was already strengthened last turn to scan the whole message — it'll pick up `1. Haifa industrial zone …` correctly.
- This applies right where `quickOptions` is selected (lines 1279-1288 and the mirror at 1579-1582).

**B. Tightened system-prompt rule.** Add one explicit hard-rule line right under the existing `TOOL-CALL-BEFORE-PROSE RULE 2`:

> *Every `propose_options` call must carry the EXACT options from THIS turn's prose. Do NOT copy a previous turn's `propose_options` arguments. The labels you pass in `options[].label` must match (substring-match) the items you just wrote in the numbered list above. Stale-option reuse is the #2 cause of broken UX after forgetting the tool entirely.*

Plus one negative-example block: shows the bad pattern (cities prose + year-era options) labelled "WRONG — never do this".

**C. Client-side guard in `MessageBubble` (`src/features/project/AssistantSection.tsx` ~line 513).** Even with A+B in place, every existing message in the user's history (like row `19187ff4`) is still poisoned in the DB. So before trusting `metaOptions`, run the same consistency check on the client:
- If `metaOptions.length > 0` AND the message body contains a numbered list AND none of the option labels match any list item → **discard** `metaOptions`, fall through to `synthesizeOptionsFromProse(msg.content)`. Result: stale rows self-heal on render without a migration.

### Issue 2 — Edit button is only visible when the assistant is thinking, and unclickable

**Root cause (`AssistantSection.tsx` lines 593-603):** the Edit button has `opacity-0 group-hover:opacity-100 … disabled:opacity-30 disabled:cursor-not-allowed`. Tailwind's `disabled:` variant wins over `opacity-0`, so:
- Assistant idle → button is `opacity-0` (invisible) until you happen to hover over the message header.
- Assistant thinking → `disabled` flag flips on → `disabled:opacity-30` makes the button visible at 30% but unclickable.

That's exactly the behaviour the user described.

**Fix:**
1. **Always show Edit at low opacity, brighten on hover.** Replace `opacity-0 group-hover:opacity-100` with `opacity-40 group-hover:opacity-100`. Same treatment for the Copy button on assistant messages (line 614-623), so users actually discover them.
2. **Allow editing while the assistant is thinking.** When the user clicks Edit on an in-flight turn, `editAndResend` should:
   - First call the existing `assistant_runs` cancel path — abort the local `AbortController` (already in `RunState.controller` in `useAssistantRun.ts`) and mark the in-flight run as superseded so the realtime spinner clears,
   - Then proceed with the existing delete-tail + resend logic.
3. New helper `cancel()` exported from `useAssistantRun` that aborts the controller and sets `isRunning=false` locally (the next turn the user kicks off via Edit will re-flip it). Server-side cleanup happens naturally because the orphaned background task will still write its result; we just need to delete that result too — which `editAndResend`'s existing `delete().in("id", toDelete)` already does for any messages added after the edit point.
4. Tooltip update: when sending, change the title from "Edit and re-run" to "Cancel current reply and edit this message", so the user understands what clicking does.

### Files touched

- `supabase/functions/assistant-chat/index.ts` — add prose↔options consistency check before attaching `quickOptions`; tighten system prompt with stale-args rule + negative example. Deploy.
- `src/features/project/AssistantSection.tsx` — mirror the consistency check in `MessageBubble` (self-heal stale DB rows); change Edit/Copy button opacity from `0`→`40`; route Edit-while-sending through new `cancel()` then `send()`.
- `src/features/project/assistant/useAssistantRun.ts` — export `cancel()` that aborts the local `AbortController` and clears `isRunning`.

### Out of scope

- Backfill migration to clean stale `metadata.options` in old chat rows — the client-side self-heal makes this unnecessary.
- A "Stop generating" composer button (separate UX request).
- Per-model prompt overrides — the new hard-rule should be enough; we can revisit if the dev-only diagnostic log added last turn shows specific models still slipping through.

