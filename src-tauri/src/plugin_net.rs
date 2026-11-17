// Network requests of plugins (#280), performed by the app on their behalf. The web view has already checked
// the request against the plugin's manifest and the user's consent (src/plugins/net.ts) and built the URL from the
// declared server; here the request itself is made safely:
// - HTTPS only, to a host name (no IP address in the URL),
// - the name must resolve to public addresses only: no loopback, private, link-local or other local networks,
//   checked by the resolver reqwest connects with (so a name cannot switch to a local address afterwards),
// - no redirects, no cookies, no credentials, no referrer; a fixed User-Agent,
// - a time limit and a size limit for the answer.
// Errors come back as short codes (net-local, net-failed, net-too-large) that the web view hands to the plugin.
use std::error::Error as StdError;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchReq {
    url: String,
    method: String,
    body: Option<String>,
    max_bytes: usize,
    timeout_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRes {
    status: u16,
    content_type: String,
    /// Base64 of the answer
    body: String,
}

/// Upper limits whatever the web view asks for
const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_TIMEOUT_MS: u64 = 30_000;

/// Whether an address is on the public internet (not this computer, the local network or a reserved range)
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => {
            let o = a.octets();
            !(a.is_loopback()
                || a.is_private()
                || a.is_link_local()
                || a.is_broadcast()
                || a.is_documentation()
                || a.is_unspecified()
                || a.is_multicast()
                || o[0] == 0
                // Shared address space (carrier-grade NAT) 100.64.0.0/10
                || (o[0] == 100 && (o[1] & 0xc0) == 64)
                // Benchmarking 198.18.0.0/15, reserved 240.0.0.0/4
                || (o[0] == 198 && (o[1] & 0xfe) == 18)
                || o[0] >= 240
                // IETF protocol assignments 192.0.0.0/24
                || (o[0] == 192 && o[1] == 0 && o[2] == 0))
        }
        IpAddr::V6(a) => {
            if let Some(v4) = a.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let s = a.segments();
            !(a.is_loopback()
                || a.is_unspecified()
                || a.is_multicast()
                // Unique local fc00::/7, link-local fe80::/10, documentation 2001:db8::/32
                || (s[0] & 0xfe00) == 0xfc00
                || (s[0] & 0xffc0) == 0xfe80
                || (s[0] == 0x2001 && s[1] == 0x0db8)
                // IPv4-compatible and NAT64 well-known prefix 64:ff9b::/96 (may lead to local IPv4 addresses)
                || (s[0..6] == [0, 0, 0, 0, 0, 0])
                || (s[0] == 0x64 && s[1] == 0xff9b))
        }
    }
}

/// Resolver that only hands public addresses to the connection
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let found: Vec<SocketAddr> = tauri::async_runtime::spawn_blocking(move || (host.as_str(), 0).to_socket_addrs().map(|a| a.collect::<Vec<_>>()))
                .await
                .map_err(|e| -> Box<dyn StdError + Send + Sync> { e.to_string().into() })?
                .map_err(|e| Box::new(e) as Box<dyn StdError + Send + Sync>)?;
            let public: Vec<SocketAddr> = found.into_iter().filter(|a| is_public(a.ip())).collect();
            if public.is_empty() {
                return Err("net-local".into());
            }
            Ok(Box::new(public.into_iter()) as Addrs)
        })
    }
}

fn client() -> Result<reqwest::Client, String> {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
    });
    reqwest::Client::builder()
        .user_agent(concat!("KizamuBeam/", env!("CARGO_PKG_VERSION"), " (+https://github.com/KizamuBeam/kizamubeam)"))
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .no_proxy()
        .https_only(true)
        .dns_resolver(Arc::new(PublicOnly))
        .build()
        .map_err(|_| "net-failed".to_string())
}

/// The URL must be HTTPS to a host name; an IP address is refused here already
pub fn allowed_url(url: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url).map_err(|_| "net-failed".to_string())?;
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return Err("net-failed".into());
    }
    let host = u.host_str().ok_or("net-failed")?.to_ascii_lowercase();
    if host.starts_with('[') || host.parse::<IpAddr>().is_ok() || host == "localhost" || host.ends_with(".localhost") {
        return Err("net-local".into());
    }
    if !host.contains('.') {
        return Err("net-failed".into());
    }
    Ok(u)
}

fn base64(b: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(ABC[(n >> 18 & 63) as usize] as char);
        out.push(ABC[(n >> 12 & 63) as usize] as char);
        out.push(if c.len() > 1 { ABC[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if c.len() > 2 { ABC[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[tauri::command]
pub async fn plugin_fetch(req: FetchReq) -> Result<FetchRes, String> {
    let url = allowed_url(&req.url)?;
    let max = req.max_bytes.min(MAX_BYTES);
    let timeout = Duration::from_millis(req.timeout_ms.min(MAX_TIMEOUT_MS));
    let c = client()?;
    let rb = match req.method.as_str() {
        "GET" => c.get(url),
        "POST" => c.post(url).header("Content-Type", "application/x-www-form-urlencoded").body(req.body.unwrap_or_default()),
        _ => return Err("net-method".into()),
    };
    let mut res = rb.timeout(timeout).send().await.map_err(|e| {
        // The resolver's refusal of local addresses keeps its own code
        let mut src: Option<&dyn StdError> = Some(&e);
        while let Some(s) = src {
            if s.to_string() == "net-local" {
                return "net-local".to_string();
            }
            src = s.source();
        }
        "net-failed".to_string()
    })?;
    if res.content_length().is_some_and(|n| n as usize > max) {
        return Err("net-too-large".into());
    }
    let status = res.status().as_u16();
    let content_type = res.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| "net-failed".to_string())? {
        if body.len() + chunk.len() > max {
            return Err("net-too-large".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(FetchRes { status, content_type, body: base64(&body) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses_are_refused() {
        for a in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.178.48", "169.254.1.1", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.1.1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "::a00:1"] {
            assert!(!is_public(a.parse().unwrap()), "{a}");
        }
        for a in ["1.1.1.1", "140.82.112.3", "2a00:1450:4001::1", "::ffff:8.8.8.8"] {
            assert!(is_public(a.parse().unwrap()), "{a}");
        }
    }

    #[test]
    fn urls() {
        assert!(allowed_url("https://nominatim.openstreetmap.org/search?q=Berlin").is_ok());
        assert_eq!(allowed_url("https://192.168.178.48/").unwrap_err(), "net-local");
        assert_eq!(allowed_url("https://[::1]/").unwrap_err(), "net-local");
        assert!(allowed_url("http://example.org/").is_err());
        assert!(allowed_url("https://user:pw@example.org/").is_err());
        assert_eq!(allowed_url("https://localhost/").unwrap_err(), "net-local");
        assert!(allowed_url("https://fluidnc.local/").is_ok(), "mDNS names resolve to local addresses and are refused when connecting");
    }

    #[test]
    fn base64_matches() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
    }
}
