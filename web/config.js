/*
 * Where the app keeps budgets. Both values are public by design: they ship
 * inside the app to everyone, and only let a person reach what row security
 * allows (their own household). The secret key never belongs here.
 *
 * With no key, or when built with VITE_MOOLAH_LOCAL=1 (the end-to-end test),
 * the app keeps the budget on the device instead and needs no sign-in.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qnljdfrgmhtiutgxhyrk.supabase.co';
// the project's publishable key (Settings -> API Keys); a build can name another
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_pAmefGmk34TiaXUTMYKbmQ_C_ievd_6';

export const LOCAL_ONLY = !SUPABASE_KEY || import.meta.env.VITE_MOOLAH_LOCAL === '1';
