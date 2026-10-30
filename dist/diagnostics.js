(function (root) {
  'use strict';
  const supported = new Set(['python', 'yaml', 'toml', 'xml', 'csharp', 'cpp', 'java']);
  const owner = 'bluegay-local';
  function install(monaco, changed = () => {}, workerFactory = () => new Worker('vendor/diagnostics/worker.js', { type: 'module' })) {
    const states = new Map(), pending = new Map();
    let worker, nextId = 0, failed = false;
    const status = () => [...states].filter(([m]) => !m.isDisposed()).map(([, s]) => s.status).filter(Boolean);
    function fail() {
      failed = true;
      worker?.terminate();
      pending.clear();
      for (const [model, state] of states) if (supported.has(model.getLanguageId())) {
        clearTimeout(state.timer); clearTimeout(state.watchdog);
        state.status = 'Local diagnostics unavailable. Reload BlueGay to retry.';
        monaco.editor.setModelMarkers(model, owner, []);
      }
      changed();
    }
    function startWorker() {
      if (worker || failed) return;
      worker = workerFactory();
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        pending.delete(data.id);
        if (!job) return;
        const { model, state, version, language, generation } = job;
        if (model.isDisposed() || states.get(model) !== state || state.generation !== generation || model.getVersionId() !== version || model.getLanguageId() !== language) return;
        clearTimeout(state.watchdog);
        state.status = data.error ? `Could not check ${language}. Edit the file to retry.` : '';
        monaco.editor.setModelMarkers(model, owner, (data.markers || []).map(m => ({ ...m, ...model.validateRange(m) })));
        changed();
      };
    }
    function schedule(model) {
      const state = states.get(model);
      clearTimeout(state.timer);
      clearTimeout(state.watchdog);
      state.generation++;
      for (const [id, job] of pending) if (job.model === model) pending.delete(id);
      const language = model.getLanguageId();
      state.status = supported.has(language) ? failed ? 'Local diagnostics unavailable. Reload BlueGay to retry.' : 'Checking local diagnostics…' : '';
      monaco.editor.setModelMarkers(model, owner, []);
      changed();
      if (!supported.has(language) || failed) return;
      if (model.getValueLength() > 500000) {
        state.status = 'Local diagnostics paused for files larger than 500,000 characters.';
        changed(); return;
      }
      state.timer = setTimeout(() => {
        if (model.isDisposed()) return;
        try {
          startWorker();
          const id = ++nextId;
          pending.set(id, { model, state, version: model.getVersionId(), language, generation: state.generation });
          state.watchdog = setTimeout(fail, 30000);
          worker.postMessage({ id, language, text: model.getValue() });
        } catch { fail(); }
      }, 350);
    }
    function track(model) {
      if (states.has(model)) return;
      const state = { generation: 0, status: '' };
      states.set(model, state);
      state.change = model.onDidChangeContent(() => schedule(model));
      state.dispose = model.onWillDispose(() => {
        clearTimeout(state.timer); clearTimeout(state.watchdog);
        for (const [id, job] of pending) if (job.model === model) pending.delete(id);
        states.delete(model); state.change.dispose(); state.dispose.dispose(); changed();
      });
      schedule(model);
    }
    // Only workspace models are tracked; temporary formatting/diff models are excluded.
    const languageListener = monaco.editor.onDidChangeModelLanguage(({ model }) => { if (states.has(model)) schedule(model); });
    return { track, status, dispose() {
      languageListener.dispose(); worker?.terminate(); pending.clear();
      for (const [model, s] of states) { clearTimeout(s.timer); clearTimeout(s.watchdog); s.change.dispose(); s.dispose.dispose(); monaco.editor.setModelMarkers(model, owner, []); }
      states.clear();
    } };
  }
  root.BlueGayDiagnostics = { install };
})(typeof module === 'object' && module.exports ? module.exports : window);
