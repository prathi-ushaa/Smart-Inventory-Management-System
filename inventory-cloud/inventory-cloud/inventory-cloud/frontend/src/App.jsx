import React, { useEffect, useState } from 'react';
import { api, setToken } from './api.js';

const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');

function useList(path) {
  const [rows, setRows] = useState([]);
  const load = () => api(path).then(setRows).catch(() => {});
  useEffect(() => { load(); }, [path]);
  return [rows, load];
}

/* ---------- Login / Register ---------- */
function Auth({ onDone }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'staff' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const d = await api('/auth/' + mode, { method: 'POST', body: f });
      setToken(d.token);
      localStorage.setItem('user', JSON.stringify(d.user));
      onDone(d.user);
    } catch (x) { setErr(x.message); }
  };

  return (
    <form className="panel auth" onSubmit={submit}>
      <h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>
      {mode === 'register' && (
        <>
          <input placeholder="Full name" value={f.name} onChange={set('name')} required />
          <select value={f.role} onChange={set('role')}>
            <option value="staff">Staff (records stock in/out)</option>
            <option value="admin">Admin (also manages products)</option>
          </select>
        </>
      )}
      <input type="email" placeholder="Email" value={f.email} onChange={set('email')} required />
      <input type="password" placeholder="Password" value={f.password} onChange={set('password')} required />
      {err && <p className="error">{err}</p>}
      <button className="primary">{mode === 'login' ? 'Log in' : 'Create account'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
      </button>
    </form>
  );
}

/* ---------- Dashboard: stats + reorder suggestions ---------- */
function Dashboard() {
  const [d, setD] = useState(null);
  useEffect(() => { api('/insights').then(setD); }, []);
  if (!d) return <p className="muted">Loading...</p>;
  const s = d.stats;
  const items = [['Products', s.products], ['Units in stock', s.units], ['Stock value', money(s.value)], ['Low stock', s.low], ['Out of stock', s.out]];
  return (
    <>
      <section className="panel stats">
        {items.map(([k, v]) => <div key={k}><b>{v}</b><span className="muted">{k}</span></div>)}
      </section>
      <section className="panel">
        <h2>Reorder suggestions</h2>
        <p className="muted">Based on the last 30 days of stock going out.</p>
        {d.reorder.length === 0 ? <p className="muted">All products are well stocked.</p> : (
          <table>
            <thead><tr><th>Product</th><th>In stock</th><th>Used per day</th><th>Days left</th><th>Order</th></tr></thead>
            <tbody>
              {d.reorder.map((r) => (
                <tr key={r._id} className="low">
                  <td>{r.name}<div className="muted small">{r.reason}</div></td>
                  <td>{r.quantity}</td><td>{r.avgDaily}</td><td>{r.daysLeft ?? '-'}</td><td><b>{r.suggested}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/* ---------- Products + stock in/out ---------- */
function Products({ isAdmin }) {
  const [rows, load] = useList('/products');
  const [mv, setMv] = useState({ product: '', type: 'out', qty: '', note: '' });
  const [np, setNp] = useState({ sku: '', name: '', category: '', quantity: '', reorderLevel: '', price: '' });
  const [msg, setMsg] = useState({ text: '', error: false });
  const say = (text, error = false) => setMsg({ text, error });
  const run = async (fn) => { try { await fn(); } catch (e) { say(e.message, true); } };

  const move = (e) => { e.preventDefault(); run(async () => {
    const d = await api(`/products/${mv.product}/move`, { method: 'POST', body: mv });
    say(`Recorded. ${d.quantity} left in stock.`); setMv({ ...mv, qty: '', note: '' }); load();
  }); };

  const add = (e) => { e.preventDefault(); run(async () => {
    await api('/products', { method: 'POST', body: np });
    say(`Added ${np.name}.`); setNp({ sku: '', name: '', category: '', quantity: '', reorderLevel: '', price: '' }); load();
  }); };

  const remove = (p) => window.confirm(`Delete ${p.name} and its history?`) &&
    run(async () => { await api('/products/' + p._id, { method: 'DELETE' }); load(); });

  const download = () => run(async () => {
    const blob = await api('/report.csv', { raw: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'inventory-report.csv';
    a.click();
  });

  const setN = (k) => (e) => setNp({ ...np, [k]: e.target.value });

  return (
    <>
      <section className="panel">
        <h2>Record stock movement</h2>
        <form className="row" onSubmit={move}>
          <select value={mv.product} onChange={(e) => setMv({ ...mv, product: e.target.value })} required>
            <option value="">Product</option>
            {rows.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.quantity})</option>)}
          </select>
          <select value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}>
            <option value="out">Stock out (sold / used)</option>
            <option value="in">Stock in (received)</option>
          </select>
          <input type="number" min="1" placeholder="Quantity" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} required />
          <input placeholder="Note (optional)" value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} />
          <button className="primary">Record</button>
        </form>
        {msg.text && <p className={msg.error ? 'error' : 'muted'}>{msg.text}</p>}
      </section>

      <section className="panel">
        <div className="row between">
          <h2>Products</h2>
          <button onClick={download}>Download CSV report</button>
        </div>
        {isAdmin && (
          <form className="row" onSubmit={add}>
            <input placeholder="SKU" value={np.sku} onChange={setN('sku')} required />
            <input placeholder="Name" value={np.name} onChange={setN('name')} required />
            <input placeholder="Category" value={np.category} onChange={setN('category')} />
            <input type="number" min="0" placeholder="Opening stock" value={np.quantity} onChange={setN('quantity')} />
            <input type="number" min="0" placeholder="Reorder level" value={np.reorderLevel} onChange={setN('reorderLevel')} />
            <input type="number" min="0" placeholder="Price" value={np.price} onChange={setN('price')} />
            <button className="primary">Add product</button>
          </form>
        )}
        {rows.length === 0 ? <p className="muted">No products yet.{isAdmin ? ' Add your first product above.' : ' Ask an admin to add products.'}</p> : (
          <table>
            <thead><tr><th>SKU</th><th>Name</th><th>Category</th><th>In stock</th><th>Reorder at</th><th>Price</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p._id} className={p.quantity <= p.reorderLevel ? 'low' : ''}>
                  <td>{p.sku}</td><td>{p.name}</td><td>{p.category}</td><td>{p.quantity}</td><td>{p.reorderLevel}</td><td>{money(p.price)}</td>
                  {isAdmin && <td className="actions"><button onClick={() => remove(p)}>Delete</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/* ---------- History ---------- */
function History() {
  const [rows] = useList('/movements');
  return (
    <section className="panel">
      <h2>Recent stock movements</h2>
      {rows.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
        <table>
          <thead><tr><th>When</th><th>Product</th><th>Change</th><th>By</th><th>Note</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m._id}>
                <td>{new Date(m.date).toLocaleString()}</td><td>{m.product?.name}</td>
                <td><span className={'tag ' + (m.type === 'in' ? 'completed' : 'cancelled')}>{m.type === 'in' ? '+' : '-'}{m.qty}</span></td>
                <td>{m.by?.name}</td><td>{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ---------- App shell ---------- */
export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [tab, setTab] = useState('Dashboard');
  const logout = () => { setToken(''); localStorage.removeItem('user'); setUser(null); setTab('Dashboard'); };

  if (!user) return <main><Auth onDone={setUser} /></main>;
  return (
    <main>
      <header>
        <strong>Smart Inventory</strong>
        <span>{user.name} ({user.role}) <button className="link" onClick={logout}>Log out</button></span>
      </header>
      <nav>{['Dashboard', 'Products', 'History'].map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
      {tab === 'Dashboard' && <Dashboard />}
      {tab === 'Products' && <Products isAdmin={user.role === 'admin'} />}
      {tab === 'History' && <History />}
    </main>
  );
}
