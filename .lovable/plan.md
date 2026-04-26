I found the likely reason it still does not feel live: the UI depends on live updates to `chat_messages`, but that table does not appear to be enabled for realtime updates. Also, the backend only flushes actual reasoning after each model call returns, so there is no visible typing during the long first wait.

Plan to bulletproof live thinking:

1. Enable true realtime for assistant chat updates
   - Add `chat_messages` to the realtime publication.
   - Set full row replication for `chat_messages` so the UI reliably receives metadata updates while the assistant is still running.
   - This is the missing piece that should make the existing live placeholder updates actually arrive before the final answer.

2. Show a live thinking bubble immediately, even before model reasoning arrives
   - Change the in-progress assistant bubble so it always opens a visible live panel as soon as the assistant starts.
   - It will type status lines like:
     - `Starting reasoning...`
     - `Reading current case state...`
     - `Planning the next action...`
     - `Waiting for model reasoning...`
   - This prevents the current dead-silence gap while the model is working.

3. Add a real typewriter stream for progress and reasoning
   - Extend the thinking panel to animate both stage history and reasoning segments, not just reasoning segments.
   - Make each new line type out once, with a cursor, instead of appearing all at once.
   - Fix the current segment IDs so different assistant messages cannot accidentally share the same `0-0`, `1-0` animation key.

4. Flush backend progress more aggressively
   - Update the assistant backend to write a new progress line before model calls, after model calls, before tools, after tools, and while writing the final reply.
   - Add a deterministic fallback reasoning trail when the model does not return provider-native reasoning, so the panel still fills live with useful action summaries.

5. Make the UI resilient if realtime is late
   - Add short polling while an assistant run is active as a fallback, so live thinking still updates even if realtime drops an event.
   - Avoid waiting for the final `assistant_runs` completion event to refresh the chat.

6. Verify with a real assistant turn
   - Test a prompt that triggers tools and confirm:
     - The thinking panel appears immediately.
     - Lines type while the assistant is still running.
     - Tool/status lines update before the final answer.
     - The final answer does not duplicate the live bubble.

Technical details
- Files to update:
  - `src/features/project/AssistantSection.tsx`
  - `supabase/functions/assistant-chat/index.ts`
  - a new database migration for realtime on `chat_messages`
- The fix will not expose private chain-of-thought. It will show a safe, live “work log” / reasoning summary and action trail, which is what the app can reliably display across providers.