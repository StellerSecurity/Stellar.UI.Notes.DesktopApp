// Only fixed status names and rounded percentages cross into the renderer.
function createUpdateStatus(getWindow) {
  let state = { phase: 'idle', percent: null };
  const phases = new Set(['idle', 'downloading', 'verifying', 'installing', 'error']);
  return {
    snapshot: () => ({ ...state }),
    set(phase, percent = null) {
      if (!phases.has(phase)) return;
      percent = phase === 'downloading' && typeof percent === 'number' && Number.isFinite(percent)
        ? Math.round(Math.max(0, Math.min(100, percent))) : null;
      if (state.phase === phase && state.percent === percent) return;
      state = { phase, percent };
      const win = getWindow();
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('stellar-update-status', { ...state });
      }
    }
  };
}
module.exports = { createUpdateStatus };
