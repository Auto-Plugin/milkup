#[path="../../../../apps/desktop/src-tauri/src/update_pe.rs"] mod pe;
use base64::{Engine, engine::general_purpose::STANDARD};
fn gate_fixture()->serde_json::Value {serde_json::from_str(include_str!("../../../../tests/fixtures/updates/version-gates.json")).unwrap()}
#[test]
fn version_gate_pe_truncation_invalid_offsets_cycles_and_ambiguous_resources_fail_closed() {
    let bytes = STANDARD
        .decode(gate_fixture()["pe"].as_str().unwrap())
        .unwrap();
    pe::verify(&bytes, "2.0.0-beta.2").unwrap();
    for end in 0..bytes.len() {
        assert!(
            pe::verify(&bytes[..end], "2.0.0-beta.2").is_err(),
            "truncated at {end}"
        );
    }
    for (offset, value) in [
        (0x3c, u32::MAX),              // PE header outside image
        (0x98 + 96 + 16, u32::MAX),    // RVA overflow
        (0x98 + 96 + 20, u32::MAX),    // resource limit
        (0x200 + 20, 0x80000000),      // cyclic resource directory
        (0x200 + 48 + 20, 0x80000000), // unexpected fourth directory level
        (0x200 + 72, u32::MAX),        // out-of-range version data
        (0x200 + 76, 65537),           // oversized version blob
    ] {
        let mut corrupt = bytes.clone();
        corrupt[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        assert!(
            pe::verify(&corrupt, "2.0.0-beta.2").is_err(),
            "offset {offset}"
        );
    }
    let mut duplicate = bytes.clone();
    duplicate[0x200 + 14..0x200 + 16].copy_from_slice(&2u16.to_le_bytes());
    let entry = duplicate[0x200 + 16..0x200 + 24].to_vec();
    duplicate[0x200 + 24..0x200 + 32].copy_from_slice(&entry);
    assert!(pe::verify(&duplicate, "2.0.0-beta.2").is_err());
    for unsupported in [b"PK\x03\x04".as_slice(), b"\xd0\xcf\x11\xe0", b"MZ", b""] {
        assert!(pe::verify(unsupported, "2.0.0-beta.2").is_err());
    }
    // Deterministic byte mutations exercise the parser's bounds without a fuzz
    // dependency. A mutation may be irrelevant; it must never panic.
    for offset in 0..bytes.len() {
        let mut changed = bytes.clone();
        changed[offset] ^= 0xff;
        let _ = pe::verify(&changed, "2.0.0-beta.2");
    }
}
#[test]
fn version_gate_accepts_pe32_plus_and_rejects_overlapping_sections() {
    let fixture = gate_fixture();
    let mut bytes = STANDARD.decode(fixture["pe64"].as_str().unwrap()).unwrap();
    pe::verify(&bytes, "2.0.0-beta.2").unwrap();
    bytes[0x86..0x88].copy_from_slice(&2u16.to_le_bytes());
    let header = bytes[0x188..0x188 + 40].to_vec();
    bytes[0x188 + 40..0x188 + 80].copy_from_slice(&header);
    assert!(pe::verify(&bytes, "2.0.0-beta.2").is_err());

    let first = STANDARD.decode(fixture["pe"].as_str().unwrap()).unwrap();
    let old = STANDARD.decode(fixture["oldPe"].as_str().unwrap()).unwrap();
    for (second, accepted) in [(&first, true), (&old, false)] {
        // Add a second language leaf with an independent version resource.
        // Both matching languages are accepted; one stale language is not.
        let first_block = &first[0x200 + 88..];
        let second_block = &second[0x200 + 88..];
        let second_start = (112 + first_block.len() + 3) & !3;
        let mut resources = first[0x200..0x200 + 72].to_vec();
        resources[62..64].copy_from_slice(&2u16.to_le_bytes());
        resources[68..72].copy_from_slice(&80u32.to_le_bytes());
        for word in [
            0x804u32,
            96,
            0x1000 + 112,
            first_block.len() as u32,
            0,
            0,
            0x1000 + second_start as u32,
            second_block.len() as u32,
            0,
            0,
        ] {
            resources.extend_from_slice(&word.to_le_bytes());
        }
        resources.extend_from_slice(first_block);
        resources.resize(second_start, 0);
        resources.extend_from_slice(second_block);
        let mut image = first[..0x200].to_vec();
        for offset in [0x98 + 96 + 20, 0x180, 0x188] {
            image[offset..offset + 4].copy_from_slice(&(resources.len() as u32).to_le_bytes());
        }
        image.extend_from_slice(&resources);
        assert_eq!(pe::verify(&image, "2.0.0-beta.2").is_ok(), accepted);
    }
}

#[test]
#[ignore = "requires this run's exact newly built Windows installer"]
fn exact_new_installer_version_rejects_stale_and_prerelease_stripped() {
    let file = std::env::var("MILKUP_PE_INSTALLER").expect("Exact installer required");
    let version = std::env::var("MILKUP_PE_VERSION").unwrap();
    assert_eq!(version, "2.0.0-beta.10");
    let bytes = std::fs::read(file).unwrap();
    pe::verify(&bytes, &version).unwrap();
    for wrong in ["2.0.0-beta.9", "2.0.0-beta.11", "2.0.0", "3.0.0-beta.10"] {
        assert!(pe::verify(&bytes, wrong).is_err());
    }
}
