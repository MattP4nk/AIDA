# Security Cleanup — Secrets Status

**Corrected 2026-08-30.** The previous version of this document was factually wrong in a way that
mattered: it claimed secrets were committed to git history and prescribed a full history rewrite,
while the one action actually required — rotating the API key — was never done. It also pasted the
compromised key in cleartext at the repo root, creating the exposure it warned about.

---

## Verified state of git history

Checked by exhaustive scan of every object in every ref
(`git rev-list --objects --all` → `cat-file blob` → grep), plus `git log --all -S`:

| Claim | Verdict |
|---|---|
| The AI API key was committed | **False** — it appears in no blob, in no commit, on any ref |
| `server/.env` was committed | **False** — never tracked (`git log --all --diff-filter=A -- 'server/.env'` is empty) |
| Database credentials were committed | **False** — see below |

What *was* committed, and what it actually contained:

- `server/.env.backup` — added in `a65cef4`, removed in `4254614`. A copy of `.env.example`.
  Placeholders only: `JWT_SECRET=your_super_secret_jwt_key_...`,
  `DATABASE_URL=postgresql://aida_user:aida_password@...` (the template default).
- `server/.env.test` — added in `84c0360`, removed in `4254614`.
  `JWT_SECRET=test_jwt_secret_key_for_testing_only_min_32_chars` and a passwordless local DSN.

Both blobs remain reachable in history. Neither contains a real secret.

### Do not run a history rewrite

The `git filter-repo` procedure previously recommended here is **unnecessary**. It would rewrite
every commit SHA, break clones and forks, and buy nothing — there is no real secret in history to
remove.

---

## What actually needs doing

- [ ] **Rotate `AI_API_KEY` at the provider.** The value in `server/.env` was published in
      cleartext in this file, in this repository's working tree, for an extended period. Treat it
      as compromised regardless of git history. *(Owner: repo maintainer — this requires provider
      dashboard access.)*
- [x] **Remove the cleartext key from this document.** Done 2026-08-30.
- [x] **Restrict `server/.env` permissions** to `600`. Done 2026-08-30 (was `644`, world-readable).
- [ ] **Rotate `JWT_SECRET`** if the production value has ever been shared outside the deployment
      host. Not required on git-history grounds.

---

## Ongoing hygiene

- `.gitignore` covers `.env` and `.env.*` with an exception for `.env.example`. Verified effective.
- **Never paste a live secret into a document to describe it.** Reference it by variable name
  (`AI_API_KEY`) and location (`server/.env`). This document previously violated that rule and is
  the reason the key needs rotating at all.
- `server/.env.example` has drifted from the variables the code actually reads — see `PLAN.md`
  (O6) for the reconciliation task.
