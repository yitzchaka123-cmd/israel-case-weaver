

## Apply gpt-image-2 community findings to document image generation

Four small, independent improvements to `supabase/functions/generate-document/index.ts` based on what the OpenAI community thread + official `gpt-image-2` docs revealed.

### 1. Truer A4 aspect ratio (better fidelity)

Current portrait sizes hard-code `1024x1536` (a 2:3 ratio). True A4 is 1:√2 ≈ `1448x2048` — and `gpt-image-2` accepts arbitrary sizes as long as edges are multiples of 16, ratio ≤ 3:1, and total pixels are between 0.6M and 8.3M.

Change the size mapping for `gpt-image-2` only:

| Print size | Old | New (gpt-image-2) |
|---|---|---|
| A3 / A4 / A5 / A6 portrait | `1024x1536` | `1448x2048` |
| Business card landscape | `1536x1024` | `2048x1448` |

`gpt-image-1` keeps the old fixed sizes (it doesn't accept arbitrary dimensions).

### 2. Strip parameters that crash gpt-image-2

`background` and `input_fidelity` are unsupported on `gpt-image-2` and return a 400. We don't currently send them, but I'll add an explicit comment and a guard so a future edit doesn't accidentally reintroduce them. No runtime change today — defensive only.

### 3. Add `moderation: "low"` for gpt-image-2

Detective / mystery prompts (blood-stained letters, ransom notes, weapon photos, autopsy reports) often trigger false-positive content blocks. `gpt-image-2` supports `moderation: "low"` to relax this. Send it only for `gpt-image-2` (not `gpt-image-1`).

### 4. Better error message for the 5 IPM tier-1 rate limit

When OpenAI returns 429 with "rate_limit_exceeded" specifically due to the **5 images/minute** tier-1 cap, append: *"Tier 1 OpenAI accounts are limited to 5 images/min on gpt-image-2. Wait ~60s and retry, or upgrade your OpenAI tier."*

### Files touched

| File | Change |
|---|---|
| `supabase/functions/generate-document/index.ts` | Items 1–4 above (size map, defensive guard, `moderation`, refined 429 message) |

### What you'll see after

- Document images render at higher resolution and proper A4 proportions when using `gpt-image-2`.
- Mystery/crime-scene prompts get blocked far less often.
- 429s tell you exactly *why* (tier cap) and *what to do*.
- `gpt-image-1` behaviour is unchanged.

No frontend changes needed — only the edge function.

