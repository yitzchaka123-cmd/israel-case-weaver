

## Fix StoryboardStudio TypeScript build error

The build fails because the database returns `shots` as `Json` (Supabase's generic JSON type) but the code casts it directly to `StoryboardRow` whose `shots` field is `Shot[]`. TypeScript correctly refuses this cast.

### The fix

In `src/features/project/marketing/StoryboardStudio.tsx`, line 90, change the direct cast to go through `unknown` first — which is exactly what TypeScript's error message recommends. The runtime behavior is already safe because the `useEffect` at lines 101-113 defensively re-shapes each shot with `Array.isArray` checks and field-level fallbacks.

**Change:**
```ts
return (data as StoryboardRow) ?? null;
```
**To:**
```ts
return (data as unknown as StoryboardRow) ?? null;
```

That single-line change clears the build error. No other files need to change — the defensive parsing already handles malformed stored data.

