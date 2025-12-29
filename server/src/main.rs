//! Local development server for the browser-based LLM demo.
//!
//! This server provides:
//! - Static file serving for the web application
//! - CORS headers for local development
//! - Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers
//!   required for SharedArrayBuffer (used by some WASM features)

use axum::Router;
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

/// Local development server for the browser-based LLM demo.
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Port to listen on
    #[arg(short, long, default_value_t = 8080)]
    port: u16,

    /// Directory to serve static files from
    #[arg(short, long, default_value = "../web/dist")]
    dir: PathBuf,

    /// Enable verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // Initialize logging
    let log_level = if args.verbose {
        Level::DEBUG
    } else {
        Level::INFO
    };

    let subscriber = FmtSubscriber::builder().with_max_level(log_level).finish();

    tracing::subscriber::set_global_default(subscriber).expect("Failed to set tracing subscriber");

    // Verify the static directory exists
    if !args.dir.exists() {
        eprintln!(
            "Error: Static directory '{}' does not exist.",
            args.dir.display()
        );
        eprintln!("Make sure to build the web application first:");
        eprintln!("  cd ../web && npm run build");
        std::process::exit(1);
    }

    // Setup CORS for local development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Create the router with static file serving
    let app = Router::new()
        .nest_service("/", ServeDir::new(&args.dir))
        .layer(cors)
        .layer(tower::ServiceBuilder::new().map_response(
            |mut response: axum::response::Response| {
                // Add headers required for SharedArrayBuffer
                response
                    .headers_mut()
                    .insert("Cross-Origin-Opener-Policy", "same-origin".parse().unwrap());
                response.headers_mut().insert(
                    "Cross-Origin-Embedder-Policy",
                    "require-corp".parse().unwrap(),
                );
                response
            },
        ));

    let addr = SocketAddr::from(([127, 0, 0, 1], args.port));

    info!("Starting server at http://{}", addr);
    info!("Serving files from: {}", args.dir.display());
    info!("Press Ctrl+C to stop");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind to address");

    axum::serve(listener, app).await.expect("Server failed");
}
