//! Local preferences only. API keys stay in the credential store.
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::State;

pub struct SettingsState { pub path: PathBuf, pub writes: Mutex<()> }

fn validate(value: &Value) -> Result<(), String> {
    let invalid = || "Invalid settings.json format".to_string();
    let root = value.as_object().ok_or_else(invalid)?;
    if value["version"].as_u64() != Some(1) || root.keys().any(|key| !["version", "preferences", "chat"].contains(&key.as_str())) { return Err(invalid()); }
    let defaults: Value = serde_json::from_str(include_str!("../../settings-defaults.json")).map_err(|e| e.to_string())?;
    for group in ["preferences", "chat"] {
        for (key, item) in value[group].as_object().ok_or_else(invalid)? {
            let expected = &defaults[group][key];
            let valid = match item {
                Value::Bool(_) => expected.is_boolean(),
                Value::Number(n) => expected.is_number() && n.as_u64().is_some_and(|n| (1..=16000).contains(&n)),
                Value::String(s) => expected.is_string() && s.len() <= 200 && !s.chars().any(|c| c.is_control()) && (key != "accent" || s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())),
                _ => false,
            };
            if !valid { return Err(format!("Invalid setting: {key}")); }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn load_settings(state: State<SettingsState>) -> Result<Value, String> {
    let _lock = state.writes.lock().map_err(|_| "Settings are busy")?;
    let settings = match fs::read(&state.path) {
        Ok(bytes) => {
            if bytes.len() > 16000 { return Err("Settings file is too large".into()); }
            let value = serde_json::from_slice(&bytes).map_err(|_| "Cannot read settings.json. The existing file has been preserved.")?;
            validate(&value)?;
            value
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(error) => return Err(error.to_string()),
    };
    Ok(json!({"settings": settings, "path": state.path.to_string_lossy()}))
}

#[tauri::command]
pub fn save_settings(state: State<SettingsState>, settings: Value) -> Result<Value, String> {
    validate(&settings)?;
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    if bytes.len() > 16000 { return Err("Settings file is too large".into()); }
    let _lock = state.writes.lock().map_err(|_| "Settings are busy")?;
    let parent = state.path.parent().ok_or("Settings folder unavailable")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(&bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(&state.path).map_err(|e| e.to_string())?;
    Ok(json!({"path": state.path.to_string_lossy()}))
}
