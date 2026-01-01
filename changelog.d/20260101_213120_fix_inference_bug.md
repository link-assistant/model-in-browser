### Fixed

- Fixed browser inference "Repeat penalty failed: unexpected rank" error that occurred when generating text. The bug was caused by incorrectly attempting to index into the logits tensor after the Llama model's forward pass, which already extracts the last position internally.

### Added

- Added Playwright e2e tests to verify browser inference works correctly
- Added GitHub Actions workflow for running e2e tests on PRs and main branch
