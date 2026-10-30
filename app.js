/* MeRun-MeTrail v4.6.0 - genere : core.js + fitparser.js + ui.js */
/* ================================================================
   MeRun-MeTrail v3 - noyau : allures, structure des seances, encodeur FIT
   ================================================================ */
/* Allures de reference par bloc (sec/km, [rapide, lent]) : onglet "Allures & FC" du classeur v4,
   calees pour VC = 12,5 km/h (SV2 du test CHU). Valeur unique du classeur => fenetre de +/- 5 s. */
const REF_VC = 12.5;
const REF = {
  EF:     {A:[370,405],B:[365,400],C:[360,395],D:[355,390]},
  AM:     {A:[325,335],B:[315,325],C:[307,317],D:[303,310]},
  SEMI:   {A:[295,305],B:[295,305],C:[295,305],D:[292,302]},
  '10K':  {A:[290,295],B:[290,295],C:[280,290],D:[280,290]},
  SEUIL:  {A:[310,315],B:[300,305],C:[290,300],D:[285,295]},
  VMA:    {A:[263,273],B:[263,273],C:[257,267],D:[253,263]},
  VMA400: {A:[258,268],B:[258,268],C:[253,263],D:[248,258]},
  LIGNES: {A:[240,250],B:[235,245],C:[230,240],D:[230,240]},
};
/* Objectifs de course (classeur, onglet Objectifs) : non recalcules par la VC */
const RACE = { R10:[279,285], RSEMI:[293,301], RMARA:[299,306] };
const ZLABEL = {EF:'Endurance fond.',EFD:'Endurance avec dénivelé',RECUP:'Recup',AM:'Allure marathon',SEMI:'Allure semi','10K':'Allure 10 km',SEUIL:'Seuil',
  VMA:'VMA',VMA400:'VMA courte',LIGNES:'Lignes droites',OPEN:'Libre',R10:'Objectif 10 km',RSEMI:'Objectif semi',RMARA:'Objectif marathon'};
const ZCOLOR = {RECUP:'#4dabf7',EF:'#2f9e44',EFD:'#2f9e44',AM:'#94d82d',SEMI:'#f0a020','10K':'#f0a020',SEUIL:'#f0a020',VMA:'#ff6b35',VMA400:'#ff3d8a',
  LIGNES:'#ff3d8a',OPEN:'#9aa3b2',R10:'#f0a020',RSEMI:'#f0a020',RMARA:'#94d82d'};

function paceRange(z, bloc, vc){
  if (RACE[z]) return RACE[z];
  const sc = REF_VC / vc;
  if (z === 'RECUP'){ const ef = REF.EF[bloc]; return [Math.round(ef[1]*sc), Math.round((ef[1]+40)*sc)]; }
  if (!REF[z]) return null;
  return REF[z][bloc].map(s => Math.round(s*sc));
}
const fmtPace = s => Math.floor(s/60)+':'+String(Math.round(s%60)).padStart(2,'0');
function paceLabel(z, bloc, vc){
  const r = paceRange(z, bloc, vc); if (!r) return '';
  return r[0]===r[1] ? fmtPace(r[0]) : fmtPace(r[0])+'-'+fmtPace(r[1]);
}
/* Aplatit la structure en segments [{n,z,k,sec}] pour l'affichage et la duree estimee */
function flatSteps(steps, bloc, vc){
  const out = [];
  const secOf = st => {
    if (st.t) return st.t;
    const r = paceRange(st.z, bloc, vc);
    if (st.d && r) return st.d/1000 * (r[0]+r[1])/2;
    if (st.d) return st.d/1000 * 300;
    return st.z==='OPEN' ? (st.k==='rest' ? 75 : 780) : 0;   // estimation des etapes libres
  };
  for (const st of steps){
    if (st.rep){ for (let i=0;i<st.rep;i++) for (const x of st.steps) out.push({...x, sec:secOf(x)}); }
    else out.push({...st, sec:secOf(st)});
  }
  return out;
}
const fmtDur = s => { s=Math.round(s/60); const h=Math.floor(s/60), m=s%60; return h ? h+' h '+String(m).padStart(2,'0') : m+' min'; };

/* ---------------- Encodeur FIT (fichier workout) ----------------
   Spec : Garmin FIT SDK, Protocol & Profile (https://developer.garmin.com/fit/protocol/).
   Messages : file_id (0), workout (26), workout_step (27). */
const FIT_EPOCH_S = 631065600;
const CRC_T = [0x0000,0xCC01,0xD801,0x1400,0xF001,0x3C00,0x2800,0xE401,0xA001,0x6C00,0x7800,0xB401,0x5000,0x9C01,0x8801,0x4400];
function fitCrc(bytes, crc=0){
  for (const b of bytes){
    let t = CRC_T[crc & 0xF]; crc = (crc>>4)&0x0FFF; crc = crc ^ t ^ CRC_T[b & 0xF];
    t = CRC_T[crc & 0xF]; crc = (crc>>4)&0x0FFF; crc = crc ^ t ^ CRC_T[(b>>4) & 0xF];
  }
  return crc;
}
function encodeWorkoutFit(name, steps, bloc, vc){
  const out = [];
  const u8=v=>out.push(v&0xFF), u16=v=>{u8(v);u8(v>>8);}, u32=v=>{u16(v&0xFFFF);u16((v>>>16)&0xFFFF);};
  const str=(s,n)=>{ const b=new TextEncoder().encode(s).slice(0,n-1); for(let i=0;i<n;i++) u8(i<b.length?b[i]:0); };
  const def=(local,global,fields)=>{ u8(0x40|local); u8(0); u8(0); u16(global); u8(fields.length); for(const f of fields){u8(f[0]);u8(f[1]);u8(f[2]);} };
  const NAMELEN=24;
  // file_id
  def(0,0,[[3,4,0x8C],[4,4,0x86],[1,2,0x84],[2,2,0x84],[0,1,0x00]]);
  u8(0); u32(0x10000002); u32(Math.floor(Date.now()/1000)-FIT_EPOCH_S); u16(255); u16(0); u8(5);
  // steps a plat avec repetitions
  const flat=[];
  for (const st of steps){
    if (st.rep){ const first=flat.length; for(const x of st.steps) flat.push(x); flat.push({repeat:true, back:first, count:st.rep}); }
    else flat.push(st);
  }
  // workout
  def(1,26,[[8,NAMELEN,0x07],[4,1,0x00],[6,2,0x84]]);
  u8(1); str(name,NAMELEN); u8(1); u16(flat.length);
  // workout_step
  def(2,27,[[254,2,0x84],[0,NAMELEN,0x07],[1,1,0x00],[2,4,0x86],[3,1,0x00],[4,4,0x86],[5,4,0x86],[6,4,0x86],[7,1,0x00]]);
  const INT={active:0,rest:1,warmup:2,cooldown:3};
  flat.forEach((st,i)=>{
    u8(2); u16(i);
    if (st.repeat){ str('Repeter x'+st.count,NAMELEN); u8(6); u32(st.back); u8(2); u32(st.count); u32(0); u32(0); u8(0); return; }
    str(st.n,NAMELEN);
    if (st.t){ u8(0); u32(st.t*1000); } else if (st.d){ u8(1); u32(Math.round(st.d*100)); } else { u8(5); u32(0); }
    const r = st.z==='OPEN' ? null : paceRange(st.z,bloc,vc);
    if (r){ u8(0); u32(0); u32(Math.round(1000/r[1]*1000)); u32(Math.round(1000/r[0]*1000)); }   // m/s * 1000, bas = allure lente
    else { u8(2); u32(0); u32(0); u32(0); }
    u8(INT[st.k] ?? 0);
  });
  const data = Uint8Array.from(out);
  const hdr = new Uint8Array(14); const dv = new DataView(hdr.buffer);
  hdr[0]=14; hdr[1]=0x10; dv.setUint16(2,2132,true); dv.setUint32(4,data.length,true); hdr.set([46,70,73,84],8);
  dv.setUint16(12, fitCrc(hdr.subarray(0,12)), true);
  const crc = fitCrc(data, fitCrc(hdr));
  const file = new Uint8Array(14+data.length+2); file.set(hdr,0); file.set(data,14);
  file[file.length-2]=crc&0xFF; file[file.length-1]=crc>>8;
  return file;
}
function parseFitFile(buffer) {
  const view = new DataView(buffer);
  let pos = 0;

  // Header
  const headerSize = view.getUint8(0);
  const protocolVersion = view.getUint8(1);
  const dataSize = view.getUint32(4, true);
  const dataType = String.fromCharCode(
    view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)
  );
  if (dataType !== '.FIT') throw new Error('Pas un fichier .FIT valide');

  pos = headerSize;
  const dataEnd = headerSize + dataSize;

  // Définitions de messages indexées par local_message_type
  const defs = {};
  const result = { session: null, activity: null, records: [], file_id: null };

  // FIT epoch = 1989-12-31T00:00:00Z (unix 631065600)
  const FIT_EPOCH = 631065600;

  // Globals message numbers d'intérêt
  const MSG_FILE_ID = 0;
  const MSG_SESSION = 18;
  const MSG_ACTIVITY = 34;
  const MSG_RECORD = 20;

  while (pos < dataEnd) {
    const recordHeader = view.getUint8(pos++);
    const isDefinition = (recordHeader & 0x40) !== 0;
    const isCompressedTimestamp = (recordHeader & 0x80) !== 0;

    if (isCompressedTimestamp) {
      // Compressed timestamp header - on saute, on n'a pas besoin de ces records
      const localMsgType = (recordHeader >> 5) & 0x03;
      const def = defs[localMsgType];
      if (def) pos += def.totalSize;
      continue;
    }

    const localMsgType = recordHeader & 0x0F;

    if (isDefinition) {
      // Lecture d'une définition de message
      pos++; // reserved
      const arch = view.getUint8(pos++); // 0 = little endian
      const globalMsgNum = arch === 0 ? view.getUint16(pos, true) : view.getUint16(pos, false);
      pos += 2;
      const numFields = view.getUint8(pos++);

      const fields = [];
      let totalSize = 0;
      for (let i = 0; i < numFields; i++) {
        const fieldNum = view.getUint8(pos++);
        const size = view.getUint8(pos++);
        const baseType = view.getUint8(pos++);
        fields.push({ fieldNum, size, baseType });
        totalSize += size;
      }

      // Developer fields (si header bit 5 = 1)
      let devFieldsSize = 0;
      if ((recordHeader & 0x20) !== 0) {
        const numDevFields = view.getUint8(pos++);
        for (let i = 0; i < numDevFields; i++) {
          const size = view.getUint8(pos + 1);
          pos += 3;
          devFieldsSize += size;
        }
      }

      defs[localMsgType] = { globalMsgNum, fields, totalSize: totalSize + devFieldsSize, arch };
    } else {
      // Lecture d'un data message
      const def = defs[localMsgType];
      if (!def) {
        // Définition manquante - on essaie de continuer en sautant 1 byte
        continue;
      }

      const data = {};
      const littleEndian = def.arch === 0;

      for (const field of def.fields) {
        let value = null;
        try {
          value = readFitField(view, pos, field.baseType, field.size, littleEndian);
        } catch (e) {}
        data[field.fieldNum] = value;
        pos += field.size;
      }

      // Traiter les messages qui nous intéressent
      if (def.globalMsgNum === MSG_SESSION) {
        result.session = {
          start_time: data[2] != null ? new Date((data[2] + FIT_EPOCH) * 1000) : null,
          total_elapsed_time: data[7] != null ? data[7] / 1000 : null, // secondes (était en ms)
          total_timer_time: data[8] != null ? data[8] / 1000 : null,
          total_distance: data[9] != null ? data[9] / 100 : null, // mètres (était en cm)
          avg_heart_rate: data[16] || null,
          max_heart_rate: data[17] || null,
          avg_cadence: data[18] != null ? data[18] * 2 : null, // ppm (FIT stocke en rpm pour 1 pied; * 2 pour les 2 pieds)
          total_ascent: data[22] || null,
          sport: data[5] || null,
        };
      } else if (def.globalMsgNum === MSG_RECORD) {
        // v4 : timestamp (253) + frequence cardiaque (3) pour le temps passe par zone
        const ts = data[253], hr = data[3];
        if (ts != null && hr != null && hr !== 255) result.records.push([ts, hr]);
      } else if (def.globalMsgNum === MSG_ACTIVITY) {
        result.activity = {
          timestamp: data[253] != null ? new Date((data[253] + FIT_EPOCH) * 1000) : null,
          total_timer_time: data[0] != null ? data[0] / 1000 : null,
          num_sessions: data[1] || null,
        };
      } else if (def.globalMsgNum === MSG_FILE_ID) {
        result.file_id = {
          type: data[0] || null,
          manufacturer: data[1] || null,
          time_created: data[4] != null ? new Date((data[4] + FIT_EPOCH) * 1000) : null,
        };
      }
    }
  }

  return result;
}

function readFitField(view, pos, baseType, size, littleEndian) {
  // Types de base FIT - on supporte les principaux
  const baseTypeNum = baseType & 0x1F;
  try {
    switch (baseTypeNum) {
      case 0x00: // enum
      case 0x02: // uint8
        return view.getUint8(pos);
      case 0x01: // sint8
        return view.getInt8(pos);
      case 0x83: // sint16
      case 0x03: // sint16
        return view.getInt16(pos, littleEndian);
      case 0x84: // uint16
      case 0x04: // uint16
        return view.getUint16(pos, littleEndian);
      case 0x85: // sint32
      case 0x05:
        return view.getInt32(pos, littleEndian);
      case 0x86: // uint32
      case 0x06:
        return view.getUint32(pos, littleEndian);
      case 0x07: // string
        const bytes = new Uint8Array(view.buffer, view.byteOffset + pos, size);
        let str = '';
        for (let i = 0; i < size; i++) {
          if (bytes[i] === 0) break;
          str += String.fromCharCode(bytes[i]);
        }
        return str;
      case 0x88: // float32
      case 0x08:
        return view.getFloat32(pos, littleEndian);
      case 0x89: // float64
      case 0x09:
        return view.getFloat64(pos, littleEndian);
      case 0x0A: // uint8z
      case 0x8B: // uint16z
      case 0x0B:
        return baseTypeNum === 0x0A ? view.getUint8(pos) : view.getUint16(pos, littleEndian);
      case 0x8C: // uint32z
      case 0x0C:
        return view.getUint32(pos, littleEndian);
      default:
        return null;
    }
  } catch (e) {
    return null;
  }
}
/* ================================================================
   MeRun-MeTrail v4 - interface "L'ascension"
   v4.0.0 : semaine type Campus (apercu hebdo, seance cle, difficulte), validation en 3 temps
   (donnees, ressenti + mood, pourquoi), plan adaptatif, onglet Objectif (temps, regularite,
   volume, cycles), onglet Profil (radar 6 axes, confiance), visuel "Ma semaine" partageable.
   ================================================================ */
const APP_VERSION = 'v4.6.0';
const STORE = 'merun_v3';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const C = {bg:'#0a0e14',orange:'#ff6b35',teal:'#00d4b8',pink:'#ff4d94',amber:'#f0a020',surface:'#151b26',surface2:'#1f2733',text:'#f5f1ea',muted:'#9aa3b2',body:'#d6d2cb'};
const KIND = {foot:{l:'Footing',c:C.teal},q:{l:'Qualité',c:C.orange},sl:{l:'Sortie longue',c:C.pink},race:{l:'Course',c:C.amber},test:{l:'Test',c:C.amber}};
const BLOC = {
  A:{n:'Reprise',c:C.orange,d:"Deux semaines de footings, de lignes droites et de sorties longues courtes pour relancer la machine après la pré-saison (VAMEVAL et 5 km en octobre)."},
  B:{n:'Base + vitesse',c:C.teal,d:"Réactivation de la VMA, spécifique 10 km et course du 29 novembre, puis une semaine de récupération active."},
  C:{n:'Seuil & spécifique',c:C.pink,d:"Bascule vers le seuil : fractions longues, allure semi dans les sorties longues, volume maximal du bloc à 55 km."},
  D:{n:'Spécifique marathon',c:C.amber,d:"Entrée en allure marathon, pic à 29 km en sortie longue, Semi de Paris le 7 mars, puis affûtage jusqu'au 4 avril."},
};
const ALL = PLAN.flatMap(w => w.sessions);
/* v4.2 : semaines marquees "pre" = pre-saison (5/10-1/11), gardees en historique mais hors stats ; debut officiel = premiere semaine non "pre" */
const PRE = PLAN.filter(w => w.pre).length, OFF = PLAN.filter(w => !w.pre), NW = OFF.length, OFF_START = OFF[0].start;
const wNo = w => w.pre ? 'P' + w.num : String(w.num - PRE);
const wLab = w => w.pre ? 'Pré-saison · ' + w.num : 'Semaine ' + (w.num - PRE);
const MONTHS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const DOW = {Lun:'Lun',Mar:'Mar',Mer:'Mer',Jeu:'Jeu',Ven:'Ven',Sam:'Sam',Dim:'Dim'};
const d8 = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const addDays = (s,n) => iso(new Date(d8(s).getTime()+n*864e5+36e5));
const todayIso = () => iso(new Date());
const shortDate = s => { const d=d8(s); return d.getDate()+' '+MONTHS[d.getMonth()]; };
const daysTo = s => Math.round((d8(s) - d8(todayIso()))/864e5);
const weekEnd = w => addDays(w.start, 6);
const fmtN = v => (Math.round(v*10)/10).toString().replace('.',',');
const fmtHMS = s => { s=Math.round(s); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return h ? h+':'+String(m).padStart(2,'0')+':'+String(x).padStart(2,'0') : m+':'+String(x).padStart(2,'0'); };
const fmtHM = s => { s=Math.floor(s/60); return Math.floor(s/60)+'h'+String(s%60).padStart(2,'0'); };
const riegel = (sec, km, to=42.195) => sec * Math.pow(to/km, 1.06);   /* Riegel, American Scientist 1981 */

/* ---------------- etat ---------------- */
const BASE = {src:"export Strava du 08/10/2026, 12 mois", kmWeek:18, wAct:37, wTot:53, z12:44};
let S = { name:'Nicolas', vc:12.5, fcmax:196, beeps:true, schema:400, done:{}, ppgDone:[], acts:[], vcHist:[{date:'2025-03-13',vc:12.5,src:'SV2 test CHU'}],
  races:[], joined:{}, fb:{}, adj:[], mobDone:[],
  goal:{name:'Marathon de Paris', target:3*3600+35*60, startSec:3*3600+59*60+33},
  perfs:[
    {id:'p1',date:'2025-09-19',km:5,sec:24*60+7,l:'5 km',src:"segment d'entraînement (Strava)"},
    {id:'p2',date:'2025-10-06',km:10,sec:50*60+54,l:'10 km',src:"segment d'entraînement (Strava)"},
    {id:'p3',date:'2025-03-22',km:21.0975,sec:3600+55*60+4,l:'Semi',src:'course'},
    {id:'p4',date:'2026-04-26',km:42.195,sec:3*3600+59*60+33,l:'Marathon',src:'course, temps déclaré'},
  ] };
function load(){
  try{
    const raw = localStorage.getItem(STORE);
    if (raw) { const o = JSON.parse(raw); S = {...S, ...o};
      if (!(o.schema >= 310)) { if (S.fcmax === 186) S.fcmax = 196;
        for (const k of Object.keys(S.done)) if (/^S0[1-4]_/.test(k)) delete S.done[k]; }
      if (!(o.schema >= 400)) { S.fb = S.fb || {}; S.adj = S.adj || []; S.schema = 400; save(); }
      return; }
    const old = JSON.parse(localStorage.getItem('merunmetrail_v2') || 'null');
    if (old){ if (old.races) S.races = old.races; if (old.cv && old.cv.vc) S.vc = old.cv.vc; if (old.soundEnabled === false) S.beeps = false; }
    else S.races = [{date:'2026-07-18',name:"TVO, Trail de la Vallée d'Ossau",dist:24.9,dplus:1469,time:'4:41:54',hr:159}];
    save();
  }catch(e){ console.warn(e); }
}
const save = () => { try{ localStorage.setItem(STORE, JSON.stringify(S)); }catch(e){} };

/* ---------------- vue ---------------- */
const V = { tab:'home', layers:[], week:null, zmode:'pace', nut:null, routine:'P1', flow:null, ax:null, cyc:null, openW:null, verdict:null };
const ICON = {
  home:'<path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-6h6v6"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  zap:'<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  back:'<path d="m15 18-6-6 6-6"/>', next:'<path d="m9 18 6-6-6-6"/>', arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>', close:'<path d="M6 6l12 12M18 6 6 18"/>',
  play:'<path d="M7 4v16l13-8z" fill="currentColor"/>', pause:'<path d="M7 4h4v16H7zM14 4h4v16h-4z" fill="currentColor"/>',
  reset:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', skip:'<path d="M5 4l10 8-10 8zM19 5v14"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5 15.4 17.5M15.4 6.5 8.6 10.5"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>', edit:'<path d="M4 20h4L20 8l-4-4L4 16z"/>', check:'<path d="M5 12l5 5L20 7"/>',
};
const ico = (k, sz=21) => `<svg class="ico" viewBox="0 0 24 24" style="width:${sz}px;height:${sz}px" aria-hidden="true">${ICON[k]}</svg>`;
const TABS = [['home','Accueil','home'],['plan','Séances','list'],['goal','Objectif','target'],['profil','Profil','user'],['ppg','Corps','zap'],['plus','Plus','grid']];

function render(){
  $('#nav').innerHTML = TABS.map(([k,l,i]) => `<button class="${V.tab===k?'on':''}" data-tab="${k}" aria-label="${l}">${ico(i)}<span>${l}</span></button>`).join('');
  $('#screen').innerHTML = ({home:Home,plan:Plan,goal:Goal,profil:Profil,ppg:PPG,plus:Plus})[V.tab]();
  $('#layer').innerHTML = V.layers.map((l,i) => `<div class="overlay" style="z-index:${30+i}"><div class="scroll">${LAYER[l.k](l)}</div></div>`).join('');
  if (V.tab==='ppg' && !V.layers.length) ppgPaint();
}
function go(tab){ if (V.layers.length){ V.layers=[]; history.replaceState({l:0},''); } V.tab = tab; render(); $('#screen').scrollTop = 0; }
function openLayer(k, extra={}){ V.layers.push({k, ...extra}); history.pushState({l:V.layers.length}, ''); render(); }
function closeLayer(){ if (V.layers.length) history.back(); }
function closeAll(){ const n=V.layers.length; if (n) history.go(-n); }
window.addEventListener('popstate', e => { const l = (e.state && e.state.l) || 0;
  if (l < V.layers.length){ V.layers = V.layers.slice(0, l); render(); } else if (!V.layers.length && V.tab!=='home'){ go('home'); } });
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.style.display='block'; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display='none',2600); }

/* ---------------- plan adaptatif ----------------
   Regles MeRun (choix de conception, pas une norme) :
   - seance "difficile" pour maladie ou douleur      -> 7 jours a 70 % du volume
   - seance "difficile" pour fatigue ou sommeil      -> 7 jours a 85 %
   - 2 seances "difficiles" sur les 3 dernieres       -> 7 jours a 85 %
   - mood <= 2/5 sur 2 des 3 dernieres seances        -> 5 jours a 85 %
   - allure trop rapide, motivation, conditions       -> plan inchange, conseil
   - "trop facile" 2 fois de suite sur seances cles   -> conseil : refaire un test (pas de hausse automatique)
   Les tests et les courses ne sont jamais modifies. */
function adjFactor(s){ let f=1, a=null; for (const x of S.adj) if (!x.off && s.date>=x.from && s.date<=x.to && x.f<f){ f=x.f; a=x; } return {f,a}; }
function scaleSteps(steps, f){
  return steps.map(st => {
    if (st.rep) return {...st, rep:Math.max(1, Math.round(st.rep*f))};
    if (st.k==='warmup' || st.k==='cooldown') return st;
    const o = {...st};
    if (st.t) o.t = Math.max(60, Math.round(st.t*f/60)*60);
    if (st.d) o.d = Math.max(500, Math.round(st.d*f/500)*500);
    return o;
  });
}
const frozen = s => s.kind==='race' || s.kind==='test';
function stepsOf(s){ const {f}=adjFactor(s); return (f===1 || frozen(s)) ? s.steps : scaleSteps(s.steps, f); }
function kmOf(s){ const {f}=adjFactor(s); return (f===1 || frozen(s)) ? s.km : Math.round(s.km*f*10)/10; }
function addAdj(from, days, f, why){ S.adj.push({id:'a'+Date.now(), from, to:addDays(from, days-1), f, why}); }
const activeAdj = () => S.adj.filter(a => !a.off && a.to >= todayIso());

/* ---------------- calculs communs ---------------- */
const isDone = s => S.done[s.code] != null;
const isKey = s => ['q','sl','test','race'].includes(s.kind);
function sessDur(s){ return flatSteps(stepsOf(s), s.bloc, S.vc).reduce((a,x)=>a+x.sec,0); }
function mainZone(s){ const f=flatSteps(stepsOf(s),s.bloc,S.vc).filter(x=>x.k==='active'); const hard=f.find(x=>!['EF','EFD','RECUP','OPEN'].includes(x.z)); return (hard||f[0]||{z:'EF'}).z; }
/* Difficulte estimee 1-5 a partir de la zone la plus intense et de la duree (regle MeRun) */
const ZLV = {EF:1,EFD:1,RECUP:1,LIGNES:2,OPEN:3,AM:3,RMARA:3,SEMI:4,RSEMI:4,'10K':4,R10:4,SEUIL:4,VMA:5,VMA400:5};
function diffOf(s){
  if (frozen(s)) return 5;
  const act = flatSteps(stepsOf(s), s.bloc, S.vc).filter(x=>x.k==='active');
  let lv = Math.max(1, ...act.map(x=>ZLV[x.z]||1));
  if (s.kind==='sl'){ const h = sessDur(s)/3600; if (h >= 1.75) lv = Math.min(5, Math.max(lv+1, 3)); else lv = Math.max(lv, 2); }
  return lv;
}
const bolts = (n, col=C.text) => `<span class="bolts" aria-label="Difficulté ${n} sur 5">${[1,2,3,4,5].map(i=>`<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z" fill="${i<=n?col:'rgba(154,163,178,.28)'}"/></svg>`).join('')}</span>`;
const actOf = code => S.acts.find(a => a.code === code);
const inWeek = (d, w) => d >= w.start && d <= weekEnd(w);
function realWeek(w){
  let km=0, dur=0;
  for (const a of S.acts) if (inWeek(a.date, w)){ km += a.km||0; dur += a.dur||0; }
  for (const s of w.sessions) if (isDone(s) && !actOf(s.code)){ km += kmOf(s); dur += sessDur(s); }
  return {km, dur};
}
function curWeek(){ const t=todayIso(); const w = PLAN.find(w => t >= w.start && t <= weekEnd(w)); return w || (t < PLAN[0].start ? PLAN[0] : PLAN[PLAN.length-1]); }
function nextSession(){ const t=todayIso(); return ALL.find(s => s.date >= t && !isDone(s)) || ALL.find(s => !isDone(s)) || ALL[ALL.length-1]; }
const doneKm = () => OFF.reduce((a,w)=>a+realWeek(w).km, 0);
const TOTAL_KM = OFF.reduce((a,w)=>a+w.sessions.reduce((x,s)=>x+s.km,0),0);
const MILES = [
  {k:'start',l:'Départ',date:'2026-10-26',sub:'lundi 26 oct.',c:C.pink,frac:0},
  {k:'10k',l:'Camp 1',date:'2026-11-29',sub:'10 km · 29 nov.',c:C.orange},
  {k:'semi',l:'Camp 2',date:'2027-03-07',sub:'semi · 7 mars',c:C.amber},
  {k:'mara',l:'Sommet',date:'2027-04-04',sub:'marathon · 4 avr.',c:C.teal},
];
(function(){ let cum=0; const cut={'10k':8,'semi':22,'mara':26}; OFF.forEach(w=>{ cum+=w.km; for(const m of MILES) if(cut[m.k]===w.num) m.frac=cum/TOTAL_KM; }); })();
/* Seances passees sans retour (7 derniers jours) */
const pending = () => { const t=todayIso(), lim=addDays(t,-7); return ALL.filter(s => s.date < t && s.date >= lim && !isDone(s) && s.week > PRE); };
const MOOD = ['À plat','Fatigué','Correct','Bien','Au top'];

/* ---------------- Accueil ---------------- */
function Home(){
  const t = new Date();
  const label = t.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const km = doneKm(), cwk = curWeek(), cw = wNo(cwk);
  const rest = MILES.slice(0,3).filter(m => daysTo(m.date) >= 0); const up = [...(rest.length>=2?rest.slice(0,2):MILES.slice(1,3)), MILES[3]];
  const n = nextSession(), k = KIND[n.kind];
  const pend = pending(); const adj = activeAdj()[0];
  const ch = challenges().find(c => S.joined[c.id]) || challenges()[0];
  return `<div class="hero" style="aspect-ratio:412/430;height:auto">
    <svg class="land" viewBox="0 0 412 430" role="img" aria-label="Piste de préparation : ${cwk.pre?'pré-saison':'semaine '+cw+' sur '+NW}, ${Math.round(km)} km parcourus" style="height:100%">${hexTrailSVG({x:14,y:104,w:384,h:312},{w:412,h:430},'hm')}</svg>
    <div style="position:absolute;left:18px;top:12px"><div class="anton h1">L'ascension</div><div class="muted" style="font-size:12.5px;margin-top:5px">Salut ${esc(S.name)} · ${label}</div><div style="font-size:12.5px;margin-top:3px;color:${C.orange}">${cwk.pre?'Pré-saison · départ officiel le '+shortDate(OFF_START):'S'+cw+'/'+NW+' · '+Math.round(km)+' / '+Math.round(TOTAL_KM)+' km parcourus'}</div></div>
  </div>
  <div class="pad">
    <div class="row muted" style="gap:12px;font-size:11.5px;flex-wrap:wrap;margin-top:-4px">${['done','part','miss','cur','fut'].map(k=>`<span class="row" style="gap:5px"><i class="lg" style="background:${HX_COL[k][0]};box-shadow:inset 0 0 0 1.5px ${HX_COL[k][1]}"></i>${HX_LABEL[k]}</span>`).join('')}<span class="row" style="gap:5px"><i class="lg" style="box-shadow:inset 0 0 0 2px ${C.amber}"></i>course</span></div>
    <div class="grid3">${up.map(m => { const d=daysTo(m.date); return `<div class="card" style="border-radius:20px;padding:12px 14px">
      <div class="mono muted" style="font-size:10px">${m.l}</div><div class="anton" style="font-size:28px;color:${m.c}">${d>0?'J-'+d:d===0?'Jour J':'✓'}</div><div class="muted" style="font-size:11px">${m.sub}</div></div>`; }).join('')}</div>
    ${pend.length ? `<button class="card row" style="text-align:left;border:2px solid ${C.orange}" onclick="startFlow('${pend[pend.length-1].code}')">
      <span class="dot" style="background:${C.orange}">${ico('check',20)}</span><span style="flex:1;min-width:0"><span class="mono" style="color:${C.orange};display:block">Retour attendu</span>
      <span style="font-weight:700;display:block">${esc(pend[pend.length-1].title)} · ${DOW[pend[pend.length-1].day]} ${shortDate(pend[pend.length-1].date)}</span><span class="muted" style="font-size:12.5px">Comment ça s'est passé ? Ton retour ajuste le plan.</span></span>${ico('next')}</button>` : ''}
    ${adj ? adjBanner(adj) : ''}
    <button onclick="openS('${n.code}')" style="background:${k.c};color:${C.bg};border-radius:28px;padding:20px;display:flex;flex-direction:column;gap:10px;text-align:left">
      <div class="mono" style="font-size:11px">Prochaine · ${DOW[n.day]} ${shortDate(n.date)}${isKey(n)?' · séance clé':''}</div>
      <div class="anton" style="font-size:32px;line-height:1.05">${esc(n.title)}</div>
      <div class="row" style="justify-content:space-between;width:100%"><div class="row" style="gap:8px"><span class="chip">${fmtN(kmOf(n))} km</span><span class="chip">${fmtDur(sessDur(n))}</span>${bolts(diffOf(n), C.bg)}</div>
      <span style="width:44px;height:44px;border-radius:50%;background:${C.bg};color:${k.c};display:grid;place-items:center">${ico('arrow')}</span></div>
    </button>
    ${ch ? `<button onclick="openLayer('defis')" style="background:${C.pink};color:${C.bg};border-radius:26px;padding:18px;text-align:left;display:flex;flex-direction:column;gap:10px">
      <div class="mono" style="font-size:10.5px">Défi en cours</div><div class="row" style="justify-content:space-between"><div class="anton" style="font-size:24px">${esc(ch.t)}</div><div style="font-weight:800">${fmtN(ch.v)} / ${fmtN(ch.goal)}</div></div>
      <div class="bar"><i style="width:${Math.min(100,ch.v/ch.goal*100)}%"></i></div></button>` : ''}
  </div>`;
}
function adjBanner(a){
  return `<div class="card" style="border:2px solid ${C.amber}"><div class="row" style="justify-content:space-between;align-items:flex-start">
    <div style="min-width:0"><div class="mono" style="color:${C.amber}">Plan allégé · -${Math.round((1-a.f)*100)} %</div>
    <div style="font-weight:700;margin-top:4px">Du ${shortDate(a.from)} au ${shortDate(a.to)}</div><div class="muted" style="font-size:12.5px;margin-top:2px">${esc(a.why)}</div></div>
    <button class="pill" style="background:${C.surface2};padding:9px 13px;font-size:12.5px;flex:none" onclick="offAdj('${a.id}')">Annuler</button></div>
    <p class="muted" style="font-size:11.5px;margin-top:8px">Durées et répétitions réduites, tests et courses inchangés. Les exports .fit suivent.</p></div>`;
}
window.offAdj = id => { const a=S.adj.find(x=>x.id===id); if(a){ a.off=true; save(); render(); toast('↺ Allègement annulé'); ivResync(); } };
window.openS = code => openLayer('detail',{code});

/* ---------------- Seances (semaine) ---------------- */
function Plan(){
  const w = PLAN.find(x=>x.num===V.week) || curWeek(); V.week = w.num;
  const b = BLOC[w.bloc], done = w.sessions.filter(isDone);
  const r = realWeek(w), pKm = w.sessions.reduce((a,s)=>a+kmOf(s),0), pDur = w.sessions.reduce((a,s)=>a+sessDur(s),0);
  const moods = w.sessions.map(s=>S.fb[s.code]&&S.fb[s.code].mood).filter(Boolean);
  const adj = S.adj.find(a => !a.off && a.from <= weekEnd(w) && a.to >= w.start);
  const max = Math.max(...PLAN.map(x=>x.km));
  const days = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  let idx = 0;
  const items = days.map(dd => {
    const s = w.sessions.find(x=>x.day===dd); const p = w.ppg.find(x=>x.day===dd);
    if (s){ idx++; return sessCard(s, idx, w.sessions.length); }
    if (p){ const ok=S.ppgDone.includes(p.date); return `<button class="ppgline" onclick="V.routine='${p.routine||'P1'}';go('ppg')"><span style="color:${ok?C.pink:C.muted}">${ok?'✓':'◇'}</span>${dd} ${shortDate(p.date)} · ${esc(p.name)}</button>`; }
    return '';
  }).join('');
  const st = (l, v, sub) => `<div><div class="muted" style="font-size:11.5px">${l}</div><div class="anton" style="font-size:26px;line-height:1.1">${v}</div><div class="muted" style="font-size:11px">${sub}</div></div>`;
  return `<div class="pad">
    <div class="row" style="justify-content:space-between">
      <button class="back" onclick="V.week=Math.max(1,V.week-1);render()" aria-label="Semaine précédente" ${w.num===1?'disabled style="opacity:.3"':''}>${ico('back')}</button>
      <div style="text-align:center"><div class="anton" style="font-size:26px;line-height:1">${w.num===curWeek().num?'Cette semaine':wLab(w)}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">${w.pre?'Pré-saison (hors stats)':(w.num-PRE)+' sur '+NW} · ${shortDate(w.start)} → ${shortDate(weekEnd(w))}</div></div>
      <button class="back" onclick="V.week=Math.min(${PLAN.length},V.week+1);render()" aria-label="Semaine suivante" ${w.num===PLAN.length?'disabled style="opacity:.3"':''}>${ico('next')}</button></div>
    <div class="card">
      <div class="row" style="justify-content:space-between"><div style="font-weight:800">Ton aperçu hebdomadaire</div><span class="mono" style="color:${b.c}">Bloc ${w.bloc}</span></div>
      <div class="muted" style="font-size:12.5px;margin-top:3px">${esc(w.title)}</div>
      <div class="grid3" style="margin-top:12px">${st('Séances', done.length+'/'+w.sessions.length, w.ppg.length?w.ppg.length+' PPG prévues':'&nbsp;')}${st('Durée', r.dur?fmtHM(r.dur):'0h00', 'sur '+fmtHM(pDur))}${st('Distance', fmtN(r.km), 'sur '+fmtN(pKm)+' km')}</div>
      ${moods.length?`<div class="muted" style="font-size:12px;margin-top:10px">Mood moyen ${fmtN(moods.reduce((a,x)=>a+x,0)/moods.length)} / 5 sur ${moods.length} séance(s)</div>`:''}
      <div class="row" style="gap:8px;margin-top:12px"><button class="pill" style="flex:1;background:${C.surface2};font-size:13px;padding:10px" onclick="openLayer('share',{week:${w.num}})">${ico('share',16)} Partager ma semaine</button>
        <button class="pill" style="background:${C.surface2};font-size:13px;padding:10px" onclick="openLayer('acts')">Activités</button></div>
    </div>
    ${adj ? adjBanner(adj) : ''}
    <div style="display:flex;flex-direction:column;gap:10px">${items.trim()||`<div class="card"><p style="color:var(--body)">${esc(w.title)}. Aucune séance programmée.</p></div>`}</div>
    ${ivCode() && w.sessions.some(ivSendable) ? `<button class="pill" style="background:${C.orange};color:${C.bg};padding:15px" ${V.ivBusy?'disabled':''} onclick="ivSendWeek(${w.num})">${V.ivBusy==='push'?'Envoi…':'Envoyer la semaine sur ma montre'}${w.sessions.some(s=>ivSendable(s)&&ivStatus(s)==='stale')?' (plan ajusté)':''}</button>` : ''}
    <div class="row" style="gap:8px">
      <button class="pill" style="flex:1;background:${C.text};color:${C.bg}" onclick="exportWeek(${w.num})">Semaine vers Garmin (.zip)</button>
      <button class="pill" style="background:${C.surface}" onclick="exportAll()">Plan complet</button></div>
    <div class="card"><div class="mono muted" style="margin-bottom:14px">Le parcours · ${NW} semaines dès le ${shortDate(OFF_START)} · ${Math.round(TOTAL_KM)} km</div>
      <div class="hist" role="group" aria-label="Volume par semaine">${PLAN.map(x => { const dk=Math.min(x.km, realWeek(x).km);
      return `<button aria-label="Semaine ${x.num}, ${x.km} km" onclick="V.week=${x.num};render()" style="height:${Math.max(4,x.km/max*100)}%;background:${BLOC[x.bloc].c};opacity:${x.num===w.num?1:x.pre?.2:.45}">
      ${x.sessions.some(s=>s.kind==='race')?'<span class="fl"></span>':''}<i style="position:absolute;left:0;right:0;bottom:0;height:${x.km?dk/x.km*100:0}%;background:rgba(245,241,234,.55);border-radius:4px 4px 0 0"></i></button>`; }).join('')}</div>
      <div class="row muted" style="gap:14px;font-size:11px;margin-top:12px;flex-wrap:wrap">${Object.entries(BLOC).map(([k,v])=>`<span class="row" style="gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${v.c}"></i>${k} · ${v.n}</span>`).join('')}</div></div>
  </div>`;
}
function sessCard(s, i, n){
  const k = KIND[s.kind], fb = S.fb[s.code], {f} = adjFactor(s);
  const st = (l, v) => `<div><div class="muted" style="font-size:11.5px">${l}</div><div style="margin-top:3px">${v}</div></div>`;
  const tag = isDone(s) ? `<span class="badge" style="background:${C.teal};color:${C.bg}">✓ ${fb?({easy:'Trop facile',ok:'Adapté',hard:'Difficile'})[fb.effort]:'Faite'}</span>`
    : s.date < todayIso() ? `<span class="badge" style="background:rgba(255,77,148,.18);color:${C.pink}">Retour attendu</span>` : '';
  return `<button class="scard" onclick="openS('${s.code}')">
    <div class="row" style="gap:12px;align-items:flex-start">
      <span class="kdot" style="background:${k.c}">${ico(s.kind==='q'?'zap':s.kind==='sl'?'activity':s.kind==='foot'?'arrow':'target',20)}</span>
      <span style="flex:1;min-width:0"><span class="row" style="gap:8px;flex-wrap:wrap">${isKey(s)?`<span class="badge key">Séance clé</span>`:''}<span class="muted" style="font-size:12px">Séance ${i}/${n} · ${DOW[s.day]} ${shortDate(s.date)}</span></span>
        <span style="display:block;font-size:16.5px;font-weight:800;margin-top:4px">${esc(s.title)}</span></span>
      ${ico('next',18)}</div>
    <div class="grid3" style="margin-top:12px">${st('Durée',`<span class="anton" style="font-size:20px">${fmtDur(sessDur(s)).replace(' min','')}</span><span class="muted" style="font-size:11px">${sessDur(s)>=3600?'':' min'}</span>`)}${st('Distance',`<span class="anton" style="font-size:20px">${fmtN(kmOf(s))}</span><span class="muted" style="font-size:11px"> km</span>`)}${st('Difficulté',bolts(diffOf(s)))}</div>
    ${(()=>{ const d = s.name.trim()!==s.title.trim() ? s.name : (s.note||''); return d?`<p class="clamp" style="margin-top:10px;font-size:13px;color:var(--body);font-weight:500">${esc(d)}</p>`:''; })()}
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">${tag}${f<1&&!frozen(s)?`<span class="badge" style="background:rgba(240,160,32,.16);color:${C.amber}">Allégée -${Math.round((1-f)*100)} %</span>`:''}${fb&&fb.mood?`<span class="badge" style="background:${C.surface2};color:${C.body}">Mood ${fb.mood}/5</span>`:''}</div>
  </button>`;
}

/* ---------------- Detail seance ---------------- */
const REASONS = {
  forme:[['allure','Allure trop rapide'],['motivation','Pas de motivation'],['fatigue','Fatigue'],['sommeil','Mauvais sommeil'],['maladie','Maladie'],['douleur','Douleur / blessure']],
  cond:[['chaleur','Forte chaleur'],['meteo','Météo difficile'],['terrain','Terrain inadapté'],['temps','Manque de temps'],['technique','Problème technique']],
};
const RLABEL = Object.fromEntries([...REASONS.forme, ...REASONS.cond]);
const EFFORT = {easy:'Trop facile', ok:'Adapté', hard:'Difficile à tenir'};
function Detail({code}){
  const s = ALL.find(x=>x.code===code); const k=KIND[s.kind]; const steps=stepsOf(s); const f=flatSteps(steps,s.bloc,S.vc); const tot=f.reduce((a,x)=>a+x.sec,0)||1;
  const wu=f.filter(x=>x.k==='warmup').reduce((a,x)=>a+x.sec,0), cd=f.filter(x=>x.k==='cooldown').reduce((a,x)=>a+x.sec,0), core=tot-wu-cd;
  const mz = mainZone(s); const {f:fa, a} = adjFactor(s);
  const bands = [[wu,'Échauf.','EF'],[core,'Corps',mz],[cd,'Retour','RECUP']].filter(b=>b[0]>0);
  const lines=[]; for (const st of steps){
    if (st.rep){ lines.push(`<li><b>${st.rep} ×</b><span class="muted">${st.steps.map(x=>esc(x.n)+(paceLabel(x.z,s.bloc,S.vc)?' @ '+paceLabel(x.z,s.bloc,S.vc):'')).join(' / ')}</span></li>`); }
    else lines.push(`<li><span>${esc(st.n)}${st.t&&adjFactor(s).f<1&&!frozen(s)&&st.k==='active'?' ('+fmtDur(st.t)+')':''}</span><span class="muted">${st.z==='OPEN'?'libre':st.z==='EFD'?'FC &lt; 145':paceLabel(st.z,s.bloc,S.vc)+' /km'}</span></li>`);
  }
  const fb = S.fb[code], act = actOf(code);
  return `<div class="pad">
    <div style="background:${k.c};color:${C.bg};border-radius:30px;padding:16px 18px 20px">
      <div class="row" style="justify-content:space-between"><button class="back hero-back" onclick="closeLayer()" aria-label="Retour">${ico('back')}</button>
        <span class="mono" style="font-size:11px">S${String(s.week).padStart(2,'0')} · ${DOW[s.day]} ${shortDate(s.date)}</span></div>
      <div class="row" style="margin-top:14px;gap:8px">${isKey(s)?`<span class="badge" style="background:${C.bg};color:${k.c}">Séance clé</span>`:''}<span style="font-weight:800;font-size:13px">${k.l}</span></div>
      <div class="anton" style="font-size:40px;line-height:1.02;margin-top:6px">${esc(s.title)}</div>
      <div class="grid3" style="margin-top:14px">${[['KM',fmtN(kmOf(s))],['DURÉE',fmtDur(tot)],mz==='EFD'?['FC MAX','145']:['MIN/KM',mz==='OPEN'?'libre':(paceLabel(mz,s.bloc,S.vc)||'-')]].map(([x,y])=>`<div><div class="mono" style="font-size:9.5px;opacity:.75">${x}</div><div class="anton" style="font-size:${String(y).length>6?20:28}px">${y}</div></div>`).join('')}</div>
      <div class="row" style="margin-top:10px;gap:8px"><span class="mono" style="font-size:9.5px;opacity:.75">Difficulté</span>${bolts(diffOf(s), C.bg)}</div>
    </div>
    ${fa<1&&!frozen(s)?`<div class="card" style="border:2px solid ${C.amber}"><div class="mono" style="color:${C.amber}">Séance allégée · -${Math.round((1-fa)*100)} %</div><p class="muted" style="font-size:12.5px;margin-top:4px">${esc(a.why)}. Prévu à l'origine : ${s.km} km.</p></div>`:''}
    <div class="card"><div class="mono muted">Instructions</div>
      <div style="display:flex;gap:4px;margin:12px 0">${bands.map(([sec,l,z])=>`<div class="band" style="flex:${sec};background:${ZCOLOR[z]}">${l}</div>`).join('')}</div>
      <ul class="steps">${lines.join('')}</ul>
      <p style="margin-top:12px;color:var(--body);font-size:13.5px">${esc(s.name)}</p>
      <p class="muted" style="margin-top:8px;font-size:11.5px">Allures pour VC ${fmtN(S.vc)} km/h${frozen(s)?'':', bloc '+s.bloc}. Durée estimée.</p></div>
    ${s.note?`<div class="card row" style="align-items:flex-start"><span class="kdot" style="background:${C.surface2};color:${C.text};font-family:Anton;font-size:18px">M</span><div><div style="font-weight:800">Le mot du plan</div><p style="color:var(--body);font-size:13.5px;margin-top:4px">${esc(s.note)}</p></div></div>`:''}
    ${fb||isDone(s) ? `<div style="background:${C.teal};color:${C.bg};border-radius:24px;padding:18px">
        <div class="row" style="justify-content:space-between"><div class="anton" style="font-size:24px">Sommet atteint</div><span class="mono">${fb?esc(EFFORT[fb.effort]):'RPE '+S.done[code]}</span></div>
        ${fb?`<div style="font-weight:700;margin-top:6px">${fb.mood?'Mood '+fb.mood+'/5 · '+MOOD[fb.mood-1]:''}${fb.reasons&&fb.reasons.length?' · '+fb.reasons.map(r=>esc(RLABEL[r])).join(', '):''}</div>`:''}
        ${act?`<div style="font-size:13px;margin-top:4px">${fmtN(act.km)} km${act.dur?' · '+fmtHMS(act.dur):''}${act.hr?' · FC moy '+act.hr:''}${act.zones?' · '+z12(act.zones)+' % en Z1-Z2':''}</div>`:''}
        ${fb&&fb.chrono?`<div style="font-size:13px;margin-top:4px">Chrono du test : ${fmtHMS(fb.chrono)}</div>`:''}
        ${fb&&fb.note?`<p style="font-size:13px;margin-top:6px">« ${esc(fb.note)} »</p>`:''}
        <div class="row" style="gap:8px;margin-top:12px"><button class="pill" style="background:rgba(10,14,20,.15);flex:1" onclick="startFlow('${code}')">Modifier mon retour</button><button class="pill" style="background:rgba(10,14,20,.15)" onclick="undo('${code}')">Annuler</button></div></div>`
    : `<button class="pill" style="background:${C.text};color:${C.bg};padding:17px;font-size:15px" onclick="startFlow('${code}')">Valider ma séance</button>`}
    ${ivDetailBlock(s)}
    <button class="pill" style="background:${C.surface};padding:16px" onclick="exportOne('${code}')">Envoyer au Garmin (.fit)</button>
    ${frozen(s)||s.kind==='q'?'':`<button class="card row" style="text-align:left" onclick="V.routine='M1';tReset(true);go('ppg')"><span class="kdot" style="background:${C.teal}">${ico('reset',20)}</span><span style="flex:1"><span style="font-weight:800;display:block">Mobilité après course</span><span class="muted" style="font-size:12.5px">Jambes · 5 mouvements · 10 min</span></span>${ico('next',18)}</button>`}
  </div>`;
}
window.undo = code => { delete S.done[code]; delete S.fb[code]; S.acts.forEach(a=>{ if(a.code===code) delete a.code; }); save(); render(); toast('↺ Séance annulée'); };
const z12 = z => { const t=z.reduce((a,x)=>a+x,0); return t ? Math.round((z[0]+z[1])/t*100) : 0; };

/* ---------------- Validation en 3 temps ---------------- */
window.startFlow = code => { const old = S.fb[code];
  V.flow = {code, effort:old?old.effort:null, reasons:old?[...old.reasons]:[], mood:old?old.mood:null, note:old?old.note||'':'', chrono:old?old.chrono||null:null};
  const act = actOf(code); if (act) Object.assign(V.flow, {km:act.km, dur:act.dur, hr:act.hr, zones:act.zones, src:'lien', actRef:act.date+'|'+act.km});
  openLayer('complete'); };
function Complete(){
  if (!V.flow) return '';
  const s = ALL.find(x=>x.code===V.flow.code), fl=V.flow;
  const free = S.acts.filter(a => !a.code && Math.abs(daysTo(a.date) - daysTo(s.date)) <= 1);
  const opt = (onclick, title, sub, ic, col) => `<button class="card row" style="text-align:left" onclick="${onclick}"><span class="kdot" style="background:${col}">${ico(ic,20)}</span><span style="flex:1;min-width:0"><span style="font-weight:800;display:block">${title}</span><span class="muted" style="font-size:12.5px">${sub}</span></span>${ico('next',18)}</button>`;
  return `<div class="pad">${head('Compléter ma séance', esc(s.title)+' · '+shortDate(s.date))}
    ${fl.km?`<div class="card" style="border:2px solid ${C.teal}"><div class="mono" style="color:${C.teal}">Données liées</div><div style="font-weight:700;margin-top:4px">${fmtN(fl.km)} km${fl.dur?' · '+fmtHMS(fl.dur):''}${fl.hr?' · FC moy '+fl.hr:''}</div>
      <button class="pill" style="background:${C.teal};color:${C.bg};margin-top:10px;width:100%" onclick="openLayer('effort')">Continuer</button></div>`:''}
    ${free.map(a=>opt(`useAct('${a.date}',${a.km})`, `Utiliser l'activité du ${shortDate(a.date)}`, `${fmtN(a.km)} km${a.dur?' · '+fmtHMS(a.dur):''}${a.hr?' · FC '+a.hr:''} (déjà importée)`, 'activity', C.surface2)).join('')}
    ${opt(`V.fitTarget='${s.code}';$('#fitInput').click()`, 'Importer le .fit de ma sortie', 'Garmin Connect : Exporter le fichier original. Distance, durée, FC et temps par zone.', 'upload', C.orange)}
    ${opt(`openLayer('manual')`, 'Ajouter manuellement', 'Distance, durée et FC moyenne.', 'edit', C.surface2)}
    ${opt(`V.flow.km=null;openLayer('effort')`, 'Valider sans données', 'Seulement ton ressenti et ton mood.', 'check', C.surface2)}
  </div>`;
}
window.useAct = (date, km) => { const a = S.acts.find(x => x.date===date && x.km===km && !x.code); if(!a) return;
  Object.assign(V.flow, {km:a.km, dur:a.dur, hr:a.hr, zones:a.zones, src:'lien', actRef:date+'|'+km}); openLayer('effort'); };
function Manual(){
  if (!V.flow) return '';
  const fl = V.flow, s = ALL.find(x=>x.code===fl.code);
  return `<div class="pad">${head('Ajouter manuellement', esc(s.title))}
    <div class="card"><div class="field"><label for="mKm">Distance (km)</label><input id="mKm" inputmode="decimal" placeholder="${fmtN(kmOf(s))}"></div>
      <div class="field"><label for="mDur">Durée (h:mm:ss ou min)</label><input id="mDur" placeholder="${fmtHMS(sessDur(s))}"></div>
      <div class="field" style="border:0"><label for="mHr">FC moyenne (option)</label><input id="mHr" inputmode="numeric" placeholder="bpm"></div></div>
    <button class="pill" style="background:${C.text};color:${C.bg};padding:16px" onclick="saveManual()">Continuer</button></div>`;
}
const parseDur = v => { v=String(v||'').trim(); if(!v) return NaN; const p=v.split(':').map(Number); if (p.some(isNaN)) return NaN;
  return p.length===3 ? p[0]*3600+p[1]*60+p[2] : p.length===2 ? p[0]*60+p[1] : p[0]*60; };
window.saveManual = () => { const km=parseFloat($('#mKm').value.replace(',','.')), dur=parseDur($('#mDur').value), hr=parseInt($('#mHr').value,10);
  if (!(km>0 && km<100)) return toast('Distance invalide'); if (!(dur>0)) return toast('Durée invalide');
  Object.assign(V.flow, {km:Math.round(km*100)/100, dur, hr:hr>60&&hr<230?hr:null, zones:null, src:'manuel'}); openLayer('effort'); };
function Effort(){
  if (!V.flow) return '';
  const fl = V.flow, s = ALL.find(x=>x.code===fl.code), k = KIND[s.kind];
  const tDist = testDist(s), tLab = tDist===5000 ? '5 km' : tDist ? tDist.toLocaleString('fr-FR')+' m' : '';
  return `<div class="pad">
    <div style="background:${k.c};color:${C.bg};border-radius:30px;padding:16px 18px 22px;text-align:center">
      <div class="row"><button class="back hero-back" onclick="closeLayer()" aria-label="Retour">${ico('back')}</button></div>
      <div class="anton" style="font-size:30px;line-height:1.05;margin-top:6px">${esc(s.title)}</div>
      <div style="margin-top:8px">${bolts(diffOf(s), C.bg)}</div>
      <div style="font-weight:800;font-size:18px;margin-top:14px">Comment as-tu trouvé l'effort sur cette séance ?</div>
      <div style="font-size:13px;opacity:.8;margin-top:4px">Ton ressenti ajuste tes prochaines séances.</div></div>
    <div style="display:flex;flex-direction:column;gap:8px">${Object.entries(EFFORT).map(([k2,l])=>`<button class="opt ${fl.effort===k2?'on':''}" onclick="V.flow.effort='${k2}';render()" aria-pressed="${fl.effort===k2}">${l}</button>`).join('')}</div>
    <div class="card"><div style="font-weight:800">Ton mood du moment</div><div class="muted" style="font-size:12.5px;margin-top:2px">Comment tu te sens, au-delà de la séance.</div>
      <div class="row" style="justify-content:space-between;margin-top:12px">${MOOD.map((m,i)=>`<button class="rpe ${fl.mood===i+1?'on':''}" style="${fl.mood===i+1?'background:'+[C.pink,C.orange,C.amber,C.teal,C.teal][i]:''}" onclick="V.flow.mood=${i+1};render()" aria-label="${m}" aria-pressed="${fl.mood===i+1}">${i+1}</button>`).join('')}</div>
      <div class="row muted" style="justify-content:space-between;font-size:11px;margin-top:6px"><span>${MOOD[0]}</span><span>${fl.mood?MOOD[fl.mood-1]:''}</span><span>${MOOD[4]}</span></div></div>
    ${tDist?`<div class="card"><div class="field" style="border:0"><label for="chrono" style="font-weight:800">Chrono du ${tLab} (m:ss)</label><input id="chrono" placeholder="${({5000:'23:45',1200:'4:48',3600:'15:54'})[tDist]||'m:ss'}" value="${fl.chrono?fmtHMS(fl.chrono):''}" onchange="V.flow.chrono=parseDur(this.value)||null"></div>
      <p class="muted" style="font-size:12px">${tDist===5000?'Il devient un chrono de référence : projection marathon et profil recalculés.':"Avec l'autre test VC, l'appli calcule ta vitesse critique et te propose de recaler toutes les allures."}</p></div>`:''}
    <button class="pill" style="background:${fl.effort&&fl.mood?C.text:C.surface2};color:${fl.effort&&fl.mood?C.bg:C.muted};padding:16px" onclick="effortNext()">${fl.effort==='hard'?'Suivant':'Valider ma séance'}</button></div>`;
}
function testDist(s){ if (s.kind!=='test') return null; const st = s.steps.find(x=>x.z==='OPEN' && x.d); return st ? st.d : null; }
/* Tests VC : deux efforts maximaux a allure constante (modele distance-temps, Jones et Vanhatalo 2017) */
function vcFromTests(){
  const ts = ALL.filter(s => /_vc[12]$/.test(s.code) && S.fb[s.code] && S.fb[s.code].chrono).map(s => ({d:testDist(s), t:S.fb[s.code].chrono})).sort((a,b)=>a.d-b.d);
  if (ts.length < 2 || ts[1].t <= ts[0].t || ts[1].d <= ts[0].d) return null;
  const vc = (ts[1].d-ts[0].d)/(ts[1].t-ts[0].t)*3.6;
  return vc > 6 && vc < 25 ? {vc:Math.round(vc*10)/10, raw:vc, a:ts[0], b:ts[1]} : null;
}
window.effortNext = () => { const fl=V.flow; const c=$('#chrono'); if (c) fl.chrono = parseDur(c.value) || null;
  if (!fl.effort) return toast('Choisis ton ressenti'); if (!fl.mood) return toast('Indique ton mood');
  if (fl.effort==='hard') openLayer('why'); else commitFlow(); };
function Why(){
  if (!V.flow) return '';
  const fl = V.flow;
  const chips = list => `<div class="row" style="flex-wrap:wrap;gap:8px">${list.map(([k,l])=>`<button class="chipsel ${fl.reasons.includes(k)?'on':''}" aria-pressed="${fl.reasons.includes(k)}" onclick="togR('${k}')">${l}</button>`).join('')}</div>`;
  return `<div class="pad">${head('Pourquoi était-ce si difficile ?', 'Ton retour décide de l’ajustement du plan.')}
    <div style="font-weight:800">Ton état de forme</div>${chips(REASONS.forme)}
    <div style="font-weight:800;margin-top:6px">Les conditions du run</div>${chips(REASONS.cond)}
    <label for="fbNote" style="font-weight:800;margin-top:6px">Note personnelle (optionnelle)</label>
    <textarea id="fbNote" rows="3" placeholder="Note personnelle" oninput="V.flow.note=this.value">${esc(fl.note)}</textarea>
    <button class="pill" style="background:${fl.reasons.length?C.text:C.surface2};color:${fl.reasons.length?C.bg:C.muted};padding:16px" onclick="${fl.reasons.length?'commitFlow()':"toast('Choisis au moins une raison')"}">Suivant</button></div>`;
}
window.togR = k => { const r=V.flow.reasons; const i=r.indexOf(k); if(i<0) r.push(k); else r.splice(i,1); const n=$('#fbNote'); if(n) V.flow.note=n.value; render(); };
window.commitFlow = () => {
  const fl = V.flow, s = ALL.find(x=>x.code===fl.code);
  if (fl.effort !== 'hard') fl.reasons = [];
  S.fb[s.code] = {effort:fl.effort, reasons:fl.reasons, mood:fl.mood, note:fl.note||'', chrono:fl.chrono||null, date:todayIso()};
  S.done[s.code] = {easy:2, ok:3, hard:4}[fl.effort];
  S.acts.forEach(a => { if (a.code===s.code) delete a.code; });
  if (fl.km){
    let a = fl.actRef ? S.acts.find(x => x.date+'|'+x.km === fl.actRef) : null;
    if (!a && fl.src==='fit') a = S.acts.find(x => x.fitKey && x.fitKey===fl.fitKey);
    if (!a){ a = {date:fl.date||s.date, km:fl.km, dur:fl.dur||null, hr:fl.hr||null, zones:fl.zones||null, src:fl.src}; S.acts.push(a); }
    a.code = s.code;
  }
  if (fl.chrono && testDist(s)===5000){ S.perfs = S.perfs.filter(p=>p.id!=='t_'+s.code); S.perfs.push({id:'t_'+s.code, date:s.date, km:5, sec:fl.chrono, l:'5 km', src:'test du plan'}); }
  V.verdict = adapt(s);
  if (/_vc[12]$/.test(s.code)){ const r = vcFromTests(); if (r){ V.verdict.vc = r; V.verdict.t = 'TESTS VC TERMINÉS'; V.verdict.c = C.teal; } }
  save(); openLayer('verdict'); ivResync();
};
const PHYS = ['fatigue','sommeil','maladie','douleur'], EXT = ['chaleur','meteo','terrain','temps','technique'];
function adapt(s){
  const fb = S.fb[s.code], from = addDays(s.date >= todayIso() ? s.date : todayIso(), 1);
  const recent = Object.entries(S.fb).map(([c,x])=>({c,x,d:(ALL.find(y=>y.code===c)||{}).date||x.date})).sort((a,b)=>a.d.localeCompare(b.d)).slice(-3);
  const hasAdj = () => S.adj.some(a => !a.off && a.to >= from);
  let v;
  if (fb.effort === 'hard'){
    const r = fb.reasons;
    if (r.includes('maladie') || r.includes('douleur')){
      addAdj(from, 7, .7, r.includes('maladie') ? 'Séance difficile : maladie' : 'Séance difficile : douleur');
      v = {t:'UN PEU TROP DUR !', c:C.pink, m:"Tes 7 prochains jours passent à 70 % du volume. Si la douleur persiste au-delà de quelques jours, fais-la examiner avant de reprendre l'intensité."};
    } else if (r.some(x => PHYS.includes(x))){
      addAdj(from, 7, .85, 'Séance difficile : '+r.filter(x=>PHYS.includes(x)).map(x=>RLABEL[x].toLowerCase()).join(', '));
      v = {t:'UN PEU TROP DUR !', c:C.pink, m:'On simplifie : tes 7 prochains jours sont allégés de 15 %.'};
    } else if (r.includes('allure')){
      v = {t:'ALLURE À REVOIR', c:C.amber, m:"Le plan ne change pas : la difficulté vient de l'allure. Reste dans la fourchette affichée, surtout en endurance."};
    } else if (r.some(x => EXT.includes(x))){
      v = {t:'CONDITIONS DIFFICILES', c:C.amber, m:'Facteur extérieur : le plan ne change pas.'};
    } else {
      v = {t:'SÉANCE DIFFICILE', c:C.amber, m:"C'est noté. Si ça se répète, le plan s'allègera."};
    }
    const hard = recent.filter(e => e.x.effort==='hard' && !(e.x.reasons||[]).every(x=>EXT.includes(x)||x==='allure')).length;
    if (hard >= 2 && !hasAdj()){ addAdj(from, 7, .85, '2 séances difficiles sur les 3 dernières'); v.m += ' 2 séances difficiles sur les 3 dernières : 7 jours allégés de 15 %.'; }
  } else if (fb.effort === 'easy'){
    const keys = recent.filter(e => { const ss=ALL.find(y=>y.code===e.c); return ss && isKey(ss); });
    const twice = keys.length >= 2 && keys.slice(-2).every(e => e.x.effort==='easy');
    v = twice ? {t:'TROP FACILE ?', c:C.teal, m:"2 séances clés de suite jugées trop faciles : ta VC a peut-être progressé. Refais un test (Plus › Zones › Calcul VC) plutôt que d'accélérer au feeling."}
              : {t:'TROP FACILE ?', c:C.teal, m:"C'est noté. Le plan ne monte pas tout seul : si ça se répète sur les séances clés, on refait un test."};
  } else {
    v = {t:'CHARGE ADAPTÉE', c:C.teal, m:'On garde le cap.'};
  }
  const lowMood = recent.filter(e => e.x.mood && e.x.mood <= 2).length;
  if (lowMood >= 2 && !hasAdj()){ addAdj(from, 5, .85, 'Mood bas sur 2 des 3 dernières séances'); v.m += ' Mood bas sur 2 des 3 dernières séances : 5 jours allégés de 15 %.'; }
  return v;
}
function Verdict(){
  const v = V.verdict || {t:'',m:'',c:C.teal};
  return `<div style="min-height:100%;display:flex;flex-direction:column;justify-content:flex-end;padding:24px 18px calc(30px + var(--safe-b));gap:14px;background:${v.c};color:${C.bg}">
    <svg viewBox="0 0 120 110" width="160" style="align-self:center;margin-bottom:auto;margin-top:40px" aria-hidden="true">${[[30,80],[60,80],[45,54],[75,54],[60,28]].map(([x,y],i)=>`<polygon points="${ptsStr(hexPts(x,y,15))}" fill="${C.bg}" fill-opacity="${i===4?1:.55}"/>`).join('')}</svg>
    <div class="mono">Charge</div><div class="anton" style="font-size:44px;line-height:1">${esc(v.t)}</div>
    <p style="font-size:15px;font-weight:700">${esc(v.m)}</p>
    ${v.vc?`<div style="background:${C.bg};color:${C.text};border-radius:22px;padding:16px"><div class="mono" style="color:${C.teal}">Vitesse critique calculée</div>
      <div class="row" style="align-items:baseline;gap:8px;margin-top:4px"><span class="anton" style="font-size:44px">${fmtN(v.vc.vc)}</span><span>km/h</span><span class="muted" style="font-size:13px">actuelle ${fmtN(S.vc)}</span></div>
      <p class="muted" style="font-size:12px;margin-top:4px">(${v.vc.b.d} - ${v.vc.a.d} m) / (${fmtHMS(v.vc.b.t)} - ${fmtHMS(v.vc.a.t)}) = ${fmtN(v.vc.raw*10/36)} m/s. Toutes les allures du plan seront recalculées.</p>
      <button class="pill" style="background:${C.teal};color:${C.bg};width:100%;margin-top:12px" onclick="V.flow=null;setVC(${v.vc.vc},'tests VC 1 200 m + 3 600 m');closeAll()">Appliquer à tout le plan</button></div>`:''}
    <button class="pill" style="background:${C.bg};color:${C.text};padding:17px;margin-top:10px" onclick="V.flow=null;closeAll();toast('✓ Séance validée')">${v.vc?'Plus tard':'Terminer'}</button></div>`;
}

/* ---------------- Export Garmin ---------------- */
function download(blob, name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); }
function loadScript(src){ return new Promise((ok,ko)=>{ const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=ko; document.head.appendChild(s); }); }
const ensureZip = () => window.JSZip ? Promise.resolve() : loadScript('./vendor/jszip.min.js');
const fitOf = s => encodeWorkoutFit(s.code, stepsOf(s), s.bloc, S.vc);
const HOWTO = `IMPORT GARMIN (USB) :
1. Brancher la montre en USB (fermer Garmin Express)
2. Copier les .fit dans GARMIN/NEWFILES/ (creer le dossier si besoin)
3. Ejecter, debrancher, attendre le redemarrage
4. Sur la montre : Course > Entrainement > Seances
Importer par lots de 4-5 fichiers.`;
const stepTxt = (x,b) => x.n+(x.z==='EFD'?' (FC < 145, sans cible d\'allure)':paceLabel(x.z,b,S.vc)?' @ '+paceLabel(x.z,b,S.vc)+'/km':'');
const readmeLine = s => `  ${s.code}.fit : ${s.title} (${kmOf(s)} km, ~${fmtDur(sessDur(s))})${adjFactor(s).f<1&&!frozen(s)?' [ALLEGEE]':''}\n${stepsOf(s).map(x=>'      - '+(x.rep?x.rep+' x [ '+x.steps.map(y=>stepTxt(y,s.bloc)).join(' / ')+' ]':stepTxt(x,s.bloc))).join('\n')}`;
window.exportOne = s => { const x=ALL.find(y=>y.code===s); download(new Blob([fitOf(x)],{type:'application/octet-stream'}), x.code+'.fit'); toast('✓ '+x.code+'.fit téléchargé'); };
window.exportWeek = async n => { try{ await ensureZip(); const w=PLAN.find(x=>x.num===n); if(!w.sessions.length) return toast('Semaine sans séance'); const z=new JSZip();
  w.sessions.forEach(s=>z.file(s.code+'.fit', fitOf(s)));
  z.file('README.txt', `Semaine ${n} - ${w.title}\nAllures calculees pour VC ${S.vc} km/h\n\n${w.sessions.map(readmeLine).join('\n')}\n\n${HOWTO}\n`);
  download(await z.generateAsync({type:'blob'}), `MeRun_S${String(n).padStart(2,'0')}_garmin.zip`); toast(`✓ Semaine ${n} exportée`); }catch(e){ console.error(e); toast('Erreur export'); } };
window.exportAll = async () => { try{ await ensureZip(); const z=new JSZip();
  PLAN.forEach(w=>{ const f=z.folder('S'+String(w.num).padStart(2,'0')); w.sessions.forEach(s=>f.file(s.code+'.fit', fitOf(s))); });
  z.file('README.txt', `MeRun-MeTrail - Plan Marathon de Paris (05/10/2026 - 04/04/2027)\n${ALL.length} seances, allures pour VC ${S.vc} km/h\n\n${PLAN.map(w=>`S${String(w.num).padStart(2,'0')} - ${w.title} (${w.km} km)\n${w.sessions.map(readmeLine).join('\n')}`).join('\n\n')}\n\n${HOWTO}\n`);
  download(await z.generateAsync({type:'blob'}), 'MeRun_plan_complet_garmin.zip'); toast('✓ Plan complet exporté'); }catch(e){ console.error(e); toast('Erreur export'); } };
/* ---------------- PPG ---------------- */
/* P1 et P2 : onglet PPG du classeur v4 (contenu, series, repetitions). C : routine "haut du corps" de la v2.8.
   Les durees d'effort / de recuperation sont indicatives (le classeur donne des series x repetitions). */
const ROUT = {
  P1:{n:'PPG 1 · Force',sub:'Lundi · 35-40 min',ex:[
    ['Échauffement : vélo ou corde + montées de genoux, talons-fesses',1,'5 min',300,0,'Ne jamais attaquer à froid.'],
    ['Squat (barre, haltères ou poids du corps lesté)',3,'8-10',30,90,'Cuisses parallèles. Les 2 dernières reps doivent être dures.'],
    ['Fente bulgare (pied arrière surélevé)',3,'8 / jambe',60,75,'Corrige les déséquilibres droite/gauche.'],
    ['Soulevé de terre jambes tendues (roumain)',3,'8-10',40,90,'Chaîne postérieure. Dos plat, mouvement lent.'],
    ['Mollets excentriques sur une marche (1 jambe)',3,'12 / jambe',60,45,"Descente lente en 3 s. Prévention tendon d'Achille."],
    ['Pont fessier une jambe',3,'12 / jambe',50,45,'Réveille les fessiers.'],
    ['Gainage : planche ventrale, latérale D et G',3,'45 s chaque',135,45,'Enchaîner les 3 positions. Bassin stable.']]},
  P2:{n:'PPG 2 · Stabilité',sub:'Samedi · 20-25 min',ex:[
    ['Planche ventrale dynamique (bras tendus / coudes)',3,'45 s',45,30,''],
    ['Planche latérale avec élévation de jambe',3,'30 s / côté',60,30,'Cible le moyen fessier.'],
    ['Équilibre unipodal yeux fermés',3,'45 s / jambe',90,20,'Sur coussin si trop facile.'],
    ['Montées sur une marche, lentes et contrôlées',2,'12 / jambe',60,45,'Sans élan, sans charge.'],
    ['Mollets excentriques (rappel léger)',2,'12 / jambe',50,30,''],
    ['Mobilité hanches : fentes en rotation, ouverture',1,'5 min',300,0,''],
    ['Étirements doux chaîne postérieure',1,'5 min',300,0,'Sans forcer, en respirant.']]},
  C:{n:'C · Haut du corps',sub:'Matériel · ~30 min',ex:[
    ["Dips à l'espalier",3,'max',45,75,'Descente contrôlée.'],['Pompes pieds surélevés',3,'10-15',45,60,'Corps gainé.'],
    ['Développé épaules élastique',3,'12-15',40,60,''],["Tractions à l'espalier",3,'max',45,90,'Pieds sur un barreau ou élastique si besoin.'],
    ['Tirage horizontal élastique',3,'12-15',40,60,'Serrer les omoplates.'],['Curl biceps élastique',2,'12-15',40,45,''],
    ['Roulette à abdos',3,'8-12',40,60,'Dos plat, jamais creuser les lombaires.'],['Relevé de jambes suspendu',3,'10-12',40,60,'Sans balancer.']]},
  /* Mobilite (v4.3) : routines MeRun inspirees de mouvements classiques d'etirement et de mobilite.
     Format : [nom, series (2 = un cote puis l'autre), libelle, duree s, transition s, consignes, zones, type, par cote] */
  M1:{mob:true,n:'Après course',sub:'Jambes · après chaque sortie · ~10 min',ex:[
    ['Mollet au mur',2,'1 min / côté',60,5,"Mains au mur, jambe arrière tendue et talon au sol. Avance le bassin, pointe du pied vers le mur.",'Mollets','passif',1],
    ['Fessier en « 4 » contre le mur',2,'1 min / côté',60,5,"Allongé, un pied à plat contre le mur, cheville de l'autre jambe posée sur ce genou. Rapproche le bassin du mur, pousse doucement le genou.",'Fessiers, hanches','passif',1],
    ['Fente genou au sol',2,'1 min / côté',60,5,"Genou arrière sur un coussin, fesses serrées. Avance le bassin sans creuser le dos : l'étirement est devant la hanche.",'Psoas, quadriceps','passif',1],
    ['Ischios assis, une jambe pliée',2,'1 min / côté',60,5,"Une jambe tendue, plante de l'autre pied contre la cuisse. Dos long, penche-toi vers le pied tendu.",'Ischio-jambiers, mollets','passif',1],
    ['Écart assis',1,'2 min',120,0,"Jambes écartées sans douleur, dos long. Avance les mains au sol à chaque expiration.",'Adducteurs, ischios','passif',0]]},
  M2:{mob:true,n:'Hanches & dos',sub:'Soir ou jour de repos · ~10 min',ex:[
    ['Squat profond actif',1,'1 min',60,0,"Squat le plus bas possible, buste droit, talons au sol. Bascule un genou vers le sol, puis l'autre.",'Hanches, chevilles','actif',0],
    ['Papillon',1,'1 min',60,0,"Assis, plantes des pieds l'une contre l'autre, dos droit. Laisse les genoux descendre, les coudes accompagnent.",'Adducteurs','passif',0],
    ['Fessier assis jambe croisée',2,'1 min / côté',60,5,"Une jambe croisée par-dessus l'autre, pied à plat. Ramène le genou vers l'épaule opposée, buste tourné vers lui.",'Fessiers','passif',1],
    ['Pigeon',2,'1 min / côté',60,5,"Jambe avant pliée devant toi, jambe arrière tendue. Descends le buste vers l'avant sans forcer.",'Fessiers, hanches','passif',1],
    ['Chat-vache',1,'1 min',60,0,"À quatre pattes : enroule le dos en expirant, creuse-le en inspirant. Lentement.",'Dos','actif',0],
    ["Cobra puis posture de l'enfant",1,'1 min',60,0,"Ventre au sol, relève le buste sur les mains, puis recule les fesses vers les talons, bras tendus devant.",'Abdos, dos, dorsaux','actif',0],
    ['Torsion allongée',2,'1 min / côté',60,5,"Sur le côté, hanche et genou du dessus pliés à 90°, genou tenu au sol. Ouvre l'autre bras de l'autre côté et laisse le dos tourner.",'Dos, pectoraux','passif',1]]},
  M3:{mob:true,n:'Haut du corps',sub:'Après une journée assis · ~10 min',ex:[
    ['Triceps derrière la tête',2,'1 min / côté',60,5,"Main dans le dos, le plus bas possible. L'autre main tire doucement le coude vers l'arrière, abdos serrés.",'Triceps, épaules','passif',1],
    ['Pectoraux au mur',2,'1 min / côté',60,5,"Avant-bras au mur à hauteur d'épaule, pied du même côté un pas en avant. Tourne le buste à l'opposé.",'Pectoraux','passif',1],
    ["Arrière de l'épaule",2,'1 min / côté',60,5,"Bras tendu devant toi, ramène-le contre la poitrine avec l'autre main, épaule basse.",'Épaules','passif',1],
    ['Trapèzes',2,'1 min / côté',60,5,"Assis, un bras tiré vers le sol. Penche la tête du côté opposé, regard légèrement vers le bas.",'Cou, trapèzes','passif',1],
    ['Prière (dorsaux)',1,'1 min',60,0,"À genoux, bras tendus devant, paumes au sol, fesses vers les talons. Glisse les mains d'un côté puis de l'autre.",'Dorsaux, épaules','passif',0],
    ['Auto-enlacement',1,'1 min',60,0,"Croise les bras et attrape tes épaules, coudes vers l'avant. Respire dans le haut du dos.",'Haut du dos','passif',0]]},
  M4:{mob:true,n:'Réveil avant course',sub:'Avant une séance · ~6 min · que du dynamique',ex:[
    ['Cheville en fente',2,'30 s / côté',30,5,"Genou arrière au sol, pied avant à plat. Avance le genou au-dessus des orteils puis reviens, talon collé au sol.",'Chevilles','actif',1],
    ['V debout actif',1,'1 min',60,0,"Jambes écartées et tendues : touche une cheville avec les deux mains, puis l'autre, en rythme.",'Ischios, adducteurs','actif',0],
    ['Squat vers debout',1,'1 min',60,0,"Doigts sous les orteils, descends en squat, puis tends les jambes en gardant les doigts sous les pieds.",'Ischios, hanches','actif',0],
    ['Fente bras levés',2,'30 s / côté',30,5,"Grande fente, genou arrière au sol, bras tendus au-dessus de la tête. Serre les fessiers et avance le bassin.",'Psoas, flancs','actif',1],
    ['Table inversée',1,'45 s',45,0,"Assis, mains derrière toi. Monte le bassin en serrant les fessiers, redescends lentement.",'Épaules, fessiers','actif',0],
    ['Ouverture thoracique',2,'30 s / côté',30,5,"À quatre pattes, une main derrière la tête. Ouvre le coude vers le plafond en suivant du regard, puis referme.",'Dos, épaules','actif',1]]},
};
/* v4.5 : demo de chaque mouvement (pages video de kines : Physitrack, The Prehab Guys, Rehab Hero ;
   recherche YouTube quand aucune page n'a ete trouvee) + videos perso stockees en local (IndexedDB, jamais envoyees). */
const PT='https://us.physitrack.com/home-exercise-video/', YT='https://www.youtube.com/results?search_query=';
const MOB_LINK = {
  'Mollet au mur':[PT+'calf-stretch-%2528gastrocnemius%2529','Physitrack'],
  'Fessier en « 4 » contre le mur':[PT+'piriformis-stretch-against-wall','Physitrack'],
  'Fente genou au sol':['https://au.physitrack.com/home-exercise-video/hip-flexor-stretch','Physitrack'],
  'Ischios assis, une jambe pliée':[PT+'seated-hurdler-stretch','Physitrack'],
  'Écart assis':['https://ca.physitrack.com/home-exercise-video/pancake-splits','Physitrack'],
  'Squat profond actif':[PT+'squat---deep-squat-with-bodyweight','Physitrack'],
  'Papillon':['https://www.rehabhero.ca/exercise/butterfly-stretch','Rehab Hero'],
  'Fessier assis jambe croisée':['https://library.theprehabguys.com/vimeo-video/seated-piriformis-stretch/','Prehab Guys'],
  'Pigeon':[PT+'sleeping-pigeon-pose','Physitrack'],
  'Chat-vache':['https://ca.physitrack.com/home-exercise-video/cat-camel-pose','Physitrack'],
  "Cobra puis posture de l'enfant":['https://nz.physitrack.com/home-exercise-video/cobra-stretch','Physitrack'],
  'Torsion allongée':[PT+'thoracic-rotation-in-side-lying','Physitrack'],
  'Triceps derrière la tête':['https://library.theprehabguys.com/vimeo-video/triceps-stretch-overhead/','Prehab Guys'],
  'Pectoraux au mur':[PT+'pectoralis-stretching','Physitrack'],
  "Arrière de l'épaule":[PT+'posterior-deltoid-stretch','Physitrack'],
  'Trapèzes':[PT+'upper-trapezius-stretch-in-sitting','Physitrack'],
  'Prière (dorsaux)':[PT+'prayer-stretch','Physitrack'],
  'Auto-enlacement':[YT+'self+hug+upper+back+stretch','YouTube (recherche)'],
  'Cheville en fente':['https://ca.physitrack.com/home-exercise-video/ankle-dorsiflexion-rom-in-half-kneeling','Physitrack'],
  'V debout actif':[YT+'standing+wide+leg+straddle+stretch','YouTube (recherche)'],
  'Squat vers debout':[PT+'squat-to-hamstring-stretch','Physitrack'],
  'Fente bras levés':[PT+'psoas-stretch','Physitrack'],
  'Table inversée':[PT+'reverse-plank-bridge','Physitrack'],
  'Ouverture thoracique':[PT+'thoracic-rotation---kneeling','Physitrack'],
};
/* Videos perso : base IndexedDB "merun_media", magasin "vids", cle = nom du mouvement. */
const VID = { db:null, has:new Set(), url:{} };
function vidDB(){ return VID.db || (VID.db = new Promise((ok,ko)=>{ try{ const r=indexedDB.open('merun_media',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('vids'); r.onsuccess=()=>ok(r.result); r.onerror=()=>ko(r.error); }catch(e){ ko(e); } })); }
async function vidTx(mode, fn){ const db=await vidDB(); return new Promise((ok,ko)=>{ const tx=db.transaction('vids',mode), st=tx.objectStore('vids'); const r=fn(st);
  tx.oncomplete=()=>ok(r&&r.result); tx.onerror=()=>ko(tx.error); tx.onabort=()=>ko(tx.error); }); }
async function vidInit(){ try{ const keys = await vidTx('readonly', st=>st.getAllKeys()); VID.has = new Set(keys||[]); if (V.tab==='ppg') render(); }catch(e){ console.warn('IndexedDB indisponible', e); } }
const exName = (r,i) => ROUT[r].ex[i][0];
window.vidAdd = (r,i) => { const inp=document.createElement('input'); inp.type='file'; inp.accept='video/*'; inp.style.display='none'; document.body.appendChild(inp);
  inp.onchange = async () => { const f=inp.files[0]; inp.remove(); if (!f) return; const k=exName(r,i);
    try{ await vidTx('readwrite', st=>st.put(f,k)); VID.has.add(k); if (VID.url[k]){ URL.revokeObjectURL(VID.url[k]); delete VID.url[k]; }
      try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
      toast(`✓ Vidéo enregistrée sur ce téléphone (${(f.size/1048576).toFixed(1).replace(".",",")} Mo)`); render();
    }catch(e){ console.warn(e); toast(e && e.name==='QuotaExceededError' ? 'Plus de place : vidéo trop lourde' : 'Impossible d\'enregistrer la vidéo'); } };
  inp.click(); };
window.vidOpen = async (r,i) => { const k=exName(r,i);
  try{ if (!VID.url[k]){ const blob = await vidTx('readonly', st=>st.get(k)); if (!blob) { VID.has.delete(k); render(); return toast('Vidéo introuvable'); } VID.url[k]=URL.createObjectURL(blob); }
    openLayer('myvid',{r,i}); }catch(e){ console.warn(e); toast('Lecture impossible'); } };
window.vidDel = async (r,i) => { const k=exName(r,i);
  try{ await vidTx('readwrite', st=>st.delete(k)); VID.has.delete(k); if (VID.url[k]){ URL.revokeObjectURL(VID.url[k]); delete VID.url[k]; } closeLayer(); toast('Vidéo supprimée'); }catch(e){ toast('Suppression impossible'); } };
function MyVid(l){ const e=ROUT[l.r].ex[l.i], k=e[0];
  return `<div class="pad">${head(esc(k),'Ta vidéo · stockée sur ce téléphone uniquement')}
    <video src="${VID.url[k]||''}" controls playsinline loop style="width:100%;max-height:62vh;border-radius:20px;background:#000"></video>
    <div style="font-size:13px;color:var(--body)">${esc(e[5])}</div>
    <div class="row" style="gap:8px"><button class="pill" style="flex:1;background:${C.surface2}" onclick="closeLayer();vidAdd('${l.r}',${l.i})">Remplacer</button>
      <button class="pill" style="flex:1;background:${C.surface2};color:${C.pink}" onclick="vidDel('${l.r}',${l.i})">Supprimer</button></div>
    <p class="muted" style="font-size:11.5px">La vidéo n'est jamais envoyée en ligne. Elle disparaît si tu effaces les données du site dans le navigateur, et elle n'existe pas sur tes autres appareils.</p></div>`; }
function mobBtns(i){ const e=curEx()[i], L=MOB_LINK[e[0]], mine=VID.has.has(e[0]);
  return `<div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap">
    ${L?`<a class="pill" href="${L[0]}" target="_blank" rel="noopener" style="background:var(--surface-2);font-size:12px;padding:7px 12px;text-decoration:none;color:inherit">${ico('play',13)} Voir le mouvement <span class="muted" style="font-size:10.5px">· ${L[1]}</span></a>`:''}
    <button class="pill" style="background:${mine?C.teal:'var(--surface-2)'};color:${mine?C.bg:'inherit'};font-size:12px;padding:7px 12px" onclick="${mine?'vidOpen':'vidAdd'}('${V.routine}',${i})">${mine?ico('play',13)+' Ma vidéo':'+ Ajouter ma vidéo'}</button></div>`; }
const T = { run:false, ex:0, set:1, phase:'ready', remain:0, h:null };
const curEx = () => ROUT[V.routine].ex;
const isMob = () => !!ROUT[V.routine].mob;
function PPG(){
  const ex = curEx(), mob = isMob();
  const list = Object.entries(ROUT).filter(([k,r]) => !!r.mob === mob);
  const tot = ex.reduce((a,e)=>a+e[1]*e[3]+(e[1]-1)*e[4],0);
  return `<div class="pad">
    <div class="seg teal">${[['renfo','Renfo','P1'],['mob','Mobilité','M1']].map(([k,l,def])=>`<button class="${(k==='mob')===mob?'on':''}" onclick="setRoutine('${(k==='mob')===mob?V.routine:def}')">${l}</button>`).join('')}</div>
    <div><div class="anton h1">${mob?'Mobilité':'Renfo'}</div><div class="muted" style="font-size:12.5px;margin-top:5px">${ROUT[V.routine].sub}${mob?'':" · durées d'effort indicatives"}</div></div>
    <div class="seg" style="flex-wrap:wrap">${list.map(([k,r])=>`<button class="${V.routine===k?'on':''}" onclick="setRoutine('${k}')">${r.n}</button>`).join('')}</div>
    <div class="ring" id="ring"><div><div class="mono muted" id="tPhase"></div><div class="anton" style="font-size:66px;line-height:1" id="tTime"></div>
      <div style="font-size:13px;max-width:170px;margin:4px auto 0" id="tEx"></div><div class="mono muted" style="margin-top:6px" id="tSet"></div></div></div>
    <div class="ctl"><button onclick="tReset()" aria-label="Réinitialiser">${ico('reset')}</button><button class="main" id="tPlay" onclick="tToggle()" aria-label="Lecture / pause"></button><button onclick="tSkip()" aria-label="Passer">${ico('skip')}</button></div>
    <div class="bar" style="background:var(--surface-2)"><i id="tProg" style="background:var(--teal);width:0"></i></div>
    ${mob?`<p class="muted" style="font-size:12.5px">${ex.length} mouvements · ${Math.round(tot/60)} min · ${ex.some(e=>e[7]==='passif')?'tenir sans à-coups, respiration lente':'mouvements contrôlés, sans forcer'}</p>`:''}
    <div style="display:flex;flex-direction:column;gap:8px">${ex.map((e,i)=>`<div class="ex" id="ex${i}"><div class="anton" style="font-size:22px;color:var(--${mob?'teal':'orange'});width:22px">${i+1}</div>
      <div style="flex:1"><div style="font-weight:700;font-size:14.5px">${esc(e[0])}</div><div class="muted" style="font-size:12.5px;margin-top:3px">${mob?esc(e[2]):e[1]+' × '+esc(e[2])+(e[4]?' · récup '+e[4]+' s':'')}</div>${e[5]?`<div style="font-size:12.5px;color:var(--body);margin-top:4px">${esc(e[5])}</div>`:''}
      ${mob?`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><span class="badge" style="background:${e[7]==='actif'?'rgba(255,107,53,.16)':'rgba(0,212,184,.14)'};color:${e[7]==='actif'?C.orange:C.teal}">${e[7]==='actif'?'Actif':'Passif'}</span>${e[6].split(', ').map(z=>`<span class="badge" style="background:var(--surface-2);color:var(--body)">${esc(z)}</span>`).join('')}</div>${mobBtns(i)}`:''}</div></div>`).join('')}</div>
    <p class="muted" style="font-size:12px">${mob?`${(S.mobDone||[]).length} séance(s) de mobilité enregistrée(s). Étirements passifs après la course ou le soir ; avant une séance, seulement la routine dynamique.`:S.ppgDone.length+' séance(s) de PPG enregistrée(s).'}</p>
  </div>`;
}
window.setRoutine = k => { V.routine=k; tReset(true); render(); };
function ppgPaint(){
  const ex=curEx(), e=ex[T.ex]; if(!$('#ring')) return;
  const total = e ? (T.phase==='rest'?e[4]:e[3]) : 1, prog = total ? 1 - T.remain/total : 0;
  const col = T.phase==='rest' ? C.teal : isMob() ? C.teal : C.orange;
  $('#ring').style.background = `conic-gradient(${col} ${prog*360}deg, var(--surface-2) 0)`;
  const mb = isMob();
  $('#tPhase').textContent = (mb ? {ready:'Prêt',work:'Tiens',rest:'Change de côté',end:'Terminé'} : {ready:'Prêt',work:'Effort',rest:'Récup',end:'Terminé'})[T.phase];
  $('#tTime').textContent = T.phase==='ready' ? fmtClock(e[3]) : fmtClock(T.remain);
  $('#tEx').textContent = e ? e[0] : '';
  $('#tSet').textContent = !e ? '' : mb ? (e[8] ? `Côté ${T.set}/2` : '') : `Série ${T.set}/${e[1]}`;
  $('#tPlay').innerHTML = ico(T.run?'pause':'play',28); $('#tPlay').style.background = T.run ? C.text : C.orange;
  const doneSets = ex.slice(0,T.ex).reduce((a,x)=>a+x[1],0)+(T.set-1), allSets = ex.reduce((a,x)=>a+x[1],0);
  $('#tProg').style.width = (T.phase==='end'?100:doneSets/allSets*100)+'%';
  ex.forEach((_,i)=>{ const el=$('#ex'+i); el.classList.toggle('cur',i===T.ex&&T.phase!=='end'); el.classList.toggle('past',i<T.ex||T.phase==='end'); });
}
const fmtClock = s => Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
let actx=null; function beep(f=880,d=.15){ if(!S.beeps) return; try{ actx=actx||new (window.AudioContext||window.webkitAudioContext)(); const o=actx.createOscillator(), g=actx.createGain(); o.frequency.value=f; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(.25,actx.currentTime); o.start(); o.stop(actx.currentTime+d);}catch(e){} }
function tNext(){
  const ex=curEx(), e=ex[T.ex];
  if (T.phase==='work' && e[4] && !(T.set===e[1] && T.ex===ex.length-1)){ T.phase='rest'; T.remain=e[4]; beep(660); return; }
  if (T.set < e[1]){ T.set++; } else if (T.ex < ex.length-1){ T.ex++; T.set=1; } else { T.phase='end'; T.run=false; clearInterval(T.h); beep(660,.12); setTimeout(()=>beep(1100,.3),220);
    const t=todayIso(); if (isMob()){ S.mobDone = S.mobDone||[]; S.mobDone.push(t+'|'+V.routine); save(); toast('✓ Mobilité terminée'); return; }
    if(!S.ppgDone.includes(t)) S.ppgDone.push(t); save(); toast('✓ PPG terminée, bravo'); return; }
  T.phase='work'; T.remain=curEx()[T.ex][3]; beep(880);
}
window.tToggle = () => { if (T.phase==='end') tReset(true); T.run=!T.run; if (T.run){ if (T.phase==='ready'){ T.phase='work'; T.remain=curEx()[T.ex][3]; beep(880); }
  clearInterval(T.h); T.h=setInterval(()=>{ T.remain--; if (T.remain<=0) tNext(); ppgPaint(); },1000); } else clearInterval(T.h); ppgPaint(); };
window.tSkip = () => { if (T.phase==='ready'){ T.phase='work'; T.remain=curEx()[T.ex][3]; } tNext(); ppgPaint(); };
window.tReset = (silent) => { clearInterval(T.h); Object.assign(T,{run:false,ex:0,set:1,phase:'ready',remain:0}); if(silent!==true) ppgPaint(); };
/* ---------------- Objectif ---------------- */
const RACE_DATE = '2027-04-04', PLAN_START = PLAN[0].start;   /* chronos comptes depuis le 5 oct. (pre-saison incluse) */
const head = (t,sub='') => `<div class="row"><button class="back" onclick="closeLayer()" aria-label="Retour">${ico('back')}</button><div style="min-width:0"><div class="anton" style="font-size:28px;line-height:1.05">${t}</div>${sub?`<div class="muted" style="font-size:12px;margin-top:3px">${sub}</div>`:''}</div></div>`;
function regularity(){ const t=todayIso(); const passed=ALL.filter(s=>s.date<t && s.date>=OFF_START); const done=passed.filter(isDone).length;
  return {done, passed:passed.length, pct: passed.length ? Math.round(done/passed.length*100) : null}; }
function volumeAvg(n=4){ const t=todayIso(); const ws = OFF.filter(w => weekEnd(w) < t).slice(-n);
  if (!ws.length) return {avg:null, n:0}; return {avg: ws.reduce((a,w)=>a+realWeek(w).km,0)/ws.length, n:ws.length}; }
/* Temps actuel = meilleure projection Riegel parmi les chronos realises depuis le debut du plan */
function curProj(){ const c = S.perfs.filter(p => p.date >= PLAN_START).map(p => ({...p, proj:riegel(p.sec,p.km)})).sort((a,b)=>a.proj-b.proj)[0]; return c || null; }
function Goal(){
  const g=S.goal, w=curWeek(), reg=regularity(), vol=volumeAvg(), cp=curProj();
  const span = (d8(RACE_DATE)-d8(OFF_START))/864e5, prog = Math.max(0, Math.min(1, (d8(todayIso())-d8(OFF_START))/864e5/span));
  const blocNow = BLOC[w.bloc];
  const stat = (l,v) => `<div><div class="muted" style="font-size:11px">${l}</div><div class="anton" style="font-size:22px">${v}</div></div>`;
  return `<div class="pad">
    <div><div class="anton h1">Mon objectif</div><div class="muted" style="font-size:12.5px;margin-top:5px">${esc(g.name)} · J-${Math.max(0,daysTo(RACE_DATE))}</div></div>
    <div style="position:relative;height:34px;margin:4px 6px 0"><div style="position:absolute;left:0;right:0;top:9px;height:3px;background:${C.surface2};border-radius:2px"></div>
      <div style="position:absolute;left:0;width:${prog*100}%;top:9px;height:3px;background:${C.teal};border-radius:2px"></div>
      <div style="position:absolute;left:calc(${prog*100}% - 7px);top:3px;width:14px;height:14px;border-radius:50%;background:${C.pink};border:3px solid ${C.text}"></div>
      ${prog>.2?`<div class="muted" style="position:absolute;left:0;top:20px;font-size:11px">${shortDate(OFF_START)}</div>`:''}<div style="position:absolute;left:clamp(0px, calc(${prog*100}% - 34px), calc(100% - 68px));top:20px;font-size:11px;width:68px;text-align:center">Aujourd'hui</div>${prog<.8?'<div class="muted" style="position:absolute;right:0;top:20px;font-size:11px">4 avr.</div>':''}</div>
    <div class="goalcard">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px 12px;flex-wrap:wrap">
        <div class="row" style="gap:12px;align-items:center;min-width:0">
          <div style="background:${C.text};color:${C.bg};border-radius:14px;padding:6px 10px;text-align:center;flex:none"><div class="anton" style="font-size:24px;line-height:1">4</div><div class="mono" style="font-size:9px;letter-spacing:.08em">avr.</div></div>
          <div><div class="anton" style="font-size:36px;line-height:1">MARATHON</div><div class="muted" style="font-size:12px;margin-top:3px">${esc(g.name)}</div></div></div>
        <span class="badge" style="background:${C.bg};color:${C.teal};flex:none">● En préparation</span></div>
      <svg viewBox="0 0 412 250" style="display:block;width:100%;height:auto;aspect-ratio:412/250;margin:8px 0 4px" role="img" aria-label="Piste de préparation : une case par semaine">${hexTrailSVG({x:12,y:8,w:388,h:234},{w:412,h:250},'gc')}</svg>
      <div style="background:rgba(10,14,20,.82);border-radius:18px;padding:12px 14px">
        <div class="grid3">${stat('Distance','42,2 km')}${stat('Temps cible',fmtHM(g.target))}${stat('Semaine',w.pre?'Pré':wNo(w)+'/'+NW)}</div>
        <div class="grid3" style="margin-top:6px">${stat('Régularité',reg.pct==null?'-':reg.pct+' %')}${stat('Volume moy.',vol.avg==null?'-':fmtN(vol.avg)+' km')}${stat('Parcouru',Math.round(doneKm())+' km')}</div>
        <button class="pill" style="background:${C.text};color:${C.bg};width:100%;margin-top:12px;padding:12px" onclick="openLayer('params')">Paramètres d'entraînement</button></div>
    </div>

    <div class="card"><div style="font-weight:800">Objectif de temps</div>
      <div class="row" style="justify-content:space-between;align-items:flex-end;margin-top:12px">
        <div><div class="muted" style="font-size:11px">Départ</div><div class="anton" style="font-size:22px">${fmtHM(g.startSec)}</div></div>
        <div style="text-align:center"><div class="mono muted" style="font-size:10px">Temps actuel</div><div class="anton" style="font-size:44px;line-height:1;color:${cp?C.teal:C.muted}">${cp?fmtHM(cp.proj):'?'}</div>
          ${cp?`<span class="badge" style="background:${cp.proj<=g.target?C.teal:C.surface2};color:${cp.proj<=g.target?C.bg:C.text}">${cp.proj<=g.target?'Objectif atteint':'Encore '+Math.ceil((cp.proj-g.target)/60)+' min'}</span>`:''}</div>
        <div style="text-align:right"><div class="muted" style="font-size:11px">Cible</div><div class="anton" style="font-size:22px">${fmtHM(g.target)}</div></div></div>
      <p class="muted" style="font-size:12px;margin-top:12px">${cp?`Projection Riegel depuis ton ${esc(cp.l)} en ${fmtHMS(cp.sec)} (${shortDate(cp.date)}).`:"Aucun chrono depuis le début du plan. Valide ton test 5 km avec ton chrono pour obtenir ta projection."} Départ : ton marathon du 26 avr. 2026.</p>
      <button class="pill" style="background:${C.surface2};width:100%;margin-top:12px;padding:12px" onclick="openLayer('perfs')">Mes chronos de référence</button></div>

    <div class="card"><div style="font-weight:800">Régularité</div><div class="muted" style="font-size:12.5px;margin-top:2px">C'est la constance qui paie. Chaque séance construit la suivante.</div>
      <div class="row" style="gap:10px;margin-top:10px"><div class="anton" style="font-size:36px">${reg.pct==null?'-':reg.pct+' %'}</div><span class="badge" style="background:${C.surface2};color:${C.text}">${reg.done} séance${reg.done>1?'s':''} sur ${reg.passed}</span></div>
      ${regGrid()}
      <div class="row muted" style="gap:14px;font-size:11px;margin-top:8px"><span class="row" style="gap:5px"><i class="lg" style="background:${C.teal}"></i>Effectuées</span><span class="row" style="gap:5px"><i class="lg" style="background:rgba(255,77,148,.55)"></i>Manquées</span><span class="row" style="gap:5px"><i class="lg" style="background:${C.surface2}"></i>À venir</span></div></div>

    <div class="card"><div style="font-weight:800">Volume</div><div class="muted" style="font-size:12.5px;margin-top:2px">Ton endurance se construit semaine après semaine : réalisé contre planifié.</div>
      <div class="row" style="gap:6px;margin-top:10px;align-items:baseline"><div class="anton" style="font-size:36px">${vol.avg==null?'-':fmtN(vol.avg)}</div><span class="muted" style="font-size:12px">km/sem. (${vol.n} dernière${vol.n>1?'s':''} semaine${vol.n>1?'s':''})</span></div>
      ${volChart()}
      <div class="row muted" style="gap:14px;font-size:11px;margin-top:8px"><span class="row" style="gap:5px"><i class="lg" style="background:${C.orange}"></i>Réalisé</span><span class="row" style="gap:5px"><i class="lg" style="background:${C.muted}"></i>Planifié</span></div></div>

    <button class="card" style="text-align:left" onclick="V.cyc='${w.bloc}';openLayer('cycles')"><div class="row" style="justify-content:space-between"><div style="font-weight:800">Cycles</div>${ico('next',18)}</div>
      <div class="muted" style="font-size:12.5px;margin-top:2px">Quatre blocs ciblés pour développer tes qualités une par une.</div>
      ${cycArc(w.bloc, 300)}<div class="mono muted" style="text-align:center">Cycle en cours</div><div class="anton" style="font-size:24px;text-align:center;color:${blocNow.c}">${blocNow.n}</div></button>

    <div class="card"><div style="font-weight:800">Étapes</div>
      ${[['10 km','29 nov.',47*60,10,'S08_Dim_race'],['Semi de Paris','7 mars',106*60,21.0975,'S22_Dim_race']].map(([l,d,tg,km,code])=>{ const b=S.perfs.filter(p=>Math.abs(p.km-km)<.01).sort((a,c)=>a.sec-c.sec)[0];
        return `<div class="field"><div><div style="font-weight:700">${l} · ${d}</div><div class="muted" style="font-size:12px">${b?'Meilleur mesuré '+fmtHMS(b.sec)+' ('+shortDate(b.date)+' '+d8(b.date).getFullYear()+')':'Pas encore de chrono'}</div></div>
        <div style="text-align:right"><div class="mono muted" style="font-size:10px">Cible</div><div class="anton" style="font-size:22px">${fmtHMS(tg)}</div></div></div>`; }).join('')}
      <p class="muted" style="font-size:11.5px;margin-top:8px">Cibles du classeur v5 (pronostics).</p></div>
  </div>`;
}
function regGrid(){
  const t=todayIso(), cw=curWeek().num, cs=13, gap=2, rows=4, W=NW*(cs+gap);
  let cells='';
  OFF.forEach((w,i)=>{ for (let r=0;r<rows;r++){ const s=w.sessions[r]; const x=i*(cs+gap), y=(rows-1-r)*(cs+gap);
    const fill = !s ? 'transparent' : isDone(s) ? C.teal : s.date < t ? 'rgba(255,77,148,.55)' : C.surface2;
    cells += `<rect x="${x}" y="${y}" width="${cs}" height="${cs}" rx="2" fill="${fill}"${s?'':` stroke="${C.surface2}" stroke-dasharray="2 2"`}/>`; }
    if (w.num===cw) cells += `<rect x="${i*(cs+gap)-1}" y="-1" width="${cs+2}" height="${rows*(cs+gap)}" rx="3" fill="none" stroke="${C.text}" stroke-width="1.2"/>`; });
  const lbl = OFF.filter((w,i)=>i%4===0).map(w=>`<text x="${(w.num-PRE-1)*(cs+gap)+cs/2}" y="${rows*(cs+gap)+12}" text-anchor="middle" fill="${C.muted}" style="font:600 9px Inter">S${w.num-PRE}</text>`).join('');
  return `<svg viewBox="-2 -2 ${W+4} ${rows*(cs+gap)+18}" style="width:100%;margin-top:12px" role="img" aria-label="Grille de régularité par semaine">${cells}${lbl}</svg>`;
}
function volChart(){
  const W=340, H=150, pl=26, pb=18, cw=curWeek().num, max=Math.max(70, ...OFF.map(w=>Math.max(w.km, realWeek(w).km)));
  const x = i => pl + i*(W-pl-6)/(NW-1), y = v => H-pb - v/max*(H-pb-8);
  const plan = OFF.map((w,i)=>`${x(i).toFixed(1)},${y(w.km).toFixed(1)}`).join(' ');
  const done = OFF.filter(w=>w.num<=cw).map((w,i)=>[x(i), y(realWeek(w).km)]);
  const grid = [20,40,60].filter(v=>v<max).map(v=>`<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${C.surface2}"/><text x="${pl-4}" y="${y(v)+3}" text-anchor="end" fill="${C.muted}" style="font:600 9px Inter">${v}</text>`).join('');
  const xl = [1,6,12,18,23].map(n=>`<text x="${x(n-1)}" y="${H-4}" text-anchor="middle" fill="${C.muted}" style="font:600 9px Inter">S${n}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin-top:10px" role="img" aria-label="Volume hebdomadaire réalisé et planifié">${grid}${xl}
    <polyline points="${plan}" fill="none" stroke="${C.muted}" stroke-width="1.6" stroke-dasharray="4 3"/>
    ${done.length>1?`<polyline points="${done.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${C.orange}" stroke-width="2.4" stroke-linejoin="round"/>`:''}
    ${done.map(p=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" fill="${C.orange}"/>`).join('')}</svg>`;
}
/* Arc des 4 blocs, proportionnel au nombre de semaines */
function cycArc(sel, width=300){
  const keys = Object.keys(BLOC), n = keys.map(k=>OFF.filter(w=>w.bloc===k).length), tot = n.reduce((a,b)=>a+b,0);
  const cur = curWeek().bloc, ci = keys.indexOf(cur), cx=150, cy=140, R=118, r=78, gapA=.035;
  const pt = (rad, a) => [cx + rad*Math.cos(a), cy - rad*Math.sin(a)];
  let a0 = Math.PI, out = '';
  keys.forEach((k,i) => { const span = Math.PI*n[i]/tot; const a1 = a0 - gapA/2, a2 = a0 - span + gapA/2;
    const [x1,y1]=pt(R,a1),[x2,y2]=pt(R,a2),[x3,y3]=pt(r,a2),[x4,y4]=pt(r,a1);
    const col = BLOC[k].c, st = i<ci ? `fill="${col}" fill-opacity=".5"` : i===ci ? `fill="${col}"` : `fill="none" stroke="${col}" stroke-width="2"`;
    out += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L${x3.toFixed(1)} ${y3.toFixed(1)} A${r} ${r} 0 0 0 ${x4.toFixed(1)} ${y4.toFixed(1)}Z" ${st}${k===sel?` stroke="${C.text}" stroke-width="3"`:''}/>`;
    const [lx,ly] = pt((R+r)/2, a0 - span/2); out += `<text x="${lx.toFixed(1)}" y="${(ly+6).toFixed(1)}" text-anchor="middle" style="font:400 18px Anton" fill="${i<=ci?C.bg:col}">${k}</text>`;
    a0 -= span; });
  return `<svg viewBox="0 0 300 150" style="width:100%;max-width:${width}px;display:block;margin:10px auto 0" role="img" aria-label="Cycles : bloc ${cur} en cours">${out}</svg>`;
}
function Cycles(){
  const keys = Object.keys(BLOC), k = V.cyc || curWeek().bloc, i = keys.indexOf(k), b = BLOC[k];
  const ws = OFF.filter(w=>w.bloc===k), ss = ws.flatMap(w=>w.sessions);
  const dKm = ws.reduce((a,w)=>a+realWeek(w).km,0), pKm = ws.reduce((a,w)=>a+w.km,0);
  return `<div class="pad">${head('Cycles')}
    <div class="card"><div class="row" style="justify-content:space-between">
      <button class="back" style="background:${C.surface2}" onclick="V.cyc='${keys[Math.max(0,i-1)]}';render()" aria-label="Cycle précédent" ${i===0?'disabled style="opacity:.3"':''}>${ico('back')}</button>
      <div style="font-weight:800">Cycle ${i+1} <span class="muted">sur ${keys.length}</span></div>
      <button class="back" style="background:${C.surface2}" onclick="V.cyc='${keys[Math.min(keys.length-1,i+1)]}';render()" aria-label="Cycle suivant" ${i===keys.length-1?'disabled style="opacity:.3"':''}>${ico('next')}</button></div>
      ${cycArc(k)}
      <div class="anton" style="font-size:30px;margin-top:6px;color:${b.c}">${b.n}</div>
      <div class="muted" style="font-size:12px">Semaines ${wNo(ws[0])} à ${wNo(ws[ws.length-1])} · ${shortDate(ws[0].start)} → ${shortDate(weekEnd(ws[ws.length-1]))}</div>
      <p style="color:var(--body);font-size:13.5px;margin-top:8px">${b.d}</p>
      <div class="grid2" style="margin-top:12px;background:${C.bg};border-radius:16px;padding:12px">
        <div><div class="mono muted" style="font-size:10px">Régularité</div><div><span class="anton" style="font-size:24px">${ss.filter(isDone).length}</span><span class="muted"> /${ss.length} séances</span></div></div>
        <div><div class="mono muted" style="font-size:10px">Distance</div><div><span class="anton" style="font-size:24px">${fmtN(dKm)}</span><span class="muted"> /${fmtN(pKm)} km</span></div></div></div></div>
    ${ws.map(w=>{ const open = V.openW===w.num; return `<div class="card" style="padding:0">
      <button class="row" style="width:100%;justify-content:space-between;padding:16px" onclick="V.openW=${open?'null':w.num};render()" aria-expanded="${open}">
        <span style="text-align:left"><span style="font-weight:800;display:block">Semaine ${w.num}</span><span class="muted" style="font-size:12px">${esc(w.title)} · ${w.km} km</span></span>${ico(open?'back':'next',18)}</button>
      ${open?`<div style="padding:0 16px 14px;display:flex;flex-direction:column;gap:2px">${w.sessions.length?w.sessions.map(s=>`<button class="field" style="width:100%;text-align:left" onclick="openS('${s.code}')">
        <span style="min-width:0"><span style="font-weight:700;display:block">${isDone(s)?'✓ ':''}${esc(s.title)}</span><span class="muted" style="font-size:12px">${DOW[s.day]} ${shortDate(s.date)} · ${fmtDur(sessDur(s))} · ${fmtN(kmOf(s))} km</span></span>${bolts(diffOf(s))}</button>`).join(''):'<p class="muted">Repos.</p>'}</div>`:''}</div>`; }).join('')}
  </div>`;
}
function Params(){
  const g = S.goal;
  return `<div class="pad">${head("Paramètres d'entraînement")}
    <div class="card">
      <div class="field"><label for="gName">Nom de l'objectif</label><input id="gName" style="width:170px" value="${esc(g.name)}"></div>
      <div class="field"><label for="gTarget">Temps cible (h:mm)</label><input id="gTarget" value="${fmtHM(g.target).replace('h',':')}"></div>
      <div class="field"><label for="gStart">Temps de départ (h:mm:ss)</label><input id="gStart" value="${fmtHMS(g.startSec)}"></div>
      <div class="field"><span>Date de l'objectif</span><span class="muted">04.04.27 (fixée par le plan)</span></div>
      <div class="field" style="border:0"><span>Séances par semaine</span><span class="muted">4 (fixé par le plan)</span></div></div>
    <p class="muted" style="font-size:12px">Le temps cible sert aux projections et au profil. Les allures des séances restent celles du plan (VC ${fmtN(S.vc)} km/h). Le plan prévoit 3h30 si le semi le valide.</p>
    <button class="pill" style="background:${C.text};color:${C.bg};padding:16px" onclick="saveParams()">Enregistrer</button></div>`;
}
window.saveParams = () => { const t=parseDur($('#gTarget').value.replace('h',':')+':00'), st=parseDur($('#gStart').value);
  if (!(t>2*3600 && t<6*3600)) return toast('Temps cible invalide'); if (!(st>2*3600 && st<7*3600)) return toast('Temps de départ invalide');
  S.goal = {...S.goal, name:$('#gName').value.trim()||'Marathon de Paris', target:t, startSec:st}; save(); closeLayer(); toast('✓ Objectif enregistré'); };
function Perfs(){
  const list = [...S.perfs].sort((a,b)=>b.date.localeCompare(a.date));
  return `<div class="pad">${head('Mes chronos', 'Base des projections et du profil')}
    ${list.map(p=>`<div class="card row"><div style="flex:1;min-width:0"><div style="font-weight:800">${esc(p.l)} · ${fmtHMS(p.sec)}</div>
      <div class="muted" style="font-size:12px">${shortDate(p.date)} ${d8(p.date).getFullYear()} · ${esc(p.src)} · marathon projeté ${fmtHM(riegel(p.sec,p.km))}</div></div>
      <button class="back" style="background:${C.surface2}" onclick="delPerf('${p.id}')" aria-label="Supprimer ce chrono">${ico('close',18)}</button></div>`).join('')}
    <div class="card"><div style="font-weight:800">Ajouter un chrono</div>
      <div class="field"><label for="pDate">Date</label><input id="pDate" type="date" style="width:150px" value="${todayIso()}"></div>
      <div class="field"><label for="pKm">Distance</label><select id="pKm"><option value="5">5 km</option><option value="10">10 km</option><option value="21.0975">Semi</option><option value="42.195">Marathon</option></select></div>
      <div class="field"><label for="pT">Temps (h:mm:ss ou m:ss)</label><input id="pT" placeholder="23:45"></div>
      <div class="field" style="border:0"><label for="pSrc">Contexte</label><select id="pSrc"><option>course</option><option>test</option><option>segment d'entraînement</option></select></div>
      <button class="pill" style="background:${C.teal};color:${C.bg};width:100%;margin-top:10px" onclick="addPerf()">Ajouter</button></div>
    <p class="muted" style="font-size:11.5px">Projection : formule de Riegel, exposant 1,06 (Riegel, American Scientist, 1981). Elle suppose une préparation adaptée à la distance visée : sur marathon, elle est souvent optimiste quand le volume manque.</p></div>`;
}
window.addPerf = () => { const km=+$('#pKm').value, t=$('#pT').value.split(':').length===2 ? parseDur('0:'+$('#pT').value) : parseDur($('#pT').value), d=$('#pDate').value;
  if (!(t>0) || !d) return toast('Date ou temps invalide');
  S.perfs.push({id:'u'+Date.now(), date:d, km, sec:t, l:({5:'5 km',10:'10 km',21.0975:'Semi',42.195:'Marathon'})[km], src:$('#pSrc').value}); save(); render(); toast('✓ Chrono ajouté'); };
window.delPerf = id => { if (!confirm('Supprimer ce chrono ?')) return; S.perfs = S.perfs.filter(p=>p.id!==id); save(); render(); };

/* ---------------- Profil ---------------- */
const ARCH = {
  endurance:['LE RAPIDE À ALLONGER','Priorité : les sorties longues.'],
  vitesse:['LE DIESEL','Priorité : les séances de VMA et de seuil.'],
  volume:['LE MOTEUR SOUS-EXPLOITÉ','Priorité : tenir le volume planifié, en endurance facile.'],
  regularite:["L'INTERMITTENT",'Priorité : ne plus sauter de séance, même raccourcie.'],
  polarisation:['LE TOUJOURS PRESSÉ','Priorité : des footings vraiment lents, sous 150 bpm.'],
  fraicheur:['LE RÉSERVOIR À SEC',"Priorité : récupérer. Le plan s'allège si ça dure."],
};
function profile(){
  const t = todayIso(), T = S.goal.target, age = d => (d8(t)-d8(d))/864e5, ax = [];
  const best = f => S.perfs.filter(f).map(p=>({...p, proj:riegel(p.sec,p.km)})).sort((a,b)=>a.proj-b.proj)[0];
  for (const [id,label,f,txt] of [['endurance','Endurance',p=>p.km>=15,'chrono de 15 km ou plus'],['vitesse','Vitesse',p=>p.km<=10,'chrono de 10 km ou moins']]){
    const b = best(f);
    if (!b){ ax.push({id,label,score:null,raw:'Aucun '+txt,formula:'-',src:'Ajoute un chrono (Objectif › Mes chronos)',w:0}); continue; }
    const fresh = age(b.date) <= 365;
    ax.push({id,label,score:Math.min(100,Math.round(T/b.proj*100)),raw:`${b.l} ${fmtHMS(b.sec)}`,formula:`${fmtHM(T)} cible / ${fmtHM(b.proj)} projeté (Riegel)`,
      src:`${b.src}, ${shortDate(b.date)} ${d8(b.date).getFullYear()}${fresh?'':' : plus de 12 mois, poids réduit'}`,w:fresh?1:.5});
  }
  const ws = OFF.filter(w => weekEnd(w) < t && w.km > 0).slice(-4);
  if (ws.length >= 2){ const r = ws.reduce((a,w)=>a+realWeek(w).km,0), p = ws.reduce((a,w)=>a+w.sessions.reduce((x,s)=>x+kmOf(s),0),0);
    ax.push({id:'volume',label:'Volume',score:Math.min(100,Math.round(r/p*100)),raw:`${fmtN(r/ws.length)} km/sem.`,formula:`${fmtN(r)} km réalisés / ${fmtN(p)} km planifiés (${ws.length} sem.)`,src:'tes données MeRun',w:1}); }
  else { const avg = TOTAL_KM/NW;
    ax.push({id:'volume',label:'Volume',score:Math.min(100,Math.round(BASE.kmWeek/avg*100)),raw:`${BASE.kmWeek} km/sem.`,formula:`${BASE.kmWeek} km / ${fmtN(avg)} km de moyenne du plan`,src:BASE.src+' (pas encore 2 semaines terminées)',w:.5}); }
  const reg = regularity();
  if (reg.passed >= 4) ax.push({id:'regularite',label:'Régularité',score:reg.pct,raw:`${reg.done}/${reg.passed} séances`,formula:'séances validées / séances passées du plan',src:'tes données MeRun',w:1});
  else ax.push({id:'regularite',label:'Régularité',score:Math.round(BASE.wAct/BASE.wTot*100),raw:`${BASE.wAct}/${BASE.wTot} sem. actives`,formula:'semaines avec course / semaines',src:BASE.src,w:.5});
  const zs = S.acts.filter(a => a.zones && age(a.date) <= 28), zt = zs.reduce((a,x)=>a+x.zones.reduce((p,q)=>p+q,0),0);
  if (zt >= 3600){ const z = zs.reduce((a,x)=>a+x.zones[0]+x.zones[1],0)/zt*100;
    ax.push({id:'polarisation',label:'Polarisation',score:Math.min(100,Math.round(z/80*100)),raw:`${Math.round(z)} % en Z1-Z2`,formula:`${Math.round(z)} % / 80 % visés`,src:`FC de tes .fit, 28 derniers jours (${fmtHM(zt)})`,w:1}); }
  else ax.push({id:'polarisation',label:'Polarisation',score:Math.round(BASE.z12/80*100),raw:`${BASE.z12} % en Z1-Z2`,formula:`${BASE.z12} % / 80 % visés`,src:BASE.src+' (importe des .fit pour l’actualiser)',w:.5});
  const ms = Object.values(S.fb).filter(f => f.mood && age(f.date) <= 7);
  if (ms.length){ const m = ms.reduce((a,f)=>a+f.mood,0)/ms.length;
    ax.push({id:'fraicheur',label:'Fraîcheur',score:Math.round((m-1)/4*100),raw:`mood ${fmtN(m)}/5`,formula:`(mood moyen - 1) / 4, sur ${ms.length} séance${ms.length>1?'s':''}`,src:'tes retours des 7 derniers jours',w:1}); }
  else ax.push({id:'fraicheur',label:'Fraîcheur',score:null,raw:'Pas de mood récent',formula:'(mood moyen - 1) / 4',src:'Valide une séance pour remplir cet axe',w:0});
  const conf = Math.round(ax.reduce((a,x)=>a+x.w,0)/ax.length*100);
  const scored = ax.filter(x=>x.score!=null);
  const strong = scored.reduce((a,x)=>x.score>a.score?x:a, scored[0]), weak = scored.reduce((a,x)=>x.score<a.score?x:a, scored[0]);
  return {ax, conf, strong, weak};
}
const scCol = s => s==null ? C.muted : s>=80 ? C.teal : s>=50 ? C.amber : C.orange;
function radar(ax){
  const cx=150, cy=150, R=100, n=ax.length, ang = i => (-90 + 360/n*i)*Math.PI/180, pt = (i,v) => [cx+R*v*Math.cos(ang(i)), cy+R*v*Math.sin(ang(i))];
  const ring = v => ax.map((_,i)=>pt(i,v).map(x=>x.toFixed(1)).join(',')).join(' ');
  const poly = ax.map((a,i)=>pt(i,(a.score||0)/100).map(x=>x.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="-40 -6 380 316" style="width:100%;max-width:360px;display:block;margin:0 auto" role="img" aria-label="Radar : ${ax.map(a=>a.label+' '+(a.score??'non mesuré')).join(', ')}">
    ${[1,2/3,1/3].map(v=>`<polygon points="${ring(v)}" fill="none" stroke="${C.surface2}" stroke-width="1.2"/>`).join('')}
    ${ax.map((a,i)=>{ const [x,y]=pt(i,1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.surface2}"${a.score==null?' stroke-dasharray="4 4"':''}/>`; }).join('')}
    <polygon points="${poly}" fill="${C.teal}" fill-opacity=".22" stroke="${C.teal}" stroke-width="2.2" stroke-linejoin="round"/>
    ${ax.map((a,i)=>{ if(a.score==null) return ''; const [x,y]=pt(i,a.score/100); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${scCol(a.score)}"/>`; }).join('')}
    ${ax.map((a,i)=>{ const [x,y]=pt(i,1.2); const anc = Math.abs(x-cx)<5?'middle':x>cx?'start':'end'; return `<text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" text-anchor="${anc}" fill="${a.score==null?C.muted:C.body}" style="font:600 12.5px Inter">${a.label}${a.score==null?' ?':''}</text>`; }).join('')}
  </svg>`;
}
function Profil(){
  const P = profile(), sel = P.ax.find(a=>a.id===V.ax) || P.weak || P.ax[0], arch = ARCH[P.weak.id];
  return `<div class="pad">
    <div><div class="anton h1">Profil</div><div class="muted" style="font-size:12.5px;margin-top:5px">${esc(S.name)} · 6 axes calculés pour un marathon en ${fmtHM(S.goal.target)}</div></div>
    <div class="card"><div class="mono muted">Ton profil marathon</div>
      <div class="anton" style="font-size:34px;line-height:1.02;margin-top:8px">${arch[0]}</div>
      <p style="color:var(--body);font-size:13.5px;margin-top:8px">Au-dessus : ${P.strong.label.toLowerCase()} (${P.strong.score}). En dessous : ${P.weak.label.toLowerCase()} (${P.weak.score}). ${arch[1]}</p>
      <div class="grid2" style="margin-top:12px"><div><div class="mono muted" style="font-size:10px">Point fort</div><div class="anton" style="font-size:22px;color:${C.teal}">${P.strong.label.toUpperCase()}</div></div>
        <div><div class="mono muted" style="font-size:10px">En retrait</div><div class="anton" style="font-size:22px;color:${C.orange}">${P.weak.label.toUpperCase()}</div></div></div></div>
    <div class="card"><div class="row" style="justify-content:space-between"><div class="mono muted">Confiance du profil</div><div class="anton" style="font-size:24px">${P.conf} %</div></div>
      <div class="bar" style="background:${C.surface2};margin-top:8px"><i style="width:${P.conf}%;background:${C.teal}"></i></div>
      <p class="muted" style="font-size:12px;margin-top:8px">Part des axes mesurés avec des données récentes. Un axe repris de l'export Strava ou d'un chrono de plus de 12 mois compte pour moitié.</p></div>
    <div class="card" style="padding:14px 6px 6px">${radar(P.ax)}</div>
    <div class="grid2">${P.ax.map(a=>`<button class="axc ${a.id===sel.id?'on':''}" style="${a.id===sel.id?'border-color:'+scCol(a.score):''}" onclick="V.ax='${a.id}';render()" aria-pressed="${a.id===sel.id}">
      <i style="display:block;width:22px;height:3px;border-radius:2px;background:${scCol(a.score)}"></i><span style="font-weight:700;font-size:13px;color:var(--body);margin-top:6px;display:block">${a.label}</span>
      <span class="anton" style="font-size:32px;line-height:1.1">${a.score==null?'--':a.score}</span><span class="muted" style="font-size:11px"> /100</span>
      <span class="muted" style="display:block;font-size:11.5px">${esc(a.raw)}</span>${a.w<1&&a.w>0?`<span class="badge" style="background:${C.surface2};color:${C.muted};margin-top:6px">référence</span>`:''}</button>`).join('')}</div>
    <div class="card" style="border:1.5px solid ${scCol(sel.score)}"><div class="row" style="justify-content:space-between"><div class="anton" style="font-size:22px">${sel.label}</div>
      <span class="mono" style="color:${scCol(sel.score)}">${sel.score==null?'Non mesuré':sel.score>=80?'Au niveau':sel.score>=50?'À travailler':'Priorité'}</span></div>
      <p style="font-size:13px;color:var(--body);margin-top:8px">Calcul : ${esc(sel.formula)}</p><p class="muted" style="font-size:12px;margin-top:4px">Source : ${esc(sel.src)}</p></div>
    <button class="pill" style="background:${C.teal};color:${C.bg};padding:16px" onclick="openLayer('share',{week:curWeek().num})">${ico('share',18)} Partager ma semaine</button>
    <p class="muted" style="font-size:11px;text-align:center">Méthodes et sources : Plus › Méthodes</p>
  </div>`;
}

/* Piste "L'ascension" : une case hexagonale par semaine du plan, de S1 (en bas a gauche) a S26 (en haut).
   Couleur = ce qui a ete couru : faite (>= 50 % du volume prevu), partielle, manquee, repos, en cours, a venir. */
const HX_MOVES = ['R','R','R','R','R','UL','L','L','L','L','L','UR','R','R','R','R','UL','L','L','L','L','L'];   /* 23 semaines officielles */
const HX_W = Math.sqrt(3), HX_D = {R:[HX_W,0], L:[-HX_W,0], UR:[HX_W/2,-1.5], UL:[-HX_W/2,-1.5]};
function weekState(w){
  const t = todayIso();
  if (w.num === curWeek().num && t >= w.start) return 'cur';
  if (weekEnd(w) >= t) return 'fut';
  if (!w.km) return 'rest';
  const r = realWeek(w).km / w.km;
  return r >= .5 ? 'done' : r > 0 ? 'part' : 'miss';
}
const HX_COL = {done:[C.teal,C.teal,C.bg], part:['rgba(0,212,184,.32)',C.teal,C.text], miss:['rgba(255,77,148,.2)','rgba(255,77,148,.75)',C.pink],
  rest:['#1f2733','#2a3342',C.muted], cur:[C.orange,C.orange,C.bg], fut:['#121821','#2a3342','#7d8696']};
const HX_LABEL = {done:'faite', part:'partielle', miss:'manquée', rest:'repos', cur:'en cours', fut:'à venir'};
function hexLayout(area){
  let p = [0,0]; const pts = [[0,0]]; for (const m of HX_MOVES){ p = [p[0]+HX_D[m][0], p[1]+HX_D[m][1]]; pts.push(p); }
  const race = {}; ALL.filter(s=>s.kind==='race').forEach(s=>{ race[s.week] = s.km>40 ? '42K' : s.km>20 ? 'SEMI' : '10K'; });
  const cs = OFF.map((w,i)=>({w, x:pts[i][0], y:pts[i][1], st:weekState(w), tag:race[w.num]||null}));
  const xs = cs.map(c=>c.x), ys = cs.map(c=>c.y), x0 = Math.min(...xs)-HX_W/2, x1 = Math.max(...xs)+HX_W/2, y0 = Math.min(...ys)-1, y1 = Math.max(...ys)+1;
  const s = Math.min(area.w/(x1-x0), area.h/(y1-y0)), ox = area.x+(area.w-(x1-x0)*s)/2-x0*s, oy = area.y+(area.h-(y1-y0)*s)/2-y0*s;
  return {cs: cs.map(c=>({...c, px:ox+c.x*s, py:oy+c.y*s})), s, ox, oy};
}
const hexPts = (cx,cy,r) => [0,1,2,3,4,5].map(k=>{ const a = Math.PI/180*(60*k-90); return [cx+r*Math.cos(a), cy+r*Math.sin(a)]; });
const ptsStr = a => a.map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');
function hexLattice(L, box, each){
  const s = L.s, r0 = Math.floor(-L.oy/(1.5*s))-1, r1 = Math.ceil((box.h-L.oy)/(1.5*s))+1;
  for (let r=r0; r<=r1; r++){ const y = L.oy+r*1.5*s, off = (((r%2)+2)%2) ? HX_W/2 : 0;
    const c0 = Math.floor(-L.ox/(HX_W*s))-1, c1 = Math.ceil((box.w-L.ox)/(HX_W*s))+1;
    for (let c=c0; c<=c1; c++) each(L.ox+(c*HX_W+off)*s, y); }
}
function hexTrailSVG(area, box, id='hx'){
  const L = hexLayout(area), s = L.s;
  let out = `<defs><filter id="${id}g" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${(s*.28).toFixed(1)}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  hexLattice(L, box, (x,y)=>{ out += `<polygon points="${ptsStr(hexPts(x,y,s*.92))}" fill="none" stroke="#9aa3b2" stroke-opacity=".08"/>`; });
  for (const c of L.cs){ const [f,st,tc] = HX_COL[c.st], glow = c.st==='done'||c.st==='cur';
    out += `<g${glow?` filter="url(#${id}g)"`:''}${c.st==='cur'?' class="hxcur"':''}><polygon points="${ptsStr(hexPts(c.px,c.py,s*.88))}" fill="${f}" stroke="${c.tag?C.amber:st}" stroke-width="${c.tag?3:1.5}"/></g>`;
    out += `<text x="${c.px.toFixed(1)}" y="${(c.py+s*.2).toFixed(1)}" text-anchor="middle" fill="${c.tag&&c.st==='fut'?C.amber:tc}" style="font:400 ${(s*(c.tag?.48:.56)).toFixed(1)}px Anton">${c.tag||wNo(c.w)}</text>`; }
  return out;
}
function drawHexTrail(g, area, box){
  const L = hexLayout(area), s = L.s, poly = (pts) => { g.beginPath(); pts.forEach(([x,y],i)=> i?g.lineTo(x,y):g.moveTo(x,y)); g.closePath(); };
  g.lineWidth = 2; g.strokeStyle = 'rgba(154,163,178,.08)'; hexLattice(L, box, (x,y)=>{ poly(hexPts(x,y,s*.92)); g.stroke(); });
  for (const c of L.cs){ const [f,st,tc] = HX_COL[c.st], glow = c.st==='done'||c.st==='cur';
    g.save(); if (glow){ g.shadowColor = f; g.shadowBlur = s*.7; } poly(hexPts(c.px,c.py,s*.88)); g.fillStyle = f; g.fill(); g.restore();
    poly(hexPts(c.px,c.py,s*.88)); g.lineWidth = c.tag ? 6 : 3; g.strokeStyle = c.tag ? C.amber : st; g.stroke();
    g.fillStyle = c.tag&&c.st==='fut' ? C.amber : tc; g.font = '400 '+Math.round(s*(c.tag?.48:.56))+'px Anton'; g.textAlign = 'center'; g.fillText(String(c.tag||wNo(c.w)), c.px, c.py+s*.2); }
  g.textAlign = 'left';
}
/* ---------------- Visuel "Ma semaine" (1080 x 1920) ---------------- */
function weekShareData(n){
  const w = PLAN.find(x=>x.num===n), r = realWeek(w), done = w.sessions.filter(isDone).length;
  const zs = S.acts.filter(a=>a.zones && inWeek(a.date,w)); const zt = zs.reduce((a,x)=>a+x.zones.reduce((p,q)=>p+q,0),0);
  const moods = w.sessions.map(s=>S.fb[s.code]&&S.fb[s.code].mood).filter(Boolean);
  return {w, km:r.km, dur:r.dur, done, tot:w.sessions.length, z12: zt ? Math.round(zs.reduce((a,x)=>a+x.zones[0]+x.zones[1],0)/zt*100) : null,
    mood: moods.length ? moods.reduce((a,x)=>a+x,0)/moods.length : null};
}
async function drawShare(n){
  const img = $('#shareImg'); if (!img) return;
  try{ await Promise.all(['150px Anton','600 40px Inter','600 30px "JetBrains Mono"'].map(f=>document.fonts.load(f))); }catch(e){}
  const d = weekShareData(n), cv = document.createElement('canvas'); cv.width=1080; cv.height=1920; const g = cv.getContext('2d'), k = 1080/412;
  g.fillStyle = C.bg; g.fillRect(0,0,1080,1920);
  drawHexTrail(g, {x:60,y:210,w:960,h:840}, {w:1080,h:1100});
  g.fillStyle = C.text; g.font = '400 64px Anton'; g.fillText("L'ASCENSION", 64, 110);
  g.font = '600 30px "JetBrains Mono"'; g.fillStyle = C.muted; g.fillText('MERUN·METRAIL', 64, 158);
  let y = 1290;
  g.fillStyle = C.teal; g.fillRect(64, y-190, 70, 10);
  g.fillStyle = C.text; g.font = '400 150px Anton'; const big = d.w.pre ? 'PRÉ-SAISON' : 'SEMAINE '+wNo(d.w); g.fillText(big, 64, y);
  const sw = g.measureText(big).width; g.fillStyle = C.muted; g.font = '400 80px Anton'; if (!d.w.pre) g.fillText(' / '+NW, 64+sw, y);
  g.font = '600 32px "JetBrains Mono"'; g.fillStyle = C.teal; g.fillText(`${S.goal.name.toUpperCase()} · J-${Math.max(0,daysTo(RACE_DATE))}`, 64, y+64);
  g.fillStyle = C.muted; g.font = '600 26px "JetBrains Mono"'; g.fillText(`PRÉPA : ${Math.round(doneKm())} / ${Math.round(TOTAL_KM)} KM PARCOURUS`, 64, y+108);
  const cells = [['DISTANCE', fmtN(d.km), 'km'], ['SÉANCES', d.done+'/'+d.tot, ''], ['DURÉE', d.dur?fmtHM(d.dur):'0h00', ''],
    d.z12!=null ? ['EN Z1-Z2', d.z12+'', '%'] : ['MOOD', d.mood?fmtN(d.mood):'-', '/5']];
  cells.forEach(([l,v,u],i)=>{ const x = 64 + (i%2)*490, yy = y + 170 + Math.floor(i/2)*180;
    g.fillStyle = '#2a3342'; g.fillRect(x, yy, 440, 3);
    g.fillStyle = C.muted; g.font = '600 26px "JetBrains Mono"'; g.fillText(l, x, yy+50);
    g.fillStyle = C.text; g.font = '400 92px Anton'; g.fillText(v, x, yy+150); const vw = g.measureText(v).width;
    if (u){ g.fillStyle = C.muted; g.font = '600 34px Inter'; g.fillText(' '+u, x+vw, yy+150); } });
  g.fillStyle = C.muted; g.font = '600 26px Inter'; g.fillText(d.w.title.slice(0,52), 64, 1860);
  cv.toBlob(b => { V.shareBlob = b; if (img.src) URL.revokeObjectURL(img.src); img.src = URL.createObjectURL(b); }, 'image/png');
}
function Share({week}){
  queueMicrotask(()=>drawShare(week));
  return `<div class="pad">${head('Ma semaine', 'Story 9:16 · semaine '+week)}
    <img id="shareImg" alt="Visuel de la semaine ${week}" style="width:100%;max-width:340px;aspect-ratio:9/16;margin:0 auto;display:block;border-radius:18px;background:${C.surface}">
    <div class="row" style="gap:8px"><button class="pill" style="flex:1;background:${C.teal};color:${C.bg}" onclick="shareNow(${week})">${ico('share',16)} Partager</button>
      <button class="pill" style="flex:1;background:${C.surface}" onclick="V.shareBlob&&download(V.shareBlob,'MeRun_semaine_${week}.png')">Télécharger</button></div></div>`;
}
window.shareNow = async n => { const b = V.shareBlob; if (!b) return;
  const f = new File([b], `MeRun_semaine_${n}.png`, {type:'image/png'});
  try{ if (navigator.canShare && navigator.canShare({files:[f]})) await navigator.share({files:[f], title:'Ma semaine'}); else { download(b, f.name); toast('Partage non disponible : image téléchargée'); } }
  catch(e){ if (e.name !== 'AbortError') toast('Partage impossible'); } };

/* ---------------- Activites (ex-Suivi) ---------------- */
function Acts(){
  const d = ALL.filter(isDone);
  const acts = [
    ...d.map(s=>{ const a=actOf(s.code), fb=S.fb[s.code]; return {date:s.date,big:fmtN(a?a.km:kmOf(s))+' km',t:s.title,m:[fb?EFFORT[fb.effort]:'RPE '+S.done[s.code], fb&&fb.mood?'mood '+fb.mood+'/5':'', a&&a.hr?'FC moy '+a.hr:'', a&&a.zones?z12(a.zones)+' % Z1-Z2':''].filter(Boolean).join(' · '),c:KIND[s.kind].c,code:s.code}; }),
    ...S.acts.filter(a=>!a.code).map(a=>({date:a.date,big:fmtN(a.km)+' km',t:a.src==='intervals'?(a.name||'Sortie')+' · Intervals.icu':'Activité importée (.fit)',m:[a.dur?fmtDur(a.dur):'',a.hr?'FC moy '+a.hr:'',a.zones?z12(a.zones)+' % Z1-Z2':''].filter(Boolean).join(' · '),c:C.surface2})),
    ...S.races.map(r=>({date:r.date,big:r.time,t:r.name,m:`${r.dist} km${r.dplus?' · '+r.dplus+' m D+':''}${r.hr?' · FC moy '+r.hr:''}`,c:C.orange})),
  ].sort((a,b)=>b.date.localeCompare(a.date));
  const stat = (l,v,bg,fg=C.bg) => `<div style="background:${bg};color:${fg};border-radius:22px;padding:14px 16px"><div class="mono" style="font-size:10px;opacity:.8">${l}</div><div class="anton" style="font-size:34px">${v}</div></div>`;
  return `<div class="pad">${head('Activités')}
    <div class="grid2">${stat('Séances',d.length+'/'+ALL.length,C.teal)}${stat('Km',Math.round(doneKm()),C.orange)}${stat('Semaine',curWeek().pre?'Pré':'S'+wNo(curWeek()).padStart(2,'0'),C.surface,C.text)}${stat('PPG',S.ppgDone.length,C.pink)}</div>
    <button class="pill" style="background:${C.surface};padding:12px" onclick="V.fitTarget=null;$('#fitInput').click()">+ Importer des .fit</button>
    ${acts.length? acts.map(a=>`<div class="sess" ${a.code?`role="button" tabindex="0" onclick="openS('${a.code}')"`:''}><span class="dot" style="background:${a.c};width:10px;height:46px;border-radius:5px"></span>
      <span style="flex:1;min-width:0"><span class="muted" style="font-size:12px;display:block">${shortDate(a.date)} ${d8(a.date).getFullYear()}</span><span style="font-weight:700;display:block">${esc(a.t)}</span><span class="muted" style="font-size:12px">${esc(a.m)}</span></span>
      <span class="anton" style="font-size:20px">${esc(a.big)}</span></div>`).join('') : '<p class="muted">Aucune activité pour l\'instant.</p>'}
  </div>`;
}
function Methods(){
  const it = (t, d, src) => `<div class="card"><div style="font-weight:800">${t}</div><p style="color:var(--body);font-size:13px;margin-top:6px">${d}</p><p class="muted" style="font-size:11.5px;margin-top:6px">${src}</p></div>`;
  return `<div class="pad">${head('Méthodes', 'Comment MeRun calcule')}
    ${it('Projection de temps (Riegel)','T2 = T1 × (D2 / D1)^1,06. Sert au temps actuel, à Endurance et à Vitesse.','Riegel P.S., « Athletic Records and Human Endurance », American Scientist, 1981, 69(3), p. 285-290.')}
    ${it('Vitesse critique et allures','Allures du plan mises à l’échelle de ta VC. Calcul VC : pente de la droite distance-temps sur deux efforts maximaux.','Jones A.M. et Vanhatalo A., « The ‘Critical Power’ Concept », Sports Medicine, 2017, 47, p. 65-78.')}
    ${it('Polarisation (axe du profil)','Part du temps passé en Z1-Z2 (sous 150 bpm, SV1 du test CHU), rapportée à 80 % visés.','Seiler S. et Kjerland G.Ø., « Quantifying training intensity distribution in elite endurance athletes », Scand. J. Med. Sci. Sports, 2006, 16(1), p. 49-56. Zones : test d’effort CHU (SV1 150, SV2 170).')}
    ${it('Plan adaptatif','Maladie ou douleur : 7 jours à 70 %. Fatigue ou sommeil : 7 jours à 85 %. 2 séances difficiles sur 3 : 7 jours à 85 %. Mood ≤ 2 sur 2 des 3 dernières séances : 5 jours à 85 %. Allure, motivation ou conditions : plan inchangé. Trop facile 2 fois sur des séances clés : conseil de refaire un test, jamais de hausse automatique. Tests et courses jamais modifiés.','Règles MeRun : choix de conception prudents, ce ne sont pas des normes scientifiques. Chaque allègement est annulable.')}
    ${it('Difficulté (éclairs)','1 = endurance, 2 = lignes droites, 3 = allure marathon, 4 = seuil, semi, 10 km, 5 = VMA, tests et courses. Sortie longue de 1 h 45 ou plus : +1.','Règle MeRun, indicative.')}
    ${it('Mobilité','Routines MeRun inspirées de mouvements classiques. Passif (tenu 1 min) après la course ou le soir ; avant une séance, uniquement la routine dynamique. Les étirements n’ont pas montré d’effet protecteur contre les blessures, contrairement au renforcement : la mobilité sert au confort et à l’amplitude, pas à la prévention.','Lauersen J.B. et al., Br. J. Sports Med., 2014, 48(11), p. 871-877. Kay A.D. et Blazevich A.J., Med. Sci. Sports Exerc., 2012, 44(1), p. 154-164.')}
    ${it('Export Garmin','Fichiers workout .fit (file_id, workout, workout_step), cibles d’allure en m/s.','Garmin FIT SDK, Protocol & Profile : developer.garmin.com/fit/protocol')}
  </div>`;
}

/* ---------------- Plus ---------------- */
function Plus(){
  const tile=(k,t,bg,fg=C.bg)=>`<button class="tile" style="background:${bg};color:${fg}" onclick="openLayer('${k}')"><span class="anton" style="font-size:22px">${t}</span>${ico('arrow')}</button>`;
  return `<div class="pad">
    <div class="card row"><img src="./icons/icon-192.png" alt="" width="60" height="60" style="border-radius:18px"><div><div class="anton" style="font-size:26px">${esc(S.name)}</div>
      <div class="muted" style="font-size:12.5px">VC ${fmtN(S.vc)} km/h · FC max ${S.fcmax}</div></div></div>
    <div class="grid2">${tile('acts','Activités',C.orange)}${tile('defis','Défis',C.pink)}${tile('zones','Zones FC & allure',C.teal)}${tile('nut','Nutrition',C.amber)}${tile('methods','Méthodes',C.surface2,C.text)}${tile('reglages','Réglages',C.surface,C.text)}</div>
    <button class="card row" style="text-align:left;border:2px solid ${ivCode()?C.teal:C.surface2}" onclick="openLayer('montre')"><span class="kdot" style="background:${C.teal}">${ico('activity',20)}</span><span style="flex:1;min-width:0"><span style="font-weight:800;display:block">Montre · Intervals.icu</span><span class="muted" style="font-size:12.5px">${ivCode()?'Envoi des séances et retour des sorties':'Envoyer les séances sur la Garmin sans fichier'}</span></span>${ico('next',18)}</button>
    <p class="muted" style="font-size:11px;text-align:center">MeRun-MeTrail ${APP_VERSION}</p>
  </div>`;
}
/* Defis : objectifs derives du plan lui-meme (km et PPG planifies), pas de cibles arbitraires */
function challenges(){
  const t=todayIso(), m=t.slice(0,7), mName=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'][+m.slice(5,7)-1];
  const inM = ALL.filter(s=>s.date.startsWith(m)), w=curWeek();
  const blocS = ALL.filter(s=>s.bloc===w.bloc), ppgM = PLAN.flatMap(x=>x.ppg).filter(p=>p.date.startsWith(m));
  const list = [];
  if (inM.length) list.push({id:'km-'+m,t:`${mName} : ${Math.round(inM.reduce((a,s)=>a+s.km,0))} km`,d:'Courir tout le volume planifié du mois.',v:inM.filter(isDone).reduce((a,s)=>a+s.km,0),goal:inM.reduce((a,s)=>a+s.km,0),u:'km',end:inM[inM.length-1].date,c:C.pink});
  list.push({id:'zero-'+w.bloc,t:`Zéro trou, bloc ${w.bloc}`,d:`Valider toutes les séances du bloc ${BLOC[w.bloc].n}.`,v:blocS.filter(isDone).length,goal:blocS.length,u:'séances',end:blocS[blocS.length-1].date,c:C.orange});
  if (ppgM.length) list.push({id:'ppg-'+m,t:`PPG 2×/sem, ${mName.toLowerCase()}`,d:'Tenir les deux PPG hebdomadaires du plan.',v:S.ppgDone.filter(x=>x.startsWith(m)).length,goal:ppgM.length,u:'PPG',end:ppgM[ppgM.length-1].date,c:C.teal});
  return list;
}
const LAYER = {
  detail: Detail, complete: Complete, manual: Manual, effort: Effort, why: Why, verdict: Verdict,
  defis(){ const cs=challenges(); const badges=[['10K','10 km','S08_Dim_race',C.teal],['21K','Semi de Paris','S22_Dim_race',C.amber],['42K','Marathon de Paris','S26_Dim_race',C.pink]];
    return `<div class="pad">${head('Défis','Calculés à partir du plan')}
    ${cs.map(c=>{ const p=Math.min(100,Math.round(c.v/c.goal*100)); return `<div class="card" style="border-radius:24px"><div class="row"><div class="zc" style="width:52px;height:52px;background:${c.c}">${p}%</div>
      <div style="flex:1"><div class="anton" style="font-size:21px">${esc(c.t)}</div><div class="muted" style="font-size:12.5px">${esc(c.d)}</div></div></div>
      <div class="bar" style="background:var(--surface-2);margin-top:12px"><i style="width:${p}%;background:${c.c}"></i></div>
      <div class="row" style="justify-content:space-between;margin-top:10px;font-size:12.5px"><span class="muted">${fmtN(c.v)} / ${fmtN(c.goal)} ${c.u} · fin ${shortDate(c.end)}</span>
      <button class="pill" style="padding:8px 14px;font-size:12.5px;background:${S.joined[c.id]?C.surface:c.c};color:${S.joined[c.id]?C.text:C.bg}" onclick="S.joined['${c.id}']=!S.joined['${c.id}'];save();render()">${S.joined[c.id]?'Quitter':'Relever le défi'}</button></div></div>`; }).join('')}
    <div class="anton" style="font-size:22px;margin-top:6px">Sommets atteints</div>
    <div class="row" style="gap:14px;flex-wrap:wrap">${S.races.map(r=>`<div style="text-align:center;width:72px"><div class="zc" style="width:64px;height:64px;margin:0 auto;background:${C.orange}">${esc(r.name.split(',')[0].slice(0,4))}</div><div class="muted" style="font-size:11px;margin-top:4px">${esc(r.name.split(',')[0])}</div></div>`).join('')}
      ${badges.map(([m,l,code,c])=>`<div style="text-align:center;width:72px;opacity:${S.done[code]!=null?1:.35}"><div class="zc" style="width:64px;height:64px;margin:0 auto;background:${c}">${m}</div><div class="muted" style="font-size:11px;margin-top:4px">${l}</div></div>`).join('')}</div></div>`; },
  zones(){
    const ZD=[['Z1 · Endurance douce',.55,.64,'#4dabf7','Récup, décrassage'],['Z2 · Endurance fondamentale',.64,.80,'#2f9e44','Le gros du volume'],['Z3 · Endurance active',.80,.95,'#94d82d','Allure marathon, tempo bas'],
      ['Z4 · Seuil (SV2/VC)',.95,1,'#f0a020','Seuil, semi et 10 km'],['Z5 · Au-dessus VC',1,1.1,'#ff6b35','VMA longue 3-5 min'],['Z6 · Vitesse',1.1,1.25,'#ff3d8a','Fractionné court, lignes']];
    const pc = b => Math.round(b/S.fcmax*100);
    const FZ=[['Z1 · Récupération','< 135','< '+pc(135)+' %','#4dabf7','Footings de récup'],['Z2 · Endurance fond.','135-150',pc(135)+'-'+pc(150)+' %','#2f9e44','Footings, sorties longues'],['Z3 · Zone grise','151-163',pc(151)+'-'+pc(163)+' %','#94d82d','À éviter hors allure marathon'],
      ['Z4 · Seuil','164-172',pc(164)+'-'+pc(172)+' %','#f0a020','Seuil, allure semi'],['Z5 · VMA','> 172','> '+pc(172)+' %','#ff6b35','VMA, fractionné court']];
    const p = s => fmtPace(3600/s);
    const b = curWeek().bloc;
    return `<div class="pad">${head('Zones','VC '+fmtN(S.vc)+' km/h · FC max '+S.fcmax)}
      <div class="seg teal">${[['pace','Allure'],['fc','FC'],['calc','Calcul VC']].map(([k,l])=>`<button class="${V.zmode===k?'on':''}" onclick="V.zmode='${k}';render()">${l}</button>`).join('')}</div>
      ${V.zmode==='pace' ? `<div>${ZD.map(z=>`<div class="zl"><div class="zc" style="background:${z[3]}">${z[0].slice(0,2)}</div><div style="flex:1"><div style="font-weight:700">${z[0].slice(5)}</div><div class="muted" style="font-size:12px">${z[4]}</div></div>
          <div style="text-align:right"><span class="anton" style="font-size:19px">${p(S.vc*z[2])}-${p(S.vc*z[1])}</span><div class="muted" style="font-size:11px">min/km</div></div></div>`).join('')}</div>
        <div class="card"><div class="mono muted">Allures du plan · bloc ${b}</div>${['EF','AM','SEMI','10K','SEUIL','VMA','VMA400'].map(z=>`<div class="field" style="padding:9px 0"><span>${ZLABEL[z]}</span><span class="anton" style="font-size:18px">${paceLabel(z,b,S.vc)}</span></div>`).join('')}
        <p class="muted" style="font-size:11.5px;margin-top:8px">Zones : % de la VC. Allures du plan : onglet Allures & FC du classeur v4 (calées pour VC 12,5), mises à l'échelle de ta VC.</p></div>`
      : V.zmode==='fc' ? `<div>${FZ.map(z=>`<div class="zl"><div class="zc" style="background:${z[3]}">${z[0].slice(0,2)}</div><div style="flex:1"><div style="font-weight:700">${z[0].slice(5)}</div><div class="muted" style="font-size:12px">${z[4]} · ${z[2]} FCM</div></div>
          <div style="text-align:right"><span class="anton" style="font-size:19px">${z[1]}</span><div class="muted" style="font-size:11px">bpm</div></div></div>`).join('')}</div>
        <p class="muted" style="font-size:12px">Bornes issues du test d'effort du CHU (SV1 150-153, SV2 170). La FC max seule ne permet pas de recalculer SV1/SV2 : à recaler après un test.</p>`
      : `<div class="card"><p style="font-size:13.5px;color:var(--body)">Deux efforts maximaux de durées différentes (par ex. 1 200 m et 3 600 m, ou 3 et 12 min). VC = pente de la droite distance-temps.</p>
        <div class="field"><span>Test 1 : distance (m)</span><input id="d1" inputmode="numeric" placeholder="1200"></div><div class="field"><span>Test 1 : temps (m:ss)</span><input id="t1" placeholder="4:10"></div>
        <div class="field"><span>Test 2 : distance (m)</span><input id="d2" inputmode="numeric" placeholder="3600"></div><div class="field"><span>Test 2 : temps (m:ss)</span><input id="t2" placeholder="14:30"></div>
        <div class="field"><span>Ou VC connue (km/h)</span><input id="vcd" inputmode="decimal" placeholder="${fmtN(S.vc)}"></div>
        <button class="pill" style="background:${C.teal};color:${C.bg};width:100%;margin-top:14px" onclick="applyVC()">Appliquer et recalculer le plan</button>
        <p class="muted" style="font-size:11.5px;margin-top:10px">Méthode : modèle distance-temps de la vitesse critique (Jones & Vanhatalo, Sports Med 2017;47:65-78). Historique : ${S.vcHist.slice(-4).reverse().map(h=>`${h.date} ${fmtN(h.vc)} (${esc(h.src)})`).join(' · ')}</p></div>`}
    </div>`; },
  nut(){
    const NUT={repos:['Repos / PPG',2000,'≈ 150 g','Jour léger : dépense ~2350, déficit 350 (plancher 1900).'],footing:['Footing',2550,'≈ 155 g','Footing EF : dépense ~3050, déficit 500. Protéines à chaque repas.'],
      qualite:['Qualité',2800,'≈ 155 g','Séance qualité : dépense ~3300, déficit 500. Recharge glucides + protéines après.'],longue:['Sortie longue',3400,'≈ 155 g','Sortie longue : dépense ~3900, déficit 500. Jamais à jeun au-delà de 1 h 30.']};
    if (!V.nut){ const s=ALL.find(x=>x.date===todayIso()); V.nut = !s?'repos':s.kind==='sl'||s.kind==='race'?'longue':s.kind==='q'||s.kind==='test'?'qualite':'footing'; }
    const n=NUT[V.nut];
    return `<div class="pad">${head('Nutrition','Base de discussion, à valider avec un professionnel')}
      <div class="grid2">${Object.entries(NUT).map(([k,v])=>`<button class="card" style="text-align:left;border-radius:20px;${V.nut===k?'outline:2px solid var(--orange)':''}" onclick="V.nut='${k}';render()"><div style="font-weight:800">${v[0]}</div><div class="muted" style="font-size:12px">${v[1]} kcal</div></button>`).join('')}</div>
      <div class="grid2"><div style="background:${C.orange};color:${C.bg};border-radius:24px;padding:16px"><div class="mono" style="font-size:10px">kcal</div><div class="anton" style="font-size:48px">${n[1]}</div></div>
        <div style="background:${C.teal};color:${C.bg};border-radius:24px;padding:16px"><div class="mono" style="font-size:10px">Protéines</div><div class="anton" style="font-size:40px">${n[2]}</div></div></div>
      <div class="card"><p style="color:var(--body)">${n[3]}</p><p class="muted" style="font-size:11.5px;margin-top:8px">Valeurs reprises de la v2.8 (déficit modéré de 500 kcal, protéines ~155 g/jour).</p></div></div>`; },
  reglages(){
    const tg=(k,l)=>`<div class="field"><span>${l}</span><button class="tgl ${S[k]?'on':''}" aria-pressed="${!!S[k]}" onclick="S.${k}=!S.${k};save();render()"></button></div>`;
    return `<div class="pad">${head('Réglages')}
      <div class="card"><div class="field"><span>Prénom</span><input value="${esc(S.name)}" onchange="S.name=this.value;save()"></div>
        <div class="field"><span>VC (km/h)</span><input inputmode="decimal" value="${fmtN(S.vc)}" onchange="setVC(this.value,'saisie')"></div>
        <div class="field"><span>FC max</span><input inputmode="numeric" value="${S.fcmax}" onchange="S.fcmax=+this.value||S.fcmax;save();render()"></div>
        <div class="field"><span>Début du plan</span><span class="muted">lun. 5 oct. 2026</span></div><div class="field" style="border:0"><span>Marathon</span><span class="muted">dim. 4 avr. 2027</span></div></div>
      <div class="card">${tg('beeps','Bips PPG')}</div>
      <button class="pill" style="background:${C.text};color:${C.bg}" onclick="exportAll()">Exporter tout le plan (.zip .fit)</button>
      <button class="pill" style="background:${C.surface}" onclick="backup()">Sauvegarder mes données (.json)</button>
      <button class="pill" style="background:${C.surface}" onclick="$('#restoreIn').click()">Restaurer une sauvegarde</button><input type="file" id="restoreIn" accept=".json" hidden onchange="restore(this)">
      <button class="pill" style="color:${C.pink}" onclick="if(confirm('Effacer séances validées, retours, allègements, PPG et activités importées ?')){S.done={};S.ppgDone=[];S.mobDone=[];S.acts=[];S.fb={};S.adj=[];if(S.iv){S.iv.sent={};S.iv.lastPull=null;}save();render();toast('↺ Progression réinitialisée')}">Réinitialiser la progression</button></div>`; },
};
window.setVC = (v, src) => { const x=parseFloat(String(v).replace(',','.')); if(!(x>6&&x<25)){ toast('VC invalide'); return false; }
  S.vc=Math.round(x*10)/10; S.vcHist=S.vcHist.filter(h=>h.date!==todayIso()); S.vcHist.push({date:todayIso(),vc:S.vc,src}); save(); render(); toast('✓ VC '+fmtN(S.vc)+' km/h, allures recalculées'); return true; };
window.applyVC = () => {
  const ps = s => { s=String(s||'').trim(); if(!s) return NaN; const [m,x]=s.split(':'); return x!=null ? +m*60 + +x : +m; };
  const d1=+$('#d1').value, d2=+$('#d2').value, t1=ps($('#t1').value), t2=ps($('#t2').value);
  if (d1&&d2&&t1&&t2){ if (d2<=d1||t2<=t1) return toast('Test 2 : plus long et plus loin'); return setVC((d2-d1)/(t2-t1)*3.6,'test terrain'); }
  if ($('#vcd').value) return setVC($('#vcd').value,'saisie');
  toast('Renseigne les deux tests ou une VC');
};
window.backup = () => download(new Blob([JSON.stringify(S,null,1)],{type:'application/json'}), `merun_sauvegarde_${todayIso()}.json`);
window.restore = async el => { try{ const o=JSON.parse(await el.files[0].text()); if(!o.done) throw 0; S={...S,...o}; save(); render(); toast('✓ Données restaurées'); }catch(e){ toast('Fichier invalide'); } el.value=''; };

/* ---------------- Intervals.icu (v4.6) ----------------
   Aller : seance MeRun -> Intervals.icu (texte du Workout Builder) -> Garmin Connect -> montre.
   Retour : montre -> Garmin Connect -> Intervals.icu -> MeRun (sorties + temps par zone FC).
   L'appli ne parle qu'a la Netlify Function /api/intervals ; la cle API reste sur Netlify.
   Le code d'acces MeRun est garde dans une cle localStorage separee (hors sauvegarde de l'etat).
   Syntaxe : forum Intervals.icu, "Workout Builder Syntax Quick Guide" (2026). */
const IV_KEY = 'merun_iv_code';
const ivCode = () => { try { return localStorage.getItem(IV_KEY) || ''; } catch(e){ return ''; } };
const ivSetCode = v => { try { v ? localStorage.setItem(IV_KEY, v) : localStorage.removeItem(IV_KEY); } catch(e){} };
const ivState = () => (S.iv = S.iv || {sent:{}, lastPull:null, lastPush:null, auto:true, athlete:null});

/* Duree et distance au format du Workout Builder : "m" = minutes, "mtr" = metres */
function ivDur(t){ t=Math.round(t); const h=Math.floor(t/3600), m=Math.floor(t%3600/60), s=t%60; return (h?h+'h':'')+(m?m+'m':'')+(s?s+'s':'') || '0s'; }
const ivDist = d => d%1000===0 ? (d/1000)+'km' : Math.round(d)+'mtr';
const IV_CUE = {warmup:'Echauffement', cooldown:'Retour au calme', rest:'Recup'};
function ivTarget(z, bloc){
  if (z==='OPEN') return '';
  if (z==='EFD') return `55-${Math.round(145/S.fcmax*100)}% HR`;           // FC < 145, % de la FC max reglee dans Intervals.icu
  const r = paceRange(z, bloc, S.vc); if (!r) return '';
  return r[0]===r[1] ? `${fmtPace(r[0])}/km Pace` : `${fmtPace(r[0])}/km-${fmtPace(r[1])}/km Pace`;
}
function ivLine(st, bloc){
  const amount = st.t ? ivDur(st.t) : st.d ? ivDist(st.d) : null;
  const cue = (IV_CUE[st.k] || ZLABEL[st.z] || 'Effort').replace(/\d/g,'').trim();
  if (!amount) return (st.n||cue).replace(/\b\d+x\b/gi,'');                 // etape libre sans duree : simple titre, pas d'etape
  return `- ${cue} ${amount} ${ivTarget(st.z, bloc)}`.trim();
}
function ivDescription(s){
  const out = [];
  for (const st of stepsOf(s)){
    if (st.rep){ out.push('', `${st.rep}x`, ...st.steps.map(x=>ivLine(x, s.bloc)), ''); }
    else out.push(ivLine(st, s.bloc));
  }
  return out.join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
const ivName = s => ('MeRun · '+s.title).slice(0,80);
function ivHash(str){ let h=0; for (let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))|0; return (h>>>0).toString(36); }
const ivPayload = s => { const description = ivDescription(s); return {external_id:'merun-'+s.code, name:ivName(s), date:s.date, description, h:ivHash(s.date+'|'+ivName(s)+'|'+description)}; };
/* Statut d'une seance : null (jamais envoyee), 'ok', 'stale' (plan modifie depuis l'envoi), 'err' (Garmin a refuse) */
function ivStatus(s){ const x = ivState().sent[s.code]; if (!x) return null; if (x.err) return 'err'; return x.h===ivPayload(s).h ? 'ok' : 'stale'; }

async function ivCall(action, payload={}){
  const code = ivCode(); if (!code) throw new Error("Code d'accès non renseigné (Plus > Montre)");
  let r; try { r = await fetch('/api/intervals', {method:'POST', headers:{'content-type':'application/json','x-merun-code':code}, body:JSON.stringify({action, ...payload})}); }
  catch(e){ throw new Error('Pas de réseau'); }
  let d = null; try { d = await r.json(); } catch(e){}
  if (!r.ok) throw new Error((d && d.error) || (r.status===404 ? 'Fonction /api/intervals absente : déployer avec Netlify CLI (voir Plus > Montre)' : 'Erreur '+r.status));
  return d;
}
V.ivBusy = false;
async function ivRun(label, fn){
  if (V.ivBusy) return; V.ivBusy = label; render();
  try { return await fn(); }
  catch(e){ console.warn(e); toast('Intervals.icu : '+e.message); }
  finally { V.ivBusy = false; render(); }
}

/* Envoi : seances non faites, d'aujourd'hui ou plus tard */
const ivSendable = s => s.date >= todayIso() && !isDone(s);
async function ivPush(list, silent){
  list = list.filter(ivSendable);
  if (!list.length){ if (!silent) toast('Rien à envoyer : séances passées ou déjà faites'); return 0; }
  const by = {}; const wk = list.map(s => { const p = ivPayload(s); by[p.external_id] = {s, h:p.h}; const {h, ...w} = p; return w; });
  const d = await ivCall('push', {workouts:wk});
  const st = ivState(); let errs = 0;
  for (const e of d.events || []){ const m = by[e.external_id]; if (!m) continue;
    const err = (e.push_errors||[]).length ? (e.push_errors[0].message || e.push_errors[0].error || 'envoi Garmin refusé') : null; if (err) errs++;
    st.sent[m.s.code] = {id:e.id, h:m.h, at:new Date().toISOString(), err}; }
  st.lastPush = new Date().toISOString(); save();
  if (!silent) toast(errs ? `${list.length-errs} envoyée(s), ${errs} refusée(s) par Garmin` : `✓ ${list.length} séance(s) envoyée(s) · synchro Garmin par Intervals.icu`);
  return list.length;
}
window.ivSendOne = code => ivRun('push', () => ivPush([ALL.find(s=>s.code===code)]));
window.ivSendWeek = num => ivRun('push', () => ivPush(PLAN.find(w=>w.num===num).sessions));
window.ivSendNext = () => ivRun('push', () => { const t=todayIso(), lim=iso(new Date(Date.now()+7*864e5)); return ivPush(ALL.filter(s=>s.date>=t && s.date<=lim)); });
window.ivRemove = code => ivRun('del', async () => { const x = ivState().sent[code]; if (!x) return;
  await ivCall('delete', {ids:[x.id]}); delete ivState().sent[code]; save(); toast('Séance retirée du calendrier Intervals.icu'); });

/* Retour : sorties course a pied, dedoublonnees avec les .fit deja importes */
async function ivPull(silent){
  const st = ivState(), t = todayIso();
  const from = st.lastPull ? iso(new Date(Math.max(d8(st.lastPull).getTime()-3*864e5, Date.now()-30*864e5))) : iso(new Date(Date.now()-14*864e5));
  const d = await ivCall('activities', {oldest:from, newest:t});
  let n = 0, upd = 0;
  for (const a of d.acts || []){
    if (!a.date || !(a.km>0)) continue;
    const dup = S.acts.find(x => x.iv===a.id || (x.date===a.date && Math.abs(x.km-a.km)<0.05));
    if (dup){ if (!dup.iv) dup.iv = a.id; if (!dup.zones && a.zones){ dup.zones = a.zones; upd++; } if (!dup.hr && a.hr){ dup.hr = a.hr; upd++; } continue; }
    S.acts.push({date:a.date, km:a.km, dur:a.dur, hr:a.hr, zones:a.zones, iv:a.id, src:'intervals', name:a.name||null}); n++;
  }
  st.lastPull = t; save();
  const waiting = pending().filter(s => S.acts.some(a => !a.code && Math.abs(daysTo(a.date)-daysTo(s.date))<=1)).length;
  if (!silent || n) toast(n ? `✓ ${n} sortie(s) récupérée(s)${waiting?' · valide ta séance avec ton ressenti':''}` : upd ? '✓ Zones FC complétées' : 'Aucune nouvelle sortie');
  return n;
}
window.ivPullNow = () => ivRun('pull', () => ivPull(false));

/* Synchro automatique a l'ouverture (toutes les 3 h au plus) : recupere les sorties
   et renvoie les seances deja envoyees dont le plan a ete ajuste (allegement, etc.) */
async function ivAuto(){
  const st = ivState(); if (!ivCode() || !st.auto || V.ivBusy || !navigator.onLine) return;
  if (st.lastAuto && Date.now() - st.lastAuto < 3*3600e3) return;
  st.lastAuto = Date.now(); save();
  try {
    await ivPull(true);
    const stale = ALL.filter(s => ivSendable(s) && ivStatus(s)==='stale');
    if (stale.length){ await ivPush(stale, true); toast(`✓ ${stale.length} séance(s) ajustée(s) renvoyée(s) vers la montre`); }
    render();
  } catch(e){ console.warn('synchro auto', e); }
}
/* Apres un retour de seance ou l'annulation d'un allegement : renvoie tout de suite les seances deja envoyees que le plan a modifiees */
function ivResync(){
  if (!ivCode() || !ivState().auto) return;
  const stale = ALL.filter(s => ivSendable(s) && ivStatus(s)==='stale'); if (!stale.length) return;
  setTimeout(() => ivPush(stale, true).then(() => { toast(`✓ Montre mise à jour : ${stale.length} séance(s) ajustée(s)`); render(); }).catch(e => console.warn('resync', e)), 400);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState==='visible') ivAuto(); });

window.ivSaveCode = async () => { const v = ($('#ivCode')||{}).value||''; ivSetCode(v.trim());
  if (!v.trim()) { render(); return toast('Code effacé'); }
  await ivRun('ping', async () => { const d = await ivCall('ping'); ivState().athlete = d.athlete || 'OK'; save(); toast('✓ Connecté à Intervals.icu'); }); };

/* Ecran Plus > Montre */
function Montre(){
  const st = ivState(), on = !!ivCode(), b = V.ivBusy;
  const nSent = Object.keys(st.sent).length, stale = ALL.filter(s=>ivSendable(s)&&ivStatus(s)==='stale').length;
  const btn = (fn, label, bg, fg=C.text, dis) => `<button class="pill" style="background:${bg};color:${fg};padding:14px;width:100%${dis?';opacity:.45':''}" ${dis?'disabled':''} onclick="${fn}">${label}</button>`;
  const step = (n, t) => `<li style="margin:6px 0">${t}</li>`;
  return `<div class="pad">${head('Montre', 'Garmin via Intervals.icu')}
    <div class="card" style="border:2px solid ${on&&st.athlete?C.teal:C.surface2}">
      <div class="mono" style="color:${on&&st.athlete?C.teal:C.muted}">${on&&st.athlete?'Connecté · '+esc(String(st.athlete)):on?'Code saisi, connexion non vérifiée':'Non connecté'}</div>
      <div class="field" style="margin-top:8px"><span>Code d'accès MeRun</span><input id="ivCode" type="password" autocomplete="off" placeholder="MERUN_CODE" value="${esc(ivCode())}" style="max-width:150px"></div>
      ${btn('ivSaveCode()', b==='ping'?'Test en cours…':'Enregistrer et tester', C.teal, C.bg, !!b)}
      <p class="muted" style="font-size:11.5px;margin-top:8px">Ce code protège l'accès à ta clé Intervals.icu, qui reste sur Netlify. Il est gardé sur ce téléphone uniquement.</p></div>
    ${on ? `<div class="card"><div class="mono muted">Synchronisation</div>
      <div class="muted" style="font-size:12.5px;margin:6px 0 12px">${nSent} séance(s) envoyée(s)${st.lastPush?' · dernier envoi '+shortDate(st.lastPush.slice(0,10)):''}${st.lastPull?' · sorties lues le '+shortDate(st.lastPull):''}${stale?` · <b style="color:${C.amber}">${stale} à renvoyer (plan ajusté)</b>`:''}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${btn('ivSendNext()', b==='push'?'Envoi…':'Envoyer les 7 prochains jours', C.orange, C.bg, !!b)}
        ${btn('ivPullNow()', b==='pull'?'Lecture…':'Récupérer mes sorties', C.surface2, C.text, !!b)}</div>
      <div class="field" style="margin-top:10px"><span>Synchro auto à l'ouverture</span><button class="tgl ${st.auto?'on':''}" aria-pressed="${!!st.auto}" onclick="ivState().auto=!ivState().auto;save();render()"></button></div>
      <p class="muted" style="font-size:11.5px">Auto : toutes les 3 h au plus, récupère les sorties et renvoie les séances déjà envoyées que le plan adaptatif a modifiées. Les séances ne sont jamais validées automatiquement : c'est toi qui valides, avec ton ressenti et ton mood.</p></div>` : ''}
    <div class="card"><div class="mono muted">Mise en place (une fois)</div>
      <ol style="font-size:13px;color:var(--body);padding-left:18px;margin-top:8px">
        ${step(1,'Compte gratuit sur intervals.icu, puis relier Garmin Connect dans les réglages.')}
        ${step(2,'Cocher « Upload planned workouts » et « Download activities » pour Garmin.')}
        ${step(3,'Régler ta FC max (196) dans Intervals.icu : les séances en dénivelé visent un % de FC max.')}
        ${step(4,'Settings > Developer Settings : générer la clé API et noter l\'athlete ID (i123456).')}
        ${step(5,'Netlify > Site configuration > Environment variables : INTERVALS_API_KEY, INTERVALS_ATHLETE_ID, MERUN_CODE.')}
        ${step(6,'Déployer avec Netlify CLI (le glisser-déposer ne publie pas la fonction), puis saisir MERUN_CODE ci-dessus.')}</ol>
      <p class="muted" style="font-size:11.5px">Ne colle jamais la clé API dans une conversation. Seules les sorties enregistrées sur un appareil Garmin remontent (celles importées de Strava arrivent vides par l'API).</p></div>
  </div>`;
}
/* Bloc "montre" dans le detail d'une seance */
function ivDetailBlock(s){
  if (!ivCode() || !ivSendable(s)) return '';
  const stt = ivStatus(s), x = ivState().sent[s.code], b = V.ivBusy;
  const msg = stt==='ok' ? `Sur Intervals.icu depuis le ${shortDate(x.at.slice(0,10))} · synchro Garmin automatique`
    : stt==='stale' ? 'Le plan a changé depuis l\'envoi : renvoie la séance'
    : stt==='err' ? 'Garmin a refusé : '+esc(x.err) : 'Pas encore envoyée sur la montre';
  return `<div class="card" style="border:2px solid ${stt==='ok'?C.teal:stt?C.amber:C.surface2}"><div class="mono" style="color:${stt==='ok'?C.teal:stt?C.amber:C.muted}">Montre</div>
    <div style="font-size:13px;margin:4px 0 10px">${msg}</div>
    <div class="row" style="gap:8px"><button class="pill" style="flex:1;background:${stt==='ok'?C.surface2:C.orange};color:${stt==='ok'?C.text:C.bg}" ${b?'disabled':''} onclick="ivSendOne('${s.code}')">${b==='push'?'Envoi…':stt?'Renvoyer':'Envoyer sur ma montre'}</button>
    ${stt?`<button class="pill" style="background:${C.surface2}" ${b?'disabled':''} onclick="ivRemove('${s.code}')">Retirer</button>`:''}</div></div>`;
}
Object.assign(LAYER, {cycles:Cycles, params:Params, perfs:Perfs, share:Share, acts:Acts, methods:Methods, myvid:MyVid, montre:Montre});
Object.assign(window,{openLayer,closeLayer,closeAll,render,go,parseDur,curWeek,download,toast});

/* ---------------- import .fit ----------------
   V.fitTarget = code de seance : le fichier complete la validation de cette seance.
   Sinon : import libre, rattachement automatique a la seance du jour si elle n'est pas faite. */
function zonesOf(recs){
  const z = [0,0,0,0,0];
  for (let i=1;i<recs.length;i++){ const dt = recs[i][0]-recs[i-1][0]; if (dt<=0 || dt>10) continue; const hr = recs[i][1];
    z[hr<135?0:hr<=150?1:hr<=163?2:hr<=172?3:4] += dt; }
  return z.some(Boolean) ? z : null;
}
function readAct(r){ const ss = r.session; if (!ss || !ss.start_time) return null;
  return {date:iso(ss.start_time), km:Math.round((ss.total_distance||0)/10)/100, dur:Math.round(ss.total_timer_time||ss.total_elapsed_time||0)||null, hr:ss.avg_heart_rate||null, zones:zonesOf(r.records)}; }
$('#fitInput').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (V.fitTarget && V.flow){
    V.fitTarget = null;
    try{ const a = readAct(parseFitFile(await files[0].arrayBuffer())); if (!a) return toast('Fichier .fit illisible');
      const dup = S.acts.find(x => x.date===a.date && Math.abs(x.km-a.km)<0.05);
      Object.assign(V.flow, {km:a.km, dur:a.dur, hr:a.hr, zones:a.zones, date:a.date, src:'fit', actRef: dup ? dup.date+'|'+dup.km : null});
      if (dup && !dup.zones && a.zones) dup.zones = a.zones;
      toast(`✓ ${fmtN(a.km)} km lus${a.zones?' · zones FC calculées':''}`); openLayer('effort');
    }catch(err){ console.warn(err); toast('Fichier .fit illisible'); }
    return;
  }
  let n=0, matched=0;
  for (const f of files){
    try{ const a = readAct(parseFitFile(await f.arrayBuffer())); if (!a) continue;
      if (S.acts.some(x=>x.date===a.date && Math.abs(x.km-a.km)<0.05)) continue;
      const p = ALL.find(s=>s.date===a.date && !isDone(s));
      if (p && a.km>1){ S.done[p.code]=3; a.code=p.code; matched++; }
      S.acts.push(a); n++;
    }catch(err){ console.warn(err); }
  }
  save(); render(); toast(n ? `✓ ${n} activité(s)${matched?` · ${matched} séance(s) cochée(s)`:''}` : 'Aucune nouvelle activité lisible');
});

/* ---------------- demarrage ---------------- */
load();
history.replaceState({l:0}, '');
$('#nav').addEventListener('click', e => { const b=e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); });
const qp = new URLSearchParams(location.search).get('page'); if (TABS.some(t=>t[0]===qp)) V.tab = qp;
render();
vidInit();
setTimeout(ivAuto, 1500);
if ('serviceWorker' in navigator) window.addEventListener('load', () => {
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
  let reloaded = false; const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded){ reloaded = true; location.reload(); } });
});
