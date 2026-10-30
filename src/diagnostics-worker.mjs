import { analyze } from './diagnostics-engine.mjs';

// Serialize requests while the local WASM parsers initialize.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, language, text } = data;
    try {
      const markers = await analyze(language, text, new URL('ruff.wasm', self.location.href));
      self.postMessage({ id, markers });
    } catch (error) {
      self.postMessage({ id, error: String(error.message || error) });
    }
  });
};
