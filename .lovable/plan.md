
Goal: eliminate the persistent Google Drive 403 by fixing the point where Google blocks the flow before it returns to the app.

What the evidence shows
- The app successfully calls the backend function that creates the Google OAuth URL.
- The returned OAuth URL contains the expected client ID, redirect URI, and Drive scopes.
- There are no callback logs for `drive-oauth-callback`, which means Google is denying access before the user is sent back to the app.
- That makes this a Google-side authorization issue, not a database or post-callback app error.

Implementation plan
1. Harden the OAuth start flow so Google stops picking the wrong account silently
- Update `supabase/functions/drive-oauth-start/index.ts` to request:
  - `prompt=consent select_account`
  - `login_hint=<signed-in app email>`
- Extend the auth helper in `supabase/functions/_shared/google-drive.ts` so the OAuth start function can resolve both the current user id and email from the access token.
- This will force the account chooser and steer Google toward the same email the user is signed into the app with.

2. Improve the Google Drive settings UI so the user sees the exact account requirement before redirect
- Update `src/features/settings/GoogleDriveConnection.tsx` to show:
  - which app email is expected for the Drive connection
  - a short warning that the exact same Google email must be listed as a Google Cloud test user while the OAuth app is in Testing mode
  - a clearer explanation for 403 failures
- Keep the current success/error hash handling, but add more actionable copy for the Google-side denial case.

3. Add better diagnostics to the backend OAuth functions
- Add structured logs in:
  - `supabase/functions/drive-oauth-start/index.ts`
  - `supabase/functions/drive-oauth-callback/index.ts`
- Log only safe metadata such as:
  - user id
  - hinted email
  - chosen return path
  - whether callback was reached
  - Google error code/description
- This will make future failures immediately distinguishable between:
  - wrong Google account
  - missing test-user access
  - consent-screen audience misconfiguration
  - redirect mismatch

4. Re-verify the Google Cloud configuration against the live flow
- Confirm these settings match the live request exactly:
  - OAuth consent screen audience is External
  - the app is either Published or still in Testing with the exact Google account added under Test users
  - redirect URI is exactly:
    `https://disanuvopbwdruathmfx.supabase.co/functions/v1/drive-oauth-callback`
- No database migration is needed for this fix.

Files to update
- `supabase/functions/_shared/google-drive.ts`
- `supabase/functions/drive-oauth-start/index.ts`
- `supabase/functions/drive-oauth-callback/index.ts`
- `src/features/settings/GoogleDriveConnection.tsx`

Validation plan
- Open Settings and click Connect Google Drive.
- Google should show an account chooser or prefill the correct email instead of jumping straight to a 403.
- After consent, the callback function should log a hit and redirect back to `/settings#drive=connected`.
- The settings panel should show the connected Google email.
- The built-in Drive “Test” action should upload a file successfully.

Technical details
- Current backend request generation is working; the failure happens before callback return.
- The highest-probability cause is Google using a different signed-in account than the one approved as a test user.
- The proposed code change reduces user error without weakening security or changing RLS/data access rules.
