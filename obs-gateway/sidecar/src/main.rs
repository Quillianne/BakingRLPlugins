use std::collections::HashMap;
use std::io::{self, BufRead, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
const DEFAULT_LISTEN_PORT: u16 = 17_844;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayConfig {
    enabled: bool,
    listen_address: String,
    listen_port: u16,
    route_prefix: String,
    stream_path: String,
    stream_layout_id: String,
    secret_key_ref: String,
    require_token: bool,
    heartbeat_ms: u64,
    allowed_origins: Vec<String>,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            listen_address: "127.0.0.1".to_string(),
            listen_port: DEFAULT_LISTEN_PORT,
            route_prefix: "/overlay".to_string(),
            stream_path: "/stream".to_string(),
            stream_layout_id: String::new(),
            secret_key_ref: "obs.gateway.accessToken".to_string(),
            require_token: false,
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
    local_bind: bool,
    require_token_setting: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LayoutUrl {
    layout_id: String,
    name: String,
    url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayServerState {
    listening: bool,
    address: String,
    port: u16,
    health_url: Option<String>,
    gateway_api_url: Option<String>,
    layouts_api_url: Option<String>,
    events_url: Option<String>,
    stream_url: Option<String>,
    websocket_url: Option<String>,
    layout_urls: Vec<LayoutUrl>,
    client_count: usize,
    started_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostLayout {
    id: String,
    name: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostDataState {
    layouts: Vec<HostLayout>,
    snapshot: Option<Value>,
    host_api_available: bool,
    updated_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayStateSnapshot {
    config: GatewayConfig,
    auth: GatewayAuthState,
    server: GatewayServerState,
    host: HostDataState,
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
    host: HostDataState,
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
            host: HostDataState {
                layouts: Vec::new(),
                snapshot: None,
                host_api_available: false,
                updated_at_ms: None,
                error: Some("Host layout/snapshot APIs have not provided data yet.".to_string()),
            },
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
    stream_layout_id: Option<String>,
    secret_key_ref: Option<String>,
    require_token: Option<bool>,
    heartbeat_ms: Option<u64>,
    allowed_origins: Option<Vec<String>>,
    access_token: Option<String>,
    token_configured: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostLayoutInput {
    id: Option<String>,
    name: Option<String>,
    source: Option<String>,
    item_count: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateHostDataInput {
    layouts: Option<Vec<HostLayoutInput>>,
    snapshot: Option<Value>,
    error: Option<String>,
    host_api_available: Option<bool>,
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

#[derive(Clone)]
struct HostRpc {
    stdout: Arc<Mutex<io::Stdout>>,
    pending: Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>,
    next_id: Arc<AtomicU64>,
}

impl HostRpc {
    fn new() -> Self {
        Self {
            stdout: Arc::new(Mutex::new(io::stdout())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(0)),
        }
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|error| error.to_string())?
            .insert(id, tx);
        if let Err(error) = self.write_message(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        })) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(error);
        }
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(result) => result,
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err(format!("Host JSON-RPC request '{method}' timed out."))
            }
        }
    }

    fn respond(&self, id: Value, result: Result<Value, String>) {
        let message = match result {
            Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
            Err(message) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32000, "message": message }
            }),
        };
        let _ = self.write_message(message);
    }

    fn resolve_response(&self, message: &Value) -> bool {
        let Some(id) = message.get("id").and_then(Value::as_u64) else {
            return false;
        };
        if !message.get("result").is_some() && !message.get("error").is_some() {
            return false;
        }
        let result = if let Some(error) = message.get("error") {
            Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Host JSON-RPC request failed.")
                .to_string())
        } else {
            Ok(message.get("result").cloned().unwrap_or(Value::Null))
        };
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(tx) = pending.remove(&id) {
                let _ = tx.send(result);
            }
        }
        true
    }

    fn write_message(&self, message: Value) -> Result<(), String> {
        let mut stdout = self.stdout.lock().map_err(|error| error.to_string())?;
        writeln!(stdout, "{message}").map_err(|error| error.to_string())?;
        stdout.flush().map_err(|error| error.to_string())
    }
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
        let auth_required = auth_required(&state);
        let auth_query = auth_query(&state);
        let stream_url = append_auth_query(
            &format!("{base}{}", route_map.stream_page),
            auth_query.as_deref(),
        );
        let layout_urls = state
            .host
            .layouts
            .iter()
            .map(|layout| LayoutUrl {
                layout_id: layout.id.clone(),
                name: layout.name.clone(),
                url: append_auth_query(
                    &format!(
                        "{base}{}/{}",
                        route_map.layout_page_base,
                        url_path_segment(&layout.id)
                    ),
                    auth_query.as_deref(),
                ),
            })
            .collect();
        GatewayStateSnapshot {
            config: config.clone(),
            auth: GatewayAuthState {
                secret_key_ref: config.secret_key_ref.clone(),
                configured: state.token_configured,
                required: auth_required,
                local_bind: is_local_bind_address(&config.listen_address),
                require_token_setting: config.require_token,
            },
            server: GatewayServerState {
                listening,
                address: config.listen_address.clone(),
                port: config.listen_port,
                health_url: listening.then(|| {
                    append_auth_query(
                        &format!("{base}{}", route_map.health),
                        auth_query.as_deref(),
                    )
                }),
                gateway_api_url: listening.then(|| {
                    append_auth_query(
                        &format!("{base}{}", route_map.gateway_api),
                        auth_query.as_deref(),
                    )
                }),
                layouts_api_url: listening.then(|| {
                    append_auth_query(
                        &format!("{base}{}", route_map.layouts_api),
                        auth_query.as_deref(),
                    )
                }),
                events_url: listening.then(|| {
                    append_auth_query(
                        &format!("{base}{}", route_map.events),
                        auth_query.as_deref(),
                    )
                }),
                stream_url: listening.then(|| stream_url),
                websocket_url: listening.then(|| {
                    append_auth_query(
                        &format!(
                            "{}{}",
                            base.replacen("http:", "ws:", 1),
                            route_map.events_websocket
                        ),
                        auth_query.as_deref(),
                    )
                }),
                layout_urls,
                client_count: self
                    .subscribers
                    .lock()
                    .map(|items| items.len())
                    .unwrap_or_default(),
                started_at_ms: state.started_at_ms,
            },
            host: state.host.clone(),
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
    host_rpc: HostRpc,
    server: Mutex<Option<ServerHandle>>,
}

impl Runtime {
    fn new() -> Self {
        Self {
            shared: Arc::new(SharedGateway::new()),
            host_rpc: HostRpc::new(),
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
            if let Some(layout_id) = input.stream_layout_id {
                state.config.stream_layout_id = layout_id.trim().to_string();
            }
            if let Some(secret_key_ref) = non_empty(input.secret_key_ref) {
                state.config.secret_key_ref = secret_key_ref;
            }
            if let Some(require_token) = input.require_token {
                state.config.require_token = require_token;
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
                state.config.allowed_origins = origins;
            }
            state.access_token = input.access_token.filter(|token| !token.is_empty());
            state.token_configured = input
                .token_configured
                .unwrap_or(state.access_token.is_some())
                && state.access_token.is_some();
            state.last_state_change_at_ms = now_ms();
        }
        self.sync_server()?;
        let snapshot =
            serde_json::to_value(self.shared.snapshot()).map_err(|error| error.to_string())?;
        self.shared.broadcast("server", snapshot.clone());
        Ok(snapshot)
    }

    fn update_host_data(&self, input: UpdateHostDataInput) -> Result<Value, String> {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .map_err(|error| error.to_string())?;
            if let Some(layouts) = input.layouts {
                state.host.layouts = layouts
                    .into_iter()
                    .filter_map(normalize_host_layout)
                    .collect();
            }
            state.host.snapshot = input.snapshot;
            state.host.host_api_available = input.host_api_available.unwrap_or(true);
            state.host.error = input.error.filter(|message| !message.is_empty());
            state.host.updated_at_ms = Some(now_ms());
        }
        let snapshot =
            serde_json::to_value(self.shared.snapshot()).map_err(|error| error.to_string())?;
        self.shared.broadcast("hostData", snapshot.clone());
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
            if auth_required(&state)
                && state
                    .access_token
                    .as_deref()
                    .map_or(true, |token| token.is_empty())
            {
                let error = format!(
                    "OBS Gateway authentication is required, but host secret '{}' is missing or unavailable. The server was not started.",
                    state.config.secret_key_ref
                );
                state.last_error = Some(error.clone());
                return Err(error);
            }
        }

        match start_server(self.shared.clone(), self.host_rpc.clone()) {
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
    api_base: String,
    gateway_api: String,
    layouts_api: String,
    snapshot_api: String,
    events: String,
    events_websocket: String,
    stream_page: String,
    layout_page_base: String,
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
        if runtime.host_rpc.resolve_response(&message) {
            continue;
        }
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
            "updateHostData" => serde_json::from_value::<UpdateHostDataInput>(params)
                .map_err(|error| error.to_string())
                .and_then(|input| runtime.update_host_data(input)),
            "setConnectionState" => serde_json::from_value::<ConnectionInput>(params)
                .map_err(|error| error.to_string())
                .and_then(|input| runtime.set_connection_state(input)),
            _ => Err(format!("OBS gateway method '{method}' is not supported.")),
        };
        runtime.host_rpc.respond(id, result);
    }
    runtime.stop();
}

fn start_server(shared: Arc<SharedGateway>, host_rpc: HostRpc) -> Result<ServerHandle, String> {
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
                    let client_rpc = host_rpc.clone();
                    thread::spawn(move || handle_client(stream, client_shared, client_rpc));
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

fn handle_client(mut stream: TcpStream, shared: Arc<SharedGateway>, host_rpc: HostRpc) {
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

    if !authorized(&shared, request.header("authorization"), &request.query) {
        let _ = write_json(
            &mut stream,
            401,
            json!({ "ok": false, "error": "Bearer token is required" }),
        );
        return;
    }

    if request.method == "GET" && request.path == routes.health {
        let snapshot = shared.snapshot();
        let _ = write_json(
            &mut stream,
            200,
            json!({
                "ok": true,
                "service": "obsGateway",
                "connected": snapshot.connected,
                "auth": snapshot.auth,
                "server": snapshot.server
            }),
        );
        return;
    }

    if request.method == "GET" && request.path == routes.stream_page {
        let layout_id = selected_stream_layout(&shared);
        let _ = write_html(
            &mut stream,
            200,
            &overlay_html(&routes, layout_id.as_deref()),
        );
        return;
    }

    if request.method == "GET"
        && request
            .path
            .starts_with(&format!("{}/", routes.layout_page_base))
    {
        let layout_id = request.path[routes.layout_page_base.len() + 1..].to_string();
        if layout_id.trim().is_empty() {
            let _ = write_json(
                &mut stream,
                404,
                json!({ "ok": false, "error": "Layout id is required" }),
            );
            return;
        }
        let _ = write_html(&mut stream, 200, &overlay_html(&routes, Some(&layout_id)));
        return;
    }

    if request.is_websocket_upgrade()
        && (request.path == routes.events || request.path == routes.events_websocket)
    {
        handle_websocket(stream, request, shared);
        return;
    }

    if request.method == "GET" && request.path == routes.gateway_api {
        let _ = write_json_value(
            &mut stream,
            200,
            serde_json::to_value(shared.snapshot()).unwrap_or(Value::Null),
        );
        return;
    }

    if request.method == "GET" && request.path == routes.layouts_api {
        let _ = write_json_value(&mut stream, 200, host_layout_catalog(&shared));
        return;
    }

    if request.method == "GET"
        && request
            .path
            .starts_with(&format!("{}/", routes.layouts_api))
    {
        let layout_id = percent_decode(&request.path[routes.layouts_api.len() + 1..]);
        let catalog = host_layout_catalog(&shared);
        let layout = catalog
            .get("layouts")
            .and_then(Value::as_array)
            .and_then(|layouts| {
                layouts
                    .iter()
                    .find(|layout| layout.get("id").and_then(Value::as_str) == Some(&layout_id))
            })
            .cloned();
        match layout {
            Some(layout) => {
                let _ = write_json_value(&mut stream, 200, json!({ "ok": true, "layout": layout }));
            }
            None => {
                let _ = write_json(
                    &mut stream,
                    404,
                    json!({ "ok": false, "error": "Layout not found", "layoutId": layout_id }),
                );
            }
        }
        return;
    }

    if request.method == "GET" && request.path == routes.snapshot_api {
        let snapshot = shared.snapshot();
        if let Some(host_snapshot) = snapshot.host.snapshot {
            let _ = write_json_value(
                &mut stream,
                200,
                json!({ "ok": true, "snapshot": host_snapshot }),
            );
        } else {
            let _ = write_json_value(
                &mut stream,
                501,
                host_snapshot_unavailable(snapshot.host.error),
            );
        }
        return;
    }

    if request.method == "GET" && request.path == routes.events {
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

    if handle_api_request(&mut stream, &request, &routes, &host_rpc) {
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
    query: HashMap<String, String>,
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
    let target = request_parts.next().unwrap_or("/");
    let (path, query) = parse_request_target(target);
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
        query,
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

fn host_layout_catalog(shared: &SharedGateway) -> Value {
    let Ok(state) = shared.state.lock() else {
        return json!({ "layouts": [] });
    };
    if let Some(snapshot) = &state.host.snapshot {
        if snapshot.get("layouts").and_then(Value::as_array).is_some() {
            return snapshot.clone();
        }
    }
    json!({
        "source": "host-data-summary",
        "stream_layout_id": state.config.stream_layout_id.clone(),
        "streamLayoutId": state.config.stream_layout_id.clone(),
        "hostApiAvailable": state.host.host_api_available,
        "error": state.host.error.clone(),
        "layouts": serde_json::to_value(&state.host.layouts).unwrap_or_else(|_| Value::Array(Vec::new())),
    })
}

fn handle_api_request(
    stream: &mut TcpStream,
    request: &HttpRequest,
    routes: &RouteMap,
    host_rpc: &HostRpc,
) -> bool {
    let Some(api_path) = api_subpath(routes, &request.path) else {
        return false;
    };

    let result = match (request.method.as_str(), api_path) {
        ("GET", "plugins") => runtime_packages_with_public_resources(host_rpc),
        _ => handle_dynamic_api_request(request, api_path, host_rpc),
    };

    match result {
        Ok(ApiResponse::Json(value)) => {
            let _ = write_json_value(stream, 200, value);
        }
        Ok(ApiResponse::Bytes {
            contents,
            content_type,
        }) => {
            let _ = write_response(
                stream,
                200,
                "OK",
                &[("Content-Type", content_type.as_str())],
                &contents,
            );
        }
        Err(error) => {
            let _ = write_json(stream, 502, json!({ "ok": false, "error": error }));
        }
    }
    true
}

enum ApiResponse {
    Json(Value),
    Bytes {
        contents: Vec<u8>,
        content_type: String,
    },
}

impl From<Value> for ApiResponse {
    fn from(value: Value) -> Self {
        Self::Json(value)
    }
}

fn runtime_packages_with_public_resources(host_rpc: &HostRpc) -> Result<ApiResponse, String> {
    let mut packages = host_rpc.request("packages/list", Value::Null)?;
    let resources = host_rpc.request("resources/list", json!({ "visibility": "public" }))?;
    let mut resources_by_package: HashMap<String, Vec<Value>> = HashMap::new();
    for resource in resources.as_array().into_iter().flatten() {
        let Some(package_id) = resource.get("packageId").and_then(Value::as_str) else {
            continue;
        };
        resources_by_package
            .entry(package_id.to_string())
            .or_default()
            .push(resource.clone());
    }

    if let Some(items) = packages.as_array_mut() {
        for package in items {
            let Some(package_id) = package
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
            else {
                continue;
            };
            let resources = resources_by_package.remove(&package_id).unwrap_or_default();
            if !package.get("contributions").is_some_and(Value::is_object) {
                if let Some(package) = package.as_object_mut() {
                    package.insert("contributions".to_string(), json!({}));
                }
            }
            if let Some(contributions) = package
                .get_mut("contributions")
                .and_then(Value::as_object_mut)
            {
                contributions.insert("resources".to_string(), Value::Array(resources));
            }
        }
    }

    Ok(ApiResponse::Json(packages))
}

fn handle_dynamic_api_request(
    request: &HttpRequest,
    api_path: &str,
    host_rpc: &HostRpc,
) -> Result<ApiResponse, String> {
    let segments = api_path.split('/').collect::<Vec<_>>();
    if segments.first() == Some(&"packages") && segments.len() >= 3 {
        let package_id = percent_decode(segments[1]);
        match (request.method.as_str(), segments[2]) {
            ("GET", "resources") if segments.len() >= 4 => {
                let resource_id = percent_decode(segments[3]);
                let requested_path = request
                    .query
                    .get("path")
                    .map(String::as_str)
                    .filter(|value| !value.trim().is_empty());
                let payload = host_rpc.request(
                    "resources/read",
                    json!({
                        "ref": format!("{package_id}/{resource_id}"),
                        "path": requested_path,
                    }),
                )?;
                let contents = payload
                    .get("contentsBase64")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Host did not return resource contents.".to_string())?;
                let contents = BASE64
                    .decode(contents)
                    .map_err(|error| format!("Host returned invalid resource data: {error}"))?;
                let content_type = payload
                    .get("contentType")
                    .and_then(Value::as_str)
                    .unwrap_or("application/octet-stream")
                    .to_string();
                return Ok(ApiResponse::Bytes {
                    contents,
                    content_type,
                });
            }
            ("GET", "files") if segments.len() >= 4 => {
                let relative_path = segments[3..]
                    .iter()
                    .map(|segment| percent_decode(segment))
                    .collect::<Vec<_>>()
                    .join("/");
                let payload = host_rpc.request(
                    "packages/readFile",
                    json!({ "packageId": package_id, "relativePath": relative_path }),
                )?;
                let contents = payload
                    .get("contentsBase64")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Host did not return package file contents.".to_string())?;
                let contents = BASE64
                    .decode(contents)
                    .map_err(|error| format!("Host returned invalid file data: {error}"))?;
                let content_type = payload
                    .get("contentType")
                    .and_then(Value::as_str)
                    .unwrap_or("application/octet-stream")
                    .to_string();
                return Ok(ApiResponse::Bytes {
                    contents,
                    content_type,
                });
            }
            ("GET", "settings") => {
                return host_rpc
                    .request("packages/settings", json!({ "packageId": package_id }))
                    .map(ApiResponse::Json);
            }
            ("GET", "registry") if segments.len() >= 4 => {
                let key = segments[3..]
                    .iter()
                    .map(|segment| percent_decode(segment))
                    .collect::<Vec<_>>()
                    .join("/");
                return host_rpc
                    .request("registry/get", json!({ "key": key }))
                    .map(ApiResponse::Json);
            }
            ("POST", "services") if segments.len() == 4 && segments[3] == "call" => {
                let body = serde_json::from_slice::<Value>(&request.body)
                    .map_err(|error| format!("Invalid service call body: {error}"))?;
                return host_rpc
                    .request(
                        "services/call",
                        json!({
                            "serviceRef": body.get("serviceRef").cloned().unwrap_or(Value::Null),
                            "method": body.get("method").cloned().unwrap_or(Value::Null),
                            "input": body.get("input").cloned().unwrap_or(Value::Null)
                        }),
                    )
                    .map(ApiResponse::Json);
            }
            _ => {}
        }
    }

    if request.method == "GET" && segments.first() == Some(&"registry") && segments.len() >= 2 {
        let key = segments[1..]
            .iter()
            .map(|segment| percent_decode(segment))
            .collect::<Vec<_>>()
            .join("/");
        return host_rpc
            .request("registry/get", json!({ "key": key }))
            .map(ApiResponse::Json);
    }

    Err(format!(
        "OBS gateway API route '/{api_path}' is not supported."
    ))
}

fn api_subpath<'a>(routes: &RouteMap, path: &'a str) -> Option<&'a str> {
    if path == routes.api_base {
        return Some("");
    }
    path.strip_prefix(&format!("{}/", routes.api_base))
}

fn write_html(stream: &mut TcpStream, status: u16, body: &str) -> io::Result<()> {
    write_response(
        stream,
        status,
        status_text(status),
        &[("Content-Type", "text/html; charset=utf-8")],
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

fn authorized(
    shared: &SharedGateway,
    authorization: Option<&str>,
    query: &HashMap<String, String>,
) -> bool {
    let Ok(state) = shared.state.lock() else {
        return false;
    };
    if !auth_required(&state) {
        return true;
    }
    let Some(token) = state
        .access_token
        .as_deref()
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    authorization == Some(&format!("Bearer {token}"))
        || query.get("token").is_some_and(|value| value == token)
        || query
            .get("access_token")
            .is_some_and(|value| value == token)
}

fn auth_required(state: &GatewayState) -> bool {
    state.config.require_token || !is_local_bind_address(&state.config.listen_address)
}

fn auth_query(state: &GatewayState) -> Option<String> {
    if !auth_required(state) {
        return None;
    }
    state
        .access_token
        .as_deref()
        .filter(|value| !value.is_empty())
        .map(|token| format!("token={}", query_component(token)))
}

fn is_local_bind_address(address: &str) -> bool {
    let value = address.trim().trim_matches(['[', ']']);
    value == "localhost" || value == "::1" || value.starts_with("127.")
}

fn append_auth_query(url: &str, auth_query: Option<&str>) -> String {
    match auth_query {
        Some(query) if !query.is_empty() && url.contains('?') => format!("{url}&{query}"),
        Some(query) if !query.is_empty() => format!("{url}?{query}"),
        _ => url.to_string(),
    }
}

fn selected_stream_layout(shared: &SharedGateway) -> Option<String> {
    let state = shared.state.lock().ok()?;
    if !state.config.stream_layout_id.trim().is_empty() {
        return Some(state.config.stream_layout_id.clone());
    }
    state.host.layouts.first().map(|layout| layout.id.clone())
}

fn normalize_host_layout(input: HostLayoutInput) -> Option<HostLayout> {
    let id = input.id?.trim().to_string();
    if id.is_empty() {
        return None;
    }
    Some(HostLayout {
        name: input
            .name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| id.clone()),
        source: input
            .source
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "host".to_string()),
        id,
        item_count: input.item_count,
    })
}

fn host_snapshot_unavailable(error: Option<String>) -> Value {
    json!({
        "ok": false,
        "error": error.unwrap_or_else(|| "Layout Studio snapshot is unavailable.".to_string())
    })
}

fn overlay_html(routes: &RouteMap, layout_id: Option<&str>) -> String {
    r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BakingRL OBS Gateway</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#f8fafc;font:16px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
#viewport{position:fixed;inset:0;overflow:hidden;background:transparent}
#stage{position:absolute;left:50%;top:50%;transform-origin:center;background:transparent}
.visual-export,.native-export{box-sizing:border-box}
.native-page-block{display:block}
.native-page-text{box-sizing:border-box}
.status{position:fixed;left:16px;bottom:16px;max-width:min(560px,calc(100vw - 32px));padding:10px 12px;border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.82);color:#dbeafe;font-size:13px;white-space:pre-wrap}
.status:empty{display:none}
</style>
</head>
<body>
<main id="viewport"><section id="stage"></section></main>
<pre id="status" class="status">Loading BakingRL overlay...</pre>
<script>
const requestedLayoutId = "__LAYOUT_ID__";
const apiBase = "__API_BASE__";
const eventsPath = "__EVENTS__";
const stage = document.getElementById("stage");
const statusNode = document.getElementById("status");
let mounted = new Map();
let latestTelemetry = null;

function setStatus(message) {
  statusNode.textContent = message || "";
}

function withAuth(path) {
  const query = window.location.search ? window.location.search.slice(1) : "";
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

function encodePath(value) {
  return String(value || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function packageFileUrl(packageId, path, version) {
  const base = `${apiBase}/packages/${encodeURIComponent(packageId)}/files/${encodePath(path)}`;
  const versioned = version === undefined ? base : `${base}?v=${encodeURIComponent(String(version))}`;
  return withAuth(versioned);
}

function packageResourceUrl(packageId, resourceId, version, path) {
  const base = `${apiBase}/packages/${encodeURIComponent(packageId)}/resources/${encodeURIComponent(resourceId)}`;
  const query = new URLSearchParams();
  if (path) query.set("path", String(path));
  if (version !== undefined) query.set("v", String(version));
  const suffix = query.toString();
  return withAuth(suffix ? `${base}?${suffix}` : base);
}

function packageAssetUrl(packageId, ref, version) {
  const value = String(ref || "");
  if (/^(https?:|data:|blob:|\/)/.test(value)) return value;
  return packageFileUrl(packageId, value, version);
}

async function fetchJson(path, options) {
  const response = await fetch(withAuth(path), options);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

function layoutLayers(layout) {
  return [...(layout.layers || [])].sort((a, b) => {
    if (a.kind === "event" && b.kind !== "event") return 1;
    if (a.kind !== "event" && b.kind === "event") return -1;
    return Number(a.order || 0) - Number(b.order || 0);
  });
}

function layoutItems(layout) {
  return layoutLayers(layout).flatMap((layer) => (layer.items || []).map((item) => ({ layer, item })));
}

function selectLayout(catalog) {
  const layouts = Array.isArray(catalog) ? catalog : catalog.layouts || [];
  const target = requestedLayoutId || catalog.stream_layout_id || catalog.streamLayoutId || catalog.active_layout_id || catalog.activeLayoutId;
  return layouts.find((layout) => layout.id === target) || layouts[0] || null;
}

function itemKind(item) {
  return item.kind || "visual";
}

function itemVisible(layer, item) {
  return item.visible !== false && layer.visible !== false;
}

function applyItemStyle(root, layer, item, layout) {
  root.style.position = "absolute";
  root.style.left = `${(Number(item.x || 0) / layout.width) * 100}%`;
  root.style.top = `${(Number(item.y || 0) / layout.height) * 100}%`;
  root.style.width = `${(Number(item.width || 0) / layout.width) * 100}%`;
  root.style.height = `${(Number(item.height || 0) / layout.height) * 100}%`;
  root.style.zIndex = String(layer.kind === "event" ? 100000 + Number(item.z_index || item.zIndex || 0) : Number(item.z_index || item.zIndex || 0));
  root.style.opacity = String(item.opacity ?? 1);
  root.style.display = itemVisible(layer, item) ? "block" : "none";
  root.style.overflow = "hidden";
  root.style.pointerEvents = "auto";
  root.style.setProperty("--bakingrl-item-width", `${Number(item.width || 0)}px`);
  root.style.setProperty("--bakingrl-item-height", `${Number(item.height || 0)}px`);
  root.style.setProperty("--bakingrl-layout-width", `${layout.width}px`);
  root.style.setProperty("--bakingrl-layout-height", `${layout.height}px`);
}

function applyStageSize(layout) {
  const width = Math.max(1, Number(layout.width || 1920));
  const height = Math.max(1, Number(layout.height || 1080));
  const scale = Math.min(window.innerWidth / width, window.innerHeight / height);
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function renderNativeItem(root, item) {
  const settings = (item.settings && typeof item.settings === "object") ? item.settings : {};
  root.replaceChildren();
  if (itemKind(item) === "text") {
    const text = document.createElement("div");
    text.className = "native-page-text";
    text.textContent = String(settings.text ?? item.name ?? "");
    text.style.width = "100%";
    text.style.height = "100%";
    text.style.display = "flex";
    text.style.alignItems = String(settings.verticalAlign ?? "center");
    text.style.justifyContent = String(settings.align ?? "center");
    text.style.color = String(settings.color ?? "#f8fafc");
    text.style.fontSize = `${Number(settings.fontSize ?? 24)}px`;
    text.style.fontWeight = String(settings.fontWeight ?? 700);
    text.style.textAlign = String(settings.textAlign ?? "center");
    text.style.whiteSpace = "pre-wrap";
    text.style.overflow = "hidden";
    root.appendChild(text);
    return;
  }
  if (itemKind(item) === "image") {
    const image = document.createElement("img");
    image.src = String(settings.src ?? "");
    image.alt = String(settings.alt ?? item.name ?? "");
    image.style.width = "100%";
    image.style.height = "100%";
    image.style.objectFit = String(settings.fit ?? "cover");
    image.style.display = "block";
    root.appendChild(image);
    return;
  }
  const shape = document.createElement("div");
  shape.style.width = "100%";
  shape.style.height = "100%";
  shape.style.background = String(settings.fill ?? "rgba(255,255,255,.18)");
  shape.style.border = `${Number(settings.borderWidth ?? 1)}px solid ${String(settings.borderColor ?? "rgba(255,255,255,.3)")}`;
  shape.style.borderRadius = `${Number(settings.borderRadius ?? 8)}px`;
  root.appendChild(shape);
}

function packageForItem(packages, item) {
  const packageId = item.package_id || item.packageId;
  return packages.find((pkg) => pkg.id === packageId && pkg.enabled !== false && pkg.active !== false) || null;
}

function resourceId(resource) {
  return resource?.id || resource?.name || (resource?.reference ? String(resource.reference).split("/").pop() : null);
}

function itemResourceId(item) {
  return item.resource_id || item.resourceId || item.export_name || item.exportName;
}

function resourceType(resource) {
  return resource?.type || resource?.resource_type || resource?.resourceType || "";
}

function rendererResources(pkg) {
  return (pkg?.contributions?.resources || []).filter((resource) => {
    const metadata = (resource.metadata && typeof resource.metadata === "object") ? resource.metadata : {};
    const type = String(resourceType(resource));
    return resource.public !== false && metadata.role === "renderer-module" && (!type || type.includes("javascript"));
  });
}

function visualForItem(pkg, item) {
  const target = String(itemResourceId(item) || "");
  const resource = rendererResources(pkg).find((candidate) => {
    const id = resourceId(candidate);
    const reference = candidate.reference || (id ? `${pkg.id}/${id}` : "");
    return target === id || target === reference || target === candidate.name;
  });
  if (resource) return { ...resource, kind: "resource-module" };
  return (pkg?.contributions?.visuals || []).find((visual) => visual.name === item.export_name) || null;
}

async function packageSettings(packageId) {
  try {
    return await fetchJson(`${apiBase}/packages/${encodeURIComponent(packageId)}/settings`);
  } catch {
    return {};
  }
}

function createVisualContext(root, pkg, visual, item, settings) {
  const noop = () => {};
  return {
    root,
    package: pkg,
    exportName: item.export_name || item.exportName || itemResourceId(item),
    resource: visual.kind === "resource-module" ? visual : undefined,
    item,
    settings,
    mode: "runtime",
    setActive: noop,
    bus: { subscribe: () => noop },
    telemetryHub: {
      subscribe: () => noop,
      publish: (_eventName, payload) => { latestTelemetry = payload ?? null; },
      snapshot: () => latestTelemetry,
      getSnapshot: () => latestTelemetry
    },
    runtime: {
      packageId: pkg.id,
      api: pkg.compatibility?.bakingrlApi ?? null
    },
    registry: {
      get: (key) => fetchJson(`${apiBase}/packages/${encodeURIComponent(pkg.id)}/registry/${encodePath(key)}`)
    },
    services: {
      call: (serviceRef, method, input) => fetchJson(`${apiBase}/packages/${encodeURIComponent(pkg.id)}/services/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceRef, method, input: input ?? null })
      })
    },
    assets: {
      url: (ref) => packageAssetUrl(pkg.id, ref, pkg.version)
    },
    diagnostics: console
  };
}

function moduleUrlForVisual(pkg, visual) {
  const id = resourceId(visual);
  if (visual.kind === "resource-module" && id) {
    return packageResourceUrl(pkg.id, id, `${pkg.version}-${Date.now()}`);
  }
  return packageFileUrl(pkg.id, visual.entry, `${pkg.version}-${Date.now()}`);
}

async function mountVisual(root, pkg, visual, item) {
  const moduleUrl = moduleUrlForVisual(pkg, visual);
  const module = await import(moduleUrl);
  const visualExport = module.default || module;
  const settings = { ...(await packageSettings(pkg.id)), ...((item.settings && typeof item.settings === "object") ? item.settings : {}) };
  const context = createVisualContext(root, pkg, visual, item, settings);
  const cleanup = await visualExport.mount?.(context);
  return typeof cleanup === "function" ? cleanup : () => visualExport.unmount?.();
}

async function renderLayout(layout, packages) {
  for (const cleanup of mounted.values()) {
    try { cleanup(); } catch (error) { console.warn(error); }
  }
  mounted.clear();
  stage.replaceChildren();
  applyStageSize(layout);
  for (const { layer, item } of layoutItems(layout)) {
    const root = document.createElement("div");
    root.className = itemKind(item) === "visual" ? "visual-export" : "native-export native-page-block";
    root.dataset.itemId = item.id || "";
    applyItemStyle(root, layer, item, layout);
    stage.appendChild(root);
    if (itemKind(item) !== "visual") {
      renderNativeItem(root, item);
      continue;
    }
    const pkg = packageForItem(packages, item);
    const visual = pkg ? visualForItem(pkg, item) : null;
    if (!pkg || !visual) continue;
    try {
      mounted.set(item.id || `${pkg.id}/${item.export_name}`, await mountVisual(root, pkg, visual, item));
    } catch (error) {
      console.error(error);
      root.textContent = String(error);
      root.style.color = "#fecaca";
      root.style.background = "rgba(127,29,29,.72)";
    }
  }
}

async function loadAndRender() {
  const [packages, catalog] = await Promise.all([
    fetchJson(`${apiBase}/plugins`),
    fetchJson(`${apiBase}/layouts`)
  ]);
  latestTelemetry = catalog.telemetry ?? latestTelemetry;
  const layout = selectLayout(catalog);
  if (!layout) {
    setStatus("No BakingRL overlay layout is available.");
    return;
  }
  await renderLayout(layout, packages);
  setStatus("");
}

window.addEventListener("resize", () => loadAndRender().catch((error) => setStatus(String(error))));
loadAndRender().catch((error) => setStatus(String(error)));
try {
  const source = new EventSource(withAuth(eventsPath));
  source.addEventListener("obsGateway", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.eventType === "hostData" || data.type === "hostData" || data.event_type === "hostData") {
        void loadAndRender();
      }
    } catch {}
  });
} catch {}
window.__BAKINGRL_OBS_GATEWAY__ = { apiBase, eventsPath, requestedLayoutId };
</script>
</body>
</html>"##
        .replace("__LAYOUT_ID__", &escape_js(layout_id.unwrap_or_default()))
        .replace("__API_BASE__", &escape_js(&routes.api_base))
        .replace("__EVENTS__", &escape_js(&routes.events))
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
    let stream_page = join_route(&config.route_prefix, &config.stream_path);
    let api_base = join_route(&config.route_prefix, "/api");
    let events = join_route(&config.route_prefix, "/api/events");
    RouteMap {
        health: join_route(&config.route_prefix, "/health"),
        api_base,
        gateway_api: join_route(&config.route_prefix, "/api/gateway"),
        layouts_api: join_route(&config.route_prefix, "/api/layouts"),
        snapshot_api: join_route(&config.route_prefix, "/api/snapshot"),
        events: events.clone(),
        events_websocket: join_route(&events, "/ws"),
        stream_page,
        layout_page_base: join_route(&config.route_prefix, "/layouts"),
        configure: join_route(&config.route_prefix, "/api/configure"),
        connection_state: join_route(&config.route_prefix, "/api/connection-state"),
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

fn parse_request_target(target: &str) -> (String, HashMap<String, String>) {
    let (path, raw_query) = target.split_once('?').unwrap_or((target, ""));
    let query = raw_query
        .split('&')
        .filter_map(|pair| {
            if pair.is_empty() {
                return None;
            }
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            Some((percent_decode(key), percent_decode(value)))
        })
        .collect();
    (path.to_string(), query)
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

fn url_path_segment(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn query_component(value: &str) -> String {
    url_path_segment(value)
}

fn percent_decode(value: &str) -> String {
    let mut output = String::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex as char);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            ' '
        } else {
            bytes[index] as char
        });
        index += 1;
    }
    output
}

fn escape_js(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('<', "\\x3c")
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
        501 => "Not Implemented",
        _ => "Internal Server Error",
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared_with_auth(
        listen_address: &str,
        require_token: bool,
        credential: Option<&str>,
    ) -> SharedGateway {
        let shared = SharedGateway::new();
        {
            let mut state = shared
                .state
                .lock()
                .expect("gateway state should be available");
            state.config.listen_address = listen_address.to_string();
            state.config.require_token = require_token;
            state.access_token = credential.map(str::to_string);
            state.token_configured = credential.is_some();
        }
        shared
    }

    #[test]
    fn auth_is_required_by_configuration_even_when_the_credential_is_missing() {
        let local = shared_with_auth("127.0.0.1", true, None);
        let network = shared_with_auth("0.0.0.0", false, None);

        assert!(auth_required(
            &local.state.lock().expect("local state should be available")
        ));
        assert!(auth_required(
            &network
                .state
                .lock()
                .expect("network state should be available")
        ));
        assert!(!authorized(&local, None, &HashMap::new()));
        assert!(!authorized(&network, None, &HashMap::new()));
    }

    #[test]
    fn local_access_without_requested_authentication_remains_available() {
        let shared = shared_with_auth("localhost", false, None);

        assert!(!auth_required(
            &shared
                .state
                .lock()
                .expect("gateway state should be available")
        ));
        assert!(authorized(&shared, None, &HashMap::new()));
    }

    #[test]
    fn server_refuses_to_listen_when_required_authentication_has_no_credential() {
        let runtime = Runtime::new();
        {
            let mut state = runtime
                .shared
                .state
                .lock()
                .expect("gateway state should be available");
            state.config.enabled = true;
            state.config.require_token = true;
        }

        let error = runtime
            .sync_server()
            .expect_err("the gateway must fail closed without a credential");
        let snapshot = runtime.shared.snapshot();

        assert!(error.contains("authentication is required"));
        assert!(!snapshot.server.listening);
        assert_eq!(snapshot.last_error.as_deref(), Some(error.as_str()));
    }

    #[test]
    fn empty_origin_allowlist_rejects_origin_headers_but_keeps_direct_requests() {
        let mut config = GatewayConfig::default();
        config.allowed_origins.clear();

        assert!(origin_allowed(&config, None));
        assert!(!origin_allowed(&config, Some("http://127.0.0.1")));
    }

    #[test]
    fn required_authentication_accepts_only_the_matching_bearer_or_query_credential() {
        let credential = ["fixture", "credential"].join("-");
        let shared = shared_with_auth("127.0.0.1", true, Some(&credential));
        let bearer = format!("Bearer {credential}");
        let mut matching_query = HashMap::new();
        matching_query.insert("token".to_string(), credential.clone());
        let mut wrong_query = HashMap::new();
        wrong_query.insert("access_token".to_string(), "different-fixture".to_string());

        assert!(authorized(&shared, Some(&bearer), &HashMap::new()));
        assert!(authorized(&shared, None, &matching_query));
        assert!(!authorized(
            &shared,
            Some("Bearer different-fixture"),
            &HashMap::new()
        ));
        assert!(!authorized(&shared, None, &wrong_query));
    }
}
