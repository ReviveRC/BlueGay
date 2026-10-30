(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlueGayHtml = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const tags = (`a abbr address area article aside audio b base bdi bdo blockquote body br
    button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt
    em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html
    i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript
    object ol optgroup option output p picture pre progress q rp rt ruby s samp script search
    section select slot small source span strong style sub summary sup table tbody td template
    textarea tfoot th thead time title tr track u ul var video wbr`).split(/\s+/);
  const voidTags = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
  const rawTags = new Set('script style textarea title xmp iframe noembed noframes plaintext'.split(' '));
  const documentSnippet = '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>Document</title>\n</head>\n<body>\n\t$0\n</body>\n</html>';
  const special = {
    a: '<a href="$1">$0</a>',
    img: '<img src="$1" alt="$2">$0',
    script: '<script src="$1">$0</script>',
    input: '<input type="${1:text}" name="$2" id="$3">$0',
    label: '<label for="$1">$0</label>',
    form: '<form action="$1" method="${2:post}">$0</form>',
    link: '<link rel="${1:stylesheet}" href="$2">$0',
    meta: '<meta name="$1" content="$2">$0',
    area: '<area shape="${1:rect}" coords="$2" href="$3" alt="$4">$0',
    base: '<base href="$1">$0',
    embed: '<embed src="$1" type="$2">$0',
    source: '<source src="$1" type="$2">$0',
    track: '<track src="$1" kind="${2:subtitles}" srclang="${3:en}" label="$4">$0',
    html: documentSnippet,
    'html:5': documentSnippet,
    '!': documentSnippet
  };
  const snippets = new Map(tags.map(tag => [tag, special[tag] || (voidTags.has(tag) ? `<${tag}>$0` : `<${tag}>$0</${tag}>`)]));
  snippets.set('!', documentSnippet);
  snippets.set('html:5', documentSnippet);
  snippets.set('lorem', 'Lorem ipsum dolor sit amet, consectetur adipisicing elit. Quas, expedita! Doloremque, quaerat atque. Voluptates voluptatibus, doloremque cupiditate incidunt voluptatem, aperiam temporibus doloribus fugiat provident, commodi perspiciatis necessitatibus. Quisquam, molestiae accusantium.$0');

  // Scan HTML boundaries, respecting quoted attributes and raw-text elements.
  // This deliberately leaves Monaco's existing <tag / attribute completions alone.
  function isTextContext(text) {
    let index = 0;
    let rawTag = null;
    while (index < text.length) {
      if (rawTag) {
        if (rawTag === 'plaintext') return false;
        const closing = new RegExp('</' + rawTag + '(?=[\\s/>])', 'ig');
        closing.lastIndex = index;
        const match = closing.exec(text);
        if (!match) return false;
        index = match.index;
        rawTag = null;
      }
      const start = text.indexOf('<', index);
      if (start < 0) return true;
      if (text.startsWith('<!--', start)) {
        const end = text.indexOf('-->', start + 4);
        if (end < 0) return false;
        index = end + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', start)) {
        const end = text.indexOf(']]>', start + 9);
        if (end < 0) return false;
        index = end + 3;
        continue;
      }
      if (!/[a-z/!?]/i.test(text[start + 1] || '')) { index = start + 1; continue; }
      let quote = null;
      let end = start + 1;
      for (; end < text.length; end++) {
        const ch = text[end];
        if (quote) { if (ch === quote) quote = null; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      if (end === text.length) return false;
      const opening = /^<([a-z][\w:-]*)\b/i.exec(text.slice(start, end + 1));
      if (opening && rawTags.has(opening[1].toLowerCase())) rawTag = opening[1].toLowerCase();
      index = end + 1;
    }
    return rawTag === null;
  }

  function abbreviationAt(text, offset) {
    const before = text.slice(0, offset);
    const match = /(?:^|[\s>])([a-z][\w-]*(?::5)?|!)$/i.exec(before);
    if (!match) return null;
    const typed = match[1];
    const start = offset - typed.length;
    if (!isTextContext(text.slice(0, start))) return null;
    const suffix = /^[\w:-]*/.exec(text.slice(offset))[0];
    return { prefix: typed.toLowerCase(), start, end: offset + suffix.length };
  }

  function placeholderAt(text, offset) {
    // Find a real img tag, then walk its attributes so alt/data-src and quoted
    // strings containing fake markup cannot accidentally trigger an expansion.
    const tags = [...text.slice(0, offset).matchAll(/<img(?=[\s/>])/ig)];
    for (const match of tags.reverse()) {
      if (!isTextContext(text.slice(0, match.index))) continue;
      let index = match.index + match[0].length;
      while (index < text.length) {
        const attribute = /^\s+([^\s=/>]+)(\s*=\s*)?/.exec(text.slice(index));
        if (!attribute) break;
        index += attribute[0].length;
        if (!attribute[2]) continue;
        const quote = ['"', "'"].includes(text[index]) ? text[index++] : null;
        const start = index;
        while (index < text.length && (quote ? text[index] !== quote : !/[\s>]/.test(text[index]))) index++;
        const end = index;
        if (attribute[1].toLowerCase() === 'src' && offset > start && offset <= end) {
          const prefix = text.slice(start, offset).toLowerCase();
          const value = text.slice(start, end);
          if (!/^placeholder(?:\d+x\d+)?$/i.test(value) && !'placeholder'.startsWith(value.toLowerCase())) return null;
          if (!prefix || (!'placeholder'.startsWith(prefix) && !/^placeholder(?:\d+x\d+)?$/.test(prefix))) return null;
          const dimensions = /^placeholder(\d+x\d+)$/i.exec(value)?.[1] || '';
          return {prefix, start, end, label: 'placeholder'+dimensions, insertText: 'https://placehold.co/'+dimensions+'$0'};
        }
        if (quote) index++;
      }
      return null;
    }
    return null;
  }

  function sourceAt(text, offset) {
    const openings = [...text.slice(0, offset).matchAll(/<[a-z][\w:-]*(?=[\s/>])/ig)];
    for (const match of openings.reverse()) {
      if (!isTextContext(text.slice(0, match.index))) continue;
      let index = match.index + match[0].length;
      while (index < text.length) {
        const attribute = /^\s+([^\s=/>]+)(\s*=\s*)?/.exec(text.slice(index));
        if (!attribute) break;
        index += attribute[0].length;
        if (!attribute[2]) continue;
        const quote = ['"', "'"].includes(text[index]) ? text[index++] : null;
        const start = index;
        while (index < text.length && (quote ? text[index] !== quote : !/[\s>]/.test(text[index]))) index++;
        if (attribute[1].toLowerCase() === 'src' && offset >= start && offset <= index) {
          const prefix = text.slice(start, offset);
          if (/^[a-z][\w+.-]*:|^\/\/|[?#\\]/i.test(prefix)) return null;
          return {prefix, start, end:index};
        }
        if (quote) index++;
      }
      return null;
    }
    return null;
  }

  function pathSuggestions(context, currentPath, paths) {
    const slash = context.prefix.lastIndexOf('/');
    const typedFolder = context.prefix.slice(0, slash + 1);
    const partial = context.prefix.slice(slash + 1).toLowerCase();
    const parts = context.prefix.startsWith('/') ? [] : currentPath.replace(/^\//, '').split('/').slice(0, -1);
    for (const part of typedFolder.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) return []; parts.pop(); }
      else parts.push(part);
    }
    const folder = parts.length ? parts.join('/') + '/' : '';
    const entries = new Map();
    for (const path of paths) {
      if (!path.startsWith(folder)) continue;
      const rest = path.slice(folder.length), segment = rest.split('/')[0];
      if (!segment || !segment.toLowerCase().startsWith(partial)) continue;
      const directory = rest.includes('/');
      const label = segment + (directory ? '/' : '');
      entries.set(label, {label, directory, insertText:typedFolder + label});
    }
    return [...entries.values()].sort((a,b)=>Number(b.directory)-Number(a.directory)||a.label.localeCompare(b.label));
  }

  function register(monaco, workspace = () => ({paths:[]})) {
    return monaco.languages.registerCompletionItemProvider('html', {
      triggerCharacters: ['!', ':', 'p', '/', '"', "'", '.'],
      provideCompletionItems(model, position) {
        const text = model.getValue(), offset = model.getOffsetAt(position);
        const placeholder = placeholderAt(text, offset);
        const source = sourceAt(text, offset);
        if (source && !placeholder) {
          const start = model.getPositionAt(source.start), end = model.getPositionAt(source.end);
          const {paths = [], currentPath = model.uri?.path || ''} = workspace(model);
          return {incomplete:true, suggestions:pathSuggestions(source,currentPath,paths).map(item=>({
            label:item.label, insertText:item.insertText, filterText:item.insertText,
            kind:item.directory ? monaco.languages.CompletionItemKind.Folder : monaco.languages.CompletionItemKind.File,
            detail:item.directory ? 'Project folder' : 'Project file', sortText:'0'+item.label,
            range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column},
            ...(item.directory ? {command:{id:'editor.action.triggerSuggest',title:'Suggest folder contents'}} : {})
          }))};
        }
        const context = placeholder || abbreviationAt(text, offset);
        if (!context) return { suggestions: [] };
        const start = model.getPositionAt(context.start);
        const end = model.getPositionAt(context.end);
        const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
        return {
          incomplete: true,
          suggestions: (placeholder ? [[placeholder.label, placeholder.insertText]] : [...snippets].filter(([label]) => label.startsWith(context.prefix))).map(([label, insertText]) => ({
            label,
            detail: placeholder ? 'Placeholder image URL · Enter to expand' : label === 'lorem' ? 'Placeholder paragraph · Enter to expand' : label === 'html' || label === 'html:5' || label === '!' ? 'HTML document · Enter to expand' : `HTML <${label}> · Enter to expand`,
            documentation: 'Expand with Enter or Tab. Tab moves through editable attributes.',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            insertText,
            filterText: label,
            sortText: (label === context.prefix ? '0' : '1') + label,
            preselect: label === context.prefix,
            range
          }))
        };
      }
    });
  }
  return { snippets, isTextContext, abbreviationAt, placeholderAt, sourceAt, pathSuggestions, register };
});
