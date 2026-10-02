const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('niuai', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  getConversations: () => ipcRenderer.invoke('conv:get'),
  setConversations: (c) => ipcRenderer.invoke('conv:set', c),
  loadAvatar: (model) => ipcRenderer.invoke('avatar:load', model),
  avatarInfo: (model) => ipcRenderer.invoke('avatar:info', model),
  avatarList: () => ipcRenderer.invoke('avatar:list'),
  avatarPick: () => ipcRenderer.invoke('avatar:pick'),
  avatarOpenFolder: () => ipcRenderer.invoke('avatar:open-folder'),
  ttsSynth: (opts) => ipcRenderer.invoke('tts:synth', opts),
  ttsInfo: () => ipcRenderer.invoke('tts:info'),
  ttsVoices: () => ipcRenderer.invoke('tts:voices'),
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsInstall: (opts) => ipcRenderer.invoke('skills:install', opts),
  skillsRemove: (id) => ipcRenderer.invoke('skills:remove', id),
  skillsRead: (opts) => ipcRenderer.invoke('skills:read', opts),
  skillsOpenFolder: () => ipcRenderer.invoke('skills:open-folder'),
  webSearch: (opts) => ipcRenderer.invoke('search:web', opts),
  fetchPage: (opts) => ipcRenderer.invoke('search:fetch', opts),
  // 火星小厨房：人设档案（Skill.md / A.md / shtu / 档位映射）
  marsProfile: () => ipcRenderer.invoke('mars:profile'),
  marsOpenFolder: () => ipcRenderer.invoke('mars:open-folder'),
  marsResetProfile: () => ipcRenderer.invoke('mars:reset-profile'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
