// Explicit, minimal live diagnostic. Never sends project files or prints credentials.
#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let key = keyring::Entry::new("app.bluegay.ide.ChatLGBT", "openai-api-key")?
        .get_password().ok().or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .ok_or("No configured API key; use ChatLGBT settings first.")?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none()).build()?;
    let mut response = client.post("https://api.openai.com/v1/responses")
        .bearer_auth(&key).json(&serde_json::json!({
            "model":"gpt-6.1-sol", "input":"Reply with OK.",
            "max_output_tokens":1000, "stream":true, "store":false
        })).send().await?;
    println!("HTTP {}", response.status().as_u16());
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > 100000 { return Err("Diagnostic response exceeded limit".into()); }
    }
    let text = String::from_utf8_lossy(&bytes);
    for line in text.lines() {
        let raw = line.strip_prefix("data: ").unwrap_or(line);
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) {
            let kind = value["type"].as_str().unwrap_or("http_error");
            if matches!(kind, "error" | "http_error" | "response.failed" | "response.incomplete" | "response.completed") {
                let details = serde_json::json!({"event":kind, "error":value.get("error").or_else(||value.pointer("/response/error")), "code":value.get("code"), "message":value.get("message"), "incomplete":value.pointer("/response/incomplete_details")});
                println!("{}", details.to_string().replace(&key, "[redacted]"));
            }
        }
    }
    Ok(())
}
