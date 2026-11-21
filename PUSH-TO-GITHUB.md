# Putting Touchline Vale on GitHub

The repo in this folder is already committed and ready to push: one commit on `main`,
everything except `node_modules/` and `dist/` included. You only need to point it at
your GitHub repo.

## 1. Create the empty repo

Go to <https://github.com/new>, name it (e.g. `touchline-vale`), and **do not** tick
"Add a README", ".gitignore" or a licence — the folder already has content.
Copy the URL it shows you.

## 2. Point this folder at it and push

Open a terminal in this folder and run these five lines, replacing the URL with yours:

```
git remote set-url origin https://github.com/YOUR-USERNAME/touchline-vale.git
git branch -M main
git push -u origin main
```

Git will ask for a username and password. The password **must be a Personal Access
Token**, not your account password:

1. GitHub → your avatar → **Settings** → **Developer settings** → **Personal access
   tokens** → **Tokens (classic)** → **Generate new token**.
2. Tick the **repo** scope, generate, and copy the token.
3. Paste it when git asks for the password.

Or use the GitHub CLI instead, which handles the login for you:

```
gh auth login
gh repo create touchline-vale --public --source=. --remote=origin --push
```

## 3. Later changes

```
git add -A
git commit -m "what changed"
git push
```

## What is in the repo, and what is not

| Included | Why |
| --- | --- |
| `src/`, `index.html`, `vite.config.js`, `package.json`, lockfile | the game itself |
| `android/` | manifest, build script, icons — everything needed to rebuild the APK |
| `desktop/` | Electron wrapper |
| `tests/` | the 124-check smoke test and the packaged-file test |
| `docs/` | screenshots used by the README |
| `release/Touchline-Vale-1.0-universal-debug.apk` | a ready-to-install build |

`node_modules/` and `dist/` are ignored (rebuild with `npm install && npm run build`).

## Two things to decide before you push

* **The APK is in the repo (~350 KB).** Fine for a small project. If you would rather
  keep binaries out of git, add `release/*.apk` to `.gitignore`, delete it from the
  index with `git rm --cached release/*.apk`, and attach the APK to a GitHub *Release*
  instead.
* **Licence.** There is none yet. Without one, other people technically have no right
  to reuse the code. If you want it open, add an MIT `LICENSE` file; if you want it
  closed, say so and I will add a short "all rights reserved" notice.

## Publishing it as a playable page (optional)

The web build is a static bundle, so GitHub Pages can serve it: after pushing, go to
**Settings → Pages**, pick "Deploy from a branch", branch `main`, folder `/docs` — then
run `npm run build` and copy the contents of `dist/` into `docs/build/`. Say the word
and I will wire that up properly, including the base path, so the game is playable at
`https://YOUR-USERNAME.github.io/touchline-vale/`.
