const { test } = require('node:test');
const assert = require('node:assert/strict');
const html = require('../dist/html-completions.js');

test('script abbreviation includes an editable src attribute',()=>{
  assert.equal(html.snippets.get('script'),'<script src="$1">$0</script>');
});

test('src completion lists direct children relative to the current HTML file',()=>{
  const paths=['pages/images/cat.png','pages/images/dog.gif','pages/images/icons/star.svg','pages/script.js','root.js','empty/'];
  const suggestions=prefix=>html.pathSuggestions({prefix},'pages/index.html',paths).map(p=>p.insertText);
  assert.deepEqual(suggestions('images/'),['images/icons/','images/cat.png','images/dog.gif']);
  assert.deepEqual(suggestions('images/do'),['images/dog.gif']);
  assert.deepEqual(suggestions('./images/ca'),['./images/cat.png']);
  assert.deepEqual(suggestions('../ro'),['../root.js']);
  assert.deepEqual(suggestions('/em'),['/empty/']);
  assert.deepEqual(suggestions('../../'),[]);
});

test('src contexts support all source tags and exclude fake markup and URLs',()=>{
  for(const tag of ['img','script','iframe','video','audio','source'])for(const quote of ['"',"'",'']){
    const text=`<${tag} title="a > b" src=${quote}images/ca${quote}>`;
    const offset=text.indexOf('images/ca')+9;
    assert.equal(html.sourceAt(text,offset).prefix,'images/ca');
  }
  for(const text of ['<img src="https://example.com/a','<img src="//cdn/a','<img data-src="images/','<!-- <img src="images/','<script>let a = \'<img src="images/','<div title=\'<img src="images/'])assert.equal(html.sourceAt(text,text.length),null,text);
});

test('source suggestions preserve quotes and replace the entire attribute value',()=>{
  let provider;
  html.register({languages:{CompletionItemKind:{File:1,Folder:2},registerCompletionItemProvider(_,p){provider=p;}}},()=>({currentPath:'index.html',paths:['images/cat.png']}));
  const text='<img src="images/cat-old.png" alt="keep">',offset=text.indexOf('cat')+2;
  const model={getValue:()=>text,getOffsetAt:()=>offset,getPositionAt:n=>({lineNumber:1,column:n+1})};
  const [item]=provider.provideCompletionItems(model,{}).suggestions;
  assert.equal(text.slice(0,item.range.startColumn-1)+item.insertText+text.slice(item.range.endColumn-1),'<img src="images/cat.png" alt="keep">');
});

test('lorem expands a paragraph at a text boundary and places the cursor at its end',()=>{
  assert.match(html.snippets.get('lorem'),/^Lorem ipsum .+\$0$/);
  assert.equal(html.abbreviationAt('<p>lorem',8).prefix,'lorem');
  assert.equal(html.abbreviationAt('<p title="lorem',15),null);
});

test('placeholder URLs work only in an img src value and preserve surrounding markup',()=>{
  for(const value of ['placeholder','placeholder600x400','placeholder1200x800']){
    for(const quote of ['"',"'",'']){
      const text=`<IMG alt="a > b" SRC = ${quote}${value}${quote}>`;
      const offset=text.indexOf(value)+value.length;
      const result=html.placeholderAt(text,offset);
      assert.equal(result.insertText,'https://placehold.co/'+value.slice(11)+'$0');
      assert.equal(text.slice(result.start,result.end),value);
    }
  }
  for(const text of ['<a src="placeholder','<img alt="placeholder','<img data-src="placeholder','<!-- <img src="placeholder','<script>const a = \'<img src="placeholder','<textarea><img src="placeholder','<div title=\'<img src="placeholder','<img src="path/placeholder','<img src="placeholder600x','<img src="placeholder600x400bad']){
    assert.equal(html.placeholderAt(text,text.length),null,text);
  }
});

test('placeholder completion is a snippet with Enter selection and an attribute-only replacement range',()=>{
  let provider;html.register({languages:{CompletionItemKind:{Snippet:27},CompletionItemInsertTextRule:{InsertAsSnippet:4},registerCompletionItemProvider(_,p){provider=p;}}});
  const text='<img src="placeholder" alt="keep">',offset=text.indexOf('" alt');
  const model={getValue:()=>text,getOffsetAt:()=>offset,getPositionAt:n=>({lineNumber:1,column:n+1})};
  const [item]=provider.provideCompletionItems(model,{}).suggestions;
  assert.equal(item.insertText,'https://placehold.co/$0');assert.equal(item.preselect,true);assert.equal(item.insertTextRules,4);
  assert.equal(item.range.startColumn,11);assert.equal(item.range.endColumn,22);
  const expanded=text.slice(0,item.range.startColumn-1)+item.insertText.replace('$0','')+text.slice(item.range.endColumn-1);
  assert.equal(expanded,'<img src="https://placehold.co/" alt="keep">');
});

test('paired HTML tags place the final cursor inside and void tags never get a closing tag', () => {
  for (const tag of ['p', 'div', 'span', 'section', 'h1', 'h6', 'table', 'tr', 'td', 'ul', 'li', 'button', 'dialog', 'template']) {
    assert.equal(html.snippets.get(tag), `<${tag}>$0</${tag}>`);
  }
  for (const tag of ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']) {
    assert.ok(html.snippets.has(tag));
    assert.ok(!html.snippets.get(tag).includes(`</${tag}>`));
  }
  assert.match(html.snippets.get('img'), /src="\$1" alt="\$2"/);
  assert.match(html.snippets.get('a'), /href="\$1">\$0<\/a>/);
});

test('document abbreviations include the HTML base and put the cursor in body', () => {
  for (const abbreviation of ['html', 'html:5', '!']) {
    const snippet = html.snippets.get(abbreviation);
    assert.ok(snippet.startsWith('<!DOCTYPE html>\n<html lang="en">'));
    assert.ok(snippet.includes('<meta charset="UTF-8">'));
    assert.ok(snippet.includes('name="viewport"'));
    assert.ok(snippet.includes('<title>Document</title>'));
    assert.ok(snippet.includes('<body>\n\t$0\n</body>'));
  }
});

test('abbreviation replacement leaves surrounding markup intact and replaces a whole token', () => {
  assert.deepEqual(html.abbreviationAt('<main>\n  p\n</main>', 10), { prefix: 'p', start: 9, end: 10 });
  assert.deepEqual(html.abbreviationAt('section', 3), { prefix: 'sec', start: 0, end: 7 });
  assert.deepEqual(html.abbreviationAt('html:5', 6), { prefix: 'html:5', start: 0, end: 6 });
  assert.deepEqual(html.abbreviationAt('!', 1), { prefix: '!', start: 0, end: 1 });
  assert.equal(html.abbreviationAt('<p', 2), null);
  assert.equal(html.abbreviationAt('</p', 3), null);
  assert.equal(html.abbreviationAt('thing.p', 7), null);
});

test('no HTML abbreviation suggestions inside attributes, comments, scripts or styles', () => {
  const blocked = [
    '<div class="p', '<div title="x > y" p', '<!-- p', '<![CDATA[ p',
    '<script>\nconst value = p', '<script>if (a < b) p',
    '<style>\np', '<textarea>p', '<title>p', '<SCRIPT type="module">p'
  ];
  for (const text of blocked) assert.equal(html.abbreviationAt(text, text.length), null, text);
  for (const prefix of ['<!-- done -->', '<div title="a > b">', '<script>const x = "<";</script>', '<STYLE>p{}</STYLE>', '<textarea>x</textarea>']) {
    const text = prefix + '\n  p';
    assert.equal(html.abbreviationAt(text, text.length)?.prefix, 'p', text);
  }
});

test('Monaco provider prioritizes an exact tag and uses snippet replacement ranges', () => {
  let provider;
  html.register({ languages: {
    CompletionItemKind: { Snippet: 27 }, CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    registerCompletionItemProvider(language, value) { assert.equal(language, 'html'); provider = value; }
  } });
  const model = { getValue: () => 'p', getOffsetAt: () => 1, getPositionAt: offset => ({ lineNumber: 1, column: offset + 1 }) };
  const result = provider.provideCompletionItems(model, { lineNumber: 1, column: 2 });
  const exact = result.suggestions.find(item => item.label === 'p');
  assert.equal(exact.preselect, true);
  assert.equal(exact.insertText, '<p>$0</p>');
  assert.equal(exact.insertTextRules, 4);
  assert.equal(exact.sortText, '0p');
  assert.deepEqual(exact.range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 });
  assert.ok(result.suggestions.some(item => item.label === 'picture'));
  assert.ok(result.suggestions.every(item => item.label.startsWith('p')));
  assert.equal(result.incomplete, true);
});
