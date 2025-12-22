# Stellar Privacy Notes

A hybrid ionic application that allows users to store notes on their phone using localStorage.

It is possible to add a password for the app which encrypts all data stored on the phone with AES256.

All data is stored with localStorage and if any password is set, data will be encrypted with AES256.

Key-features:

* Data only stored on the phone. Not on any server.
* If the app contains a password and it has been unlocked, the app will require the notes app password again after 2 minutes inactivity.
* Possible to delete all notes in one tap.
* If the user loses their notes-password it is possible to reset the password, but it requires to delete all data created, meaning the app will be empty. Data cannot be recovered without the passwords.
* Brute-force protection.
* All data will be wiped/deleted from the phone, if there is 20+ incorrect passwords attempts in a row.
* Password helper, when adding password for the app or notes our password helper will ensure you create a strong password.

Up-coming features:
- Possible to export notes and upload them to a new device. [Requires the decryption keys, if there is any set].
- If a note has a lock, and it has been unlocked - but the user is inactive x time, the app should automaticly unlock the note. If the user has notes app password, it already does for the whole app.

## Clean Install & Build (macOS)

Follow these steps to perform a clean setup and build the Electron app:

```bash
# Remove existing dependencies and build artifacts
rm -rf node_modules
rm -rf package-lock.json
rm -rf dist

# Verify and clean npm cache
npm cache verify

# Install dependencies
npm install

# Install rollup without running post-install scripts
npm install rollup --ignore-scripts

# Rebuild native modules
npm rebuild

# Build Electron app for macOS
npm run electron:macBuild
