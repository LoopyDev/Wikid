const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const API_STATUS_EVENT = 'wikid:api-status';
export const AUTH_EXPIRED_EVENT = 'wikid:auth-expired';
// The API refused a request because an admin set this user's password: they must choose their own.
export const PASSWORD_CHANGE_REQUIRED_EVENT = 'wikid:password-change-required';

const notifyApiStatus = (status) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(API_STATUS_EVENT, { detail: { status } }));
  } catch {
    // ignore event dispatch errors in non-browser contexts
  }
};

const notifyAuthExpired = () => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
};

// The readable message from an error response: the API's JSON `message`, or the raw text
function errorMessageFrom(raw, res) {
  let message = raw;
  try {
    const body = JSON.parse(raw);
    if (body?.message) message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
  } catch {
    // not JSON; use the text as is
  }
  return message || res.statusText;
}

// All API calls go through here so the session cookie is always sent
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options });
  if (res.status === 401 && path !== '/auth/login') notifyAuthExpired();
  if (res.status === 403) {
    res
      .clone()
      .json()
      .then((body) => {
        if (body?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_REQUIRED_EVENT));
        }
      })
      .catch(() => {});
  }
  return res;
}

async function request(path, options = {}) {
  let res;
  try {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = isFormData
      ? { ...(options.headers || {}) }
      : { 'Content-Type': 'application/json', ...(options.headers || {}) };
    res = await apiFetch(path, {
      ...options,
      headers,
    });
  } catch (err) {
    notifyApiStatus('offline');
    throw err;
  }
  notifyApiStatus('online');
  const raw = await res.text(); // read once
  if (!res.ok) throw new Error(errorMessageFrom(raw, res));
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON from', path, res.status, res.headers.get('content-type'), raw.slice(0, 200));
    throw err;
  }
}

function buildQs(params) {
  const p = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val != null && val !== false && val !== '') p.append(key, String(val));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  async listPages({ workspaceId, userId, userName, includeDeleted, state } = {}) {
    return request(`/pages${buildQs({ workspaceId, userId, userName, includeDeleted, state })}`);
  },
  async getPage(pageId, { userId, userName } = {}) {
    return request(`/pages/${pageId}${buildQs({ userId, userName })}`);
  },
  async updatePageContent(pageId, content, { userId, userName } = {}) {
    return request(`/pages/${pageId}/content${buildQs({ userId, userName })}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  },
  async uploadImage(file, { pageId, userId, userName } = {}) {
    if (!file) {
      throw new Error('file is required');
    }
    const form = new FormData();
    form.append('image', file);
    if (pageId) form.append('pageId', pageId);
    return request(`/uploads${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: form,
    });
  },
  async movePageToWorkspace(pageId, targetWorkspaceId, { userId, userName } = {}) {
    return request(`/pages/${pageId}/workspace${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetWorkspaceId }),
    });
  },
  async updatePageTitle(pageId, title, { userId, userName } = {}) {
    return request(`/pages/${pageId}${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },
  async updatePageIcon(pageId, icon, { userId, userName } = {}) {
    return request(`/pages/${pageId}${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify({ icon }),
    });
  },
  async updatePageVisibility(pageId, visibility, { userId, userName } = {}) {
    return request(`/pages/${pageId}/visibility${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    });
  },
  async updatePageSetup(pageId, payload, { userId, userName } = {}) {
    return request(`/pages/${pageId}/setup${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async convertPageToWiki(pageId, { userId, userName } = {}) {
    return request(`/pages/${pageId}/wiki${buildQs({ userId, userName })}`, {
      method: 'POST',
    });
  },
  async getBlocks(pageId, { userId, userName } = {}) {
    return request(`/pages/${pageId}/blocks${buildQs({ userId, userName })}`);
  },
  async createBlock(pageId, payload, { userId, userName } = {}) {
    return request(`/pages/${pageId}/blocks${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateBlock(blockId, payload, { userId, userName } = {}) {
    return request(`/blocks/${blockId}${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async createPage(payload) {
    return request(`/pages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async getDatabase(pageId, { userId, userName } = {}) {
    return request(`/pages/${pageId}/database${buildQs({ userId, userName })}`);
  },
  async createDatabaseField(pageId, payload, { userId, userName } = {}) {
    return request(`/pages/${pageId}/database/fields${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateDatabaseField(fieldId, payload, { userId, userName } = {}) {
    return request(`/database-fields/${fieldId}${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteDatabaseField(fieldId, { userId, userName } = {}) {
    return request(`/database-fields/${fieldId}${buildQs({ userId, userName })}`, {
      method: 'DELETE',
    });
  },
  async createDatabaseRow(pageId, payload, { userId, userName } = {}) {
    return request(`/pages/${pageId}/database/rows${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async createDatabaseForm(pageId, payload, { userId, userName } = {}) {
    return request(`/pages/${pageId}/database/forms${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateDatabaseForm(formId, payload, { userId, userName } = {}) {
    return request(`/database-forms/${formId}${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteDatabaseForm(formId, { userId, userName } = {}) {
    return request(`/database-forms/${formId}${buildQs({ userId, userName })}`, {
      method: 'DELETE',
    });
  },
  async getDatabaseForm(formId, { userId, userName } = {}) {
    return request(`/database-forms/${formId}${buildQs({ userId, userName })}`);
  },
  async submitDatabaseForm(formId, payload, { userId, userName } = {}) {
    return request(`/database-forms/${formId}/submit${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async createDatabaseView(pageId, payload, { userId, userName } = {}) {
    return request(`/pages/${pageId}/database/views${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateDatabaseView(viewId, payload, { userId, userName } = {}) {
    return request(`/database-views/${viewId}${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async deleteDatabaseView(viewId, { userId, userName } = {}) {
    return request(`/database-views/${viewId}${buildQs({ userId, userName })}`, {
      method: 'DELETE',
    });
  },
  async updateDatabaseRow(rowId, payload, { userId, userName } = {}) {
    return request(`/database-rows/${rowId}${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async getDatabaseRowBacklinks(rowId, { userId, userName } = {}) {
    return request(`/database-rows/${rowId}/backlinks${buildQs({ userId, userName })}`);
  },
  async ensureDatabaseRowPage(rowId, payload, { userId, userName } = {}) {
    return request(`/database-rows/${rowId}/page${buildQs({ userId, userName })}`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },
  async deleteDatabaseRow(rowId, { userId, userName } = {}) {
    return request(`/database-rows/${rowId}${buildQs({ userId, userName })}`, {
      method: 'DELETE',
    });
  },
  async deletePage(pageId, { userId, userName } = {}) {
    return request(`/pages/${pageId}${buildQs({ userId, userName })}`, {
      method: 'DELETE',
    });
  },
  async restorePage(pageId, { userId, userName } = {}) {
    return request(`/pages/${pageId}/restore${buildQs({ userId, userName })}`, {
      method: 'PATCH',
    });
  },
  async destroyPages(ids, { userId, userName } = {}) {
    return request(`/pages${buildQs({ userId, userName })}`, {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    });
  },
  async reorderPages(parentId, orderedIds, { userId, userName } = {}) {
    return request(`/pages/reorder${buildQs({ userId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId: parentId ?? null, orderedIds }),
    });
  },
  async login(payload) {
    return request(`/auth/login`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async logout() {
    return request(`/auth/logout`, { method: 'POST' });
  },
  isApiUrl(url) {
    return typeof url === 'string' && url.startsWith(API_BASE);
  },
  async fetchUpload(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(errorMessageFrom(await res.text(), res));
    return res.arrayBuffer();
  },
  async getUser(userId, { userId: requesterId, userName } = {}) {
    if (!userId) throw new Error('userId is required');
    return request(`/users/${userId}${buildQs({ userId: requesterId, userName })}`);
  },
  async updateUserPreferences(userId, preferences, { userId: requesterId, userName } = {}) {
    if (!userId) throw new Error('userId is required');
    return request(`/users/${userId}/preferences${buildQs({ userId: requesterId, userName })}`, {
      method: 'PATCH',
      body: JSON.stringify({ preferences }),
    });
  },
  async changePassword(userId, currentPassword, newPassword) {
    return request(`/users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  async listUsers(adminId) {
    return request(`/admin/users?adminId=${encodeURIComponent(adminId)}`);
  },
  async createUser(adminId, { displayName, email, username, password, mustChangePassword = true }) {
    return request(`/admin/users`, {
      method: 'POST',
      body: JSON.stringify({ adminId, displayName, email, username, password, mustChangePassword }),
    });
  },
  async updateUser(adminId, userId, { displayName, email, username } = {}) {
    return request(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ adminId, displayName, email, username }),
    });
  },
  async resetUserPassword(adminId, userId, newPassword, { mustChangePassword = true } = {}) {
    return request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ adminId, newPassword, mustChangePassword }),
    });
  },
  async deleteUser(adminId, userId) {
    return request(`/admin/users/${userId}?adminId=${encodeURIComponent(adminId)}`, {
      method: 'DELETE',
    });
  },
  async collabToken(payload) {
    return request(`/collab/token`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async listWorkspaces({ userId, userName, adminId } = {}) {
    return request(`/workspaces${buildQs({ userId, userName, adminId })}`);
  },
  async createWorkspace({ name, userId, userName } = {}) {
    return request(`/workspaces`, {
      method: 'POST',
      body: JSON.stringify({ name, userId, userName }),
    });
  },
  async updateWorkspace(workspaceId, data, { userId } = {}) {
    return request(`/workspaces/${workspaceId}${buildQs({ userId })}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  async deleteWorkspace(workspaceId, { userId } = {}) {
    return request(`/workspaces/${workspaceId}${buildQs({ userId })}`, { method: 'DELETE' });
  },
  async listWorkspaceMembers(workspaceId, { userId, adminId } = {}) {
    return request(`/workspaces/${workspaceId}/members${buildQs({ userId, adminId })}`);
  },
  async addWorkspaceMember(workspaceId, payload, { userId, adminId } = {}) {
    return request(`/workspaces/${workspaceId}/members${buildQs({ userId, adminId })}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async updateWorkspaceMember(workspaceId, memberId, payload, { userId, adminId } = {}) {
    return request(`/workspaces/${workspaceId}/members/${memberId}${buildQs({ userId, adminId })}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  async removeWorkspaceMember(workspaceId, memberId, { userId, adminId } = {}) {
    return request(`/workspaces/${workspaceId}/members/${memberId}${buildQs({ userId, adminId })}`, {
      method: 'DELETE',
    });
  },
  async listCollabDocs({ adminId } = {}) {
    return request(`/collab/admin/docs${buildQs({ adminId })}`);
  },
  async requestCollabMaterialize(documentName, { adminId } = {}) {
    return request(`/collab/admin/materialize${buildQs({ adminId })}`, {
      method: 'POST',
      body: JSON.stringify({ documentName }),
    });
  },
  async purgeCollabDocs({ adminId, confirm } = {}) {
    return request(`/collab/admin/purge${buildQs({ adminId })}`, {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    });
  },
  async resetWorkspaces({ adminId, confirm } = {}) {
    return request(`/workspaces/admin/reset${buildQs({ adminId })}`, {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    });
  },
  async gcUploads({ adminId } = {}) {
    return request(`/uploads/admin/gc${buildQs({ adminId })}`, {
      method: 'POST',
    });
  },
  async summarizeBlocks(blocks) {
    return request('/ai/summarize-blocks', {
      method: 'POST',
      body: JSON.stringify({ blocks }),
    });
  },
  async suggestAiEdits({ prompt, blocks }) {
    const res = await apiFetch('/ai/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, blocks }),
    });
    if (!res.ok) {
      throw new Error(errorMessageFrom(await res.text(), res));
    }
    return res.json();
  },
  exportPagePdfUrl(pageId, params = {}) {
    return `${API_BASE}/pages/${pageId}/export/pdf${buildQs(params)}`;
  },
  async exportHtml({ rootPageId, workspaceId, mode, excludeIds } = {}) {
    const res = await apiFetch('/export/html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPageId, workspaceId, mode, excludeIds }),
    });
    if (!res.ok) throw new Error(errorMessageFrom(await res.text(), res));
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? decodeURIComponent(match[1]) : 'export.html';
    return { blob, filename };
  },
  // AI generation — returns an EventSource-like async iterator via fetch SSE
  async *streamAiChat({ messages, workspaceId, pageContext, currentPageOnly } = {}) {
    const res = await apiFetch('/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, workspaceId, pageContext, currentPageOnly }),
    });
    if (!res.ok) {
      throw new Error(errorMessageFrom(await res.text(), res));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'error') throw new Error(parsed.error);
          yield parsed;
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
  },
  async *streamAiGenerate({ prompt, context, mode } = {}) {
    const res = await apiFetch('/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, context, mode }),
    });
    if (!res.ok) {
      throw new Error(errorMessageFrom(await res.text(), res));
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) yield parsed.text;
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }
  },
};
