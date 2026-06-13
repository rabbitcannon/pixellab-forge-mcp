# Releasing

How to cut a new release of `pixellab-forge-mcp`.

## Distribution overview

| Target | Package name | How it publishes |
|--------|--------------|------------------|
| [npmjs.org](https://www.npmjs.com/package/pixellab-forge-mcp) (canonical — what `npx`/`npm install` use) | `pixellab-forge-mcp` | **Manual** `npm publish` (2FA/OTP-gated) |
| [GitHub Packages](https://github.com/rabbitcannon/pixellab-forge-mcp/pkgs/npm/pixellab-forge-mcp) (mirror) | `@rabbitcannon/pixellab-forge-mcp` | **Automatic** via `.github/workflows/publish-gpr.yml` on `release: published` |

GitHub Packages requires scoped names, so the mirror is published under the
`@rabbitcannon` scope. The unscoped npmjs.org package is the one users install.

## Prerequisites

- npm: logged in as `rabbitcannon` (`npm whoami`) with your 2FA authenticator handy.
- GitHub: `gh auth status` logged in. `main` is protected by the "Main protection"
  ruleset; the **Repository admin** role is a standing bypass actor, so `--admin`
  merges work for the owner.
- Git identity is already set locally (`rabbitcannon`). Do **not** add co-author
  trailers to commits.

## Steps

### 1. Bump the version

```bash
npm version <major|minor|patch> --no-git-tag-version
```

Use **minor** for new tools/features, **patch** for fixes, **major** for breaking
changes. npm will reject a publish if the version already exists.

### 2. Build, test, and verify the package contents

```bash
npm run build
npm test                # expect all tests passing
npm publish --dry-run   # validate the tarball without publishing (no auth needed)
```

### 3. Update the changelog, then commit via a PR (main is protected)

Add a `## [X.Y.Z] - YYYY-MM-DD` entry at the top of [CHANGELOG.md](CHANGELOG.md)
(newest first), grouped under Added / Changed / Fixed / Security, and add the
matching link reference at the bottom of the file.

```bash
git checkout -b release/vX.Y.Z
git add -A                      # note: CLAUDE.md is gitignored and stays untracked
git commit -m "vX.Y.Z - <summary of changes>"
git push -u origin release/vX.Y.Z
gh pr create --base main --title "vX.Y.Z - <summary>" --body "<notes>"
gh pr merge --squash --admin --delete-branch
git checkout main && git pull origin main
```

Keep commit messages descriptive (no "fix"/"update"/"changes").

### 4. Create the GitHub release (this auto-publishes to GitHub Packages)

```bash
gh release create vX.Y.Z --target main --title "vX.Y.Z" --notes "<release notes>"
```

Publishing the release triggers `publish-gpr.yml`, which builds and publishes
`@rabbitcannon/pixellab-forge-mcp@X.Y.Z` to GitHub Packages using the built-in
`GITHUB_TOKEN`. Confirm the run is green:

```bash
gh run list --workflow=publish-gpr.yml --limit 1
```

Optionally attach the npm tarball to the release:

```bash
npm pack --pack-destination /tmp/
gh release upload vX.Y.Z /tmp/pixellab-forge-mcp-X.Y.Z.tgz
```

### 5. Publish to npmjs.org (manual — 2FA gated)

```bash
npm publish --otp=<your-6-digit-code>
```

This step is intentionally not automated (it requires a one-time password from
your authenticator). On success you'll see `+ pixellab-forge-mcp@X.Y.Z`.

### 6. Verify

```bash
# npmjs (the local `npm view` cache can lag a minute — query the registry directly)
curl -s https://registry.npmjs.org/pixellab-forge-mcp \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('latest:', d['dist-tags']['latest'])"
```

`latest` should report the new version.

## Notes

- **`main` protection bypass:** the standing "Repository admin → Always" bypass on
  the ruleset is what allows `--admin` merges. If you ever remove it, releases will
  need a separate approving review on each PR.
- **GitHub Packages mirror is optional to consumers:** installing from it requires a
  GitHub token in `.npmrc`. The setup instructions in the README deliberately point
  at npmjs.org only.
- **Re-running the GPR workflow for an already-published version fails** with a 409
  (version exists). Only bump-then-release produces a new GitHub Packages version.
