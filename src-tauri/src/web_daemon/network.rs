use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WebReachability {
    pub(crate) open_url: String,
    pub(crate) reachable_urls: Vec<String>,
}

pub(crate) fn web_reachability(host: &str, port: u16) -> WebReachability {
    let host = host.trim();
    if is_unspecified_host(host) {
        let mut addresses = local_interface_addresses();
        addresses.sort_by_key(|address| match address {
            IpAddr::V4(ip) if is_tailscale_ipv4(*ip) => 0,
            IpAddr::V4(ip) if ip.is_loopback() => 2,
            IpAddr::V6(ip) if ip.is_loopback() => 2,
            _ => 1,
        });
        addresses.dedup();

        let mut urls = addresses
            .into_iter()
            .map(|address| format_url(address, port))
            .collect::<Vec<_>>();
        if !urls
            .iter()
            .any(|url| url == &format!("http://127.0.0.1:{port}"))
        {
            urls.push(format!("http://127.0.0.1:{port}"));
        }
        urls.dedup();
        let open_url = urls
            .first()
            .cloned()
            .unwrap_or_else(|| format!("http://127.0.0.1:{port}"));
        return WebReachability {
            open_url,
            reachable_urls: urls,
        };
    }

    let url = format!("http://{}:{port}", display_host(host));
    WebReachability {
        open_url: url.clone(),
        reachable_urls: vec![url],
    }
}

fn is_unspecified_host(host: &str) -> bool {
    host.parse::<IpAddr>()
        .map(|address| address.is_unspecified())
        .unwrap_or(false)
}

fn format_url(address: IpAddr, port: u16) -> String {
    match address {
        IpAddr::V4(ip) => format!("http://{ip}:{port}"),
        IpAddr::V6(ip) => format!("http://[{ip}]:{port}"),
    }
}

fn display_host(host: &str) -> String {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V6(ip)) => format!("[{ip}]"),
        _ => host.to_string(),
    }
}

fn is_tailscale_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

fn local_interface_addresses() -> Vec<IpAddr> {
    let mut addresses = interface_addresses();
    if !addresses.iter().any(|address| address.is_loopback()) {
        addresses.push(IpAddr::V4(Ipv4Addr::LOCALHOST));
    }
    addresses
}

#[cfg(unix)]
fn interface_addresses() -> Vec<IpAddr> {
    use std::ptr;

    let mut ifaddrs = ptr::null_mut();
    // SAFETY: getifaddrs initializes a linked list owned by libc when it returns 0.
    if unsafe { libc::getifaddrs(&mut ifaddrs) } != 0 || ifaddrs.is_null() {
        return Vec::new();
    }

    let mut addresses = BTreeSet::new();
    let mut cursor = ifaddrs;
    while !cursor.is_null() {
        // SAFETY: cursor points into the getifaddrs list until freeifaddrs below.
        let ifaddr = unsafe { &*cursor };
        if !ifaddr.ifa_addr.is_null() {
            // SAFETY: ifa_addr is valid for this node and can be inspected by family.
            let family = unsafe { (*ifaddr.ifa_addr).sa_family as i32 };
            if family == libc::AF_INET {
                // SAFETY: AF_INET addresses are sockaddr_in values.
                let sockaddr = unsafe { *(ifaddr.ifa_addr as *const libc::sockaddr_in) };
                let ip = Ipv4Addr::from(u32::from_be(sockaddr.sin_addr.s_addr));
                addresses.insert(IpAddr::V4(ip));
            } else if family == libc::AF_INET6 {
                // SAFETY: AF_INET6 addresses are sockaddr_in6 values.
                let sockaddr = unsafe { *(ifaddr.ifa_addr as *const libc::sockaddr_in6) };
                addresses.insert(IpAddr::V6(sockaddr.sin6_addr.s6_addr.into()));
            }
        }
        cursor = ifaddr.ifa_next;
    }

    // SAFETY: ifaddrs came from a successful getifaddrs call above.
    unsafe { libc::freeifaddrs(ifaddrs) };
    addresses.into_iter().collect()
}

#[cfg(not(unix))]
fn interface_addresses() -> Vec<IpAddr> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tailscale_ipv4_range_is_detected() {
        assert!(is_tailscale_ipv4(Ipv4Addr::new(100, 118, 99, 70)));
        assert!(is_tailscale_ipv4(Ipv4Addr::new(100, 64, 0, 1)));
        assert!(is_tailscale_ipv4(Ipv4Addr::new(100, 127, 255, 254)));
        assert!(!is_tailscale_ipv4(Ipv4Addr::new(100, 128, 0, 1)));
        assert!(!is_tailscale_ipv4(Ipv4Addr::new(192, 168, 1, 2)));
    }

    #[test]
    fn concrete_ipv6_host_is_bracketed() {
        let reachability = web_reachability("::1", 18436);
        assert_eq!(reachability.open_url, "http://[::1]:18436");
        assert_eq!(reachability.reachable_urls, vec!["http://[::1]:18436"]);
    }

    #[test]
    fn wildcard_host_never_uses_unspecified_address_as_open_url() {
        let reachability = web_reachability("0.0.0.0", 18436);
        assert!(!reachability.open_url.contains("0.0.0.0"));
        assert!(!reachability
            .reachable_urls
            .iter()
            .any(|url| url.contains("0.0.0.0")));
        assert!(reachability
            .reachable_urls
            .iter()
            .any(|url| url == "http://127.0.0.1:18436"));
    }
}
