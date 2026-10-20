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
    events: Arc<Mutex<Vec<Value>>>,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}
impl Endpoints {
    pub fn new() -> Result<Self> {
        let mut result = Self {
            addresses: Vec::new(),
            dns_enabled: false,
            events: Arc::new(Mutex::new(Vec::new())),
            stop: Arc::new(AtomicBool::new(false)),
            threads: Vec::new(),
        };
        for (family, bind) in [("ipv4", "127.0.0.1:0"), ("ipv6", "[::1]:0")] {
            let tcp = TcpListener::bind(bind)?;
            let udp = UdpSocket::bind(bind)?;
            tcp.set_nonblocking(true)?;
            udp.set_nonblocking(true)?;
            result.addresses.push(json!({"family":family,"tcp":tcp.local_addr()?.to_string(),"udp":udp.local_addr()?.to_string()}));
            let stop = result.stop.clone();
            let events = result.events.clone();
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
                            events.lock().unwrap().push(json!({"transport":"tcp","family":family,"elapsedMs":start.elapsed().as_millis(),"peer":peer.to_string(),"request":request,"readError":read.err().map(|e|e.to_string())}));
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
            result.threads.push(std::thread::spawn(move || {
                let start=Instant::now();
                let mut data=[0;2048];
                while !stop.load(Ordering::SeqCst) {
                    match udp.recv_from(&mut data) {
                        Ok((n,peer))=>{
                            let stun=n>=20 && data[4..8]==[0x21,0x12,0xa4,0x42];
                            events.lock().unwrap().push(json!({"transport":"udp","family":family,"elapsedMs":start.elapsed().as_millis(),"peer":peer.to_string(),"bytes":n,"stunMagicCookie":stun,"prefixHex":data[..n.min(128)].iter().map(|b|format!("{b:02x}")).collect::<String>(),"nativeMarker":if !stun {Some(String::from_utf8_lossy(&data[..n]).to_string())}else{None}}));
                        }
                        Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{},
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
                                events.lock().unwrap().push(json!({"transport":"dns","family":"ipv4","elapsedMs":start.elapsed().as_millis(),"peer":peer.to_string(),"query":name,"bytes":n}));
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
