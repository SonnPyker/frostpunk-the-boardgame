// Left column: Population (Citizen markers + sickness), Hunger, Corpses, Hope, Discontent, Supply.
import { memo } from 'react';
import type { CSSProperties } from 'react';
import { meepleCountFor } from '@frostpunk/engine';
import type { CitizenType, DiscType, GameState, HopeType, Tok } from '@frostpunk/engine';
import { t, tn } from '../i18n';
import { boardArt, tokenArt } from './assets';
import { HudPanel, tip } from './context';
import { Icon } from './icons';
import type { IconName } from './model';
import {
  CITIZEN_COLOR,
  CITIZEN_LABEL,
  CITIZEN_ORDER,
  DISC_COLOR,
  DISC_LABEL,
  DISC_ORDER,
  DISC_SLOTS,
  HOPE_COLOR,
  HOPE_LABEL,
  HOPE_ORDER,
  HOPE_SLOTS,
  POP_TRACK_MAX,
  automatonsFree,
  automatonsTotal,
  citizenTotal,
  hungerBand,
  sameSig,
  sliceSig,
} from './model';
import type { SigProps } from './model';

export const SOCIETY_KEYS = [
  'round',
  'cit',
  'sick',
  'food',
  'hunger',
  'corpse',
  'corpseMax',
  'hope',
  'disc',
  'hopeBag',
  'discBag',
  'res',
  'meeples',
  'spent',
  'automatonsMax',
] as const satisfies readonly (keyof GameState)[];

export const societySig = (s: GameState) => sliceSig(s, SOCIETY_KEYS);

interface Props extends SigProps {
  state: GameState;
}

function SocietyBoardImpl({ state: s }: Props) {
  return (
    <HudPanel
      title={t('Society')}
      icon="worker"
      aside={<span className="hud-muted">{s.config.mode === 'coop' ? tn('Co-op') : tn('Solo')} · {s.config.difficulty === 'hard' ? tn('Hard') : tn('Normal')}</span>}
      className="hud-society"
      persistKey="society"
      art={boardArt('board_panel_b')}
    >
      <Population s={s} />
      <Hunger s={s} />
      <Corpses s={s} />
      <TokenTrack side="hope" s={s} />
      <TokenTrack side="disc" s={s} />
      <Supply s={s} />
    </HudPanel>
  );
}

export const SocietyBoard = memo(SocietyBoardImpl, sameSig);

// ---- Population -------------------------------------------------------------------------------------------

function Population({ s }: { s: GameState }) {
  return (
    <div className="hud-block" aria-label={t('Population')}>
      <div className="hud-block-head">
        <span>{tn('Population')}</span>
        <span className="hud-num" {...tip(t(`Citizens in the city: ${citizenTotal(s)}`))}>{citizenTotal(s)}</span>
      </div>
      {CITIZEN_ORDER.map((t) => (
        <CitizenRow key={t} t={t} s={s} />
      ))}
    </div>
  );
}

function CitizenRow({ t: kind, s }: { t: CitizenType; s: GameState }) {
  const n = s.cit[kind];
  const marker = s.sick[kind];
  const spent = s.spent.filter((x) => x.type === kind).length;
  const healthy = Math.max(0, n - marker.n);
  const pct = Math.min(100, (n / POP_TRACK_MAX) * 100);
  const sickPct = Math.min(100, (marker.n / POP_TRACK_MAX) * 100);
  const figures = Math.min(8, meepleCountFor(n));
  const style = { ['--c' as string]: CITIZEN_COLOR[kind] } as CSSProperties;
  const note = marker.skull
    ? t(`${n} citizens, ${marker.n} sick (Sickness marker on the Skull side), ${spent} spent this Round.`)
    : t(`${n} citizens, ${marker.n} sick (Sickness marker on the Syringe side), ${spent} spent this Round.`);
  return (
    <div className="hud-cit" style={style} {...tip(`${t(CITIZEN_LABEL[kind])}: ${note}`)}>
      <Icon name={kind} size={24} className="hud-cit-icon" />
      <div className="hud-cit-main">
        <div className="hud-cit-top">
          <span className="hud-cit-name">{tn(CITIZEN_LABEL[kind])}</span>
          <span className="hud-cit-count">{n}</span>
          <span className="hud-cit-figs" aria-hidden="true">
            {Array.from({ length: figures }).map((_, i) => (
              <i key={i} />
            ))}
          </span>
          {marker.n > 0 ? <SickMarker n={marker.n} skull={marker.skull} /> : null}
        </div>
        <div className="hud-bar" aria-hidden="true">
          <i className="hud-bar-fill" style={{ width: `${pct}%` }} />
          {marker.n > 0 ? <i className="hud-bar-sick" style={{ width: `${sickPct}%` }} /> : null}
        </div>
        <div className="hud-cit-foot">
          <span>{tn('Healthy')} <b>{healthy}</b></span>
          <span>{tn('Sick')} <b>{marker.n}</b></span>
          <span>{tn('Spent')} <b>{spent}</b></span>
        </div>
      </div>
    </div>
  );
}

/** Sickness marker: syringe side shows the count, skull side is one flip away from a death. */
function SickMarker({ n, skull }: { n: number; skull: boolean }) {
  const text = skull
    ? t('Sickness marker on the Skull side: the next flip back to Syringe kills a citizen.')
    : t('Sickness marker on the Syringe side: sick citizens. Overflow flips it to Skull; a second flip kills a citizen.');
  return (
    <span className={'hud-sick' + (skull ? ' is-skull' : ' is-syringe')} {...tip(text)}>
      <Icon name={skull ? 'skull' : 'syringe'} size={13} />
      <b>{n}</b>
    </span>
  );
}

// ---- Hunger -----------------------------------------------------------------------------------------------

const HUNGER_CELLS = 25;

function Hunger({ s }: { s: GameState }) {
  const now = hungerBand(s.hunger);
  const spend = Math.min(s.food, s.hunger);
  const after = s.hunger - spend;
  const next = hungerBand(after);
  const cells = Array.from({ length: HUNGER_CELLS }, (_, i) => i + 1);
  return (
    <div className="hud-block" aria-label={t('Hunger')}>
      <div className="hud-block-head">
        <span>{tn('Hunger')}</span>
        <span className="hud-num" {...tip(t('Hunger marker. Spend 1 Food per point before the Hunger table applies. 25 or more loses the game.'))}>{s.hunger}</span>
        <span className="hud-food" {...tip(t('Food stock: spend Food to lower Hunger one point per Food.'))}>
          <Icon name="food" size={14} /> <b>{s.food}</b>
        </span>
      </div>
      <div className="hud-hunger-track" role="img" aria-label={t(`Hunger ${s.hunger}`)}>
        {cells.map((v) => {
          const band = hungerBand(v);
          const on = v <= s.hunger;
          const cls = ['hud-hcell', `tier-${band.lose ? 4 : band.tier}`, on ? 'is-on' : '', v === s.hunger ? 'is-marker' : ''].join(' ');
          return <i key={v} className={cls} />;
        })}
      </div>
      <div className="hud-hunger-scale" aria-hidden="true">
        <span>0</span><span>1</span><span>5</span><span>10</span><span>15</span><span>20</span><span>25</span>
      </div>
      <p className={'hud-consequence tier-' + (now.lose ? 4 : now.tier)}>
        <b>{tn('Now:')}</b> {tn(now.label)}
      </p>
      <p className="hud-consequence">
        <b>{spend > 0 ? tn(`Feeding with ${spend} Food:`) : tn('Feeding:')}</b> {tn(`Hunger ${after}.`)} {tn(next.label)}
      </p>
    </div>
  );
}

// ---- Corpses ---------------------------------------------------------------------------------------------

function Corpses({ s }: { s: GameState }) {
  const len = Math.max(s.corpseMax, s.corpse, 1);
  const cells = Array.from({ length: len }, (_, i) => i + 1);
  return (
    <div className="hud-block" aria-label={t('Corpses')}>
      <div className="hud-block-head">
        <span>{tn('Corpses')}</span>
        <span className="hud-num">
          {s.corpse}
          {s.corpseMax > 0 ? <span className="hud-muted"> / {s.corpseMax}</span> : null}
        </span>
      </div>
      <div className="hud-corpse-track">
        {cells.map((v) => (
          <i
            key={v}
            className={'hud-ccell' + (v <= s.corpse ? ' is-on' : '') + (s.corpseMax > 0 && v === s.corpseMax ? ' is-last' : '')}
            {...tip(s.corpseMax > 0 && v === s.corpseMax ? t('Last space of the Corpse track: reaching it loses the game.') : t(`Corpse track space ${v}`))}
          />
        ))}
      </div>
    </div>
  );
}

// ---- Hope & Discontent tokens --------------------------------------------------------------------------------

function TokenTrack({ side, s }: { side: 'hope' | 'disc'; s: GameState }) {
  const isHope = side === 'hope';
  const toks: Tok<HopeType | DiscType>[] = isHope ? (s.hope as Tok<HopeType | DiscType>[]) : (s.disc as Tok<HopeType | DiscType>[]);
  const slots = isHope ? HOPE_SLOTS : DISC_SLOTS;
  const bag: Record<string, number> = isHope ? s.hopeBag : s.discBag;
  const order: string[] = isHope ? HOPE_ORDER : DISC_ORDER;
  const label: Record<string, string> = isHope ? HOPE_LABEL : DISC_LABEL;
  const color: Record<string, string> = isHope ? HOPE_COLOR : DISC_COLOR;
  const active = toks.filter((t) => t.a).length;
  const title = isHope ? 'Hope' : 'Discontent';
  return (
    <div className={'hud-block hud-tokens ' + side} aria-label={t(title)}>
      <div className="hud-block-head">
        <span>{tn(title)}</span>
        <span className="hud-muted" {...tip(isHope ? t('Hope track: active Hope can be exhausted for its effect; exhausted Hope is activated again by Hope effects.') : t('Discontent track: active Discontent is a threat that can be exhausted; the track fills with the bag draws.'))}>
          {active} {tn('active')} · {toks.length}/{slots}
        </span>
      </div>
      <div className="hud-slots">
        {Array.from({ length: slots }).map((_, i) => {
          const tok = toks[i];
          if (!tok) return <i key={i} className="hud-slot is-empty" />;
          return <TokenChip key={i} type={tok.t} active={tok.a} isHope={isHope} label={label[tok.t] ?? tok.t} color={color[tok.t] ?? '#888'} />;
        })}
      </div>
      <div className="hud-bag">
        {order.map((kind) => (
          <span key={kind} className="hud-bag-chip" style={{ ['--c' as string]: color[kind] } as CSSProperties} {...tip(`${label[kind]} ${title} ${t('tokens still in the bag:')} ${bag[kind] ?? 0}`)}>
            <i /> {tn(label[kind])} <b>{bag[kind] ?? 0}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function TokenChip({ type, active, isHope, label, color }: { type: string; active: boolean; isHope: boolean; label: string; color: string }) {
  const art = tokenArt(type);
  const state = active ? 'active' : 'exhausted';
  const text = isHope
    ? `${label} Hope (${t(state)}). ${t(active ? 'Active: can be exhausted for its effect.' : 'Exhausted: activate it again to use it.')}`
    : `${label} Discontent (${t(state)}). ${t(active ? 'Active: a threat in the city.' : 'Exhausted: no longer active until activated again.')}`;
  return (
    <span className={`hud-token ${isHope ? 'hope' : 'disc'} ${active ? 'is-active' : 'is-exhausted'}`} style={{ ['--c' as string]: color } as CSSProperties} {...tip(text)}>
      {art ? <img src={art} alt="" draggable={false} /> : <b>{label.slice(0, 2)}</b>}
    </span>
  );
}

// ---- Supply ----------------------------------------------------------------------------------------------

function Supply({ s }: { s: GameState }) {
  const items: { icon: IconName; label: string; value: number; sub?: string; tip: string }[] = [
    { icon: 'wood', label: 'Wood', value: s.res.wood, sub: 'no limit', tip: 'Wood: unlimited supply.' },
    { icon: 'coal', label: 'Coal', value: s.res.coal, sub: 'no limit', tip: 'Coal: fuels the Generator and powers buildings.' },
    { icon: 'core', label: 'Steam Core', value: s.res.core, sub: 'no limit', tip: 'Steam Cores: built into upgraded buildings and Steam Hubs.' },
    { icon: 'steel', label: 'Steel', value: s.res.steel, sub: 'max 8', tip: 'Steel: at most 8 in the supply.' },
    {
      icon: 'automaton',
      label: 'Automatons',
      value: automatonsFree(s),
      sub: `of ${s.automatonsMax} max`,
      tip: `Automatons available: ${automatonsFree(s)} of ${s.automatonsMax}. ${automatonsTotal(s)} in play or in the supply.`,
    },
  ];
  return (
    <div className="hud-block" aria-label={t('Supply')}>
      <div className="hud-block-head">
        <span>{tn('Supply')}</span>
      </div>
      <div className="hud-supply">
        {items.map((it) => (
          <div key={it.label} className="hud-supply-item" {...tip(t(it.tip))}>
            <Icon name={it.icon} size={18} />
            <div>
              <div className="hud-supply-val">{it.value}</div>
              <div className="hud-supply-label">{tn(it.label)}</div>
              {it.sub ? <div className="hud-supply-sub">{tn(it.sub)}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
