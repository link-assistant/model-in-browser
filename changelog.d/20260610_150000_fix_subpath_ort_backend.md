---
bump: patch
---

### Fixed
- Model loading on GitHub Pages **project-site** (sub-path) deployments
  (`/<repo>/`). ONNX Runtime Web's WASM glue was requested from the origin root
  (`/ort/…`) instead of the deployment sub-path (`/<repo>/ort/…`), causing
  `Error: no available backend found. ERR: [wasm] importing a module script
  failed` and a non-functional app. The ORT `wasmPaths` base is now resolved from
  the Vite base / worker-relative path so it is correct under any sub-path
  (issue #13).

### Added
- A `?debug=1` / `localStorage.mib_debug` verbose mode that logs the resolved ORT
  base path from both the app and the worker, to make any future asset-path
  problem self-diagnosing.
- Sub-path deployment regression coverage: a dedicated static server
  (`e2e/subpath-server.mjs`) reproducing the GitHub Pages project-site layout, a
  Playwright `chromium-subpath` project + spec (`e2e/subpath.spec.ts`), and a
  browser-commander e2e test (`e2e/browser-commander/subpath-load.mjs`,
  `npm run test:e2e:bc`) that load SmolLM2 135M Instruct under the sub-path.
