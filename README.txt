STELLAR NOTES DESKTOP

Stellar Notes is a desktop notes app for Windows, macOS and Linux.
Built with Electron and Angular, it uses Quill for rich-text editing,
works offline and syncs notes across devices through Stellar ID.

BUILD

Use Node.js 24 and the project's reviewed, locked dependencies.
Run commands from the repository root.

  npm run build                 Build the app
  npm run electron              Run the desktop app

Platform packages (written to dist/):

  npm run electron:winBuild     Windows installer (.exe)
  npm run electron:macBuild     macOS Apple Silicon (.dmg and .zip)
  npm run electron:linuxBuild   Linux (.AppImage)

Use the appropriate platform toolchain. macOS release builds require
Apple signing credentials on the signing machine.

TEST

  npm run test:parity
  npm run test:desktop-release

Release packages must pass the security checks and platform signing/OTA
finalization before publication. Keep signing keys outside the repository.
