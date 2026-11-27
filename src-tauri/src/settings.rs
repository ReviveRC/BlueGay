//! Local preferences only. API keys stay in the credential store.
use serde_json::{json, Value};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};
use tauri::State;

pub struct SettingsState { pub path: PathBuf, pub writes: Mutex<()> }

fn validate(value: &Value) -> Result<(), String> {
    let invalid = || "Invalid settings.json format".to_string();
    let root = value.as_object().ok_or_else(invalid)?;
    if value["version"].as_u64() != Some(1) || root.keys().any(|key| !["version", "preferences", "chat", "customLanguages"].contains(&key.as_str())) { return Err(invalid()); }
    if let Some(packs) = root.get("customLanguages") { validate_languages(packs)?; }
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
            if bytes.len() > 1048576 { return Err("Settings file is too large".into()); }
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
    if bytes.len() > 1048576 { return Err("Settings file is too large".into()); }
    let _lock = state.writes.lock().map_err(|_| "Settings are busy")?;
    let parent = state.path.parent().ok_or("Settings folder unavailable")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary.write_all(&bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(&state.path).map_err(|e| e.to_string())?;
    Ok(json!({"path": state.path.to_string_lossy()}))
}

fn validate_languages(value: &Value) -> Result<(), String> {
    use std::collections::HashSet;
    let invalid = || "Invalid custom language pack".to_string();
    let packs = value.as_array().ok_or_else(invalid)?;
    if packs.len() > 16 || serde_json::to_vec(value).map_err(|_| invalid())?.len() > 524288 { return Err(invalid()); }
    let mut ids = HashSet::new();
    let mut associations = HashSet::new();
    for pack in packs {
        let fields = pack.as_object().ok_or_else(invalid)?;
        if fields.keys().any(|k| !["schemaVersion","id","name","version","extensions","filenames","keywords","builtins","lineComment","blockComment","brackets","quotes","stringPrefixes","snippets","ai"].contains(&k.as_str())) || pack["schemaVersion"].as_u64() != Some(1) || serde_json::to_vec(pack).map_err(|_| invalid())?.len() > 65536 { return Err(invalid()); }
        let string = |v: &Value, max: usize, multiline: bool| -> bool {
            v.as_str().is_some_and(|s| s.encode_utf16().count() <= max && !s.chars().any(|c| c <= '\u{1f}' && !(multiline && ['\n','\r','\t'].contains(&c)) || c == '\u{7f}'))
        };
        let id = pack["id"].as_str().ok_or_else(invalid)?;
        if id.is_empty() || id.len() > 40 || !id.starts_with(|c: char| c.is_ascii_lowercase()) || !id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') || !ids.insert(id) || !string(&pack["name"],64,false) || pack["name"].as_str().unwrap_or("").trim().is_empty() { return Err(invalid()); }
        for (key, max) in [("version",40),("lineComment",8)] { if fields.get(key).is_some_and(|v| !string(v,max,false)) { return Err(invalid()); } }
        for (key, count, max) in [("extensions",20,32),("filenames",20,80),("keywords",256,80),("builtins",256,80),("quotes",4,3),("stringPrefixes",8,4)] {
            if let Some(v) = fields.get(key) {
                let list = v.as_array().ok_or_else(invalid)?;
                if list.len() > count { return Err(invalid()); }
                for item in list {
                    if !string(item,max,false) || item.as_str() == Some("") { return Err(invalid()); }
                    let s = item.as_str().ok_or_else(invalid)?;
                    let identifier = |s: &str| !s.is_empty() && s.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_' || c == '$') && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
                    let valid = match key {
                        "extensions" => s.starts_with('.') && s.len() > 1 && s.as_bytes()[1].is_ascii_alphanumeric() && s[1..].bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)),
                        "filenames" => !s.chars().any(|c| "\\/:*?\"<>|".contains(c)),
                        "keywords" | "builtins" => s.split('.').all(identifier),
                        "quotes" => ["\"","'","\"\"\"","'''"].contains(&s),
                        "stringPrefixes" => s.chars().all(|c| c.is_ascii_alphabetic()),
                        _ => true,
                    };
                    if !valid { return Err(invalid()); }
                    if ["extensions","filenames"].contains(&key) && !associations.insert(s.to_lowercase()) { return Err("Duplicate custom language file association".into()); }
                }
            } else if key == "extensions" { return Err(invalid()); }
        }
        if pack["extensions"].as_array().map_or(0,Vec::len) + pack["filenames"].as_array().map_or(0,Vec::len) == 0 { return Err(invalid()); }
        let pair_valid = |v: &Value| -> bool {
            v.as_array().is_some_and(|pair| pair.len() == 2 && pair.iter().all(|s| string(s,8,false) && s.as_str().is_some_and(|s| !s.is_empty() && !s.chars().any(|c| c.is_whitespace() || c.is_alphanumeric() || c == '_'))))
        };
        if let Some(v) = fields.get("blockComment") { if v.as_array().is_none_or(|p| !p.is_empty() && !pair_valid(v)) { return Err(invalid()); } }
        if let Some(v) = fields.get("brackets") { if v.as_array().is_none_or(|p| p.len() > 8 || !p.iter().all(pair_valid)) { return Err(invalid()); } }
        if let Some(v) = fields.get("snippets") {
            let snippets = v.as_array().ok_or_else(invalid)?;
            if snippets.len() > 100 { return Err(invalid()); }
            for snippet in snippets {
                let obj = snippet.as_object().ok_or_else(invalid)?;
                if obj.keys().any(|k| !["prefix","description","body"].contains(&k.as_str())) || !string(&snippet["prefix"],40,false) || !snippet["prefix"].as_str().is_some_and(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c))) || !string(&snippet["body"],4000,true) || obj.get("description").is_some_and(|v| !string(v,160,false)) { return Err(invalid()); }
            }
        }
        if let Some(v) = fields.get("ai") {
            let ai = v.as_object().ok_or_else(invalid)?;
            if ai.keys().any(|k| !["enabled","inline","reference","examples"].contains(&k.as_str())) || ["enabled","inline"].iter().any(|key| ai.get(*key).is_some_and(|v| !v.is_boolean())) { return Err(invalid()); }
            for (key,max) in [("reference",24000),("examples",12000)] { if ai.get(key).is_some_and(|v| !string(v,max,true)) { return Err(invalid()); } }
        }
    }
    Ok(())
}

#[cfg(test)]
mod language_tests {
    use super::*;
    #[test]
    fn nomix_pack_and_legacy_settings_validate() {
        let pack: Value = serde_json::from_str(include_str!("../../dist/language-packs/nomix.json")).unwrap();
        let mut settings: Value = serde_json::from_str(include_str!("../../settings-defaults.json")).unwrap();
        validate(&settings).unwrap();
        settings["customLanguages"] = json!([pack.clone()]);
        validate(&settings).unwrap();
        settings["customLanguages"] = json!([pack.clone(),pack.clone()]);
        assert!(validate(&settings).is_err());
        settings["customLanguages"] = json!([pack]);
        settings["customLanguages"][0]["execute"] = json!("some command");
        assert!(validate(&settings).is_err());
    }
}
