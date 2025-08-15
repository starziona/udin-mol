// Rheina Accuracy Backend — Udin‑Mol
// Express API with multi-source scrape + majority vote per date (7 days, exclude today).

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/health', (req,res)=>res.json({ok:true, ts: new Date().toISOString()}));

// ---- Markets & sources (adjustable)
const MARKETS = [
  { key:'cambodia', name:'Cambodia', sources:[
    'https://resultcambodia.com/',
    'https://kerry899.com/lottery-history'
  ]},
  { key:'toto-macau', name:'Toto Macau', sources:[
    'https://totomacau.live/',
    'https://macaupiu.com/'
  ]},
  { key:'sydney', name:'Sydney Lotto', sources:[
    'https://result-sdy.com/',
    'https://sidneypools-result.today/'
  ]},
  { key:'china', name:'China', sources:[
    'https://china4dresult.com/',
    'https://chinaresult.live/'
  ]},
  { key:'japan', name:'Jepang', sources:[
    'https://japan4dresult.com/',
    'https://japanlotto.live/'
  ]},
  { key:'singapore', name:'Singapura', sources:[
    'https://totostory.com/histori-nomor/',
    'https://www.singaporepools.com.sg/'
  ]},
  { key:'taiwan', name:'Taiwan', sources:[
    'https://taiwan4dresult.com/',
    'https://taiwan-result.today/'
  ]},
  { key:'hongkong', name:'Hongkong Lotto', sources:[
    'https://tabel898.com/hksgp',
    'https://hongkongpoolsresult.site/'
  ]},
];
const INFO = Object.fromEntries(MARKETS.map(m=>[m.key, m.name]));

// ---- Utils
const pad2 = n => String(n).padStart(2, '0');
const fmt = d => `${pad2(d.date())}-${pad2(d.month()+1)}-${d.year()}`;
const lastNExcludeToday = (n) => Array.from({length:n}, (_,i)=> dayjs().subtract(i+1,'day'));

// Parse generic: find date lines + 4-digit near them
async function fetchAndParse(url, wantSet) {
  try{
    const r = await axios.get(url, { timeout: 15000, headers: {
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
    }});
    const $ = cheerio.load(r.data);
    $('script,style,noscript').remove();
    const text = $('body').text().replace(/\u00a0/g,' ').split(/\n+/).map(s=>s.trim()).filter(Boolean);

    const reDash = /^([0-3]?\d)[\-\./]([01]?\d)[\-\./](\d{4})$/;
    const months = ['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'];
    const monthMap = Object.fromEntries(months.map((m,i)=>[m,i+1]));
    const reMonth = new RegExp(String.raw`^([0-3]?\d)\s+(${months.join('|')})\s+(\d{4})$`, 'i');
    const out = {};
    for(let i=0;i<text.length;i++){
      let key=null, s=text[i];
      let m = s.match(reDash);
      if(m){ key = `${pad2(m[1])}-${pad2(m[2])}-${m[3]}` }
      else {
        m = s.match(reMonth);
        if(m){ const mm = monthMap[m[2].toLowerCase()]; key = `${pad2(m[1])}-${pad2(mm)}-${m[3]}` }
      }
      if(key && wantSet.has(key)){
        // find a 4-digit near
        let cand = (s.match(/\b(\d{4})\b/)||[])[1];
        if(!cand){
          for(let j=1;j<=2 && i+j<text.length;j++){
            const mm = (text[i+j].match(/\b(\d{4})\b/)||[])[1];
            if(mm){ cand = mm; break; }
          }
        }
        if(cand && !out[key]) out[key]=cand;
      }
    }
    return out;
  }catch(e){
    return {};
  }
}

function freqDigits(nums){
  const f = Array(10).fill(0);
  nums.forEach(n=>n.split('').forEach(ch=>{ f[+ch]++ }));
  return f;
}
function topDigits(freq, k){
  return [...freq.map((v,d)=>({d,v}))]
    .sort((a,b)=> b.v - a.v || a.d - b.d)
    .slice(0,k).map(x=>String(x.d));
}
function substrings(s,k){
  const arr=[]; for(let i=0;i<=s.length-k;i++) arr.push(s.slice(i,i+k)); return arr;
}
function topN(counter, limit=12){
  return [...counter.entries()].sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,limit).map(e=>e[0]);
}
function buildCandidates(history4d){
  const f = freqDigits(history4d);
  const bbfs6 = topDigits(f,6);
  const bbfs5 = topDigits(f,5);
  const c2 = new Map(), c3 = new Map(), c4 = new Map();
  for(const n of history4d){
    for(const s of substrings(n,2)) c2.set(s, (c2.get(s)||0)+1);
    for(const s of substrings(n,3)) c3.set(s, (c3.get(s)||0)+1);
    c4.set(n, (c4.get(n)||0)+1);
  }
  return { bbfs6, bbfs5, cand2: topN(c2), cand3: topN(c3), cand4: topN(c4), freq: f };
}

// Majority vote per date across sources
function voteMerge(maps, targetKeys){
  const out = {};
  const meta = {};
  for(const key of targetKeys){
    const tally = new Map();
    for(const mp of maps){
      const v = mp[key];
      if(v) tally.set(v, (tally.get(v)||0)+1);
    }
    if(tally.size){
      const arr = [...tally.entries()].sort((a,b)=> b[1]-a[1] || a[0].localeCompare(b[0]));
      out[key] = arr[0][0];
      meta[key] = { votes: arr };
    }
  }
  return { out, meta };
}

app.get('/api/fetch/:market', async (req,res)=>{
  try{
    const marketKey = req.params.market;
    const m = MARKETS.find(x=>x.key===marketKey);
    if(!m) return res.status(404).json({error:'unknown market'});
    const days = Math.max(1, Math.min(14, parseInt(req.query.days||'7',10)));
    const targets = lastNExcludeToday(days);
    const targetKeys = targets.map(fmt);
    const wantSet = new Set(targetKeys);

    // Fetch all sources sequentially (accuracy first, not speed)
    const maps = [];
    let used=[];
    for(const url of m.sources){
      const mp = await fetchAndParse(url, wantSet);
      if(Object.keys(mp).length){ maps.push(mp); used.push(url); }
    }

    const { out, meta } = voteMerge(maps, targetKeys);
    const draws = targets.map(d=>({ date: fmt(d), n4d: out[fmt(d)] || null, votes: meta[fmt(d)]?.votes || [] }));
    const nums = draws.filter(x=>x.n4d).map(x=>x.n4d);

    let bundle = { bbfs6:[], bbfs5:[], cand2:[], cand3:[], cand4:[], freq: Array(10).fill(0) };
    if(nums.length>=3){ bundle = buildCandidates(nums); }

    const status = `${maps.length? 'ok':'failed'} ${Object.keys(out).length}/${days}`;
    return res.json({
      market: marketKey, name: INFO[marketKey], days,
      status, sources_used: used, draws, ...bundle
    });
  }catch(e){
    return res.status(500).json({error: String(e)});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Rheina Accuracy Backend running on', PORT));
