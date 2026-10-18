// PROTOTYPE switcher bar: a fixed pill at the bottom of the dev editor that
// cycles one URL parameter through a prototype's variants (← label →, or the
// ← and → keys when nothing editable is focused). Each switch rewrites the
// parameter with history.replaceState, so the URL stays shareable and a
// reload keeps the variant, then calls onChange. Used by build-client.ts for
// ?walls= (skeletyl-walls.prototype.ts).

export interface Switcher {
  /** Shows or hides the bar (and its keys). */
  show(on: boolean): void;
}

export function prototypeSwitcher(o: {
  /** The URL parameter, also the label's prefix. The first option is its default, written as no parameter. */
  param: string;
  options: readonly { key: string; name: string }[];
  onChange: () => void;
}): Switcher {
  const bar = document.createElement('div');
  bar.id = `prototype-switcher-${o.param}`;
  bar.title = `PROTOTYPE: ?${o.param}= (← / → to switch)`;
  bar.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:14px',
    'transform:translateX(-50%)',
    'z-index:1000',
    'display:none',
    'align-items:center',
    'gap:4px',
    'padding:4px 6px',
    'border-radius:999px',
    'background:#111',
    'color:#ffe600',
    'border:2px dashed #ffe600',
    'font:600 14px/1.2 ui-monospace,Menlo,monospace',
    'box-shadow:0 2px 10px rgba(0,0,0,.4)',
    'user-select:none',
  ].join(';');
  const button = (text: string, step: number) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText =
      'all:unset;cursor:pointer;padding:2px 10px;border-radius:999px;color:inherit;font:inherit';
    b.onclick = () => go(step);
    return b;
  };
  const label = document.createElement('span');
  label.style.cssText = 'min-width:16em;text-align:center';
  bar.append(button('←', -1), label, button('→', 1));
  document.body.append(bar);

  const current = () => new URLSearchParams(location.search).get(o.param) ?? o.options[0].key;
  const draw = () => {
    const key = current();
    const option = o.options.find((v) => v.key === key);
    label.textContent = `${o.param}: ${key} (${option?.name ?? 'unknown'})`;
  };
  const go = (step: number) => {
    const n = o.options.length;
    const at = o.options.findIndex((v) => v.key === current());
    const next = o.options[((((at < 0 ? 0 : at) + step) % n) + n) % n];
    const url = new URL(location.href);
    if (next === o.options[0]) url.searchParams.delete(o.param);
    else url.searchParams.set(o.param, next.key);
    history.replaceState(history.state, '', url);
    draw();
    o.onChange();
  };
  addEventListener('keydown', (e) => {
    if (bar.style.display === 'none' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if ((e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable]')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    go(e.key === 'ArrowLeft' ? -1 : 1);
  });
  draw();
  return {
    show(on) {
      bar.style.display = on ? 'flex' : 'none';
    },
  };
}
