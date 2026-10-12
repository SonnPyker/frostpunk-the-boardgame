// Shared HUD plumbing: pickable ids, delegated tooltips (rules text), collapsible panel frame.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { t, tn } from '../i18n';
import { Icon } from './icons';
import type { IconName } from './model';
import { readFlag, writeFlag } from './storage';

export interface HudCtx {
  pickable: ReadonlySet<string>;
  onPick?: (id: string) => void;
}

const EMPTY: ReadonlySet<string> = new Set<string>();
export const HudContext = createContext<HudCtx>({ pickable: EMPTY });

/** Pick state for one object id (card id, building uid, space id ...). */
export function usePick(id: string | number | null | undefined) {
  const { pickable, onPick } = useContext(HudContext);
  const key = id === null || id === undefined ? null : String(id);
  const on = key !== null && pickable.has(key);
  const activate = useCallback(() => {
    if (key !== null && on) onPick?.(key);
  }, [key, on, onPick]);
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    },
    [activate],
  );
  const handlers = on
    ? { onClick: activate, onKeyDown, tabIndex: 0, role: 'button' as const, 'data-pick': key ?? undefined }
    : {};
  return { on, handlers };
}

/** Attributes that the global TipLayer reads. Spread on any element to attach rules text. */
export function tip(text: string | null | undefined): { 'data-tip'?: string } {
  return text ? { 'data-tip': text } : {};
}

/** One floating tooltip for the whole HUD. Delegated, so panels never re-render for hovers. */
export function TipLayer() {
  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'hud-tip';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    let current: HTMLElement | null = null;

    const place = (target: HTMLElement) => {
      const r = target.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
    };
    const show = (target: HTMLElement | null) => {
      if (target === current) return;
      current = target;
      const text = target?.getAttribute('data-tip') ?? '';
      if (!target || !text) {
        el.classList.remove('on');
        return;
      }
      el.textContent = text;
      el.classList.add('on');
      place(target);
    };
    const find = (node: EventTarget | null): HTMLElement | null => {
      if (!(node instanceof Element)) return null;
      return node.closest<HTMLElement>('[data-tip]');
    };
    // pointerover bubbles from every element, so entering any non-tip element clears the tooltip.
    const onOver = (e: Event) => show(find(e.target));
    const hide = () => show(null);

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onOver);
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onOver);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      el.remove();
    };
  }, []);
  return null;
}

export interface HudPanelProps {
  title: string;
  icon?: IconName;
  aside?: ReactNode;
  defaultOpen?: boolean;
  /** remember this viewer's open/closed choice under this key (localStorage, see ./storage) */
  persistKey?: string;
  className?: string;
  /** board art URL drawn faintly behind the panel content (the procedural layout stays readable without it) */
  art?: string;
  children: ReactNode;
}

/** True inside the City tabs: a panel then renders only its body, because the tab strip is its header. */
export const EmbeddedContext = createContext(false);

function BoardArt({ url }: { url: string }) {
  return <i className="hud-board-art" aria-hidden="true" style={{ backgroundImage: `url("${url}")` }} />;
}

/** Brushed-steel frame with corner brackets and a collapsible header (body only when embedded in the City tabs). */
export function HudPanel(props: HudPanelProps) {
  const embedded = useContext(EmbeddedContext);
  if (embedded) {
    return (
      <div
        className={'hud-embedded' + (props.art ? ' has-board-art' : '') + (props.className ? ' ' + props.className : '')}
        aria-label={t(props.title)}
      >
        {props.art ? <BoardArt url={props.art} /> : null}
        {props.children}
      </div>
    );
  }
  return <FramedPanel {...props} />;
}

function FramedPanel({ title, icon, aside, defaultOpen = true, persistKey, className, art, children }: HudPanelProps) {
  const [open, setOpen] = useState<boolean>(() => (persistKey ? readFlag(persistKey, defaultOpen) : defaultOpen));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (persistKey) writeFlag(persistKey, next);
  };
  return (
    <section
      className={'hud-panel' + (open ? '' : ' is-collapsed') + (art ? ' has-board-art' : '') + (className ? ' ' + className : '')}
      aria-label={t(title)}
    >
      {art ? <BoardArt url={art} /> : null}
      <header className="hud-panel-head">
        <button
          type="button"
          className="hud-panel-toggle"
          aria-expanded={open}
          onClick={toggle}
          {...tip(`${open ? t('Collapse') : t('Expand')} ${t(title)}`)}
        >
          {icon ? <Icon name={icon} size={14} /> : null}
          <span className="hud-panel-title">{tn(title)}</span>
          <span className="hud-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        {aside ? <div className="hud-panel-aside">{aside}</div> : null}
      </header>
      {open ? <div className="hud-panel-body">{children}</div> : null}
    </section>
  );
}
