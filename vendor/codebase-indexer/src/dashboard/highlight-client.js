import hljs from 'highlight.js/lib/common';

const aliases = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', sh: 'bash', zsh: 'bash', yml: 'yaml',
  md: 'markdown', htm: 'xml', html: 'xml', xml: 'xml', svg: 'xml',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', kt: 'kotlin', kts: 'kotlin', go: 'go', java: 'java',
  php: 'php', swift: 'swift', dart: 'dart', sql: 'sql', jsonc: 'json',
  graphql: 'graphql', gql: 'graphql', css: 'css', scss: 'scss', less: 'less',
  toml: 'ini', ini: 'ini', yaml: 'yaml', dockerfile: 'dockerfile',
};

window.highlightSource = (code, language) => {
  const key = String(language || '').toLowerCase().replace(/^\./, '');
  const normalized = aliases[key] || key;
  try {
    if (normalized && hljs.getLanguage(normalized)) {
      return hljs.highlight(String(code), { language: normalized, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(String(code)).value;
  } catch {
    const node = document.createElement('span');
    node.textContent = String(code);
    return node.innerHTML;
  }
};
