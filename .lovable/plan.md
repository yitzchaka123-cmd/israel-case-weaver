## Plan: separate invite-code login from Google login

### Goal

Make the login page support two distinct access paths:

```text
1. Continue with Google
   - Creates/signs into a Google-based account
   - New Google accounts still require admin approval

2. Sign in with invite code
   - Uses only the generated invite code
   - Does not require a Google account
   - Does not require admin approval after a valid code is used
   - Saves work to that code’s own account
```

---

## 1. Change invite codes from “pending approval” to “direct access”

### Current behavior

A user enters a code, then signs in with Google. The code attaches to their account, but the account remains pending until an admin approves it.

### New behavior

A valid code becomes a direct login credential.

When someone uses a valid active code:

- the app signs them into an account connected to that code
- the account is automatically marked approved
- no admin approval is needed
- projects they create are saved under that code account

Google sign-in will remain separate and will still go through admin approval for new accounts.

---

## 2. Add backend support for code-based accounts

### Database changes

Update the invite-code/access system so each invite code can be tied to a code-login account.

Add nullable fields to `invite_codes`, such as:

```text
code_user_id
last_login_at
```

This lets a generated code behave like its own reusable account identity.

### Backend function

Add a secure backend function for code login, for example:

```text
login_with_invite_code(code)
```

It will:

- validate the code exists
- reject revoked, expired, or exhausted codes
- create or reuse the account tied to that code
- mark that account as `approved`
- attach the invite code to the `user_access` row
- update usage/login metadata
- return a session so the user is actually signed in

This must run server-side because creating/reusing a code account securely requires privileged backend logic.

---

## 3. Keep Google login approval rules unchanged

Google login will no longer depend on the invite-code field.

The Google path will be:

```text
Continue with Google → account created/signed in → pending approval unless already approved
```

So Google remains useful for real staff/member accounts, while invite-code login is a fast direct-access option.

---

## 4. Update the login page UI

### File

- `src/routes/login.tsx`

Replace the current combined flow with two separate cards/sections:

```text
Sign in with invite code
[Invite code]
[Continue with code]
No Google account required. Valid codes open the studio immediately.

or

Sign in with Google
[Continue with Google]
New Google accounts require admin approval.
```

The code button will call the new code-login flow directly.

The Google button will no longer stash/redeem the code.

---

## 5. Update auth state handling

### File

- `src/lib/auth.tsx`

Add a new auth method:

```text
signInWithInviteCode(code)
```

This will call the backend code-login function and set the returned session.

Also remove the old “stash invite code then redeem after Google login” behavior because code login and Google login are now separate.

---

## 6. Update admin/team access wording

### File

- `src/features/settings/TeamAccessPanel.tsx`

Adjust labels so admins understand what codes now do:

```text
Invite codes → Code logins
Create new code → Create code login
Max uses → Max logins / or keep Max uses if one-time access is preferred
```

Show whether a code already has an attached code account, and optionally show last login time.

Members created by code login will appear in the members list as approved automatically.

---

## 7. Ensure saved work belongs to the code account

Existing project creation already saves using the signed-in user id:

```text
projects.owner_id = user.id
```

Once code login produces a real session/user, no major project-saving changes are needed. Any project, marketing copy, storyboard, media, or export created while signed in with the code account will be saved under that code account’s identity.

---

## Technical notes

Files to edit:

- `src/routes/login.tsx`
- `src/lib/auth.tsx`
- `src/features/settings/TeamAccessPanel.tsx`
- a new backend function for invite-code login
- a database migration for invite-code account metadata and secure helper logic

No changes are needed to project creation logic unless testing reveals a missing owner/user id path.

I will also verify the app builds after the changes.