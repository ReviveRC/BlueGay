//! Native disk boundary. Webview paths are never trusted: only files/folders
//! selected through native dialogs or OS file drops (and their persisted grants) are accessible.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};

#[path = "together.rs"]
pub mod together;

const FILE_LIMIT: u64 = 50 * 1024 * 1024;
const WORKSPACE_LIMIT: usize = 128 * 1024 * 1024;
const FILE_COUNT_LIMIT: usize = 2000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskError {
    code: &'static str,
    pub(crate) message: String,
}
type Result<T> = std::result::Result<T, DiskError>;
fn error(code: &'static str, message: impl ToString) -> DiskError {
    DiskError { code, message: message.to_string() }
}
fn io(e: std::io::Error) -> DiskError { error("io", e) }

#[derive(Default, Serialize, Deserialize)]
struct Grants {
    roots: BTreeSet<PathBuf>,
    files: BTreeSet<PathBuf>,
}

pub struct DiskState {
    grants: Mutex<Grants>,
    // Serializes app writes, rename, and trash so overlapping saves cannot race.
    writes: Mutex<()>,
    pending_drops: Mutex<BTreeMap<String, Vec<PathBuf>>>,
    config: PathBuf,
}
impl DiskState {
    pub fn load(config: PathBuf) -> Self {
        let grants = fs::read(config.join("file-access.json"))
            .ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { grants: Mutex::new(grants), writes: Mutex::new(()), pending_drops: Mutex::new(BTreeMap::new()), config }
    }
    // Only the native OS drop callback can enqueue paths. IPC accepts a single-use
    // ticket, never arbitrary paths that could grant access to unrelated files.
    pub fn queue_drop(&self, paths: &[PathBuf]) -> Result<String> {
        if paths.is_empty() || paths.len() > FILE_COUNT_LIMIT { return Err(error("drop", "Drop between 1 and 2,000 files at a time.")); }
        let mut pending = self.pending_drops.lock().map_err(|_| error("state", "Drop state unavailable"))?;
        if pending.len() >= 16 { pending.clear(); }
        let mut bytes = [0;16]; getrandom::fill(&mut bytes).map_err(|e| error("state",e))?;
        let id = bytes.iter().map(|b|format!("{b:02x}")).collect::<String>();
        pending.insert(id.clone(), paths.to_vec());
        Ok(id)
    }
    fn consume_drop(&self, id: &str, discard: bool) -> Result<Option<OpenedDrop>> {
        let selected = self.pending_drops.lock().map_err(|_|error("state","Drop state unavailable"))?
            .remove(id).ok_or_else(||error("drop","This file drop has expired. Drop the files again."))?;
        if discard { return Ok(None); }
        let paths = selected.iter().map(|p|resolved_target(p)).collect::<Result<Vec<_>>>()?;
        if paths.iter().any(|p|p.is_dir()) {
            if paths.len()!=1 { return Err(error("drop","Drop a single project folder, or one or more files.")); }
            let root=&paths[0];
            self.grant(root,true)?;
            let mut workspace=Workspace {root:root.to_string_lossy().into(),name:root.file_name().unwrap_or_default().to_string_lossy().into(),files:vec![],folders:vec![],skipped:0};
            walk(root,root,&mut workspace,&mut 0)?;
            return Ok(Some(OpenedDrop::Folder(workspace)));
        }
        let mut documents=Vec::new();
        for path in paths {
            let document=entry_document(&path,None)?;
            self.grant(&path,false)?;
            documents.push(document);
        }
        Ok(Some(OpenedDrop::Files(documents)))
    }
    fn grant(&self, path: &Path, folder: bool) -> Result<()> {
        let mut grants = self.grants.lock().map_err(|_| error("state", "Disk state unavailable"))?;
        if folder { grants.roots.insert(path.into()); } else { grants.files.insert(path.into()); }
        fs::create_dir_all(&self.config).map_err(io)?;
        atomic_write(&self.config.join("file-access.json"), &serde_json::to_vec(&*grants)
            .map_err(|e| error("state", e))?)
    }
    pub(crate) fn authorize(&self, input: &str) -> Result<PathBuf> {
        let path = resolved_target(Path::new(input))?;
        let grants = self.grants.lock().map_err(|_| error("state", "Disk state unavailable"))?;
        if grants.files.contains(&path) || grants.roots.iter().any(|root| path.starts_with(root)) {
            Ok(path)
        } else {
            Err(error("permission", "Open this file or its containing folder before accessing it."))
        }
    }
}

#[derive(Serialize)]
#[serde(tag="kind",content="data",rename_all="camelCase")]
pub enum OpenedDrop { Files(Vec<Document>), Folder(Workspace) }

#[tauri::command]
pub async fn open_dropped_paths(app: tauri::AppHandle, id: String, discard: bool) -> Result<Option<OpenedDrop>> {
    tauri::async_runtime::spawn_blocking(move ||app.state::<DiskState>().consume_drop(&id,discard))
        .await.map_err(|e|error("state",e))?
}

// Resolve existing ancestors before checking grants. Reject traversal, streams,
// Windows device names, and symlinks rather than letting a project escape its root.
fn resolved_target(input: &Path) -> Result<PathBuf> {
    if !input.is_absolute() { return Err(error("path", "An absolute path is required.")); }
    for component in input.components() {
        match component {
            Component::ParentDir | Component::CurDir => return Err(error("path", "Relative path components are not allowed.")),
            Component::Normal(name) => {
                let value = name.to_string_lossy();
                let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
                if value.contains(':') || value.ends_with('.') || value.ends_with(' ') ||
                    ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"].contains(&stem.as_str()) {
                    return Err(error("path", "This filename is not supported."));
                }
            }
            _ => {}
        }
    }
    let mut cursor = PathBuf::new();
    for component in input.components() {
        cursor.push(component.as_os_str());
        // A Windows verbatim drive prefix (\\?\C:) is not a complete path
        // until its root and normal components have been appended.
        if !matches!(component, Component::Normal(_)) { continue; }
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() => return Err(error("path", "Symbolic links are not followed. Open the actual target folder.")),
            Ok(_) => {},
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(io(e)),
        }
    }
    let mut ancestor = input.to_path_buf();
    let mut tail = Vec::new();
    while !ancestor.exists() {
        tail.push(ancestor.file_name().ok_or_else(|| error("path", "Invalid file path"))?.to_os_string());
        if !ancestor.pop() { return Err(error("path", "No existing parent folder")); }
    }
    let mut resolved = fs::canonicalize(ancestor).map_err(io)?;
    for part in tail.iter().rev() { resolved.push(part); }
    Ok(resolved)
}

fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn disk_version(path: &Path) -> Result<Option<String>> {
    let mut handle = match fs::File::open(path) {
        Ok(handle) => handle,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io(e)),
    };
    if !handle.metadata().map_err(io)?.is_file() { return Err(error("unsupported", "Not a regular file")); }
    let mut digest=Sha256::new();let mut buffer=[0;65536];
    loop {let count=handle.read(&mut buffer).map_err(io)?;if count==0{break;}digest.update(&buffer[..count]);}
    Ok(Some(format!("{:x}",digest.finalize())))
}
fn version_matches(path: &Path, expected: &str) -> Result<bool> {
    if expected.starts_with("metadata:") {Ok(entry_document(path,None)?.version==expected)}
    else {Ok(disk_version(path)?.as_deref()==Some(expected))}
}
fn renamed_document(path: &Path, root: Option<&Path>, expected: &str) -> Result<Document> {
    let document=entry_document(path,root)?;
    if document.unsupported.is_some()&&!expected.starts_with("metadata:"){read_anyway(path,root)}else{Ok(document)}
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| error("path", "No parent folder"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(io)?;
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.permissions().readonly() { return Err(error("readonly", "The file is read-only.")); }
        temporary.as_file().set_permissions(metadata.permissions()).map_err(io)?;
    }
    temporary.write_all(bytes).map_err(io)?;
    temporary.as_file().sync_all().map_err(io)?;
    temporary.persist(path).map_err(|e| io(e.error))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    absolute_path: String,
    path: String,
    content: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    unsupported: Option<String>,
    force_open: bool,
    preview_only: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    root: String,
    name: String,
    files: Vec<Document>,
    folders: Vec<String>,
    skipped: usize,
}

fn read(path: &Path, root: Option<&Path>) -> Result<Document> {
    let handle = fs::File::open(path).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        error("missing", "The file was moved or deleted outside BlueGay.")
    } else { io(e) })?;
    let metadata = handle.metadata().map_err(io)?;
    if !metadata.is_file() { return Err(error("unsupported", "Not a regular file")); }
    if metadata.len() > FILE_LIMIT { return Err(error("unsupported", "Files larger than 50 MB cannot be edited.")); }
    let mut bytes = Vec::new();
    handle.take(FILE_LIMIT + 1).read_to_end(&mut bytes).map_err(io)?;
    if bytes.len() as u64 > FILE_LIMIT || bytes.contains(&0) { return Err(error("unsupported", "Binary files and files larger than 50 MB are not opened.")); }
    let version = hash(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| error("unsupported", "Only UTF-8 text is currently supported."))?;
    let display = root.and_then(|r| path.strip_prefix(r).ok()).unwrap_or_else(|| Path::new(path.file_name().unwrap_or_default()));
    Ok(Document { absolute_path: path.to_string_lossy().into(), path: display.to_string_lossy().replace('\\', "/"), content, version, unsupported: None, force_open:false, preview_only:false })
}

// Explicit Open anyway: allow oversized UTF-8 text, but never reinterpret binary
// bytes as editable text. A bounded hex preview retains the original on disk.
fn read_anyway(path: &Path, root: Option<&Path>) -> Result<Document> {
    let mut handle=fs::File::open(path).map_err(|e|if e.kind()==std::io::ErrorKind::NotFound {error("missing","The file was moved or deleted outside BlueGay.")}else{io(e)})?;
    let metadata=handle.metadata().map_err(io)?;
    if !metadata.is_file(){return Err(error("unsupported","Not a regular file"));}
    let mut bytes=Vec::new();
    (&mut handle).take(65536).read_to_end(&mut bytes).map_err(io)?;
    let binary=bytes.contains(&0)||std::str::from_utf8(&bytes).err().is_some_and(|e|e.error_len().is_some());
    if !binary {
        let remaining=usize::try_from(metadata.len()).map_err(|_|error("memory","This file is too large for the available address space."))?.saturating_sub(bytes.len());
        bytes.try_reserve(remaining).map_err(|_|error("memory","There is not enough memory to open this file."))?;
        handle.read_to_end(&mut bytes).map_err(io)?;
        if !bytes.contains(&0) {
            if let Ok(content)=std::str::from_utf8(&bytes) {
                let display=root.and_then(|r|path.strip_prefix(r).ok()).unwrap_or_else(||Path::new(path.file_name().unwrap_or_default()));
                return Ok(Document {absolute_path:path.to_string_lossy().into(),path:display.to_string_lossy().replace('\\',"/"),content:content.into(),version:hash(&bytes),unsupported:None,force_open:true,preview_only:false});
            }
        }
    }
    let preview=&bytes[..bytes.len().min(65536)];
    let mut content=format!("Read-only binary preview — showing {} of {} bytes\n\n",preview.len(),metadata.len());
    for (index,chunk) in preview.chunks(16).enumerate(){
        let hex=chunk.iter().map(|b|format!("{b:02X} ")).collect::<String>();
        let ascii=chunk.iter().map(|b|if (32..=126).contains(b){*b as char}else{'.'}).collect::<String>();
        content.push_str(&format!("{:08X}  {:48}  {}\n",index*16,hex,ascii));
    }
    let mut document=metadata_document(path,root,"Binary contents are shown as a read-only hex preview. The original bytes are unchanged.".into())?;
    document.content=content;document.force_open=true;document.preview_only=true;
    Ok(document)
}

// Explorer entries may be non-editable. Never represent their bytes as editable text.
fn entry_document(path: &Path, root: Option<&Path>) -> Result<Document> {
    let extension = path.extension().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
    let binary = ["png", "gif", "jpg", "jpeg", "webp", "ico", "bmp", "avif", "pdf", "zip", "exe", "dll", "wasm", "woff", "woff2", "ttf", "mp3", "mp4", "wav", "ogg"].contains(&extension.as_str());
    let reason = if binary { "This file type cannot be opened in the text editor.".to_string() } else {
        match read(path, root) {
            Ok(document) => return Ok(document),
            Err(e) if e.code == "unsupported" || e.code == "io" => e.message,
            Err(e) => return Err(e),
        }
    };
    metadata_document(path, root, reason)
}

fn metadata_document(path: &Path, root: Option<&Path>, reason: String) -> Result<Document> {
    let metadata = fs::metadata(path).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        error("missing", "The file was moved or deleted outside BlueGay.")
    } else { io(e) })?;
    if !metadata.is_file() { return Err(error("unsupported", "Not a regular file")); }
    let display = root.and_then(|r| path.strip_prefix(r).ok()).unwrap_or_else(|| Path::new(path.file_name().unwrap_or_default()));
    Ok(Document { absolute_path: path.to_string_lossy().into(), path: display.to_string_lossy().replace('\\', "/"),
        content: String::new(), version: format!("metadata:{}:{:?}", metadata.len(), metadata.modified().map_err(io)?), unsupported: Some(reason), force_open:false, preview_only:false })
}

fn walk(root: &Path, directory: &Path, workspace: &mut Workspace, total: &mut usize) -> Result<()> {
    let mut entries = fs::read_dir(directory).map_err(io)?.collect::<std::io::Result<Vec<_>>>().map_err(io)?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if workspace.files.len() >= FILE_COUNT_LIMIT || workspace.folders.len() >= 4000 ||
            directory.strip_prefix(root).map(|p| p.components().count()).unwrap_or(0) > 64 {
            workspace.skipped += 1;
            continue;
        }
        let path = match resolved_target(&entry.path()) {
            Ok(path) if path.starts_with(root) => path,
            _ => { workspace.skipped += 1; continue; }
        };
        let kind = entry.file_type().map_err(io)?;
        if kind.is_symlink() { workspace.skipped += 1; continue; }
        if kind.is_dir() {
            workspace.folders.push(path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
            if walk(root, &path, workspace, total).is_err() { workspace.skipped += 1; }
        } else if kind.is_file() {
            match entry_document(&path, Some(root)) {
                Ok(mut document) => {
                    if *total + document.content.len() > WORKSPACE_LIMIT {
                        document = metadata_document(&path, Some(root), "Workspace text limit reached. Open this file separately to edit it.".into())?;
                    }
                    *total += document.content.len();
                    workspace.files.push(document);
                }
                _ => workspace.skipped += 1,
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_folder(state: State<'_, DiskState>) -> Result<Option<Workspace>> {
    let selection = tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().set_title("Open folder in BlueGay").pick_folder())
        .await.map_err(|e| error("dialog", e))?;
    let Some(selected) = selection else { return Ok(None) };
    let root = resolved_target(&selected)?;
    state.grant(&root, true)?;
    let mut workspace = Workspace {
        name: root.file_name().unwrap_or_default().to_string_lossy().into(),
        root: root.to_string_lossy().into(), files: Vec::new(), folders: Vec::new(), skipped: 0,
    };
    let mut total = 0;
    walk(&root, &root, &mut workspace, &mut total)?;
    Ok(Some(workspace))
}

#[tauri::command]
pub async fn open_files(state: State<'_, DiskState>) -> Result<Vec<Document>> {
    let selection = tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().set_title("Open files in BlueGay").pick_files())
        .await.map_err(|e| error("dialog", e))?;
    let mut documents = Vec::new();
    for selected in selection.unwrap_or_default() {
        let path = resolved_target(&selected)?;
        let document = entry_document(&path, None)?;
        state.grant(&path, false)?;
        documents.push(document);
    }
    Ok(documents)
}

#[tauri::command]
pub fn read_document(state: State<'_, DiskState>, path: String, force_open: Option<bool>) -> Result<Document> {
    let path=state.authorize(&path)?;
    if force_open.unwrap_or(false){read_anyway(&path,None)}else{entry_document(&path,None)}
}

#[tauri::command]
pub fn refresh_workspace(state: State<'_, DiskState>, root: String) -> Result<Workspace> {
    let root = state.authorize(&root)?;
    let mut workspace = Workspace { name: root.file_name().unwrap_or_default().to_string_lossy().into(),
        root: root.to_string_lossy().into(), files: Vec::new(), folders: Vec::new(), skipped: 0 };
    walk(&root, &root, &mut workspace, &mut 0)?;
    Ok(workspace)
}

#[cfg(test)]
fn write_checked(state: &DiskState, path: &Path, content: String, expected_version: Option<String>) -> Result<Document> {
    write_checked_with_override(state,path,content,expected_version,false)
}
fn write_checked_with_override(state: &DiskState, path: &Path, content: String, expected_version: Option<String>, force_open: bool) -> Result<Document> {
    let _write = state.writes.lock().map_err(|_| error("state", "Disk state unavailable"))?;
    // None means a new file. It must not silently replace an existing file.
    let current = disk_version(path)?;
    if current != expected_version { return Err(error("conflict", "The file changed on disk. Review it before saving.")); }
    if content.len() as u64 > FILE_LIMIT && !force_open { return Err(error("size", "This file exceeds 50 MB. Choose Open anyway to allow large-file editing.")); }
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(io)?; }
    atomic_write(path, content.as_bytes())?;
    if force_open {read_anyway(path,None)} else {read(path, None)}
}

#[tauri::command]
pub fn save_document(state: State<'_, DiskState>, path: String, content: String, expected_version: Option<String>, force_open: Option<bool>) -> Result<Document> {
    let path = state.authorize(&path)?;
    write_checked_with_override(&state, &path, content, expected_version, force_open.unwrap_or(false))
}

#[tauri::command]
pub async fn save_document_as(state: State<'_, DiskState>, suggested_name: String, content: String, force_open: Option<bool>) -> Result<Option<Document>> {
    let name = Path::new(&suggested_name).file_name().unwrap_or_default().to_string_lossy().into_owned();
    let selection = tauri::async_runtime::spawn_blocking(move || rfd::FileDialog::new().set_title("Save file as").set_file_name(name).save_file())
        .await.map_err(|e| error("dialog", e))?;
    let Some(selected) = selection else { return Ok(None) };
    let path = resolved_target(&selected)?;
    // The native save dialog confirms overwriting an existing destination.
    let expected = disk_version(&path)?;
    state.grant(&path, false)?;
    write_checked_with_override(&state, &path, content, expected, force_open.unwrap_or(false)).map(Some)
}

#[tauri::command]
pub fn create_folder(state: State<'_, DiskState>, path: String) -> Result<()> {
    let _write = state.writes.lock().map_err(|_| error("state", "Disk state unavailable"))?;
    fs::create_dir_all(state.authorize(&path)?).map_err(io)
}

#[tauri::command]
pub fn rename_document(state: State<'_, DiskState>, path: String, destination: String, expected_version: String) -> Result<Document> {
    let _write = state.writes.lock().map_err(|_| error("state", "Disk state unavailable"))?;
    let source = state.authorize(&path)?;
    let target = state.authorize(&destination)?;
    if target.exists() { return Err(error("exists", "A file already exists at that path.")); }
    if !version_matches(&source,&expected_version)? { return Err(error("conflict", "The original file changed on disk.")); }
    if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(io)?; }
    // persist_noclobber never overwrites a file that appears after the check.
    let mut temp = tempfile::NamedTempFile::new_in(target.parent().unwrap()).map_err(io)?;
    std::io::copy(&mut fs::File::open(&source).map_err(io)?, &mut temp).map_err(io)?;
    temp.as_file().set_permissions(fs::metadata(&source).map_err(io)?.permissions()).map_err(io)?;
    temp.as_file().sync_all().map_err(io)?;
    temp.persist_noclobber(&target).map_err(|e| io(e.error))?;
    if let Err(e) = fs::remove_file(&source) {
        return Err(error("partial", format!("The new copy was created, but the original could not be removed: {e}. Reopen the folder to reconcile.")));
    }
    renamed_document(&target, None, &expected_version)
}

#[tauri::command]
pub fn trash_document(state: State<'_, DiskState>, path: String, expected_version: String) -> Result<()> {
    let _write = state.writes.lock().map_err(|_| error("state", "Disk state unavailable"))?;
    let target = state.authorize(&path)?;
    if !version_matches(&target,&expected_version)? { return Err(error("conflict", "The file changed on disk. Reload it before deleting.")); }
    trash::delete(target).map_err(|e| error("io", e))
}

fn folder_target(state: &DiskState, root: &str, path: &str) -> Result<PathBuf> {
    let root = state.authorize(root)?;
    let target = state.authorize(path)?;
    if target == root || !target.starts_with(&root) {
        return Err(error("path", "Only a folder inside the open project can be deleted."));
    }
    if target.exists() && !target.is_dir() { return Err(error("path", "Not a folder.")); }
    Ok(target)
}

#[tauri::command]
pub fn trash_folder(state: State<'_, DiskState>, root: String, path: String) -> Result<()> {
    let _write = state.writes.lock().map_err(|_| error("state", "Disk state unavailable"))?;
    let target = folder_target(&state, &root, &path)?;
    if !target.exists() { return Ok(()); } // An unsaved folder or one already removed externally.
    trash::delete(target).map_err(|e| error("io", e))
}

#[tauri::command]
pub async fn export_bytes(suggested_name: String, bytes: Vec<u8>) -> Result<bool> {
    let name = Path::new(&suggested_name).file_name().unwrap_or_default().to_string_lossy().into_owned();
    let selection = tauri::async_runtime::spawn_blocking(move || rfd::FileDialog::new().set_title("Export from BlueGay").set_file_name(name).save_file())
        .await.map_err(|e| error("dialog", e))?;
    let Some(selected) = selection else { return Ok(false) };
    atomic_write(&resolved_target(&selected)?, &bytes)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explorer_keeps_images_large_files_hidden_files_and_empty_folders() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir(root.join("img")).unwrap();
        fs::create_dir(root.join("empty")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join("img/photo.png"), [137, 80, 78, 71, 0]).unwrap();
        fs::write(root.join("img/animation.gif"), "GIF89a").unwrap();
        fs::write(root.join(".git/config"), "[core]").unwrap();
        fs::write(root.join("main.py"), "print(1)").unwrap();
        fs::File::create(root.join("large.log")).unwrap().set_len(FILE_LIMIT + 1).unwrap();
        let mut workspace = Workspace { root: root.to_string_lossy().into(), name: "test".into(), files: vec![], folders: vec![], skipped: 0 };
        walk(&root, &root, &mut workspace, &mut 0).unwrap();
        assert_eq!(workspace.files.len(), 5);
        assert_eq!(workspace.skipped, 0);
        assert!(workspace.folders.contains(&"empty".into()));
        for name in ["img/photo.png", "img/animation.gif", "large.log"] {
            let document = workspace.files.iter().find(|d| d.path == name).unwrap();
            assert!(document.unsupported.is_some());
            assert!(document.content.is_empty());
            assert_eq!(document.version, entry_document(&root.join(name), None).unwrap().version);
        }
        assert_eq!(workspace.files.iter().find(|d| d.path == "main.py").unwrap().content, "print(1)");
        assert_eq!(fs::read(root.join("img/photo.png")).unwrap(), [137, 80, 78, 71, 0]);
    }

    #[test]
    fn folder_deletion_target_must_be_inside_selected_project() {
        let temp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temp.path()).unwrap();
        let root = base.join("project");
        let other = base.join("project-other");
        fs::create_dir_all(root.join("img")).unwrap();
        fs::create_dir(&other).unwrap();
        let state = DiskState::load(base.join("config"));
        state.grant(&root, true).unwrap();
        state.grant(&other, true).unwrap();
        assert!(folder_target(&state, root.to_str().unwrap(), root.to_str().unwrap()).is_err());
        assert!(folder_target(&state, root.to_str().unwrap(), other.to_str().unwrap()).is_err());
        assert!(folder_target(&state, root.to_str().unwrap(), root.join("img").to_str().unwrap()).is_ok());
        assert!(folder_target(&state, root.to_str().unwrap(), root.join("../project-other").to_str().unwrap()).is_err());
        assert_eq!(entry_document(&root.join("missing.png"), None).unwrap_err().code, "missing");
    }
    #[test]
    fn saving_requires_access_and_detects_disk_conflicts() {
        let temp = tempfile::tempdir().unwrap();
        let folder = fs::canonicalize(temp.path()).unwrap();
        let path = folder.join("test.txt");
        fs::write(&path, "original").unwrap();
        let state = DiskState::load(folder.join("config"));
        assert!(state.authorize(path.to_str().unwrap()).is_err());
        state.grant(&folder, true).unwrap();
        let before = read(&path, None).unwrap();
        fs::write(&path, "external edit").unwrap();
        assert_eq!(write_checked(&state, &path, "my edit".into(), Some(before.version)).unwrap_err().code, "conflict");
        assert_eq!(fs::read_to_string(path).unwrap(), "external edit");
    }
    #[test]
    fn new_file_does_not_overwrite_existing_and_save_preserves_crlf() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.txt");
        let state = DiskState::load(temp.path().join("config"));
        let saved = write_checked(&state, &path, "a\r\nb\r\n".into(), None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"a\r\nb\r\n");
        assert!(write_checked(&state, &path, "overwrite".into(), None).is_err());
        write_checked(&state, &path, "updated".into(), Some(saved.version)).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), "updated");
    }
    #[test]
    fn rejects_parent_traversal() {
        let temp = tempfile::tempdir().unwrap();
        assert!(resolved_target(&temp.path().join("../escape.txt")).is_err());
    }

    #[test]
    fn native_drops_grant_only_selected_paths_and_tickets_are_single_use() {
        let temp=tempfile::tempdir().unwrap();
        let root=fs::canonicalize(temp.path()).unwrap();
        let path=root.join("dropped.txt");let sibling=root.join("other.txt");
        fs::write(&path,"original").unwrap();fs::write(&sibling,"private").unwrap();
        let state=DiskState::load(root.join("config"));
        assert!(state.consume_drop("forged",false).is_err());
        let ticket=state.queue_drop(&[path.clone()]).unwrap();
        let Some(OpenedDrop::Files(docs))=state.consume_drop(&ticket,false).unwrap() else {panic!("Expected files")};
        assert_eq!(docs[0].absolute_path,path.to_string_lossy());
        assert!(state.consume_drop(&ticket,false).is_err());
        let target=state.authorize(&docs[0].absolute_path).unwrap();
        write_checked(&state,&target,"saved to original".into(),Some(docs[0].version.clone())).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),"saved to original");
        assert!(state.authorize(sibling.to_str().unwrap()).is_err());
        let ignored=state.queue_drop(&[sibling.clone()]).unwrap();
        assert!(state.consume_drop(&ignored,true).unwrap().is_none());
        assert!(state.authorize(sibling.to_str().unwrap()).is_err());
    }

    #[test]
    fn fifty_mb_boundary_and_explicit_override_preserve_contents_and_conflicts() {
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("large.txt");
        let state=DiskState::load(temp.path().join("config"));
        let text="x".repeat(FILE_LIMIT as usize);
        let saved=write_checked(&state,&path,text,None).unwrap();
        assert_eq!(saved.content.len(),FILE_LIMIT as usize);
        assert!(entry_document(&path,None).unwrap().unsupported.is_none());
        let larger=saved.content+"y";
        assert_eq!(write_checked(&state,&path,larger.clone(),Some(saved.version.clone())).unwrap_err().code,"size");
        let forced=write_checked_with_override(&state,&path,larger,Some(saved.version),true).unwrap();
        assert!(forced.force_open);assert!(!forced.preview_only);
        assert_eq!(forced.content.len(),FILE_LIMIT as usize+1);
        assert!(entry_document(&path,None).unwrap().unsupported.is_some());
        assert_eq!(read_anyway(&path,None).unwrap().content,forced.content);
        fs::write(&path,"external edit").unwrap();
        assert_eq!(write_checked_with_override(&state,&path,"my edit".into(),Some(forced.version),true).unwrap_err().code,"conflict");
    }

    #[test]
    fn binary_override_is_a_bounded_preview_and_text_extensions_can_be_overridden() {
        let temp=tempfile::tempdir().unwrap();let path=temp.path().join("sample.exe");
        let bytes=vec![0xff;100_000];fs::write(&path,&bytes).unwrap();
        let preview=read_anyway(&path,None).unwrap();
        assert!(preview.preview_only&&preview.force_open&&preview.unsupported.is_some());
        assert!(preview.content.contains("65536 of 100000 bytes"));
        assert!(preview.content.len()<400_000);
        assert_eq!(fs::read(&path).unwrap(),bytes);
        fs::write(&path,"plain UTF-8 text").unwrap();
        assert!(entry_document(&path,None).unwrap().unsupported.is_some());
        let text=read_anyway(&path,None).unwrap();
        assert!(!text.preview_only);assert!(text.unsupported.is_none());
        assert_eq!(text.content,"plain UTF-8 text");
    }
}
