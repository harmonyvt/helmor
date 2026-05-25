//! BLAKE3 content hashing for code-graph cache keys.

/// Hex-encoded BLAKE3 digest of the given bytes.
pub fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_bytes_hash_is_stable() {
        let h = hash_bytes(b"");
        // BLAKE3 of empty string — checking stability, not the literal.
        assert_eq!(h.len(), 64);
        assert_eq!(h, hash_bytes(b""));
    }

    #[test]
    fn different_bytes_produce_different_hashes() {
        assert_ne!(hash_bytes(b"a"), hash_bytes(b"b"));
    }
}
