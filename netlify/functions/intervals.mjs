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

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST uniquement' });
  if (!env('INTERVALS_API_KEY') || !env('INTERVALS_ATHLETE_ID') || !env('MERUN_CODE')) return json(500, { error: 'Variables INTERVALS_API_KEY, INTERVALS_ATHLETE_ID ou MERUN_CODE absentes sur Netlify' });
  if (!same(req.headers.get('x-merun-code') || '', env('MERUN_CODE'))) return json(401, { error: "Code d'accès MeRun incorrect" });
  let body; try { body = await req.json(); } catch { return json(400, { error: 'JSON invalide' }); }

  try {
    switch (body.action){
      case 'ping': {
        const a = await iv(ath());
        return json(200, { ok: true, athlete: a && (a.name || a.firstname || a.id) });
      }
      case 'push': {
        const ws = (body.workouts || []).filter(w => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && w.external_id && w.description);
        if (!ws.length) return json(400, { error: 'Aucune séance valide' });
        if (ws.length > 60) return json(400, { error: '60 séances maximum par envoi' });
        const dates = ws.map(w => w.date).sort();
        /* Les seances deja envoyees sont retrouvees par external_id dans le calendrier, puis mises a jour par id :
           on ne depend pas de upsert=true, documente pour les applications OAuth. */
        const existing = await iv(`${ath()}/events?oldest=${dates[0]}&newest=${dates[dates.length - 1]}&category=WORKOUT`);
        const byExt = new Map((existing || []).filter(e => e.external_id).map(e => [e.external_id, e]));
        const out = [], fresh = [];
        for (const w of ws){
          const cur = byExt.get(w.external_id);
          if (cur) out.push(slim(await iv(`${ath()}/events/${cur.id}`, { method: 'PUT', body: JSON.stringify(ev(w)) })) || { id: cur.id, external_id: w.external_id, date: w.date, push_errors: [] });
          else fresh.push(ev(w));
        }
        if (fresh.length){ const created = await iv(`${ath()}/events/bulk`, { method: 'POST', body: JSON.stringify(fresh) }); for (const e of created || []) out.push(slim(e)); }
        return json(200, { ok: true, events: out });
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
      default: return json(400, { error: 'Action inconnue' });
    }
  } catch (e){
    return json(502, { error: e.message, detail: e.detail || null });
  }
};
export const config = { path: '/api/intervals' };
