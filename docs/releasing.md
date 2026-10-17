# Releasing dwio

This page is for maintainers. It tells you how to make a release and how to publish the npm package.

## Make a release

1. Change `version` in `package.json`.
2. Run `bun run check`.
3. Commit with `chore(release): X.Y.Z` and push to `main`.
4. Make a tag and push it:

   ```sh
   git tag -s vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

The tag starts the `release` workflow (`.github/workflows/release.yml`). The workflow does these steps:

1. It checks that the tag is the same as the version in `package.json`.
2. It runs the type check and the tests.
3. It builds the program files for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64).
4. It makes a `SHA256SUMS` file.
5. It publishes all of these files on the [Releases page](https://github.com/griimick/dwio/releases).
6. If the repository variable `NPM_PUBLISH` is `true`, it also publishes the npm package.

The install script (`install.sh`) always installs the newest release.

### Check the release

After the workflow finishes, test the installer in an empty folder:

```sh
curl -fsSL https://raw.githubusercontent.com/griimick/dwio/main/install.sh | DWIO_INSTALL_DIR=/tmp/dwio-test sh
/tmp/dwio-test/dwio --version
```

The version must be the new version.

## Publish to npm

The package name is `@griimick/dwio`. The command that it installs is `dwio`.

The unscoped name `dwio` is not possible. npm blocks names that are too close to the names of popular packages (`swig` and `twig`). The name `drawsync` was also refused, because it is too close to `deasync`.

### Set up (one time)

1. Log in with `npm login`.
2. In the project folder, run `npm publish --access public`. A scoped package is private unless you set `--access public`. The first publish must be a manual one.
3. On npmjs.com, open the package settings. Under **Trusted publisher**, add GitHub Actions with these values: owner `griimick`, repository `dwio`, workflow `release.yml`.
4. On GitHub, open **Settings**, **Secrets and variables**, **Actions**, **Variables**. Add the variable `NPM_PUBLISH` with the value `true`.

After this, each release tag also publishes the npm package. The package has a provenance mark. The `npm` job in `release.yml` does the work. No token is necessary.

### Rules to remember

- npm never accepts the same version two times. Change the version for each release.
- Do not unpublish the whole package. After you remove all versions, npm blocks the name for 24 hours, and publish commands fail with the error `E409`. The removed versions can never be used again.
- If you do not want the npm job to run, keep `NPM_PUBLISH` unset. The binaries are published in all cases.

### Test the package before you publish

```sh
bun run build:npm
npm pack --pack-destination /tmp
npx --yes /tmp/griimick-dwio-X.Y.Z.tgz --version
```
