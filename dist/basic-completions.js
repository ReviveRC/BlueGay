/* Offline keywords for languages whose Monaco bundle only supplies coloring. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.BlueGayBasicCompletions=factory();
})(typeof window==='object'?window:globalThis,function(){
  const keywords={
    java:'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public record return sealed short static strictfp super switch synchronized this throw throws transient try var void volatile while yield String System Object Override',
    python:'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
    rust:'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    go:'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    cpp:'auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new nullptr private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while',
    c:'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
    csharp:'abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield',
    ruby:'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
    shell:'if then else elif fi for while do done case esac function in select until',
    php:'abstract array as break callable case catch class clone const continue declare default do echo else elseif empty endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include instanceof interface isset list match namespace new null parent print private protected public readonly require return self static switch throw trait try unset use var while yield',
    sql:'SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP JOIN LEFT RIGHT INNER OUTER ON AS GROUP BY ORDER HAVING LIMIT DISTINCT UNION ALL AND OR NOT NULL IS IN EXISTS BETWEEN LIKE ASC DESC'
  };
  function install(monaco){return Object.entries(keywords).map(([id,list])=>monaco.languages.registerCompletionItemProvider(id,{provideCompletionItems(model,position){
    const word=model.getWordUntilPosition(position),range={startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn};
    return {suggestions:list.split(' ').map(label=>({label,insertText:label,kind:monaco.languages.CompletionItemKind.Keyword,range}))};
  }}));}
  return {keywords,install};
});
