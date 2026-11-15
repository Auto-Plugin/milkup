use base64::Engine;
use pki_types::{pem::PemObject, CertificateDer, ServerName, UnixTime};
fn signature_contract(root: &std::path::Path) {
    let json = |name: &str| -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(root.join(name)).unwrap()).unwrap()
    };
    let decode = |text: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(text)
            .unwrap()
    };
    let config = json("public-fixture.json");
    let key = minisign_verify::PublicKey::decode(
        &String::from_utf8(decode(config["channel"]["publicKey"].as_str().unwrap())).unwrap(),
    )
    .unwrap();
    let check = |bytes: &[u8], sig: &str| {
        key.verify(
            bytes,
            &minisign_verify::Signature::decode(&String::from_utf8(decode(sig)).unwrap()).unwrap(),
            true,
        )
    };
    let wrong = json("wrong-manifest.json");
    let error = check(
        &decode(wrong["payload"].as_str().unwrap()),
        wrong["signature"].as_str().unwrap(),
    )
    .unwrap_err();
    assert_eq!(error.to_string(), "The signature verification failed");
    let valid = json("accepted-manifest.json");
    let payload = decode(valid["payload"].as_str().unwrap());
    check(&payload, valid["signature"].as_str().unwrap()).unwrap();
    let statement: serde_json::Value = serde_json::from_slice(&payload).unwrap();
    let signature = statement["release"]["platforms"]["linux-x86_64"]["signature"]
        .as_str()
        .unwrap();
    let mut package = std::fs::read(root.join("inert-package.bin")).unwrap();
    check(&package, signature).unwrap();
    *package.last_mut().unwrap() ^= 1;
    assert_eq!(
        check(&package, signature).unwrap_err().to_string(),
        "The signature verification failed"
    );
    println!("actual fixture minisign: good manifest/package passed; wrong authority/corrupt bytes rejected with exact signature error");
}
fn verify(cert: &CertificateDer<'_>) -> Result<(), webpki::Error> {
    let anchor = webpki::anchor_from_trusted_cert(cert)?;
    let anchors = [anchor];
    let leaf = webpki::EndEntityCert::try_from(cert)?;
    leaf.verify_for_usage(
        webpki::ALL_VERIFICATION_ALGS,
        &anchors,
        &[],
        UnixTime::now(),
        webpki::KeyUsage::server_auth(),
        None,
        None,
    )?;
    leaf.verify_is_valid_for_subject_name(&ServerName::try_from("127.0.0.1").unwrap())?;
    assert!(leaf
        .verify_is_valid_for_subject_name(&ServerName::try_from("127.0.0.2").unwrap())
        .is_err());
    Ok(())
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    assert_eq!(args.len(), 3);
    let old = CertificateDer::from_pem_file(&args[1]).unwrap();
    let actual = CertificateDer::from_pem_file(&args[2]).unwrap();
    assert_eq!(verify(&old), Err(webpki::Error::CaUsedAsEndEntity));
    assert_eq!(verify(&actual), Ok(()));
    println!("legacy CA leaf: CaUsedAsEndEntity; actual fixture leaf: trusted signature/time/serverAuth/127.0.0.1 passed; wrong IP rejected");
    signature_contract(std::path::Path::new(&args[2]).parent().unwrap());
}
