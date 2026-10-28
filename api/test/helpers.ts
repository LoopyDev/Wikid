// Helpers for the API end-to-end tests. They talk to a running Wikid stack over HTTP,
// like the web app does, so they keep working when the code behind the API is rearranged.

export const API_URL = (process.env.WIKID_API_URL || 'http://localhost:8088/api').replace(/\/$/, '');

// Demo users seeded by the Docker stack (password "wikid").
export const USERS = {
  admin: { id: '00000000-0000-0000-0000-000000000010', email: 'admin@wikid.local', name: 'System Admin' },
  alice: { id: '00000000-0000-0000-0000-000000000011', email: 'alice@wikid.local', name: 'Alice' },
  bob: { id: '00000000-0000-0000-0000-000000000012', email: 'bob@wikid.local', name: 'Bob' },
} as const;
export const DEMO_PASSWORD = 'wikid';

export type ApiResponse<T = any> = { status: number; body: T };

/** One logged-in browser: keeps the session cookie between requests. */
export class Session {
  private cookie = '';

  async request<T = any>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length) this.cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (HTML export and similar)
    }
    return { status: res.status, body: parsed };
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body);
  }
  put<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('PUT', path, body);
  }
  patch<T = any>(path: string, body: unknown = {}) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T = any>(path: string, body?: unknown) {
    return this.request<T>('DELETE', path, body);
  }

  /** Sends a multipart upload, like the editor's image upload. */
  async upload(path: string, fields: Record<string, string>, file: { field: string; name: string; type: string; data: Uint8Array }) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append(file.field, new Blob([Buffer.from(file.data)], { type: file.type }), file.name);
    const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: this.cookie ? { cookie: this.cookie } : {}, body: form });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed } as ApiResponse;
  }

  /** Fetches a path and returns the raw bytes, for downloads. */
  async download(path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await fetch(`${API_URL}${path}`, {
      method: init.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return {
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      cacheControl: res.headers.get('cache-control') || '',
      bytes: new Uint8Array(await res.arrayBuffer()),
    };
  }

  async login(email: string, password = DEMO_PASSWORD) {
    return this.post('/auth/login', { email, password });
  }
}

export async function loginAs(email: string, password = DEMO_PASSWORD) {
  const session = new Session();
  const res = await session.login(email, password);
  if (res.status !== 201) throw new Error(`Login as ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return session;
}

/** A name that won't clash with earlier runs against the same stack. */
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Creates a workspace owned by `owner` and returns its id. */
export async function createWorkspace(owner: Session, name = unique('Test workspace')) {
  const res = await owner.post('/workspaces', { name });
  if (res.status !== 201) throw new Error(`Create workspace failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.workspace.id as string;
}

export async function addMember(owner: Session, workspaceId: string, email: string, role = 'EDITOR') {
  const res = await owner.post(`/workspaces/${workspaceId}/members`, { email, role });
  if (res.status !== 201) throw new Error(`Add member failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Creates a page and returns the full page record. */
export async function createPage(session: Session, workspaceId: string, extra: Record<string, unknown> = {}) {
  const res = await session.post('/pages', { workspaceId, title: unique('Page'), ...extra });
  if (res.status !== 201) throw new Error(`Create page failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** A Tiptap document with one paragraph per string. */
export const docWithParagraphs = (...texts: string[]) => ({
  type: 'doc',
  content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

export const paragraphTexts = (content: any): string[] =>
  (content?.content || []).map((node: any) => (node.content || []).map((child: any) => child.text || '').join(''));
