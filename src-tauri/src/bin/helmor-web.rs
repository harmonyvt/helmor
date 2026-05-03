//! Standalone Helmor browser companion daemon.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

#[derive(Debug, Parser)]
#[command(name = "helmor-web", about = "Serve the Helmor web companion UI")]
struct Args {
    /// Address to bind. Defaults to localhost; expose via Tailscale/SSH proxy.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// Port to bind.
    #[arg(long, default_value_t = 17777)]
    port: u16,

    /// Override the Helmor data directory.
    #[arg(long, value_name = "DIR")]
    data_dir: Option<PathBuf>,

    /// Directory containing the built web frontend. Defaults to ./dist.
    #[arg(long, value_name = "DIR")]
    frontend_dir: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = Args::parse();
    if let Some(dir) = &args.data_dir {
        // SAFETY: this runs at process start before any worker threads are spawned.
        unsafe { std::env::set_var("HELMOR_DATA_DIR", dir) };
    }

    let host = match args.host.parse() {
        Ok(host) => host,
        Err(error) => {
            eprintln!("error: invalid --host '{}': {error}", args.host);
            return ExitCode::FAILURE;
        }
    };
    let addr = SocketAddr::new(host, args.port);

    let options = helmor_lib::web::WebServerOptions {
        addr,
        frontend_dir: args.frontend_dir,
    };

    match helmor_lib::web::serve(options).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}
