# Windows owner-only pipe prebuilds

This is first-party source, built with the Windows SDK and official Node 22.19.0
headers/import library. Normal `npm ci`/source installation must not compile it
or download a binary from another service. Both architectures ship with the
reviewed source tag under `packages/sdk/native/win32-{x64,arm64}/` and are included
in the SDK package.

The component uses Node-API 8, plus Node's exported libuv descriptor functions.
The bootstrap workflow actually loads and exercises each binary on Node 22.19,
24 and 26 on native x64/ARM64 runners; Node-API alone is not proof of libuv export
compatibility. `/MT` avoids requiring users to install a Visual C++ runtime.

## Rebuild only when native inputs change

1. Commit the C++ source, build script and verifier together. The
   `Windows native prebuild` workflow runs for their changes on `main`, or via
   `workflow_dispatch`. It needs no new secret or write permission.
2. Require both architecture jobs and their smoke tests to succeed for that
   exact trusted **main** commit. Download their `windows-native-<arch>-<sha>`
   artifacts; never promote an artifact from a pull-request/fork run.
3. Copy each artifact's `owner-pipe.node` and `manifest.json` to the matching SDK
   native directory. Check `sourceCommit` against the successful workflow's SHA.
   Run `npm run check:windows-native`, then commit the two binary/manifest pairs.
4. The normal Windows CI must also smoke the **committed** binaries, not only a
   freshly compiled substitute. A successful compile does not prove that the
   distributed file is the right one.

For a maintainer build on Windows with Visual Studio C++ tools and Windows SDK:

```powershell
./scripts/windows-native/build.ps1 -Arch x64 # or arm64
node scripts/windows-native/artifacts.mjs verify x64
node scripts/windows-native/pipe.test.mjs packages/sdk/native/win32-x64/owner-pipe.node
```

The manifest binds canonical LF source hashes, builder/verifier hashes, interface
version, architecture, binary SHA256, source commit, official Node input hashes,
and MSVC/SDK versions. The build checks the downloads against official Node
`SHASUMS256.txt`. `/Brepro` removes the linker's nondeterministic timestamp, but
bit-identical output across different compiler/SDK versions is not promised.

Unrelated Yonder version bumps do **not** rebuild this component: the source
content identity stays the same. The release tag contains the exact manifests
and binaries that source installation and `npm pack` use; the release workflow
and installer do not need an additional download path.

The root build verifies both committed prebuilds offline before compiling the
TypeScript. Required Windows CI jobs smoke the committed binary on Node 22.19,
24 and 26; the separate bootstrap workflow rebuilds from native sources.

Initial prebuild provenance: successful main workflow run
[41379100526](https://github.com/GoYonderTogether/yonder/actions/runs/41379100526),
commit `505bedbb7d0c1c63914d94b6698674795199684e`. Both architectures passed all
nine smoke tests on all three Node versions. This component-level validation
does not replace the control/channel integration or cross-account acceptance.
