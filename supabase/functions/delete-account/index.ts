// Deletes the signed-in person's account: their budget data first (through
// delete_my_data, as themselves, so row security still applies), then the
// sign-in itself, which needs the service key and so has to run here, on
// the server. The app stores require that an account can be deleted from
// inside the app.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function ->
// Via editor, name it delete-account, paste this file, Deploy; then in its
// settings turn off "Verify JWT" (it checks the sign-in itself, below).
// Supabase gives every function SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY;
// nothing needs to be added.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return answer({ ok: false, error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  // the app sends its own (public) key; the project's legacy one also works
  const key = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const asUser = createClient(url, key, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await asUser.auth.getUser();
  if (error || !user) return answer({ ok: false, error: 'Sign in first.' }, 401);

  const gone = await asUser.rpc('delete_my_data');
  if (gone.error) return answer({ ok: false, error: 'Could not delete your budget: ' + gone.error.message }, 500);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const del = await admin.auth.admin.deleteUser(user.id);
  if (del.error) return answer({ ok: false, error: 'Your budget is deleted, but the sign-in could not be: ' + del.error.message }, 500);
  return answer({ ok: true });
});
