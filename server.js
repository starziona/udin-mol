import express from 'express';
import axios from 'axios';
import cors from 'cors';
import morgan from 'morgan';
import cron from 'node-cron';

const app = express();
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());
app.use(express.static('public'));

// ===== Utilities =====
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtDate(d){ return pad2(d.getDate())+'-'+pad2(d.getMonth()+1)+'-'+d.getFullYear(); }
function lastNDatesExcludingToday(n, base=new Date()){
  const arr=[];
  for(let i=1;i<=n;i++){
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    d.setDate(d.getDate()-i);
    arr.push(d);
  }
  return arr;
}
function todayISO() { return new Date().toISOString(); }

// ===== Generic parser: "date + 4 digits" =====
function parseDateNumbersFromHTML(htmlText, targetDates){
  const text = htmlText
    .replace(/<script[\\s\\S]*?<\\/script>/gi,'')
    .replace(/<style[\\s\\S]*?<\\/style>/gi,'')
    .replace(/<[^>]+>/g,'\\n');
  const lines = text.split(/\\n+/).map(s=>s.trim()).filter(Boolean);
  const map = {}; // dd-mm-yyyy -> 'NNNN'

  const reDash = /^([0-3]?\\d)[\\-\\./]([01]?\\d)[\\-\\./](\\d{4})$/;
  const reMonth = /^(?:([0-3]?\\d)\\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\\s+(\\d{4}))$/i;
  const monthMap = {januari:1,februari:2,maret:3,april:4,mei:5,juni:6,juli:7,agustus:8,september:9,oktober:10,november:11,desember:12};
  function normDate(d,m,y){
    const dd = String(parseInt(d,10)).padStart(2,'0');
    const mm = String(parseInt(m,10)).padStart(2,'0');
    return dd+'-'+mm+'-'+y;
  }
  const wantedSet = new Set(targetDates.map(d => fmtDate(d)));

  for(let i=0;i<lines.length;i++){
    const s = lines[i];
    let key=null, m;
    if((m = s.match(reDash))){
      key = normDate(m[1], m[2], m[3]);
    } else if((m = s.match(reMonth))){
      const mm = monthMap[m[2].toLowerCase()];
      if(mm) key = normDate(m[1], mm, m[3]);
    }
    if(key && wantedSet.has(key)){
      let cand = (s.match(/\\b(\\d{4})\\b/)||[])[1];
      for(let j=1; !cand && j<=2 && i+j<lines.length; j++){
        const m2 = lines[i+j].match(/\\b(\\d{4})\\b/);
        if(m2) cand = m2[1];
      }
      if(cand && !map[key]) map[key]=cand;
    }
    if(Object.keys(map).length === targetDates.length) break;
  }
  return map;
}

// ===== Markets & Sources (fallback) =====
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

const SOURCES = Object.fromEntries(MARKETS.map(m=>[m.key, m.sources]));
const MARKET_INFO = Object.fromEntries(MARKETS.map(m=>[m.key, m.name]));
const MARKET_ORDER = ['cambodia','sydney','singapore','taiwan','japan','china','hongkong','toto-macau']; // approx schedule

// ===== Fetcher (server-side) =====
async function fetchText(url){
  const res = await axios.get(url, {
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
    timeout: 15000,
    validateStatus: ()=>true
  });
  if(res.status >= 400) throw new Error('HTTP '+res.status);
  return res.data;
}

// ===== Analytics =====
function freqDigits(nums){
  const f = Array(10).fill(0);
  for(const n of nums){ for(const ch of n){ const d = ch.charCodeAt(0)-48; if(d>=0&&d<=9) f[d]++; } }
  return f;
}
function topDigits(freqArr,k){
  const pairs = freqArr.map((v,d)=>({d,v}));
  pairs.sort((a,b)=> b.v-a.v || a.d-b.d);
  return pairs.slice(0,k).map(p=>String(p.d));
}
function substrings(nstr,k){ const arr=[]; for(let i=0;i+k<=nstr.length;i++) arr.push(nstr.slice(i,i+k)); return arr; }
function buildCandidates(history4d){
  const fd = freqDigits(history4d);
  const bbfs6 = topDigits(fd,6);
  const bbfs5 = topDigits(fd,5);
  const f2=new Map(), f3=new Map(), f4=new Map();
  for(const n of history4d){
    for(const s of substrings(n,2)) f2.set(s,(f2.get(s)||0)+1);
    for(const s of substrings(n,3)) f3.set(s,(f3.get(s)||0)+1);
    f4.set(n,(f4.get(n)||0)+1);
  }
  const topN = (m,limit)=> Array.from(m.entries()).sort((a,b)=> b[1]-a[1] || parseInt(a[0])-parseInt(b[0])).slice(0,12).map(([k,v])=>k);
  return { bbfs6, bbfs5, cand2: topN(f2,12), cand3: topN(f3,12), cand4: topN(f4,12), freq: fd };
}

// ===== Cache (in-memory) =====
const cache = {}; // market -> { updatedAt, payload }
function setCache(market, payload){ cache[market] = { updatedAt: todayISO(), payload }; }
function getCache(market){ return cache[market] || null; }

// ===== Core scrape =====
async function scrapeMarket(key, days=7){
  const targetDates = lastNDatesExcludingToday(days);
  const sources = SOURCES[key];
  if(!sources) throw new Error('unknown market '+key);

  let best = {}, usedSource=null, status='failed';
  for(const url of sources){
    try{
      const html = await fetchText(url);
      const map = parseDateNumbersFromHTML(html, targetDates);
      const count = Object.keys(map).length;
      if(count >= 4){ best = map; usedSource=url; status = `ok ${count}/${days}`; break; }
      else { status = `partial ${count}/${days}`; }
    }catch(e){
      status = 'error '+e.message;
    }
  }
  const draws = targetDates.map(d=>({ date: fmtDate(d), n4d: best[fmtDate(d)]||null }));
  const nums = draws.map(d=>d.n4d).filter(Boolean);
  let bundle = {bbfs6:[], bbfs5:[], cand2:[], cand3:[], cand4:[], freq:Array(10).fill(0)};
  if(nums.length >= 3) bundle = buildCandidates(nums);
  const payload = { market:key, name: MARKET_INFO[key]||key, days, status, source: usedSource, draws, ...bundle };
  setCache(key, payload);
  return payload;
}

// ===== Cron: refresh hourly (minute 5) =====
cron.schedule('5 * * * *', async ()=>{
  for(const k of Object.keys(SOURCES)){
    try{ await scrapeMarket(k, 7); }catch(e){ /* ignore */ }
  }
  console.log('Cron refresh done at', todayISO());
});

// ===== API =====
app.get('/health', (req,res)=> res.json({ok:true, now: todayISO()}));
app.get('/markets', (req,res)=>{
  const ms = Array.from(Object.keys(SOURCES))
    .sort((a,b)=> ['cambodia','sydney','singapore','taiwan','japan','china','hongkong','toto-macau'].indexOf(a)-['cambodia','sydney','singapore','taiwan','japan','china','hongkong','toto-macau'].indexOf(b))
    .map(key=>({ key, name: (MARKET_INFO[key]||key) }));
  res.json({ markets: ms });
});
app.get('/fetch/:market', async (req,res)=>{
  const key = req.params.market;
  const days = Math.min(Math.max(parseInt(req.query.days||'7',10),1),14);
  const force = (req.query.force === '1');
  try{
    if(!force){
      const c = getCache(key);
      if(c) return res.json(c.payload);
    }
    const data = await scrapeMarket(key, days);
    res.json(data);
  }catch(e){
    res.status(400).json({error: e.message});
  }
});
app.get('/csv/:market', async (req,res)=>{
  const key = req.params.market;
  let c = getCache(key);
  if(!c){
    try{ await scrapeMarket(key,7); c = getCache(key); }catch(e){ return res.status(400).send('error'); }
  }
  const p = c.payload;
  const header = 'pasaran,tanggal,keluaran4d,bbfs6,bbfs5,top4d,top3d,kandidat2d,kandidat3d,kandidat4d';
  const lines = [header];
  const kline = (arr)=> (arr||[]).join(' ');
  for(const d of p.draws){
    lines.push([
      `"${p.name}"`, d.date, `"${d.n4d||''}"`, `"${(p.bbfs6||[]).join('')}"`, `"${(p.bbfs5||[]).join('')}"`,
      `"${(p.cand4||[])[0]||''}"`, `"${(p.cand3||[])[0]||''}"`, `"${kline(p.cand2)}"`, `"${kline(p.cand3)}"`, `"${kline(p.cand4)}"`
    ].join(','));
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${key}_7hari.csv"`);
  res.send(lines.join('\\n'));
});

// ===== Per-market HTML routes =====
app.get('/m/:market', (req,res)=>{
  res.sendFile(process.cwd() + '/public/m/market.html');
});

// ===== Home =====
app.get('/', (req,res)=> res.sendFile(process.cwd() + '/public/index.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('Udin-Mol Rheina Online listening on '+PORT));
