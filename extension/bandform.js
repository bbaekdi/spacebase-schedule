// 밴드 '일정 만들기' 폼 자동 입력 도우미 — 로그인된 밴드 창 안에서만 실행됩니다.
// 밴드 화면이 바뀌어도 클래스명이 아니라 "화면에 보이는 글자(일정 제목, 시작, 완료 …)"로 찾습니다.
(()=>{
if(window.__bandAuto)return true;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=s=>(s||'').replace(/\s+/g,' ').trim();
const rect=e=>e.getBoundingClientRect();
const cy=e=>{const r=rect(e);return r.top+r.height/2;};
const vis=e=>{if(!e||!e.getBoundingClientRect)return false;const r=rect(e);if(r.width<2||r.height<2)return false;const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0';};
const onTop=e=>{const r=rect(e),t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!t&&(e===t||e.contains(t));};
const FIELD_SEL='input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea,[role=combobox],[role=listbox],[aria-haspopup],button';
const FIELDS={title:'일정 제목',desc:'일정 설명',place:'장소'};
const CHECKS={allDay:'하루 종일',lunar:'음력',attend:'참석 여부 확인',recruit:'신청자 모집',album:'일정 앨범 생성',share:'게시글로 공유'};
const ROWS={start:'시작',end:'종료',repeat:'반복 등록',alarm:'일정 알림'};

function byText(text,root=document.body){const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),out=[];for(let n;(n=w.nextNode());){if(norm(n.nodeValue)===text){const e=n.parentElement;if(e&&vis(e))out.push(e);}}return out;}
const clickable=e=>e.closest('a,button,[role=button],label,li')||e;
function realClick(e){e.scrollIntoView({block:'center'});const r=rect(e),o={bubbles:true,cancelable:true,view:window,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0};for(const t of ['pointerdown','mousedown','pointerup','mouseup','click']){const C=t.startsWith('pointer')&&window.PointerEvent?PointerEvent:MouseEvent;e.dispatchEvent(new C(t,o));}}
const attrIs=(e,text)=>[e.getAttribute('placeholder'),e.getAttribute('data-placeholder'),e.getAttribute('aria-label')].includes(text);

function formRoot(){
  const t=[...document.querySelectorAll('input,textarea,[contenteditable],[placeholder],[data-placeholder]')].find(e=>vis(e)&&attrIs(e,FIELDS.title));
  if(!t)return null;
  let r=t;for(let i=0;i<14&&r.parentElement;i++){r=r.parentElement;if(byText('완료',r).length&&byText(CHECKS.share,r).length)return r;}
  return document.body;
}
function field(key){
  const root=formRoot();if(!root)return null;
  const all=[...root.querySelectorAll('input,textarea,[contenteditable],[placeholder],[data-placeholder]')].filter(vis);
  let e=all.find(x=>attrIs(x,FIELDS[key]));
  if(!e&&key==='desc')e=all.filter(x=>x.tagName==='TEXTAREA'||x.isContentEditable).sort((a,b)=>rect(b).height-rect(a).height)[0];
  return e||null;
}
const read=e=>e?((e.tagName==='INPUT'||e.tagName==='TEXTAREA')?e.value:(e.innerText||'')).replace(/\u00a0/g,' ').trim():null;
const val=c=>!c?null:c.tagName==='SELECT'?norm(c.selectedOptions[0]?.textContent):(c.tagName==='INPUT'||c.tagName==='TEXTAREA')?c.value:norm(c.innerText||c.textContent);

function rowControls(label){
  const root=formRoot();if(!root)return [];const rr=rect(root);
  const L=byText(label,root).find(e=>rect(e).left<rr.left+rr.width*0.4);if(!L)return [];
  const y=cy(L),x=rect(L).right-4;
  const all=[...root.querySelectorAll(FIELD_SEL)].filter(e=>vis(e)&&Math.abs(cy(e)-y)<20&&rect(e).left>=x&&!L.contains(e)&&!(e.tagName!=='INPUT'&&rect(e).width<38&&rect(e).height<38&&!norm(e.textContent)));
  return all.filter(e=>!all.some(o=>o!==e&&e.contains(o))).sort((a,b)=>rect(a).left-rect(b).left);
}
function checkInfo(label){
  const root=formRoot();if(!root)return null;const t=byText(label,root)[0];if(!t)return null;
  const l=t.closest('label');let input=(l&&l.querySelector('input[type=checkbox]'))||(l&&l.htmlFor&&document.getElementById(l.htmlFor))||null;
  for(let p=t,i=0;!input&&p&&i<3;i++){p=p.parentElement;input=p&&p.querySelector('input[type=checkbox]');}
  return {t,input};
}
function isOn(c){
  if(c.input)return !!c.input.checked;
  for(let p=c.t,i=0;p&&i<4;i++,p=p.parentElement){const a=p.getAttribute('aria-checked');if(a!==null)return a==='true';if(/(^|[\s_-])(on|checked|active|selected)([\s_-]|$)/i.test(String(p.className)))return true;}
  return null;
}

async function open(){
  if(formRoot())return {ok:true};
  for(let i=0;i<40;i++){
    const hits=byText('일정 만들기');
    const b=hits.map(clickable).find(e=>/^(A|BUTTON)$/.test(e.tagName)||e.getAttribute('role')==='button')||hits[0];
    if(b){realClick(b);for(let j=0;j<30;j++){await sleep(250);if(formRoot())return {ok:true};}return {ok:false,reason:"'일정 만들기'를 눌렀지만 입력창이 열리지 않았습니다"};}
    await sleep(500);
  }
  return {ok:false,reason:"'일정 만들기' 버튼을 찾지 못했습니다 (로그인 상태 또는 밴드 화면 변경을 확인해 주세요)"};
}
function focus(key){
  const e=field(key);if(!e)return {ok:false,reason:`'${FIELDS[key]}' 입력칸을 찾지 못했습니다`};
  e.scrollIntoView({block:'center'});e.focus();if(e.select&&e.tagName!=='DIV')e.select();else{const s=getSelection();s.selectAllChildren(e);}
  return {ok:true};
}
function blur(){const root=formRoot();if(!root)return {ok:true};const h=byText('일정 만들기',root)[0]||root;realClick(h);if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();return {ok:true};}
async function check({key,value}){
  const c=checkInfo(CHECKS[key]);if(!c)return {ok:false,reason:`'${CHECKS[key]}' 항목을 찾지 못했습니다`};
  const now=isOn(c);if(now===value)return {ok:true};
  realClick(clickable(c.t));await sleep(200);
  const after=isOn(c);if(after!==null&&after!==value)return {ok:false,reason:`'${CHECKS[key]}' 항목을 바꾸지 못했습니다`};
  return {ok:true};
}
function focusDate(which){
  const c=rowControls(ROWS[which])[0];if(!c)return {ok:false,reason:`'${ROWS[which]}' 날짜 입력칸을 찾지 못했습니다`};
  const typable=c.tagName==='INPUT'&&!c.readOnly&&!c.disabled;c.scrollIntoView({block:'center'});c.focus();if(typable)c.select();else realClick(c);
  return {ok:true,typable};
}
const readDate=which=>val(rowControls(ROWS[which])[0]);
function dayPopup(){
  const leaves=[...document.querySelectorAll('td,button,a,span,div,li')].filter(e=>e.children.length===0&&/^\d{1,2}$/.test(norm(e.textContent))&&+norm(e.textContent)>=1&&+norm(e.textContent)<=31&&vis(e)&&onTop(e));
  if(leaves.length<28)return null;
  let a=leaves[0];while(a.parentElement&&leaves.filter(l=>a.contains(l)).length<28)a=a.parentElement;
  let h=a;for(let i=0;i<5&&h;i++,h=h.parentElement){const m=norm(h.innerText).match(/(20\d{2})\D{1,4}(\d{1,2})/);if(m)return {pop:a,head:h,y:+m[1],m:+m[2],leaves};}
  return {pop:a,head:a,y:null,m:null,leaves};
}
async function pickDate({which,date}){
  const [y,m,d]=date.split('-').map(Number),c=rowControls(ROWS[which])[0];if(!c)return {ok:false,reason:'날짜 입력칸을 찾지 못했습니다'};
  if(!dayPopup())realClick(c);await sleep(300);
  for(let i=0;i<36;i++){
    const p=dayPopup();if(!p)return {ok:false,reason:'날짜 선택창을 찾지 못했습니다'};
    if(p.y===null)return {ok:false,reason:'날짜 선택창의 연·월을 읽지 못했습니다'};
    const diff=(y-p.y)*12+(m-p.m);if(!diff)break;
    const want=diff>0?/next|after|forward|다음|right|›|»|>/i:/prev|before|back|이전|left|‹|«|</i;
    const btn=[...p.head.querySelectorAll('button,a,[role=button],span,i')].filter(vis).find(e=>want.test([e.getAttribute('aria-label'),e.getAttribute('title'),e.className&&String(e.className),norm(e.textContent)].join(' ')));
    if(!btn)return {ok:false,reason:'날짜 선택창의 월 이동 버튼을 찾지 못했습니다'};
    realClick(btn);await sleep(200);
  }
  const p=dayPopup();if(!p)return {ok:false,reason:'날짜 선택창을 찾지 못했습니다'};
  const cell=p.leaves.find(e=>norm(e.textContent)===String(d)&&!/(other|outside|disabled|prev|next|dim|out)/i.test(String(e.className)+' '+String(e.parentElement?.className)));
  if(!cell)return {ok:false,reason:`${d}일을 선택창에서 찾지 못했습니다`};
  realClick(clickable(cell));await sleep(250);return {ok:true};
}
async function pick(c,text){
  if(!c)return {ok:false,reason:'선택 상자를 찾지 못했습니다'};
  if(c.tagName==='SELECT'){const o=[...c.options].find(o=>norm(o.textContent)===text);if(!o)return {ok:false,reason:`'${text}' 항목이 밴드 목록에 없습니다`};c.value=o.value;c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};}
  if(val(c)===text)return {ok:true};
  const before=new Set(byText(text));realClick(c);await sleep(350);
  const hits=byText(text).filter(e=>!before.has(e)&&!c.contains(e));
  const t=hits.sort((a,b)=>Math.abs(cy(a)-cy(c))-Math.abs(cy(b)-cy(c)))[0];
  if(!t)return {ok:false,reason:`'${text}' 항목을 목록에서 찾지 못했습니다`};
  t.scrollIntoView({block:'nearest'});realClick(clickable(t));await sleep(250);
  if(val(c)!==text&&c.tagName!=='INPUT')return {ok:false,reason:`'${text}' 선택이 반영되지 않았습니다`};
  return {ok:true};
}
const setTime=({which,text})=>pick(rowControls(ROWS[which])[1],text);
const choose=({key,text})=>pick(rowControls(ROWS[key])[0],text);
function snapshot(){
  if(!formRoot())return {ok:false,reason:'일정 만들기 창이 열려 있지 않습니다'};
  const s=rowControls(ROWS.start),e=rowControls(ROWS.end),checks={};
  for(const k of Object.keys(CHECKS)){const c=checkInfo(CHECKS[k]);checks[k]=c?isOn(c):null;}
  return {ok:true,title:read(field('title')),desc:read(field('desc')),place:read(field('place')),start:[val(s[0]),val(s[1])],end:[val(e[0]),val(e[1])],repeat:val(rowControls(ROWS.repeat)[0]),alarm:val(rowControls(ROWS.alarm)[0]),checks};
}
function submit(){
  const root=formRoot();if(!root)return {ok:false,reason:'일정 만들기 창이 열려 있지 않습니다'};
  const hits=byText('완료',root);const b=hits.map(clickable).find(e=>/^(A|BUTTON)$/.test(e.tagName)||e.getAttribute('role')==='button')||hits[hits.length-1];
  if(!b)return {ok:false,reason:"'완료' 버튼을 찾지 못했습니다"};realClick(b);return {ok:true};
}
const closed=()=>({ok:true,closed:!formRoot()});
function alertText(){const e=[...document.querySelectorAll('[class*=toast],[class*=alert],[class*=error],[role=alert]')].filter(vis).map(x=>norm(x.textContent)).find(t=>t&&t.length<120);return e||'';}
function dump(){
  const root=formRoot();
  const desc=e=>({tag:e.tagName.toLowerCase(),type:e.type||'',ph:e.getAttribute('placeholder')||e.getAttribute('data-placeholder')||'',aria:e.getAttribute('aria-label')||'',cls:String(e.className||'').slice(0,80),text:norm(e.textContent).slice(0,40),value:(e.value||'').slice(0,40),ro:!!e.readOnly,ce:!!e.isContentEditable,r:['left','top','width','height'].map(k=>Math.round(rect(e)[k]))});
  return {hasForm:!!root,buttons:[...document.querySelectorAll('a,button,[role=button]')].filter(vis).map(e=>norm(e.textContent)).filter(t=>t&&t.length<30).slice(0,80),controls:root?[...root.querySelectorAll('input,textarea,select,button,[contenteditable],[role=combobox],[aria-haspopup],label')].filter(vis).map(desc):[],html:root?root.outerHTML.slice(0,150000):''};
}
window.__bandAuto={open,focus,blur,check,focusDate,readDate,pickDate,setTime,choose,read:snapshot,submit,closed,alertText,dump};
return true;
})();
