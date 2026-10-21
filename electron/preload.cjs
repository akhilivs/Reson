// Narrow, typed bridge between the renderer and the main process.
// No filesystem, shell, or raw ipcRenderer access is exposed.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error(res?.error || 'Request failed');
  return res.data;
}

function subscribe(channel) {
  return (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('vela', {
  env: { quiet: process.argv.includes('--reson-quiet') },
  library: {
    getFolders: () => call('library:getFolders'),
    addFolders: () => call('library:addFolders'),
    removeFolder: (id) => call('library:removeFolder', id),
    rescan: (opts) => call('library:rescan', opts),
    cancelScan: () => call('library:cancelScan'),
    status: () => call('library:status'),
    stats: () => call('library:stats'),
    listTracks: (query) => call('library:listTracks', query),
    getTracks: (ids) => call('library:getTracks', ids),
    listAlbums: (query) => call('library:listAlbums', query),
    getAlbum: (id) => call('library:getAlbum', id),
    listArtists: (query) => call('library:listArtists', query),
    getArtist: (id) => call('library:getArtist', id),
    search: (q) => call('library:search', q),
    home: () => call('library:home'),
    reveal: (id) => call('library:reveal', id),
    lyrics: (id) => call('library:lyrics', id),
    removeMissing: () => call('library:removeMissing'),
    prepare: (ids) => call('library:prepare', ids),
    onScanProgress: subscribe('library:scanProgress'),
    onChanged: subscribe('library:changed'),
  },
  favorites: {
    set: (ids, value) => call('favorites:set', ids, value),
  },
  playlists: {
    list: () => call('playlists:list'),
    get: (id) => call('playlists:get', id),
    smart: (key) => call('playlists:smart', key),
    create: (name, ids) => call('playlists:create', name, ids),
    rename: (id, name) => call('playlists:rename', id, name),
    remove: (id) => call('playlists:delete', id),
    addTracks: (id, ids) => call('playlists:add', id, ids),
    removeEntries: (id, entryIds) => call('playlists:remove', id, entryIds),
    reorder: (id, entryIds) => call('playlists:reorder', id, entryIds),
  },
  history: {
    record: (id, listened) => call('history:record', id, listened),
  },
  settings: {
    get: () => call('settings:get'),
    set: (key, value) => call('settings:set', key, value),
    onChanged: subscribe('settings:changed'),
  },
  player: {
    publish: (state) => call('player:publish', state),
    command: (cmd) => call('player:command', cmd),
    getState: () => call('player:getState'),
    onState: subscribe('player:state'),
    onCommand: subscribe('player:command'),
  },
  windows: {
    showMini: () => call('window:showMini'),
    hideMini: () => call('window:hideMini'),
    toggleMini: () => call('window:toggleMini'),
    showMain: () => call('window:showMain'),
    miniVisible: () => call('window:miniVisible'),
    setFullScreen: (value) => call('window:setFullScreen', value),
    onMiniVisibility: subscribe('window:miniVisibility'),
  },
  app: {
    info: () => call('app:info'),
    storage: () => call('app:storage'),
    quit: () => call('app:quit'),
    openDataFolder: () => call('app:openDataFolder'),
    cleanArtworkCache: () => call('app:cleanArtworkCache'),
    clearConvertedAudio: () => call('app:clearConvertedAudio'),
  },
});
