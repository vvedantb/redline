const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const JS_KEYWORDS = 'import|export|from|default|const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|async|await|try|catch|finally|throw|typeof|instanceof|in|of|type|interface|enum|as|null|undefined|true|false|this|void';

const COMMENT = String.raw`\/\/.*|\/\*.*?(?:\*\/|$)|^\s*\*.*`;
const STRING = String.raw`"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|` + '`(?:[^`\\\\]|\\\\.)*`?';
const NUMBER = String.raw`\b\d[\d_.]*\b`;

type Rule = [kind: string, pattern: string];

const LANGS: Record<string, Rule[]> = {
  js: [['c', COMMENT], ['s', STRING], ['t', String.raw`<\/?[A-Za-z][\w.]*`], ['k', String.raw`\b(?:${JS_KEYWORDS})\b`], ['n', NUMBER]],
  css: [['c', String.raw`\/\*.*?(?:\*\/|$)`], ['s', STRING], ['k', String.raw`@[\w-]+`], ['t', String.raw`[\w-]+(?=\s*:)`], ['n', String.raw`#[0-9a-fA-F]{3,8}\b|\b\d[\d.]*(?:px|rem|em|%|vh|vw|s|ms)?\b`]],
  json: [['t', String.raw`"(?:[^"\\]|\\.)*"(?=\s*:)`], ['s', STRING], ['k', String.raw`\b(?:true|false|null)\b`], ['n', String.raw`-?\b\d[\d.eE+-]*\b`]],
  html: [['c', String.raw`<!--.*?(?:-->|$)`], ['t', String.raw`<\/?[A-Za-z][\w-]*|\/?>`], ['s', STRING]],
  md: [['t', String.raw`^#{1,6}\s.*`], ['c', String.raw`^\s*>.*`], ['s', String.raw`\x60[^\x60]*\x60`], ['k', String.raw`^\s*(?:[-*+]|\d+\.)\s`]],
};

const BY_EXT: Record<string, string> = {
  js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js', mts: 'js', cts: 'js',
  css: 'css', scss: 'css', less: 'css', json: 'json', html: 'html', htm: 'html', md: 'md', mdx: 'md',
};

const compiled = new Map<string, { re: RegExp; kinds: string[] }>();

function matcher(lang: string) {
  let m = compiled.get(lang);
  if (!m) {
    const rules = LANGS[lang];
    m = { re: new RegExp(rules.map(([, p]) => `(${p})`).join('|'), 'g'), kinds: rules.map(([k]) => k) };
    compiled.set(lang, m);
  }
  return m;
}

export function languageOf(file: string): string | null {
  return BY_EXT[file.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** HTML for one line of source with `<span class="tk-*">` tokens. Lines are tokenised on their own. */
export function highlightLine(line: string, lang: string | null): string {
  if (!lang) return esc(line);
  const { re, kinds } = matcher(lang);
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const kind = kinds[m.findIndex((g, i) => i > 0 && g !== undefined) - 1];
    out += esc(line.slice(last, m.index)) + `<span class="tk-${kind}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(line.slice(last));
}
