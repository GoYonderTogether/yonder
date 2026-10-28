# Lucide exports

Geometry from official `lucide-react@1.61.0` (`https://github.com/lucide-icons/lucide`, `packages/lucide-react/dist/esm/icons/*.mjs`, `__iconData`). Exported icons: Pin, X, History, ArrowRight, ArrowLeft, Check, PanelsTopLeft. Source package ISC; ArrowLeft/ArrowRight/Check/X also have the applicable Feather MIT attribution in the unabridged LICENSE beside this file.

Reproduce with `node plugins/interaction/web/assets/lucide/export.mjs /path/to/node_modules/lucide-react`. The script verifies the package version, extracts its exported literal geometry and removes React-only keys. `build.mjs` inlines the generated sprite. No React, CDN or icon runtime is included. Brand artwork, QR, illustrations and basic status circles are deliberately outside this export.
