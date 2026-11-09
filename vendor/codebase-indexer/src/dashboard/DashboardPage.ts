import type { IconNode } from 'lucide';
import type { SimpleIcon } from 'simple-icons';
import { siC, siCplusplus, siDart, siGo, siGraphql, siHtml5, siJavascript, siJson, siKotlin, siLua, siMarkdown, siPhp, siPython, siRuby, siRust, siScala, siShell, siSwift, siTypescript } from 'simple-icons';
import {
  ArrowLeftRight, BookOpen, BrainCircuit, Braces, ChartNoAxesCombined, Code2,
  Database, ExternalLink, FileCode, FileJson, FileSpreadsheet, Files, Folder, FolderOpen, FolderTree, GitBranch, GitPullRequest, Gauge, HeartPulse,
  House, Layers, Network, RefreshCw, Search, Settings, ShieldCheck, SunMoon,
  TestTube, Workflow, X,
} from 'lucide';

const iconSvg = (node: IconNode, size = 16): string => {
  const children = node.map(([tag, attrs]) => {
    const attributes = Object.entries(attrs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ` ${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
      .join('');
    return `<${tag}${attributes} />`;
  }).join('');
  return `<svg class="lucide-icon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
};

const languageIcons: Record<string, SimpleIcon> = {
  c: siC, cpp: siCplusplus, 'c++': siCplusplus, dart: siDart, go: siGo, golang: siGo,
  graphql: siGraphql, html: siHtml5, javascript: siJavascript, js: siJavascript,
  json: siJson, kotlin: siKotlin, lua: siLua, markdown: siMarkdown, md: siMarkdown,
  php: siPhp, python: siPython, py: siPython, ruby: siRuby, rb: siRuby, rust: siRust,
  rs: siRust, scala: siScala, shell: siShell, bash: siShell, sh: siShell,
  swift: siSwift, typescript: siTypescript, ts: siTypescript,
};

const languageIconData = Object.fromEntries(
  Object.entries(languageIcons).map(([name, icon]) => [name, { hex: icon.hex, path: icon.path, title: icon.title }]),
);



export const DASHBOARD_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codebase Index Dashboard · Workspace Intelligence</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;600&display=swap');
    :root,[data-theme="dark"]{color-scheme:dark;--md-primary:#d0bcff;--md-on-primary:#381e72;--md-primary-container:#4f378b;--md-on-primary-container:#eaddff;--md-secondary:#ccc2dc;--md-on-secondary:#332d41;--md-secondary-container:#4a4458;--md-on-secondary-container:#e8def8;--md-tertiary:#efb8c8;--md-on-tertiary:#492532;--md-tertiary-container:#633b48;--md-on-tertiary-container:#ffd9e3;--md-error:#ffb4ab;--md-on-error:#690005;--md-error-container:#93000a;--md-on-error-container:#ffdad6;--md-success:#a8d5b5;--md-warning:#e8c879;--md-outline:#938f9a;--md-outline-variant:#49454f;--md-surface:#141218;--md-surface-dim:#141218;--md-surface-bright:#3b383e;--md-surface-container-lowest:#0f0d13;--md-surface-container-low:#1d1b20;--md-surface-container:#211f26;--md-surface-container-high:#2b2930;--md-surface-container-highest:#36343b;--md-on-surface:#e6e0e9;--md-on-surface-variant:#cac4d0;--md-inverse-surface:#e6e0e9;--md-inverse-on-surface:#322f35;--md-inverse-primary:#6750a4;--bg:var(--md-surface-dim);--surface:var(--md-surface-container-low);--surface-elevated:var(--md-surface-container);--surface-hover:var(--md-surface-container-high);--surface-active:var(--md-surface-container-highest);--border:var(--md-outline-variant);--border-strong:var(--md-outline);--text-main:var(--md-on-surface);--text-muted:var(--md-on-surface-variant);--text-subtle:var(--md-on-surface-variant);--text-disabled:color-mix(in srgb,var(--md-on-surface) 38%,transparent);--accent:var(--md-primary);--accent-strong:var(--md-on-primary-container);--accent-soft:var(--md-primary-container);--green:var(--md-success);--amber:var(--md-warning);--red:var(--md-error);--mono:'Roboto Mono',ui-monospace,monospace;--sans:'Roboto',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--shape-xs:4px;--shape-sm:8px;--shape-md:12px;--shape-lg:16px;--shape-xl:28px;--shape-full:999px;--shadow:0 2px 6px rgba(0,0,0,.24),0 1px 2px rgba(0,0,0,.16);--motion-fast:150ms;--motion-standard:250ms;--motion-emphasized:cubic-bezier(.2,0,0,1)}
    [data-theme="light"]{color-scheme:light;--md-primary:#6750a4;--md-on-primary:#fff;--md-primary-container:#eaddff;--md-on-primary-container:#21005d;--md-secondary:#625b71;--md-on-secondary:#fff;--md-secondary-container:#e8def8;--md-on-secondary-container:#1d192b;--md-tertiary:#7e5260;--md-on-tertiary:#fff;--md-tertiary-container:#ffd9e3;--md-on-tertiary-container:#31101d;--md-error:#ba1a1a;--md-on-error:#fff;--md-error-container:#ffdad6;--md-on-error-container:#410002;--md-success:#28633f;--md-warning:#765b00;--md-outline:#79747e;--md-outline-variant:#cac4d0;--md-surface:#fdf7ff;--md-surface-dim:#ded8e1;--md-surface-bright:#fdf7ff;--md-surface-container-lowest:#fff;--md-surface-container-low:#f7f2fa;--md-surface-container:#f3edf7;--md-surface-container-high:#ece6f0;--md-surface-container-highest:#e6e0e9;--md-on-surface:#1d1b20;--md-on-surface-variant:#49454f;--md-inverse-surface:#322f35;--md-inverse-on-surface:#f5eff7;--md-inverse-primary:#d0bcff;--bg:var(--md-surface-dim);--surface:var(--md-surface-container-low);--surface-elevated:var(--md-surface-container);--surface-hover:var(--md-surface-container-high);--surface-active:var(--md-surface-container-highest);--border:var(--md-outline-variant);--border-strong:var(--md-outline);--text-main:var(--md-on-surface);--text-muted:var(--md-on-surface-variant);--text-subtle:var(--md-on-surface-variant);--text-disabled:color-mix(in srgb,var(--md-on-surface) 38%,transparent);--accent:var(--md-primary);--accent-strong:var(--md-on-primary-container);--accent-soft:var(--md-primary-container);--green:var(--md-success);--amber:var(--md-warning);--red:var(--md-error);--shadow:0 1px 3px rgba(29,27,32,.12),0 1px 2px rgba(29,27,32,.08)}
    *{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--text-main);font-family:var(--sans);font-size:13px;line-height:1.5}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}a{color:inherit;text-decoration:none}
    .ide-shell{display:grid;grid-template-rows:64px 1fr;width:100vw;height:100vh;overflow:hidden;background:var(--bg)}
    .top-bar{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:0 26px;background:color-mix(in srgb,var(--surface) 92%,transparent);border-bottom:1px solid var(--border);backdrop-filter:blur(18px);z-index:5}
    .brand-group{display:flex;align-items:center;gap:12px;min-width:230px;font-weight:700;font-size:14px;letter-spacing:-.02em}.brand-icon{width:34px;height:34px;background:var(--md-primary-container);color:var(--md-on-primary-container);border-radius:var(--shape-lg);display:grid;place-items:center;box-shadow:var(--shadow)}.workspace-path{color:var(--text-subtle);font-family:var(--mono);font-size:10px;font-weight:400;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-left:1px solid var(--border);padding-left:12px}
    .command-search{position:relative;width:min(420px,32vw);flex:1}.command-search input{width:100%;height:38px;background:var(--surface-elevated);border:1px solid var(--border);border-radius:var(--shape-full);padding:0 56px 0 38px;font-size:12px;outline:none;transition:.18s}.command-search .search-icon{position:absolute;left:13px;top:11px;color:var(--text-subtle);pointer-events:none}.command-search .search-icon .lucide-icon{width:16px;height:16px}.command-search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.kbd-shortcut{position:absolute;right:10px;top:9px;font-family:var(--mono);font-size:9px;color:var(--text-subtle);border:1px solid var(--border-strong);border-radius:5px;padding:2px 6px}
    .index-picker{display:flex;align-items:center;gap:8px;min-width:170px;max-width:260px}.index-picker-label{color:var(--text-disabled);font-family:var(--mono);font-size:9px;letter-spacing:.1em}.index-picker select{width:100%;min-width:0;height:36px;background:var(--surface-elevated);border:1px solid var(--border);border-radius:var(--shape-sm);padding:0 10px;outline:none;font-size:11px}.index-picker select:focus{border-color:var(--accent)}.top-actions{display:flex;align-items:center;gap:12px;font-size:11px;white-space:nowrap}.top-actions>span:nth-of-type(1){color:var(--text-subtle);display:flex;align-items:center;gap:7px}.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(81,214,160,.10)}.btn-top{background:var(--surface-elevated);border:1px solid var(--border);padding:8px 13px;border-radius:var(--shape-full);cursor:pointer;font-size:11px;font-weight:600;transition:.18s}.btn-top:hover{background:var(--surface-hover);border-color:var(--border-strong);transform:translateY(-1px)}.btn-top .lucide-icon{display:inline-block;vertical-align:-3px;margin-right:5px}#btn-reindex{background:var(--accent);border-color:var(--accent);color:#10152c}#btn-reindex:hover{background:var(--accent-strong)}
    .main-body{display:grid;grid-template-columns:248px minmax(0,1fr);height:calc(100vh - 64px);overflow:hidden}.sidebar{background:var(--surface);border-right:1px solid var(--border);overflow-y:auto;padding:20px 13px 18px;display:flex;flex-direction:column;gap:22px}.nav-section{display:flex;flex-direction:column;gap:3px}.nav-section-title{padding:0 12px 8px;font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.14em;color:var(--text-disabled);font-weight:600}.nav-item{display:flex;align-items:center;gap:11px;padding:9px 12px;color:var(--text-subtle);font-size:12px;font-weight:500;cursor:pointer;border:1px solid transparent;border-radius:var(--shape-full);transition:background .16s,color .16s,border-color .16s}.nav-item:hover{background:var(--surface-hover);color:var(--text-main)}.nav-item.active{background:var(--md-secondary-container);color:var(--md-on-secondary-container);border-color:transparent;font-weight:700}.nav-icon{width:18px;height:18px;flex:0 0 18px;display:inline-grid;place-items:center;color:var(--text-subtle)}.nav-icon .lucide-icon{width:16px;height:16px;stroke-width:1.8}.nav-item.active .nav-icon{color:var(--accent-strong)}.lucide-icon{display:block;flex:0 0 auto}.content-viewport{position:relative;min-width:0;overflow-y:auto;background:transparent;padding:30px clamp(24px,3vw,48px) 48px;display:flex;flex-direction:column;gap:28px;scroll-behavior:smooth}.panel{display:none;flex-direction:column;gap:24px;max-width:1600px;width:100%;margin:0 auto;animation:panel-in .22s ease}@keyframes panel-in{from{opacity:.35;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}.panel.active{display:flex}.panel-header{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border);padding-bottom:18px}.panel-header h1{font-size:25px;font-weight:700;letter-spacing:-.045em}.panel-header p{font-size:12px;color:var(--text-subtle);margin-top:4px}.grid-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:13px}.stat-card{position:relative;background:var(--surface-elevated);border:1px solid var(--border);border-radius:var(--shape-lg);padding:17px 18px;overflow:hidden;transition:transform .18s,border-color .18s,box-shadow .18s}.stat-card:after{content:'';position:absolute;width:90px;height:90px;right:-38px;top:-42px;border-radius:50%;background:var(--accent-soft);filter:blur(2px)}.stat-card:hover{transform:translateY(-2px);border-color:var(--border-strong);box-shadow:var(--shadow)}.stat-val{position:relative;z-index:1;font-family:var(--mono);font-size:24px;font-weight:700;letter-spacing:-.05em;color:var(--text-main)}.stat-lbl{position:relative;z-index:1;font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--text-subtle);margin-top:7px;font-weight:600}
    .ide-card{min-width:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--shape-lg);padding:20px 22px;box-shadow:0 4px 18px rgba(0,0,0,.035)}.card-title{font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px}.card-title span{font-family:var(--mono);font-size:9px;color:var(--text-disabled);font-weight:500;text-transform:uppercase;letter-spacing:.08em}
    .files-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.files-toolbar #symbol-filter{min-width:220px}.files-toolbar #symbol-kind-filter{width:auto;min-width:145px}.files-count{font-size:12px;color:var(--text-muted)}.files-table-wrap{max-height:calc(100vh - 250px);overflow:auto}.file-path-cell{font-family:var(--sans);font-size:12px;color:var(--text-main);overflow-wrap:anywhere}.file-language-cell{display:inline-flex;align-items:center;gap:7px}.file-language-cell .language-icon{width:16px;height:16px}.file-inspect-btn{min-height:30px;padding:0 12px}.file-inspect-layout{display:flex;flex-direction:column;gap:14px;min-height:0}.file-meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.file-meta-item{background:var(--surface-elevated);border:1px solid var(--border);border-radius:var(--shape-md);padding:10px;min-width:0}.file-meta-item small{display:block;color:var(--text-subtle);font-size:10px;margin-bottom:5px}.file-meta-item strong{display:block;color:var(--text-main);font-size:12px;overflow-wrap:anywhere}.file-inspect-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px}.file-source .hljs-comment,.file-source .hljs-quote{color:#8b949e;font-style:italic}.file-source .hljs-keyword,.file-source .hljs-selector-tag,.file-source .hljs-literal{color:#ff7b72}.file-source .hljs-string,.file-source .hljs-regexp,.file-source .hljs-attr{color:#a5d6ff}.file-source .hljs-number,.file-source .hljs-built_in{color:#79c0ff}.file-source .hljs-title,.file-source .hljs-title.function_,.file-source .hljs-function{color:#d2a8ff}.file-source .hljs-type,.file-source .hljs-class .hljs-title{color:#ffa657}.file-source .hljs-variable,.file-source .hljs-params{color:#e6edf3}.file-source .hljs-meta,.file-source .hljs-operator{color:#7ee787}.file-source{margin:0;padding:14px;background:var(--md-surface-container-lowest);border:1px solid var(--border);border-radius:var(--shape-md);overflow:auto;max-height:52vh;color:var(--md-on-surface);font:11px/1.65 var(--mono);white-space:pre;tab-size:2}.file-terms{display:flex;flex-wrap:wrap;gap:5px}.file-term{padding:3px 7px;border-radius:var(--shape-full);background:var(--md-secondary-container);color:var(--md-on-secondary-container);font-size:10px}.file-inspect-error{padding:12px;border-radius:var(--shape-md);background:var(--md-error-container);color:var(--md-on-error-container);font-size:12px}.repo-tree{font-family:var(--sans);font-size:13px}.repo-tree-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.repo-tree-toolbar strong{font-size:14px;font-weight:600}.repo-tree-toolbar span{font-size:11px;color:var(--text-muted)}.repo-tree-list{list-style:none;margin:0;padding:0}.repo-tree-list .repo-tree-list{padding-left:22px;border-left:1px solid var(--border);margin-left:10px}.repo-tree-row{display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 8px;border-radius:var(--shape-sm);color:var(--text-main);width:100%;text-align:left;background:transparent;border:0;font-size:12px}.repo-tree-row:hover{background:var(--surface-hover)}.repo-tree-row.folder{cursor:pointer;font-weight:500}.repo-tree-row.file{cursor:pointer;color:var(--text-muted)}.repo-tree-row .lucide-icon,.repo-tree-row .language-icon{flex:none}.repo-tree-row .language-icon{filter:saturate(.88)}.repo-tree-row .repo-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.repo-tree-row .repo-tree-count{font-size:10px;color:var(--text-subtle);font-family:var(--mono)}.repo-tree-empty{padding:24px;color:var(--text-muted);text-align:center;font-size:12px}.repo-tree-error{padding:16px;color:var(--md-error);font-size:12px}
    table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}th,td{padding:13px 16px;text-align:left;border-bottom:1px solid var(--border)}th{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:.09em;color:var(--text-subtle);background:var(--surface-elevated);position:sticky;top:0;z-index:1}th:first-child{border-radius:8px 0 0 0}th:last-child{border-radius:0 8px 0 0}td{font-family:var(--mono);font-size:11px;color:var(--text-muted)}tr:hover td{background:var(--surface-hover);color:var(--text-main)}.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:var(--shape-xs);background:var(--md-tertiary-container);border:1px solid transparent;font-family:var(--mono);font-size:9px;color:var(--accent-strong)}
    .drawer{position:fixed;right:0;top:64px;bottom:0;width:min(460px,92vw);background:var(--surface);border-left:1px solid var(--border);z-index:10;transform:translateX(100%);transition:transform .24s ease;display:flex;flex-direction:column;padding:20px;gap:16px;box-shadow:var(--shadow)}.drawer.open{transform:translateX(0)}.drawer-header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:14px}.drawer-close{background:var(--surface-elevated);border:1px solid var(--border);border-radius:8px;width:30px;height:30px;cursor:pointer;color:var(--text-subtle);display:grid;place-items:center}.drawer-close:hover{color:var(--text-main);background:var(--surface-hover)}
    .cmd-palette-overlay{position:fixed;inset:0;background:rgba(4,7,14,.68);backdrop-filter:blur(8px);z-index:100;display:none;place-items:start center;padding-top:15vh}.cmd-palette-overlay.open{display:grid}.cmd-palette{width:min(620px,92vw);background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--shape-xl);box-shadow:var(--shadow);overflow:hidden;display:flex;flex-direction:column}.cmd-input{width:100%;height:58px;background:transparent;border:none;border-bottom:1px solid var(--border);padding:0 20px;font-size:14px;outline:none}.cmd-results{max-height:360px;overflow-y:auto;padding:8px}.cmd-item{padding:10px 12px;border-radius:var(--shape-md);display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:12px}.cmd-item:hover,.cmd-item.selected{background:var(--surface-hover);color:var(--text-main)}
    .tab-bar{display:flex;gap:5px;border-bottom:1px solid var(--border);margin-bottom:14px;overflow-x:auto}.tab-item{padding:9px 13px;border-bottom:2px solid transparent;cursor:pointer;font-size:11px;font-weight:600;color:var(--text-subtle);white-space:nowrap}.tab-item.active{border-bottom-color:var(--accent);color:var(--accent-strong)}.flex-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.input-ide{height:37px;background:var(--surface-elevated);border:1px solid var(--border);border-radius:var(--shape-sm);padding:0 12px;font-size:12px;outline:none;transition:.16s}.input-ide:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}.btn-ide{min-height:36px;background:var(--surface-elevated);border:1px solid var(--border);padding:0 13px;border-radius:var(--shape-full);cursor:pointer;font-size:11px;font-weight:600;transition:.16s}.btn-ide:hover{background:var(--surface-hover);border-color:var(--border-strong);transform:translateY(-1px)}.btn-export{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;background:var(--md-surface-container-low);color:var(--md-primary);border:1px solid var(--md-outline);border-radius:var(--shape-full);font-size:12px;font-weight:600;letter-spacing:.01em;text-decoration:none;box-shadow:none}.btn-export:hover{background:var(--md-surface-container-high);border-color:var(--md-primary);color:var(--md-primary)}.btn-export .lucide-icon{width:15px;height:15px;margin:0;flex:none}.btn-export:active{background:var(--md-secondary-container)}
    #overview-stats .stat-card:first-child{border-color:color-mix(in srgb,var(--md-success) 45%,var(--border))}#github-log{border-radius:9px!important}hr{border-color:var(--border)!important}pre,code{font-family:var(--mono)}
    ::-webkit-scrollbar{width:9px;height:9px}::-webkit-scrollbar-thumb{background:var(--border-strong);border:2px solid transparent;background-clip:padding-box;border-radius:20px}::-webkit-scrollbar-thumb:hover{background:var(--text-disabled);border:2px solid transparent;background-clip:padding-box}
    @media(max-width:1100px){.top-bar{padding:0 16px;gap:12px}.brand-group{min-width:auto}.workspace-path,.index-picker-label,.top-actions>span:nth-of-type(1){display:none}.main-body{grid-template-columns:210px minmax(0,1fr)}.content-viewport{padding:24px 20px}}
    @media(max-width:760px){.ide-shell{grid-template-rows:auto 1fr}.top-bar{min-height:60px;flex-wrap:wrap;padding:10px 13px;gap:10px}.brand-group{font-size:12px}.brand-icon{width:30px;height:30px}.command-search{order:3;width:100%;flex-basis:100%;max-width:none}.top-actions{margin-left:auto}.index-picker{display:none}.main-body{height:calc(100vh - 108px);grid-template-columns:58px minmax(0,1fr)}.sidebar{padding:12px 6px;gap:15px}.nav-section-title{font-size:0;padding:0;height:3px}.nav-item{font-size:0;justify-content:center;padding:10px 4px}.nav-icon .lucide-icon{width:18px;height:18px}.content-viewport{padding:20px 13px 32px;gap:16px}.panel-header{align-items:flex-start}.panel-header h1{font-size:21px}.grid-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.ide-card{padding:14px}.drawer{top:0}.panel-header .flex-row{justify-content:flex-end}}
    .btn-top,.btn-ide,.nav-item,.tab-item,.drawer-close{position:relative;isolation:isolate;transition-duration:var(--motion-fast);transition-timing-function:var(--motion-emphasized)}.btn-top:after,.btn-ide:after,.nav-item:after,.drawer-close:after{content:"";position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;pointer-events:none;transition:opacity var(--motion-fast)}.btn-top:hover:after,.btn-ide:hover:after,.nav-item:hover:after,.drawer-close:hover:after{opacity:.08}.btn-top:active:after,.btn-ide:active:after,.nav-item:active:after,.drawer-close:active:after{opacity:.12}button:focus-visible,a:focus-visible,.nav-item:focus-visible,.tab-item:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--md-primary);outline-offset:2px}.btn-top:disabled,.btn-ide:disabled{opacity:.38;cursor:not-allowed}.badge{color:var(--md-on-tertiary-container)}.status-dot{background:var(--md-success)}.panel-header h1{font-size:28px;line-height:1.2;letter-spacing:-.02em;font-weight:600}.panel-header p{font-size:14px;line-height:1.45}.stat-val{font-variant-numeric:tabular-nums}.stat-lbl{letter-spacing:.04em;text-transform:none;font-size:12px}.card-title{font-size:16px;font-weight:600}.nav-section-title{font-family:var(--sans);letter-spacing:.06em;font-size:11px;text-transform:none}.tab-item.active{border-bottom-width:3px}.drawer{border-radius:var(--shape-xl) 0 0 var(--shape-xl)}
    @media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}
  </style>
</head>
<body>
  <div class="ide-shell">
    <header class="top-bar">
      <div class="brand-group">
        <span class="brand-icon">${iconSvg(Code2, 19)}</span>
        <span>Codebase Indexer</span>
        <span class="workspace-path" id="top-workspace-path">Loading workspace…</span>
      </div>

      <div class="command-search" id="cmd-trigger">
        <input id="index-filter" type="text" placeholder="Filter workspaces or search (Ctrl K)" readonly>
        <span class="kbd-shortcut">Ctrl K</span>
      </div>

      <div class="top-actions">
        <label class="index-picker"><span class="index-picker-label">INDEX FILE</span><select id="index-select" aria-label="Choose index file"><option value="">Loading indexes…</option></select></label>
        <span><i class="status-dot"></i> <span id="top-status">Index up to date</span></span>
        <span class="badge" id="top-branch">main</span>
        <button class="btn-top" id="btn-reindex">${iconSvg(RefreshCw, 14)} Re-index</button>
        <button class="btn-top" id="btn-theme-toggle">${iconSvg(SunMoon, 14)} Theme</button>
      </div>
    </header>

    <div class="main-body">
      <aside class="sidebar">
        <div class="nav-section">
          <div class="nav-section-title">Overview</div>
          <div class="nav-item active" data-target="panel-overview"><span class="nav-icon">${iconSvg(House)}</span>Overview</div>
        </div>

        <div class="nav-section">
          <div class="nav-section-title">Workspace</div>
          <div class="nav-item" data-target="panel-repository"><span class="nav-icon">${iconSvg(FolderTree)}</span>Repository</div>
          <div class="nav-item" data-target="panel-files"><span class="nav-icon">${iconSvg(Files)}</span>Files</div>
          <div class="nav-item" data-target="panel-symbols"><span class="nav-icon">${iconSvg(Braces)}</span>Symbols</div>
          <div class="nav-item" data-target="panel-references"><span class="nav-icon">${iconSvg(GitPullRequest)}</span>References</div>
        </div>

        <div class="nav-section">
          <div class="nav-section-title">Graphs & Relations</div>
          <div class="nav-item" data-target="panel-callgraph"><span class="nav-icon">${iconSvg(Workflow)}</span>Call Graph</div>
          <div class="nav-item" data-target="panel-dependencies"><span class="nav-icon">${iconSvg(Network)}</span>Dependencies</div>
          <a class="nav-item" id="nav-dep-graph" href="#" target="_blank">Dependency Graph ${iconSvg(ExternalLink, 13)}</a>
          <div class="nav-item" data-target="panel-chunks"><span class="nav-icon">${iconSvg(Layers)}</span>Chunks</div>
        </div>

        <div class="nav-section">
          <div class="nav-section-title">Intelligence</div>
          <div class="nav-item" data-target="panel-search"><span class="nav-icon">${iconSvg(Search)}</span>Search</div>
          <div class="nav-item" data-target="panel-embeddings"><span class="nav-icon">${iconSvg(BrainCircuit)}</span>Embeddings</div>
          <div class="nav-item" data-target="panel-apis"><span class="nav-icon">${iconSvg(Code2)}</span>APIs</div>
          <div class="nav-item" data-target="panel-database"><span class="nav-icon">${iconSvg(Database)}</span>Database</div>
          <div class="nav-item" data-target="panel-tests"><span class="nav-icon">${iconSvg(TestTube)}</span>Tests</div>
          <div class="nav-item" data-target="panel-config"><span class="nav-icon">${iconSvg(Settings)}</span>Configuration</div>
          <div class="nav-item" data-target="panel-docs"><span class="nav-icon">${iconSvg(BookOpen)}</span>Documentation</div>
        </div>

        <div class="nav-section">
          <div class="nav-section-title">Git & History</div>
          <div class="nav-item" data-target="panel-git"><span class="nav-icon">${iconSvg(GitBranch)}</span>Git Activity</div>
          <div class="nav-item" data-target="panel-changes"><span class="nav-icon">${iconSvg(ArrowLeftRight)}</span>Changes</div>
        </div>

        <div class="nav-section">
          <div class="nav-section-title">Metrics & Security</div>
          <div class="nav-item" data-target="panel-complexity"><span class="nav-icon">${iconSvg(ChartNoAxesCombined)}</span>Complexity</div>
          <div class="nav-item" data-target="panel-duplicates"><span class="nav-icon">${iconSvg(Files)}</span>Duplicates</div>
          <div class="nav-item" data-target="panel-security"><span class="nav-icon">${iconSvg(ShieldCheck)}</span>Security</div>
        </div>

        <div class="nav-section">
          <div class="nav-section-title">System & Health</div>
          <div class="nav-item" data-target="panel-health"><span class="nav-icon">${iconSvg(HeartPulse)}</span>Index Health</div>
          <div class="nav-item" data-target="panel-inspector"><span class="nav-icon">${iconSvg(Gauge)}</span>Index Inspector</div>
          <div class="nav-item" data-target="panel-settings"><span class="nav-icon">${iconSvg(Settings)}</span>Settings</div>
        </div>
      </aside>

      <main class="content-viewport">
        <!-- 1. OVERVIEW PANEL -->
        <section class="panel active" id="panel-overview">
          <div class="panel-header">
            <div>
              <h1>Overview</h1>
              <p>Code intelligence command center</p>
            </div>
            <div class="flex-row">
              <a id="overview-export-json" class="btn-ide btn-export" href="#" download>${iconSvg(FileJson, 15)}<span>Export JSON</span></a>
              <a id="overview-export-csv" class="btn-ide btn-export" href="#" download>${iconSvg(FileSpreadsheet, 15)}<span>Export CSV</span></a>
            </div>
          </div>

          <div class="grid-stats" id="overview-stats"></div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
            <div class="ide-card">
              <div class="card-title">Repository Architecture <span>Top Areas</span></div>
              <div id="overview-areas"></div>
            </div>
            <div class="ide-card">
              <div class="card-title">Relation makeup <span>Relation Makeup</span></div>
              <div id="overview-memory" class="grid-stats"></div>
            </div>
          </div>

          <div class="ide-card">
            <div class="card-title">GitHub Importer <span>Local Repository Scan</span></div>
            <form id="github-form" class="flex-row" style="margin-top:6px;">
              <input id="github-url" class="input-ide" style="flex:1;" type="url" placeholder="https://github.com/owner/repository" required>
              <input id="github-ref" class="input-ide" style="width:120px;" type="text" placeholder="Branch">
              <input id="github-size" type="number" min="0.001" max="100" step="0.001" value="1" hidden>
              <button class="btn-ide" type="submit">Import</button>
            </form>
            <div id="github-log" style="height:80px; overflow-y:auto; font-family:var(--mono); font-size:10px; margin-top:10px; background:var(--bg); border:1px solid var(--border); padding:8px; display:none;"></div>
          </div>
        </section>

        <!-- 2. REPOSITORY PANEL -->
        <section class="panel" id="panel-repository">
          <div class="panel-header">
            <div><h1>Repository Explorer</h1><p>Directories, packages, and modules</p></div>
          </div>
          <div class="ide-card">
            <div id="repository-tree">Loading repository tree…</div>
          </div>
        </section>

        <!-- 3. FILES PANEL -->
        <section class="panel" id="panel-files">
          <div class="panel-header">
            <div><h1>Files</h1><p>Indexed workspace file inventory</p></div>
            <div class="files-toolbar"><span id="files-count" class="files-count">Loading files…</span><input id="file-filter" class="input-ide" type="search" placeholder="Search paths, languages, or terms…" aria-label="Filter indexed files"></div>
          </div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <div class="files-table-wrap"><table>
              <thead><tr><th>Path</th><th>Language</th><th>Size</th><th>Terms</th><th>Modified</th><th>Actions</th></tr></thead>
              <tbody id="files-table-body"></tbody>
            </table></div>
          </div>
        </section>

        <!-- 4. SYMBOLS PANEL -->
        <section class="panel" id="panel-symbols">
          <div class="panel-header">
            <div><h1>Symbols</h1><p>Classes, functions, methods, interfaces, and variables</p></div>
            <div class="files-toolbar"><span id="symbols-count" class="files-count">Loading symbols…</span><select id="symbol-kind-filter" class="input-ide" aria-label="Filter by symbol kind"><option value="">All kinds</option></select><input id="symbol-filter" class="input-ide" type="search" placeholder="Search name, file, or kind…" aria-label="Search symbols"></div>
          </div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>Name</th><th>Kind</th><th>File</th><th>Lines</th><th>Parent</th><th>Actions</th></tr></thead>
              <tbody id="symbols-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 5. REFERENCES PANEL -->
        <section class="panel" id="panel-references">
          <div class="panel-header"><div><h1>References</h1><p>Search usages, imports, inheritance and symbol relationships</p></div></div>
          <div class="files-toolbar"><input id="references-filter" class="input-ide" type="search" placeholder="Search symbol, file, or target…"><select id="references-kind" class="input-ide"><option value="">All relation kinds</option><option>references</option><option>calls</option><option>imports</option><option>exports</option><option>extends</option><option>implements</option><option>instantiates</option></select><span id="references-count" class="files-count">Loading…</span><button id="references-search" class="btn-ide">Search</button></div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>Kind</th><th>File</th><th>Target</th><th>Confidence</th></tr></thead>
              <tbody id="references-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 6. CALL GRAPH PANEL -->
        <section class="panel" id="panel-callgraph">
          <div class="panel-header"><div><h1>Call Graph</h1><p>Explore who calls a function and what it calls</p></div></div>
          <div class="files-toolbar"><input id="callgraph-query" class="input-ide" type="search" placeholder="Enter a function or method name…"><button id="callgraph-search" class="btn-ide">Explore calls</button><span id="callgraph-count" class="files-count"></span></div>
          <div class="ide-card" id="callgraph-list">Search for a function or method to explore its call relationships.</div>
        </section>

        <!-- 7. DEPENDENCIES PANEL -->
        <section class="panel" id="panel-dependencies">
          <div class="panel-header"><div><h1>Dependencies</h1><p>Resolved file imports, package dependencies, cycles and unresolved paths</p></div><button id="dependencies-refresh" class="btn-ide">Refresh analysis</button></div>
          <div id="dependencies-list" class="ide-card">Loading dependency analysis…</div>
        </section>

        <!-- 8. CHUNKS PANEL -->
        <section class="panel" id="panel-chunks">
          <div class="panel-header"><div><h1>Code Chunks</h1><p>Search, filter and inspect the actual semantic chunks stored in this index</p></div><button id="chunks-refresh" class="btn-ide">Refresh chunks</button></div>
          <div class="files-toolbar"><input id="chunks-search" class="input-ide" type="search" placeholder="Search chunk text, file path or hash…"><select id="chunks-file-filter" class="input-ide"><option value="">All files</option></select><span id="chunks-count" class="files-count">Loading chunks…</span></div>
          <div class="ide-card" style="padding:0; overflow:hidden;"><table><thead><tr><th>Chunk</th><th>File</th><th>Lines</th><th>Size</th><th>Preview</th></tr></thead><tbody id="chunks-table-body"><tr><td colspan="5">Loading chunks…</td></tr></tbody></table></div>
          <div id="chunk-inspector" class="ide-card" style="margin-top:14px; display:none;"></div>
          <div class="files-toolbar" style="justify-content:flex-end;"><button id="chunks-load-more" class="btn-ide" style="display:none;">Load more</button></div>
        </section>

        <!-- 9. SEARCH PANEL -->
        <section class="panel" id="panel-search">
          <div class="panel-header"><div><h1>Local Search</h1><p>Deterministic term search across indexed code</p></div></div>
          <div class="flex-row">
            <input id="search-input" class="input-ide" style="flex:1; height:36px;" type="search" placeholder="Type term or pattern to search…">
            <button id="search-btn" class="btn-ide" style="height:36px;">Search</button>
          </div>
          <div class="ide-card" id="search-results">Type at least 2 characters to search.</div>
        </section>

        <!-- EmbeddingGemma panel -->
        <section class="panel" id="panel-embeddings">
          <div class="panel-header"><div><h1>EmbeddingGemma</h1><p>Run local CPU inference and generate semantic vectors for this index</p></div></div>
          <div class="ide-card" style="display:flex; flex-direction:column; gap:12px;">
            <div class="flex-row" style="flex-wrap:wrap;">
              <label style="display:flex; flex-direction:column; gap:5px; color:var(--text-subtle);">Dimensions
                <select id="embedding-dimensions" class="input-ide"><option>128</option><option selected>256</option><option>512</option><option>768</option></select>
              </label>
              <label style="display:flex; flex-direction:column; gap:5px; color:var(--text-subtle);">Quantization
                <select id="embedding-dtype" class="input-ide"><option value="q4">Q4 · smaller</option><option value="q8" selected>Q8 · recommended</option><option value="fp32">FP32 · largest</option></select>
              </label>
              <span class="badge">Node.js · CPU · no Python</span>
            </div>
            <label style="display:flex; flex-direction:column; gap:6px; color:var(--text-subtle);">Test query
              <input id="embedding-query" class="input-ide" style="height:36px;" value="Where is authentication handled?" placeholder="Ask a code retrieval question…">
            </label>
            <div class="flex-row" style="flex-wrap:wrap;"><button class="btn-ide" id="embedding-test-button" type="button">Test EmbeddingGemma</button><button class="btn-ide" id="embedding-generate-button" type="button">Generate vectors for this index</button><button class="btn-ide" id="embedding-search-button" type="button">Semantic search</button></div>
            <p style="color:var(--text-subtle); font-size:11px;">Test runs a query and one indexed code chunk through the model. Generate vectors embeds every chunk and updates the selected index. Semantic search runs your query against those stored vectors. The first run downloads model files.</p>
          </div>
          <div class="grid-stats" id="embedding-stats"><div class="stat-card"><div class="stat-val">Ready</div><div class="stat-lbl">Model status</div></div><div class="stat-card"><div class="stat-val">CPU</div><div class="stat-lbl">Runtime</div></div><div class="stat-card"><div class="stat-val">Q8</div><div class="stat-lbl">Default precision</div></div></div>
          <div class="ide-card"><div class="card-title">Inference output <span id="embedding-meta">Not run yet</span></div><pre id="embedding-output" style="white-space:pre-wrap; overflow:auto; max-height:360px; font-family:var(--mono); font-size:11px; color:var(--text-muted);">Choose “Test EmbeddingGemma” to load the model and validate query/document embeddings on this index.</pre></div>
        </section>

        <!-- 10. APIS PANEL -->
        <section class="panel" id="panel-apis">
          <div class="panel-header"><div><h1>API Intelligence</h1><p>Detected HTTP endpoints and routes</p></div></div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>Method</th><th>Path</th><th>File</th><th>Line</th></tr></thead>
              <tbody id="apis-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 11. DATABASE PANEL -->
        <section class="panel" id="panel-database">
          <div class="panel-header"><div><h1>Database Intelligence</h1><p>Prisma models, SQL schemas, and ORM entities</p></div></div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>Model / Table</th><th>Type</th><th>File</th></tr></thead>
              <tbody id="database-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 12. TESTS PANEL -->
        <section class="panel" id="panel-tests">
          <div class="panel-header">
            <div><h1>Test Runner</h1><p>Run the indexed workspace's actual test command and inspect its output</p></div>
            <button class="btn-ide" id="run-tests-button" type="button">Run full test suite</button>
          </div>
          <div class="grid-stats" id="test-run-stats">
            <div class="stat-card"><div class="stat-val">Ready</div><div class="stat-lbl">Runner status</div></div>
            <div class="stat-card"><div class="stat-val">npm test</div><div class="stat-lbl">Command</div></div>
            <div class="stat-card"><div class="stat-val">180s</div><div class="stat-lbl">Timeout</div></div>
          </div>
          <div class="ide-card">
            <div class="card-title">Execution output <span id="test-run-meta">Not run yet</span></div>
            <pre id="test-run-output" style="white-space:pre-wrap; overflow:auto; max-height:360px; font-family:var(--mono); font-size:11px; color:var(--text-muted);">Choose “Run full test suite” to execute npm test in this workspace. This runs the package's configured test script.</pre>
          </div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <div class="card-title" style="padding:14px 16px 0;">Detected test files</div>
            <table>
              <thead><tr><th>Test File</th><th>Framework</th><th>Test Symbol</th><th>Mapped Target</th></tr></thead>
              <tbody id="tests-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 13. CONFIGURATION PANEL -->
        <section class="panel" id="panel-config">
          <div class="panel-header"><div><h1>Configuration</h1><p>Workspace config files and settings</p></div></div>
          <div class="ide-card" id="config-list">Loading configuration files…</div>
        </section>

        <!-- 14. DOCUMENTATION PANEL -->
        <section class="panel" id="panel-docs">
          <div class="panel-header"><div><h1>Documentation</h1><p>Markdown docs and linked symbol references</p></div></div>
          <div class="ide-card" id="docs-list">Loading documentation…</div>
        </section>

        <!-- 15. GIT PANEL -->
        <section class="panel" id="panel-git">
          <div class="panel-header"><div><h1>Git Activity</h1><p>Local commits and repository history</p></div></div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>Hash</th><th>Author</th><th>Date</th><th>Subject</th></tr></thead>
              <tbody id="git-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 16. CHANGES PANEL -->
        <section class="panel" id="panel-changes">
          <div class="panel-header"><div><h1>Changes</h1><p>Local uncommitted git modifications</p></div></div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>Status</th><th>File Path</th></tr></thead>
              <tbody id="changes-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 17. COMPLEXITY PANEL -->
        <section class="panel" id="panel-complexity">
          <div class="panel-header"><div><h1>Complexity Metrics</h1><p>Cyclomatic estimate, LOC, fan-in, fan-out</p></div></div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>File Path</th><th>Language</th><th>LOC</th><th>Est. Complexity</th><th>Fan-in</th><th>Fan-out</th></tr></thead>
              <tbody id="complexity-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 18. DUPLICATES PANEL -->
        <section class="panel" id="panel-duplicates">
          <div class="panel-header"><div><h1>Duplicate Code</h1><p>Structural chunk match candidates</p></div></div>
          <div class="ide-card" id="duplicates-list">Scanning for duplicate structures…</div>
        </section>

        <!-- 19. SECURITY PANEL -->
        <section class="panel" id="panel-security">
          <div class="panel-header"><div><h1>Security Findings</h1><p>Redacted sensitive credential candidates</p></div></div>
          <div class="ide-card" style="padding:0; overflow:hidden;">
            <table>
              <thead><tr><th>Kind</th><th>Location</th><th>Confidence</th><th>Value</th></tr></thead>
              <tbody id="security-table-body"></tbody>
            </table>
          </div>
        </section>

        <!-- 20. HEALTH PANEL -->
        <section class="panel" id="panel-health">
          <div class="panel-header">
            <div><h1>Index Health</h1><p>Snapshot integrity and reference validation</p></div>
            <button id="btn-repair-index" class="btn-ide">Repair & Clear Cache</button>
          </div>
          <div class="ide-card" id="health-report">Checking index health…</div>
        </section>

        <!-- 21. INSPECTOR PANEL -->
        <section class="panel" id="panel-inspector">
          <div class="panel-header"><div><h1>Index Inspector</h1><p>Binary Index Header and Section Stats</p></div></div>
          <div class="grid-stats" id="inspector-stats"></div>
        </section>

        <!-- 22. SETTINGS PANEL -->
        <section class="panel" id="panel-settings">
          <div class="panel-header"><div><h1>Settings</h1><p>Indexer and dashboard configurations</p></div></div>
          <div class="ide-card" style="display:flex; flex-direction:column; gap:12px;">
            <div><strong>Appearance</strong><br><span style="color:var(--text-subtle);">Theme switching (Dark / Light / System)</span></div>
            <div class="flex-row">
              <button class="btn-ide" data-set-theme="dark">Dark</button>
              <button class="btn-ide" data-set-theme="light">Light</button>
              <button class="btn-ide" data-set-theme="system">System</button>
            </div>
            <hr style="border:none; border-top:1px solid var(--border);">
            <div><strong>Storage Directory</strong><br><span style="color:var(--text-subtle); font-family:var(--mono); font-size:11px;">~/.cache/codebase-indexer</span></div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <!-- GLOBAL RIGHT DETAIL DRAWER -->
  <aside class="drawer" id="global-drawer">
    <div class="drawer-header">
      <strong id="drawer-title">Details</strong>
      <button class="drawer-close" id="drawer-close" aria-label="Close panel">${iconSvg(X, 16)}</button>
    </div>
    <div id="drawer-body" style="font-family:var(--mono); font-size:11px; color:var(--text-muted); overflow-y:auto;">Select an item to view details.</div>
  </aside>

  <!-- COMMAND PALETTE MODAL -->
  <div class="cmd-palette-overlay" id="cmd-overlay">
    <div class="cmd-palette">
      <input type="search" class="cmd-input" id="cmd-input" placeholder="Type a command, file, or symbol…">
      <div class="cmd-results" id="cmd-results"></div>
    </div>
  </div>

  <script>
    const LANGUAGE_ICON_DATA = ${JSON.stringify(languageIconData)}; function languageIconFor(language) { const key = String(language || '').toLowerCase().replaceAll('.', '').replaceAll(' ', ''); const icon = LANGUAGE_ICON_DATA[key]; return icon ? '<svg class="language-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="#' + icon.hex + '" role="img" aria-label="' + icon.title + '"><path d="' + icon.path + '" /></svg>' : '<span>${iconSvg(FileCode, 14)}</span>'; } var indexes = [];
    var activeUid = '';

    function el(id) { return document.getElementById(id); }

    function applyTheme(theme) {
      if (theme === 'system') {
        var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
      localStorage.setItem('codebase_theme', theme);
    }
    applyTheme(localStorage.getItem('codebase_theme') || 'system');

    // Navigation tab switching
    document.querySelectorAll('.nav-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var target = item.getAttribute('data-target');
        if (!target) return;
        document.querySelectorAll('.nav-item').forEach(function(i) { i.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function(p) { p.classList.remove('active'); });
        item.classList.add('active');
        var p = el(target);
        if (p) p.classList.add('active');
      });
    });

    // Drawer opening
    function openDrawer(title, contentHtml) {
      el('drawer-title').textContent = title;
      el('drawer-body').innerHTML = contentHtml;
      el('global-drawer').classList.add('open');
    }
    el('drawer-close').addEventListener('click', function() {
      el('global-drawer').classList.remove('open');
    });

    // Command palette
    function toggleCmdPalette(open) {
      var overlay = el('cmd-overlay');
      if (open) {
        overlay.classList.add('open');
        el('cmd-input').focus();
      } else {
        overlay.classList.remove('open');
      }
    }
    el('cmd-trigger').addEventListener('click', function() { toggleCmdPalette(true); });
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCmdPalette(true);
      }
      if (e.key === 'Escape') {
        toggleCmdPalette(false);
        el('global-drawer').classList.remove('open');
      }
    });
    el('cmd-overlay').addEventListener('click', function(e) {
      if (e.target === el('cmd-overlay')) toggleCmdPalette(false);
    });

    var architectureReport = null;
    function renderDependencies() {
      var host = el('dependencies-list'); host.textContent = '';
      if (!architectureReport) { host.textContent = 'No dependency analysis loaded.'; return; }
      var report = architectureReport;
      var stats = document.createElement('div'); stats.className = 'stats-grid';
      [[report.files.length, 'Files analyzed'], [report.dependencies.length, 'Resolved edges'], [report.externalPackages.length, 'External packages'], [report.cycles.length, 'Dependency cycles'], [report.unresolvedRelativeImports.length + report.unresolvedAliasImports.length, 'Unresolved imports']].forEach(function(pair) {
        var card = document.createElement('div'); card.className = 'stat-card'; var value = document.createElement('div'); value.className = 'stat-val'; value.textContent = pair[0]; var label = document.createElement('div'); label.className = 'stat-lbl'; label.textContent = pair[1]; card.append(value, label); stats.appendChild(card);
      });
      host.appendChild(stats);
      var toolbar = document.createElement('div'); toolbar.className = 'files-toolbar'; toolbar.style.margin = '16px 0';
      var search = document.createElement('input'); search.className = 'input-ide'; search.type = 'search'; search.placeholder = 'Filter dependency source or target…'; search.style.flex = '1';
      var mode = document.createElement('select'); mode.className = 'input-ide'; [['edges','Resolved dependencies'],['external','External packages'],['cycles','Cycles'],['unresolved','Unresolved imports'],['files','File fan-in / fan-out']].forEach(function(pair) { var option = document.createElement('option'); option.value = pair[0]; option.textContent = pair[1]; mode.appendChild(option); });
      var count = document.createElement('span'); count.className = 'files-count'; toolbar.append(search, mode, count); host.appendChild(toolbar);
      var tableWrap = document.createElement('div'); tableWrap.style.overflowX = 'auto'; host.appendChild(tableWrap);
      function draw() {
        var query = search.value.trim().toLowerCase(); var selectedMode = mode.value; var table = document.createElement('table'); var thead = document.createElement('thead'); var tbody = document.createElement('tbody'); table.append(thead, tbody);
        var headers = selectedMode === 'edges' ? ['Source file','Imports from','Import count','Lines'] : selectedMode === 'external' ? ['Package','Imported by files','Files'] : selectedMode === 'cycles' ? ['Cycle members','Files'] : selectedMode === 'unresolved' ? ['Source file','Unresolved target','Line','Type'] : ['File','Fan-in','Fan-out'];
        var headRow = document.createElement('tr'); headers.forEach(function(label) { var th = document.createElement('th'); th.textContent = label; headRow.appendChild(th); }); thead.appendChild(headRow);
        var rows = [];
        if (selectedMode === 'edges') rows = report.dependencies.filter(function(item) { return !query || (item.from + ' ' + item.to).toLowerCase().includes(query); }).map(function(item) { return [item.from,item.to,item.imports,(item.lines || []).join(', ')]; });
        if (selectedMode === 'external') rows = report.externalPackages.filter(function(item) { return !query || (item.name + ' ' + item.files.join(' ')).toLowerCase().includes(query); }).map(function(item) { return [item.name,item.importedBy,item.files.join(', ')]; });
        if (selectedMode === 'cycles') rows = report.cycles.filter(function(item) { return !query || item.files.join(' ').toLowerCase().includes(query); }).map(function(item) { return [item.files.join(' → '),item.size]; });
        if (selectedMode === 'unresolved') rows = report.unresolvedRelativeImports.map(function(item) { return [item.filePath,item.target,item.line,'Relative']; }).concat(report.unresolvedAliasImports.map(function(item) { return [item.filePath,item.target,item.line,'Alias']; })).filter(function(row) { return !query || row.join(' ').toLowerCase().includes(query); });
        if (selectedMode === 'files') rows = report.files.filter(function(item) { return !query || item.path.toLowerCase().includes(query); }).sort(function(a,b) { return b.fanIn - a.fanIn || b.fanOut - a.fanOut; }).map(function(item) { return [item.path,item.fanIn,item.fanOut]; });
        count.textContent = rows.length + ' results';
        rows.forEach(function(values) { var tr = document.createElement('tr'); values.forEach(function(value,index) { var td = document.createElement('td'); td.textContent = String(value); if (index === 0 && typeof values[0] === 'string') { td.style.fontFamily = 'var(--mono)'; } tr.appendChild(td); }); if (selectedMode === 'edges' || selectedMode === 'files' || selectedMode === 'unresolved') { tr.style.cursor = 'pointer'; tr.addEventListener('click', function() { var filePath = selectedMode === 'edges' || selectedMode === 'unresolved' ? values[0] : values[0]; var file = indexedFiles.find(function(item) { return item.path === filePath; }); if (file) inspectIndexedFile(file); }); } tbody.appendChild(tr); });
        if (!rows.length) { var tr = document.createElement('tr'); var td = document.createElement('td'); td.colSpan = headers.length; td.textContent = 'No results in this category.'; td.style.padding = '22px'; td.style.textAlign = 'center'; tr.appendChild(td); tbody.appendChild(tr); }
        tableWrap.replaceChildren(table);
      }
      search.addEventListener('input', draw); mode.addEventListener('change', draw); draw();
      if (report.caveats && report.caveats.length) { var note = document.createElement('p'); note.style.color = 'var(--text-subtle)'; note.style.marginTop = '14px'; note.textContent = 'Analysis notes: ' + report.caveats.join(' · '); host.appendChild(note); }
    }
    async function loadDependencies(uid) {
      var host = el('dependencies-list'); host.textContent = 'Analyzing imports and resolving dependency paths…';
      try { var response = await fetch('/api/indexes/' + encodeURIComponent(uid) + '/architecture'); var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Dependency analysis failed'); architectureReport = data; renderDependencies(); }
      catch (error) { host.textContent = 'Dependency analysis failed: ' + error.message; }
    }
    el('dependencies-refresh').addEventListener('click', function() { if (activeUid) loadDependencies(activeUid); });

    var chunkRows = [];
    var chunkTotal = 0;
    var chunkOffset = 0;
    var chunkLimit = 100;
    var chunkRequest = 0;
    function renderChunks(append) {
      var body = el('chunks-table-body');
      if (!append) body.textContent = '';
      var query = el('chunks-search').value.trim().toLowerCase();
      var fileFilter = el('chunks-file-filter').value;
      var visible = chunkRows.filter(function(chunk) { return (!fileFilter || chunk.filePath === fileFilter) && (!query || [chunk.filePath, chunk.hash, chunk.text].some(function(value) { return String(value || '').toLowerCase().includes(query); })); });
      el('chunks-count').textContent = visible.length + ' shown · ' + chunkTotal.toLocaleString() + ' total chunks';
      visible.forEach(function(chunk) {
        var row = document.createElement('tr'); row.style.cursor = 'pointer';
        var hash = document.createElement('td'); hash.textContent = chunk.hash.slice(0, 12); hash.title = chunk.hash; hash.style.fontFamily = 'var(--mono)'; row.appendChild(hash);
        var file = document.createElement('td'); file.textContent = chunk.filePath; file.style.fontFamily = 'var(--mono)'; row.appendChild(file);
        var lines = document.createElement('td'); lines.textContent = chunk.startLine + '–' + chunk.endLine; row.appendChild(lines);
        var size = document.createElement('td'); size.textContent = chunk.text.length.toLocaleString() + ' chars'; row.appendChild(size);
        var preview = document.createElement('td'); preview.textContent = chunk.text.replace(/\s+/g, ' ').slice(0, 180); row.appendChild(preview);
        row.addEventListener('click', function() { inspectChunk(chunk); }); body.appendChild(row);
      });
      if (!visible.length && !append) { var row = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 5; cell.textContent = chunkTotal ? 'No chunks match these filters.' : 'No chunks were found in this index. Re-index the workspace to generate chunks.'; cell.style.textAlign = 'center'; cell.style.padding = '24px'; row.appendChild(cell); body.appendChild(row); }
      el('chunks-load-more').style.display = chunkOffset < chunkTotal ? '' : 'none';
    }
    function inspectChunk(chunk) {
      var host = el('chunk-inspector'); host.style.display = ''; host.textContent = '';
      var heading = document.createElement('h3'); heading.textContent = chunk.filePath + ' · lines ' + chunk.startLine + '–' + chunk.endLine; host.appendChild(heading);
      var meta = document.createElement('p'); meta.textContent = 'Chunk ID: ' + chunk.id + ' · SHA hash: ' + chunk.hash + (chunk.symbolId ? ' · Symbol: ' + chunk.symbolId : ' · File-level chunk'); host.appendChild(meta);
      var pre = document.createElement('pre'); pre.className = 'source-preview'; pre.textContent = chunk.text; pre.style.maxHeight = '420px'; pre.style.overflow = 'auto'; host.appendChild(pre);
      if (window.highlightSource) window.highlightSource(pre, chunk.filePath);
      var open = document.createElement('button'); open.className = 'btn-ide'; open.textContent = 'Inspect full source file'; open.addEventListener('click', function() { var file = indexedFiles.find(function(item) { return item.path === chunk.filePath; }); if (file) inspectIndexedFile(file); }); host.appendChild(open);
      host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    async function loadChunks(uid, reset) {
      if (reset) { chunkRows = []; chunkOffset = 0; chunkTotal = 0; }
      var requestId = ++chunkRequest;
      el('chunks-count').textContent = 'Loading chunks…';
      try {
        var params = new URLSearchParams({ offset: String(chunkOffset), limit: String(chunkLimit), q: el('chunks-search').value.trim(), file: el('chunks-file-filter').value });
        var response = await fetch('/api/indexes/' + encodeURIComponent(uid) + '/chunks?' + params.toString());
        var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load chunks');
        if (requestId !== chunkRequest) return;
        chunkRows = reset ? (data.chunks || []) : chunkRows.concat(data.chunks || []);
        chunkTotal = data.total || 0; chunkOffset = data.nextOffset ?? (chunkOffset + (data.chunks || []).length);
        var selector = el('chunks-file-filter'); var selected = selector.value;
        selector.replaceChildren(); var all = document.createElement('option'); all.value = ''; all.textContent = 'All files'; selector.appendChild(all);
        (data.files || []).forEach(function(filePath) { var option = document.createElement('option'); option.value = filePath; option.textContent = filePath; selector.appendChild(option); });
        selector.value = selected;
        renderChunks(false);
      } catch (error) { el('chunks-count').textContent = 'Load failed'; el('chunks-table-body').textContent = ''; var row = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 5; cell.textContent = error.message; row.appendChild(cell); el('chunks-table-body').appendChild(row); }
    }
    el('chunks-search').addEventListener('input', function() { if (activeUid) loadChunks(activeUid, true); });
    el('chunks-file-filter').addEventListener('change', function() { if (activeUid) loadChunks(activeUid, true); });
    el('chunks-refresh').addEventListener('click', function() { if (activeUid) loadChunks(activeUid, true); });
    el('chunks-load-more').addEventListener('click', function() { if (activeUid && chunkOffset < chunkTotal) loadChunks(activeUid, false); });

    var referenceRows = [];
    var referenceSymbols = [];
    function renderReferences() {
      var query = (el('references-filter').value || '').trim().toLowerCase();
      var kind = el('references-kind').value;
      var filtered = referenceRows.filter(function(relation) {
        if (kind && relation.kind !== kind) return false;
        var from = referenceSymbols.find(function(symbol) { return symbol.id === relation.fromSymbolId; });
        var to = referenceSymbols.find(function(symbol) { return symbol.id === relation.toSymbolId; });
        return !query || [relation.targetName, relation.filePath, from && from.name, to && to.name].some(function(value) { return value && value.toLowerCase().includes(query); });
      });
      el('references-count').textContent = filtered.length + ' of ' + referenceRows.length + ' relationships';
      var body = el('references-table-body'); body.textContent = '';
      filtered.forEach(function(relation) {
        var from = referenceSymbols.find(function(symbol) { return symbol.id === relation.fromSymbolId; });
        var to = referenceSymbols.find(function(symbol) { return symbol.id === relation.toSymbolId; });
        var row = document.createElement('tr');
        [relation.kind, relation.filePath + ':' + relation.line, (from ? from.name : '—') + ' → ' + (to ? to.name : relation.targetName), Math.round((relation.confidence || 0) * 100) + '%'].forEach(function(value) { var cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell); });
        row.title = 'Click to inspect source location'; row.style.cursor = 'pointer'; row.addEventListener('click', function() { var file = indexedFiles.find(function(item) { return item.path === relation.filePath; }); if (file) inspectIndexedFile(file); });
        body.appendChild(row);
      });
      if (!filtered.length) { var row = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = referenceRows.length ? 'No relationships match this filter.' : 'No references or relationships were extracted for this index.'; cell.style.textAlign = 'center'; cell.style.padding = '24px'; row.appendChild(cell); body.appendChild(row); }
    }
    async function loadReferences(uid) {
      try { var response = await fetch('/api/indexes/' + encodeURIComponent(uid) + '/references'); if (!response.ok) throw new Error('HTTP ' + response.status); var data = await response.json(); referenceRows = data.relations || []; referenceSymbols = data.symbols || []; renderReferences(); }
      catch (error) { el('references-count').textContent = 'Load failed'; el('references-table-body').textContent = ''; var row = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 4; cell.textContent = error.message; row.appendChild(cell); el('references-table-body').appendChild(row); }
    }
    el('references-search').addEventListener('click', renderReferences);
    el('references-filter').addEventListener('input', renderReferences);
    el('references-kind').addEventListener('change', renderReferences);

    async function exploreCallGraph() {
      var query = el('callgraph-query').value.trim();
      if (!activeUid || !query) { el('callgraph-list').textContent = 'Enter a function or method name first.'; return; }
      el('callgraph-list').textContent = 'Resolving callers and callees…';
      try {
        var response = await fetch('/api/indexes/' + encodeURIComponent(activeUid) + '/callgraph?q=' + encodeURIComponent(query));
        var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Call graph request failed');
        var host = el('callgraph-list'); host.textContent = '';
        if (!data.selected) {
          var heading = document.createElement('p'); heading.textContent = 'No exact symbol selected. Choose a matching definition:'; host.appendChild(heading);
          (data.matches || []).forEach(function(symbol) { var button = document.createElement('button'); button.type = 'button'; button.className = 'btn-ide'; button.style.margin = '4px'; button.textContent = symbol.name + ' · ' + symbol.filePath + ':' + symbol.startLine; button.addEventListener('click', function() { el('callgraph-query').value = symbol.name; exploreCallGraph(); }); host.appendChild(button); });
          if (!(data.matches || []).length) host.textContent = 'No matching function or method found.';
          return;
        }
        var selected = data.selected;
        var title = document.createElement('div'); title.className = 'file-meta-item'; title.innerHTML = '<small>Selected symbol</small><strong></strong>'; title.querySelector('strong').textContent = selected.name + ' · ' + selected.filePath + ':' + selected.startLine; host.appendChild(title);
        var columns = document.createElement('div'); columns.style.display = 'grid'; columns.style.gridTemplateColumns = 'repeat(auto-fit,minmax(220px,1fr))'; columns.style.gap = '12px'; columns.style.marginTop = '14px';
        function addGroup(label, relations, isCaller) {
          var section = document.createElement('section'); section.className = 'file-meta-item'; var heading = document.createElement('strong'); heading.textContent = label + ' (' + relations.length + ')'; section.appendChild(heading);
          if (!relations.length) { var empty = document.createElement('p'); empty.textContent = 'No resolved ' + label.toLowerCase() + '.'; section.appendChild(empty); }
          relations.forEach(function(relation) {
            var otherId = isCaller ? relation.fromSymbolId : relation.toSymbolId;
            var other = (data.symbols || []).find(function(symbol) { return symbol.id === otherId; });
            var item = document.createElement('button'); item.type = 'button'; item.className = 'btn-ide'; item.style.display = 'block'; item.style.width = '100%'; item.style.marginTop = '7px'; item.style.textAlign = 'left';
            item.textContent = (other ? other.name : relation.targetName) + ' · ' + relation.filePath + ':' + relation.line;
            if (other) item.addEventListener('click', function() { el('callgraph-query').value = other.name; exploreCallGraph(); });
            else item.disabled = true;
            section.appendChild(item);
          });
          columns.appendChild(section);
        }
        addGroup('Callers', data.callers || [], true); addGroup('Callees', data.callees || [], false); host.appendChild(columns);
      } catch (error) { el('callgraph-list').textContent = error.message; }
    }
    el('callgraph-search').addEventListener('click', exploreCallGraph);
    el('callgraph-query').addEventListener('keydown', function(event) { if (event.key === 'Enter') exploreCallGraph(); });

    async function loadData() {
      try {
        var res = await fetch('/api/indexes');
        var payload = await res.json();
        indexes = payload.indexes || [];
        var selector = el('index-select');
        selector.replaceChildren();
        indexes.forEach(function(item) {
          var option = document.createElement('option');
          option.value = item.metadata.uid;
          option.textContent = item.fileName;
          option.title = item.metadata.workspaceRoot;
          selector.appendChild(option);
        });
        var savedUid = localStorage.getItem('codebase_index_uid');
        var initial = indexes.find(function(item) { return item.metadata.uid === savedUid; }) || indexes[0];
        if (initial) {
          selector.value = initial.metadata.uid;
          selectIndex(initial.metadata.uid);
        } else {
          var empty = document.createElement('option');
          empty.value = '';
          empty.textContent = 'No index files found';
          selector.appendChild(empty);
          activeUid = '';
          el('top-workspace-path').textContent = 'No local indexes found';
        }
      } catch (err) {
        console.warn('Load failed', err);
      }
    }

    function selectIndex(uid) {
      var item = indexes.find(function(index) { return index.metadata.uid === uid; });
      if (!item) return;
      activeUid = uid;
      localStorage.setItem('codebase_index_uid', uid);
      el('top-workspace-path').textContent = item.metadata.workspaceRoot;
      el('nav-dep-graph').href = '/graph/' + encodeURIComponent(uid);
      renderOverview(item);
      loadAllPanels(uid);
    }

    el('index-select').addEventListener('change', function(event) {
      selectIndex(event.target.value);
    });

    function renderOverview(item) {
      var m = item.metadata;
      el('overview-stats').innerHTML =
        '<div class="stat-card"><div class="stat-val">' + (m.fileCount || 0) + '</div><div class="stat-lbl">Files</div></div>' +
        '<div class="stat-card"><div class="stat-val">' + (m.symbolCount || 0) + '</div><div class="stat-lbl">Symbols</div></div>' +
        '<div class="stat-card"><div class="stat-val">' + (m.relationCount || 0) + '</div><div class="stat-lbl">Relations</div></div>' +
        '<div class="stat-card"><div class="stat-val">' + (m.chunkCount || 0) + '</div><div class="stat-lbl">Chunks</div></div>';

      el('overview-export-json').href = '/api/indexes/' + encodeURIComponent(m.uid) + '/export?format=json';
      el('overview-export-csv').href = '/api/indexes/' + encodeURIComponent(m.uid) + '/export?format=csv';
    }

    async function runWorkspaceTests() {
      var button = el('run-tests-button');
      var output = el('test-run-output');
      var stats = el('test-run-stats');
      if (!activeUid || button.disabled) return;
      button.disabled = true;
      button.textContent = 'Running…';
      el('test-run-meta').textContent = 'Executing npm test';
      output.textContent = 'Running npm test in the indexed workspace…\nThis may take up to 180 seconds.';
      stats.innerHTML = '<div class="stat-card"><div class="stat-val">Running</div><div class="stat-lbl">Runner status</div></div><div class="stat-card"><div class="stat-val">npm test</div><div class="stat-lbl">Command</div></div><div class="stat-card"><div class="stat-val">180s</div><div class="stat-lbl">Timeout</div></div>';
      try {
        var response = await fetch('/api/indexes/' + encodeURIComponent(activeUid) + '/tests/run', { method: 'POST' });
        var result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Test run could not start');
        var combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
        output.textContent = combined || (result.ok ? 'Test command completed with no output.' : 'Test command failed.');
        var summary = combined.match(/# tests\s+(\d+)[\s\S]*?# pass\s+(\d+)[\s\S]*?# fail\s+(\d+)/);
        var status = result.ok ? 'Passed' : (result.timedOut ? 'Timed out' : 'Failed');
        stats.innerHTML = '<div class="stat-card"><div class="stat-val">' + status + '</div><div class="stat-lbl">Runner status</div></div>' +
          '<div class="stat-card"><div class="stat-val">' + (summary ? summary[2] + ' / ' + summary[1] : (result.exitCode === 0 ? '0' : '—')) + '</div><div class="stat-lbl">Tests passed</div></div>' +
          '<div class="stat-card"><div class="stat-val">' + (summary ? summary[3] : (result.exitCode ?? '—')) + '</div><div class="stat-lbl">Failures / exit code</div></div>';
        el('test-run-meta').textContent = result.command + ' · ' + (result.durationMs / 1000).toFixed(1) + 's · exit ' + result.exitCode;
      } catch (error) {
        output.textContent = error instanceof Error ? error.message : String(error);
        el('test-run-meta').textContent = 'Could not run';
        stats.innerHTML = '<div class="stat-card"><div class="stat-val">Error</div><div class="stat-lbl">Runner status</div></div>';
      } finally {
        button.disabled = false;
        button.textContent = 'Run full test suite';
      }
    }
    el('run-tests-button').addEventListener('click', runWorkspaceTests);

    function embeddingOptions() { return { dimensions: Number(el('embedding-dimensions').value), dtype: el('embedding-dtype').value }; }
    async function runEmbeddingAction(action) {
      if (!activeUid) return;
      var testButton = el('embedding-test-button');
      var generateButton = el('embedding-generate-button');
      var searchButton = el('embedding-search-button');
      testButton.disabled = true; generateButton.disabled = true; searchButton.disabled = true;
      var button = action === 'test' ? testButton : (action === 'generate' ? generateButton : searchButton);
      button.textContent = action === 'test' ? 'Loading model…' : (action === 'generate' ? 'Generating vectors…' : 'Searching…');
      el('embedding-output').textContent = action === 'test'
        ? 'Loading EmbeddingGemma 2 ONNX text encoder on CPU. The first run downloads model files; this can take a few minutes…'
        : (action === 'generate' ? 'Generating embeddings for all chunks in the selected index. Keep this dashboard open…' : 'Embedding your query and searching the selected index…');
      el('embedding-meta').textContent = 'Running · CPU';
      try {
        var payload = embeddingOptions();
        if (action !== 'generate') payload.query = el('embedding-query').value;
        var response = await fetch('/api/indexes/' + encodeURIComponent(activeUid) + '/embeddings/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        var result = await response.json();
        if (action === 'generate' && result.jobId) {
          var jobId = result.jobId;
          while (result.status === 'running' || result.status === 'queued') {
            var current = Number(result.current || 0);
            var total = Number(result.total || 0);
            el('embedding-output').textContent = (result.message || 'Generating vectors…') + (total ? '\n' + current.toLocaleString() + ' / ' + total.toLocaleString() + ' chunks' : '');
            el('embedding-meta').textContent = total ? Math.round(current / total * 100) + '% · CPU' : 'Starting · CPU';
            await new Promise(function(resolve) { setTimeout(resolve, 1500); });
            var jobResponse = await fetch('/api/embedding-jobs/' + encodeURIComponent(jobId));
            result = await jobResponse.json();
            if (!jobResponse.ok) throw new Error(result.error || 'Could not read embedding job status');
          }
          if (result.status === 'failed') throw new Error(result.error || 'Vector generation failed');
          if (result.status !== 'completed' || !result.result) throw new Error('Embedding job ended without a result');
          result = result.result;
        } else if (!response.ok) {
          throw new Error(result.error || 'Embedding request failed');
        }
        el('embedding-output').textContent = JSON.stringify(result, null, 2);
        el('embedding-meta').textContent = (result.durationMs / 1000).toFixed(1) + 's · CPU · ' + (result.provider || result.model);
        el('embedding-stats').innerHTML = '<div class="stat-card"><div class="stat-val">Passed</div><div class="stat-lbl">Model status</div></div>' +
          '<div class="stat-card"><div class="stat-val">' + (result.dimensions || payload.dimensions) + '</div><div class="stat-lbl">Vector dimensions</div></div>' +
          '<div class="stat-card"><div class="stat-val">' + (result.vectorCount !== undefined ? result.vectorCount : (result.resultCount !== undefined ? result.resultCount : Number(result.cosineSimilarity).toFixed(3))) + '</div><div class="stat-lbl">' + (result.vectorCount !== undefined ? 'Stored vectors' : (result.resultCount !== undefined ? 'Semantic matches' : 'Query / code cosine')) + '</div></div>';
      } catch (error) {
        el('embedding-output').textContent = error instanceof Error ? error.message : String(error);
        el('embedding-meta').textContent = 'Failed';
        el('embedding-stats').innerHTML = '<div class="stat-card"><div class="stat-val">Failed</div><div class="stat-lbl">Model status</div></div>';
      } finally {
        testButton.disabled = false; generateButton.disabled = false; searchButton.disabled = false;
        testButton.textContent = 'Test EmbeddingGemma'; generateButton.textContent = 'Generate vectors for this index'; searchButton.textContent = 'Semantic search';
      }
    }
    el('embedding-test-button').addEventListener('click', function() { runEmbeddingAction('test'); });
    el('embedding-generate-button').addEventListener('click', function() {
      if (window.confirm('Generate EmbeddingGemma vectors for every code chunk in this index? This updates the selected index.')) runEmbeddingAction('generate');
    });
    el('embedding-search-button').addEventListener('click', function() { runEmbeddingAction('search'); });

    var indexedFiles = [];
    var activeIndexUid = null;

    function formatFileSize(bytes) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function formatFileDate(timestamp) {
      if (!timestamp) return '—';
      var date = new Date(timestamp);
      return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
    }

    function inspectIndexedFile(file) {
      var title = file.path;
      openDrawer(title, '<div class="repo-tree-empty">Loading file details and source…</div>');
      fetch('/api/indexes/' + encodeURIComponent(activeIndexUid) + '/source?path=' + encodeURIComponent(file.path))
        .then(function(response) { if (!response.ok) throw new Error(response.status === 404 ? 'This file is no longer available in the indexed workspace.' : 'Could not read source (' + response.status + ')'); return response.json(); })
        .then(function(source) {
          var body = el('drawer-body');
          body.textContent = '';
          var layout = document.createElement('div'); layout.className = 'file-inspect-layout';
          var meta = document.createElement('div'); meta.className = 'file-meta-grid';
          [['Language', source.language || file.language], ['Size', formatFileSize(file.size)], ['Last indexed', formatFileDate(file.modifiedAt)], ['Content hash', file.hash || '—'], ['Indexed terms', String((file.terms || []).length)], ['Path', file.path]].forEach(function(entry) {
            var item = document.createElement('div'); item.className = 'file-meta-item';
            var label = document.createElement('small'); label.textContent = entry[0];
            var value = document.createElement('strong'); value.textContent = entry[1]; value.title = entry[1];
            item.append(label, value); meta.appendChild(item);
          });
          var toolbar = document.createElement('div'); toolbar.className = 'file-inspect-toolbar';
          var sourceLabel = document.createElement('strong'); sourceLabel.textContent = 'Source preview'; sourceLabel.style.fontSize = '12px';
          var copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn-ide'; copy.textContent = 'Copy source';
          copy.addEventListener('click', function() {
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(source.content).then(function() { copy.textContent = 'Copied'; }).catch(function() { copy.textContent = 'Copy unavailable'; });
            else copy.textContent = 'Copy unavailable';
          });
          toolbar.append(sourceLabel, copy);
          var pre = document.createElement('pre'); pre.className = 'file-source'; pre.innerHTML = window.highlightSource ? window.highlightSource(source.content, source.language || file.language) : ''; if (!window.highlightSource) pre.textContent = source.content;
          layout.append(meta, toolbar, pre);
          if (file.terms && file.terms.length) {
            var termsHeading = document.createElement('strong'); termsHeading.textContent = 'Indexed terms'; termsHeading.style.fontSize = '12px';
            var terms = document.createElement('div'); terms.className = 'file-terms';
            file.terms.slice(0, 80).forEach(function(term) { var chip = document.createElement('span'); chip.className = 'file-term'; chip.textContent = term; terms.appendChild(chip); });
            layout.append(termsHeading, terms);
          }
          body.appendChild(layout);
        })
        .catch(function(error) {
          var body = el('drawer-body'); body.textContent = '';
          var message = document.createElement('div'); message.className = 'file-inspect-error'; message.textContent = error.message;
          body.appendChild(message);
        });
    }

    var indexedSymbols = [];
    var indexedSymbolsById = new Map();

    function inspectIndexedSymbol(symbol) {
      openDrawer(symbol.name, '<div class="repo-tree-empty">Loading symbol definition…</div>');
      fetch('/api/indexes/' + encodeURIComponent(activeIndexUid) + '/source?path=' + encodeURIComponent(symbol.filePath))
        .then(function(response) { if (!response.ok) throw new Error('Could not load source (' + response.status + ')'); return response.json(); })
        .then(function(source) {
          var body = el('drawer-body'); body.textContent = '';
          var layout = document.createElement('div'); layout.className = 'file-inspect-layout';
          var meta = document.createElement('div'); meta.className = 'file-meta-grid';
          var parent = symbol.parentId ? indexedSymbolsById.get(symbol.parentId) : null;
          [['Kind', symbol.kind], ['File', symbol.filePath], ['Start line', String(symbol.startLine)], ['End line', String(symbol.endLine)], ['Columns', symbol.startColumn + '–' + symbol.endColumn], ['Parent', parent ? parent.name : (symbol.parentId || 'Top-level')], ['Symbol ID', symbol.id]].forEach(function(entry) {
            var item = document.createElement('div'); item.className = 'file-meta-item';
            var label = document.createElement('small'); label.textContent = entry[0];
            var value = document.createElement('strong'); value.textContent = entry[1]; value.title = entry[1];
            item.append(label, value); meta.appendChild(item);
          });
          var toolbar = document.createElement('div'); toolbar.className = 'file-inspect-toolbar';
          var heading = document.createElement('strong'); heading.textContent = 'Definition preview'; heading.style.fontSize = '12px';
          var jump = document.createElement('button'); jump.type = 'button'; jump.className = 'btn-ide'; jump.textContent = 'Inspect file';
          jump.addEventListener('click', function() { var file = indexedFiles.find(function(candidate) { return candidate.path === symbol.filePath; }); if (file) inspectIndexedFile(file); });
          toolbar.append(heading, jump);
          var lines = String(source.content || '').split('\n');
          var from = Math.max(0, symbol.startLine - 1);
          var to = Math.min(lines.length, Math.max(symbol.endLine, symbol.startLine + 1));
          var excerpt = lines.slice(from, Math.min(to, from + 100));
          var pre = document.createElement('pre'); pre.className = 'file-source';
          var numberedExcerpt = excerpt.map(function(line, index) { return String(from + index + 1).padStart(4, ' ') + '  ' + line; }).join('\n');
          pre.innerHTML = window.highlightSource ? window.highlightSource(numberedExcerpt, source.language || symbol.filePath.split('.').pop()) : '';
          if (!window.highlightSource) pre.textContent = numberedExcerpt;
          layout.append(meta, toolbar, pre);
          if (to - from > 100) { var note = document.createElement('small'); note.textContent = 'Preview limited to the first 100 lines of this symbol.'; layout.appendChild(note); }
          body.appendChild(layout);
        })
        .catch(function(error) { var body = el('drawer-body'); body.textContent = ''; var message = document.createElement('div'); message.className = 'file-inspect-error'; message.textContent = error.message; body.appendChild(message); });
    }

    function renderSymbolsTable() {
      var tbody = el('symbols-table-body'); tbody.textContent = '';
      var query = (el('symbol-filter').value || '').trim().toLowerCase();
      var kind = el('symbol-kind-filter').value;
      var filtered = indexedSymbols.filter(function(symbol) {
        return (!kind || symbol.kind === kind) && (!query || symbol.name.toLowerCase().includes(query) || symbol.filePath.toLowerCase().includes(query) || symbol.kind.toLowerCase().includes(query));
      });
      el('symbols-count').textContent = filtered.length + ' of ' + indexedSymbols.length + ' symbols';
      filtered.forEach(function(symbol) {
        var row = document.createElement('tr');
        var name = document.createElement('td'); var strong = document.createElement('strong'); strong.textContent = symbol.name; name.appendChild(strong);
        var kindCell = document.createElement('td'); var badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = symbol.kind; kindCell.appendChild(badge);
        var file = document.createElement('td'); file.className = 'file-path-cell'; file.textContent = symbol.filePath;
        var line = document.createElement('td'); line.textContent = symbol.startLine === symbol.endLine ? String(symbol.startLine) : symbol.startLine + '–' + symbol.endLine;
        var parentCell = document.createElement('td'); var parent = symbol.parentId ? indexedSymbolsById.get(symbol.parentId) : null; parentCell.textContent = parent ? parent.name : '—';
        var actions = document.createElement('td'); var inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'btn-ide file-inspect-btn'; inspect.textContent = 'Inspect'; inspect.addEventListener('click', function() { inspectIndexedSymbol(symbol); }); actions.appendChild(inspect);
        row.append(name, kindCell, file, line, parentCell, actions); tbody.appendChild(row);
      });
      if (!filtered.length) { var row = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 6; cell.textContent = indexedSymbols.length ? 'No symbols match this filter.' : 'No symbols found. Check that the indexed languages have parser support.'; cell.style.textAlign = 'center'; cell.style.padding = '28px'; row.appendChild(cell); tbody.appendChild(row); }
    }

    el('symbol-filter').addEventListener('input', renderSymbolsTable);
    el('symbol-kind-filter').addEventListener('change', renderSymbolsTable);

    function renderFilesTable(files) {
      var tbody = el('files-table-body'); tbody.textContent = '';
      var query = (el('file-filter').value || '').trim().toLowerCase();
      var filtered = files.filter(function(file) {
        return !query || file.path.toLowerCase().includes(query) || file.language.toLowerCase().includes(query) || (file.terms || []).some(function(term) { return term.toLowerCase().includes(query); });
      });
      el('files-count').textContent = filtered.length + ' of ' + files.length + ' indexed files';
      filtered.forEach(function(file) {
        var row = document.createElement('tr');
        var pathCell = document.createElement('td'); pathCell.className = 'file-path-cell'; pathCell.textContent = file.path;
        var languageCell = document.createElement('td'); var language = document.createElement('span'); language.className = 'file-language-cell';
        var icon = document.createElement('span'); icon.innerHTML = languageIconFor(file.language || '');
        var label = document.createElement('span'); label.className = 'badge'; label.textContent = file.language || 'Unknown';
        language.append(icon, label); languageCell.appendChild(language);
        var sizeCell = document.createElement('td'); sizeCell.textContent = formatFileSize(file.size);
        var termsCell = document.createElement('td'); termsCell.textContent = String((file.terms || []).length);
        var modifiedCell = document.createElement('td'); modifiedCell.textContent = formatFileDate(file.modifiedAt);
        var actionCell = document.createElement('td'); var inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'btn-ide file-inspect-btn'; inspect.textContent = 'Inspect'; inspect.addEventListener('click', function() { inspectIndexedFile(file); }); actionCell.appendChild(inspect);
        row.append(pathCell, languageCell, sizeCell, termsCell, modifiedCell, actionCell); tbody.appendChild(row);
      });
      if (!filtered.length) {
        var empty = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 6; cell.textContent = files.length ? 'No files match this filter.' : 'No indexed files found.'; cell.style.textAlign = 'center'; cell.style.padding = '28px'; empty.appendChild(cell); tbody.appendChild(empty);
      }
    }

    el('file-filter').addEventListener('input', function() { renderFilesTable(indexedFiles); });

    function renderRepositoryTree(files) {
      var host = el('repository-tree');
      host.replaceChildren();
      if (!files || !files.length) {
        var empty = document.createElement('div');
        empty.className = 'repo-tree-empty';
        empty.textContent = 'No indexed files in this repository yet.';
        host.appendChild(empty);
        return;
      }
      var root = { name: '.', folders: new Map(), files: [] };
      files.forEach(function(file) {
        var parts = String(file.path || '').replace(/\\/g, '/').split('/').filter(Boolean);
        if (!parts.length) return;
        var node = root;
        parts.slice(0, -1).forEach(function(part) {
          if (!node.folders.has(part)) node.folders.set(part, { name: part, folders: new Map(), files: [] });
          node = node.folders.get(part);
        });
        node.files.push(file);
      });
      var toolbar = document.createElement('div');
      toolbar.className = 'repo-tree-toolbar';
      var heading = document.createElement('strong');
      heading.textContent = 'Workspace files';
      var count = document.createElement('span');
      count.textContent = files.length + ' indexed files';
      toolbar.append(heading, count);
      host.appendChild(toolbar);
      function makeList(node) {
        var list = document.createElement('ul');
        list.className = 'repo-tree-list';
        var folders = Array.from(node.folders.values()).sort(function(a,b) { return a.name.localeCompare(b.name); });
        folders.forEach(function(folder) {
          var item = document.createElement('li');
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'repo-tree-row folder';
          row.setAttribute('aria-expanded', 'true');
          var icon = document.createElement('span');
          icon.innerHTML = '${iconSvg(FolderOpen, 15)}';
          var label = document.createElement('span');
          label.className = 'repo-tree-name';
          label.textContent = folder.name;
          var folderCount = document.createElement('span');
          folderCount.className = 'repo-tree-count';
          folderCount.textContent = countFiles(folder) + '';
          row.append(icon, label, folderCount);
          var children = makeList(folder);
          row.addEventListener('click', function() {
            var expanded = row.getAttribute('aria-expanded') === 'true';
            row.setAttribute('aria-expanded', String(!expanded));
            children.hidden = expanded;
            icon.innerHTML = expanded ? '${iconSvg(Folder, 15)}' : '${iconSvg(FolderOpen, 15)}';
          });
          item.append(row, children);
          list.appendChild(item);
        });
        node.files.slice().sort(function(a,b) { return a.path.localeCompare(b.path); }).forEach(function(file) {
          var item = document.createElement('li');
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'repo-tree-row file';
          var icon = document.createElement('span');
          icon.innerHTML = languageIconFor(file.language || file.path.split('.').pop() || 'file');
          var label = document.createElement('span');
          label.className = 'repo-tree-name';
          label.textContent = file.path.split('/').pop();
          label.title = file.path + ' · ' + (file.language || 'Unknown language');
          row.append(icon, label);
          row.addEventListener('click', function() { inspectIndexedFile(file); });
          item.appendChild(row);
          list.appendChild(item);
        });
        return list;
      }
      function countFiles(node) {
        var total = node.files.length;
        node.folders.forEach(function(folder) { total += countFiles(folder); });
        return total;
      }
      host.appendChild(makeList(root));
    }

    async function loadAllPanels(uid) {
      // Memory
      fetch('/api/system/memory').then(r => r.json()).then(data => {
        el('overview-memory').innerHTML =
          '<div class="stat-card"><div class="stat-val">' + data.rssMb + ' MB</div><div class="stat-lbl">Process RSS</div></div>' +
          '<div class="stat-card"><div class="stat-val">' + data.heapUsedMb + ' MB</div><div class="stat-lbl">Heap Used</div></div>';
      });

      // Files
      fetch('/api/indexes/' + uid + '/files').then(r => { if (!r.ok) throw new Error('Could not load indexed files (' + r.status + ')'); return r.json(); }).then(data => {
        renderRepositoryTree(data.files || []);
        indexedFiles = data.files || [];
        activeIndexUid = uid;
        renderFilesTable(indexedFiles);
      }).catch(function(error) {
        var host = el('repository-tree');
        host.textContent = '';
        var message = document.createElement('div');
        message.className = 'repo-tree-error';
        message.textContent = 'Repository tree could not be loaded: ' + error.message;
        host.appendChild(message);
      });

      // Symbols
      fetch('/api/indexes/' + uid + '/symbols').then(function(response) { if (!response.ok) throw new Error('Could not load symbols (' + response.status + ')'); return response.json(); }).then(function(data) {
        indexedSymbols = data.symbols || [];
        indexedSymbolsById = new Map(indexedSymbols.map(function(symbol) { return [symbol.id, symbol]; }));
        var kinds = Array.from(new Set(indexedSymbols.map(function(symbol) { return symbol.kind; }))).sort();
        var selector = el('symbol-kind-filter');
        selector.textContent = '';
        var all = document.createElement('option'); all.value = ''; all.textContent = 'All kinds'; selector.appendChild(all);
        kinds.forEach(function(kind) { var option = document.createElement('option'); option.value = kind; option.textContent = kind.charAt(0).toUpperCase() + kind.slice(1); selector.appendChild(option); });
        renderSymbolsTable();
      }).catch(function(error) {
        indexedSymbols = [];
        indexedSymbolsById = new Map();
        el('symbols-count').textContent = 'Could not load symbols';
        var body = el('symbols-table-body'); body.textContent = '';
        var row = document.createElement('tr'); var cell = document.createElement('td'); cell.colSpan = 6; cell.textContent = error.message; cell.style.color = 'var(--md-error)'; row.appendChild(cell); body.appendChild(row);
      });

      // Architecture dependency graph
      loadDependencies(uid);

      // Stored semantic chunks
      loadChunks(uid, true);

      // References and relation inventory
      loadReferences(uid);

      // Intelligence & Areas
      fetch('/api/indexes/' + uid + '/intelligence').then(r => r.json()).then(data => {
        var areas = data.repositoryMap ? data.repositoryMap.areas || [] : [];
        el('overview-areas').innerHTML = areas.slice(0, 8).map(a => '<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border); font-family:var(--mono);"><span>' + a.path + '</span><span>' + a.files + ' files</span></div>').join('');
      });

      // APIs
      fetch('/api/indexes/' + uid + '/intelligence').then(r => r.json()).then(data => {
        var apis = data.apiEndpoints || [];
        var tbody = el('apis-table-body');
        tbody.innerHTML = apis.length ? apis.map(a => '<tr><td><span class="badge">' + a.method + '</span></td><td>' + a.path + '</td><td>' + a.fileId + '</td><td>' + a.startLine + '</td></tr>').join('') : '<tr><td colspan="4">No API endpoints detected</td></tr>';
      });

      // Database
      fetch('/api/indexes/' + uid + '/database').then(r => r.json()).then(data => {
        var models = data.models || [];
        el('database-table-body').innerHTML = models.length ? models.map(m => '<tr><td>' + m.name + '</td><td><span class="badge">' + m.kind + '</span></td><td>' + m.filePath + '</td></tr>').join('') : '<tr><td colspan="3">No database schemas detected</td></tr>';
      });

      // Tests
      fetch('/api/indexes/' + uid + '/tests').then(r => r.json()).then(data => {
        var tests = data.tests || [];
        el('tests-table-body').innerHTML = tests.length ? tests.map(t => '<tr><td>' + t.testFile + '</td><td><span class="badge">' + t.framework + '</span></td><td>' + t.testSymbol + '</td><td>' + (t.targetSymbol || '—') + '</td></tr>').join('') : '<tr><td colspan="4">No tests detected</td></tr>';
      });

      // Git
      fetch('/api/indexes/' + uid + '/git').then(r => r.json()).then(data => {
        el('top-branch').textContent = data.branch || 'main';
        var commits = data.commits || [];
        el('git-table-body').innerHTML = commits.length ? commits.map(c => '<tr><td>' + c.hash + '</td><td>' + c.author + '</td><td>' + c.date + '</td><td>' + c.subject + '</td></tr>').join('') : '<tr><td colspan="4">No git commits available</td></tr>';
        var changed = data.changedFiles || [];
        el('changes-table-body').innerHTML = changed.length ? changed.map(c => '<tr><td><span class="badge">' + c.code + '</span></td><td>' + c.filePath + '</td></tr>').join('') : '<tr><td colspan="2">Working tree clean</td></tr>';
      });

      // Complexity
      fetch('/api/indexes/' + uid + '/complexity').then(r => r.json()).then(data => {
        var files = data.mostComplexFiles || [];
        el('complexity-table-body').innerHTML = files.map(f => '<tr><td>' + f.path + '</td><td>' + f.language + '</td><td>' + f.loc + '</td><td>' + f.cyclomaticEstimate + '</td><td>' + f.fanIn + '</td><td>' + f.fanOut + '</td></tr>').join('');
      });

      // Security
      fetch('/api/indexes/' + uid + '/security').then(r => r.json()).then(data => {
        var findings = data.findings || [];
        el('security-table-body').innerHTML = findings.length ? findings.map(f => '<tr><td><span class="badge">' + f.kind + '</span></td><td>' + f.filePath + ':' + f.line + '</td><td>' + f.confidence + '</td><td>[REDACTED]</td></tr>').join('') : '<tr><td colspan="4">No security findings detected</td></tr>';
      });

      // Health
      fetch('/api/indexes/' + uid + '/health').then(r => r.json()).then(data => {
        el('health-report').innerHTML = '<div>Status: <strong>' + data.status + '</strong></div><div>Files Checked: ' + data.totalFiles + '</div><div>Broken References: ' + data.brokenReferencesCount + '</div>';
      });

      // Inspector
      fetch('/api/indexes/' + uid + '/inspect').then(r => r.json()).then(data => {
        el('inspector-stats').innerHTML =
          '<div class="stat-card"><div class="stat-val">' + data.magic + '</div><div class="stat-lbl">Magic Header</div></div>' +
          '<div class="stat-card"><div class="stat-val">v' + data.version + '</div><div class="stat-lbl">Version</div></div>' +
          '<div class="stat-card"><div class="stat-val">' + data.fileSize + ' B</div><div class="stat-lbl">Index File Size</div></div>';
      });
    }

    // Theme toggling in settings
    document.querySelectorAll('[data-set-theme]').forEach(b => {
      b.addEventListener('click', () => applyTheme(b.getAttribute('data-set-theme')));
    });

    el('btn-theme-toggle').addEventListener('click', () => {
      var current = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    loadData();
  </script>
</body>
</html>`;
