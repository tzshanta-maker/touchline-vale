# Repository notes

This project lives at **<https://github.com/tzshanta-maker/touchline-vale>** — already created,
public, and set up as the `origin` remote.

## Everyday changes

```
git add -A
git commit -m "what changed"
git push
```

## Cutting a new build

```
npm install
npx vite build
export PATH=/usr/lib/jvm/jdk-11/bin:$PATH   # needs a JDK 11+
bash android/build-apk.sh --debug --fetch-tools
```

That writes `release/Touchline-Vale-<version>-universal-debug.apk`. Bump the version in
`package.json`, `android/AndroidManifest.xml` (`versionName` + `versionCode`) and
`android/build-apk.sh` before building.

## Tests

```
(npx vite preview --port 4173 &)          # the smoke test needs a served build
BASE_URL=http://127.0.0.1:4173/ node tests/smoke.mjs
node tests/file-protocol.mjs <unpacked>/assets/www/index.html
```

## Releases

The APK is attached to a GitHub Release (currently `v1.0`). Keep the binary out of git if you
prefer: `git rm --cached release/*.apk` and add `release/*.apk` to `.gitignore`.
