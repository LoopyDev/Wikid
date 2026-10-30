import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CollabMaterializerService } from '../collab/collab-materializer.service';
import { editorDocFromYjsState } from '../collab/collab-doc.util';
import { isUuid } from '../utils/uuid.util';
import * as fs from 'fs';
import * as path from 'path';

interface PageRecord {
  id: string;
  title: string;
  icon: string | null;
  content: any;
  parentId: string | null;
  kind: string;
  children?: PageRecord[];
}

const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICONS_DIR = path.join(__dirname, '..', '..', 'web', 'src', 'icons');
const svgCache = new Map<string, string>();

function loadSvg(name: string): string | null {
  if (svgCache.has(name)) return svgCache.get(name)!;
  try {
    const svg = fs.readFileSync(path.join(ICONS_DIR, `${name}.svg`), 'utf-8');
    svgCache.set(name, svg);
    return svg;
  } catch {
    svgCache.set(name, '');
    return null;
  }
}

function renderIcon(value: string | null | undefined, cssClass = 'nav-icon'): string {
  if (!value) return '';
  if (value.startsWith('icon:')) {
    const [id, color] = value.split('|');
    const name = id.replace('icon:', '');
    let svg = loadSvg(name);
    if (!svg) return '';
    if (color) svg = svg.replace(/currentColor/g, color);
    return `<span class="${esc(cssClass)}">${svg}</span>`;
  }
  return `<span class="${esc(cssClass)}">${esc(value)}</span>`;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

// --- Syntax highlighting ---

const KEYWORDS_JS = new Set('abstract,async,await,break,case,catch,class,const,continue,debugger,default,delete,do,else,enum,export,extends,finally,for,from,function,get,if,import,implements,in,instanceof,interface,let,new,of,package,private,protected,public,return,set,static,super,switch,this,throw,try,typeof,var,void,while,with,yield'.split(','));
const KEYWORDS_PY = new Set('False,None,True,and,as,assert,async,await,break,class,continue,def,del,elif,else,except,finally,for,from,global,if,import,in,is,lambda,nonlocal,not,or,pass,raise,return,try,while,with,yield'.split(','));
const KEYWORDS_SQL = new Set('select,from,where,insert,into,update,set,delete,create,drop,alter,table,index,view,join,inner,left,right,outer,on,and,or,not,null,is,in,like,between,exists,having,group,by,order,asc,desc,limit,offset,union,all,as,distinct,case,when,then,else,end,primary,key,foreign,references,constraint,values,default,int,integer,varchar,text,boolean,date,timestamp,float,double,decimal'.split(','));
const KEYWORDS_RUST = new Set('as,async,await,break,const,continue,crate,dyn,else,enum,extern,false,fn,for,if,impl,in,let,loop,match,mod,move,mut,pub,ref,return,self,Self,static,struct,super,trait,true,type,unsafe,use,where,while'.split(','));
const KEYWORDS_GO = new Set('break,case,chan,const,continue,default,defer,else,fallthrough,for,func,go,goto,if,import,interface,map,package,range,return,select,struct,switch,type,var'.split(','));
const KEYWORDS_JAVA = new Set('abstract,assert,boolean,break,byte,case,catch,char,class,const,continue,default,do,double,else,enum,extends,final,finally,float,for,goto,if,implements,import,instanceof,int,interface,long,native,new,package,private,protected,public,return,short,static,strictfp,super,switch,synchronized,this,throw,throws,transient,try,void,volatile,while'.split(','));
const KEYWORDS_CSS = new Set('important,inherit,initial,unset,none,auto,block,inline,flex,grid,absolute,relative,fixed,sticky,hidden,visible,solid,dashed,dotted,normal,bold,italic'.split(','));
const KEYWORDS_HTML = null; // HTML uses tag-based highlighting instead

const BUILTINS_JS = new Set('console,window,document,Math,JSON,Promise,Array,Object,String,Number,Boolean,Date,RegExp,Map,Set,Error,parseInt,parseFloat,isNaN,undefined,null,true,false,NaN,Infinity'.split(','));
const BUILTINS_PY = new Set('print,len,range,int,str,float,list,dict,set,tuple,bool,type,isinstance,hasattr,getattr,setattr,input,open,map,filter,zip,enumerate,sorted,reversed,any,all,min,max,sum,abs,round,None,True,False,self,cls'.split(','));

type LangProfile = { keywords: Set<string> | null; builtins?: Set<string>; hashComments?: boolean; htmlLike?: boolean; cssLike?: boolean };

function getLangProfile(lang: string): LangProfile {
  const l = lang.toLowerCase();
  if (['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx'].includes(l))
    return { keywords: KEYWORDS_JS, builtins: BUILTINS_JS };
  if (['py', 'python'].includes(l))
    return { keywords: KEYWORDS_PY, builtins: BUILTINS_PY, hashComments: true };
  if (['rb', 'ruby'].includes(l))
    return { keywords: KEYWORDS_PY, hashComments: true }; // close enough
  if (['sql'].includes(l))
    return { keywords: KEYWORDS_SQL };
  if (['rust', 'rs'].includes(l))
    return { keywords: KEYWORDS_RUST };
  if (['go', 'golang'].includes(l))
    return { keywords: KEYWORDS_GO };
  if (['java', 'kotlin', 'kt', 'scala', 'c', 'cpp', 'c++', 'cs', 'csharp', 'swift'].includes(l))
    return { keywords: KEYWORDS_JAVA };
  if (['html', 'xml', 'svg', 'vue'].includes(l))
    return { keywords: KEYWORDS_HTML, htmlLike: true };
  if (['css', 'scss', 'less'].includes(l))
    return { keywords: KEYWORDS_CSS, cssLike: true };
  if (['sh', 'bash', 'zsh', 'shell'].includes(l))
    return { keywords: new Set('if,then,else,elif,fi,for,while,do,done,case,esac,in,function,return,exit,export,local,readonly,shift,break,continue'.split(',')), hashComments: true };
  if (['yaml', 'yml', 'toml', 'ini', 'conf'].includes(l))
    return { keywords: new Set('true,false,null,yes,no,on,off'.split(',')), hashComments: true };
  if (['json', 'jsonc'].includes(l))
    return { keywords: new Set('true,false,null'.split(',')) };
  return { keywords: KEYWORDS_JS, builtins: BUILTINS_JS }; // default fallback
}

function highlightCode(raw: string, lang: string): string {
  if (!raw) return '';
  const profile = getLangProfile(lang);

  if (profile.htmlLike) return highlightHtml(raw);
  if (profile.cssLike) return highlightCss(raw);

  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    // Line comments
    if (raw[i] === '/' && raw[i + 1] === '/') {
      const end = raw.indexOf('\n', i);
      const slice = end < 0 ? raw.slice(i) : raw.slice(i, end);
      tokens.push(`<span class="hl-comment">${esc(slice)}</span>`);
      i += slice.length;
      continue;
    }
    // Hash comments
    if (profile.hashComments && raw[i] === '#') {
      const end = raw.indexOf('\n', i);
      const slice = end < 0 ? raw.slice(i) : raw.slice(i, end);
      tokens.push(`<span class="hl-comment">${esc(slice)}</span>`);
      i += slice.length;
      continue;
    }
    // Block comments
    if (raw[i] === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2);
      const slice = end < 0 ? raw.slice(i) : raw.slice(i, end + 2);
      tokens.push(`<span class="hl-comment">${esc(slice)}</span>`);
      i += slice.length;
      continue;
    }
    // Strings
    if (raw[i] === '"' || raw[i] === "'" || raw[i] === '`') {
      const quote = raw[i];
      let j = i + 1;
      while (j < raw.length && raw[j] !== quote) {
        if (raw[j] === '\\') j++; // skip escaped char
        j++;
      }
      if (j < raw.length) j++; // include closing quote
      tokens.push(`<span class="hl-string">${esc(raw.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Numbers
    if (/[0-9]/.test(raw[i]) && (i === 0 || /[\s,;:=+\-*/<>(&|![\]{}^~%?]/.test(raw[i - 1]))) {
      let j = i;
      while (j < raw.length && /[0-9a-fA-FxXoObB._eE+\-n]/.test(raw[j])) j++;
      tokens.push(`<span class="hl-number">${esc(raw.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Words (keywords, builtins, identifiers)
    if (/[a-zA-Z_$@]/.test(raw[i])) {
      let j = i;
      while (j < raw.length && /[a-zA-Z0-9_$]/.test(raw[j])) j++;
      const word = raw.slice(i, j);
      if (profile.keywords?.has(word)) {
        tokens.push(`<span class="hl-keyword">${esc(word)}</span>`);
      } else if (profile.builtins?.has(word)) {
        tokens.push(`<span class="hl-builtin">${esc(word)}</span>`);
      } else if (j < raw.length && raw[j] === '(') {
        tokens.push(`<span class="hl-func">${esc(word)}</span>`);
      } else {
        tokens.push(esc(word));
      }
      i = j;
      continue;
    }
    // Operators & punctuation
    if (/[+\-*/%=<>!&|^~?]/.test(raw[i])) {
      let j = i;
      while (j < raw.length && /[+\-*/%=<>!&|^~?]/.test(raw[j])) j++;
      tokens.push(`<span class="hl-op">${esc(raw.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Decorators (@)
    if (raw[i] === '@' && i + 1 < raw.length && /[a-zA-Z]/.test(raw[i + 1])) {
      let j = i + 1;
      while (j < raw.length && /[a-zA-Z0-9_]/.test(raw[j])) j++;
      tokens.push(`<span class="hl-keyword">${esc(raw.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    tokens.push(esc(raw[i]));
    i++;
  }
  return tokens.join('');
}

function highlightHtml(raw: string): string {
  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    // Comments
    if (raw.startsWith('<!--', i)) {
      const end = raw.indexOf('-->', i + 4);
      const slice = end < 0 ? raw.slice(i) : raw.slice(i, end + 3);
      tokens.push(`<span class="hl-comment">${esc(slice)}</span>`);
      i += slice.length;
      continue;
    }
    // Tags
    if (raw[i] === '<') {
      const end = raw.indexOf('>', i);
      if (end >= 0) {
        const tag = raw.slice(i, end + 1);
        tokens.push(highlightHtmlTag(tag));
        i = end + 1;
        continue;
      }
    }
    // Text between tags
    let j = i;
    while (j < raw.length && raw[j] !== '<') j++;
    if (j > i) {
      tokens.push(esc(raw.slice(i, j)));
      i = j;
    } else {
      tokens.push(esc(raw[i]));
      i++;
    }
  }
  return tokens.join('');
}

function highlightHtmlTag(tag: string): string {
  // Match tag name and attributes
  const m = tag.match(/^(<\/?)([a-zA-Z][a-zA-Z0-9-]*)/);
  if (!m) return esc(tag);
  let result = `<span class="hl-op">${esc(m[1])}</span><span class="hl-keyword">${esc(m[2])}</span>`;
  let rest = tag.slice(m[0].length);
  // Attributes
  const attrRe = /(\s+)([a-zA-Z][a-zA-Z0-9-:@.]*)(?:(=)("[^"]*"|'[^']*'|[^\s>]*))?/g;
  let lastIdx = 0;
  let am;
  while ((am = attrRe.exec(rest)) !== null) {
    if (am.index > lastIdx) result += esc(rest.slice(lastIdx, am.index));
    result += am[1]; // whitespace
    result += `<span class="hl-builtin">${esc(am[2])}</span>`;
    if (am[3]) {
      result += `<span class="hl-op">=</span>`;
      result += `<span class="hl-string">${esc(am[4])}</span>`;
    }
    lastIdx = am.index + am[0].length;
  }
  if (lastIdx < rest.length) result += esc(rest.slice(lastIdx));
  return result;
}

function highlightCss(raw: string): string {
  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    // Comments
    if (raw[i] === '/' && raw[i + 1] === '*') {
      const end = raw.indexOf('*/', i + 2);
      const slice = end < 0 ? raw.slice(i) : raw.slice(i, end + 2);
      tokens.push(`<span class="hl-comment">${esc(slice)}</span>`);
      i += slice.length;
      continue;
    }
    // Strings
    if (raw[i] === '"' || raw[i] === "'") {
      const quote = raw[i];
      let j = i + 1;
      while (j < raw.length && raw[j] !== quote) { if (raw[j] === '\\') j++; j++; }
      if (j < raw.length) j++;
      tokens.push(`<span class="hl-string">${esc(raw.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Properties (word before colon)
    if (/[a-zA-Z-]/.test(raw[i])) {
      let j = i;
      while (j < raw.length && /[a-zA-Z0-9-_]/.test(raw[j])) j++;
      const word = raw.slice(i, j);
      // Check if followed by colon (CSS property)
      let k = j;
      while (k < raw.length && raw[k] === ' ') k++;
      if (raw[k] === ':' && raw[k + 1] !== ':') {
        tokens.push(`<span class="hl-builtin">${esc(word)}</span>`);
      } else if (/^[.#@]/.test(raw[i - 1] || '')) {
        tokens.push(`<span class="hl-keyword">${esc(word)}</span>`);
      } else if (KEYWORDS_CSS!.has(word)) {
        tokens.push(`<span class="hl-keyword">${esc(word)}</span>`);
      } else {
        tokens.push(esc(word));
      }
      i = j;
      continue;
    }
    // Selectors: . # @
    if (/[.#@]/.test(raw[i]) && i + 1 < raw.length && /[a-zA-Z_-]/.test(raw[i + 1])) {
      tokens.push(`<span class="hl-keyword">${esc(raw[i])}</span>`);
      i++;
      continue;
    }
    // Numbers + units
    if (/[0-9]/.test(raw[i])) {
      let j = i;
      while (j < raw.length && /[0-9.]/.test(raw[j])) j++;
      while (j < raw.length && /[a-zA-Z%]/.test(raw[j])) j++; // units
      tokens.push(`<span class="hl-number">${esc(raw.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    // Colors
    if (raw[i] === '#' && /[0-9a-fA-F]/.test(raw[i + 1] || '')) {
      let j = i + 1;
      while (j < raw.length && /[0-9a-fA-F]/.test(raw[j])) j++;
      tokens.push(`<span class="hl-number">${esc(raw.slice(i, j))}</span>`);
      i = j;
      continue;
    }
    tokens.push(esc(raw[i]));
    i++;
  }
  return tokens.join('');
}

@Injectable()
export class HtmlExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly materializer: CollabMaterializerService,
  ) {}

  async exportPageTree(
    rootId: string,
    options: { mode?: 'scroll' | 'pages'; excludeIds?: string[] } = {},
  ): Promise<{ html: string; filename: string }> {
    const { mode = 'scroll', excludeIds = [] } = options;
    const excludeSet = new Set(excludeIds);

    const root = await this.prisma.page.findUniqueOrThrow({
      where: { id: rootId },
      select: { id: true, title: true, icon: true, content: true, parentId: true, kind: true, workspaceId: true },
    });

    const allPages = await this.prisma.page.findMany({
      where: { workspaceId: root.workspaceId, isDeleted: false },
      select: { id: true, title: true, icon: true, content: true, parentId: true, kind: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    const filtered = excludeSet.size
      ? allPages.filter((p) => !excludeSet.has(p.id))
      : allPages;

    const tree = this.buildTree(root.id, filtered);
    const flat = this.flattenTree(tree);
    await this.flushAndMaterializeDatabases(flat, root.workspaceId);
    const databases = await this.loadDatabases(flat);
    await this.resolveCollabContent(flat, root.workspaceId, databases);
    const rowPageIds = this.collectRowPageIds(databases);
    const renderFlat = flat.filter((p) => !rowPageIds.has(p.id));
    this.pruneTree(tree, rowPageIds);
    const imageUrls = this.collectImageUrls(renderFlat, databases);
    let html = mode === 'pages'
      ? this.renderDocumentPaged(tree, renderFlat, databases)
      : this.renderDocument(tree, renderFlat, databases);
    html = await this.embedImages(html, imageUrls);
    const filename = `${(root.title || 'export').replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    return { html, filename };
  }

  async exportWorkspace(
    workspaceId: string,
    options: { mode?: 'scroll' | 'pages'; excludeIds?: string[] } = {},
  ): Promise<{ html: string; filename: string }> {
    const { mode = 'scroll', excludeIds = [] } = options;
    const excludeSet = new Set(excludeIds);

    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, name: true },
    });

    const allPages = await this.prisma.page.findMany({
      where: { workspaceId, isDeleted: false },
      select: { id: true, title: true, icon: true, content: true, parentId: true, kind: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    const filtered = excludeSet.size
      ? allPages.filter((p) => !excludeSet.has(p.id))
      : allPages;

    // Create a virtual root that contains all top-level pages
    const virtualRoot: PageRecord = {
      id: '__workspace__',
      title: ws.name || 'Workspace',
      icon: null,
      content: null,
      parentId: null,
      kind: 'DOC',
      children: [],
    };

    const tree = this.buildForest(virtualRoot, filtered);
    const flat = this.flattenTree(tree);
    // Skip the virtual root in the flat list for rendering
    const withoutVirtual = flat.filter((p) => p.id !== '__workspace__');
    await this.flushAndMaterializeDatabases(withoutVirtual, workspaceId);
    const databases = await this.loadDatabases(withoutVirtual);
    await this.resolveCollabContent(withoutVirtual, workspaceId, databases);
    const rowPageIds = this.collectRowPageIds(databases);
    const renderFlat = withoutVirtual.filter((p) => !rowPageIds.has(p.id));
    this.pruneTree(tree, rowPageIds);
    const imageUrls = this.collectImageUrls(renderFlat, databases);
    let html = mode === 'pages'
      ? this.renderDocumentPaged(tree, renderFlat, databases)
      : this.renderDocument(tree, renderFlat, databases);
    html = await this.embedImages(html, imageUrls);
    const filename = `${(ws.name || 'workspace').replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    return { html, filename };
  }

  private buildTree(rootId: string, pages: PageRecord[]): PageRecord {
    const byId = new Map(pages.map((p) => [p.id, { ...p, children: [] as PageRecord[] }]));
    const root = byId.get(rootId);
    if (!root) throw new Error('Root page not found');
    for (const page of Array.from(byId.values())) {
      if (page.id === rootId) continue;
      const parent = page.parentId ? byId.get(page.parentId) : null;
      if (parent) parent.children!.push(page);
    }
    // Only keep descendants of root
    const prune = (node: PageRecord): PageRecord => ({
      ...node,
      children: (node.children || []).map(prune),
    });
    return prune(root);
  }

  private buildForest(virtualRoot: PageRecord, pages: PageRecord[]): PageRecord {
    const byId = new Map(pages.map((p) => [p.id, { ...p, children: [] as PageRecord[] }]));
    const topLevel: PageRecord[] = [];
    for (const page of Array.from(byId.values())) {
      const parent = page.parentId ? byId.get(page.parentId) : null;
      if (parent) {
        parent.children!.push(page);
      } else {
        topLevel.push(page);
      }
    }
    return { ...virtualRoot, children: topLevel };
  }

  private flattenTree(node: PageRecord): PageRecord[] {
    const result: PageRecord[] = [node];
    for (const child of node.children || []) {
      result.push(...this.flattenTree(child));
    }
    return result;
  }

  private collectRowPageIds(databases: Map<string, any>): Set<string> {
    const ids = new Set<string>();
    for (const db of Array.from(databases.values())) {
      for (const row of db.rows || []) {
        if (row.pageId) ids.add(row.pageId);
      }
    }
    return ids;
  }

  private pruneTree(node: PageRecord, excludeIds: Set<string>): void {
    if (!node.children) return;
    node.children = node.children.filter((c) => !excludeIds.has(c.id));
    for (const child of node.children) this.pruneTree(child, excludeIds);
  }

  private async loadDatabases(pages: PageRecord[]): Promise<Map<string, any>> {
    const dbPageIds = pages.filter((p) => p.kind === 'DATABASE').map((p) => p.id);
    if (!dbPageIds.length) return new Map();
    const databases = await this.prisma.database.findMany({
      where: { pageId: { in: dbPageIds } },
      include: {
        fields: { orderBy: { position: 'asc' } },
        rows: {
          orderBy: { position: 'asc' },
          include: { page: { select: { id: true, content: true } } },
        },
      },
    });
    // Person columns hold user ids: look up the names they're shown with
    const personIds = new Set<string>();
    for (const db of databases) {
      const personFieldIds = db.fields.filter((field) => field.type === 'PERSON').map((field) => field.id);
      if (!personFieldIds.length) continue;
      for (const row of db.rows) {
        if (row.createdById) personIds.add(row.createdById);
        const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : {};
        for (const fieldId of personFieldIds) {
          for (const id of Array.isArray(data[fieldId]) ? data[fieldId] : []) if (isUuid(String(id))) personIds.add(String(id));
        }
      }
    }
    // Only the names of people in these databases' workspaces (a cell could hold anyone's id)
    const workspaceIds = [...new Set(databases.map((db) => db.workspaceId))];
    const people = personIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...personIds] }, memberships: { some: { workspaceId: { in: workspaceIds } } } },
          select: { id: true, displayName: true },
        })
      : [];
    const personNames = new Map(people.map((person) => [person.id, person.displayName]));
    const map = new Map<string, any>();
    for (const db of databases) map.set(db.pageId, { ...db, personNames });
    return map;
  }

  /**
   * Batch-fetch live Yjs states and return a map of pageId → parsed JSON content.
   */
  private async fetchLiveContent(pageIds: string[], workspaceId: string): Promise<Map<string, any>> {
    if (!pageIds.length) return new Map();
    const docNames = pageIds.map((id) => `ws:${workspaceId}:${id}`);
    // Force-flush collab server's in-memory state to DB first
    await this.materializer.flushLiveDocuments(docNames);
    const collabDocs = await this.prisma.collabDoc.findMany({
      where: { documentName: { in: docNames } },
      select: { documentName: true, state: true },
    });
    const result = new Map<string, any>();
    for (const doc of collabDocs) {
      const pageId = doc.documentName.split(':')[2];
      if (!pageId || !doc.state) continue;
      try {
        result.set(pageId, await editorDocFromYjsState(doc.state));
      } catch {
        // Fall back to materialized content
      }
    }
    return result;
  }

  /**
   * Flush collab server state and materialize database docs so export reads fresh data.
   */
  private async flushAndMaterializeDatabases(pages: PageRecord[], workspaceId: string): Promise<void> {
    const dbPages = pages.filter((p) => p.kind === 'DATABASE');
    if (!dbPages.length) return;
    const dbDocNames = dbPages.map((p) => `ws:${workspaceId}:db:${p.id}`);
    await this.materializer.flushLiveDocuments(dbDocNames);
    await this.materializer.materializeDocuments(dbDocNames);
  }

  /**
   * Resolve live content from CollabDoc Yjs state for DOC pages and row pages,
   * overriding the potentially stale content from Postgres.
   */
  private async resolveCollabContent(
    pages: PageRecord[],
    workspaceId: string,
    databases?: Map<string, any>,
  ): Promise<void> {
    // Collect all page IDs that need live content
    const docPageIds = pages.filter((p) => p.kind === 'DOC').map((p) => p.id);
    const rowPageIds: string[] = [];
    if (databases) {
      for (const db of Array.from(databases.values())) {
        for (const row of db.rows || []) {
          if (row.page?.id) rowPageIds.push(row.page.id);
        }
      }
    }
    const allIds = [...docPageIds, ...rowPageIds];
    if (!allIds.length) return;

    const liveContent = await this.fetchLiveContent(allIds, workspaceId);
    for (const page of pages) {
      const live = liveContent.get(page.id);
      if (live) page.content = live;
    }
    if (databases) {
      for (const db of Array.from(databases.values())) {
        for (const row of db.rows || []) {
          if (row.page?.id) {
            const live = liveContent.get(row.page.id);
            if (live) row.page.content = live;
          }
        }
      }
    }
  }

  private collectImageUrls(pages: PageRecord[], databases: Map<string, any>): Set<string> {
    const urls = new Set<string>();
    const walk = (node: any) => {
      if (!node) return;
      if (node.type === 'image' && node.attrs?.src) {
        const src = node.attrs.src;
        if (src.includes('/uploads/')) urls.add(src);
      }
      if (node.type === 'gaussianSplat' && node.attrs?.src) {
        const src = node.attrs.src;
        if (src.includes('/uploads/')) urls.add(src);
      }
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    for (const page of pages) {
      const doc = this.parseContent(page.content);
      walk(doc);
    }
    for (const db of Array.from(databases.values())) {
      for (const row of db.rows || []) {
        if (row.page?.content) walk(this.parseContent(row.page.content));
      }
    }
    return urls;
  }

  private extractUploadKey(url: string): string | null {
    const marker = '/uploads/';
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    return url.slice(idx + marker.length);
  }

  private async embedImages(html: string, imageUrls: Set<string>): Promise<string> {
    if (!imageUrls.size) return html;
    const replacements = new Map<string, string>();
    await Promise.all(
      Array.from(imageUrls).map(async (url) => {
        const key = this.extractUploadKey(url);
        if (!key) return;
        try {
          const result = await this.uploads.getObject(key);
          const chunks: Buffer[] = [];
          const body = result.Body as unknown as NodeJS.ReadableStream;
          for await (const chunk of body) chunks.push(Buffer.from(chunk));
          const buffer = Buffer.concat(chunks);
          const mime = result.ContentType || 'image/png';
          const b64 = buffer.toString('base64');
          replacements.set(url, `data:${mime};base64,${b64}`);
        } catch {
          // Image not found in S3, leave original URL
        }
      }),
    );
    let result = html;
    for (const [url, dataUri] of replacements) {
      result = result.split(esc(url)).join(dataUri);
    }
    return result;
  }

  private renderDocument(tree: PageRecord, flat: PageRecord[], databases: Map<string, any>): string {
    const pageMap = new Map(flat.map((p) => [p.id, p]));
    const singlePage = flat.length <= 1;
    const sections = flat.map((page) => {
      const body = page.kind === 'DATABASE'
        ? this.renderDatabase(databases.get(page.id), page, pageMap)
        : this.renderContent(page.content, pageMap);
      const icon = renderIcon(page.icon, 'page-icon');
      return `<section id="page-${esc(page.id)}" class="page-section">
  <h1 class="page-title">${icon}${esc(page.title || 'Untitled page')}</h1>
  <div class="page-body">${body}</div>
</section>`;
    }).join('\n');

    const sidebarHtml = singlePage ? '' : `<div class="sidebar-toggle" onclick="document.body.classList.toggle('sidebar-collapsed')" title="Toggle sidebar">&#9776;</div>
<nav class="sidebar" id="sidebar">
  <div class="sidebar-inner">${this.renderNav(tree)}</div>
</nav>
<div class="sidebar-resize"></div>`;

    const sidebarScript = singlePage ? '' : `${JS_RESIZE}
function updateActiveNav() {
  var sections = document.querySelectorAll('.page-section');
  var links = document.querySelectorAll('.sidebar .nav-link');
  var current = '';
  sections.forEach(function(s) {
    if (s.getBoundingClientRect().top <= 80) current = s.id;
  });
  links.forEach(function(a) {
    a.classList.toggle('active', a.getAttribute('href') === '#' + current);
  });
}
document.addEventListener('scroll', updateActiveNav, { passive: true });
window.addEventListener('hashchange', updateActiveNav);
document.querySelectorAll('.sidebar a').forEach(function(a) {
  a.addEventListener('click', function() {
    if (window.innerWidth < 768) document.body.classList.add('sidebar-collapsed');
    setTimeout(updateActiveNav, 50);
  });
});
updateActiveNav();`;
    const scriptHtml = `<script>
${sidebarScript}
${JS_EXT_BUBBLE}
${JS_TOGGLES}
${JS_DB_BACK_LINK}
</script>`;

    const hasSplats = sections.includes('data-splat-src');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tree.title || 'Export')}</title>
${hasSplats ? SPLAT_IMPORTMAP : ''}
<style>${CSS}${singlePage ? '\n.main{margin-left:0}' : ''}</style>
</head>
<body${singlePage ? ' class="sidebar-collapsed"' : ''}>
${sidebarHtml}
<main class="main">${sections}</main>
${scriptHtml}
${hasSplats ? JS_SPLAT_INIT : ''}
</body>
</html>`;
  }

  private renderDocumentPaged(tree: PageRecord, flat: PageRecord[], databases: Map<string, any>): string {
    const pageMap = new Map(flat.map((p) => [p.id, p]));
    const singlePage = flat.length <= 1;
    const sections = flat.map((page) => {
      const body = page.kind === 'DATABASE'
        ? this.renderDatabase(databases.get(page.id), page, pageMap)
        : this.renderContent(page.content, pageMap);
      const icon = renderIcon(page.icon, 'page-icon');
      // Child page links for paged mode
      const children = (page as any).children || [];
      let childLinks = '';
      if (children.length) {
        const items = children.map((c: PageRecord) => {
          const ci = renderIcon(c.icon);
          return `<a href="#page-${esc(c.id)}" class="page-link" onclick="navigateTo('${esc(c.id)}')">${ci}${esc(c.title || 'Untitled page')}</a>`;
        }).join(' ');
        childLinks = `<div class="child-pages">${items}</div>`;
      }
      return `<section id="page-${esc(page.id)}" class="page-section" style="display:none">
  <h1 class="page-title">${icon}${esc(page.title || 'Untitled page')}</h1>
  <div class="page-body">${body}</div>
  ${childLinks}
</section>`;
    }).join('\n');

    const firstId = flat[0]?.id || '';

    const sidebarHtml = singlePage ? '' : `<div class="sidebar-toggle" onclick="document.body.classList.toggle('sidebar-collapsed')" title="Toggle sidebar">&#9776;</div>
<nav class="sidebar" id="sidebar">
  <div class="sidebar-inner">${this.renderNav(tree)}</div>
</nav>
<div class="sidebar-resize"></div>`;

    const hasSplats = sections.includes('data-splat-src');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tree.title || 'Export')}</title>
${hasSplats ? SPLAT_IMPORTMAP : ''}
<style>${CSS}
${CSS_PAGED}${singlePage ? '\n.main{margin-left:0}' : ''}</style>
</head>
<body${singlePage ? ' class="sidebar-collapsed"' : ''}>
${sidebarHtml}
<main class="main">${sections}</main>
<script>
${singlePage ? '' : JS_RESIZE}
${JS_PAGED}
${JS_EXT_BUBBLE}
${JS_TOGGLES}
${JS_DB_BACK_LINK}
navigateTo(location.hash.replace('#page-','') || '${esc(firstId)}');
</script>
${hasSplats ? JS_SPLAT_INIT : ''}
</body>
</html>`;
  }

  private renderNav(node: PageRecord, depth = 0): string {
    const icon = renderIcon(node.icon);
    const title = esc(node.title || 'Untitled page');
    const link = `<a href="#page-${esc(node.id)}" class="nav-link" style="padding-left:${12 + depth * 16}px">${icon}${title}</a>`;
    const children = (node.children || [])
      .map((c) => this.renderNav(c, depth + 1))
      .join('');
    return link + children;
  }

  // --- Tiptap JSON to HTML ---

  private renderContent(content: any, pageMap: Map<string, PageRecord>): string {
    const doc = this.parseContent(content);
    const nodes: any[] = Array.isArray(doc?.content) ? doc.content : [];
    return nodes.map((n) => this.renderNode(n, pageMap)).join('\n');
  }

  private parseContent(raw: any): any {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return { content: [] }; }
    }
    if (raw && typeof raw === 'object') return raw;
    return { content: [] };
  }

  /** Returns true if a parsed doc has any user-written content (not just empty paragraphs). */
  private hasContent(doc: any): boolean {
    const nodes: any[] = Array.isArray(doc?.content) ? doc.content : [];
    if (!nodes.length) return false;
    const check = (node: any): boolean => {
      if (!node || typeof node !== 'object') return false;
      if (node.type === 'text' && node.text?.trim()) return true;
      if (node.type && node.type !== 'paragraph' && node.type !== 'doc') return true;
      if (Array.isArray(node.content)) return node.content.some(check);
      return false;
    };
    return nodes.some(check);
  }

  private renderNode(node: any, pageMap: Map<string, PageRecord>): string {
    if (!node || typeof node !== 'object') return '';
    const attrs = node.attrs || {};
    const children = () => (node.content || []).map((c: any) => this.renderNode(c, pageMap)).join('');

    switch (node.type) {
      case 'text':
        return this.renderText(node);
      case 'paragraph': {
        const indent = attrs['data-indent'] || attrs.indent;
        const style = indent ? ` style="margin-left:${Number(indent) * 1.5}em"` : '';
        return `<p${style}>${children()}</p>`;
      }
      case 'heading': {
        const level = Math.min(6, Math.max(1, Number(attrs.level) || 2));
        return `<h${level}>${children()}</h${level}>`;
      }
      case 'toggleHeading': {
        const inner = node.content || [];
        const [headingNode, ...rest] = inner;
        const hLevel = headingNode?.attrs?.level || 2;
        const headingInner = (headingNode?.content || []).map((c: any) => this.renderNode(c, pageMap)).join('');
        const bodyHtml = rest.map((c: any) => this.renderNode(c, pageMap)).join('');
        return `<details class="toggle-heading toggle-h${hLevel}" open><summary><span class="toggle-arrow"></span><span class="toggle-title">${headingInner}</span></summary><div class="toggle-body">${bodyHtml}</div></details>`;
      }
      case 'blockquote':
        return `<blockquote>${children()}</blockquote>`;
      case 'codeBlock': {
        const lang = attrs.language || '';
        const langAttr = lang ? ` data-language="${esc(lang)}"` : '';
        const langLabel = lang ? `<div class="code-lang">${esc(lang)}</div>` : '';
        const rawCode = (node.content || []).map((c: any) => typeof c.text === 'string' ? c.text : '').join('');
        const code = highlightCode(rawCode, lang);
        return `<div class="code-block"${langAttr}>${langLabel}<pre><code>${code}</code></pre></div>`;
      }
      case 'bulletList':
        return `<ul>${children()}</ul>`;
      case 'orderedList':
        return `<ol>${children()}</ol>`;
      case 'listItem':
        return `<li>${children()}</li>`;
      case 'taskList':
        return `<ul class="task-list">${children()}</ul>`;
      case 'taskItem': {
        const checked = attrs.checked ? ' checked disabled' : ' disabled';
        return `<li class="task-item"><input type="checkbox"${checked}>${children()}</li>`;
      }
      case 'horizontalRule':
        return '<hr>';
      case 'hardBreak':
        return '<br>';
      case 'image': {
        const src = attrs.src || '';
        const alt = esc(attrs.alt || '');
        const width = attrs.width ? ` style="max-width:${esc(String(attrs.width))}"` : '';
        return `<img src="${esc(src)}" alt="${alt}"${width}>`;
      }
      case 'table':
        return `<table>${children()}</table>`;
      case 'tableRow':
        return `<tr>${children()}</tr>`;
      case 'tableHeader':
        return `<th>${children()}</th>`;
      case 'tableCell':
        return `<td>${children()}</td>`;
      case 'callout': {
        const icon = attrs.icon || '';
        const tone = attrs.tone || '';
        const bg = tone ? ` style="background:${esc(tone)}"` : '';
        const iconHtml = icon ? `<div class="callout-icon">${renderIcon(icon, 'callout-icon-inner')}</div>` : '';
        return `<div class="callout"${bg}>${iconHtml}<div class="callout-content">${children()}</div></div>`;
      }
      case 'columns':
        return `<div class="columns">${children()}</div>`;
      case 'column': {
        const width = attrs.width ? `flex:0 0 ${Number(attrs.width)}%` : 'flex:1 1 0';
        return `<div class="column" style="${width}">${children()}</div>`;
      }
      case 'pageLink': {
        const pageId = attrs.pageId || '';
        const linked = pageMap.get(pageId);
        const title = linked?.title || attrs.title || 'Untitled page';
        const iconVal = linked?.icon || attrs.icon || '';
        const iconHtml = renderIcon(iconVal);
        if (linked) {
          return `<a href="#page-${esc(pageId)}" class="page-link">${iconHtml}${esc(title)}</a>`;
        }
        return `<span class="page-link page-link--external">${iconHtml}${esc(title)}<span class="ext-bubble">This page was not included in the export</span></span>`;
      }
      case 'databaseView': {
        const title = attrs.title || 'Database';
        const iconVal = attrs.icon || '';
        const pageId = attrs.pageId || '';
        const iconHtml = renderIcon(iconVal);
        if (pageMap.has(pageId)) {
          return `<a href="#page-${esc(pageId)}" class="page-link db-back-link">\u2191 ${iconHtml}${esc(title)}</a>`;
        }
        return `<span class="page-link page-link--external db-back-link">\u2191 ${iconHtml}${esc(title)}<span class="ext-bubble">This database was not included in the export</span></span>`;
      }
      case 'databaseForm':
        return `<p class="muted">[Form: ${esc(attrs.name || 'Untitled')}]</p>`;
      case 'tableOfContents':
        return '<div class="toc">[Table of Contents]</div>';
      case 'drawio': {
        if (attrs.svg) return `<div class="drawio">${attrs.svg}</div>`;
        return '<p class="muted">[Diagram]</p>';
      }
      case 'gaussianSplat': {
        if (!attrs.src) return '<p class="muted">[3D Splat]</p>';
        const preview = attrs.preview
          ? `<img src="${esc(attrs.preview)}" class="gs-preview" alt="3D Splat preview">`
          : '<div class="gs-overlay">Loading 3D splat…</div>';
        return `<div class="gs-viewer" data-splat-src="${esc(attrs.src)}">${preview}</div>`;
      }
      default:
        if (node.content) return children();
        return '';
    }
  }

  private renderText(node: any): string {
    let text = esc(node.text || '');
    const marks: any[] = Array.isArray(node.marks) ? node.marks : [];
    for (const mark of marks) {
      switch (mark.type) {
        case 'bold':
          text = `<strong>${text}</strong>`; break;
        case 'italic':
          text = `<em>${text}</em>`; break;
        case 'strike':
          text = `<s>${text}</s>`; break;
        case 'code':
          text = `<code>${text}</code>`; break;
        case 'underline':
          text = `<u>${text}</u>`; break;
        case 'link': {
          const href = esc(mark.attrs?.href || '');
          const target = mark.attrs?.target ? ` target="${esc(mark.attrs.target)}"` : '';
          text = `<a href="${href}"${target}>${text}</a>`; break;
        }
        case 'highlight': {
          const color = mark.attrs?.color || 'yellow';
          text = `<mark style="background:${esc(color)}">${text}</mark>`; break;
        }
        case 'textStyle': case 'color': {
          const c = mark.attrs?.color;
          if (c) text = `<span style="color:${esc(c)}">${text}</span>`;
          break;
        }
      }
    }
    return text;
  }

  private renderDatabase(db: any, page: PageRecord, pageMap: Map<string, PageRecord>): string {
    if (!db || !db.fields?.length) return '<p class="muted">Empty database</p>';
    const fields = db.fields || [];
    const rows = db.rows || [];
    const colCount = fields.length;
    const header = fields.map((f: any) => `<th>${esc(f.name || '')}</th>`).join('');
    const bodyRows = rows.map((row: any) => {
      const data = row.data && typeof row.data === 'object' ? row.data : {};
      const cells = fields.map((f: any) => {
        // "Created by" shows who added the row, kept on the row rather than in a cell
        const val = f.options?.source === 'createdBy' ? (row.createdById ? [row.createdById] : null) : data[f.id];
        return `<td>${this.formatCellHtml(val, f, db.personNames)}</td>`;
      }).join('');
      let rowHtml = `<tr>${cells}</tr>`;

      if (row.page?.content) {
        const doc = this.parseContent(row.page.content);
        if (this.hasContent(doc)) {
          const pageBody = this.renderContent(row.page.content, pageMap);
          rowHtml += `\n<tr class="row-expansion"><td colspan="${colCount}"><details class="row-page-details"><summary><span class="row-expand-arrow"></span>Page content</summary><div class="row-page-body">${pageBody}</div></details></td></tr>`;
        }
      }

      return rowHtml;
    }).join('\n');
    return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
  }

  private getFieldChoices(field: any): { value: string; color?: string }[] {
    const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
    const raw = Array.isArray(options.choices) ? options.choices : [];
    return raw.filter((c: any) => c && typeof c.value === 'string');
  }

  private renderSelectPill(value: string, field: any): string {
    const choices = this.getFieldChoices(field);
    const match = choices.find((c) => c.value === value);
    const label = match?.value || value;
    const color = match?.color;
    if (color) {
      const bg = hexToRgba(color, 0.18);
      const border = hexToRgba(color, 0.45);
      return `<span class="select-pill" style="background:${esc(bg)};border-color:${esc(border)};color:${esc(color)}">${esc(label)}</span>`;
    }
    return `<span class="select-pill">${esc(label)}</span>`;
  }

  private formatCellHtml(val: any, field: any, personNames?: Map<string, string>): string {
    if (val === null || val === undefined) return '';
    const type = field?.type;
    if (type === 'PERSON' && Array.isArray(val)) {
      return esc(val.map((id: any) => personNames?.get(String(id)) || 'Former member').join(', '));
    }
    if (type === 'MULTI_SELECT' && Array.isArray(val)) {
      if (!val.length) return '';
      return `<div class="select-pills">${val.map((v: any) => this.renderSelectPill(String(v), field)).join('')}</div>`;
    }
    if (type === 'SELECT' && val) {
      return this.renderSelectPill(String(val), field);
    }
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (Array.isArray(val)) return esc(val.join(', '));
    if (type === 'DATE' && typeof val === 'string') {
      try { return esc(new Date(val).toLocaleDateString()); } catch { /* fall through */ }
    }
    return esc(String(val));
  }
}

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{
  --bg:#1a1b1e;--bg-surface:#222326;--text:#e5e7eb;--text-muted:#9ca3af;
  --border:#2a2f38;--accent:#38bdf8;--accent-hover:#7dd3fc;
  --sidebar-bg:#16171a;--sidebar-width:260px;
}
@media(prefers-color-scheme:light){
  :root{
    --bg:#ffffff;--bg-surface:#f8fafc;--text:#0f172a;--text-muted:#64748b;
    --border:#e2e8f0;--accent:#0284c7;--accent-hover:#0369a1;
    --sidebar-bg:#f1f5f9;
  }
}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:var(--bg);color:var(--text);display:flex;min-height:100vh;line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent-hover);text-decoration:underline}

/* Sidebar */
.sidebar{position:fixed;top:0;left:0;bottom:0;width:var(--sidebar-width);background:var(--sidebar-bg);
  border-right:1px solid var(--border);overflow-y:auto;z-index:10;display:flex;flex-direction:column}
.sidebar-inner{padding:8px 0;flex:1;overflow-y:auto}
.sidebar-toggle{position:fixed;top:0;left:0;z-index:20;padding:12px 14px;cursor:pointer;font-size:1.2rem;
  color:var(--text-muted);user-select:none;background:var(--sidebar-bg);border-bottom-right-radius:6px}
.sidebar-toggle:hover{color:var(--text)}
.sidebar-inner{padding-top:40px}
.nav-link{display:block;padding:6px 12px;color:var(--text);font-size:0.875rem;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none;border-radius:4px;margin:1px 6px}
.nav-link:hover{background:rgba(255,255,255,0.06);text-decoration:none}
.nav-link.active{background:rgba(56,189,248,0.15);color:var(--accent)}
.nav-icon{margin-right:6px;display:inline-flex;vertical-align:middle}
.nav-icon svg{width:1em;height:1em;vertical-align:middle}
.sidebar-resize{position:fixed;top:0;bottom:0;width:5px;left:var(--sidebar-width);z-index:11;
  cursor:col-resize;user-select:none;-webkit-user-select:none}
.sidebar-resize:hover,.sidebar-resize.dragging{background:var(--accent);opacity:0.4}
.sidebar-collapsed .sidebar{transform:translateX(-100%)}
.sidebar-collapsed .main{margin-left:0}
.sidebar-collapsed .sidebar-resize{display:none}
.sidebar-collapsed .sidebar-toggle{background:var(--bg)}
@media(max-width:768px){
  .sidebar{transform:translateX(-100%);transition:transform .2s}
  body:not(.sidebar-collapsed) .sidebar{transform:translateX(0)}
  .main{margin-left:0!important}
  .sidebar-resize{display:none}
}

/* Main */
.main{margin-left:var(--sidebar-width);flex:1;padding:0;min-width:0}
.page-section{max-width:800px;margin:0 auto;padding:48px 32px 64px}
.page-section+.page-section{border-top:1px solid var(--border)}
.page-section:last-child{min-height:100vh}
.page-title{font-size:2rem;font-weight:700;margin:0 0 24px}
.page-icon{margin-right:8px;display:inline-flex;vertical-align:middle}
.page-icon svg{width:1.2em;height:1.2em;vertical-align:middle}
.page-body{font-size:1rem}

/* Typography */
.page-body p{margin:0.6em 0}
.page-body h1{font-size:1.95rem;margin:1.2em 0 0.5em}
.page-body h2{font-size:1.5rem;margin:1.1em 0 0.4em}
.page-body h3{font-size:1.17rem;margin:1em 0 0.4em}
.page-body h4,.page-body h5,.page-body h6{font-size:1rem;margin:1em 0 0.4em}
.page-body blockquote{margin:0.75em 0;padding-left:1em;border-left:3px solid var(--border);color:var(--text-muted)}
.page-body ul,.page-body ol{padding-left:1.5em;margin:0.5em 0}
.page-body li{margin:0.2em 0}
.page-body img{max-width:100%;border-radius:8px;margin:0.5em 0}
.page-body hr{border:none;border-top:1px solid var(--border);margin:1.5em 0}

/* Code */
.page-body code{background:var(--bg-surface);padding:0.15em 0.4em;border-radius:4px;font-size:0.9em}
.code-block{position:relative;background:var(--bg-surface);border-radius:8px;margin:0.75em 0;overflow:hidden}
.code-lang{position:absolute;top:0;right:0;padding:4px 10px;font-size:0.75rem;color:var(--text-muted);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;user-select:none;opacity:0.8}
.code-block pre{background:none;padding:0.85em 1em;border-radius:0;overflow-x:auto;margin:0}
.page-body pre{background:var(--bg-surface);padding:0.85em 1em;border-radius:8px;overflow-x:auto;margin:0.75em 0}
.page-body pre code{background:none;padding:0;font-size:0.85em}
.page-body code:not(pre code){color:var(--code-inline)}
:root{--code-inline:#e06c75;
  --hl-keyword:#c678dd;--hl-string:#98c379;--hl-comment:#5c6370;--hl-number:#d19a66;
  --hl-builtin:#e5c07b;--hl-func:#61afef;--hl-op:#abb2bf}
@media(prefers-color-scheme:light){:root{--code-inline:#c0392b;
  --hl-keyword:#a626a4;--hl-string:#50a14f;--hl-comment:#a0a1a7;--hl-number:#986801;
  --hl-builtin:#c18401;--hl-func:#4078f2;--hl-op:#383a42}}
.hl-keyword{color:var(--hl-keyword)}
.hl-string{color:var(--hl-string)}
.hl-comment{color:var(--hl-comment);font-style:italic}
.hl-number{color:var(--hl-number)}
.hl-builtin{color:var(--hl-builtin)}
.hl-func{color:var(--hl-func)}
.hl-op{color:var(--hl-op)}

/* Tables */
.page-body .table-wrap{overflow-x:auto;margin:0.75em 0;-webkit-overflow-scrolling:touch}
.page-body table{border-collapse:collapse;width:100%;font-size:0.9rem}
.page-body .table-wrap table{margin:0}
.page-body th,.page-body td{border:1px solid var(--border);padding:8px 12px;text-align:left}
.page-body th{background:var(--bg-surface);font-weight:600}

/* Task list */
.task-list{list-style:none;padding-left:0}
.task-list .task-list{padding-left:1.5em}
.task-item{margin:4px 0}
.task-item>p{display:inline}
.task-item input[type=checkbox]{margin:0 8px 0 0;position:relative;top:1px}

/* Callout */
.callout{display:flex;gap:12px;padding:12px 16px;border-radius:12px;border:1px solid var(--border);
  background:var(--bg-surface);margin:0.75em 0}
.callout-icon{font-size:1.3rem;flex-shrink:0;width:32px;text-align:center}
.callout-content{flex:1;min-width:0}

/* Columns */
.columns{display:flex;gap:16px;margin:0.75em 0}
.column{min-width:0}
@media(max-width:600px){.columns{flex-direction:column}}

/* Toggle heading */
details.toggle-heading{margin:0.75em 0}
details.toggle-heading>summary{list-style:none;display:flex;align-items:center;gap:0;font-weight:700;cursor:text}
details.toggle-heading>summary::-webkit-details-marker{display:none}
.toggle-arrow{cursor:pointer;user-select:none;-webkit-user-select:none;flex-shrink:0;
  padding:2px 8px 2px 0;display:inline-flex;align-items:center}
.toggle-arrow::before{content:"\\25B6";font-size:0.6em;display:inline-block;transition:transform .15s}
details.toggle-heading[open] .toggle-arrow::before{transform:rotate(90deg)}
.toggle-title{cursor:text}
.toggle-h1>summary{font-size:1.95rem}
.toggle-h2>summary{font-size:1.5rem}
.toggle-h3>summary{font-size:1.17rem}
.toggle-h4>summary,.toggle-h5>summary,.toggle-h6>summary{font-size:1rem}
.toggle-body{padding-left:1.5em}

/* Page link */
.page-link{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;
  background:var(--bg-surface);border:1px solid var(--border);font-size:0.9rem;margin:2px 0}
.page-link:hover{text-decoration:none;border-color:var(--accent)}
.page-link--external{cursor:pointer;position:relative;color:var(--text-muted)}
.page-link--external .ext-bubble{display:none;position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);
  background:var(--bg-surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:0.8rem;
  color:var(--text-muted);white-space:nowrap;z-index:30;box-shadow:0 2px 8px rgba(0,0,0,0.2);pointer-events:none}
.page-link--external .ext-bubble::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);
  border:5px solid transparent;border-top-color:var(--border)}
.page-link--external.show-bubble .ext-bubble{display:block}

/* Drawio */
.drawio{margin:0.75em 0;text-align:center}
.drawio svg{max-width:100%;height:auto}

/* Gaussian Splat */
.gs-viewer{position:relative;width:100%;height:450px;background:#111;border-radius:8px;overflow:hidden;margin:0.75em 0}
.gs-viewer canvas{display:block;width:100%!important;height:100%!important}
.gs-preview{width:100%;height:100%;object-fit:contain;background:#111}
.gs-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:0.875rem;pointer-events:none;background:rgba(0,0,0,0.6)}

/* Database back-link */
.db-back-link{font-size:0.82rem;color:var(--text-muted);border-style:dashed}
.db-back-link:hover{color:var(--accent)}
@keyframes flash-outline{0%{outline:2px solid var(--accent);outline-offset:4px}100%{outline:2px solid transparent;outline-offset:4px}}
.highlight-flash{animation:flash-outline 1.5s ease-out;border-radius:4px}

/* Database row expansion */
.row-expansion>td{border-top:none;padding:0}
.row-page-details{margin:0}
.row-page-details>summary{cursor:pointer;padding:4px 12px;font-size:0.8rem;color:var(--text-muted);
  list-style:none;display:flex;align-items:center;gap:0;user-select:none;-webkit-user-select:none}
.row-page-details>summary::-webkit-details-marker{display:none}
.row-expand-arrow{cursor:pointer;user-select:none;-webkit-user-select:none;flex-shrink:0;
  padding:2px 6px 2px 0;display:inline-flex;align-items:center}
.row-expand-arrow::before{content:"\\25B6";font-size:0.55em;display:inline-block;transition:transform .15s}
.row-page-details[open] .row-expand-arrow::before{transform:rotate(90deg)}
.row-page-body{padding:8px 16px 12px;border-top:1px solid var(--border)}

/* Select pills */
.select-pills{display:flex;flex-wrap:wrap;gap:4px}
.select-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.82rem;
  border:1px solid var(--border);background:var(--bg-surface);white-space:nowrap}

/* Misc */
.toc{padding:12px 16px;border-radius:12px;border:1px solid var(--border);background:var(--bg-surface);
  margin:0.75em 0;color:var(--text-muted);font-style:italic}
.muted{color:var(--text-muted)}
`;

const JS_RESIZE = `
(function() {
  var handle = document.querySelector('.sidebar-resize');
  if (!handle) return;
  var dragging = false;
  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var w = Math.max(160, Math.min(e.clientX, 600));
    document.documentElement.style.setProperty('--sidebar-width', w + 'px');
  });
  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();
`;

const JS_TOGGLES = `
document.querySelectorAll('details.toggle-heading > summary').forEach(function(summary) {
  summary.addEventListener('click', function(e) {
    if (!e.target.closest('.toggle-arrow')) {
      e.preventDefault();
    }
  });
});
`;

const JS_DB_BACK_LINK = `
document.querySelectorAll('.db-back-link[href]').forEach(function(link) {
  link.addEventListener('click', function(e) {
    var href = link.getAttribute('href');
    if (!href) return;
    var section = document.querySelector(href);
    if (!section) return;
    var target = section.querySelector('.table-wrap') || section.querySelector('table') || section;
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    target.classList.add('highlight-flash');
    setTimeout(function() { target.classList.remove('highlight-flash'); }, 1500);
    e.preventDefault();
  });
});
`;

const JS_EXT_BUBBLE = `
document.querySelectorAll('.page-link--external').forEach(function(link) {
  link.addEventListener('click', function(e) { e.preventDefault(); });
  link.addEventListener('mouseenter', function() { link.classList.add('show-bubble'); });
  link.addEventListener('mouseleave', function() { link.classList.remove('show-bubble'); });
});
`;

const CSS_PAGED = `
/* Each page fills the screen, so its sub-page links sit at the bottom of a short page */
.page-section{flex-direction:column;min-height:100vh}
.page-body{flex:1 0 auto}
.child-pages{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px;padding-top:16px;border-top:1px solid var(--border)}
`;

const JS_PAGED = `
function navigateTo(id) {
  if (!id) return;
  document.querySelectorAll('.page-section').forEach(function(s) {
    s.style.display = s.id === 'page-' + id ? 'flex' : 'none';
  });
  document.querySelectorAll('.sidebar .nav-link').forEach(function(a) {
    a.classList.toggle('active', a.getAttribute('href') === '#page-' + id);
  });
  location.hash = 'page-' + id;
  window.scrollTo(0, 0);
  if (window.innerWidth < 768) document.body.classList.add('sidebar-collapsed');
}
document.querySelectorAll('.sidebar .nav-link').forEach(function(a) {
  a.addEventListener('click', function(e) {
    e.preventDefault();
    var id = a.getAttribute('href').replace('#page-','');
    navigateTo(id);
  });
});
document.querySelectorAll('.page-body .page-link').forEach(function(a) {
  var href = a.getAttribute('href') || '';
  if (href.startsWith('#page-')) {
    a.addEventListener('click', function(e) {
      e.preventDefault();
      navigateTo(href.replace('#page-',''));
    });
  }
});
window.addEventListener('hashchange', function() {
  var id = location.hash.replace('#page-','');
  if (id) navigateTo(id);
});
`;

const SPLAT_IMPORTMAP = `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js","three/examples/jsm/controls/OrbitControls.js":"https://cdn.jsdelivr.net/npm/three@0.178.0/examples/jsm/controls/OrbitControls.js","@sparkjsdev/spark":"https://sparkjs.dev/releases/spark/0.1.10/spark.module.js"}}</script>`;

const JS_SPLAT_INIT = `
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SplatMesh } from '@sparkjsdev/spark';

if (location.protocol === 'file:') { /* skip — GIF preview is the fallback */ } else
document.querySelectorAll('.gs-viewer[data-splat-src]').forEach(function(el) {
  var src = el.getAttribute('data-splat-src');
  if (!src) return;
  var overlay = el.querySelector('.gs-overlay');

  try {
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 1000);
    camera.position.set(0, 1, 3);
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    var controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    var preview = el.querySelector('.gs-preview');
    var splatOpts = { fileType: 'spz', onLoad: function() {
      if (overlay) overlay.remove();
      if (preview) preview.remove();
    }, onError: function() {
      // Preview GIF stays visible as fallback
    }};
    if (src.startsWith('data:')) {
      var bin = atob(src.split(',')[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      splatOpts.fileBytes = bytes;
    } else {
      splatOpts.url = src;
    }
    var splat = new SplatMesh(splatOpts);
    scene.add(splat);

    new ResizeObserver(function() {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    }).observe(el);

    renderer.setAnimationLoop(function() {
      controls.update();
      renderer.render(scene, camera);
    });
  } catch(e) {
    if (overlay) overlay.textContent = location.protocol === 'file:'
      ? '3D splats require HTTP — run: npx serve .'
      : 'Failed to load 3D splat';
  }
});
</script>
`;
