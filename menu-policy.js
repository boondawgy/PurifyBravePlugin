// Plex reuses menu containers for sorting, libraries, submenus, and media actions.
// Require the native actions shared by the two requested movie menus.
globalThis.PurifyMenuPolicy = Object.freeze({
  isMovieActionMenu(labels) {
    const actions = new Set(labels.map(label => label.replace(/\s+/g, ' ').trim()));
    return ['Get Info', 'Refresh Metadata', 'Analyze'].every(label => actions.has(label));
  }
});
