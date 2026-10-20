use super::*;
use std::os::windows::io::AsRawSocket;
use windows_sys::Win32::Networking::WinSock::{
    WSAGetLastError, WSASendTo, AF_INET, AF_INET6, SOCKADDR, SOCKADDR_IN, SOCKADDR_IN6, WSABUF,
};

pub(super) fn run(input: &Value, phase: &str) -> Result<Value> {
    let mut raw_token = null_mut();
    let impersonation = if unsafe {
        OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut raw_token)
    } == 0
    {
        json!({"present":false,"rawOsError":std::io::Error::last_os_error().raw_os_error()})
    } else {
        let token = unsafe { owned(raw_token)? };
        json!({"present":true,"isAppContainer":token_u32(token.as_raw_handle(),TokenIsAppContainer)})
    };
    let mut results = Vec::new();
    for endpoint in input["endpoints"].as_array().ok_or("Missing endpoints")? {
        let target: std::net::SocketAddr = endpoint["udp"]
            .as_str()
            .ok_or("Missing UDP endpoint")?
            .parse()?;
        let explicit = std::net::SocketAddr::new(target.ip(), 0);
        let wildcard = if target.is_ipv4() {
            "0.0.0.0:0".parse()?
        } else {
            "[::]:0".parse()?
        };
        for (name, bind, method, hold) in [
            ("explicit-close", explicit, "send-to", 0),
            ("explicit-held", explicit, "send-to", 750),
            ("wildcard-held", wildcard, "send-to", 750),
            ("wildcard-connected", wildcard, "connect-send", 750),
            ("wildcard-wsasendto", wildcard, "wsa-send-to", 750),
        ] {
            let marker = format!(
                "w0/{}/udp-diagnosis/{phase}/{}/{name}",
                input["case"].as_str().unwrap(),
                endpoint["family"].as_str().unwrap()
            );
            let mut row = json!({"phase":phase,"family":endpoint["family"],"target":target.to_string(),"variant":name,"bind":bind.to_string(),"holdMs":hold,"marker":marker});
            match UdpSocket::bind(bind) {
                Err(e) => row["bindResult"] = io_result::<()>(Err(e)),
                Ok(socket) => {
                    row["bindResult"] = json!({"ok":true});
                    socket.set_read_timeout(Some(Duration::from_millis(200)))?;
                    row["localAfterBind"] = json!(socket.local_addr()?.to_string());
                    let start = Instant::now();
                    row["sendResult"] = match method {
                        "send-to" => io_result(socket.send_to(marker.as_bytes(), target)),
                        "connect-send" => match socket.connect(target) {
                            Ok(()) => {
                                row["connectResult"] = json!({"ok":true});
                                io_result(socket.send(marker.as_bytes()))
                            }
                            Err(e) => {
                                row["connectResult"] = io_result::<()>(Err(e));
                                json!({"notAttempted":true})
                            }
                        },
                        _ => wsa_send(&socket, marker.as_bytes(), target),
                    };
                    row["localAfterSend"] = json!(socket.local_addr()?.to_string());
                    if hold > 0 {
                        std::thread::sleep(Duration::from_millis(hold));
                        let mut buffer = [0; 512];
                        match socket.recv_from(&mut buffer) {
                            Ok((n, peer)) => {
                                row["reply"] = json!({"peer":peer.to_string(),"exactEcho":buffer[..n]==marker.as_bytes()[..]})
                            }
                            Err(e) => row["reply"] = io_result::<()>(Err(e)),
                        }
                    }
                    row["elapsedBeforeCloseMs"] = json!(start.elapsed().as_millis());
                }
            }
            results.push(row);
        }
    }
    Ok(
        json!({"pid":std::process::id(),"threadImpersonation":impersonation,"token":token_info(unsafe{GetCurrentProcess()})?,"phase":phase,"cases":results,"boundary":"Only controlled local endpoints. Held and immediate-close variants separate socket lifetime from API return and packet delivery; no policy changes."}),
    )
}
fn wsa_send(socket: &UdpSocket, data: &[u8], target: std::net::SocketAddr) -> Value {
    let mut buffer = WSABUF {
        len: data.len() as u32,
        buf: data.as_ptr() as *mut u8,
    };
    let mut sent = 0;
    let mut v4 = SOCKADDR_IN::default();
    let mut v6 = SOCKADDR_IN6::default();
    let (address, len): (*const SOCKADDR, i32) = match target {
        std::net::SocketAddr::V4(a) => {
            v4.sin_family = AF_INET;
            v4.sin_port = a.port().to_be();
            v4.sin_addr.S_un.S_addr = u32::from_ne_bytes(a.ip().octets());
            (
                (&v4 as *const SOCKADDR_IN).cast(),
                size_of::<SOCKADDR_IN>() as i32,
            )
        }
        std::net::SocketAddr::V6(a) => {
            v6.sin6_family = AF_INET6;
            v6.sin6_port = a.port().to_be();
            v6.sin6_addr.u.Byte = a.ip().octets();
            v6.Anonymous.sin6_scope_id = a.scope_id();
            (
                (&v6 as *const SOCKADDR_IN6).cast(),
                size_of::<SOCKADDR_IN6>() as i32,
            )
        }
    };
    let result = unsafe {
        WSASendTo(
            socket.as_raw_socket() as usize,
            &mut buffer,
            1,
            &mut sent,
            0,
            address,
            len,
            null_mut(),
            None,
        )
    };
    if result == 0 {
        json!({"ok":true,"bytes":sent})
    } else {
        json!({"ok":false,"wsaError":unsafe{WSAGetLastError()}})
    }
}
