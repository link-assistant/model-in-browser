//! CLI for the browser-based LLM project.
//!
//! This binary provides information about the project and can be used
//! for local testing.

use model_in_browser::{add, delay, multiply};

#[tokio::main]
async fn main() {
    println!("Model in Browser v{}", model_in_browser::VERSION);
    println!();
    println!("This project enables running SmolLM2 language model");
    println!("directly in web browsers via WebAssembly.");
    println!();

    // Quick functionality test
    println!("Quick self-test:");
    println!("  2 + 3 = {}", add(2, 3));
    println!("  2 * 3 = {}", multiply(2, 3));
    println!();

    println!("Testing async functionality...");
    delay(0.5).await;
    println!("Async test complete!");
    println!();

    println!("To start the web application:");
    println!("  1. Build the WASM package: ./scripts/build-wasm.sh");
    println!("  2. Start the dev server:   cd web && npm run dev");
    println!();
    println!("For the production server:");
    println!("  cargo run --manifest-path server/Cargo.toml");
}
