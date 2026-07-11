import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './App.css';

/* 
   Esta interface NÃO guarda chave privada e não fala direto com a L3.
   Ela conversa com uma carteira injetada em `window.adlaWallet` 
   Contrato esperado do provider (ver `callBridge` mais abaixo):
     - adla_requestAccounts   → string[]            (abre popup de conexão)
     - adla_accounts          → string[]            (consulta silenciosa)
     - adla_sendTransaction   → { txId }             (depósito/saque)
     - adla_swap               → { txId }
     - adla_addLiquidity       → { txId }
     - adla_removeLiquidity    → { txId }
     - adla_stake / adla_unstake / adla_claimRewards → { txId }
     - adla_vote                → { txId }
   Eventos (provider.on / removeListener):
     - 'accountsChanged' (string[]) · 'disconnect' () · 'chainChanged' (string)
   ============================================================================ */

// ---------------------------------------------------------------------------
// Bridge com a carteira (objeto injetado pelo navegador)
// ---------------------------------------------------------------------------

type AdlaMethod =
  | 'adla_requestAccounts' | 'adla_accounts'
  | 'adla_sendTransaction' | 'adla_swap'
  | 'adla_addLiquidity' | 'adla_removeLiquidity'
  | 'adla_stake' | 'adla_unstake' | 'adla_claimRewards'
  | 'adla_vote';

type AdlaEvent = 'accountsChanged' | 'disconnect' | 'chainChanged' | 'txUpdate';

interface AdlaRequestArgs { method: AdlaMethod; params?: unknown[]; }

interface AdlaWalletProvider {
  isAdlaWallet?: boolean;
  chainId?: string;
  request<T = unknown>(args: AdlaRequestArgs): Promise<T>;
  on(event: AdlaEvent, handler: (...args: any[]) => void): void;
  removeListener(event: AdlaEvent, handler: (...args: any[]) => void): void;
}

declare global {
  interface Window {
    adlaWallet?: AdlaWalletProvider;
  }
}

/** Detecta `window.adlaWallet`, mesmo se a extensão injetar depois do mount. */
function useAdlaProvider(): AdlaWalletProvider | null {
  const [provider, setProvider] = useState<AdlaWalletProvider | null>(
    () => (typeof window !== 'undefined' ? window.adlaWallet ?? null : null)
  );

  useEffect(() => {
    if (provider) return;
    const pickUp = () => { if (window.adlaWallet) setProvider(window.adlaWallet); };
    window.addEventListener('adla#initialized', pickUp);
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      pickUp();
      if (window.adlaWallet || tries > 20) window.clearInterval(id);
    }, 500);
    return () => { window.removeEventListener('adla#initialized', pickUp); window.clearInterval(id); };
  }, [provider]);

  return provider;
}

/** Chama o provider real quando existir; cai pro mock local em Modo Demo. */
async function callBridge<T>(
  provider: AdlaWalletProvider | null,
  demoMode: boolean,
  method: AdlaMethod,
  params: unknown[],
  applyMock: () => void
): Promise<T> {
  if (provider) {
    return provider.request<T>({ method, params });
  }
  if (demoMode) {
    await new Promise(r => setTimeout(r, 600 + Math.random() * 500));
    applyMock();
    return { txId: fakeTxId() } as unknown as T;
  }
  throw new Error('Nenhuma carteira ADLA conectada.');
}



interface Holding { symbol: string; name: string; address: string; decimals: number; balance: number; price: number; color: string; }
interface PoolInfo { id: string; symbolX: string; symbolY: string; apy: number; tvl: number; myShares: number; featured: boolean; }
interface Proposal { id: string; track: string; title: string; body: string; yesPct: number; noPct: number; hoursLeft: number; myVote: 'yes' | 'no' | null; }
interface ActivityItem { id: string; kind: 'swap' | 'stake' | 'unstake' | 'claim' | 'vote' | 'liquidity' | 'transfer'; label: string; detail?: string; amount?: string; ts: number; status: 'confirmed' | 'pending'; }

type Timeframe = '24H' | '7D' | '1M' | 'TUDO';
type ViewKey = 'home' | 'swap' | 'stake' | 'governance' | 'activity';



const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const randomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fakeTxId = () => `0x${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;

function genDemoAddress(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz023456789';
  let s = 'adla1';
  for (let i = 0; i < 38; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function shortAddr(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNum(n: number, decimals = 2): string {
  if (!isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'agora';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m atrás`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h atrás`;
  return `${Math.floor(d / 86_400_000)}d atrás`;
}



function genHoldings(): Holding[] {
  return [
    { symbol: 'ALEO', name: 'ALEO (ponte)', address: 'bridge.eth', decimals: 18, balance: 0.42, price: 3450, color: 'var(--holo-cyan)' },
    { symbol: 'USDCX', name: 'USD Coin', address: 'bridge.usdc', decimals: 6, balance: 820, price: 1, color: 'var(--fandom-violet)' },
    { symbol: 'ADLA', name: 'ADLA Token', address: 'adla.token', decimals: 6, balance: 15400, price: 0.062, color: 'var(--encore-magenta)' },
    { symbol: 'Other', name: 'Outros ativos', address: 'misc', decimals: 0, balance: 1, price: 96, color: 'var(--spotlight-gold)' },
  ];
}

function genHistory(timeframe: Timeframe): number[] {
  const lengths: Record<Timeframe, number> = { '24H': 24, '7D': 7, '1M': 30, 'TUDO': 12 };
  const n = lengths[timeframe];
  let v = 2400;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    v += rand(-0.06, 0.09) * v;
    out.push(Math.max(v, 100));
  }
  return out;
}

function genPools(): PoolInfo[] {
  return [
    { id: 'p1', symbolX: 'ADLA', symbolY: 'ALEO', apy: 18.5, tvl: 482000, myShares: 1500, featured: true },
    { id: 'p2', symbolX: 'ADLA', symbolY: 'USDCX', apy: 11.2, tvl: 210000, myShares: 0, featured: false },
    { id: 'p3', symbolX: 'ALEO', symbolY: 'USDCX', apy: 6.4, tvl: 980000, myShares: 0, featured: false },
  ];
}

function genProposals(): Proposal[] {
  return [
    { id: 'g1', track: 'TRACK 01', title: 'Financiar o Stage Vault de recompensas', body: 'Alocar 50.000 $ADLA do tesouro do fandom para reforçar as recompensas de stake nos próximos 90 dias.', yesPct: 72, noPct: 28, hoursLeft: 18, myVote: null },
    { id: 'g2', track: 'TRACK 02', title: 'Reduzir taxa de swap para 0,25%', body: 'Diminuir a taxa cobrada em cada troca pra deixar o protocolo mais competitivo frente a outras pools.', yesPct: 54, noPct: 46, hoursLeft: 40, myVote: null },
    { id: 'g3', track: 'TRACK 03', title: 'Abrir pool ADLA/USDC com incentivo extra', body: 'Criar incentivo temporário em dobro pra quem fornecer liquidez no par ADLA/USDC.', yesPct: 61, noPct: 39, hoursLeft: 65, myVote: null },
  ];
}

function genActivity(): ActivityItem[] {
  const now = Date.now();
  return [
    { id: randomId(), kind: 'claim', label: 'Recompensas resgatadas', amount: '+12.40 ADLA', ts: now - 18 * 60_000, status: 'confirmed' },
    { id: randomId(), kind: 'swap', label: 'ALEO → ADLA', amount: '0.05 → 2780.5', ts: now - 3 * 3_600_000, status: 'confirmed' },
    { id: randomId(), kind: 'stake', label: 'Stake de $ADLA', amount: '+500 ADLA', ts: now - 9 * 3_600_000, status: 'confirmed' },
    { id: randomId(), kind: 'vote', label: 'Voto registrado · TRACK 01', ts: now - 26 * 3_600_000, status: 'confirmed' },
    { id: randomId(), kind: 'liquidity', label: 'Liquidez ALEO/ADLA', amount: '+300 / +0.02', ts: now - 2 * 60_000, status: 'pending' },
  ];
}

function estimateSwap(tokenIn: Holding, tokenOut: Holding, amountInRaw: string, pools: PoolInfo[]) {
  const amt = parseFloat((amountInRaw || '').replace(',', '.'));
  if (!tokenIn || !tokenOut || !amt || amt <= 0 || tokenIn.symbol === tokenOut.symbol) {
    return { amountOut: '', impact: 0, route: '—' };
  }
  const pool = pools.find(p =>
    (p.symbolX === tokenIn.symbol && p.symbolY === tokenOut.symbol) ||
    (p.symbolY === tokenIn.symbol && p.symbolX === tokenOut.symbol)
  );
  const fee = 0.003;
  const priceRatio = tokenIn.price / tokenOut.price;
  const out = pool ? amt * priceRatio * (1 - fee) : amt * priceRatio * (1 - fee * 2);
  const impact = Math.min((amt / 5000) * 100, 8);
  return {
    amountOut: out > 0 ? out.toFixed(6) : '',
    impact,
    route: pool ? `${tokenIn.symbol} → ${tokenOut.symbol}` : 'Rota agregada (múltiplos pools)',
  };
}



type IconName = 'home' | 'swap' | 'stake' | 'council' | 'activity' | 'wallet' | 'copy'
  | 'check' | 'close' | 'chevronDown' | 'arrowUpDown' | 'plus' | 'minus' | 'sparkle';

const ICONS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />,
  swap: <><path d="M7 7h11l-3.2-3.2" /><path d="M17 17H6l3.2 3.2" /></>,
  stake: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  council: <><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M4 9 12 4l8 5" /><path d="M9 13.2l2.6 2.6L15 11" /></>,
  activity: <path d="M3 12h4l2 7 4-14 2 7h6" />,
  wallet: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="16" cy="14.5" r="1.1" fill="currentColor" stroke="none" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  check: <path d="M4 12.5 9 17 20 6" />,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  chevronDown: <path d="M5 8.5 12 15l7-6.5" />,
  arrowUpDown: <><path d="M7 4v13M7 17l-3-3M7 17l3-3" /><path d="M17 20V7M17 7l3 3M17 7l-3 3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
};

function Icon({ name, size = 20, className = '', spin = false }: { name: IconName; size?: number; className?: string; spin?: boolean }) {
  if (spin) {
    return (
      <svg className={`icon icon-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="34 100" />
      </svg>
    );
  }
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}



function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function TokenPicker({ value, options, onChange }: { value: Holding; options: Holding[]; onChange: (h: Holding) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="token-picker" ref={ref}>
      <button type="button" className="token-picker-btn" onClick={() => setOpen(o => !o)}>
        <span className="token-dot" style={{ background: value.color }} />
        {value.symbol}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="token-picker-list">
          {options.map(o => (
            <button type="button" key={o.symbol} className="token-picker-item" onClick={() => { onChange(o); setOpen(false); }}>
              <span className="token-dot" style={{ background: o.color }} />
              <span>{o.symbol}</span>
              <span className="token-picker-name">{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AmountSheet({
  open, title, tokens, token, onToken, value, onChange, onConfirm, onClose, busy, confirmLabel, hint,
}: {
  open: boolean; title: string; tokens?: Holding[]; token?: Holding; onToken?: (h: Holding) => void;
  value: string; onChange: (v: string) => void; onConfirm: () => void; onClose: () => void;
  busy: boolean; confirmLabel: string; hint?: string;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {tokens && token && onToken && (
        <div className="sheet-token-row">
          <span>Ativo</span>
          <TokenPicker value={token} options={tokens} onChange={onToken} />
        </div>
      )}
      <input
        className="sheet-amount-input"
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
      />
      {hint && <p className="sheet-hint">{hint}</p>}
      <button type="button" className="btn-primary-cta" disabled={!value || busy} onClick={onConfirm}>
        {busy ? 'Confirmando…' : confirmLabel}
      </button>
    </BottomSheet>
  );
}

function LiquiditySheet({
  open, pool, amountX, amountY, onAmountX, onAmountY, onConfirm, onClose, busy,
}: {
  open: boolean; pool: PoolInfo | null; amountX: string; amountY: string;
  onAmountX: (v: string) => void; onAmountY: (v: string) => void; onConfirm: () => void; onClose: () => void; busy: boolean;
}) {
  return (
    <BottomSheet open={open && !!pool} onClose={onClose} title={pool ? `Adicionar liquidez · ${pool.symbolX}/${pool.symbolY}` : 'Adicionar liquidez'}>
      {pool && (
        <>
          <label className="sheet-label">{pool.symbolX}</label>
          <input className="sheet-amount-input" inputMode="decimal" placeholder="0.0" value={amountX} onChange={e => onAmountX(e.target.value)} />
          <label className="sheet-label">{pool.symbolY}</label>
          <input className="sheet-amount-input" inputMode="decimal" placeholder="0.0" value={amountY} onChange={e => onAmountY(e.target.value)} />
          <button type="button" className="btn-primary-cta" disabled={!amountX || !amountY || busy} onClick={onConfirm}>
            {busy ? 'Confirmando…' : 'Adicionar Liquidez'}
          </button>
        </>
      )}
    </BottomSheet>
  );
}

function InstallHintSheet({ open, onClose, onDemo }: { open: boolean; onClose: () => void; onDemo: () => void }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Carteira ADLA não detectada">
      <p className="sheet-text">
        Esta tela se conecta a uma carteira injetada em <code>window.adlaWallet</code>. Quando a
        extensão for publicada, conectar aqui já fala direto com a L3 — nada nessa interface precisa mudar.
      </p>
      <p className="sheet-text">Por enquanto, dá pra explorar tudo com dados de demonstração.</p>
      <button type="button" className="btn-ghost" disabled>
        Obter Carteira ADLA <span className="soon-badge">em breve</span>
      </button>
      <button type="button" className="btn-primary-cta" onClick={onDemo}>Entrar no Modo Demo</button>
    </BottomSheet>
  );
}

function AllocationRing({ holdings, total }: { holdings: Holding[]; total: number }) {
  const size = 168, stroke = 22, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring-svg">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        {holdings.map(h => {
          const value = h.balance * h.price;
          const pct = total > 0 ? value / total : 0;
          const dash = pct * c;
          const rotation = total > 0 ? (acc / total) * 360 - 90 : -90;
          acc += value;
          return (
            <circle
              key={h.symbol}
              cx={size / 2} cy={size / 2} r={r} fill="none"
              strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${Math.max(dash - 3, 0)} ${c}`}
              transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
              style={{ stroke: h.color }}
              className="ring-seg"
            />
          );
        })}
      </svg>
      <div className="ring-center">
        <span className="ring-total">{formatUsd(total)}</span>
        <span className="ring-label">total</span>
      </div>
    </div>
  );
}

function WaveformChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="waveform" role="img" aria-label="Histórico de valor do portfólio">
      {data.map((v, i) => (
        <div key={i} className="waveform-bar" style={{ height: `${Math.max((v / max) * 100, 6)}%`, animationDelay: `${i * 0.02}s` }} />
      ))}
    </div>
  );
}

function HoldingChip({ h, total }: { h: Holding; total: number }) {
  const value = h.balance * h.price;
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="holo-card holding-chip">
      <span className="holding-dot" style={{ background: h.color }} />
      <div className="holding-info">
        <span className="holding-symbol">{h.symbol}</span>
        <span className="holding-name">{h.name}</span>
      </div>
      <div className="holding-value">
        <span className="holding-usd">{formatUsd(value)}</span>
        <span className="holding-pct">{pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function PoolCard({ pool, onAdd, onRemove, busy }: { pool: PoolInfo; onAdd: (p: PoolInfo) => void; onRemove: (p: PoolInfo) => void; busy: boolean }) {
  return (
    <div className="holo-card pool-card">
      <div className="pool-head">
        <span className={`pool-tag ${pool.featured ? 'tag-a' : 'tag-b'}`}>{pool.featured ? 'A-SIDE' : 'B-SIDE'}</span>
        <span className="pool-pair">{pool.symbolX}/{pool.symbolY}</span>
        <span className="pool-apy">{pool.apy.toFixed(1)}% APY</span>
      </div>
      <div className="pool-stats">
        <div><span className="stat-label">TVL</span><span className="stat-value">{formatUsd(pool.tvl)}</span></div>
        <div><span className="stat-label">Suas cotas</span><span className="stat-value">{pool.myShares.toLocaleString('pt-BR')}</span></div>
      </div>
      <div className="pool-actions">
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => onAdd(pool)}>
          <Icon name="plus" size={14} /> Adicionar liquidez
        </button>
        {pool.myShares > 0 && (
          <button type="button" className="btn-ghost btn-ghost-danger" disabled={busy} onClick={() => onRemove(pool)}>Remover</button>
        )}
      </div>
    </div>
  );
}

function ProposalCard({ p, onVote, busy }: { p: Proposal; onVote: (id: string, vote: 'yes' | 'no') => void; busy: boolean }) {
  return (
    <div className="holo-card proposal-card">
      <div className="proposal-head">
        <span className="proposal-track">{p.track}</span>
        <span className="proposal-clock">Encerra em {p.hoursLeft}h</span>
      </div>
      <h4 className="proposal-title">{p.title}</h4>
      <p className="proposal-body">{p.body}</p>
      <div className="vote-bar">
        <div className="vote-yes" style={{ width: `${p.yesPct}%` }} />
        <div className="vote-no" style={{ width: `${p.noPct}%` }} />
      </div>
      <div className="vote-legend">
        <span>A favor {p.yesPct}%</span>
        <span>Contra {p.noPct}%</span>
      </div>
      <div className="proposal-actions">
        <button type="button" className={`btn-vote btn-yes ${p.myVote === 'yes' ? 'is-active' : ''}`} disabled={busy || !!p.myVote} onClick={() => onVote(p.id, 'yes')}>A favor</button>
        <button type="button" className={`btn-vote btn-no ${p.myVote === 'no' ? 'is-active' : ''}`} disabled={busy || !!p.myVote} onClick={() => onVote(p.id, 'no')}>Contra</button>
      </div>
      {p.myVote && <p className="proposal-voted"><Icon name="check" size={13} /> Você votou: {p.myVote === 'yes' ? 'a favor' : 'contra'}</p>}
    </div>
  );
}

const ACTIVITY_ICON: Record<ActivityItem['kind'], IconName> = {
  swap: 'arrowUpDown', stake: 'stake', unstake: 'stake', claim: 'sparkle', vote: 'check', liquidity: 'plus', transfer: 'wallet',
};

function ActivityRow({ item }: { item: ActivityItem }) {
  return (
    <div className="activity-row">
      <span className="activity-icon"><Icon name={ACTIVITY_ICON[item.kind]} size={17} /></span>
      <div className="activity-info">
        <span className="activity-label">{item.label}</span>
        {item.detail && <span className="activity-detail">{item.detail}</span>}
      </div>
      <div className="activity-meta">
        {item.amount && <span className="activity-amount">{item.amount}</span>}
        <span className={`activity-status status-${item.status}`}>{item.status === 'confirmed' ? 'Confirmado' : 'Pendente'}</span>
        <span className="activity-time">{timeAgo(item.ts)}</span>
      </div>
    </div>
  );
}

function WalletButton({
  hasProvider, address, connecting, demoMode, onConnect, onDisconnect, onToggleDemo,
}: {
  hasProvider: boolean; address: string; connecting: boolean; demoMode: boolean;
  onConnect: () => void; onDisconnect: () => void; onToggleDemo: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!address) {
    return (
      <button type="button" className="btn-connect" onClick={onConnect} disabled={connecting}>
        <Icon name="wallet" size={16} spin={connecting} />
        {connecting ? 'Conectando…' : 'Conectar Carteira'}
      </button>
    );
  }

  return (
    <div className="wallet-pill-wrap" ref={ref}>
      <button type="button" className="wallet-pill" onClick={() => setOpen(o => !o)}>
        <span className={`live-dot ${hasProvider && !demoMode ? 'is-live' : 'is-demo'}`} />
        {shortAddr(address)}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="wallet-dropdown">
          <div className="wallet-dropdown-addr">{address}</div>
          <button type="button" className="dropdown-item" onClick={() => navigator.clipboard?.writeText(address)}>
            <Icon name="copy" size={15} /> Copiar endereço
          </button>
          <label className="dropdown-item dropdown-toggle">
            <span>Modo Demo</span>
            <input type="checkbox" checked={demoMode} onChange={e => onToggleDemo(e.target.checked)} />
          </label>
          <button type="button" className="dropdown-item dropdown-danger" onClick={() => { onDisconnect(); setOpen(false); }}>Desconectar</button>
        </div>
      )}
    </div>
  );
}



function HomeView(props: {
  holdings: Holding[]; total: number; delta: number;
  timeframe: Timeframe; onTimeframe: (t: Timeframe) => void; history: number[];
  onAction: (a: 'deposit' | 'withdraw' | 'swap') => void;
  rewards: number; onClaim: () => void; busy: boolean;
}) {
  const { holdings, total, delta, timeframe, onTimeframe, history, onAction, rewards, onClaim, busy } = props;
  return (
    <div className="view-stack">
      <section className="card hero-card">
        <p className="eyebrow">SEU PALCO</p>
        <div className="hero-row">
          <h2 className="hero-value">{formatUsd(total)}</h2>
          <span className={`delta-chip ${delta >= 0 ? 'delta-up' : 'delta-down'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}%
          </span>
        </div>
        <p className="hero-sub">Valor total do portfólio · 24h</p>
        <div className="action-row">
          <button type="button" className="btn-action" onClick={() => onAction('deposit')}><Icon name="plus" size={16} /> Depositar</button>
          <button type="button" className="btn-action" onClick={() => onAction('withdraw')}><Icon name="minus" size={16} /> Sacar</button>
          <button type="button" className="btn-action btn-action-primary" onClick={() => onAction('swap')}><Icon name="arrowUpDown" size={16} /> Trocar</button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">DISTRIBUIÇÃO</p>
            <h3>Seus Ativos</h3>
          </div>
        </div>
        <div className="allocation-row">
          <AllocationRing holdings={holdings} total={total} />
          <div className="holding-list">
            {holdings.map(h => <HoldingChip key={h.symbol} h={h} total={total} />)}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">SETLIST DE VALOR</p>
            <h3>Histórico</h3>
          </div>
          <div className="timeframe-pills">
            {(['24H', '7D', '1M', 'TUDO'] as Timeframe[]).map(t => (
              <button type="button" key={t} className={`pill ${timeframe === t ? 'pill-active' : ''}`} onClick={() => onTimeframe(t)}>{t}</button>
            ))}
          </div>
        </div>
        <WaveformChart data={history} />
      </section>

      <section className="card rewards-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">FÃ-CLUBE</p>
            <h3>Recompensas de Staking</h3>
          </div>
        </div>
        <div className="rewards-row">
          <div className="rewards-text">
            <span className="rewards-amount">{rewards.toFixed(2)} $ADLA</span>
            <span className="rewards-hint">acumulado em staking</span>
          </div>
          <button type="button" className="btn-claim" disabled={busy || rewards <= 0} onClick={onClaim}>
            <Icon name="sparkle" size={15} spin={busy} /> Resgatar
          </button>
        </div>
      </section>
    </div>
  );
}

function SwapView(props: {
  tokens: Holding[]; tokenIn: Holding; tokenOut: Holding;
  onSetTokenIn: (h: Holding) => void; onSetTokenOut: (h: Holding) => void;
  amountIn: string; onAmountIn: (v: string) => void;
  amountOut: string; impact: number; route: string;
  slippage: string; onSlippage: (v: string) => void;
  busy: boolean; confirming: boolean; onSwap: () => void; onFlip: () => void;
}) {
  const { tokens, tokenIn, tokenOut, onSetTokenIn, onSetTokenOut, amountIn, onAmountIn, amountOut, impact, route, slippage, onSlippage, busy, confirming, onSwap, onFlip } = props;
  return (
    <div className="view-stack">
      <section className="card">
        <p className="eyebrow">REMIX DE ATIVOS</p>
        <h3>Trocar</h3>

        <div className="swap-box">
          <div className="swap-box-head">
            <span>Você paga</span>
            <span className="swap-balance">Saldo: {formatNum(tokenIn.balance)} {tokenIn.symbol}</span>
          </div>
          <div className="swap-box-row">
            <input inputMode="decimal" placeholder="0.0" value={amountIn} onChange={e => onAmountIn(e.target.value)} />
            <TokenPicker value={tokenIn} options={tokens.filter(t => t.symbol !== tokenOut.symbol)} onChange={onSetTokenIn} />
          </div>
          <div className="swap-quick-pcts">
            {[25, 50, 75, 100].map(p => (
              <button type="button" key={p} onClick={() => onAmountIn(((tokenIn.balance * p) / 100).toFixed(6))}>{p}%</button>
            ))}
          </div>
        </div>

        <button type="button" className="swap-flip" onClick={onFlip} aria-label="Inverter par">
          <Icon name="arrowUpDown" size={18} />
        </button>

        <div className="swap-box">
          <div className="swap-box-head">
            <span>Você recebe</span>
            <span className="swap-balance">Saldo: {formatNum(tokenOut.balance)} {tokenOut.symbol}</span>
          </div>
          <div className="swap-box-row">
            <input readOnly placeholder="0.0" value={amountOut} />
            <TokenPicker value={tokenOut} options={tokens.filter(t => t.symbol !== tokenIn.symbol)} onChange={onSetTokenOut} />
          </div>
        </div>

        {amountOut && (
          <div className="swap-details">
            <div className="swap-detail-row"><span>Rota</span><span>{route}</span></div>
            <div className="swap-detail-row"><span>Impacto no preço</span><span>{impact.toFixed(2)}%</span></div>
            <div className="swap-detail-row">
              <span>Slippage</span>
              <span className="slippage-pills">
                {['0.1', '0.5', '1.0'].map(s => (
                  <button type="button" key={s} className={`pill pill-sm ${slippage === s ? 'pill-active' : ''}`} onClick={() => onSlippage(s)}>{s}%</button>
                ))}
              </span>
            </div>
          </div>
        )}

        <button type="button" className="btn-primary-cta" disabled={!amountIn || busy} onClick={onSwap}>
          {busy ? 'Confirmando…' : confirming ? 'Confirmar Troca' : 'Revisar Troca'}
        </button>
      </section>
    </div>
  );
}

function StakeView(props: {
  stakeAmount: string; onStakeAmount: (v: string) => void; onStake: () => void;
  staked: number; rewards: number; onClaim: () => void; busy: boolean;
  pools: PoolInfo[]; onAddLiquidity: (p: PoolInfo) => void; onRemoveLiquidity: (p: PoolInfo) => void;
}) {
  const { stakeAmount, onStakeAmount, onStake, staked, rewards, onClaim, busy, pools, onAddLiquidity, onRemoveLiquidity } = props;
  return (
    <div className="view-stack">
      <section className="card">
        <p className="eyebrow">FÃ-CLUBE</p>
        <h3>Stake de $ADLA</h3>
        <p className="card-sub">Trave seu $ADLA e ganhe recompensas a cada bloco.</p>
        <div className="stake-stats">
          <div><span className="stat-label">Em stake</span><span className="stat-value">{staked.toLocaleString('pt-BR')} ADLA</span></div>
          <div><span className="stat-label">APY</span><span className="stat-value stat-apy">18,5%</span></div>
          <div><span className="stat-label">Recompensas</span><span className="stat-value">{rewards.toFixed(2)} ADLA</span></div>
        </div>
        <div className="stake-form">
          <input inputMode="decimal" placeholder="Quantidade de $ADLA" value={stakeAmount} onChange={e => onStakeAmount(e.target.value)} />
          <button type="button" className="btn-primary-cta" disabled={!stakeAmount || busy} onClick={onStake}>
            {busy ? 'Confirmando…' : 'Fazer Stake'}
          </button>
        </div>
        <button type="button" className="btn-claim btn-claim-block" disabled={busy || rewards <= 0} onClick={onClaim}>
          <Icon name="sparkle" size={15} spin={busy} /> Resgatar {rewards.toFixed(2)} $ADLA
        </button>
      </section>

      <section className="card">
        <div className="section-head">
          <div>
            <p className="eyebrow">POOLS</p>
            <h3>Pools de Liquidez</h3>
          </div>
        </div>
        <div className="pool-list">
          {pools.map(p => <PoolCard key={p.id} pool={p} onAdd={onAddLiquidity} onRemove={onRemoveLiquidity} busy={busy} />)}
        </div>
      </section>
    </div>
  );
}

function GovernanceView({ proposals, onVote, busy }: { proposals: Proposal[]; onVote: (id: string, v: 'yes' | 'no') => void; busy: boolean }) {
  return (
    <div className="view-stack">
      <section className="card">
        <p className="eyebrow">GOVERNANÇA</p>
        <h3>Conselho Fã</h3>
        <p className="card-sub">Quem tem $ADLA em stake decide o setlist do protocolo.</p>
      </section>
      <div className="proposal-list">
        {proposals.map(p => <ProposalCard key={p.id} p={p} onVote={onVote} busy={busy} />)}
      </div>
    </div>
  );
}

function ActivityView({ items }: { items: ActivityItem[] }) {
  return (
    <div className="view-stack">
      <section className="card">
        <p className="eyebrow">ENCORE LOG</p>
        <h3>Atividade Recente</h3>
        {items.length === 0 ? (
          <div className="empty-state">
            <Icon name="activity" size={26} />
            <p>Nada por aqui ainda.</p>
            <span>Suas trocas, stakes e votos aparecem nesta lista.</span>
          </div>
        ) : (
          <div className="activity-list">
            {items.map(i => <ActivityRow key={i.id} item={i} />)}
          </div>
        )}
      </section>
    </div>
  );
}



const TABS: { key: ViewKey; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Início', icon: 'home' },
  { key: 'swap', label: 'Trocar', icon: 'swap' },
  { key: 'stake', label: 'Fã-Clube', icon: 'stake' },
  { key: 'governance', label: 'Conselho', icon: 'council' },
  { key: 'activity', label: 'Atividade', icon: 'activity' },
];

const App: React.FC = () => {
  const provider = useAdlaProvider();
  const demoAutoSetRef = useRef(false);

  const [address, setAddress] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [demoMode, setDemoMode] = useState<boolean>(() => !(typeof window !== 'undefined' && window.adlaWallet));
  const [showInstallHint, setShowInstallHint] = useState(false);

  const [activeView, setActiveView] = useState<ViewKey>('home');
  const [status, setStatus] = useState<{ msg: string; type: 'ok' | 'err' | 'loading' } | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const [holdings, setHoldings] = useState<Holding[]>(() => genHoldings());
  const total = useMemo(() => holdings.reduce((s, h) => s + h.balance * h.price, 0), [holdings]);
  const [delta] = useState(() => rand(-2, 8));
  const [timeframe, setTimeframe] = useState<Timeframe>('24H');
  const history = useMemo(() => genHistory(timeframe), [timeframe]);

  const [pools, setPools] = useState<PoolInfo[]>(() => genPools());
  const [proposals, setProposals] = useState<Proposal[]>(() => genProposals());
  const [activity, setActivity] = useState<ActivityItem[]>(() => genActivity());

  const [staked, setStaked] = useState(1500);
  const [rewards, setRewards] = useState(45.2);
  const [stakeAmount, setStakeAmount] = useState('');

  const [tokenInSym, setTokenInSym] = useState('ETH');
  const [tokenOutSym, setTokenOutSym] = useState('ADLA');
  const tokenIn = holdings.find(h => h.symbol === tokenInSym) ?? holdings[0];
  const tokenOut = holdings.find(h => h.symbol === tokenOutSym) ?? holdings[1];
  const [amountIn, setAmountIn] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [swapConfirming, setSwapConfirming] = useState(false);
  const { amountOut, impact, route } = useMemo(() => estimateSwap(tokenIn, tokenOut, amountIn, pools), [tokenIn, tokenOut, amountIn, pools]);

  const [sheet, setSheet] = useState<'deposit' | 'withdraw' | 'remove' | null>(null);
  const [sheetToken, setSheetToken] = useState<Holding>(holdings[0]);
  const [sheetAmount, setSheetAmount] = useState('');
  const [removeTarget, setRemoveTarget] = useState<PoolInfo | null>(null);
  const [liquidityPool, setLiquidityPool] = useState<PoolInfo | null>(null);
  const [liqAmountX, setLiqAmountX] = useState('');
  const [liqAmountY, setLiqAmountY] = useState('');

  const setMsg = useCallback((msg: string, type: 'ok' | 'err' | 'loading' = 'ok') => {
    setStatus({ msg, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    if (type !== 'loading') toastTimer.current = window.setTimeout(() => setStatus(null), 3200);
  }, []);

  
  useEffect(() => {
    if (provider && !demoAutoSetRef.current) {
      demoAutoSetRef.current = true;
      setDemoMode(false);
    }
  }, [provider]);

  // assina eventos do provider quando ele existir
  useEffect(() => {
    if (!provider) return;
    const onAccounts = (accs: string[]) => setAddress(accs?.[0] ?? '');
    const onDisconnectEvt = () => setAddress('');
    provider.on('accountsChanged', onAccounts);
    provider.on('disconnect', onDisconnectEvt);
    provider.request<string[]>({ method: 'adla_accounts' }).then(accs => { if (accs?.[0]) setAddress(accs[0]); }).catch(() => {});
    return () => {
      provider.removeListener('accountsChanged', onAccounts);
      provider.removeListener('disconnect', onDisconnectEvt);
    };
  }, [provider]);

  const pushActivity = useCallback((item: Omit<ActivityItem, 'id' | 'ts'>) => {
    setActivity(prev => [{ ...item, id: randomId(), ts: Date.now() }, ...prev].slice(0, 30));
  }, []);

  const connect = useCallback(async () => {
    if (!provider) {
      if (demoMode) {
        setAddress(genDemoAddress());
        setMsg('Conectado em modo demo ✓');
      } else {
        setShowInstallHint(true);
      }
      return;
    }
    setConnecting(true);
    setMsg('Aguardando aprovação na carteira…', 'loading');
    try {
      const accounts = await provider.request<string[]>({ method: 'adla_requestAccounts' });
      setAddress(accounts?.[0] ?? '');
      setMsg('Carteira conectada ✓');
    } catch (e: any) {
      setMsg(e?.message || 'Conexão recusada', 'err');
    } finally {
      setConnecting(false);
    }
  }, [provider, demoMode, setMsg]);

  const disconnect = useCallback(() => {
    setAddress('');
    setMsg('Carteira desconectada');
  }, [setMsg]);

  const ensureConnected = useCallback((): boolean => {
    if (address) return true;
    setMsg('Conecte sua carteira primeiro', 'err');
    if (!provider) setShowInstallHint(true);
    return false;
  }, [address, provider, setMsg]);

  const onHomeAction = useCallback((a: 'deposit' | 'withdraw' | 'swap') => {
    if (a === 'swap') { setActiveView('swap'); return; }
    setSheetToken(holdings[0]);
    setSheetAmount('');
    setSheet(a);
  }, [holdings]);

  const handleDeposit = useCallback(async () => {
    if (!ensureConnected()) return;
    const amt = parseFloat(sheetAmount.replace(',', '.'));
    if (!amt || amt <= 0) { setMsg('Informe um valor válido', 'err'); return; }
    setBusy(true); setMsg('Confirmando depósito…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_sendTransaction', [{ kind: 'deposit', token: sheetToken.address, amount: amt }], () => {
        setHoldings(hs => hs.map(h => (h.symbol === sheetToken.symbol ? { ...h, balance: h.balance + amt } : h)));
      });
      pushActivity({ kind: 'transfer', label: `Depósito em ${sheetToken.symbol}`, amount: `+${amt} ${sheetToken.symbol}`, status: 'confirmed' });
      setMsg('Depósito confirmado ✓');
      setSheet(null); setSheetAmount('');
    } catch (e: any) { setMsg(e?.message || 'Falha no depósito', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, sheetAmount, sheetToken, provider, demoMode, setMsg, pushActivity]);

  const handleWithdraw = useCallback(async () => {
    if (!ensureConnected()) return;
    const amt = parseFloat(sheetAmount.replace(',', '.'));
    if (!amt || amt <= 0) { setMsg('Informe um valor válido', 'err'); return; }
    if (amt > sheetToken.balance) { setMsg('Saldo insuficiente', 'err'); return; }
    setBusy(true); setMsg('Confirmando saque…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_sendTransaction', [{ kind: 'withdraw', token: sheetToken.address, amount: amt }], () => {
        setHoldings(hs => hs.map(h => (h.symbol === sheetToken.symbol ? { ...h, balance: h.balance - amt } : h)));
      });
      pushActivity({ kind: 'transfer', label: `Saque de ${sheetToken.symbol}`, amount: `-${amt} ${sheetToken.symbol}`, status: 'confirmed' });
      setMsg('Saque confirmado ✓');
      setSheet(null); setSheetAmount('');
    } catch (e: any) { setMsg(e?.message || 'Falha no saque', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, sheetAmount, sheetToken, provider, demoMode, setMsg, pushActivity]);

  const handleFlipSwap = useCallback(() => {
    setTokenInSym(tokenOut.symbol);
    setTokenOutSym(tokenIn.symbol);
    setAmountIn('');
    setSwapConfirming(false);
  }, [tokenIn, tokenOut]);

  const handleSwap = useCallback(async () => {
    if (!ensureConnected()) return;
    const amt = parseFloat(amountIn.replace(',', '.'));
    if (!amt || amt <= 0) { setMsg('Informe um valor para trocar', 'err'); return; }
    if (!swapConfirming) { setSwapConfirming(true); return; }
    setSwapConfirming(false);
    if (amt > tokenIn.balance) { setMsg('Saldo insuficiente', 'err'); return; }
    setBusy(true); setMsg('Executando troca…', 'loading');
    try {
      const out = parseFloat(amountOut || '0');
      await callBridge(provider, demoMode, 'adla_swap', [{ tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn: amt, minOut: out * (1 - parseFloat(slippage) / 100) }], () => {
        setHoldings(hs => hs.map(h => {
          if (h.symbol === tokenIn.symbol) return { ...h, balance: h.balance - amt };
          if (h.symbol === tokenOut.symbol) return { ...h, balance: h.balance + out };
          return h;
        }));
      });
      pushActivity({ kind: 'swap', label: `${tokenIn.symbol} → ${tokenOut.symbol}`, amount: `${amt} → ${out.toFixed(4)}`, status: 'confirmed' });
      setMsg('Troca confirmada ✓');
      setAmountIn('');
    } catch (e: any) { setMsg(e?.message || 'Troca falhou', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, amountIn, swapConfirming, tokenIn, tokenOut, amountOut, slippage, provider, demoMode, setMsg, pushActivity]);

  const handleStake = useCallback(async () => {
    if (!ensureConnected()) return;
    const amt = parseFloat(stakeAmount.replace(',', '.'));
    const adla = holdings.find(h => h.symbol === 'ADLA');
    if (!adla || !amt || amt <= 0) { setMsg('Informe um valor para stake', 'err'); return; }
    if (amt > adla.balance) { setMsg('Saldo de $ADLA insuficiente', 'err'); return; }
    setBusy(true); setMsg('Confirmando stake…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_stake', [{ amount: amt }], () => {
        setHoldings(hs => hs.map(h => (h.symbol === 'ADLA' ? { ...h, balance: h.balance - amt } : h)));
        setStaked(s => s + amt);
      });
      pushActivity({ kind: 'stake', label: 'Stake de $ADLA', amount: `+${amt} ADLA`, status: 'confirmed' });
      setMsg('Stake confirmado ✓');
      setStakeAmount('');
    } catch (e: any) { setMsg(e?.message || 'Stake falhou', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, stakeAmount, holdings, provider, demoMode, setMsg, pushActivity]);

  const handleClaim = useCallback(async () => {
    if (!ensureConnected()) return;
    if (rewards <= 0) return;
    setBusy(true); setMsg('Resgatando recompensas…', 'loading');
    try {
      const amt = rewards;
      await callBridge(provider, demoMode, 'adla_claimRewards', [], () => {
        setHoldings(hs => hs.map(h => (h.symbol === 'ADLA' ? { ...h, balance: h.balance + amt } : h)));
        setRewards(0);
      });
      pushActivity({ kind: 'claim', label: 'Recompensas resgatadas', amount: `+${amt.toFixed(2)} ADLA`, status: 'confirmed' });
      setMsg('Recompensas resgatadas ✓');
    } catch (e: any) { setMsg(e?.message || 'Falha ao resgatar', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, rewards, provider, demoMode, setMsg, pushActivity]);

  const handleConfirmAddLiquidity = useCallback(async () => {
    if (!ensureConnected() || !liquidityPool) return;
    const ax = parseFloat(liqAmountX.replace(',', '.'));
    const ay = parseFloat(liqAmountY.replace(',', '.'));
    if (!ax || !ay) { setMsg('Informe os dois valores', 'err'); return; }
    setBusy(true); setMsg('Adicionando liquidez…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_addLiquidity', [{ poolId: liquidityPool.id, amountX: ax, amountY: ay }], () => {
        setPools(ps => ps.map(p => (p.id === liquidityPool.id ? { ...p, myShares: p.myShares + Math.round(ax + ay), tvl: p.tvl + ax + ay } : p)));
      });
      pushActivity({ kind: 'liquidity', label: `Liquidez ${liquidityPool.symbolX}/${liquidityPool.symbolY}`, amount: `+${ax} / +${ay}`, status: 'confirmed' });
      setMsg('Liquidez adicionada ✓');
      setLiquidityPool(null); setLiqAmountX(''); setLiqAmountY('');
    } catch (e: any) { setMsg(e?.message || 'Falha ao adicionar liquidez', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, liquidityPool, liqAmountX, liqAmountY, provider, demoMode, setMsg, pushActivity]);

  const handleConfirmRemove = useCallback(async () => {
    if (!ensureConnected() || !removeTarget) return;
    const shares = parseFloat(sheetAmount.replace(',', '.'));
    if (!shares || shares <= 0) { setMsg('Informe a quantidade de cotas', 'err'); return; }
    if (shares > removeTarget.myShares) { setMsg('Você não tem essa quantidade de cotas', 'err'); return; }
    setBusy(true); setMsg('Removendo liquidez…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_removeLiquidity', [{ poolId: removeTarget.id, shares }], () => {
        setPools(ps => ps.map(p => (p.id === removeTarget.id ? { ...p, myShares: p.myShares - shares } : p)));
      });
      pushActivity({ kind: 'liquidity', label: `Saída de ${removeTarget.symbolX}/${removeTarget.symbolY}`, amount: `-${shares} cotas`, status: 'confirmed' });
      setMsg('Liquidez removida ✓');
      setSheet(null); setSheetAmount(''); setRemoveTarget(null);
    } catch (e: any) { setMsg(e?.message || 'Falha ao remover liquidez', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, removeTarget, sheetAmount, provider, demoMode, setMsg, pushActivity]);

  const handleVote = useCallback(async (id: string, vote: 'yes' | 'no') => {
    if (!ensureConnected()) return;
    setBusy(true); setMsg('Registrando voto…', 'loading');
    try {
      await callBridge(provider, demoMode, 'adla_vote', [{ proposalId: id, vote }], () => {
        setProposals(ps => ps.map(p => {
          if (p.id !== id) return p;
          const bump = 4;
          return vote === 'yes'
            ? { ...p, yesPct: Math.min(100, p.yesPct + bump), noPct: Math.max(0, 100 - Math.min(100, p.yesPct + bump)), myVote: vote }
            : { ...p, noPct: Math.min(100, p.noPct + bump), yesPct: Math.max(0, 100 - Math.min(100, p.noPct + bump)), myVote: vote };
        }));
      });
      pushActivity({ kind: 'vote', label: 'Voto registrado', detail: id, status: 'confirmed' });
      setMsg('Voto registrado ✓');
    } catch (e: any) { setMsg(e?.message || 'Falha ao votar', 'err'); }
    finally { setBusy(false); }
  }, [ensureConnected, provider, demoMode, setMsg, pushActivity]);

  const statusLabel = provider && !demoMode
    ? (address ? 'Conectado à L3' : 'Carteira detectada')
    : demoMode ? 'Modo Demo' : 'Carteira não detectada';

  return (
    <div className="adla-app">
      <div className="bg-aurora" aria-hidden="true" />

      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <span className="brand-mark">ADLA</span>
            <span className="brand-sub">FANDOM FINANCE</span>
          </div>
          <WalletButton
            hasProvider={!!provider}
            address={address}
            connecting={connecting}
            demoMode={demoMode}
            onConnect={connect}
            onDisconnect={disconnect}
            onToggleDemo={setDemoMode}
          />
        </header>

        <div className="ticket-perf" aria-hidden="true" />

        <div className="ticker-strip">
          <span className={`live-dot ${provider && !demoMode ? 'is-live' : 'is-demo'}`} />
          <span className="ticker-static">{statusLabel}</span>
          <div className="ticker-marquee" aria-hidden="true">
            <span>
               PRÓXIMA SESSÃO DE GOVERNANÇA EM BREVE&nbsp;&nbsp;&nbsp;&nbsp;
               FAÇA STAKE DO SEU $ADLA E GANHE RECOMPENSA&nbsp;&nbsp;&nbsp;&nbsp;
               NOVAS POOLS DE LIQUIDEZ CHEGANDO&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
          </div>
        </div>

        {status && (
          <div className={`status-toast status-${status.type}`}>
            <Icon name="sparkle" size={14} spin={status.type === 'loading'} />
            {status.msg}
          </div>
        )}

        <nav className="tab-nav" role="tablist" aria-label="Seções do app">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeView === t.key}
              className={`tab-btn ${activeView === t.key ? 'tab-active' : ''}`}
              onClick={() => setActiveView(t.key)}
            >
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <main className="view">
          {activeView === 'home' && (
            <HomeView
              holdings={holdings} total={total} delta={delta}
              timeframe={timeframe} onTimeframe={setTimeframe} history={history}
              onAction={onHomeAction} rewards={rewards} onClaim={handleClaim} busy={busy}
            />
          )}
          {activeView === 'swap' && (
            <SwapView
              tokens={holdings} tokenIn={tokenIn} tokenOut={tokenOut}
              onSetTokenIn={h => setTokenInSym(h.symbol)} onSetTokenOut={h => setTokenOutSym(h.symbol)}
              amountIn={amountIn} onAmountIn={v => { setAmountIn(v); setSwapConfirming(false); }}
              amountOut={amountOut} impact={impact} route={route}
              slippage={slippage} onSlippage={setSlippage}
              busy={busy} confirming={swapConfirming} onSwap={handleSwap} onFlip={handleFlipSwap}
            />
          )}
          {activeView === 'stake' && (
            <StakeView
              stakeAmount={stakeAmount} onStakeAmount={setStakeAmount} onStake={handleStake}
              staked={staked} rewards={rewards} onClaim={handleClaim} busy={busy}
              pools={pools}
              onAddLiquidity={p => { setLiquidityPool(p); setLiqAmountX(''); setLiqAmountY(''); }}
              onRemoveLiquidity={p => { setRemoveTarget(p); setSheetAmount(''); setSheet('remove'); }}
            />
          )}
          {activeView === 'governance' && (
            <GovernanceView proposals={proposals} onVote={handleVote} busy={busy} />
          )}
          {activeView === 'activity' && (
            <ActivityView items={activity} />
          )}
        </main>
      </div>

      <AmountSheet
        open={sheet === 'deposit'} title="Depositar"
        tokens={holdings} token={sheetToken} onToken={setSheetToken}
        value={sheetAmount} onChange={setSheetAmount}
        onConfirm={handleDeposit} onClose={() => setSheet(null)}
        busy={busy} confirmLabel="Confirmar Depósito"
        hint={`Saldo atual: ${formatNum(sheetToken.balance)} ${sheetToken.symbol}`}
      />
      <AmountSheet
        open={sheet === 'withdraw'} title="Sacar"
        tokens={holdings} token={sheetToken} onToken={setSheetToken}
        value={sheetAmount} onChange={setSheetAmount}
        onConfirm={handleWithdraw} onClose={() => setSheet(null)}
        busy={busy} confirmLabel="Confirmar Saque"
        hint={`Disponível: ${formatNum(sheetToken.balance)} ${sheetToken.symbol}`}
      />
      <AmountSheet
        open={sheet === 'remove'} title="Remover Liquidez"
        value={sheetAmount} onChange={setSheetAmount}
        onConfirm={handleConfirmRemove} onClose={() => { setSheet(null); setRemoveTarget(null); }}
        busy={busy} confirmLabel="Confirmar Remoção"
        hint={removeTarget ? `Máx.: ${removeTarget.myShares} cotas (${removeTarget.symbolX}/${removeTarget.symbolY})` : undefined}
      />
      <LiquiditySheet
        open={!!liquidityPool} pool={liquidityPool}
        amountX={liqAmountX} amountY={liqAmountY}
        onAmountX={setLiqAmountX} onAmountY={setLiqAmountY}
        onConfirm={handleConfirmAddLiquidity} onClose={() => setLiquidityPool(null)}
        busy={busy}
      />
      <InstallHintSheet
        open={showInstallHint}
        onClose={() => setShowInstallHint(false)}
        onDemo={() => {
          setDemoMode(true);
          setShowInstallHint(false);
          setAddress(genDemoAddress());
          setMsg('Conectado em modo demo ✓');
        }}
      />
    </div>
  );
};

export default App;
