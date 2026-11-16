# Hole plate (example plugin, Rust/WebAssembly)

A plate with a square or hexagonal pattern of round or hexagonal holes. It shows the plugin ABI described in [docs/plugins.md](../../docs/plugins.md).

Build:

```sh
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/kzb_hole_plate.wasm dist/hole-plate.wasm
```

`dist/hole-plate.wasm` is checked in, because `npm run test:plugins` uses it and CI does not build Rust for it.
