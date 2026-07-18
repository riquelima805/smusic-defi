import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
// Logo importado como módulo: o Vite resolve a URL final certa em build,
// independente do `base` do vite.config.ts (ex: './' pro GitHub Pages) e sem
// depender da URL atual do navegador. Coloque o arquivo em src/assets/logo.png.
import logoUrl from './assets/logo.png';

/* Tela de swap — conversão de ativos via API da Jupiter.
   A carteira injetada (window.adlaWallet) recebe a transação em Base64
   e assina nativamente no Android. */

type AdlaMethod = 'sol_requestAccounts' | 'sol_accounts' | 'sol_sendTransaction';
type AdlaEvent = 'accountsChanged' | 'disconnect';
interface AdlaRequestArgs { method: AdlaMethod; params?: unknown[]; }

interface AdlaWalletProvider {
  isAdlaWallet?: boolean;
  chainId?: string;
  request<T = unknown>(args: AdlaRequestArgs): Promise<T>;
  on(event: AdlaEvent, handler: (...args: any[]) => void): void;
  removeListener(event: AdlaEvent, handler: (...args: any[]) => void): void;
}

declare global { interface Window { adlaWallet?: AdlaWalletProvider; } }

interface Holding { symbol: string; name: string; address: string; decimals: number; balance: number; color: string; }

// Moedas reais da Mainnet para a Jupiter encontrar as rotas.
// IMPORTANTE: estes são endereços de MAINNET. O bridge Kotlin (AdlaJsBridge)
// hoje reporta chainId "solana-devnet" — antes de ligar o swap de verdade,
// alinhe a rede: ou o app roda em mainnet-beta, ou troque estes mints pelos
// equivalentes de devnet (USDC/USDT de teste têm mints diferentes lá).
// `balance` começa em 0 e é preenchido por fetchBalances() quando a carteira conecta.
const REAL_TOKENS: Holding[] = [
  { symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112', decimals: 9, balance: 0, color: 'var(--holo-cyan)' },
  { symbol: 'USDC', name: 'USD Coin', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, balance: 0, color: 'var(--fandom-violet)' },
  { symbol: 'USDT', name: 'Tether USD', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, balance: 0, color: 'var(--spotlight-gold)' },
  // USDG (Global Dollar, emitido pela Paxos) — token Token-2022, 6 casas decimais.
  { symbol: 'USDG', name: 'Global Dollar', address: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH', decimals: 6, balance: 0, color: 'var(--kpop-pink, #ff6fb5)' },
];

// RPC pública da mainnet — troque por um provedor dedicado (Helius/QuickNode/etc)
// em produção, a pública tem rate limit baixo.
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Busca saldo real na chain: SOL nativo via getBalance, tokens SPL/Token-2022
// via getParsedTokenAccountsByOwner (uma chamada por program id).
async function fetchBalances(owner: string, tokens: Holding[]): Promise<Record<string, number>> {
  const rpc = async (method: string, params: unknown[]) => {
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'Erro RPC');
    return json.result;
  };

  const balances: Record<string, number> = {};

  // 1. SOL nativo
  try {
    const sol = await rpc('getBalance', [owner]);
    balances['So11111111111111111111111111111111111111112'] = (sol?.value ?? 0) / 1e9;
  } catch (e) {
    console.error('Falha ao buscar saldo SOL', e);
  }

  // 2. Tokens SPL (program clássico) e Token-2022 (ex: USDG)
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const result = await rpc('getTokenAccountsByOwner', [
        owner,
        { programId },
        { encoding: 'jsonParsed' },
      ]);
      for (const { account } of result?.value ?? []) {
        const info = account?.data?.parsed?.info;
        const mint = info?.mint;
        const amount = info?.tokenAmount?.uiAmount;
        if (mint && typeof amount === 'number') balances[mint] = amount;
      }
    } catch (e) {
      console.error(`Falha ao buscar contas do program ${programId}`, e);
    }
  }

  // Garante 0 para tokens da lista sem conta ainda aberta
  for (const t of tokens) if (!(t.address in balances)) balances[t.address] = 0;
  return balances;
}

function useAdlaProvider(): AdlaWalletProvider | null {
  const [provider, setProvider] = useState<AdlaWalletProvider | null>(() => typeof window !== 'undefined' ? window.adlaWallet ?? null : null);
  useEffect(() => {
    if (provider) return;
    const pickUp = () => { if (window.adlaWallet) setProvider(window.adlaWallet); };
    window.addEventListener('adla#initialized', pickUp);
    const id = window.setInterval(pickUp, 500);
    return () => { window.removeEventListener('adla#initialized', pickUp); window.clearInterval(id); };
  }, [provider]);
  return provider;
}

const ICONS = {
  swap: <><path d="M7 7h11l-3.2-3.2" /><path d="M17 17H6l3.2 3.2" /></>,
  wallet: <><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="16" cy="14.5" r="1.1" fill="currentColor" stroke="none" /></>,
  chevronDown: <path d="M5 8.5 12 15l7-6.5" />,
  arrowUpDown: <><path d="M7 4v13M7 17l-3-3M7 17l3-3" /><path d="M17 20V7M17 7l3 3M17 7l-3 3" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
};

function Icon({ name, size = 20, spin = false }: { name: keyof typeof ICONS; size?: number; spin?: boolean }) {
  if (spin) return (
    <svg className="icon icon-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="34 100" />
    </svg>
  );
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

function TokenPicker({ value, options, onChange }: { value: Holding; options: Holding[]; onChange: (h: Holding) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="token-picker">
      <button type="button" className="token-picker-btn" onClick={() => setOpen(!open)}>
        <span className="token-dot" style={{ background: value.color }} />
        {value.symbol} <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="token-picker-list" onClick={() => setOpen(false)}>
          {options.map(o => (
            <button type="button" key={o.symbol} className="token-picker-item" onClick={() => onChange(o)}>
              <span className="token-dot" style={{ background: o.color }} />
              <span>{o.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const App: React.FC = () => {
  const provider = useAdlaProvider();
  const [address, setAddress] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState<{ msg: string; type: 'ok' | 'err' | 'loading' } | null>(null);
  const [busy, setBusy] = useState(false);

  const [tokens, setTokens] = useState<Holding[]>(REAL_TOKENS);
  const [tokenIn, setTokenIn] = useState(REAL_TOKENS[0]);
  const [tokenOut, setTokenOut] = useState(REAL_TOKENS[1]);
  const [amountIn, setAmountIn] = useState('');
  const [loadingBalances, setLoadingBalances] = useState(false);
  
  // Estado da Jupiter
  const [quote, setQuote] = useState<any>(null);
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [slippage] = useState('0.5');

  const setMsg = useCallback((msg: string, type: 'ok' | 'err' | 'loading' = 'ok') => {
    setStatus({ msg, type });
    if (type !== 'loading') setTimeout(() => setStatus(null), 3500);
  }, []);

  // Busca a cotação na Jupiter toda vez que o valor digitado muda
  useEffect(() => {
    const fetchQuote = async () => {
      const amt = parseFloat(amountIn.replace(',', '.'));
      if (!amt || isNaN(amt)) { setQuote(null); return; }
      
      setFetchingQuote(true);
      try {
        const amountRaw = Math.floor(amt * Math.pow(10, tokenIn.decimals));
        // quote-api.jup.ag/v6 (Metis) foi descontinuada. O free tier atual é lite-api.jup.ag/swap/v1.
        // Para produção com mais rate limit, use https://api.jup.ag/swap/v1 com uma API key (portal.jup.ag).
        const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${tokenIn.address}&outputMint=${tokenOut.address}&amount=${amountRaw}&slippageBps=${parseFloat(slippage) * 100}`;
        const res = await fetch(url);
        const data = await res.json();
        setQuote(data.error ? null : data);
      } catch (e) {
        setQuote(null);
      } finally {
        setFetchingQuote(false);
      }
    };

    const delay = setTimeout(fetchQuote, 500);
    return () => clearTimeout(delay);
  }, [amountIn, tokenIn, tokenOut, slippage]);

  const refreshBalances = useCallback(async (owner: string) => {
    setLoadingBalances(true);
    try {
      const map = await fetchBalances(owner, REAL_TOKENS);
      setTokens(prev => {
        const next = prev.map(t => ({ ...t, balance: map[t.address] ?? t.balance }));
        // Mantém tokenIn/tokenOut sincronizados com os novos saldos
        setTokenIn(cur => next.find(t => t.symbol === cur.symbol) ?? cur);
        setTokenOut(cur => next.find(t => t.symbol === cur.symbol) ?? cur);
        return next;
      });
    } catch (e) {
      setMsg('Não foi possível carregar os saldos', 'err');
    } finally {
      setLoadingBalances(false);
    }
  }, [setMsg]);

  // Auto-detecta carteira já autorizada (ex: reabrir o app com a extensão já
  // conectada de uma sessão anterior) — sem isso, só carregava endereço/saldo
  // depois de clicar em "Conectar Carteira" de novo a cada abertura.
  useEffect(() => {
    if (!provider) return;
    provider.request<string[]>({ method: 'sol_accounts' })
      .then(accs => {
        if (accs?.[0]) {
          setAddress(accs[0]);
          refreshBalances(accs[0]);
        }
      })
      .catch(() => {});

    const onAccountsChanged = (accs: string[]) => {
      const next = accs?.[0] ?? '';
      setAddress(next);
      if (next) refreshBalances(next);
    };
    const onDisconnect = () => setAddress('');
    provider.on('accountsChanged', onAccountsChanged);
    provider.on('disconnect', onDisconnect);
    return () => {
      provider.removeListener('accountsChanged', onAccountsChanged);
      provider.removeListener('disconnect', onDisconnect);
    };
  }, [provider, refreshBalances]);

  const connect = async () => {
    if (!provider) { setMsg('Carteira não detectada', 'err'); return; }
    setConnecting(true); setMsg('Aguardando carteira...', 'loading');
    try {
      const accs = await provider.request<string[]>({ method: 'sol_requestAccounts' });
      if (accs?.[0]) {
        setAddress(accs[0]);
        setMsg('Conectado ✓');
        refreshBalances(accs[0]);
      }
    } catch (e: any) { setMsg('Conexão falhou', 'err'); }
    finally { setConnecting(false); }
  };

  const executeSwap = async () => {
    if (!address) { setMsg('Conecte a carteira primeiro', 'err'); return; }
    if (!quote) { setMsg('Aguarde a cotação', 'err'); return; }

    setBusy(true); setMsg('Construindo transação...', 'loading');
    try {
      // 1. Pede pra Jupiter montar a transação (Devolve um Base64)
      const swapReq = await fetch('https://lite-api.jup.ag/swap/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: address,
          wrapAndUnwrapSol: true
        })
      });
      const { swapTransaction } = await swapReq.json();

      if (!swapTransaction) throw new Error("Falha ao gerar rota na Jupiter");

      setMsg('Assine na sua carteira...', 'loading');
      
      // 2. Envia o Base64 pro seu Kotlin (AdlaJsBridge)
      const res = await provider!.request<any>({
        method: 'sol_sendTransaction',
        params: [swapTransaction]
      });

      setMsg(`Troca enviada! ID: ${res.txId?.substring(0, 8)}...`, 'ok');
      setAmountIn('');
      if (address) refreshBalances(address);
    } catch (e: any) {
      setMsg(e.message || 'Erro ao trocar', 'err');
    } finally {
      setBusy(false);
    }
  };

  const amountOutFormatted = quote 
    ? (quote.outAmount / Math.pow(10, tokenOut.decimals)).toFixed(4) 
    : '';

  return (
    <div className="adla-app">
      <div className="bg-aurora" aria-hidden="true" />
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <img src={logoUrl} alt="Logo" style={{ height: '40px', width: 'auto' }} />
          </div>
          <button type="button" className="btn-connect" onClick={address ? () => setAddress('') : connect}>
            <Icon name="wallet" size={16} spin={connecting} />
            {address ? `${address.slice(0,6)}...${address.slice(-4)}` : 'Conectar Carteira'}
          </button>
        </header>

        {status && (
          <div className={`status-toast status-${status.type}`}>
            <Icon name="sparkle" size={14} spin={status.type === 'loading'} /> {status.msg}
          </div>
        )}

        <main className="view" style={{ marginTop: '20px' }}>
          <section className="card">
            <p className="eyebrow"></p>
            <h3>Trocar Ativos</h3>

            <div className="swap-box">
              <div className="swap-box-head">
                <span>Você paga</span>
                <span className="swap-box-balance">
                  {loadingBalances ? 'Carregando saldo...' : `Saldo: ${tokenIn.balance.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} ${tokenIn.symbol}`}
                  {!loadingBalances && address && tokenIn.balance > 0 && (
                    <button type="button" className="btn-max" onClick={() => setAmountIn(String(tokenIn.balance))}>MAX</button>
                  )}
                </span>
              </div>
              <div className="swap-box-row">
                <input type="text" placeholder="0.0" value={amountIn} onChange={e => setAmountIn(e.target.value)} />
                <TokenPicker value={tokenIn} options={tokens.filter(t => t.symbol !== tokenOut.symbol)} onChange={setTokenIn} />
              </div>
            </div>

            <button type="button" className="swap-flip" onClick={() => { setTokenIn(tokenOut); setTokenOut(tokenIn); setAmountIn(''); }}>
              <Icon name="arrowUpDown" size={18} />
            </button>

            <div className="swap-box">
              <div className="swap-box-head">
                <span>Você recebe</span>
                <span className="swap-box-balance">
                  {loadingBalances ? '' : `Saldo: ${tokenOut.balance.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} ${tokenOut.symbol}`}
                </span>
              </div>
              <div className="swap-box-row">
                <input readOnly placeholder={fetchingQuote ? 'Calculando...' : '0.0'} value={amountOutFormatted} />
                <TokenPicker value={tokenOut} options={tokens.filter(t => t.symbol !== tokenIn.symbol)} onChange={setTokenOut} />
              </div>
            </div>

            <button type="button" className="btn-primary-cta" disabled={!amountIn || !quote || busy || fetchingQuote} onClick={executeSwap}>
              {busy ? 'Processando…' : fetchingQuote ? 'Buscando melhor rota...' : 'Confirmar Troca'}
            </button>
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;