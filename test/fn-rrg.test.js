import { test } from 'node:test';
import assert from 'node:assert/strict';
import { options, rotation, periods, quadrant, build, WORLD_INDICES } from '../lib/fn/rrg.js';
import { parseArgs, svgPlot, portfolioSymbols, sortedRows, nextSort } from '../public/js/fn/rrg.js';
const bars = (n=600, fn=i=>100+i*0.1) => Array.from({length:n}, (_,i)=>({time:Date.UTC(2023,0,2+i)/1000,close:fn(i)})).filter(b=>![0,6].includes(new Date(b.time*1000).getUTCDay()));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
test('RRG validates timeframe, tail length, universe and input limits', () => {
  assert.equal(options().symbols.length,11);
  for(const q of [{tf:'MONTHLY'},{tails:0},{tails:53},{tails:1.5},{mode:'W'},{mode:'bad'},{benchmark:'<script>'},{mode:'CUSTOM',symbols:Array.from({length:61},(_,i)=>`A${i}`).join(',')}]) assert.throws(()=>options(q),e=>e.status===400);
  assert.deepEqual(options({mode:'CUSTOM',symbols:'AMAT,SAP.DE,AMAT,OMV.VI'}).symbols,['AMAT','SAP.DE','OMV.VI']);
});
test('RRG proportional security and benchmark remain at 100, without NaN', () => {
  const b=bars(), s=b.map(r=>({...r,close:r.close*7}));
  for(const tf of ['DAILY','WEEKLY']) {
    const r=rotation(s,b,tf,8); assert.ok(!r.error); near(r.x,100); near(r.y,100); assert.equal(r.tail.length,9); assert.equal(r.stale,false); assert.equal(r.quadrant,"Neutral");
  }
});
test('RRG formula matches independent manual daily averages and momentum', () => {
  const b=bars(900,()=>100), s=bars(900,i=>100*Math.exp(i*0.001+i*i*0.000001));
  const rs=s.map(r=>r.close/100), mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const ratio=i=>{ const sm=j=>mean(rs.slice(j-49,j+1));return 100*sm(i)/mean(Array.from({length:130},(_,k)=>sm(i-129+k))); };
  const i=s.length-1, r=rotation(s,b,'DAILY',8);
  near(r.x,ratio(i)); near(r.y,100*ratio(i)/ratio(i-50)); near(r.rsl,s[i].close/mean(s.slice(-135).map(r=>r.close)));
});
test('RRG quadrants and exact neutral axes', () => {
  assert.deepEqual([[101,101],[101,99],[99,99],[99,101],[100,101],[101,100]].map(([x,y])=>quadrant(x,y)),['Leading','Weakening','Lagging','Improving','Neutral','Neutral']);
});
test('RRG weekly sample uses actual last benchmark date even at year boundary', () => {
  const b=['2025-12-29','2025-12-30','2026-01-02','2026-01-05'].map((d,i)=>({time:Date.parse(d)/1000,close:100+i}));
  assert.deepEqual(periods(b,'WEEKLY').map(r=>r.date),['2026-01-02','2026-01-05']);
});
test('RRG rejects short history and never aligns mismatched dates by position', () => {
  assert.ok(rotation(bars(10),bars(10),'DAILY').error);
  const b=bars(); const shifted=b.map(r=>({...r,time:r.time+86400*2000}));
  assert.ok(rotation(shifted,b,'DAILY').error);
});
test('RRG marks stale history, excludes invalid closes and does not bridge missing periods', () => {
  const b=bars(900), s=b.slice(0,-1).map(r=>({...r}));
  const r=rotation(s,b,'DAILY',8);
  assert.equal(r.stale,true); assert.equal(r.date,new Date(b.at(-2).time*1000).toISOString().slice(0,10));
  s.at(-3).close=0;
  const gap=rotation(s,b,'DAILY',8);
  assert.ok(gap.date < new Date(s.at(-3).time*1000).toISOString().slice(0,10));
  assert.ok(gap.tail.every(p=>p.date < new Date(s.at(-3).time*1000).toISOString().slice(0,10)));

});
test('RRG response preserves individual failures and providers without invented prices', async () => {
  const b=bars(900); const calls=[];
  const d=await build({mode:'CUSTOM',symbols:'GOOD,BAD',tf:'DAILY'},async s=>{calls.push(s);if(s==='BAD') throw new Error('Missing source');return {candles:b,provider:'test'};});
  assert.deepEqual(calls.sort(),['BAD','GOOD','SPY']); assert.equal(d.rows.find(r=>r.symbol==='BAD').error,'Missing source'); assert.ok(d.rows.find(r=>r.symbol==='GOOD').tail.length);assert.match(d.source,/test/);
  await assert.rejects(build({},async()=>{throw new Error('Unavailable');}),/Benchmark SPY: Unavailable/);
});
test('RRG command arguments support custom benchmark, universe, period and tail', () => {
  assert.deepEqual(parseArgs(['CUSTOM','DAILY','BENCH=QQQ','TAIL=12','AMAT,SAP.DE']),{mode:'CUSTOM',tf:'DAILY',benchmark:'QQQ',tails:'12',symbols:'AMAT,SAP.DE'});
});
test('RRG plot escapes symbol text and offers chart navigation and latest dots', () => {
  const s=svgPlot([{symbol:'<BAD>',date:'2026-01-01',x:101,y:102,quadrant:'Leading',tail:[{date:'2026-01-01',x:101,y:102}]}]);
  assert.ok(!s.includes('<BAD>'));assert.ok(s.includes('&lt;BAD&gt;'));assert.ok(s.includes('data-symbol='));assert.ok(!s.includes('NaN'));
  assert.ok(!svgPlot([]).includes('Infinity'));
});

test('RRG WEI is a world-index universe, not a security named WEI', () => {
  const parsed = parseArgs(['WEI']);
  assert.equal(parsed.mode,'WEI'); assert.equal(parsed.symbols,undefined);
  const o=options(parsed);
  assert.equal(o.symbols.length,26); assert.ok(o.symbols.includes('^GSPC')); assert.ok(o.symbols.includes('^GDAXI')); assert.ok(o.symbols.includes('^N225')); assert.ok(!o.symbols.includes('WEI'));
  assert.equal(WORLD_INDICES['^GDAXI'],'DAX');
  assert.equal(parseArgs(['CUSTOM','WEEKLY','BENCH=SPY','TAIL=8','WEI']).mode,'WEI');
});
test('RRG WEI loads index symbols and supplies the existing readable index names', async () => {
  const b=bars(900), calls=[];
  const d=await build({mode:'WEI'},async s=>{calls.push(s);return {candles:b,provider:'test'};});
  assert.equal(d.rows.length,26);assert.equal(d.rows.find(r=>r.symbol==='^N225').name,'Nikkei 225');
  assert.ok(!calls.includes('WEI'));assert.ok(calls.includes('^GSPC'));assert.ok(d.rows.every(r=>!r.error));
});

test('RRG PORT selects the saved portfolio independently of the W watchlist', () => {
  assert.equal(parseArgs(['PORT']).mode,'PORT');
  assert.equal(parseArgs(['PORT','DAILY','BENCH=QQQ']).benchmark,'QQQ');
  const state={amberPort:[{sec:'AMAT US EQUITY',shares:10,cost:100},{sec:'SAP GR EQUITY',shares:3},{sec:'OMV AV EQUITY',shares:5}],amberWatch:['NVDA US EQUITY']};
  const syms=portfolioSymbols(state.amberPort);
  assert.deepEqual(syms,['AMAT','SAP.DE','OMV.VI']);
  assert.deepEqual(options({mode:'PORT',symbols:syms.join(',')}).symbols,syms);
});
test('RRG portfolio symbols exclude closed or invalid holdings, keep shorts and deduplicate', () => {
  assert.deepEqual(portfolioSymbols([{sec:'AAPL US EQUITY',shares:0},{sec:'MSFT US EQUITY',shares:'2'},{sec:'MSFT US EQUITY',shares:3},{sec:'AMAT US EQUITY',shares:-5},{sec:'NVDA US EQUITY',shares:'bad'},{sec:'',shares:1},null]),['MSFT','AMAT']);
  assert.deepEqual(portfolioSymbols(undefined),[]);assert.deepEqual(portfolioSymbols({}),[]);
});
test('RRG PORT loads each extracted security as its own rotation series', async () => {
  const syms=portfolioSymbols([{sec:'AMAT US EQUITY',shares:2},{sec:'SAP GR EQUITY',shares:4}]);
  const d=await build({mode:'PORT',symbols:syms.join(',')},async()=>({provider:'test',candles:bars(900)}));
  assert.equal(d.mode,'PORT');assert.equal(d.rows.length,2);assert.ok(d.rows.every(r=>r.tail.length===9));
});

test('RRG sorts raw numeric values both ways and leaves source rows unchanged', () => {
  const rows=[{symbol:'A',x:2},{symbol:'B',x:100},{symbol:'C',x:10}];
  assert.deepEqual(sortedRows(rows,'x').map(r=>r.symbol),['A','C','B']);
  assert.deepEqual(sortedRows(rows,'x','desc').map(r=>r.symbol),['B','C','A']);
  assert.deepEqual(rows.map(r=>r.symbol),['A','B','C']);
});
test('RRG sorts text, dates and displayed status, with missing numeric values last', () => {
  const rows=[{symbol:'TSM',date:'2026-10-16',stale:false,rsl:null},{symbol:'AMAT',date:'2026-10-09',stale:true,rsl:1.2},{symbol:'YUMC',date:'2026-10-15',stale:false,rsl:0.9}];
  assert.deepEqual(sortedRows(rows,'symbol').map(r=>r.symbol),['AMAT','TSM','YUMC']);
  assert.deepEqual(sortedRows(rows,'date','desc').map(r=>r.symbol),['TSM','YUMC','AMAT']);
  assert.equal(sortedRows(rows,'stale','desc')[0].symbol,'AMAT');
  for(const d of ['asc','desc'])assert.equal(sortedRows(rows,'rsl',d).at(-1).symbol,'TSM');
});
test('RRG repeated header selections reverse direction; a different column starts ascending', () => {
  const first=nextSort({key:'rsl',direction:'desc'},'symbol');assert.deepEqual(first,{key:'symbol',direction:'asc'});
  const second=nextSort(first,'symbol');assert.deepEqual(second,{key:'symbol',direction:'desc'});
  assert.deepEqual(nextSort(second,'symbol'),first);
});

test('Portfolio sorting preserves row identity for security and removal actions', () => {
  const a={sec:'ASML US EQUITY',shares:10,value:16415.2}, b={sec:'GOOG US EQUITY',shares:2,value:3369.1}, c={sec:'PBR US EQUITY',shares:1,value:26};
  const original=[a,b,c];const shown=sortedRows(original,'value','asc');
  assert.strictEqual(shown[0],c);assert.strictEqual(shown[1],b);assert.strictEqual(shown[2],a);
  assert.deepEqual(original,[a,b,c]);
});
test('Portfolio missing metrics sort last and signed returns sort numerically', () => {
  const rows=[{sec:'A',pnl:null},{sec:'B',pnl:10},{sec:'C',pnl:-100},{sec:'D',pnl:0}];
  assert.deepEqual(sortedRows(rows,'pnl').map(r=>r.sec),['C','D','B','A']);
  assert.deepEqual(sortedRows(rows,'pnl','desc').map(r=>r.sec),['B','D','C','A']);
});
