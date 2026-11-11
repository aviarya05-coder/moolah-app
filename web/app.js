/*
 * The app's start: whose budget this is, where it is kept, and the first-run
 * set-up. The screens (index.html) only ever talk to the backend this hands
 * them, through window.moolahUse.
 *
 * Until sign-in exists, the budget lives on this device (localStorage). Each
 * person's copy is kept under their own key, so the app never shows one
 * person another's figures; signing out (later) deletes the device copy.
 */
import { createBackend, memoryStore } from '../engine/backend.js';
import { newHousehold, STARTER, CURRENCIES } from '../engine/setup.js';

const USER = 'local';                         // the signed-in user's id, once there is sign-in
window.MOOLAH_USER = USER;                     // the screens keep their quick-start copy under it too
const KEY = 'moolah.budget.' + USER;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
const write = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* private mode: kept in memory */ } };

function use(db) {
  const store = memoryStore(db, write);
  window.moolahUse(createBackend(store, { me: () => '' }));
  document.body.classList.remove('in-setup');
  document.getElementById('setup').hidden = true;
  window.moolahStart();
}

/* ---- first run ---------------------------------------------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function setup() {
  document.body.classList.add('in-setup');
  document.getElementById('loading').hidden = true;
  const el = document.getElementById('setup');
  el.hidden = false;
  el.innerHTML = `
    <div class="su">
      <div class="sumark">M</div>
      <h1>Welcome to Moolah</h1>
      <p class="sulead">Give your money a job. A minute to set up, and you can change all of it later.</p>

      <label for="suName">What should we call your budget?</label>
      <input id="suName" autocomplete="off" placeholder="e.g. The Cohen home" maxlength="80">

      <label for="suCur">Currency</label>
      <select id="suCur">${CURRENCIES.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('')}</select>

      <div class="suh">Your bank account</div>
      <input id="suBank" autocomplete="off" value="Checking account" maxlength="60" aria-label="Bank account name">
      <input id="suBal" inputmode="decimal" autocomplete="off" placeholder="What it holds today (optional)" aria-label="What the bank account holds today">

      <label class="suchk"><input type="checkbox" id="suHasCard" checked> I use a credit card</label>
      <div id="suCard">
        <input id="suCardName" autocomplete="off" value="Credit card" maxlength="60" aria-label="Credit card name">
        <input id="suOwed" inputmode="decimal" autocomplete="off" placeholder="What you owe on it today (optional)" aria-label="What is owed on the card today">
      </div>

      <div class="suh">Categories to start with</div>
      <p class="suhint">Untick what you don't need. You can add your own later.</p>
      ${STARTER.map((g) => `<div class="sug"><b>${esc(g.group)}</b>${g.categories.map(([n]) =>
        `<label><input type="checkbox" data-sucat="${esc(n)}" checked> ${esc(n)}</label>`).join('')}</div>`).join('')}

      <div class="suerr" id="suErr"></div>
      <button class="sugo" id="suGo">Start budgeting</button>
      <p class="sufine">Your budget is saved on this phone. Nothing is shared with anyone.</p>
    </div>`;
  const $ = (id) => document.getElementById(id);
  $('suHasCard').onchange = () => { $('suCard').hidden = !$('suHasCard').checked; };
  $('suGo').onclick = () => {
    const num = (v) => { const t = String(v || '').replace(/[^\d.\-]/g, ''); return t === '' ? 0 : Number(t); };
    const keep = [...el.querySelectorAll('[data-sucat]')].filter((x) => x.checked).map((x) => x.dataset.sucat);
    if (!keep.length) { $('suErr').textContent = 'Keep at least one category.'; return; }
    const d = newHousehold({
      name: $('suName').value, currency: $('suCur').value,
      cash: { name: $('suBank').value, balance: num($('suBal').value) },
      card: $('suHasCard').checked ? { name: $('suCardName').value, owed: num($('suOwed').value) } : null,
      keep, date: today(),
    });
    if (d.error) { $('suErr').textContent = d.error; return; }
    write(d);
    use(d);
  };
}

const CSS = `
  body.in-setup #app, body.in-setup #tabbar, body.in-setup .mapscreen { display: none !important; }
  .setup { min-height: 100vh; background: var(--bg); color: var(--ink); }
  .su { max-width: 480px; margin: 0 auto; padding: calc(28px + env(safe-area-inset-top)) 18px calc(40px + env(safe-area-inset-bottom)); }
  .sumark { width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center; font-size: 30px; font-weight: 700;
    background: var(--accentfill); color: var(--onacc); margin-bottom: 18px; }
  .su h1 { font-size: 32px; font-weight: 700; letter-spacing: -.025em; margin: 0 0 6px; }
  .sulead { font-size: 16px; color: var(--mut); margin: 0 0 22px; line-height: 1.45; }
  .su label, .suh { display: block; font-size: 15px; font-weight: 600; margin: 18px 0 8px; }
  .su input:not([type=checkbox]), .su select { width: 100%; box-sizing: border-box; background: var(--card); color: var(--ink); border: 0;
    border-radius: 12px; padding: 13px 14px; font-size: 16px; font-family: inherit; margin-bottom: 8px; }
  .su input:focus, .su select:focus { outline: none; box-shadow: inset 0 0 0 1.5px var(--accent); }
  .suchk { display: flex !important; align-items: center; gap: 10px; font-weight: 600; }
  .suhint { font-size: 13px; color: var(--mut); margin: -4px 0 10px; }
  .sug { background: var(--card); border-radius: 14px; padding: 10px 14px; margin-bottom: 8px; }
  .sug b { display: block; font-size: 13px; color: var(--mut); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin: 2px 0 4px; }
  .sug label { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 400; margin: 0; padding: 7px 0; }
  .su input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--accent); margin: 0; flex: none; }
  .suerr { color: var(--dang); font-size: 14px; min-height: 20px; margin-top: 12px; }
  .sugo { width: 100%; border: 0; border-radius: 100px; padding: 16px; font-size: 17px; font-weight: 600; background: var(--accentfill);
    color: var(--onacc); cursor: pointer; margin-top: 6px; }
  .sufine { font-size: 13px; color: var(--faint); text-align: center; margin-top: 12px; }`;
const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

const saved = read();
if (saved && saved.accounts) use(saved);
else setup();
