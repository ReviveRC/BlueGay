use std::{fs,path::{Path,Component}};
use serde::Deserialize;
use tauri::Manager;
fn html(path:&Path)->bool{path.extension().and_then(|s|s.to_str()).map(|s|s.eq_ignore_ascii_case("html")||s.eq_ignore_ascii_case("htm")).unwrap_or(false)}
#[tauri::command]
pub async fn open_html(app:tauri::AppHandle,path:String)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{let disk=app.state::<crate::disk::DiskState>();let path=disk.authorize(&path).map_err(|e|e.message)?;if !path.is_file()||!html(&path){return Err("Choose an opened HTML file.".into());}let url=reqwest::Url::from_file_path(path).map_err(|_|"Invalid HTML file path")?;crate::open_browser(url.as_str())}).await.map_err(|e|e.to_string())?
}
#[derive(Deserialize)] pub struct PreviewFile{path:String,content:String}
fn safe_relative(path:&str)->bool{!path.is_empty()&&!path.contains(['\\',':','\0'])&&Path::new(path).components().all(|c|matches!(c,Component::Normal(_)))}
#[tauri::command]
pub async fn open_html_preview(app:tauri::AppHandle,path:String,files:Vec<PreviewFile>)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        if !safe_relative(&path)||!html(Path::new(&path))||files.len()>2000||files.iter().map(|f|f.content.len()).sum::<usize>()>128*1024*1024||files.iter().any(|f|!safe_relative(&f.path)){return Err("Invalid HTML preview workspace.".into());}
        if !files.iter().any(|f|f.path==path){return Err("The selected HTML file is missing.".into());}
        let parent=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("html-previews");fs::create_dir_all(&parent).map_err(|e|e.to_string())?;
        let directory=tempfile::Builder::new().prefix("preview-").tempdir_in(parent).map_err(|e|e.to_string())?.keep();
        for file in files{let target=directory.join(file.path);if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(|e|e.to_string())?;}fs::write(target,file.content).map_err(|e|e.to_string())?;}
        let url=reqwest::Url::from_file_path(directory.join(path)).map_err(|_|"Invalid preview path")?;crate::open_browser(url.as_str())
    }).await.map_err(|e|e.to_string())?
}
#[cfg(test)] mod tests{use super::*;#[test]fn previews_are_html_and_stay_in_their_snapshot(){for path in ["../a.html","a/../../b.html","C:/a.html","/a.html","a\\b.html",""]{assert!(!safe_relative(path));}assert!(safe_relative("pages/été #1.html"));assert!(html(Path::new("INDEX.HTML")));assert!(!html(Path::new("program.exe")));}}
