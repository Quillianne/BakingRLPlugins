use std::collections::HashMap;
use std::io::{self, BufRead, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};

const WEBSOCKET_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_HEADER_BYTES: usize = 32 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayConfig {
    enabled: bool,
    listen_address: String,
    listen_port: u16,
    route_prefix: String,
    stream_path: String,
    secret_key_ref: String,
    heartbeat_ms: u64,
    allowed_origins: Vec<String>,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_address: "127.0.0.1".to_string(),
            listen_port: 4455,
            route_prefix: "/overlay".to_string(),
            stream_path: "/stream".to_string(),
            secret_key_ref: "obs.gateway.accessToken".to_string(),
            heartbeat_ms: 15_000,
            allowed_origins: vec![
                "http://localhost".to_string(),
                "http://127.0.0.1".to_string(),
            ],
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayAuthState {
    secret_key_ref: String,
    configured: bool,
    required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayServerState {
    listening: bool,
    address: String,
    port: u16,
    health_url: Option<String>,
    snapshot_url: Option<String>,
    stream_url: Option<String>,
    websocket_url: Option<String>,
    client_count: usize,
    started_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayStateSnapshot {
    config: GatewayConfig,
    auth: GatewayAuthState,
    server: GatewayServerState,
    connected: ConnectionState,
    last_connected_at_ms: Option<u64>,
    last_state_change_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug)]
struct GatewayState {
    config: GatewayConfig,
    connected: ConnectionState,
    last_connected_at_ms: Option<u64>,
    last_state_change_at_ms: u64,
    last_error: Option<String>,
    access_token: Option<String>,
    token_configured: bool,
    started_at_ms: Option<u64>,
}

impl GatewayState {
    fn new() -> Self {
        Self {
            config: GatewayConfig::default(),
            connected: ConnectionState::Disconnected,
            last_connected_at_ms: None,
            last_state_change_at_ms: now_ms(),
            last_error: None,
            access_token: None,
            token_configured: false,
            started_at_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayEvent {
    #[serde(rename = "type")]
    event_type: String,
    at_ms: u64,
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureInput {
    enabled: Option<bool>,
    listen_address: Option<String>,
    listen_port: Option<u16>,
    route_prefix: Option<String>,
    stream_path: Option<String>,
    secret_key_ref: Option<String>,
    heartbeat_ms: Option<u64>,
    allowed_origins: Option<Vec<String>>,
    access_token: Option<String>,
    token_configured: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ConnectionInput {
    state: Option<ConnectionState>,
    error: Option<String>,
}

struct SharedGateway {
    state: Mutex<GatewayState>,
    subscribers: Mutex<Vec<Sender<GatewayEvent>>>,
}

impl SharedGateway {
    fn new() -> Self {
        Self {
            state: Mutex::new(GatewayState::new()),
            subscribers: Mutex::new(Vec::new()),
        }
    }

    fn snapshot(&self) -> GatewayStateSnapshot {
        let state = self.state.lock().expect("gateway state poisoned");
        let config = state.config.clone();
        let route_map = routes(&config);
        let base = public_base_url(&config);
        let listening = state.started_at_ms.is_some();
        GatewayStateSnapshot {
            config: config.clone(),
            auth: GatewayAuthState {
                secret_key_ref: config.secret_key_ref.clone(),
                configured: state.token_configured,
                required: state
                    .access_token
                    .as_deref()
                    .is_some_and(|value| !value.is_empty()),
            },
            server: GatewayServerState {
                listening,
                address: config.listen_address.clone(),
                port: config.listen_port,
                health_url: listening.then(|| format!("{base}{}", route_map.health)),
                snapshot_url: listening.then(|| format!("{base}{}", route_map.snapshot)),
                stream_url: listening.then(|| format!("{base}{}", route_map.stream)),
                websocket_url: listening.then(|| {
                    format!(
                        "{}{}",
                        base.replacen("http:", "ws:", 1),
                        route_map.websocket
                    )
                }),
                client_count: self
                    .subscribers
                    .lock()
                    .map(|items| items.len())
                    .unwrap_or_default(),
                started_at_ms: state.started_at_ms,
            },
            connected: state.connected,
            last_connected_at_ms: state.last_connected_at_ms,
            last_state_change_at_ms: state.last_state_change_at_ms,
            last_error: state.last_error.clone(),
        }
    }

    fn subscribe(&self) -> Receiver<GatewayEvent> {
        let (tx, rx) = mpsc::channel();
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.push(tx);
        }
        rx
    }

    fn broadcast(&self, event_type: &str, payload: Value) {
        let event = GatewayEvent {
            event_type: event_type.to_string(),
            at_ms: now_ms(),
            payload,
        };
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.retain(|subscriber| subscriber.send(event.clone()).is_ok());
        }
    }
}

struct ServerHandle {
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

impl ServerHandle {
    fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

struct Runtime {
    shared: Arc<SharedGateway>,
    server: Mutex<Option<ServerHandle>>,
}

impl Runtime {
    fn new() -> Self {
        Self {
            shared: Arc::new(SharedGateway::new()),
            server: Mutex::new(None),
        }
    }

    fn configure(&self, input: ConfigureInput) -> Result<Value, String> {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .map_err(|error| error.to_string())?;
            if let Some(enabled) = input.enabled {
                state.config.enabled = enabled;
            }
            if let Some(address) = non_empty(input.listen_address) {
                state.config.listen_address = address;
            }
            if let Some(port) = input.listen_port.filter(|port| *port >= 1024) {
                state.config.listen_port = port;
            }
            if let Some(prefix) = non_empty(input.route_prefix) {
                state.config.route_prefix = normalize_path(&prefix);
            }
            if let Some(path) = non_empty(input.stream_path) {
                state.config.stream_path = normalize_path(&path);
            }
            if let Some(secret_key_ref) = non_empty(input.secret_key_ref) {
                state.config.secret_key_ref = secret_key_ref;
            }
            if let Some(heartbeat) = input.heartbeat_ms.filter(|value| *value >= 1_000) {
                state.config.heartbeat_ms = heartbeat;
            }
            if let Some(origins) = input.allowed_origins {
                let origins = origins
                    .into_iter()
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>();
                if !origins.is_empty() {
                    state.config.allowed_origins = origins;
                }
            }
            state.access_token = input.access_token.filter(|token| !token.is_empty());
            state.token_configured = input
                .token_configured
                .unwrap_or(state.access_token.is_some());
            state.last_state_change_at_ms = now_ms();
        }
        self.sync_server()?;
        let snapshot =
            serde_json::to_value(self.shared.snapshot()).map_err(|error| error.to_string())?;
        self.shared.broadcast("server", snapshot.clone());
        Ok(snapshot)
    }

    fn set_connection_state(&self, input: ConnectionInput) -> Result<Value, String> {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .map_err(|error| error.to_string())?;
            if let Some(next) = input.state {
                state.connected = next;
                if matches!(next, ConnectionState::Connected) {
                    state.last_connected_at_ms = Some(now_ms());
                }
            }
            state.last_error = input.error.filter(|message| !message.is_empty());
            state.last_state_change_at_ms = now_ms();
        }
        let snapshot =
            serde_json::to_value(self.shared.snapshot()).map_err(|error| error.to_string())?;
        self.shared.broadcast("connection", snapshot.clone());
        Ok(snapshot)
    }

    fn sync_server(&self) -> Result<(), String> {
        if let Some(handle) = self
            .server
            .lock()
            .map_err(|error| error.to_string())?
            .take()
        {
            handle.stop();
        }

        {
            let mut state = self
                .shared
                .state
                .lock()
                .map_err(|error| error.to_string())?;
            state.started_at_ms = None;
            if !state.config.enabled {
                state.last_error = None;
                return Ok(());
            }
        }

        match start_server(self.shared.clone()) {
            Ok(handle) => {
                *self.server.lock().map_err(|error| error.to_string())? = Some(handle);
                Ok(())
            }
            Err(error) => {
                if let Ok(mut state) = self.shared.state.lock() {
                    state.last_error = Some(error.clone());
                }
                Err(error)
            }
        }
    }

    fn stop(&self) {
        if let Ok(mut server) = self.server.lock() {
            if let Some(handle) = server.take() {
                handle.stop();
            }
        }
    }
}

#[derive(Clone)]
struct RouteMap {
    health: String,
    snapshot: String,
    stream: String,
    websocket: String,
    configure: String,
    connection_state: String,
}

fn main() {
    let runtime = Arc::new(Runtime::new());
    let stdin = io::stdin();
    for raw in stdin.lock().lines().map_while(Result::ok) {
        let Ok(message) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if method == "bakingrl/shutdown" {
            runtime.stop();
            break;
        }
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let result = match method {
            "snapshot" => {
                serde_json::to_value(runtime.shared.snapshot()).map_err(|error| error.to_string())
            }
            "configure" => serde_json::from_value::<ConfigureInput>(params)
                .map_err(|error| error.to_string())
                .and_then(|input| runtime.configure(input)),
            "setConnectionState" => serde_json::from_value::<ConnectionInput>(params)
                .map_err(|error| error.to_string())
                .and_then(|input| runtime.set_connection_state(input)),
            _ => Err(format!("OBS gateway method '{method}' is not supported.")),
        };
        write_jsonrpc_response(id, result);
    }
    runtime.stop();
}

fn start_server(shared: Arc<SharedGateway>) -> Result<ServerHandle, String> {
    let config = shared
        .state
        .lock()
        .map_err(|error| error.to_string())?
        .config
        .clone();
    let bind_addr = format!("{}:{}", config.listen_address, config.listen_port);
    let listener = TcpListener::bind(&bind_addr)
        .map_err(|error| format!("Unable to bind OBS gateway to {bind_addr}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Unable to configure OBS gateway listener: {error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = stop.clone();
    let thread_shared = shared.clone();

    if let Ok(mut state) = shared.state.lock() {
        state.started_at_ms = Some(now_ms());
        state.last_error = None;
    }

    let join = thread::spawn(move || {
        while !thread_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let client_shared = thread_shared.clone();
                    thread::spawn(move || handle_client(stream, client_shared));
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) => {
                    if let Ok(mut state) = thread_shared.state.lock() {
                        state.last_error = Some(format!("OBS gateway accept failed: {error}"));
                    }
                    break;
                }
            }
        }
    });

    Ok(ServerHandle {
        stop,
        join: Some(join),
    })
}

fn handle_client(mut stream: TcpStream, shared: Arc<SharedGateway>) {
    let Ok(request) = read_http_request(&mut stream) else {
        let _ = write_response(&mut stream, 400, "Bad Request", &[], b"");
        return;
    };
    let config = shared
        .state
        .lock()
        .map(|state| state.config.clone())
        .unwrap_or_default();
    let routes = routes(&config);

    if !origin_allowed(&config, request.header("origin")) {
        let _ = write_json(
            &mut stream,
            403,
            json!({ "ok": false, "error": "Origin is not allowed" }),
        );
        return;
    }

    if request.method == "OPTIONS" {
        let _ = write_response(&mut stream, 204, "No Content", &[], b"");
        return;
    }

    if request.method == "GET" && request.path == routes.health {
        let _ = write_json(
            &mut stream,
            200,
            json!({
                "ok": true,
                "service": "obsGateway",
                "connected": shared.snapshot().connected,
                "auth": shared.snapshot().auth,
                "server": shared.snapshot().server
            }),
        );
        return;
    }

    if !authorized(&shared, request.header("authorization")) {
        let _ = write_json(
            &mut stream,
            401,
            json!({ "ok": false, "error": "Bearer token is required" }),
        );
        return;
    }

    if request.is_websocket_upgrade()
        && (request.path == routes.stream || request.path == routes.websocket)
    {
        handle_websocket(stream, request, shared);
        return;
    }

    if request.method == "GET" && request.path == routes.snapshot {
        let _ = write_json_value(
            &mut stream,
            200,
            serde_json::to_value(shared.snapshot()).unwrap_or(Value::Null),
        );
        return;
    }

    if request.method == "GET" && request.path == routes.stream {
        handle_sse(stream, shared);
        return;
    }

    if request.method == "POST" && request.path == routes.connection_state {
        match serde_json::from_slice::<ConnectionInput>(&request.body) {
            Ok(input) => {
                if let Ok(mut state) = shared.state.lock() {
                    if let Some(next) = input.state {
                        state.connected = next;
                        if matches!(next, ConnectionState::Connected) {
                            state.last_connected_at_ms = Some(now_ms());
                        }
                    }
                    state.last_error = input.error;
                    state.last_state_change_at_ms = now_ms();
                }
                let snapshot = serde_json::to_value(shared.snapshot()).unwrap_or(Value::Null);
                shared.broadcast("connection", snapshot.clone());
                let _ = write_json_value(&mut stream, 200, snapshot);
            }
            Err(error) => {
                let _ = write_json(
                    &mut stream,
                    400,
                    json!({ "ok": false, "error": error.to_string() }),
                );
            }
        }
        return;
    }

    if request.method == "POST" && request.path == routes.configure {
        let _ = write_json(
            &mut stream,
            409,
            json!({
                "ok": false,
                "error": "Use the BakingRL service method to reconfigure this gateway."
            }),
        );
        return;
    }

    let _ = write_json(
        &mut stream,
        404,
        json!({ "ok": false, "error": "Route not found" }),
    );
}

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, key: &str) -> Option<&str> {
        self.headers
            .get(&key.to_ascii_lowercase())
            .map(String::as_str)
    }

    fn is_websocket_upgrade(&self) -> bool {
        self.header("upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("Connection closed before headers.".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_HEADER_BYTES {
            return Err("HTTP headers are too large.".to_string());
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let raw_headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = raw_headers.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts
        .next()
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err("HTTP body is too large.".to_string());
    }
    let body_start = header_end + 4;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn handle_sse(mut stream: TcpStream, shared: Arc<SharedGateway>) {
    let rx = shared.subscribe();
    let heartbeat_ms = shared
        .state
        .lock()
        .map(|state| state.config.heartbeat_ms)
        .unwrap_or(15_000);
    let headers = [
        ("Content-Type", "text/event-stream; charset=utf-8"),
        ("Cache-Control", "no-cache, no-transform"),
        ("Connection", "keep-alive"),
        ("X-Accel-Buffering", "no"),
    ];
    if write_stream_headers(&mut stream, 200, "OK", &headers).is_err() {
        return;
    }
    if stream.write_all(b": connected\n\n").is_err() {
        return;
    }
    let snapshot = serde_json::to_value(shared.snapshot()).unwrap_or(Value::Null);
    if write_sse(
        &mut stream,
        &GatewayEvent {
            event_type: "snapshot".to_string(),
            at_ms: now_ms(),
            payload: snapshot,
        },
    )
    .is_err()
    {
        return;
    }
    loop {
        match rx.recv_timeout(Duration::from_millis(heartbeat_ms)) {
            Ok(event) => {
                if write_sse(&mut stream, &event).is_err() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let event = GatewayEvent {
                    event_type: "heartbeat".to_string(),
                    at_ms: now_ms(),
                    payload: json!({ "connected": shared.snapshot().connected, "server": shared.snapshot().server }),
                };
                if write_sse(&mut stream, &event).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn handle_websocket(mut stream: TcpStream, request: HttpRequest, shared: Arc<SharedGateway>) {
    let Some(key) = request.header("sec-websocket-key") else {
        let _ = write_response(&mut stream, 400, "Bad Request", &[], b"");
        return;
    };
    let accept = BASE64.encode(Sha1::digest(format!("{key}{WEBSOCKET_GUID}").as_bytes()));
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    if stream.write_all(response.as_bytes()).is_err() {
        return;
    }
    let rx = shared.subscribe();
    let heartbeat_ms = shared
        .state
        .lock()
        .map(|state| state.config.heartbeat_ms)
        .unwrap_or(15_000);
    let snapshot = GatewayEvent {
        event_type: "snapshot".to_string(),
        at_ms: now_ms(),
        payload: serde_json::to_value(shared.snapshot()).unwrap_or(Value::Null),
    };
    if write_ws_event(&mut stream, &snapshot).is_err() {
        return;
    }
    loop {
        match rx.recv_timeout(Duration::from_millis(heartbeat_ms)) {
            Ok(event) => {
                if write_ws_event(&mut stream, &event).is_err() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let event = GatewayEvent {
                    event_type: "heartbeat".to_string(),
                    at_ms: now_ms(),
                    payload: json!({ "connected": shared.snapshot().connected, "server": shared.snapshot().server }),
                };
                if write_ws_event(&mut stream, &event).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn write_json(stream: &mut TcpStream, status: u16, payload: Value) -> io::Result<()> {
    write_json_value(stream, status, payload)
}

fn write_json_value(stream: &mut TcpStream, status: u16, payload: Value) -> io::Result<()> {
    let body = format!(
        "{}\n",
        serde_json::to_string(&payload).unwrap_or_else(|_| "null".to_string())
    );
    write_response(
        stream,
        status,
        status_text(status),
        &[("Content-Type", "application/json; charset=utf-8")],
        body.as_bytes(),
    )
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    status_text: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> io::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Length: {}\r\n",
        body.len()
    )?;
    write!(stream, "Access-Control-Allow-Origin: *\r\n")?;
    write!(stream, "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n")?;
    write!(
        stream,
        "Access-Control-Allow-Headers: Authorization,Content-Type\r\n"
    )?;
    if !headers
        .iter()
        .any(|(key, _)| key.eq_ignore_ascii_case("Connection"))
    {
        write!(stream, "Connection: close\r\n")?;
    }
    for (key, value) in headers {
        write!(stream, "{key}: {value}\r\n")?;
    }
    write!(stream, "\r\n")?;
    stream.write_all(body)?;
    stream.flush()
}

fn write_stream_headers(
    stream: &mut TcpStream,
    status: u16,
    status_text: &str,
    headers: &[(&str, &str)],
) -> io::Result<()> {
    write!(stream, "HTTP/1.1 {status} {status_text}\r\n")?;
    write!(stream, "Access-Control-Allow-Origin: *\r\n")?;
    write!(stream, "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\n")?;
    write!(
        stream,
        "Access-Control-Allow-Headers: Authorization,Content-Type\r\n"
    )?;
    for (key, value) in headers {
        write!(stream, "{key}: {value}\r\n")?;
    }
    write!(stream, "\r\n")?;
    stream.flush()
}

fn write_sse(stream: &mut TcpStream, event: &GatewayEvent) -> io::Result<()> {
    let data = serde_json::to_string(event).unwrap_or_else(|_| "null".to_string());
    write!(stream, "event: obsGateway\ndata: {data}\n\n")?;
    stream.flush()
}

fn write_ws_event(stream: &mut TcpStream, event: &GatewayEvent) -> io::Result<()> {
    let payload = serde_json::to_string(event).unwrap_or_else(|_| "null".to_string());
    let body = payload.as_bytes();
    let mut frame = Vec::with_capacity(body.len() + 10);
    frame.push(0x81);
    match body.len() {
        len if len < 126 => frame.push(len as u8),
        len if len <= 65_535 => {
            frame.push(126);
            frame.extend_from_slice(&(len as u16).to_be_bytes());
        }
        len => {
            frame.push(127);
            frame.extend_from_slice(&(len as u64).to_be_bytes());
        }
    }
    frame.extend_from_slice(body);
    stream.write_all(&frame)?;
    stream.flush()
}

fn write_jsonrpc_response(id: Value, result: Result<Value, String>) {
    let message = match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err(message) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32000, "message": message }
        }),
    };
    println!("{message}");
    let _ = io::stdout().flush();
}

fn authorized(shared: &SharedGateway, authorization: Option<&str>) -> bool {
    let Ok(state) = shared.state.lock() else {
        return false;
    };
    let Some(token) = state
        .access_token
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    authorization == Some(&format!("Bearer {token}"))
}

fn origin_allowed(config: &GatewayConfig, origin: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return true;
    };
    config
        .allowed_origins
        .iter()
        .any(|allowed| origins_match(allowed, origin))
}

fn origins_match(allowed: &str, origin: &str) -> bool {
    if allowed == "*" || allowed == origin {
        return true;
    }
    let Some((allowed_scheme, allowed_host, allowed_port)) = parse_origin(allowed) else {
        return false;
    };
    let Some((origin_scheme, origin_host, origin_port)) = parse_origin(origin) else {
        return false;
    };
    allowed_scheme == origin_scheme
        && allowed_host == origin_host
        && (allowed_port.is_none() || allowed_port == origin_port)
}

fn parse_origin(origin: &str) -> Option<(&str, &str, Option<&str>)> {
    let (scheme, rest) = origin.split_once("://")?;
    let authority = rest.split('/').next().unwrap_or(rest);
    let (host, port) = authority
        .rsplit_once(':')
        .filter(|(_, port)| port.chars().all(|ch| ch.is_ascii_digit()))
        .map(|(host, port)| (host, Some(port)))
        .unwrap_or((authority, None));
    Some((scheme, host, port))
}

fn routes(config: &GatewayConfig) -> RouteMap {
    let stream = join_route(&config.route_prefix, &config.stream_path);
    RouteMap {
        health: join_route(&config.route_prefix, "/health"),
        snapshot: join_route(&config.route_prefix, "/snapshot"),
        stream: stream.clone(),
        websocket: join_route(&stream, "/ws"),
        configure: join_route(&config.route_prefix, "/configure"),
        connection_state: join_route(&config.route_prefix, "/connection-state"),
    }
}

fn public_base_url(config: &GatewayConfig) -> String {
    let host = if config.listen_address == "0.0.0.0" || config.listen_address == "::" {
        "127.0.0.1"
    } else {
        &config.listen_address
    };
    format!("http://{host}:{}", config.listen_port)
}

fn join_route(prefix: &str, path: &str) -> String {
    let prefix = normalize_path(prefix);
    let path = normalize_path(path);
    if prefix == "/" {
        path
    } else if path == "/" {
        prefix
    } else {
        format!("{prefix}{path}")
    }
}

fn normalize_path(value: &str) -> String {
    let mut output = String::new();
    let mut previous_slash = false;
    for ch in value.trim().chars() {
        if ch == '/' {
            if !previous_slash {
                output.push(ch);
            }
            previous_slash = true;
        } else {
            output.push(ch);
            previous_slash = false;
        }
    }
    if !output.starts_with('/') {
        output.insert(0, '/');
    }
    if output.len() > 1 && output.ends_with('/') {
        output.pop();
    }
    output
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Internal Server Error",
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
