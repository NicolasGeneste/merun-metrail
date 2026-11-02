/* MeRun-MeTrail : intermediaire Intervals.icu (Netlify Function v2).
   La cle API ne quitte jamais le serveur Netlify. Variables d'environnement (Netlify > Site configuration > Environment variables) :
     INTERVALS_API_KEY     cle API Intervals.icu (Settings > Developer Settings)
     INTERVALS_ATHLETE_ID  identifiant athlete, ex. i123456
     MERUN_CODE            code d'acces choisi par toi, saisi une fois dans l'appli (protege la fonction : le site est public)
   API : https://intervals.icu/api/v1/docs (OpenAPI). Auth HTTP Basic, utilisateur "API_KEY", mot de passe = la cle.
   Actions (POST JSON, en-tete X-MeRun-Code) :
     ping                              -> verifie la cle et renvoie le nom de l'athlete
     push   {workouts:[{external_id,name,date,description}]}   -> cree ou met a jour les seances (correspondance par external_id)
     delete {ids:[...]}                -> supprime des seances du calendrier
     activities {oldest,newest}        -> sorties course a pied + temps par zone FC (bornes MeRun) */
const BASE = 'https://intervals.icu/api/v1';
const env = k => (globalThis.Netlify && Netlify.env.get(k)) || process.env[k] || '';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const ZB = [135, 150, 163, 172];   /* bornes FC MeRun (test CHU) : identiques a l'import .fit de l'appli */

function same(a, b){ if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function iv(path, init = {}){
  const auth = 'Basic ' + Buffer.from('API_KEY:' + env('INTERVALS_API_KEY')).toString('base64');
  const res = await fetch(BASE + path, { ...init, headers: { authorization: auth, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) } });
  const txt = await res.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!res.ok){ const e = new Error(`Intervals.icu ${res.status}${res.status === 403 || res.status === 401 ? ' (clé API ou athlete ID refusés)' : ''}`); e.status = res.status; e.detail = typeof data === 'string' ? data.slice(0, 300) : data; throw e; }
  return data;
}
const ath = () => '/athlete/' + encodeURIComponent(env('INTERVALS_ATHLETE_ID'));
const ev = (w) => ({ category: 'WORKOUT', type: 'Run', name: String(w.name).slice(0, 80), start_date_local: w.date + 'T00:00:00', description: w.description, external_id: w.external_id });
const slim = (e) => e && ({ id: e.id, external_id: e.external_id, date: (e.start_date_local || '').slice(0, 10), push_errors: e.push_errors || [] });

function zonesOf(t, hr){
  const z = [0, 0, 0, 0, 0];
  for (let i = 1; i < t.length; i++){ const dt = t[i] - t[i - 1], h = hr[i]; if (!(dt > 0 && dt <= 10) || !h) continue;
    z[h < ZB[0] ? 0 : h <= ZB[1] ? 1 : h <= ZB[2] ? 2 : h <= ZB[3] ? 3 : 4] += dt; }
  return z.some(Boolean) ? z : null;
}

/* Meilleur temps sur une distance D (m) a partir des flux distance cumulee et temps (s), deux pointeurs.
   Les pauses comptent (temps ecoule) : estimation prudente. Vitesse > 7 m/s (2:23/km) rejetee (saut GPS). */
function bestOver(t, d, D){
  let best = null, i = 0;
  for (let j = 1; j < d.length; j++){
    while (i + 1 < j && d[j] - d[i + 1] >= D) i++;
    if (d[j] - d[i] >= D){ const dt = t[j] - t[i]; if (dt > 0 && D / dt <= 7 && (best === null || dt < best)) best = dt; }
  }
  return best;
}
async function pool(items, n, fn){ const out = new Array(items.length); let k = 0;
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => { while (k < items.length){ const i = k++; out[i] = await fn(items[i]); } }));
  return out; }

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST uniquement' });
  if (!env('INTERVALS_API_KEY') || !env('INTERVALS_ATHLETE_ID') || !env('MERUN_CODE')) return json(500, { error: 'Variables INTERVALS_API_KEY, INTERVALS_ATHLETE_ID ou MERUN_CODE absentes sur Netlify' });
  if (!same(req.headers.get('x-merun-code') || '', env('MERUN_CODE'))) return json(401, { error: "Code d'accès MeRun incorrect" });
  let body; try { body = await req.json(); } catch { return json(400, { error: 'JSON invalide' }); }

  try {
    switch (body.action){
      case 'ping': {
        const a = await iv(ath());
        /* Reglages course : sans allure seuil, Intervals.icu retire les cibles d'allure a l'envoi vers Garmin
           (forum Intervals.icu, 17/07/2026, "Pace targets lost in Garmin export...") */
        const rs = ((a && a.sportSettings) || []).find(s => (s.types || []).includes('Run')) || {};
        return json(200, { ok: true, athlete: a && (a.name || a.firstname || a.id), run: { thresholdPace: rs.threshold_pace || null, maxHr: rs.max_hr || null, lthr: rs.lthr || null } });
      }
      case 'push': {
        const ws = (body.workouts || []).filter(w => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && w.external_id && w.description);
        if (!ws.length) return json(400, { error: 'Aucune séance valide' });
        if (ws.length > 60) return json(400, { error: '60 séances maximum par envoi' });
        const dates = ws.map(w => w.date).sort();
        /* Les seances deja envoyees sont retrouvees par external_id dans le calendrier, supprimees puis recreees :
           une mise a jour sur place ne relance pas l'export vers Garmin (forum Intervals.icu, 17/07/2026),
           et on ne depend pas de upsert=true, documente pour les applications OAuth. */
        const existing = await iv(`${ath()}/events?oldest=${dates[0]}&newest=${dates[dates.length - 1]}&category=WORKOUT`);
        const ext = new Set(ws.map(w => w.external_id));
        const old = (existing || []).filter(e => e.external_id && ext.has(e.external_id)).map(e => ({ id: e.id }));
        if (old.length) await iv(`${ath()}/events/bulk-delete`, { method: 'PUT', body: JSON.stringify(old) });
        const created = await iv(`${ath()}/events/bulk`, { method: 'POST', body: JSON.stringify(ws.map(ev)) });
        return json(200, { ok: true, events: (created || []).map(slim), replaced: old.length });
      }
      case 'delete': {
        const ids = (body.ids || []).map(Number).filter(Number.isFinite);
        if (!ids.length) return json(400, { error: 'Aucun id' });
        await iv(`${ath()}/events/bulk-delete`, { method: 'PUT', body: JSON.stringify(ids.map(id => ({ id }))) });
        return json(200, { ok: true, deleted: ids.length });
      }
      case 'activities': {
        const re = /^\d{4}-\d{2}-\d{2}$/; if (!re.test(body.oldest || '') || (body.newest && !re.test(body.newest))) return json(400, { error: 'Dates invalides' });
        const q = new URLSearchParams({ oldest: body.oldest, limit: '40', fields: 'id,name,type,start_date_local,distance,moving_time,elapsed_time,average_heartrate,max_heartrate,has_heartrate,device_name' });
        if (body.newest) q.set('newest', body.newest + 'T23:59:59');
        const list = (await iv(`${ath()}/activities?${q}`)) || [];
        /* L'API renvoie un objet vide pour les activites venues de Strava : on ne garde que les sorties lisibles */
        const runs = list.filter(a => a && a.id && /run/i.test(a.type || '') && a.distance > 0).slice(0, 20);
        const acts = await Promise.all(runs.map(async a => {
          let zones = null;
          if (a.has_heartrate !== false){ try {
            const st = await iv(`/activity/${encodeURIComponent(a.id)}/streams.json?types=time,heartrate`);
            const g = k => ((st || []).find(s => s.type === k) || {}).data || [];
            const t = g('time'), hr = g('heartrate'); if (t.length && t.length === hr.length) zones = zonesOf(t, hr);
          } catch { zones = null; } }
          return { id: a.id, name: a.name, date: (a.start_date_local || '').slice(0, 10), km: Math.round(a.distance / 10) / 100, dur: a.moving_time || a.elapsed_time || null,
                   hr: a.average_heartrate ? Math.round(a.average_heartrate) : null, zones, device: a.device_name || null };
        }));
        return json(200, { ok: true, acts, skipped: list.length - runs.length });
      }
      case 'history': {
        /* Historique par tranche (l'appli decoupe en periodes de 2 mois : limite Netlify de 60 s par appel) */
        const re = /^\d{4}-\d{2}-\d{2}$/; if (!re.test(body.oldest || '') || !re.test(body.newest || '')) return json(400, { error: 'Dates invalides' });
        const q = new URLSearchParams({ oldest: body.oldest, newest: body.newest + 'T23:59:59', limit: '300', fields: 'id,name,type,start_date_local,distance,moving_time,elapsed_time,average_heartrate,has_heartrate,device_name,total_elevation_gain' });
        const list = (await iv(`${ath()}/activities?${q}`)) || [];
        const stubs = list.filter(a => a && !a.type).length;                       // activites Strava : objet vide via l'API
        const runs = list.filter(a => a && a.id && /run/i.test(a.type || '') && a.distance > 0);
        const others = list.length - stubs - runs.length;
        const acts = await pool(runs, 6, async a => {
          let zones = null, best = null;
          try {
            const st = await iv(`/activity/${encodeURIComponent(a.id)}/streams.json?types=time,heartrate,distance`);
            const g = k => ((st || []).find(s => s.type === k) || {}).data || [];
            const t = g('time'), hr = g('heartrate'), d = g('distance');
            if (t.length && t.length === hr.length) zones = zonesOf(t, hr);
            if (t.length && t.length === d.length){ best = {}; for (const [k, D] of [['5', 5000], ['10', 10000], ['21', 21097.5], ['42', 42195]]) { if (a.distance >= D){ const b = bestOver(t, d, D); if (b) best[k] = b; } } }
          } catch { /* sortie sans flux lisible : resume seul */ }
          return { id: a.id, name: a.name, date: (a.start_date_local || '').slice(0, 10), km: Math.round(a.distance / 10) / 100, dur: a.moving_time || a.elapsed_time || null,
                   hr: a.average_heartrate ? Math.round(a.average_heartrate) : null, dplus: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : null, zones, best, device: a.device_name || null };
        });
        return json(200, { ok: true, acts, stubs, others });
      }
      default: return json(400, { error: 'Action inconnue' });
    }
  } catch (e){
    return json(502, { error: e.message, detail: e.detail || null });
  }
};
export const config = { path: '/api/intervals' };
