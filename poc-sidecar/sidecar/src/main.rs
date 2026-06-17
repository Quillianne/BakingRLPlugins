use std::io::{self, BufRead, Write};
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else {
            break;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let id = extract_id(trimmed);
        if method_is(trimmed, "ping") {
            write_result(
                &mut stdout,
                &id,
                &format!(
                    "{{\"ok\":true,\"method\":\"ping\",\"pid\":{},\"echo\":{}}}",
                    process::id(),
                    extract_params(trimmed)
                ),
            );
        } else if method_is(trimmed, "health") {
            write_result(
                &mut stdout,
                &id,
                &format!(
                    "{{\"ok\":true,\"status\":\"healthy\",\"pid\":{},\"checkedAtMs\":{}}}",
                    process::id(),
                    now_ms()
                ),
            );
        } else if method_is(trimmed, "crash") {
            write_result(
                &mut stdout,
                &id,
                "{\"ok\":false,\"status\":\"crashing\",\"exitCode\":42}",
            );
            process::exit(42);
        } else {
            write_error(&mut stdout, &id, -32601, "Unknown method");
        }
    }
}

fn method_is(line: &str, method: &str) -> bool {
    line.contains(&format!("\"method\":\"{method}\""))
        || line.contains(&format!("\"method\": \"{method}\""))
}

fn extract_id(line: &str) -> String {
    let Some(id_index) = line.find("\"id\"") else {
        return "null".to_string();
    };
    let Some(colon_index) = line[id_index..].find(':') else {
        return "null".to_string();
    };
    let start = id_index + colon_index + 1;
    let raw = line[start..].trim_start();
    if raw.starts_with('"') {
        let mut escaped = false;
        for (index, ch) in raw.char_indices().skip(1) {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                return raw[..=index].to_string();
            }
        }
        return "null".to_string();
    }
    let end = raw
        .find(',')
        .or_else(|| raw.find('}'))
        .unwrap_or(raw.len());
    raw[..end].trim().to_string()
}

fn extract_params(line: &str) -> String {
    let Some(params_index) = line.find("\"params\"") else {
        return "null".to_string();
    };
    let Some(colon_index) = line[params_index..].find(':') else {
        return "null".to_string();
    };
    let start = params_index + colon_index + 1;
    let raw = line[start..].trim_start();
    let end = raw.rfind('}').unwrap_or(raw.len());
    raw[..end].trim().trim_end_matches(',').to_string()
}

fn write_result(stdout: &mut io::Stdout, id: &str, result: &str) {
    let _ = writeln!(stdout, "{{\"jsonrpc\":\"2.0\",\"id\":{},\"result\":{}}}", id, result);
    let _ = stdout.flush();
}

fn write_error(stdout: &mut io::Stdout, id: &str, code: i64, message: &str) {
    let escaped = message.replace('"', "\\\"");
    let _ = writeln!(
        stdout,
        "{{\"jsonrpc\":\"2.0\",\"id\":{},\"error\":{{\"code\":{},\"message\":\"{}\"}}}}",
        id, code, escaped
    );
    let _ = stdout.flush();
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}
