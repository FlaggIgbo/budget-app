# Frontend Screenshot Testing (Playwright & GitHub Image Diffs)

This directory contains deterministic visual snapshots of all frontend components and pages in the Budget App, captured using [Playwright](https://playwright.dev/).

## Why Screenshot Testing in Git?

GitHub has **native visual image diffing built directly into pull requests and commits**. When `.png` screenshots are committed to the repository, GitHub allows reviewers to inspect visual changes using four diff modes:

- **2-up**: Side-by-side comparison of baseline vs. current version.
- **Swipe**: An interactive drag-slider to sweep across before-and-after states.
- **Onion Skin**: An opacity crossfade slider to reveal subtle layout shifts or pixel misalignments.
- **Difference**: Highlights only the pixels that changed between versions.

By tracking component and page screenshots in Git, every pull request automatically includes visual regression testing without requiring third-party hosted services or subscriptions.

---

## Directory Structure

```
screenshots/
├── components/   # Isolated UI component snapshots across various states
│                 # (login phone/OTP cards, net worth, cash flow, category bars,
│                 #  quick stats, transactions filter, Plaid enrollment card, profile email verification)
└── pages/        # Full-page responsive views across desktop (1280x800) and mobile (390x844)
                  # viewports for Login, Dashboard, Bank Accounts, and Profile routes
```

Snapshots are configured and driven by `scripts/generate-screenshots.js` using deterministic data, mocked API responses, and disabled animations.

---

## Running Manually

To regenerate all component and page screenshots on demand:

```bash
npm run screenshots
```

To run the pre-push check manually:

```bash
npm run screenshots:check
```

To run the full Playwright E2E browser automation flow (with video recording):

```bash
npm run test:e2e
```

---

## Git Pre-Push Hook Automation

A pre-push hook is installed in `.husky/pre-push`.

### How It Works

1. When you run `git push`, the hook checks whether any files in `client/src/` have been modified in the commits being pushed.
2. **If frontend code changed**:
   - The hook automatically builds the client and runs Playwright to regenerate all component and page screenshots using deterministic mocking and frozen animations.
   - If screenshot images changed, it stages them (`git add screenshots/`) and commits them (`chore(screenshots): regenerate component & page screenshots`).
   - The push is paused with instructions to re-run `git push` so your branch on GitHub includes the newly generated screenshots.
3. **If screenshots are already up to date** (or no frontend files were touched):
   - The check passes immediately and your push proceeds normally.

### Skipping Screenshot Checks

If you ever need to bypass screenshot generation temporarily during a push:

```bash
SKIP_SCREENSHOTS=1 git push
# or standard git flag:
git push --no-verify
```
