use super::*;
use windows_sys::Win32::{
    NetworkManagement::Dns::*,
    Networking::WinSock::{AF_INET, SOCKADDR_IN},
};

pub(super) fn query(name: &str) -> Value {
    let wide_name = wide(OsStr::new(name));
    let mut address = DNS_ADDR::default();
    let mut socket = SOCKADDR_IN::default();
    socket.sin_family = AF_INET;
    socket.sin_port = 53u16.to_be();
    socket.sin_addr.S_un.S_addr = u32::from_ne_bytes([127, 0, 0, 1]);
    unsafe {
        std::ptr::copy_nonoverlapping(
            (&socket as *const SOCKADDR_IN).cast::<u8>(),
            address.MaxSa.as_mut_ptr().cast::<u8>(),
            size_of::<SOCKADDR_IN>(),
        );
    }
    address.Data.DnsAddrUserDword = [size_of::<SOCKADDR_IN>() as u32, 0, 0, 0, 0, 0, 0, 0];
    let mut servers = DNS_ADDR_ARRAY::default();
    servers.MaxCount = 1;
    servers.AddrCount = 1;
    servers.Family = AF_INET;
    servers.AddrArray = [address];
    let mut request = DNS_QUERY_REQUEST::default();
    request.Version = DNS_QUERY_REQUEST_VERSION1;
    request.QueryName = wide_name.as_ptr();
    request.QueryType = DNS_TYPE_A;
    request.QueryOptions = u64::from(
        DNS_QUERY_WIRE_ONLY
            | DNS_QUERY_BYPASS_CACHE
            | DNS_QUERY_NO_HOSTS_FILE
            | DNS_QUERY_NO_MULTICAST
            | DNS_QUERY_TREAT_AS_FQDN,
    );
    request.pDnsServerList = &mut servers;
    let mut result = DNS_QUERY_RESULT::default();
    result.Version = DNS_QUERY_RESULTS_VERSION1;
    let start = Instant::now();
    // Synchronous call; parent enforces the overall process deadline. The explicit
    // server list never modifies the system resolver or uses a third-party DNS server.
    let status = unsafe { DnsQueryEx(&request, &mut result, null_mut()) };
    let records = !result.pQueryRecords.is_null();
    if records {
        unsafe {
            DnsFree(result.pQueryRecords.cast(), DnsFreeRecordList);
        }
    }
    json!({"api":"DnsQueryEx","server":"127.0.0.1:53","query":name,"returnStatus":status,"queryStatus":result.QueryStatus,"recordsReturned":records,"elapsedMs":start.elapsed().as_millis(),"systemResolverChanged":false,"boundary":"Explicit-server native query; not the WebView2 system DNS path"})
}
