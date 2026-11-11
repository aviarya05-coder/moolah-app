"""One-off: builds web/index.html from the personal Moolah's public/index.html.

Kept in the repo so the port is reviewable and could be re-run against a
newer copy of the personal app. Every change is an exact cut or swap that
fails loudly if the source has moved on.
"""
import re, sys

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()

def cut_between(start, end, keep_end=False, repl=''):
    global s
    a = s.index(start); b = s.index(end, a)
    s = s[:a] + repl + (s[b:] if keep_end else s[b + len(end):])

def swap(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:70])
    s = s.replace(old, new)

# Google sign-in: the public app signs in with Supabase, added later
swap('<script src="https://accounts.google.com/gsi/client" async defer></script>\n', '')
# the retirement plan is the personal household's own; it is not part of the public app
cut_between('/*=PLAN-CSS=*/', '/*=/PLAN-CSS=*/\n')
cut_between('<!--=PLAN-HTML=-->', '<!--=/PLAN-HTML=-->\n')
cut_between('/*=PLAN-JS=*/', '/*=/PLAN-JS=*/')
cut_between('      <button type="button" class="morerow" data-tab="plan">', '</span></button>\n')
swap("  tab = ['activity', 'plan', 'log', 'import', 'more'].indexOf(name) > -1 ? name : 'map';",
     "  tab = ['activity', 'log', 'import', 'more'].indexOf(name) > -1 ? name : 'map';")
swap("  $('planscreen').hidden = tab !== 'plan';\n", '')
swap("  var lit = (tab === 'activity' || tab === 'plan') ? 'more' : tab;", "  var lit = tab === 'activity' ? 'more' : tab;")
swap("  else if (tab === 'plan') loadPlan();\n", '')
for mode in ("plog'){ el.innerHTML = renderPlanLog(); syncPlanLog(); return; }",
             "pset'){ el.innerHTML = renderPlanSettings(); return; }",
             "psim'){ el.innerHTML = renderPlanAside(); return; }"):
    swap("  if (sheetMode === '" + mode + "\n", '')

# the server connection: every action now goes to the engine, in the browser
cut_between('/*__BOOT__*/', 'var LIVE = true;', repl='var LIVE = true;')
cut_between('/* The plan tracker\'s actions answer with the plan', '/* Every server call goes through here.', keep_end=True)
cut_between('/* Every server call goes through here.', "function cacheState(st){", keep_end=True, repl='''/* Every action goes through here, to the engine (engine/backend.js) the app
   module hands over once it knows whose budget this is. The screens call it
   exactly as they called the personal app's server. */
var setBackend, backendReady = new Promise(function(res){ setBackend = res; });
window.moolahUse = function(b){ setBackend(b); };
function call(fn, args, ok, fail){
  backendReady.then(function(b){
    if (!b[fn]) throw new Error('That is not available yet.');
    return b[fn]((args && args[0]) || {});
  }).then(function(j){
    if (j && j.groups) normState(j);
    if (j && j.state) normState(j.state);
    ok(j);
  }, function(e){ if (fail) fail((e && e.message) || String(e)); });
}

''')
cut_between('/* The session check decides between the app and the sign-in gate. */', '/* Coming back to the app.', keep_end=True,
            repl='''/* The app module (app.js) starts the screens once the household is set up. */
window.moolahStart = function(){ $('gate').hidden = true; $('app').hidden = false; start(); };

''')
cut_between("if ('serviceWorker' in navigator){", '}\n\n', repl='')
swap("if (!S) $('loading').textContent = (st && st.error) || 'Could not read the sheet.';",
     "if (!S) $('loading').textContent = (st && st.error) || 'Could not load your budget.';")

# money in the household's own currency, not always shekels
swap("""function money(n, dp){
  var d = dp === undefined ? 2 : dp;
  return (n < 0 ? '-₪' : '₪') +""", """function cur(){ return (S && S.currency) || '₪'; }
function money(n, dp){
  var d = dp === undefined ? 2 : dp;
  return (n < 0 ? '-' + cur() : cur()) +""")
swap("""  $('amt').innerHTML = '<span class="cur">₪</span>' + typed();""", """  $('amt').innerHTML = '<span class="cur">' + cur() + '</span>' + typed();""")
swap("""'<span class="ain"><span>+₪</span>""", """'<span class="ain"><span>+' + cur() + '</span>""")
swap("""'<div class="mvamt"><span class="cur2">\\u20aa</span>' +""", """'<div class="mvamt"><span class="cur2">' + cur() + '</span>' +""")
swap("""'<span class="mvright"><span class="mvin"><span>₪</span>""", """'<span class="mvright"><span class="mvin"><span>' + cur() + '</span>""")
swap("""' back to ₪0</i></div>');""", """' back to ' + money0(0) + '</i></div>');""")

# words people see: the public app keeps budgets in its own database
swap("<p>Sign in with the Google account that has access to the budget spreadsheet.</p>", "<p>Sign in to see your budget.</p>")
swap("Not connected to your spreadsheet. Amounts here are invented to demonstrate the interface.",
     "Saved on this device only. Create an account to keep it safe and use it on your other phones.")
swap("toast(err || 'Could not reach the sheet — nothing was written.', true);", "toast(err || 'Could not save — nothing was written.', true);")
swap("$('loading').textContent = (state && state.error) || 'Could not read the spreadsheet.';",
     "$('loading').textContent = (state && state.error) || 'Could not load your budget.';")
swap("RC.err = (j && j.error) || 'Could not read the sheet.';", "RC.err = (j && j.error) || 'Could not load your transactions.';", 2)
swap("'Or a reconciliation file (.json) that Claude prepared for you.</div>';", "'Or a CSV file from any bank.</div>';")

# the quick-start copy of the figures is kept per person, so on a shared phone
# nobody sees another's budget, even for the moment before it loads
swap("function cacheState(st){ try { localStorage.setItem('lastState', JSON.stringify(st)); } catch(e){} }",
     "function cacheKey(){ return 'moolah.cache.' + (window.MOOLAH_USER || 'local'); }\n"
     "function cacheState(st){ try { localStorage.setItem(cacheKey(), JSON.stringify(st)); } catch(e){} }")
swap("function readCache(){ try { return normState(JSON.parse(localStorage.getItem('lastState') || 'null')); } catch(e){ return null; } }",
     "function readCache(){ try { return normState(JSON.parse(localStorage.getItem(cacheKey()) || 'null')); } catch(e){ return null; } }")

# the part-file markers belong to the personal repo's tooling
s = re.sub(r'^[ \t]*(?:/\*|<!--)=/?[A-Z0-9]+-[A-Z]+=(?:\*/|-->)[ \t]*\n', '', s, flags=re.M)
# the app module: set-up, the store and sign-in
swap('</body>', '<div id="setup" class="setup" hidden></div>\n<script type="module" src="./app.js"></script>\n</body>')
open(dst, 'w', encoding='utf-8').write(s)
print('wrote', dst, len(s), 'bytes')
