use super::*;
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::JoinHandle,
};

pub(super) struct Endpoints {
    pub addresses: Vec<Value>,
    pub dns_enabled: bool,
    case: Arc<Mutex<String>>,
    events: Arc<Mutex<Vec<Value>>>,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}
impl Endpoints {
    pub fn new() -> Result<Self> {
        let mut result = Self {
            addresses: Vec::new(),
            dns_enabled: false,
            case: Arc::new(Mutex::new("setup".to_string())),
            events: Arc::new(Mutex::new(Vec::new())),
            stop: Arc::new(AtomicBool::new(false)),
            threads: Vec::new(),
        };
        let mut bindings = vec![
            ("ipv4".to_string(), "127.0.0.1:0".to_string()),
            ("ipv6".to_string(), "[::1]:0".to_string()),
        ];
        if std::env::var("MILKUP_W0_UDP_DIAGNOSIS").as_deref() == Ok("1") {
            if let Ok(address) = std::env::var("MILKUP_W0_LOCAL_IPV4") {
                let ip: std::net::Ipv4Addr = address.parse()?;
                if !ip.is_private() {
                    return Err(
                        "Non-loopback control must be an assigned private IPv4 address".into(),
                    );
                }
                bindings.push(("nic-ipv4".to_string(), format!("{ip}:0")));
            }
        }
        for (family, bind) in bindings {
            let tcp = TcpListener::bind(&bind)?;
            let udp = UdpSocket::bind(&bind)?;
            tcp.set_nonblocking(true)?;
            udp.set_nonblocking(true)?;
            result.addresses.push(json!({"family":family,"tcp":tcp.local_addr()?.to_string(),"udp":udp.local_addr()?.to_string()}));
            let udp_family = family.clone();
            let stop = result.stop.clone();
            let events = result.events.clone();
            let case = result.case.clone();
            result.threads.push(std::thread::spawn(move || {
                let start = Instant::now();
                while !stop.load(Ordering::SeqCst) {
                    match tcp.accept() {
                        Ok((mut connection, peer)) => {
                            let mut data=vec![0;8192];
                            let _=connection.set_read_timeout(Some(Duration::from_millis(500)));
                            let _=connection.set_write_timeout(Some(Duration::from_millis(500)));
                            let read=connection.read(&mut data);
                            let request=read.as_ref().ok().map(|n|String::from_utf8_lossy(&data[..*n]).to_string());
                            events.lock().unwrap().push(json!({"transport":"tcp","case":case.lock().unwrap().clone(),"family":family,"elapsedMs":start.elapsed().as_millis(),"peer":peer.to_string(),"request":request,"readError":read.err().map(|e|e.to_string())}));
                            // Every response is self-created; no proxy, redirect, or third-party resource.
                            let body="<!doctype html><meta charset=utf-8><p id=canary>controlled-network-canary</p>";
                            let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nConnection: close\r\n\r\n{body}",body.len());
                            let _=connection.write_all(response.as_bytes());
                        }
                        Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{},
                        Err(e)=>{events.lock().unwrap().push(json!({"transport":"tcp","family":family,"listenerError":e.to_string()}));break;}
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }));
            let stop = result.stop.clone();
            let events = result.events.clone();
            let case = result.case.clone();
            result.threads.push(std::thread::spawn(move || {
                let family=udp_family;
                let start=Instant::now();
                let mut data=[0;2048];
                while !stop.load(Ordering::SeqCst) {
                    match udp.recv_from(&mut data) {
                        Ok((n,peer))=>{
                            let stun=n>=20 && data[4..8]==[0x21,0x12,0xa4,0x42];
                            let username=if stun {turn_username(&data[..n])}else{None};
                            events.lock().unwrap().push(json!({"transport":"udp","case":case.lock().unwrap().clone(),"socketOwners":udp_owners(peer),"family":family,"elapsedMs":start.elapsed().as_millis(),"peer":peer.to_string(),"bytes":n,"stunMagicCookie":stun,"turnUsername":username,"prefixHex":data[..n.min(128)].iter().map(|b|format!("{b:02x}")).collect::<String>(),"nativeMarker":if !stun {Some(String::from_utf8_lossy(&data[..n]).to_string())}else{None}}));
                            if !stun && data[..n].starts_with(b"w0/") && data[..n].windows(15).any(|part|part==b"/udp-diagnosis/") && !data[..n].ends_with(b"/explicit-close") {let _=udp.send_to(&data[..n],peer);}
                            if stun && data[..2]==[0,3] && username.is_none() {let _=udp.send_to(&turn_challenge(&data[..n]),peer);}
                        }
                        Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{},
                        Err(e) if e.raw_os_error()==Some(10054)=>{events.lock().unwrap().push(json!({"transport":"udp","family":family,"peerIcmpReset":e.to_string(),"receiverContinues":true}));},
                        Err(e)=>{events.lock().unwrap().push(json!({"transport":"udp","family":family,"listenerError":e.to_string()}));break;}
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }));
        }
        match UdpSocket::bind("127.0.0.1:53") {
            Ok(dns) => {
                dns.set_nonblocking(true)?;
                result.dns_enabled = true;
                let stop = result.stop.clone();
                let events = result.events.clone();
                let case = result.case.clone();
                result.threads.push(std::thread::spawn(move||{
                    let mut data=[0;2048];let start=Instant::now();
                    while !stop.load(Ordering::SeqCst) {
                        match dns.recv_from(&mut data) {
                            Ok((n,peer))=>{
                                let mut at=12;let mut labels=Vec::new();
                                while at<n && data[at]>0 && data[at]<64 {
                                    let length=data[at] as usize;at+=1;
                                    if at+length>n {break;}
                                    labels.push(String::from_utf8_lossy(&data[at..at+length]).to_string());at+=length;
                                }
                                let name=labels.join(".");
                                events.lock().unwrap().push(json!({"transport":"dns","case":case.lock().unwrap().clone(),"socketOwners":udp_owners(peer),"family":"ipv4","elapsedMs":start.elapsed().as_millis(),"peer":peer.to_string(),"query":name,"bytes":n}));
                                // Answer only our .invalid test names. Never recurse or forward.
                                if n>=12 && name.starts_with("w0-") && name.ends_with(".invalid") && at+5<=n && data[at]==0 && data[at+1..at+5]==[0,1,0,1] {
                                    let mut response=data[..at+5].to_vec();
                                    response[2]=0x81;response[3]=0x80;response[6]=0;response[7]=1;
                                    response[8..12].fill(0);
                                    response.extend_from_slice(&[0xc0,0x0c,0,1,0,1,0,0,0,0,0,4,127,0,0,1]);
                                    let _=dns.send_to(&response,peer);
                                }
                            }
                            Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{},
                            Err(e)=>{events.lock().unwrap().push(json!({"transport":"dns","listenerError":e.to_string()}));break;}
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                }));
            }
            Err(e) => result.events.lock().unwrap().push(
                json!({"transport":"dns","bindError":e.to_string(),"rawOsError":e.raw_os_error()}),
            ),
        }
        Ok(result)
    }
    pub fn set_case(&self, name: &str) -> Result<()> {
        *self.case.lock().map_err(|_| "Case lock poisoned")? = name.to_string();
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Value> {
        Ok(json!(self
            .events
            .lock()
            .map_err(|_| "Endpoint log poisoned")?
            .clone()))
    }
}
impl Drop for Endpoints {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

fn udp_owners(peer: std::net::SocketAddr) -> Value {
    use windows_sys::Win32::{
        NetworkManagement::IpHelper::*,
        Networking::WinSock::{AF_INET, AF_INET6},
    };
    let family = if peer.is_ipv4() { AF_INET } else { AF_INET6 };
    let mut size = 0;
    let initial = unsafe {
        GetExtendedUdpTable(
            null_mut(),
            &mut size,
            0,
            u32::from(family),
            UDP_TABLE_OWNER_PID,
            0,
        )
    };
    if initial != ERROR_INSUFFICIENT_BUFFER && initial != 0 {
        return json!({"queryError":initial});
    }
    for _ in 0..3 {
        let mut table = vec![0usize; (size as usize).div_ceil(size_of::<usize>())];
        let status = unsafe {
            GetExtendedUdpTable(
                table.as_mut_ptr().cast(),
                &mut size,
                0,
                u32::from(family),
                UDP_TABLE_OWNER_PID,
                0,
            )
        };
        if status == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if status != 0 {
            return json!({"queryError":status});
        }
        let count = unsafe { *(table.as_ptr().cast::<u32>()) } as usize;
        let mut pids = Vec::new();
        let mut bindings = Vec::new();
        if peer.is_ipv4() {
            let offset = std::mem::offset_of!(MIB_UDPTABLE_OWNER_PID, table);
            if offset + count * size_of::<MIB_UDPROW_OWNER_PID>() > size as usize {
                return json!({"error":"Invalid IPv4 UDP table length"});
            }
            let rows = unsafe {
                std::slice::from_raw_parts(
                    table
                        .as_ptr()
                        .cast::<u8>()
                        .add(offset)
                        .cast::<MIB_UDPROW_OWNER_PID>(),
                    count,
                )
            };
            for row in rows {
                if u16::from_be(row.dwLocalPort as u16) == peer.port() {
                    pids.push(row.dwOwningPid);
                    bindings.push(json!({"pid":row.dwOwningPid,"localAddress":std::net::Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()).to_string(),"port":peer.port()}));
                }
            }
        } else {
            let offset = std::mem::offset_of!(MIB_UDP6TABLE_OWNER_PID, table);
            if offset + count * size_of::<MIB_UDP6ROW_OWNER_PID>() > size as usize {
                return json!({"error":"Invalid IPv6 UDP table length"});
            }
            let rows = unsafe {
                std::slice::from_raw_parts(
                    table
                        .as_ptr()
                        .cast::<u8>()
                        .add(offset)
                        .cast::<MIB_UDP6ROW_OWNER_PID>(),
                    count,
                )
            };
            for row in rows {
                if u16::from_be(row.dwLocalPort as u16) == peer.port() {
                    pids.push(row.dwOwningPid);
                    bindings.push(json!({"pid":row.dwOwningPid,"localAddress":std::net::Ipv6Addr::from(row.ucLocalAddr).to_string(),"scopeId":row.dwLocalScopeId,"port":peer.port()}));
                }
            }
        }
        pids.sort();
        pids.dedup();
        let owners: Vec<Value> = pids
            .into_iter()
            .map(|pid| {
                match unsafe { owned(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)) } {
                    Ok(process) => match token_info(process.as_raw_handle()) {
                        Ok(token) => json!({"pid":pid,"token":token}),
                        Err(e) => json!({"pid":pid,"inspectionError":e.to_string()}),
                    },
                    Err(e) => json!({"pid":pid,"inspectionError":e.to_string()}),
                }
            })
            .collect();
        return json!({"matchedLocalPort":peer.port(),"owners":owners,"bindings":bindings,"boundary":"Read-only UDP owner-table snapshot at receive time; port matches may be ambiguous or race process exit"});
    }
    json!({"error":"UDP table changed size repeatedly"})
}

fn turn_username(data: &[u8]) -> Option<String> {
    let mut at = 20;
    while at + 4 <= data.len() {
        let kind = u16::from_be_bytes([data[at], data[at + 1]]);
        let len = usize::from(u16::from_be_bytes([data[at + 2], data[at + 3]]));
        at += 4;
        if at + len > data.len() {
            return None;
        }
        if kind == 6 {
            return Some(String::from_utf8_lossy(&data[at..at + len]).to_string());
        }
        at += len.div_ceil(4) * 4;
    }
    None
}
fn turn_challenge(data: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    for (kind, value) in [
        (9u16, b"\0\0\x04\x01Unauthorized".as_slice()),
        (0x14, b"w0-local".as_slice()),
        (0x15, b"controlled-nonce".as_slice()),
    ] {
        body.extend_from_slice(&kind.to_be_bytes());
        body.extend_from_slice(&(value.len() as u16).to_be_bytes());
        body.extend_from_slice(value);
        while body.len() % 4 != 0 {
            body.push(0);
        }
    }
    let mut result = vec![1, 0x13];
    result.extend_from_slice(&(body.len() as u16).to_be_bytes());
    result.extend_from_slice(&data[4..20]);
    result.extend(body);
    result
}
