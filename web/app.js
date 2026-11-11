/*
 * The app's start: who is signed in, whose budget this is, where it is kept,
 * and the first-run set-up. The screens (index.html) only ever talk to the
 * backend this hands them, through window.moolahUse.
 *
 * Signed in, the budget lives in Supabase, where row security lets each
 * person reach only their own household. A new account has no household, so
 * it always starts at the set-up, with an empty budget. Signing out deletes
 * everything the app kept on the device.
 *
 * Without Supabase (no key in config.js, or the end-to-end test's build) the
 * budget is kept on the device instead, under its own key.
 */
import { createBackend, memoryStore } from '../engine/backend.js';
import { newHousehold, STARTER, CURRENCIES } from '../engine/setup.js';
import { supabaseStore, forStart } from '../engine/supabase-store.js';
import { SUPABASE_URL, SUPABASE_KEY, LOCAL_ONLY } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* Hands the screens their backend and shows them. Called once per page load;
   switching person reloads the page. */
function use(store, user) {
  window.MOOLAH_USER = user;                   // the screens keep their quick-start copy under it
  window.moolahUse(createBackend(store, { me: () => '' }));
  document.body.classList.remove('in-setup');
  $('setup').hidden = true;
  window.moolahStart();
}

/* Everything the app keeps on the device: the budget (device-only mode), the
   screens' quick-start copies, and the sign-in itself. */
function wipeDevice() {
  try {
    Object.keys(localStorage).filter((k) => /^(moolah\.|sb-|lastState$)/.test(k)).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* storage blocked: nothing was kept */ }
}

function panel(html) {
  document.body.classList.add('in-setup');
  $('loading').hidden = true;
  const el = $('setup');
  el.hidden = false;
  el.innerHTML = html;
  window.scrollTo(0, 0);
  return el;
}

/* ---- first run ---------------------------------------------------- */
function setup(save, fine) {
  const el = panel(`
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
      <p class="sufine">${esc(fine)}</p>
    </div>`);
  $('suHasCard').onchange = () => { $('suCard').hidden = !$('suHasCard').checked; };
  $('suGo').onclick = async () => {
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
    $('suGo').disabled = true; $('suErr').textContent = '';
    try { await save(d); } catch (e) { $('suErr').textContent = (e && e.message) || String(e); $('suGo').disabled = false; }
  };
}

/* ---- on this device only ------------------------------------------ */
function startLocal() {
  const user = 'local', key = 'moolah.budget.' + user;
  const write = (db) => { try { localStorage.setItem(key, JSON.stringify(db)); } catch (e) { /* private mode: kept in memory */ } };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { saved = null; }
  const go = (db) => use(memoryStore(db, write), user);
  if (saved && saved.accounts) go(saved);
  else setup(async (d) => { write(d); go(d); }, 'Your budget is saved on this phone. Nothing is shared with anyone.');
}

/* ---- signed in, with Supabase -------------------------------------- */
async function startSignedIn() {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  let user = null;
  client.auth.onAuthStateChange((event) => {
    // signed out anywhere (here, or the session was revoked): leave nothing behind
    if (event === 'SIGNED_OUT' && user) { wipeDevice(); location.reload(); }
  });

  const begin = async (session) => {
    user = session.user;
    const found = await client.from('households').select('id').limit(1);
    if (found.error) return failedToLoad(found.error.message, () => begin(session));
    const go = (hid) => { use(supabaseStore(client, hid), user.id); addAccountRows(client, user); };
    if (found.data.length) return go(found.data[0].id);
    setup(async (d) => {
      const r = await client.rpc('start_household', { p: forStart(d) });
      if (r.error) throw new Error(/already have/i.test(r.error.message) ? 'You already have a budget. Reload to open it.' : r.error.message);
      go(r.data);
    }, 'Your budget is kept in your account. Only you can see it.');
  };

  const { data } = await client.auth.getSession();
  if (data.session) return begin(data.session);
  signIn(client, begin);
}

function failedToLoad(msg, retry) {
  panel(`<div class="su"><div class="sumark">M</div><h1>Moolah</h1>
    <p class="sulead">Could not load your budget. Check your connection and try again.</p>
    <div class="suerr">${esc(msg || '')}</div><button class="sugo" id="suRetry">Try again</button></div>`);
  $('suRetry').onclick = retry;
}

function signIn(client, begin) {
  panel(`
    <div class="su">
      <div class="sumark">M</div>
      <h1>Moolah</h1>
      <p class="sulead">Sign in, or make an account. We'll email you a code, so there's no password to remember.</p>
      <label for="inEmail">Your email</label>
      <input id="inEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="200">
      <button class="sugo" id="inSend">Email me a code</button>
      <div id="inCodeBox" hidden>
        <label for="inCode" id="inCodeLbl">The code from the email</label>
        <input id="inCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10">
        <button class="sugo" id="inGo">Sign in</button>
        <button class="sulink" id="inAgain">Use a different email</button>
      </div>
      <div class="suerr" id="inErr"></div>
      <p class="sufine">New here? The same code makes your account. Your budget starts empty and only you can see it.</p>
    </div>`);
  const err = (m) => { $('inErr').textContent = m || ''; };
  const email = () => $('inEmail').value.trim().toLowerCase();
  $('inSend').onclick = async () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email())) return err('Enter your email address.');
    $('inSend').disabled = true; err('');
    const r = await client.auth.signInWithOtp({ email: email(), options: { shouldCreateUser: true } });
    $('inSend').disabled = false;
    if (r.error) return err(/rate|seconds/i.test(r.error.message) ? 'Too many codes asked for. Wait a minute and try again.' : r.error.message);
    $('inEmail').disabled = true; $('inSend').hidden = true; $('inCodeBox').hidden = false;
    $('inCodeLbl').textContent = 'The code we sent to ' + email();
    $('inCode').focus();
  };
  $('inGo').onclick = async () => {
    const code = $('inCode').value.replace(/\D/g, '');
    if (code.length < 6) return err('Enter the code from the email.');
    $('inGo').disabled = true; err('');
    let r = await client.auth.verifyOtp({ email: email(), token: code, type: 'email' });
    // a brand-new account's first code can come as a sign-up confirmation
    if (r.error) { const s = await client.auth.verifyOtp({ email: email(), token: code, type: 'signup' }); if (!s.error) r = s; }
    $('inGo').disabled = false;
    if (r.error || !r.data.session) return err(r.error && /expired|invalid/i.test(r.error.message) ? 'That code is wrong or has expired. Ask for a new one.' : ((r.error && r.error.message) || 'Could not sign in.'));
    begin(r.data.session);
  };
  $('inCode').onkeydown = (e) => { if (e.key === 'Enter') $('inGo').click(); };
  $('inEmail').onkeydown = (e) => { if (e.key === 'Enter') $('inSend').click(); };
  $('inAgain').onclick = () => {
    $('inEmail').disabled = false; $('inSend').hidden = false; $('inCodeBox').hidden = true; $('inCode').value = ''; err('');
    $('inEmail').focus();
  };
}

/* Signing out and deleting the account, at the bottom of More. */
function addAccountRows(client, user) {
  const list = document.querySelector('#morescreen .morelist');
  if (!list || $('acctOut')) return;
  list.insertAdjacentHTML('beforeend', `
    <button type="button" class="morerow" id="acctOut">
      <span><b>Sign out</b><i>${esc(user.email || '')}</i></span><span class="arr">›</span></button>
    <button type="button" class="morerow danger" id="acctDel">
      <span><b>Delete account</b><i>Your budget and your sign-in, for good</i></span><span class="arr">›</span></button>`);
  $('acctOut').onclick = async () => {
    if (!confirm('Sign out of Moolah on this phone?')) return;
    wipeDevice();
    await client.auth.signOut();
    location.reload();
  };
  $('acctDel').onclick = async () => {
    if (!confirm('Delete your Moolah account?\n\nYour budget, every transaction in it, and your sign-in are deleted for good. This cannot be undone.')) return;
    const r = await client.functions.invoke('delete-account', { method: 'POST' });
    if (r.error || !(r.data && r.data.ok)) {
      let msg = (r.data && r.data.error) || (r.error && r.error.message) || 'Could not delete the account.';
      try { const j = r.error && r.error.context && await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep msg */ }
      if (window.toast) window.toast(msg, true); else alert(msg);
      return;
    }
    wipeDevice();
    await client.auth.signOut({ scope: 'local' });
    location.reload();
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
  .su input:disabled { opacity: .6; }
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
  .sugo:disabled { opacity: .6; }
  .sulink { display: block; width: 100%; background: none; border: 0; color: var(--accent); font-size: 15px; font-family: inherit;
    padding: 14px; margin-top: 4px; cursor: pointer; }
  .sufine { font-size: 13px; color: var(--faint); text-align: center; margin-top: 12px; line-height: 1.45; }
  .morerow.danger b { color: var(--dang); }`;
const style = document.createElement('style');
style.textContent = CSS;
document.head.appendChild(style);

if (LOCAL_ONLY) startLocal();
else startSignedIn().catch((e) => failedToLoad((e && e.message) || String(e), () => location.reload()));
