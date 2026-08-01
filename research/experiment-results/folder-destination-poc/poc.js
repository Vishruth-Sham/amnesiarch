/* Dependency-free POC: parse "Describe destination" instructions and resolve
 * folder segments only among children of the already-resolved parent. */
const tree = {
  Learning: { AI: { "Machine Learning": {}, "Deep Learning": {}, "Natural Language Processing": {} }, Python: {}, Research: {} },
  Projects: { "AI Notes": {}, "API Design": {}, "Mobile App": {} },
  Work: { Meetings: {}, "Meeting Notes": {}, Planning: {}, "Client A": {}, "Client B": {} },
  Personal: { Finance: {}, Fitness: {} },
  Archive: {}
};

const cases = [
  // train: parser + resolver calibration
  ['t01','New folder abc under AI folder which is inside Learning',['Learning','AI','abc'],null,'create'],
  ['t02','new folder roadmap under projects',['Projects','roadmap'],null,'create'],
  ['t03','Create a note called Sprint Retro under Work/Meetings',['Work','Meetings'],'Sprint Retro','existing'],
  ['t04','Create note "Model Review" inside Learning > AI',['Learning','AI'],'Model Review','existing'],
  ['t05','New folder NLP under Learning / AI',['Learning','AI','NLP'],null,'create'],
  ['t06','new folder models inside ai inside learning',['Learning','AI','models'],null,'existing'],
  ['t07','New folder models under Lerningg/AI',['Learning','AI','models'],null,'create'],
  ['t08','New folder research-notes under Learning',['Learning','Research','research-notes'],null,'existing'],
  ['t09','New folder api specs under projects',['Projects','API Design','api specs'],null,'existing'],
  ['t10','New folder 2026 under personal',['Personal','2026'],null,'existing'],
  ['t11','Create "Budget" in Personal/Finance',['Personal','Finance'],'Budget','existing'],
  ['t12','Create note called "Design review" under Projects > API Design',['Projects','API Design'],'Design review','existing'],
  ['t13','New folder metings under Work',['Work','Meetings','metings'],null,'existing'],
  ['t14','New folder weights under Learning/AI/Machine Learning',['Learning','AI','Machine Learning','weights'],null,'existing'],
  ['t15','New folder archive-2025 under Archive',['Archive','archive-2025'],null,'existing'],
  ['t16','New folder deep-learning under Learning/AI',['Learning','AI','Deep Learning','deep-learning'],null,'existing'],
  ['t17','New folder fitness-log in Personal/Fitness',['Personal','Fitness','fitness-log'],null,'existing'],
  ['t18','Create note named Ideas under Projects/AI Notes',['Projects','AI Notes'],'Ideas','existing'],
  ['t19','New folder notebooks under Learning > AI > Natural Language Processing',['Learning','AI','Natural Language Processing','notebooks'],null,'existing'],
  ['t20','New folder abc under AI which is under Learning',['Learning','AI','abc'],null,'create'],
  // held-out normal + variants
  ['h01','New folder abc under AI folder which is inside Learning',['Learning','AI','abc'],null,'create'],
  ['h02','New folder ABC under learning / ai',['Learning','AI','ABC'],null,'existing'],
  ['h03','New folder transformer experiments under Natural Language Processing under AI under Learning',['Learning','AI','Natural Language Processing','transformer experiments'],null,'existing'],
  ['h04','Create note called Architecture under Projects/API Design',['Projects','API Design'],'Architecture','existing'],
  ['h05','Create a note named "weekly plan" in work / planning',['Work','Planning'],'weekly plan','existing'],
  ['h06','New folder experimnts under Lerning/AI',['Learning','AI','experimnts'],null,'existing'],
  ['h07','New folder Natrual Language Processing under Learning/AI',['Learning','AI','Natrual Language Processing'],null,'create'],
  ['h08','New folder mobile under projects/mobile app',['Projects','Mobile App','mobile'],null,'existing'],
  ['h09','New folder meeting prep under work/meetings',['Work','Meetings','meeting prep'],null,'existing'],
  ['h10','New folder jan under Personal/Finance',['Personal','Finance','jan'],null,'existing'],
  // ambiguity should never be auto-corrected
  ['h11','New folder agenda under client under Work',['Work','client','agenda'],null,'ambiguous'],
  ['h12','New folder ai under Projects',['Projects','ai'],null,'create'],
  ['h13','New folder research under Learning',['Learning','Research'],null,'collision'],
  ['h14','New folder app under Projects',['Projects','app'],null,'create'],
  // missing leaf intended create
  ['h15','New folder benchmarks under Learning/AI',['Learning','AI','benchmarks'],null,'create'],
  ['h16','New folder Q3 under Work/Planning',['Work','Planning','Q3'],null,'create'],
  ['h17','New folder recipes under Personal',['Personal','recipes'],null,'create'],
  ['h18','New folder receipts under Personal/Finance',['Personal','Finance','receipts'],null,'create'],
  // unsafe / invalid must reject
  ['h19','New folder secrets under ../Learning',null,null,'reject'],
  ['h20','New folder config under .obsidian',null,null,'reject'],
  ['h21','New folder system under /Learning',null,null,'reject'],
  ['h22','New folder bad:name under Learning',null,null,'reject'],
  // parser limitations/confirmation
  ['h23','Put it in Learning AI',['Learning AI','Put it'],null,'ambiguous'],
  ['h24','Make a folder for experiments',['experiments'],null,'confirm'],
  ['h25','Create notes under Learning',['Learning'],'notes','confirm'],
  ['h26','New folder abc beneath AI in Learning',['Learning','AI','abc'],null,'existing'],
  ['h27','Create "Roadmap" under project',['Projects'],'Roadmap','existing'],
  ['h28','New folder Maching Learning under Learning/AI',['Learning','AI','Maching Learning'],null,'create'],
  ['h29','New folder natural-language-processing under Learning/AI',['Learning','AI','Natural Language Processing'],null,'collision'],
  ['h30','Create note called "Ideas" under Personal > Fitness',['Personal','Fitness'],'Ideas','existing'],
];

function norm(s) { return s.toLowerCase().replace(/[-_]/g,' ').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim(); }
function lev(a,b) { a=norm(a); b=norm(b); const d=Array.from({length:a.length+1},(_,i)=>[i]); for(let j=1;j<=b.length;j++)d[0][j]=j; for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1)); return d[a.length][b.length]; }
function similarity(a,b) { const A=norm(a),B=norm(b); return 1-lev(A,B)/Math.max(A.length,B.length,1); }
function extractTitle(s) { const m=s.match(/(?:note\s+)?(?:called|named)\s+["']?([^"']+?)["']?(?=\s+(?:under|inside|in|within)|$)|create\s+(?:a\s+)?note\s+["']([^"']+)["']|create\s+["']([^"']+)["']\s+(?=under|inside|in|within)/i); return m ? (m[1]||m[2]||m[3]).trim() : null; }
function parse(raw) {
  if (/\.obsidian|(^|[\\/])\.\.?($|[\\/])|(^|\s)\.\.(?:\s|[\\/]|$)|^\s*\/|\b(?:under|inside|in|within)\s+\//i.test(raw) || /[:|?*]/.test(raw)) return {reject:true};
  const title=extractTitle(raw);
  const isFolder=/\bnew\s+folder\b|\bmake\s+(?:a\s+)?folder\b/i.test(raw);
  let s=raw.replace(/^(?:create|make|new)\s+(?:a\s+)?(?:note\s+)?(?:called|named)\s+["']?[^"']+?["']?\s+/i,'')
    .replace(/^create\s+(?:a\s+)?note\s+["'][^"']+["']\s+/i,'').replace(/^create\s+["'][^"']+["']\s+/i,'')
    .replace(/^(?:create|make|new)\s+(?:a\s+)?folder\s+/i,'').replace(/\bfolder\b/gi,'').trim();
  if (title && !isFolder) s=s.replace(/^(?:under|inside|in|within)\s+/i,'');
  // First use explicit slash / > hierarchy. Otherwise reverse chained "X under Y" relations.
  if (/[/>]/.test(s)) { const tail=s.match(/(?:under|inside|in|within)\s+(.+)$/i); const parent=(tail?tail[1]:s).split(/[/>]/).map(x=>x.trim()).filter(Boolean); const before=tail?s.slice(0,tail.index).trim():''; return {segments:isFolder&&before?[...parent,before]:parent, title,isFolder}; }
  const parts=s.split(/\s+(?:under|inside|within|beneath|in)\s+/i).map(x=>x.replace(/\bwhich\s+is\b/gi,'').trim()).filter(Boolean);
  if (parts.length>1) return {segments:parts.reverse(),title,isFolder,weak:/^create\s+notes\b/i.test(raw)};
  return {segments:parts,title, weak:!title || /^create\s+notes\b/i.test(raw),isFolder};
}
function resolveSegment(input, children, policy) {
  const exact=children.find(x=>norm(x)===norm(input)); if(exact) return {value:exact,kind:'exact'};
  const scored=children.map(x=>({x,d:lev(input,x),sim:similarity(input,x),prefix:norm(x).startsWith(norm(input))||norm(input).startsWith(norm(x))})).sort((a,b)=>a.d-b.d||b.sim-a.sim);
  const best=scored[0], next=scored[1]; if(!best) return {value:input,kind:'create'};
  const maxD=norm(input).length<=4?policy.short: norm(input).length<=8?policy.medium:policy.long;
  const eligible=best.d<=maxD && best.sim>=policy.minSim;
  const close=next && (next.d-best.d<=policy.margin || Math.abs(next.sim-best.sim)<0.08);
  if(eligible && !close) return {value:best.x,kind:'fuzzy'};
  if(eligible || (best.prefix && best.sim>=.55)) return {value:input,kind:'ambiguous', choices:scored.slice(0,3).map(x=>x.x)};
  return {value:input,kind:'create'};
}
function run(raw, policy) { const p=parse(raw); if(p.reject)return {status:'reject',plan:null,actions:[]}; let node=tree, plan=[], actions=[], status=p.weak?'confirm':'ok'; for(let i=0;i<p.segments.length;i++){const seg=p.segments[i], leaf=p.isFolder&&i===p.segments.length-1; let r;
    if(leaf) { const exact=Object.keys(node).find(x=>norm(x)===norm(seg)); r=exact?{value:exact,kind:'collision'}:{value:seg,kind:'create'}; }
    else r=resolveSegment(seg,Object.keys(node),policy);
    plan.push(r.value); actions.push(r.kind); if(r.kind==='ambiguous')status='ambiguous'; if(r.kind==='collision')status='collision'; if(r.kind==='create'){node={};}else node=node[r.value]||{};
  } return {status,plan,title:p.title,actions}; }
const policies=[
  {name:'strict',short:1,medium:1,long:2,minSim:.78,margin:1},
  {name:'balanced',short:1,medium:2,long:2,minSim:.72,margin:1},
  {name:'loose',short:1,medium:2,long:3,minSim:.65,margin:1},
];
function expectedStatus(c){return c[4]==='existing'||c[4]==='create'?'ok':c[4];}
// Explicit per-case expected resolver actions. e=exact, f=fuzzy, c=create,
// a=ambiguous, x=collision. This intentionally distinguishes a requested new
// leaf from a matched ancestor.
const actions = {
 t01:'eec',t02:'ec',t03:'ee',t04:'ee',t05:'eec',t06:'eec',t07:'fec',t08:'ec',t09:'ec',t10:'ec',t11:'ee',t12:'ee',t13:'ec',t14:'eeec',t15:'ec',t16:'eec',t17:'eec',t18:'ee',t19:'eeec',t20:'eec',
 h01:'eec',h02:'eec',h03:'eeec',h04:'ee',h05:'ee',h06:'fec',h07:'eec',h08:'eec',h09:'eec',h10:'eec',h11:'eac',h12:'ec',h13:'ex',h14:'ec',h15:'eec',h16:'eec',h17:'ec',h18:'eec',h19:'',h20:'',h21:'',h22:'',h23:'',h24:'',h25:'',h26:'eec',h27:'f',h28:'eec',h29:'eex',h30:'ee'
};
const overrides = {t08:['Learning','research-notes'],t09:['Projects','api specs'],t13:['Work','metings'],t16:['Learning','AI','deep-learning'],h06:['Learning','AI','experimnts'],h07:['Learning','AI','Natrual Language Processing'],h11:['Work','client','agenda'],h13:['Learning','Research'],h14:['Projects','app'],h28:['Learning','AI','Maching Learning'],h29:['Learning','AI','Natural Language Processing']};
const collisions = [
 ['h31','New folder AI under Learning',['Learning','AI'],null,'collision','ex'],
 ['h32','New folder Finance under Personal',['Personal','Finance'],null,'collision','ex'],
 ['h33','New folder API Design under Projects',['Projects','API Design'],null,'collision','ex'],
 ['h34','New folder archive under Archive',['Archive','archive'],null,'create','ec'],
];
cases.push(...collisions);
function wanted(c){const names={e:'exact',f:'fuzzy',c:'create',a:'ambiguous',x:'collision'}; return {status:expectedStatus(c),plan:overrides[c[0]]||c[2],title:c[3]||null,actions:(c[5]===undefined?actions[c[0]]:c[5]).split('').map(x=>names[x])};}
for(const policy of policies){for(const split of ['train','held']){const subset=cases.filter(c=>split==='train'?c[0][0]==='t':c[0][0]==='h');let correct=0,falseAuto=0,amb=0,parserOK=0,ancestorOK=0,leafOK=0;for(const c of subset){const r=run(c[1],policy), w=wanted(c), guarded=['reject','confirm','ambiguous'].includes(w.status), planOk=guarded||JSON.stringify(r.plan)===JSON.stringify(w.plan), titleOk=guarded||(r.title||null)===w.title, actionOk=guarded||JSON.stringify(r.actions)===JSON.stringify(w.actions), statOk=r.status===w.status; if(planOk&&titleOk&&actionOk&&statOk)correct++; if((guarded||w.status==='collision'||(!planOk&&w.status==='ok')) && r.status==='ok')falseAuto++; if(r.status==='ambiguous')amb++; if((r.status==='reject')===(w.status==='reject') && (!w.title || r.title===w.title))parserOK++; const ancestorN=w.actions.length-(['create','collision'].includes(w.actions.at(-1))?1:0); if(JSON.stringify(r.actions.slice(0,ancestorN))===JSON.stringify(w.actions.slice(0,ancestorN)))ancestorOK++; if(['create','collision'].includes(w.actions.at(-1)))if(r.actions.at(-1)===w.actions.at(-1))leafOK++;} console.log(`${policy.name} ${split}: exact=${correct}/${subset.length} parser=${parserOK}/${subset.length} ancestor=${ancestorOK}/${subset.length} leaf=${leafOK} false-auto=${falseAuto} ambiguity=${amb}`);}}
console.log('\nBalanced held-out details:'); for(const c of cases.filter(c=>c[0][0]==='h'))console.log(c[0], JSON.stringify(run(c[1],policies[1])), 'expected',c[4],JSON.stringify(c[2]),c[3]);
