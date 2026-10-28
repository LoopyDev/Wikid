import { defineStore } from 'pinia';
import { api } from '../api/client';
import { fallbackDoc, normalizeEditorDoc } from '../utils/editorDoc';
import { SYSTEM_ADMIN_ID } from '../constants/system-admin';
import { connectWorkspaceEvents } from '../services/workspaceEvents';

// The live events channel for the active workspace (kept outside the reactive state)
const liveEvents = { workspaceId: null, disconnect: null, refreshTimer: null, changedIds: new Set(), settingUp: new Set() };

// The live-editing pass covers a whole workspace, so moving between its pages reuses it instead of
// asking the server again (which also mounted each page's editor twice: offline, then connected).
// Reused only briefly, so a change in someone's access still applies within minutes.
const COLLAB_TOKEN_REUSE_MS = 10 * 60 * 1000;
let collabTokenCache = null;
const collabTokenFor = (user, workspaceId) => {
  const cached = collabTokenCache;
  if (cached && cached.userId === user.id && cached.workspaceId === workspaceId && Date.now() - cached.at < COLLAB_TOKEN_REUSE_MS) {
    return cached;
  }
  const entry = { userId: user.id, workspaceId, at: Date.now(), token: null };
  entry.promise = api.collabToken({ userId: user.id, userName: user.name, workspaceId }).then((res) => {
    if (!res?.token) throw new Error('Missing collab token');
    entry.token = res.token;
    return res.token;
  });
  entry.promise.catch(() => {
    if (collabTokenCache === entry) collabTokenCache = null;
  });
  collabTokenCache = entry;
  return entry;
};

// Pages fetched when the pointer rests on them in the sidebar, so a click shows them sooner. Kept
// only briefly: the live-editing connection brings the latest content once the page is open.
const PREFETCH_KEEP_MS = 10 * 1000;
const prefetchedPages = new Map();
const takePrefetchedPage = (pageId) => {
  const entry = prefetchedPages.get(pageId);
  prefetchedPages.delete(pageId);
  return entry && Date.now() - entry.at < PREFETCH_KEEP_MS ? entry.promise : null;
};

// A path like "/collab" means the collab server sits behind the same origin as the app
const resolveCollabUrl = (url) => {
  if (!url) return 'ws://localhost:1234';
  if (!url.startsWith('/') || typeof window === 'undefined') return url;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${url}`;
};

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    workspaceName: 'Wikid Workspace',
    pages: [],
    binPages: [],
    activePageId: null,
    activePageWorkspaceId: null,
    workspaces: [],
    activeWorkspaceId: null,
    activeWorkspaceRole: null,
    doc: fallbackDoc,
    docRevision: 0,
    titleDraft: 'Untitled page',
    activeUserId: null,
    activeUserName: null,
    activeUserEmail: null,
    userPreferences: {},
    loadingPages: false,
    loadingDoc: false,
    saving: false,
    privateOpen: true,
    publicOpen: true,
    hasApi: false,
    error: null,
    pendingSave: null,
    pendingTitleSave: null,
    savingHold: null,
    deletingCascade: false,
    // An admin set this user's password; they choose their own before using the app.
    mustChangePassword: false,
    // False until the server has said whether the remembered sign-in still works, and whether this
    // user must choose a new password first; the app shows "Signing in…" meanwhile
    sessionChecked: false,
    // The server has AI set up and the admin hasn't turned it off (see aiEnabled).
    aiAvailable: false,
    // Set when someone moves the open page (or a page it's inside) to the Bin:
    // { openPageId, pageId, pageTitle, pageIds, byName, byMe }. Only shown while that page is still open.
    remoteDeletion: null,
    collabToken: null,
    collabDocName: null,
    collabWorkspaceId: null,
    collabUrl: resolveCollabUrl(import.meta.env.VITE_COLLAB_URL),
    pendingTitleUpdates: {},
  }),
  getters: {
    currentPage(state) {
      return state.pages.find((p) => p.id === state.activePageId);
    },
    currentWorkspace(state) {
      return state.workspaces.find((entry) => entry.workspace?.id === state.activeWorkspaceId) || null;
    },
    activeUser(state) {
      if (state.activeUserId) return { id: state.activeUserId, name: state.activeUserName || state.activeUserId, email: state.activeUserEmail };
      return null;
    },
    privatePages() {
      if (!this.activeWorkspaceId) return [];
      return this.pages.filter(
        (p) => p.workspaceId === this.activeWorkspaceId && p.visibility === 'PRIVATE' && !p.isDeleted && !p.isHidden
      );
    },
    publicPages() {
      if (!this.activeWorkspaceId) return [];
      return this.pages.filter(
        (p) => p.workspaceId === this.activeWorkspaceId && p.visibility !== 'PRIVATE' && !p.isDeleted && !p.isHidden
      );
    },
    activePageRemotelyDeleted(state) {
      return !!state.remoteDeletion && state.remoteDeletion.openPageId === state.activePageId;
    },
    // Show AI features: available on this server, and not hidden in this user's settings.
    aiEnabled(state) {
      return state.aiAvailable && state.userPreferences?.hideAi !== true;
    },
    canEditActiveWorkspace(state) {
      return state.activeWorkspaceRole === 'OWNER' || state.activeWorkspaceRole === 'EDITOR';
    },
    collabActive(state) {
      return !!(state.collabToken && state.collabDocName && state.collabWorkspaceId);
    },
  },
  actions: {
    lastPageStorageKey() {
      const alias = this.activeUserId || 'guest';
      const workspace = this.activeWorkspaceId || 'unknown';
      return `wikid:last-page:${alias}:${workspace}`;
    },
    lastWorkspaceStorageKey() {
      const alias = this.activeUserId || 'guest';
      return `wikid:last-workspace:${alias}`;
    },
    loadLastWorkspaceId() {
      if (typeof localStorage === 'undefined') return null;
      try {
        return localStorage.getItem(this.lastWorkspaceStorageKey()) || null;
      } catch {
        return null;
      }
    },
    saveLastWorkspaceId(workspaceId) {
      if (typeof localStorage === 'undefined') return;
      if (!workspaceId) return;
      try {
        localStorage.setItem(this.lastWorkspaceStorageKey(), workspaceId);
      } catch {
        // ignore storage errors
      }
    },
    loadLastPageId() {
      if (typeof localStorage === 'undefined') return null;
      try {
        return localStorage.getItem(this.lastPageStorageKey()) || null;
      } catch {
        return null;
      }
    },
    saveLastPageId(pageId) {
      if (typeof localStorage === 'undefined') return;
      if (!pageId) return;
      try {
        localStorage.setItem(this.lastPageStorageKey(), pageId);
      } catch {
        // ignore storage errors
      }
    },
    clearLastPageId() {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.removeItem(this.lastPageStorageKey());
      } catch {
        // ignore storage errors
      }
    },
    async loadInitial() {
      if (this.activeUser && this.mustChangePassword) {
        this.sessionChecked = true;
        return;
      }
      if (!this.activeUser) {
        this.sessionChecked = true;
        this.pages = [];
        this.binPages = [];
        this.activePageId = null;
        this.activePageWorkspaceId = null;
        this.workspaces = [];
        this.activeWorkspaceId = null;
        this.activeWorkspaceRole = null;
        this.doc = fallbackDoc;
        this.titleDraft = 'Untitled page';
        this.userPreferences = {};
        this.hasApi = false;
        this.pendingTitleUpdates = {};
        return;
      }
      this.loadingPages = true;
      this.error = null;
      try {
        const memberships = await api.listWorkspaces({
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
        this.workspaces = Array.isArray(memberships) ? memberships : [];
        this.hasApi = true;
        await Promise.all([this.fetchUserPreferences(), this.loadServerConfig()]);
        const savedWorkspaceId = this.loadLastWorkspaceId();
        const defaultWorkspace =
          this.workspaces.find((entry) => entry.workspace?.id === savedWorkspaceId) ||
          this.workspaces[0] ||
          null;
        if (defaultWorkspace?.workspace?.id) {
          await this.selectWorkspaceById(defaultWorkspace.workspace.id);
        } else {
          this.pages = [];
          this.binPages = [];
          this.activePageId = null;
          this.activePageWorkspaceId = null;
          this.activeWorkspaceId = null;
          this.activeWorkspaceRole = null;
          this.doc = fallbackDoc;
          this.titleDraft = 'Untitled page';
        }
      } catch (err) {
        // An admin set this user's password: they choose their own before anything else. Not an error.
        if (err?.status === 403 && err?.body?.code === 'PASSWORD_CHANGE_REQUIRED') {
          this.mustChangePassword = true;
          return;
        }
        console.warn('Load pages failed', err?.message || err);
        this.pages = [];
        this.binPages = [];
        this.activePageId = null;
        this.activePageWorkspaceId = null;
        this.workspaces = [];
        this.activeWorkspaceId = null;
        this.activeWorkspaceRole = null;
        this.doc = fallbackDoc;
        this.titleDraft = 'Untitled page';
        this.hasApi = false;
        this.error = err?.message || 'Failed to load pages';
      } finally {
        this.loadingPages = false;
        this.sessionChecked = true;
      }
    },
    async refreshWorkspaces() {
      if (!this.activeUser || !this.hasApi) return [];
      const memberships = await api.listWorkspaces({
        userId: this.activeUser.id,
        userName: this.activeUser.name,
      });
      this.workspaces = Array.isArray(memberships) ? memberships : [];
      if (this.activeWorkspaceId) {
        const activeEntry = this.workspaces.find((entry) => entry.workspace?.id === this.activeWorkspaceId);
        if (!activeEntry) {
          this.activeWorkspaceId = null;
          this.activeWorkspaceRole = null;
        } else {
          this.activeWorkspaceRole = activeEntry.role || null;
        }
      }
      return this.workspaces;
    },
    async renameWorkspace(workspaceId, name) {
      const updated = await api.updateWorkspace(workspaceId, { name }, { userId: this.activeUserId });
      const entry = this.workspaces.find((e) => e.workspace?.id === workspaceId);
      if (entry) entry.workspace.name = updated.name;
    },
    async deleteWorkspace(workspaceId) {
      await api.deleteWorkspace(workspaceId, { userId: this.activeUserId });
      if (this.activeWorkspaceId === workspaceId) {
        this.activeWorkspaceId = null;
        this.activeWorkspaceRole = null;
        this.pages = [];
        this.binPages = [];
        this.activePageId = null;
        this.activePageWorkspaceId = null;
        this.doc = fallbackDoc;
        this.titleDraft = 'Untitled page';
      }
      this.workspaces = this.workspaces.filter((entry) => entry.workspace?.id !== workspaceId);
    },
    async createWorkspace(name) {
      if (!this.activeUser || !this.hasApi) return null;
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) return null;
      const created = await api.createWorkspace({
        name: trimmed,
        userId: this.activeUser.id,
        userName: this.activeUser.name,
      });
      await this.refreshWorkspaces();
      if (created?.workspace?.id) {
        await this.selectWorkspaceById(created.workspace.id);
      }
      return created;
    },
    async loadWorkspacePages(workspaceId) {
      if (!workspaceId || !this.activeUser || !this.hasApi) {
        this.pages = [];
        return;
      }
      const pages = await api.listPages({
        workspaceId,
        userId: this.activeUser.id,
        userName: this.activeUser.name,
      });
      this.pages = Array.isArray(pages) ? pages : [];
      this.binPages = [];
      const savedPageId = this.loadLastPageId();
      const savedPage = this.pages.find((p) => p.id === savedPageId && !p.isDeleted && !p.isHidden);
      const firstPage = savedPage || this.pages.find((p) => !p.isDeleted && !p.isHidden);
      this.activePageId = firstPage?.id || null;
      this.activePageWorkspaceId = firstPage?.workspaceId || workspaceId;
      this.titleDraft = firstPage?.title || 'Untitled page';
      if (this.activePageId) {
        this.saveLastPageId(this.activePageId);
        await this.loadPageDoc(this.activePageId);
      } else {
        this.doc = fallbackDoc;
      }
    },
    // Loads a workspace's page list for the sidebar, without changing which page is open.
    // Titles still being typed here are kept.
    async loadPageList(workspaceId, { keepBin = false } = {}) {
      if (!workspaceId || !this.activeUser || !this.hasApi) return;
      const pages = await api.listPages({
        workspaceId,
        userId: this.activeUser.id,
        userName: this.activeUser.name,
      });
      // Ignore the answer if the user has moved to another workspace meanwhile
      if (workspaceId !== this.activeWorkspaceId) return;
      const pending = this.pendingTitleUpdates || {};
      const next = (Array.isArray(pages) ? pages : []).map((p) =>
        typeof pending[p.id]?.title === 'string' ? { ...p, title: pending[p.id].title } : p
      );
      // Someone else moved the open page to the Bin: keep it (marked deleted, so the sidebar
      // leaves it out) until it's restored or closed, so the page and its notice stay on screen.
      if (this.activePageRemotelyDeleted && !next.some((p) => p.id === this.activePageId)) {
        const open = this.pages.find((p) => p.id === this.activePageId);
        if (open) next.push({ ...open, isDeleted: true });
      }
      this.pages = next;
      if (!keepBin) this.binPages = [];
    },
    // Keeps the live events channel open for the active workspace, so the sidebar and the open
    // page follow changes other people make. Viewers don't get collab tokens, so they go without.
    syncWorkspaceEvents() {
      const workspaceId =
        this.activeUser && this.hasApi && this.collabUrl && this.canEditActiveWorkspace ? this.activeWorkspaceId : null;
      if (workspaceId === liveEvents.workspaceId) return;
      liveEvents.disconnect?.();
      liveEvents.disconnect = null;
      liveEvents.workspaceId = workspaceId;
      clearTimeout(liveEvents.refreshTimer);
      liveEvents.changedIds = new Set();
      if (!workspaceId) return;
      liveEvents.disconnect = connectWorkspaceEvents({
        url: this.collabUrl,
        workspaceId,
        getToken: async () => {
          const res = await api.collabToken({ userId: this.activeUser?.id, userName: this.activeUser?.name, workspaceId });
          return res?.token || '';
        },
        onPagesChanged: (message) => this.handlePagesChanged(message),
      });
    },
    handlePagesChanged(message) {
      const pageIds = message?.pageIds || [];
      pageIds.forEach((id) => prefetchedPages.delete(id));
      const openPageId = this.activePageId;
      if (message?.deleted?.pageId && openPageId && pageIds.includes(openPageId)) {
        this.remoteDeletion = {
          openPageId,
          pageId: message.deleted.pageId,
          pageTitle: this.pages.find((p) => p.id === message.deleted.pageId)?.title || '',
          pageIds,
          byName: message.deleted.byName || '',
          byMe: !!message.deleted.byUserId && message.deleted.byUserId === this.activeUser?.id,
        };
      } else if (this.remoteDeletion && message?.restored && pageIds.includes(this.remoteDeletion.pageId)) {
        // Restored (from the Bin or by someone else): carry on editing.
        this.remoteDeletion = null;
      }
      for (const id of pageIds) liveEvents.changedIds.add(id);
      // Several changes often arrive together (e.g. a page and its sub-pages); refresh once.
      clearTimeout(liveEvents.refreshTimer);
      liveEvents.refreshTimer = setTimeout(() => {
        const changed = liveEvents.changedIds;
        liveEvents.changedIds = new Set();
        this.refreshAfterRemoteChange(changed).catch((err) => console.warn('Live page refresh failed', err));
      }, 250);
    },
    async refreshAfterRemoteChange(changedIds) {
      const workspaceId = this.activeWorkspaceId;
      if (!workspaceId) return;
      // Someone else set up the page that is showing the type picker here: open it as set up.
      // (Not while this browser is setting it up itself; updatePageSetup handles that.)
      const pageId = this.activePageId;
      if (pageId && changedIds.has(pageId) && this.currentPage?.setupStatus === 'PENDING' && !liveEvents.settingUp.has(pageId)) {
        await this.loadPageDoc(this.activePageId);
      }
      await this.loadPageList(workspaceId, { keepBin: true });
    },
    async loadPageDoc(pageId) {
      if (!pageId || !this.hasApi || !this.activeUser || this.deletingCascade) return;
      this.loadingDoc = true;
      const docRevisionAtStart = this.docRevision;
      try {
        const page =
          (await takePrefetchedPage(pageId)) ||
          (await api.getPage(pageId, {
            userId: this.activeUser?.id,
            userName: this.activeUser?.name,
          }));
        this.activePageId = pageId;
        this.activePageWorkspaceId = page.workspaceId || null;
        if (page.workspaceId && page.workspaceId !== this.activeWorkspaceId) {
          const entry = this.workspaces.find((item) => item.workspace?.id === page.workspaceId) || null;
          this.activeWorkspaceId = page.workspaceId;
          this.activeWorkspaceRole = entry?.role || this.activeWorkspaceRole;
          this.saveLastWorkspaceId(page.workspaceId);
          // The page list still belongs to the previous workspace (e.g. after opening a link)
          await this.loadPageList(page.workspaceId);
        }
        this.upsertPage(page);
        if (this.docRevision === docRevisionAtStart) {
          this.doc = normalizeEditorDoc(page.content);
        }
        const localTitle = this.pages.find((p) => p.id === pageId)?.title;
        this.titleDraft = localTitle || page.title || 'Untitled page';
        if (page.setupStatus === 'PENDING') {
          // Avoid creating collab docs for pages that haven't chosen a type yet.
          await this.updateCollabContext(null, null, null);
        } else {
          await this.updateCollabContext(page.workspaceId, page.id, page.kind);
        }
      } catch (err) {
        console.warn('Load page doc failed', err);
        this.error = err?.message || 'Failed to load page';
      } finally {
        this.loadingDoc = false;
      }
    },
    /** Starts loading a page the pointer is resting on in the sidebar (see loadPageDoc). */
    prefetchPage(pageId) {
      if (!pageId || pageId === this.activePageId || !this.hasApi || !this.activeUser) return;
      // The browser asks to save data (a setting, or a metered connection)
      if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return;
      const existing = prefetchedPages.get(pageId);
      if (existing && Date.now() - existing.at < PREFETCH_KEEP_MS) return;
      const promise = api
        .getPage(pageId, { userId: this.activeUser.id, userName: this.activeUser.name, priority: 'low' })
        .catch(() => null);
      prefetchedPages.set(pageId, { at: Date.now(), promise });
    },
    async selectWorkspaceById(workspaceId) {
      const entry = this.workspaces.find((item) => item.workspace?.id === workspaceId) || null;
      if (!entry?.workspace?.id) return;
      this.flushPendingTitleSave();
      this.activeWorkspaceId = entry.workspace.id;
      this.activeWorkspaceRole = entry.role || null;
      this.activePageWorkspaceId = entry.workspace.id;
      this.saveLastWorkspaceId(entry.workspace.id);
      this.activePageId = null;
      this.titleDraft = 'Untitled page';
      this.doc = fallbackDoc;
      await this.loadWorkspacePages(entry.workspace.id);
    },
    selectPage(page, options = {}) {
      if (!page || this.deletingCascade) return;
      if (page.isHidden && !options.allowHidden) return;
      this.flushPendingTitleSave();
      if (page.workspaceId && page.workspaceId !== this.activeWorkspaceId) {
        const entry = this.workspaces.find((item) => item.workspace?.id === page.workspaceId) || null;
        this.activeWorkspaceId = page.workspaceId;
        this.activeWorkspaceRole = entry?.role || this.activeWorkspaceRole;
        this.saveLastWorkspaceId(page.workspaceId);
      }
      this.activePageId = page.id;
      this.activePageWorkspaceId = page.workspaceId || null;
      const localTitle = page.title || this.pages.find((p) => p.id === page.id)?.title;
      this.titleDraft = localTitle || 'Untitled page';
      this.saveLastPageId(page.id);
      if (this.hasApi) {
        // Point live editing at the new page now, so its editor isn't first set up for the old one
        if (page.workspaceId && page.kind) {
          this.updateCollabContext(...(page.setupStatus === 'PENDING' ? [null, null, null] : [page.workspaceId, page.id, page.kind]));
        }
        this.loadPageDoc(page.id);
      } else {
        this.doc = fallbackDoc;
        this.titleDraft = this.currentPage?.title || 'Untitled page';
      }
    },
    logout() {
      api.logout().catch(() => {});
      this.activeUserId = null;
      this.activeUserName = null;
      this.activeUserEmail = null;
      this.mustChangePassword = false;
      this.sessionChecked = false;
      this.userPreferences = {};
      this.activePageId = null;
      this.activePageWorkspaceId = null;
      this.workspaces = [];
      this.activeWorkspaceId = null;
      this.activeWorkspaceRole = null;
      this.pendingTitleUpdates = {};
      this.pages = [];
      this.doc = fallbackDoc;
      this.titleDraft = 'Untitled page';
      this.hasApi = false;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('wikid:user');
        this.clearLastPageId();
      }
    },
    async login(email, password) {
      try {
        const res = await api.login({ login: email, password });
        this.activeUserId = res.user.id;
        this.activeUserName = res.user.displayName;
        this.activeUserEmail = res.user.email;
        this.mustChangePassword = !!res.user.mustChangePassword;
        this.setUserPreferences(res.user?.preferences || {});
        this.saveUserToStorage();
        await this.loadInitial();
      } catch (err) {
        console.warn('Login failed', err);
        this.error = err?.message || 'Login failed';
        throw err;
      }
    },
    async changePassword(currentPassword, newPassword) {
      await api.changePassword(this.activeUserId, currentPassword, newPassword);
      if (this.mustChangePassword) {
        this.mustChangePassword = false;
        this.saveUserToStorage();
        await this.loadInitial();
      }
    },
    // The API said this user must choose a new password (e.g. an admin reset it meanwhile).
    requirePasswordChange() {
      if (!this.activeUserId || this.mustChangePassword) return;
      this.mustChangePassword = true;
    },
    saveUserToStorage() {
      if (typeof localStorage === 'undefined' || !this.activeUserId) return;
      localStorage.setItem(
        'wikid:user',
        // Just enough to remember who's signed in. The rest (email, whether they must choose a new
        // password) comes from the server as the app loads.
        JSON.stringify({
          id: this.activeUserId,
          name: this.activeUserName,
        }),
      );
    },
    restoreUserFromStorage() {
      if (typeof localStorage === 'undefined') return;
      try {
        const raw = localStorage.getItem('wikid:user');
        const entry = raw ? JSON.parse(raw) : null;
        if (entry?.id) {
          this.activeUserId = entry.id;
          this.activeUserName = entry.name || entry.id;
          // Earlier versions also saved the email and the password-change flag here; save again without them
          if ('email' in entry || 'mustChangePassword' in entry) this.saveUserToStorage();
        }
      } catch {
        // ignore
      }
    },
    setApiStatus(available) {
      this.hasApi = !!available;
    },
    setUserPreferences(preferences) {
      if (preferences && typeof preferences === 'object' && !Array.isArray(preferences)) {
        this.userPreferences = { ...preferences };
      } else {
        this.userPreferences = {};
      }
    },
    async fetchUserPreferences() {
      if (!this.activeUser || !this.hasApi) return;
      try {
        const user = await api.getUser(this.activeUser.id, {
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
        this.setUserPreferences(user?.preferences || {});
        if (user?.email !== undefined) this.activeUserEmail = user.email || null;
      } catch (err) {
        console.warn('Load user preferences failed', err);
      }
    },
    async loadServerConfig() {
      try {
        const config = await api.getConfig();
        this.aiAvailable = !!config?.ai?.available;
      } catch (err) {
        console.warn('Load server config failed', err);
        this.aiAvailable = false;
      }
    },
    async setHideAiPreference(hidden) {
      const next = !!hidden;
      this.userPreferences = { ...this.userPreferences, hideAi: next };
      if (!this.activeUser || !this.hasApi) return;
      try {
        await api.updateUserPreferences(
          this.activeUser.id,
          { hideAi: next },
          { userId: this.activeUser.id, userName: this.activeUser.name }
        );
      } catch (err) {
        console.warn('Save user preferences failed', err);
      }
    },
    async setSidebarHiddenPreference(hidden) {
      const next = !!hidden;
      this.userPreferences = { ...this.userPreferences, sidebarHidden: next };
      if (!this.activeUser || !this.hasApi) return;
      try {
        await api.updateUserPreferences(
          this.activeUser.id,
          { sidebarHidden: next },
          { userId: this.activeUser.id, userName: this.activeUser.name }
        );
      } catch (err) {
        console.warn('Save user preferences failed', err);
      }
    },
    updateDoc(doc) {
      this.doc = normalizeEditorDoc(doc);
      this.docRevision += 1;
      if (this.activePageId) {
        const now = new Date().toISOString();
        this.updatePageInLists(this.activePageId, (p) => ({ ...p, updatedAt: now }));
      }
      if (this.collabActive) return; // Yjs manages persistence during collaboration
      this.scheduleSave();
    },
    beginSaving() {
      const started = Date.now();
      this.saving = true;
      return started;
    },
    finishSaving(started) {
      const MIN_SAVING_MS = 1000;
      const elapsed = Date.now() - (started || 0);
      const remaining = Math.max(0, MIN_SAVING_MS - elapsed);
      if (this.savingHold) {
        clearTimeout(this.savingHold);
      }
      this.savingHold = setTimeout(() => {
        this.saving = false;
        this.savingHold = null;
      }, remaining);
    },
    scheduleSave() {
      if (this.collabActive) return;
      if (!this.hasApi) return;
      if (this.pendingSave) {
        clearTimeout(this.pendingSave);
      }
      this.pendingSave = setTimeout(() => {
        this.saveDoc().catch((err) => console.warn('Save doc failed', err));
        this.pendingSave = null;
      }, 500);
    },
    async saveDoc() {
      if (this.collabActive) return;
      if (!this.activePageId || !this.activeUser) return;
      if (!this.canEditActiveWorkspace) return;
      const started = this.beginSaving();
      try {
        await api.updatePageContent(this.activePageId, normalizeEditorDoc(this.doc), {
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
      } finally {
        this.finishSaving(started);
      }
    },
    updateTitleDraft(title) {
      this.titleDraft = title;
      if (this.activePageId) {
        this.markPendingTitle(this.activePageId, title);
        this.updatePageInLists(this.activePageId, (p) => ({ ...p, title }));
      }
      const allowCollabSave =
        this.currentPage?.setupStatus === 'PENDING' || this.currentPage?.kind === 'DATABASE';
      if (this.collabActive && !allowCollabSave) return;
      this.scheduleTitleSave();
    },
    applyCollabTitle(title) {
      const next = typeof title === 'string' ? title : '';
      this.titleDraft = next;
      if (this.activePageId) {
        this.updatePageInLists(this.activePageId, (p) => ({ ...p, title: next }));
      }
    },
    applyCollabIcon(icon) {
      const next = typeof icon === 'string' && icon.length ? icon : null;
      if (this.activePageId) {
        this.updatePageInLists(this.activePageId, (p) => ({ ...p, icon: next }));
      }
    },
    async setPageIcon(page, icon) {
      if (!this.hasApi || !page?.id) return;
      if (!this.canEditActiveWorkspace) return;
      const nextIcon = icon || null;
      try {
        await api.updatePageIcon(page.id, nextIcon, {
          userId: this.activeUser?.id,
          userName: this.activeUser?.name,
        });
        this.updatePageInLists(page.id, (p) => ({ ...p, icon: nextIcon }));
      } catch (err) {
        console.warn('Set icon failed', err);
        this.error = err?.message || 'Failed to set icon';
      }
    },
    scheduleTitleSave() {
      const allowCollabSave =
        this.currentPage?.setupStatus === 'PENDING' || this.currentPage?.kind === 'DATABASE';
      if (this.collabActive && !allowCollabSave) return;
      if (!this.hasApi) return;
      if (this.pendingTitleSave) {
        clearTimeout(this.pendingTitleSave);
      }
      // Capture the page id and title now so the debounced save targets the correct page
      // even if the user navigates away before the timer fires.
      const pageId = this.activePageId;
      const title = this.titleDraft || '';
      this.pendingTitleSave = setTimeout(() => {
        this.saveTitleFor(pageId, title).catch((err) => console.warn('Save title failed', err));
        this.pendingTitleSave = null;
      }, 400);
    },
    flushPendingTitleSave() {
      if (this.pendingTitleSave) {
        clearTimeout(this.pendingTitleSave);
        this.pendingTitleSave = null;
      }
      // Persist any pages that still have pending title updates
      const pending = this.pendingTitleUpdates || {};
      for (const [pageId, entry] of Object.entries(pending)) {
        if (typeof entry?.title === 'string') {
          this.saveTitleFor(pageId, entry.title).catch((err) => console.warn('Flush title save failed', err));
        }
      }
    },
    async saveTitleFor(pageId, title) {
      if (!pageId) return;
      if (!this.canEditActiveWorkspace) return;
      const started = this.beginSaving();
      try {
        await api.updatePageTitle(pageId, title, {
          userId: this.activeUser?.id,
          userName: this.activeUser?.name,
        });
        this.updatePageInLists(pageId, (p) => ({ ...p, title }));
        this.clearPendingTitle(pageId, title);
      } finally {
        this.finishSaving(started);
      }
    },
    async saveTitle() {
      return this.saveTitleFor(this.activePageId, this.titleDraft || '');
    },
    markPendingTitle(pageId, title) {
      if (!pageId) return;
      const nextTitle = typeof title === 'string' ? title : title == null ? '' : String(title);
      this.pendingTitleUpdates = {
        ...this.pendingTitleUpdates,
        [pageId]: { title: nextTitle, ts: Date.now() },
      };
    },
    clearPendingTitle(pageId, title) {
      if (!pageId) return;
      const entry = this.pendingTitleUpdates?.[pageId];
      if (!entry) return;
      if (title != null && entry.title !== title) return;
      const next = { ...(this.pendingTitleUpdates || {}) };
      delete next[pageId];
      this.pendingTitleUpdates = next;
    },
    upsertPage(page) {
      const existing = this.pages.find((p) => p.id === page.id);
      const pending = this.pendingTitleUpdates?.[page.id] || null;
      let nextPage = existing ? { ...existing, ...page } : page;
      if (pending && typeof pending.title === 'string') {
        if ((page.title ?? '') === pending.title) {
          this.clearPendingTitle(page.id);
        } else {
          nextPage = { ...nextPage, title: pending.title };
          if (existing?.updatedAt) {
            nextPage.updatedAt = existing.updatedAt;
          }
        }
      }
      this.pages = existing
        ? this.pages.map((p) => (p.id === page.id ? nextPage : p))
        : [...this.pages, nextPage];
    },
    updatePageInLists(pageId, updater) {
      this.pages = this.pages.map((p) => (p.id === pageId ? updater(p) : p));
      this.binPages = this.binPages.map((p) => (p.id === pageId ? updater(p) : p));
    },
    async createPageInActiveWorkspace({ title, kind, visibility, parentId, setupStatus, complianceMode } = {}) {
      if (!this.activeUser || !this.hasApi || !this.activeWorkspaceId) {
        this.error = 'API unavailable, no user logged in, or no workspace selected.';
        return null;
      }
      if (!this.canEditActiveWorkspace) {
        this.error = 'Viewer access cannot create pages.';
        return null;
      }
      try {
        const newPage = await api.createPage({
          workspaceId: this.activeWorkspaceId,
          title: title || 'Untitled page',
          kind: kind || 'DOC',
          visibility,
          parentId: parentId ?? undefined,
          setupStatus,
          ...(typeof complianceMode === 'boolean' ? { complianceMode } : {}),
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
        this.pages = [newPage, ...this.pages];
        this.selectPage(newPage);
        return newPage;
      } catch (err) {
        console.warn('Create page failed', err);
        this.error = err?.message || 'Failed to create page';
        return null;
      }
    },
    async addPageToPrivateSection() {
      return this.createPageInActiveWorkspace({ title: 'Untitled page', visibility: 'PRIVATE' });
    },
    async addDatabaseToPrivateSection() {
      return this.createPageInActiveWorkspace({ title: 'Untitled database', kind: 'DATABASE', visibility: 'PRIVATE' });
    },
    async addPageToPublicSection() {
      return this.createPageInActiveWorkspace({ title: 'Untitled page', visibility: 'PUBLIC' });
    },
    async addDatabaseToPublicSection() {
      return this.createPageInActiveWorkspace({ title: 'Untitled database', kind: 'DATABASE', visibility: 'PUBLIC' });
    },
    async createSetupPage(visibility) {
      return this.createPageInActiveWorkspace({ title: 'Untitled page', visibility, kind: 'DOC', setupStatus: 'PENDING' });
    },
    async updatePageSetup(pageId, payload = {}) {
      if (!this.hasApi || !this.activeUser || !pageId) return null;
      if (!this.canEditActiveWorkspace) return null;
      liveEvents.settingUp.add(pageId);
      try {
        const updated = await api.updatePageSetup(pageId, payload, {
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
        this.upsertPage(updated);
        if (this.activePageId === pageId) {
          this.activePageWorkspaceId = updated.workspaceId || this.activePageWorkspaceId;
          await this.updateCollabContext(updated.workspaceId, updated.id, updated.kind);
        }
        return updated;
      } catch (err) {
        // Someone else set the type first: show the page as they set it up
        if (/Setup already completed|only be changed while setup is pending/.test(err?.message || '')) {
          await this.loadPageDoc(pageId);
          return this.currentPage || null;
        }
        console.warn('Update page setup failed', err);
        this.error = err?.message || 'Failed to update page setup';
        return null;
      } finally {
        liveEvents.settingUp.delete(pageId);
      }
    },
    async convertPageToWiki(pageId) {
      if (!this.hasApi || !this.activeUser || !pageId) return null;
      if (!this.canEditActiveWorkspace) return null;
      try {
        const res = await api.convertPageToWiki(pageId, {
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
        if (res?.page) {
          this.upsertPage(res.page);
        }
        if (res?.databasePage) {
          this.upsertPage(res.databasePage);
        }
        if (this.activeWorkspaceId) {
          const pages = await api.listPages({
            workspaceId: this.activeWorkspaceId,
            userId: this.activeUser.id,
            userName: this.activeUser.name,
          });
          if (Array.isArray(pages)) {
            this.pages = pages;
          }
        }
        return res;
      } catch (err) {
        console.warn('Convert to wiki failed', err);
        this.error = err?.message || 'Failed to convert page to wiki';
        return null;
      }
    },
    async updateCollabContext(workspaceId, pageId, pageKind) {
      if (!workspaceId || !pageId || !this.activeUser || !this.hasApi) {
        this.collabToken = null;
        this.collabDocName = null;
        this.collabWorkspaceId = null;
        return;
      }
      const entry = this.workspaces.find((item) => item.workspace?.id === workspaceId) || null;
      const role = entry?.role || this.activeWorkspaceRole;
      if (role === 'VIEWER') {
        this.collabToken = null;
        this.collabDocName = null;
        this.collabWorkspaceId = null;
        return;
      }
      const scope = pageKind === 'DATABASE' ? 'db' : null;
      const docName = scope ? `ws:${workspaceId}:${scope}:${pageId}` : `ws:${workspaceId}:${pageId}`;
      const tokenEntry = collabTokenFor(this.activeUser, workspaceId);
      this.collabWorkspaceId = workspaceId;
      this.collabDocName = docName;
      if (tokenEntry.token) {
        this.collabToken = tokenEntry.token;
        return;
      }
      this.collabToken = null;
      try {
        const token = await tokenEntry.promise;
        // Another page may have been opened while this was on its way
        if (this.collabDocName !== docName) return;
        this.collabToken = token;
      } catch (err) {
        console.warn('Collab token fetch failed', err);
        if (this.collabDocName !== docName) return;
        this.collabToken = null;
        this.collabDocName = null;
        this.collabWorkspaceId = null;
      }
    },
    async addChildPage(parentPage) {
      if (!this.activeUser || !this.hasApi) {
        this.error = 'API unavailable or no user logged in.';
        return null;
      }
      const newPage = await this.createChildPageRecord(parentPage);
      if (newPage) {
        this.selectPage(newPage);
      }
      return newPage || null;
    },
    async createChildPageRecord(parentPage) {
      if (!this.activeUser || !this.hasApi) {
        this.error = 'API unavailable or no user logged in.';
        return null;
      }
      if (!this.canEditActiveWorkspace) {
        this.error = 'Viewer access cannot create pages.';
        return null;
      }
      try {
        const newPage = await api.createPage({
          workspaceId: parentPage.workspaceId,
          parentId: parentPage.id,
          title: 'Untitled page',
          visibility: parentPage.visibility || 'PUBLIC',
          userId: this.activeUser.id,
          userName: this.activeUser.name,
          setupStatus: 'PENDING',
        });
        this.upsertPage(newPage);
        return newPage;
      } catch (err) {
        console.warn('Create child page failed', err);
        this.error = err?.message || 'Failed to create page';
        return null;
      }
    },
    async duplicatePage(page) {
      if (!this.hasApi || !this.activeUser) return;
      if (!this.canEditActiveWorkspace) return;
      try {
        const original = await api.getPage(page.id, {
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
        const kind = original?.kind === 'DATABASE' ? 'DATABASE' : 'DOC';
        const newPage = await api.createPage({
          workspaceId: page.workspaceId,
          title: `${page.title || 'Untitled'} copy`,
          kind,
          visibility: page.visibility || 'PUBLIC',
          userId: this.activeUser.id,
          userName: this.activeUser.name,
        });
        if (kind !== 'DATABASE') {
          await api.updatePageContent(newPage.id, original.content, {
            userId: this.activeUser.id,
            userName: this.activeUser.name,
          });
          this.upsertPage({ ...newPage, content: original.content });
        } else {
          this.upsertPage(newPage);
        }
        this.selectPage(newPage);
      } catch (err) {
        console.warn('Duplicate page failed', err);
        this.error = err?.message || 'Failed to duplicate page';
      }
    },
    getDescendantIds(rootId) {
      if (!rootId) return [];
      const allPages = [...this.pages, ...this.binPages];
      const childrenMap = new Map();
      allPages.forEach((page) => {
        const parentId = page.parentId ?? null;
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId).push(page.id);
      });
      const stack = [rootId];
      const descendants = [];
      while (stack.length) {
        const current = stack.pop();
        const children = childrenMap.get(current) || [];
        children.forEach((childId) => {
          descendants.push(childId);
          stack.push(childId);
        });
      }
      return descendants;
    },
    async renamePage(page, title) {
      if (!this.hasApi) return;
      if (!this.canEditActiveWorkspace) return;
      const nextTitle = title || 'Untitled page';
      try {
        await api.updatePageTitle(page.id, nextTitle, {
          userId: this.activeUser?.id,
          userName: this.activeUser?.name,
        });
        this.updatePageInLists(page.id, (p) => ({ ...p, title: nextTitle }));
        this.titleDraft = nextTitle;
      } catch (err) {
        console.warn('Rename page failed', err);
        this.error = err?.message || 'Failed to rename page';
      }
    },
    async movePageVisibility(page, visibility) {
      if (!this.hasApi) return;
      if (!this.canEditActiveWorkspace) return;
      const pageId = typeof page === 'string' ? page : page?.id;
      if (!pageId) return;
      const target = visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC';
      const user = this.activeUser;
      if (!user) return;
      const entry = typeof page === 'string' ? this.pages.find((p) => p.id === pageId) : page;
      const descendantIds = this.getDescendantIds(pageId);
      const idsFallback = [pageId, ...descendantIds];
      const parent = entry?.parentId ? this.pages.find((p) => p.id === entry.parentId) : null;
      try {
        const res = await api.updatePageVisibility(pageId, target, {
          userId: user.id,
          userName: user.name,
        });
        const updatedIds = Array.isArray(res?.updatedIds) ? res.updatedIds : idsFallback;
        const updatedSet = new Set(updatedIds);
        const updatedRoot = res?.page || null;
        const shouldDetach = parent && parent.visibility !== target;
        this.pages = this.pages.map((p) => {
          if (!updatedSet.has(p.id)) return p;
          const next = { ...p, visibility: target };
          if (target === 'PRIVATE') {
            next.authorId = user.id;
          }
          if (p.id === pageId) {
            if (updatedRoot?.parentId !== undefined) {
              next.parentId = updatedRoot.parentId;
            } else if (shouldDetach) {
              next.parentId = null;
            }
            if (updatedRoot?.position !== undefined) {
              next.position = updatedRoot.position;
            }
          }
          return next;
        });
      } catch (err) {
        console.warn('Move page visibility failed', err);
        this.error = err?.message || 'Failed to move page visibility';
      }
    },
    async movePageToWorkspace(pageId, targetWorkspaceId) {
      const user = this.activeUser;
      if (!user || !this.hasApi) return;
      const res = await api.movePageToWorkspace(pageId, targetWorkspaceId, {
        userId: user.id,
        userName: user.name,
      });
      const movedSet = new Set(Array.isArray(res?.movedIds) ? res.movedIds : [pageId]);
      // Remove moved pages from current workspace list
      if (this.activePageId && movedSet.has(this.activePageId)) {
        this.activePageId = null;
        this.doc = fallbackDoc;
        this.titleDraft = 'Untitled page';
      }
      this.pages = this.pages.filter((p) => !movedSet.has(p.id));
      return res;
    },
    removePage(pageId, options = {}) {
      const { skipSelect = false } = options;
      const pageToBin = this.pages.find((p) => p.id === pageId) || null;
      this.pages = this.pages.filter((p) => p.id !== pageId);
      if (pageToBin) {
        this.binPages = [...this.binPages.filter((p) => p.id !== pageId), { ...pageToBin, isDeleted: true, deletedAt: new Date().toISOString() }];
      }
      if (!skipSelect && this.activePageId === pageId) {
        const next = this.pages[0] || null;
        if (next) {
          this.selectPage(next);
        } else {
          this.activePageId = null;
          this.doc = fallbackDoc;
          this.titleDraft = 'Untitled page';
        }
      }
    },
    async deletePage(page) {
      return this.deletePageCascade(page);
    },
    async deletePageCascade(page) {
      if (!this.hasApi) return;
      if (!this.canEditActiveWorkspace) return;
      const pageId = typeof page === 'string' ? page : page?.id;
      if (!pageId) return;
      const descendantIds = this.getDescendantIds(pageId);
      const idsToDelete = new Set([...descendantIds, pageId]);
      const remaining = this.pages.filter((p) => !idsToDelete.has(p.id) && !p.isHidden && !p.isDeleted);
      const nextPage = remaining[0] || null;
      // Navigate away first, before setting deletingCascade (which blocks selectPage)
      if (nextPage) {
        this.selectPage(nextPage);
      } else {
        this.activePageId = null;
        this.activePageWorkspaceId = null;
        this.doc = fallbackDoc;
        this.titleDraft = 'Untitled page';
        this.clearLastPageId();
      }
      try {
        this.deletingCascade = true;
        // Backend cascades to descendants, so only delete the root page
        await api.deletePage(pageId, { userId: this.activeUser?.id, userName: this.activeUser?.name });
        for (const id of idsToDelete) {
          this.removePage(id, { skipSelect: true });
        }
      } catch (err) {
        console.warn('Delete page failed', err);
        this.error = err?.message || 'Failed to delete page';
      } finally {
        this.deletingCascade = false;
      }
    },
    // The open page was moved to the Bin by someone else: put it (and the page it was deleted with) back.
    async restoreRemotelyDeletedPage() {
      const deletion = this.remoteDeletion;
      if (!deletion || !this.hasApi || !this.canEditActiveWorkspace) return;
      try {
        await api.restorePage(deletion.pageId, { userId: this.activeUser?.id, userName: this.activeUser?.name });
        this.remoteDeletion = null;
        if (this.activeWorkspaceId) await this.loadPageList(this.activeWorkspaceId, { keepBin: true });
      } catch (err) {
        console.warn('Restore page failed', err);
        this.error = err?.message || 'Failed to restore page';
      }
    },
    // ...or leave it, opening another page in the same workspace.
    leaveRemotelyDeletedPage() {
      const deletedIds = new Set(this.remoteDeletion?.pageIds || []);
      this.remoteDeletion = null;
      const next = this.pages.find(
        (p) => p.workspaceId === this.activeWorkspaceId && !p.isDeleted && !p.isHidden && !deletedIds.has(p.id)
      );
      if (next) {
        this.selectPage(next);
      } else {
        this.activePageId = null;
        this.activePageWorkspaceId = null;
        this.doc = fallbackDoc;
        this.titleDraft = 'Untitled page';
        this.clearLastPageId();
      }
    },
    async loadBinPages() {
      if (!this.activeUser || !this.hasApi) return;
      try {
        if (!this.activeWorkspaceId) return;
        const bin = await api.listPages({
          workspaceId: this.activeWorkspaceId,
          userId: this.activeUser.id,
          userName: this.activeUser.name,
          state: 'bin',
          includeDeleted: true,
        });
        this.binPages = Array.isArray(bin) ? bin : [];
      } catch (err) {
        console.warn('Load bin failed', err);
        this.error = err?.message || 'Failed to load bin';
      }
    },
    clearBinState() {
      this.binPages = [];
    },
    // Restores a page (with its sub-pages) from the Bin. If a page above it is still in the Bin, nothing
    // happens and this returns { parentsInBin } (nearest first), so the caller can ask whether to bring
    // those back too ({ placement: 'withParents' }) or put the page at the top level ('topLevel').
    async restorePageFromBin(page, { placement } = {}) {
      if (!this.hasApi) return null;
      const pageId = typeof page === 'string' ? page : page?.id;
      if (!pageId) return null;
      try {
        const res = await api.restorePage(
          pageId,
          { userId: this.activeUser?.id, userName: this.activeUser?.name },
          { placement }
        );
        // The server restores the page with its sub-pages, and with its parents if asked
        const restoredIds = new Set(Array.isArray(res?.restoredIds) ? res.restoredIds : [pageId]);
        let added = true;
        while (added) {
          added = false;
          for (const p of this.binPages) {
            if (!restoredIds.has(p.id) && restoredIds.has(p.parentId)) {
              restoredIds.add(p.id);
              added = true;
            }
          }
        }
        const restored = this.binPages
          .filter((p) => restoredIds.has(p.id))
          .map((p) => ({
            ...p,
            isDeleted: false,
            deletedAt: null,
            ...(res?.movedToTopLevel && p.id === pageId ? { parentId: null } : {}),
          }));
        this.binPages = this.binPages.filter((p) => !restoredIds.has(p.id));
        this.pages = [...restored, ...this.pages.filter((p) => !restoredIds.has(p.id))];
        if (res?.movedToTopLevel && this.activeWorkspaceId) {
          // Its new place among the top-level pages comes from the server
          await this.loadPageList(this.activeWorkspaceId, { keepBin: true });
        }
        return { restored: true, movedToTopLevel: !!res?.movedToTopLevel };
      } catch (err) {
        if (err?.status === 409 && err?.body?.code === 'PARENT_IN_BIN') {
          return { parentsInBin: Array.isArray(err.body.parents) ? err.body.parents : [] };
        }
        console.warn('Restore page failed', err);
        this.error = err?.message || 'Failed to restore page';
        return null;
      }
    },
    async destroyBin(ids) {
      if (!this.hasApi) return;
      const targetIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
      if (!targetIds.length) return;
      try {
        await api.destroyPages(targetIds, { userId: this.activeUser?.id, userName: this.activeUser?.name });
        this.binPages = this.binPages.filter((p) => !targetIds.includes(p.id));
      } catch (err) {
        console.warn('Destroy bin failed', err);
        this.error = err?.message || 'Failed to delete pages permanently';
      }
    },
  },
});
