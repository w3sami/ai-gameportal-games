"use strict";
/* ============================================================
   mp-api.js — pieni fetch-kääre /api/*-reiteille (rekisteröinti,
   kirjautuminen, istunnon tarkistus).

   Kaksi tapaa ajaa samaa frontendia:
   - jatsi.bigbools.fi (tai localhost): palvelin tarjoilee sivun itse,
     kutsut menevät samaan originiin ja istunto kulkee evästeessä.
   - AI-peliportaali (<id>.game.bigbools.fi): sivu on portaalissa, palvelin
     on jatsi.bigbools.fi. Eväste ei kulje hiekkalaatikkokehyksestä, joten
     kirjautuminen pyytää tokenin, joka pidetään localStoragessa ja
     lähetetään Authorization-otsakkeessa (ks. server/auth.js).
   ============================================================ */
window.MpApi = (function () {
  const PORTAL = /\.game\.bigbools\.fi$/.test(location.hostname);
  const BASE = PORTAL ? 'https://jatsi.bigbools.fi' : '';
  const TOKEN_KEY = 'jatsi.token';

  function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) {
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  async function call(path, method, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    const token = PORTAL && getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(BASE + '/api' + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: PORTAL ? 'omit' : 'same-origin',
      });
    } catch (e) {
      throw new Error('Palvelimeen ei saada yhteyttä.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* tyhjä vastaus */ }
    if (res.status === 401 && token) setToken(null);
    if (!res.ok) throw new Error(data.error || ('Virhe (' + res.status + ')'));
    return data;
  }

  async function signIn(path, username, password) {
    const data = await call(path, 'POST', PORTAL ? { username, password, token: true } : { username, password });
    if (data.token) setToken(data.token);
    return data;
  }

  return {
    base: BASE,
    token: () => (PORTAL ? getToken() : null),
    clearToken: () => setToken(null),
    register: (username, password) => signIn('/register', username, password),
    login: (username, password) => signIn('/login', username, password),
    logout: async () => { try { return await call('/logout', 'POST'); } finally { setToken(null); } },
    me: () => call('/me', 'GET'),
    history: () => call('/history', 'GET'),
    setColor: (color) => call('/color', 'POST', { color }),
  };
})();
