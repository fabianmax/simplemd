# Signing, notarization and distribution

**Date:** 2026-09-15
**Status:** partially shipped — everything that does not need an Apple
Developer ID is done and verified; signing and notarization are configured but
have never been executed.

Unblocks the item deferred on 2026-09-01 ("until a GitHub repo exists"). The
repo now exists: `github.com/fabianmax/simplemd`.

## What shipped

**The CLI lives inside the .app.** `src-tauri/bin/simplemd` is bundled to
`Contents/Helpers/simplemd` via `bundle.macOS.files`. It resolves `$0` through
symlinks — Homebrew links it onto `PATH` — walks up to the `.app`, and calls
`open -a "$app" "$@"`.

Two properties were verified by test, not by reading:

- Invoked through a symlink it still finds its own bundle, and paths containing
  spaces survive.
- `simplemd file.md` against an already-running app routes the file into that
  instance instead of launching a second copy (process count stays at 1).

**Addressing the bundle by path, not by name** (`open -a /path/to/simplemd.app`
rather than `open -a simplemd`) works before the app has ever been registered
with Launch Services and is unambiguous when several copies exist.

**DMG target enabled, and the Finder-automation debt is closed.** The DMG
bundler's AppleScript window-styling step needs Finder automation permission.
Tauri passes `--skip-jenkins` to `bundle_dmg.sh` when `CI` is set, which skips
exactly that step. `CI=true npm run tauri build` produces a DMG with no
permission prompt — verified locally, 3.6 MB, arm64. GitHub Actions sets `CI`
itself, so the hosted path needs no special handling.

**`minimumSystemVersion: "11.0"`.** Tauri's 10.13 default predates Apple
Silicon, which this app requires.

**Release workflow** (`.github/workflows/release.yml`), tag-triggered. It
refuses to run when the signing secrets are absent rather than publishing an
unsigned build, and verifies the artifact with `spctl --assess` and
`stapler validate` instead of trusting the build log — `spctl` answers the only
question that matters: what a machine that has never seen this developer does
when the app is opened.

**Homebrew cask scaffolded, not published** —
`packaging/homebrew/Casks/simplemd.rb`, with the reasons it cannot go live yet
in its header.

## What is blocked, and on what

Signing and notarization cannot execute. `security find-identity -v -p
codesigning` reports 0 valid identities: there is no Apple Developer Program
membership ($99/year) and therefore no Developer ID Application certificate.
No amount of configuration substitutes for it.

The Homebrew cask is blocked twice over: a cask fetches a GitHub release asset,
and on a private repo that asset is private too, so `brew install` 404s for
everyone. It needs a public repo *and* a notarized DMG.

Until then the app runs unsigned locally, exactly as before.

## To finish it later

1. Enroll in the Apple Developer Program.
2. Create a **Developer ID Application** certificate (Xcode → Settings →
   Accounts → Manage Certificates, or the Developer portal) and install it.
   `security find-identity -v -p codesigning` should then list it; the string it
   prints is `APPLE_SIGNING_IDENTITY`.
3. Create an app-specific password at appleid.apple.com → that is
   `APPLE_PASSWORD`. **Not** the Apple ID password.
4. Export the cert as `.p12`, then `base64 -i cert.p12 | pbcopy` →
   `APPLE_CERTIFICATE`, with its export password as
   `APPLE_CERTIFICATE_PASSWORD`.
5. Add all six secrets to the repo (`gh secret set APPLE_CERTIFICATE < …`).
6. Decide the version — see the open question below — then tag and push.

For a **local** signed build, the same env vars work with `npm run tauri build`;
Tauri imports the certificate into a temporary keychain itself.

## The version number: 0.1.9

Settled 2026-09-15. The v1.1–v1.9 numbering used throughout
CLAUDE.md is a **feature-milestone** series, not a release series; releases are
0.x, and the v1.9 milestone ships as 0.1.9.

Aligned across `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`, `package-lock.json` and `src-tauri/Cargo.lock`. The
first release is therefore `simplemd_0.1.9_aarch64.dmg` tagged `v0.1.9`.

`tauri.conf.json` is the one that matters — the DMG filename and the release
tag both derive from it. Bump it there first, then keep the other four in step;
nothing enforces that automatically.

## Evidence

Carried from `docs/research/2026-08-30-findings.md` §5, which sourced them:

- **argv grants no file access under sandboxing.** Apple DTS: the sandbox "does
  not look at your command-line arguments and extend your sandbox to grant you
  access to those directories." Launch Services document-opens *do* grant, via
  a sandbox extension token. Hence `open -a`, and hence this shape keeps
  sandboxing a later option rather than a rewrite.
- **`open -a app --args file` does not work** — `man open`: "These arguments are
  not opened or interpreted by the open tool."
- **Notarization cannot staple a standalone binary**, which is why the CLI is
  inside the bundle. BBEdit's cask is the template for the `binary` stanza.
- **App Store is not a target.** Review has rejected exactly this CLI feature
  under Guideline 2.3; Panic removed Transmit's "Open In Terminal" at Apple's
  request.
