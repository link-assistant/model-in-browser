### Fixed
- Fixed second message sending fails with "cannot broadcast" error by resetting KV cache before each generation
- Added proper handling for ChatML special tokens (`<|im_end|>`, `<|im_start|>`) in model output

### Added
- Automatic model download on page load (no button click required)
- E2E test for multiple consecutive messages to verify the fix for issue #7
