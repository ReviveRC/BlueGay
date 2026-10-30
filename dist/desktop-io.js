/* Transport and save coordination, independent of Monaco and the DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.BlueGayDisk = factory(root.__TAURI__?.core?.invoke);
})(typeof window === 'object' ? window : globalThis, function createDisk(invoke) {
  const queues = new Map();
  const available = typeof invoke === 'function';
  let transport = null;
  const call = (command, args = {}) => {
    if (!available) return Promise.reject({ code: 'unavailable', message: 'Native disk access requires the desktop app.' });
    return transport ? transport(command, args, invoke) : invoke(command, args);
  };
  function dirty(file) { return !file.unsupported && (!!file.isDraft || file.content !== file.saved); }
  function attach(file, document, savedContent = document.content) {
    file.disk = { path: document.absolutePath, version: document.version };
    file.saved = savedContent;
    file.isDraft = false;
    file.diskConflict = null;
    file.saveError = null;
    file.unsupported = document.unsupported || null;
    file.forceOpen = !!document.forceOpen;
    file.previewOnly = !!document.previewOnly;
  }
  function save(file, { saveAs = false, automatic = false } = {}) {
    // Queue by identity and read the text when the queued task actually starts.
    // A successful older write never marks newer keystrokes as saved.
    const key = file.id;
    const previous = queues.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      if (file.unsupported || file.deleted) return false;
      if (automatic && (!file.disk || file.diskConflict || file.saveError)) return false;
      if (!saveAs && file.diskConflict) throw { code: 'conflict', message: 'Review the external file changes before saving.' };
      if (!saveAs && file.disk && !dirty(file)) return true;
      const text = file.content;
      const oldSaved = file.saved;
      file.saving = true;
      try {
        const document = !file.disk || saveAs
          ? await call('save_document_as', { suggestedName: file.path.split('/').pop(), content: text, ...(file.forceOpen?{forceOpen:true}:{}) })
          : await call('save_document', { path: file.disk.path, content: text, expectedVersion: file.disk.version, ...(file.forceOpen?{forceOpen:true}:{}) });
        if (!document) return false; // Native picker was cancelled.
        if (oldSaved !== text && typeof oldSaved === 'string') {
          file.history ||= [];
          file.history.unshift({ at: Date.now(), content: oldSaved });
          file.history = file.history.slice(0, 20);
        }
        attach(file, document, text);
        return true;
      } catch (error) {
        file.saveError = typeof error === 'object' ? error : { code: 'io', message: String(error) };
        if (file.saveError.code === 'conflict') file.diskConflict = file.saveError;
        throw file.saveError;
      } finally { file.saving = false; }
    });
    queues.set(key, operation);
    operation.then(() => { if (queues.get(key) === operation) queues.delete(key); }, () => { if (queues.get(key) === operation) queues.delete(key); });
    return operation;
  }
  async function inspect(file) {
    if (!file.disk || file.disk.version === null && file.isDraft || file.saving || queues.has(file.id)) return { kind: 'unchanged' };
    const path = file.disk.path;
    const version = file.disk.version;
    try {
      const document = await call('read_document', { path, ...(file.forceOpen?{forceOpen:true}:{}) });
      if (file.saving || queues.has(file.id) || file.disk.path !== path || file.disk.version !== version) return { kind: 'unchanged' };
      if (document.version === version) return { kind: 'unchanged' };
      return { kind: dirty(file) ? 'conflict' : 'reload', document };
    } catch (error) {
      if (file.saving || queues.has(file.id) || file.disk.path !== path || file.disk.version !== version) return { kind: 'unchanged' };
      if (error?.code === 'missing' && !dirty(file)) return { kind: 'removed', error };
      return { kind: 'error', error: typeof error === 'object' ? error : { code: 'io', message: String(error) } };
    }
  }
  async function settled() { await Promise.allSettled([...queues.values()]); }
  return { available, call, dirty, attach, save, inspect, settled, setTransport(value) { transport = value; } };
});
