STELLAR NOTES DESKTOP — BUILD AND RELEASE

Release candidate: 0.1.5
Application ID: stellar.notes.app
Base source: 11b1bb4f6fa71f02bc9484edf5eed0d7827b192f

SOURCE AND TOOLCHAIN

Use this repository's package.json/package-lock.json together. The note body
uses the shared Quill 2.0.3 integration. Do not replace it or rewrite stored
notes to change paragraph spacing.

Use an already reviewed Node 24 environment and the exact locked dependencies.
The release contract pins Electron 44.9.3, electron-builder 26.15.3, Angular
21.2.25 (framework/compiler), Angular builder 21.2.26 and TypeScript 5.9.3.
Dependencies must pass the project's security review before downloading or
executing them. Install hooks stay disabled. Do not run an unlocked install,
fetch a CLI with npx, or silently update dependencies to resolve a build error.

The checked-in release-toolchain-check verifies the lockfile, installation and
reviewed braces/Stencil patches. Reuse the reviewed dependency tree, or prepare
one under the same review process. Do not remove these checks.

BUILD AND TEST (from the repository root)

  node tools/release-toolchain-check.cjs
  npm run build
  npm run test:parity
  npm run test:desktop-release
  node --test tools/redirect-header-contract.test.cjs

The browser suite needs an installed Chrome/Chromium available to Karma.
The Angular output is dist/StellerPhoneNotesApp/. It must be present before
Electron packaging. Keep electron-start.js, preload.js, the realtime helpers,
persistence guard, localization and update-status modules in the package.

ISOLATED QA

Use a dedicated --user-data-dir and synthetic account. Do not open a QA build
against a personal profile, clear app data, uninstall the app, or reset storage
to make an upgrade test pass. Close the QA app cleanly before changing builds.
For a local test copy, omit app-update.yml so it does not download updates.
Leave the actual release candidate and production updater configuration intact.

Test Quill Enter, leading/trailing and consecutive empty lines, bold, lists,
save/reopen, cold startup, and Android sync in both directions. Verify that a
change arrives while the same note is open, and record a real WebSocket event.
Check existing local and unsynced notes before and after an in-place upgrade.
Unit tests alone do not establish cross-device compatibility.

UNSIGNED HANDOFF

The local 0.1.5 handoff contains an unsigned macOS Apple Silicon .app and a ZIP
for transfer to the signing Mac. It is not a publishable OTA payload. No Apple
identity, notarization credentials or production OTA private key was used.
Windows and Linux require their own platform builds and tests; the macOS
handoff is not evidence that those binaries were built.

On an authorized machine with the reviewed toolchain, the normal commands are:

  npm run electron:macBuild
  npm run electron:winBuild
  npm run electron:linuxBuild

Choose the command for the platform being released. macBuild keeps the configured
Apple signing requirement and --publish never. Do not disable signing in the
production build. Packaging may need reviewed platform tooling/caches; any new
download or dependency needs review first.

MAC SIGNING AND OTA FINALIZATION

On the signing Mac:

1. Build 0.1.5 from the reviewed source using the existing authorized Apple
   Developer ID identity and hardened-runtime entitlements.
2. Notarize and staple the .app and DMG, then verify Apple signatures,
   Gatekeeper acceptance and stapling.
3. Use the existing trusted Stellar OTA Ed25519 key locally. Do not generate a
   replacement key: installed clients trust the existing public key.
4. Run the checked-in finalizer with the final artifacts:

     npm run release:mac:finalize

   The script reads package.json, dist/mac-arm64/Stellar Notes.app and the
   matching DMG in dist/. It rejects files that are not
   signed, notarized and stapled, recreates blockmaps from final bytes, and
   signs latest-mac.yml with the existing trusted OTA key.
5. Verify final artifact hashes and the signed metadata. Any change after
   finalization invalidates the hashes and requires finalization again.

Keep certificates, private keys, tokens, signing configuration, QA account
data and node_modules outside Git and out of public release artifacts.

PUBLISHING

Upload only finalized platform artifacts and matching signed OTA metadata to
the Notes platform directory on the configured release host. Do not publish
the unsigned handoff or a QA package. Publish payloads before making the signed
manifest visible so clients cannot request missing files. Validate an update
from the installed production build using a disposable QA profile, preserving
both synced and unsynced notes.

The preparation task does not authorize signing or publication. Complete the
platform's signing, finalization and final release checks before rollout.
