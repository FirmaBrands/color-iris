# Deploying Color Iris to GitHub Pages

Everything is already set up:

- Git repo initialized, all files committed to the `main` branch (`node_modules` excluded).
- `vite.config.ts` has `base: "/color-iris/"` — correct for a project page at
  `https://firmabrands.github.io/color-iris/`.
- `.github/workflows/deploy.yml` builds the site and deploys it on every push to `main`.

## What you need to do (2 steps, on your Mac)

These steps need your GitHub login, so they run from your own terminal.

### 1. Push the code

Open Terminal, then:

```bash
cd ~/Desktop/color-iris
bash push-to-github.sh
```

(The script first clears two harmless stale lock files left over from setup,
commits the helper files, then pushes.)

If prompted to log in, use a GitHub Personal Access Token as the password
(github.com → Settings → Developer settings → Personal access tokens),
or install the GitHub CLI and run `gh auth login` first.

### 2. Turn on Pages

Go to https://github.com/FirmaBrands/color-iris/settings/pages
and set **Source** to **GitHub Actions**.

That's it. The workflow runs automatically (watch it under the repo's **Actions**
tab). When it finishes, your site is live at:

**https://firmabrands.github.io/color-iris/**

## Updating later

Any time you push to `main`, the site rebuilds and redeploys automatically:

```bash
git add -A && git commit -m "your message" && git push
```
