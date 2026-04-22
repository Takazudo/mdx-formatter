<!--
  "Formatter is innocent" baseline fixture (epic #80).

  This captures the exact loose-shape snippet observed in AI-authored content
  (e.g. `zudo-text/doc/src/content/docs/architecture/local-llm-search-spike.mdx`):
  each list item holds a short intro paragraph followed by a blank line, then
  a continuation paragraph at continuation indent.

  The associated test in `test/formatter.test.ts` runs the formatter with ALL
  four `list-normalize` rules set to `"off"` and asserts byte-equality with
  the input below. That's the repo-local assertion of the pre-rule finding
  from the epic: the formatter does not introduce these blank lines; they
  must already be present in the input to appear in the output.
-->

- No `candle`, `ort` / ONNX Runtime, `llama.cpp` / `llama-cpp-2`, `tch` / libtorch, or
  `rust-bert` dependency in `tauri-app/Cargo.toml` or `tauri-app/core/Cargo.toml`.
- No `gguf` / `.onnx` / `.safetensors` assets in the repo.
