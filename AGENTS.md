# Stellar Notes Desktop: build, signing and OTA release instructions

These instructions apply to release work in `StellerSecurity/Stellar.UI.Notes.DesktopApp`. Follow this sequence on every machine. They describe the established direct-download/OTA workflow, not Android/iOS store submission or Mac App Store distribution.

## Authority, scope and safety

- Follow the user's current instructions and global security policy. This document is a procedure, not permission to install dependencies, access keys, bypass checks or publish a release.
- When the user authorizes a release, finish all authorized preparation and verification autonomously. Ask only for a genuinely missing approval, secret entry or required human action. Explain the concrete reason. Do not ask again for an action already approved within the same scope.
- New packages, tool versions, binaries, downloads, lifecycle scripts and execution scopes require the security review and explicit approval required by the global policy. A registry reputation or empty advisory response alone is not a security review.
- Before requesting approval, identify exact versions, purpose, alternatives, registry/source, publisher/maintainers, age/reputation, ownership concerns, malware/supply-chain searches, OSV/GitHub advisory results, lifecycle scripts, suspicious capabilities, the exact command and LOW/MEDIUM/HIGH risk. Inspect source as data before execution. Stop on suspected malware or HIGH risk.
- Approval for static acquisition does not authorize installation or execution. Approval for a private test does not automatically authorize CI introduction or publication. Reuse already approved exact bytes and scopes instead of requesting redundant approvals.
- Never weaken Gatekeeper, SIP, XProtect, quarantine, Chrome/Electron sandboxing, updater verification, dependency checks, test assertions or branch rules to make a release pass. Do not add `--no-sandbox`.
- An admin-merge/security exception is never standing permission. If normal merge is blocked, disclose the actual findings and review requirement. Obtain explicit informed approval for that exact PR/head and scope before bypassing anything. Preserve the report and all rules.
- Preserve personal notes, folders, app locks, keys and profiles. Use isolated worktrees, private QA profiles and disposable synthetic accounts. Never clear real app storage, invoke destructive API operations on production notes, or uninstall a user's working app as a test shortcut.
- Use the existing Quill editor and shared document semantics. Preserve intentional empty lines, formatting, locks, encryption, autosave and offline/sync behavior across mobile and desktop. Do not replace the body with a textarea or competing editor.
- New branches use `stellar/`. Preserve unrelated branches/work. Never add Co-authored-by or equivalent assistant-attribution trailers. Keep credentials, node_modules, downloaded binaries and browser profiles out of Git.
- The user approved a single-file exception on 27 November 2026: this repository's root `AGENTS.md` may be tracked and shared through GitHub. All OTHER Markdown files, including case variants and AGENTS files in subdirectories, must remain local and untracked. Preserve `*.[mM][dD]` in .gitignore; tracking this one approved file does not authorize adding other Markdown, changing security controls or bypassing reviews. Once merged, new clones/checkouts receive the tracked guide. Older branches without that commit still need a local copy.

## 1. Establish the release inputs before doing work

There are TWO repositories:

1. Source/builds: https://github.com/StellerSecurity/Stellar.UI.Notes.DesktopApp
2. ALL published Notes desktop release assets: https://github.com/StellerSecurity/Stellar.Desktop.Releases

Do not publish Notes installers or update manifests to the source repo, a personal repository, the website repo or a VPN release tag. The shared publisher repository may contain other products; limit all operations to Notes and the selected platform.

Start in the chosen source checkout. Use machine-local paths derived from the checkout or supplied by the user; never assume a particular username, Downloads folder, mounted drive or previous temporary directory.

Read-only preflight:

```sh
git remote -v
git status --short
git branch --show-current
git rev-parse HEAD
node --version
npm --version
node -p 'require("./package.json").version'
```

Inspect package.json, package-lock.json, the release tools and both desktop pipeline YAML files. Confirm the actual origin, clean release source, target version, requested platforms and architectures. Inspect the latest merged main and current published feeds before deciding what is newer. Never reset a user's dirty checkout or silently switch their active branch; use a clean `stellar/` worktree when needed.

A local checkout can be obsolete even when its remote URL is correct. If release helpers or CI YAML files below are missing, STOP using that checkout's legacy release scripts. Locate the correct reviewed release commit. Do not improvise missing tools or infer that an old 0.0.x package is the intended release.

Use task-specific variables, for example:

```sh
NOTES_VERSION="$(node -p 'require("./package.json").version')"
NOTES_RELEASE_SHA="$(git rev-parse HEAD)"
NOTES_RELEASE_REPO="StellerSecurity/Stellar.Desktop.Releases"
```

The top-level package version and package-lock.json's top-level/root-package versions must agree. Record the FULL immutable source SHA, never only a branch name. Do not reuse a version that already has different published bytes. Read builder appId, targets, architectures, entitlements and feed URLs from the selected source. Never change application identifiers or installed-data locations as part of a routine update.

## 2. Fixed release destinations and trust

Platform tag and signed manifest:

| Platform | GitHub release tag | Manifest | Public OTA directory |
| --- | --- | --- | --- |
| Windows x64 | notes-win-VERSION | latest.yml | https://desktopreleasesassetsprod.stellarsecurity.com/notes/win/ |
| Linux x64 | notes-linux-VERSION | latest-linux.yml | https://desktopreleasesassetsprod.stellarsecurity.com/notes/linux/ |
| macOS ARM64 | notes-mac-VERSION | latest-mac.yml | https://desktopreleasesassetsprod.stellarsecurity.com/notes/mac/ |

Each manifest has a detached Base64 Ed25519 signature named MANIFEST.sig. The established Notes public trust anchor is:

```text
OGCBFiL/edNJ/hzctTN7A89YBRtBygopfmCDhLi75zs=
```

Cross-check this against the selected source finalizers, publisher verifier and installed updater. It is PUBLIC, not a signing secret. Never replace the trusted key to accommodate an unrecognized private key. A key rotation needs a separately designed and authorized compatibility migration.

User-facing download routes are https://download.stellarsecurity.com/notes/windows, /notes/linux and /notes/mac. GitHub publication and public OTA promotion are separate steps; a published GitHub tag alone does not prove the live feed changed.

Do not force all platforms to one version if a platform is not ready. A Windows/Linux release must leave the Mac feed byte-identical, and vice versa.

## 3. Dependency, source and PR gates

Before a build or release:

- Review the complete proposed source change and the latest checks for its exact head. Source, dependency, CodeQL, runtime and platform tests must satisfy the project's requirements, or a specifically authorized exception must be recorded. Never call coverage gaps a clean audit.
- Fix real findings; distinguish demonstrated behavior from capability correlations. Do not make broad scanner exemptions or delete findings to obtain a green badge.
- Build the final merged, authorized source, not an earlier PR head that differs from main. Resolve version/lock changes in the PR, not by modifying a production package after signing.
- Confirm dependency acquisition and CI execution are authorized for the exact locked versions and build inputs. No `@latest`, speculative upgrades, unreviewed npx, automatic lifecycle execution or remote shell installers.

The established reviewed dependency preparation sequence includes:

```sh
node tools/release-toolchain-check.cjs --lock-only
npm ci --ignore-scripts --no-audit --no-fund
node tools/braces-depth-patch.cjs --apply
node tools/stencil-rollup-patch.cjs --apply
node tools/release-toolchain-check.cjs
npm ci --prefix identity-runtime --ignore-scripts --no-audit --no-fund
node tools/verify-identity-runtime.cjs
```

These are conditional reference commands, NOT install approval. Use the selected commit's actual pipeline sequence, including its mitigation-control tests and dependency audit. Run the lock-only gate before installation, installed-toolchain gate after applying the reviewed mitigations, and identity-runtime verification before the renderer build. Do not reorder these gates based on a stale guide.

Review Electron, builder, NSIS, 7-Zip, AppImage tools, native modules and downloaded archives too. Use the selected commit's windows-build-inputs/linux-build-inputs validators and exact cache checksums. A missing input is a review/acquisition step, not permission for builder to download an arbitrary fallback.

## 4. Build Windows and Linux without publishing

Use `azure-pipelines-desktop-build.yml` from the authorized main commit. The established source build definition is 187; verify its current repository/YAML mapping before use. Choose platform `both`, `win` or `linux` as requested. Capture run ID, source SHA, agent OS and resulting artifact inventory.

The current workflow builds Windows x64 on Windows and Linux x64 on Linux, runs source/release/security/editor tests, retains the dependency audit, packages with reviewed native inputs and `--publish never`, checks the packaged Windows updater, and stages only approved public artifacts.

Do not queue a build from an unmerged feature branch by removing its main-only condition. Do not use the old `electron:winRelease` / `electron:linuxRelease` scripts with `--publish always`. Inspect any similarly named script before running it; the name "SignedRelease" does not prove it publishes safely.

Windows signing distinction: the established 0.1.6 CI flow produced an installer WITHOUT Authenticode and later signed its OTA metadata. Ed25519 OTA signing is not Windows publisher/SmartScreen signing. Do not describe such an EXE as Authenticode-signed. Never silently disable required OS signing; confirm the authorized signing policy for the release. If Authenticode is required, complete and verify it BEFORE final artifact hashing/OTA signing.

Do not reuse the historical unsigned-Windows or merge exceptions as new permissions. Do not invent a Windows certificate or distribute signing credentials through CI as a workaround.

Keep unsigned CI inputs separate from finalized release output. Verify version, platform, source/build provenance, exact filenames, byte sizes and SHA256/SHA512 before accepting artifacts. A green build with mismatched source or artifacts is not a release candidate.

## 5. Test the actual packages

Use `azure-pipelines-desktop-test.yml` against the EXACT new source build ID, not the YAML's historical default sourceBuild. Select the requested platforms. Authorize synthetic-account creation where the test requires it; otherwise use an approved synthetic QA account.

Required evidence includes:

- Release finalizer, updater-signature, URL, realtime, localization, Linux launcher and toolchain controls.
- Renderer build, identity-runtime/account-upgrade tests, Quill/editor parity and relevant application tests.
- The actual installed Windows package and actual Linux AppImage/extracted AppRun in isolated profiles, not just an unpackaged renderer.
- Create/edit notes and folders; formatting, ordinary Enter, consecutive/leading/trailing blank lines and lists; save/reopen and restart persistence.
- Login with the current upgraded Stellar ID flow, immediate retrieval after login, two-way sync, metadata changes, offline changes/reconnect and conflict handling.
- Account upgrade on mobile followed by supported desktop login/sync when that behavior changes. Do not claim cross-device verification from unit tests alone.
- A real previous-version-to-new-version updater test where applicable, with signature enforcement and data preservation. Do not infer an installed upgrade passed from a fresh install.

A 409/conflict must preserve local work and follow the existing conflict flow; do not disable revision checks or overwrite another device's content to pass a test. Delete only this test's own disposable records. Keep safe test reports/screenshots, never credentials or whole browser/Notes profiles.

Record counts and failures accurately. "Not tested on Mac" or "upgrade not yet tested" is a remaining gate, not a pass. Do not generalize a result from one architecture to x64, ARM64 or universal builds.

## 6. Windows/Linux OTA signing on the signing machine

Prepare a reviewed, version-bound interactive helper and a build-verification receipt BEFORE asking the user to sign. Bind it to the exact source, version, passed packaged-test run and unsigned artifact hashes. The existing 0.1.6 sign-windows-linux.command is an example, not a reusable script for a different version without regenerating its checks.

The user enters the EXISTING Notes Ed25519 private key in a hidden local Terminal prompt. Never ask for it in chat, clipboard, a screenshot, a command-line argument or a committed file. Disable shell tracing; do not dump the environment. Pass the key only to the approved signing process and unset its temporary environment variable on exit. Do not create a replacement key.

The finalizer consumes `STELLAR_RELEASE_ED25519_SK_BASE64` locally and verifies that its derived public key matches the trust anchor. Use the source helper, for example AFTER the authorized interactive key entry:

```sh
node tools/finalize-desktop-release.cjs stage win "$NOTES_BUILD_INPUT" "$NOTES_UNSIGNED_STAGE"
node tools/finalize-desktop-release.cjs finalize win "$NOTES_UNSIGNED_STAGE" "$NOTES_SIGNED_OUTPUT"
```

Run the equivalent with `linux` in a separate directory. Use fresh, platform-specific directories; never merge outputs into a stale dist folder. The helper must stop if finalized output already exists. Preserve existing signed files and compare them before deciding how to resume.

Expected public asset allowlist (replace VERSION with the verified version):

- Windows: `Stellar Notes-VERSION-x64.exe`, its `.exe.blockmap`, `latest.yml`, `latest.yml.sig` — FOUR files.
- Linux: `Stellar Notes-VERSION.AppImage`, `latest-linux.yml`, `latest-linux.yml.sig` — THREE files.
- A .deb or another architecture is not part of this approved updater asset set. Adding one needs its own explicit plan and tests.

Verify the detached signature, manifest version, paths, sizes and SHA512 against the FINAL files. Retain a SHA256 inventory as independent transport/provenance evidence. Do not mutate any signed artifact or manifest afterwards.

## 7. macOS: prepare, sign, notarize, staple, then OTA-sign

Current established target: Apple Silicon ARM64, appId `stellar.notes.app`, Developer ID Application identity `North Star Swiss SA (7VYLUCU756)`, team `7VYLUCU756`. Inspect the selected source before using these values. Do not claim Intel/universal support from an ARM64 build.

The remote signing Mac may be outside the agent's control. Prepare a self-contained signing kit and exact human-readable commands; do not claim remote actions have run until evidence is returned.

Before handoff, build the renderer/app from the same authorized source, complete Mac packaged QA to the extent possible, and prepare a complete app/asset/symlink inventory, source SHA, tool-version/hash inventory, safe test reports and SHA256 of the handoff archive. Do not include private keys, Apple credentials, node_modules, profiles or Markdown in an uploaded kit. Use a separate draft/preparation tag, not a canonical `notes-mac-VERSION` release that could trigger OTA promotion.

On the signing Mac, first check existing tools and PUBLIC signing identity metadata:

```sh
uname -m
sw_vers
xcode-select -p
xcrun --find notarytool
xcrun --find stapler
node --version
npm --version
git --version
security find-identity -v -p codesigning
```

Use the correct Developer ID Application identity, not Apple Development or Apple Distribution. If multiple certificates share the same name/team, identify the exact certificate fingerprint and validate the resulting signature. Do not select an arbitrary duplicate or access/export private keys.

Reuse the existing reviewed signing modules only after their exact versions, file hashes and module resolution match the kit's inventory. A path to an old node_modules directory is not proof it is suitable. Never silently npm-install missing signing tools on the remote machine.

Required order:

1. Verify handoff checksum and full inventory; verify app version, bundle ID and ARM64 architecture.
2. Sign the complete app using the reviewed signing integration, correct entitlements, hardened runtime and secure timestamp. Never use `codesign --deep` as a substitute for correctly signing nested components. `--deep` is used for verification, not blind recursive signing.
3. Verify the app signature/team and packaged application payload; make ZIP and DMG from that app; sign the DMG.
4. Submit ZIP and DMG to Apple's notary service using an EXISTING authorized notarytool Keychain profile. Require status `Accepted` for both; retain safe reports.
5. Staple the app and DMG. Validate both tickets and run Gatekeeper assessment of the app. Confirm the DMG contains the correct signed app and expected application payload, not an old build.
6. Recreate the final ZIP FROM THE STAPLED APP. Recreate both blockmaps AFTER all Apple signing/notarization/stapling byte changes. Do not reuse builder's original ZIP or old blockmaps.
7. Generate the final latest-mac.yml and sign its exact bytes with the EXISTING Notes Ed25519 key. Independently verify the signature and every final checksum/size.
8. Launch/test the signed app and test an installed previous-version OTA upgrade on the signing Mac before publication. Keep personal notes intact. Preserve a clear "pending" status until these checks are actually done.

Use the version-bound kit's `sign-and-notarize.command`, and `finish-notarize-and-ota.command` to resume when supplied. Otherwise use the reviewed `tools/finalize-mac-release.cjs` after Apple verification. The 0.1.6 kit is ARM64/version-bound and must not be edited into another release by changing filenames alone.

Apple credentials stay local. If a notary profile is absent/invalid, let the user configure the correct Apple ID/team with an app-specific password or authorized API key locally. An HTTP 401 is not solved by repeatedly using the normal Apple account password. Never request credentials in chat, reset the Keychain, disable validation or continue after a failed notary result.

A ZIP cannot be stapled like an app/DMG. Do not run stapler on it. The final regenerated ZIP contains the stapled app; its new hashes/blockmap must match the final manifest.

Mac public allowlist — SIX files:

- `Stellar Notes-VERSION-arm64.zip` and `.zip.blockmap`
- `Stellar Notes-VERSION-arm64.dmg` and `.dmg.blockmap`
- `latest-mac.yml` and `latest-mac.yml.sig`

A source build, notarization request submission, unsigned Mac QA pass or a preparation draft is not a published, verified Mac release.

## 8. Publish verified files to the shared release repository

Publish only with the user's release authorization. Do not ask for another generic permission when the exact release/publication is already authorized, but do not extend that authorization to a different platform, key, version or security exception.

Use a DRAFT GitHub release first in `StellerSecurity/Stellar.Desktop.Releases`, tagged `notes-win-VERSION`, `notes-linux-VERSION` or `notes-mac-VERSION`. A tag in this publisher repo is not the desktop source commit: record the source repository/FULL SHA separately in release provenance. Never set --target to a desktop-source SHA that is not an object in the publisher repo.

Example, only after version/platform/source/authorization checks and preparation of public release notes:

```sh
NOTES_TAG="notes-${NOTES_PLATFORM}-${NOTES_VERSION}"
gh release create "$NOTES_TAG" --repo "$NOTES_RELEASE_REPO" --target main \
  --draft --title "Stellar Notes $NOTES_VERSION ($NOTES_PLATFORM)" \
  --notes-file "$NOTES_PUBLIC_RELEASE_NOTES"
```

Upload only the exact platform allowlist, passing quoted filenames explicitly. Do not use a broad dist/* glob or upload the app bundle, test profiles, secret reports, source/node_modules, unrelated installers or preparation ZIPs into a canonical platform release. Do not use --clobber to overwrite versioned assets.

Inspect any existing draft/tag first. Resume only missing identical assets; if a versioned asset differs, stop and use a reviewed new-version/correction plan. Never silently replace an already published installer.

Compare GitHub asset SHA256 digests AND byte sizes to the local finalized inventory. If digest metadata is unavailable, obtain an authorized exact-byte verification instead of treating missing evidence as a match. Account for GitHub transport filename normalization using the publisher's reviewed normalizer; never edit a signed manifest to match a transport filename.

Only after the entire draft verifies, publish that specific draft. Keep release notes public and free of private paths, credentials, personal data and Markdown attachments.

## 9. Promote the exact platform to the public OTA feed

Use the shared release repo's reviewed `azure-pipelines.yml` and its `scripts/release.cjs` / `scripts/promote.py` flow, not a new ad hoc uploader. The established production pipeline is 137; recheck its repo/YAML and environment mapping on the current account.

Parameters are `releaseVersion=VERSION` and `releasePlatform=mac|win|linux`, on the publisher repo's main branch. A validation-only run with releaseVersion `none` does not deploy. Verify the run actually downloads `notes-PLATFORM-VERSION` from the shared repo and targets Notes' expected public directory.

The publisher normalizes names, verifies the trusted Ed25519 signature/version/allowlist/sizes/hashes, stages files, promotes them with existing rollback safeguards and verifies the public result. Never replace this with hand-written file copies, disable verification, or deploy from a PR/feature branch.

GitHub-to-Azure release automation previously returned HTTP 401 even though GitHub publication succeeded. Therefore ALWAYS verify a real Azure run and its result. If automation fails, use the already authorized existing manual pipeline for the SAME exact release/platform. Do not inspect, replace or create a PAT, alter credentials, rotate a service connection or change permissions without specific authorization.

Follow the build and deployment until completion in the current task. Do not create a scheduled automation just to watch one run. A queued job, successful GitHub upload or successful build alone is not proof of public OTA availability.

## 10. Independently verify live OTA and report completion

After successful promotion:

- Read the actual public signed manifest and its detached signature from the selected platform feed.
- Verify the exact raw manifest bytes against the trusted Ed25519 public key; parse the expected version and exact filenames.
- Verify the public installers/blockmaps against FINAL sizes and SHA512, and compare SHA256 to the local/GitHub transport inventory. A HEAD 200 alone is not checksum verification. Downloads/execution still follow the approved artifact/security scope.
- Verify user-facing /notes/windows, /notes/linux or /notes/mac download redirects resolve to that intended artifact. Do not infer their target from the GitHub tag.
- Compare untouched platform manifests/signatures to the recorded pre-release baseline. Do not overwrite Mac when publishing Windows/Linux.
- Verify actual update discovery, signature enforcement and data-preserving installation on the target platform. Distinguish a tested fresh install from a tested upgrade. If an authorized exception leaves a test pending, disclose it rather than calling it passed.

The release repo verifier can be used in its reviewed checkout, with an absolute finalized-artifact directory:

```sh
node scripts/release.cjs verify "$NOTES_SIGNED_OUTPUT" "$NOTES_VERSION" "$NOTES_PLATFORM"
```

This is a verification command, not proof that a public feed was fetched. Record the separate public-byte evidence too.

Keep a machine-independent release receipt: source SHA/version/platform/architecture, manifest/lock/toolchain hashes, exact approvals, scan findings/gaps, build/test/run IDs and results, artifact allowlist/hashes/sizes, OS-signature/notary/stapling results where relevant, GitHub URLs and verified asset digests, Azure promotion IDs, public feed/redirect verification, upgrade-test evidence and any remaining limitation. Keep private local paths and credentials out of public release notes.

Final response: state what is LIVE, link the shared GitHub release(s), name verified platforms/versions, give actual test/deployment results and identify anything still pending. Do not call an unsigned kit "signed", an OTA signature "Authenticode", an accepted notary request "stapled", or a GitHub upload "live OTA".

## 11. Failure, recovery and machine handoff

On any mismatch, failed signature, unaccepted notarization, missing artifact, wrong architecture, failed test or unauthorized security exception: stop promotion and preserve all inputs, signed outputs, receipts and safe logs. Diagnose that concrete failure; do not delete state and restart blindly.

Do not re-sign or change an immutable already published artifact in place. Rollback must use the existing reviewed promotion recovery and a previously verified matching manifest/signature/artifact set, limited to the affected platform and authorized scope. Restoring an older feed does not prove that clients already upgraded will downgrade. Never silently enable downgrade flags or turn off signature checking.

For a remote-machine handoff provide: exact version/platform/architecture and source SHA; archive checksum and inventory; reviewed existing prerequisites; a machine-local directory selection; the exact version-bound commands; local-only secret prompts; resume commands; expected output allowlist; tests still required; and the next publication step. Never assume the other AI can read this chat, access the current computer, find an old /private/tmp path or reuse an approval without its exact recorded scope.

Historical reference ONLY: the 0.1.6 Windows/Linux release used source 83538474ca62e816a2d7fb32252fb0a2df89fa1a, build 7436, packaged tests 7439 (10/10 per platform), and public promotions 7442/7443. Mac preparation was a separate ARM64 signing kit. Those versions, run IDs, local paths and one-time exceptions are NOT defaults or reusable approvals. Discover and verify current state for every new release.
