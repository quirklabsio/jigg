// Keyboard shortcuts reference panel — triggered by ? key.
// DOM modal overlay: role="dialog", aria-modal="true", focus trap, focus restore on close.
// Read-only content — no interactive elements beyond a single close button.

export const SHORTCUTS_PANEL_ID = 'shortcuts-panel';

let _overlay:       HTMLElement | null = null;
let _previousFocus: Element     | null = null;
let _open = false;

export function isShortcutsPanelOpen(): boolean {
  return _open;
}

/**
 * Build and attach the shortcuts panel to document.body.
 * Idempotent — safe to call multiple times.
 */
export function initShortcutsPanel(): void {
  if (_overlay) return;

  // ── Backdrop ────────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = SHORTCUTS_PANEL_ID;
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'align-items:center',
    'justify-content:center',
    'background:rgba(0,0,0,0.55)',
    'z-index:2000',
    'display:none',
  ].join(';');

  // ── Dialog ──────────────────────────────────────────────────────────────────
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Keyboard shortcuts');
  dialog.style.cssText = [
    'background:#1e1e2a',
    'color:#e0e0f0',
    'font-family:monospace',
    'font-size:13px',
    'padding:24px 32px',
    'border-radius:8px',
    'max-width:440px',
    'max-height:85vh',
    'width:90%',
    'overflow-y:auto',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    'position:relative',
    'outline:none',
  ].join(';');

  // ── Close button (pointer / mouse users) ───────────────────────────────────
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close keyboard shortcuts');
  closeBtn.style.cssText = [
    'position:absolute',
    'top:12px',
    'right:16px',
    'background:none',
    'border:none',
    'color:#aaaacc',
    'font-size:22px',
    'line-height:1',
    'padding:0',
    'cursor:pointer',
  ].join(';');
  closeBtn.addEventListener('click', closeShortcutsPanel);

  // ── Scoped styles ──────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
#${SHORTCUTS_PANEL_ID} .key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6em;
  height: 1.6em;
  padding: 0 0.4em;
  font-size: 0.85em;
  font-weight: 600;
  line-height: 1;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  box-shadow: inset 0 -1px 0 rgba(255,255,255,0.1);
}
#${SHORTCUTS_PANEL_ID} .key-group {
  display: inline-flex;
  gap: 4px;
  margin-right: 8px;
}
#${SHORTCUTS_PANEL_ID} table td {
  vertical-align: middle;
}
`;
  document.head.appendChild(style);

  // ── Content helpers ────────────────────────────────────────────────────────
  /** Wrap one or more key labels as keycap spans inside a key-group. */
  function keys(...labels: string[]): string {
    return `<span class="key-group">${labels.map((k) => `<span class="key">${k}</span>`).join('')}</span>`;
  }

  function row(keyCells: string, desc: string): string {
    return `<tr>
      <td style="padding:4px 0;white-space:nowrap">${keyCells}</td>
      <td style="padding:4px 0 4px 8px;color:#888899">${desc}</td>
    </tr>`;
  }

  // ── Content ────────────────────────────────────────────────────────────────
  const content = document.createElement('div');
  content.innerHTML = `
<h2 style="margin:0 0 18px;font-size:14px;color:#ffffff;letter-spacing:0.04em;text-transform:uppercase">Keyboard shortcuts</h2>

<h3 style="margin:0 0 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#aaaacc">Piece tray</h3>
<table style="border-collapse:collapse;width:100%;margin-bottom:14px">
  ${row(`${keys('Tab')}${keys('Shift', 'Tab')}`, 'Navigate pieces')}
  ${row(keys('[', ']'), 'Next / prev filter')}
  ${row(keys('Enter'), 'Move to table')}
</table>

<h3 style="margin:0 0 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#aaaacc">Table</h3>
<table style="border-collapse:collapse;width:100%;margin-bottom:14px">
  ${row(`${keys('Tab')}${keys('Shift', 'Tab')}`, 'Navigate pieces')}
  ${row(keys('Enter'), 'Pick up / put down')}
  ${row(keys('R'), 'Rotate')}
  ${row(keys('Escape'), 'Drop')}
</table>

<h3 style="margin:0 0 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#aaaacc">Global</h3>
<table style="border-collapse:collapse;width:100%">
  ${row(keys('T'), 'Piece tray / table')}
  ${row(keys('Shift', 'B'), 'Change background')}
  ${row(keys('?'), 'Show shortcuts')}
</table>
`;

  dialog.appendChild(closeBtn);
  dialog.appendChild(content);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  _overlay = overlay;

  // ── Focus trap ─────────────────────────────────────────────────────────────
  // Close button is the only tabbable element — Tab just cycles back to it.
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeShortcutsPanel();
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      closeShortcutsPanel();
      return;
    }
    if (e.key === 'Tab') {
      // Only one focusable element — prevent leaving the modal.
      e.preventDefault();
      closeBtn.focus();
    }
  });

  // Click backdrop to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeShortcutsPanel();
  });
}

export function openShortcutsPanel(): void {
  if (!_overlay || _open) return;
  _previousFocus = document.activeElement;
  _overlay.style.display = 'flex';
  _open = true;
  // Focus the close button so keyboard users have an immediate target
  const closeBtn = _overlay.querySelector<HTMLButtonElement>('button');
  requestAnimationFrame(() => closeBtn?.focus());
}

export function closeShortcutsPanel(): void {
  if (!_overlay || !_open) return;
  _overlay.style.display = 'none';
  _open = false;
  // Restore focus to wherever the user was before opening
  if (_previousFocus instanceof HTMLElement) {
    _previousFocus.focus();
  }
  _previousFocus = null;
}

export function toggleShortcutsPanel(): void {
  if (_open) closeShortcutsPanel();
  else openShortcutsPanel();
}
