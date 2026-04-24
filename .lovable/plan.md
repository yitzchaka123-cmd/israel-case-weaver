
## Make the project tab bar swipeable on touch screens

### What will change

The top project navigation row:

```text
Overview | Assistant | Case Board | Suspects | Documents | Envelopes | Hints | Marketing | Media
```

will become horizontally scrollable/swipeable on small screens, so mobile and tablet users can drag the bar left/right instead of losing access to later tabs.

### Implementation

**File to edit**

- `src/features/project/ProjectWorkspace.tsx`

### Changes

1. **Wrap the tab list in a horizontal scroll container**
   - Add `overflow-x-auto`
   - Add `overscroll-x-contain`
   - Add `touch-pan-x`
   - Keep vertical page scrolling unaffected

2. **Prevent tab buttons from shrinking**
   - Add `shrink-0` to each `TabsTrigger`
   - Keep labels readable instead of compressing them

3. **Improve mobile spacing**
   - Use smaller side padding on mobile, keep current desktop padding:
     - mobile: `px-4`
     - desktop: `md:px-10`
   - Keep the active underline behavior exactly as it is now

4. **Hide the horizontal scrollbar visually**
   - Add a small reusable CSS utility in `src/styles.css`, for example:
     ```css
     .scrollbar-none {
       scrollbar-width: none;
       -ms-overflow-style: none;
     }

     .scrollbar-none::-webkit-scrollbar {
       display: none;
     }
     ```
   - Apply it only to this tab scroller

5. **Add subtle edge fades**
   - Add left/right gradient fades on mobile so it is visually clear the tab bar can be swiped.
   - Keep these non-interactive with `pointer-events-none`.

6. **Optional active-tab auto-scroll**
   - Add a small `useEffect` + `ref` map so when a tab is selected, the active tab scrolls into view:
     ```ts
     activeButton.scrollIntoView({
       behavior: "smooth",
       block: "nearest",
       inline: "center",
     });
     ```
   - This helps when another part of the app jumps to a tab like Assistant, Marketing, or Media.

### Result

On touch screens:
- The tab bar can be swiped left/right.
- All tabs remain reachable.
- The active tab stays visible.
- The existing desktop layout remains unchanged.
- No database or backend changes are needed.

### Runtime note

There is also a preview dynamic-import runtime error in the current session. I will verify after the UI edit whether it was caused by the current preview bundle being stale or by a recent code/build issue, and fix any project-side issue found while keeping the scope focused on the tab bar.
