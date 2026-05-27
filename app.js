/* ══════════════════════════════════════════════════
   PICNOTE v1.0.0
   Multi-board (1-9) · URL images · Auto-sort · Share
   ══════════════════════════════════════════════════ */

/* ── IndexedDB ── */
const DB_NAME='VisionBoardDB', DB_VER=4, STORE='boards', META_STORE='meta';

/* ── DOM ── */
const board        = document.getElementById('board');
const boardWrapper = document.getElementById('boardWrapper');
const boardHint    = document.getElementById('boardHint');
const fileInput    = document.getElementById('fileInput');
const fileReplace  = document.getElementById('fileReplace');
const imgToolbar   = document.getElementById('imgToolbar');
const textModal    = document.getElementById('textModal');
const stickerModal = document.getElementById('stickerModal');
const urlModal     = document.getElementById('urlModal');
const shareModal   = document.getElementById('shareModal');
const saveStatus   = document.getElementById('saveStatus');
const toast        = document.getElementById('toast');

/* ── STATE ── */
let items     = [];
let selectedId= null;
let dragging  = null;
let resizing  = null;
let rotating  = null;
let editingId = null;
let zCtr      = 10;
let saveTimer = null;
let db        = null;
let boardH    = 900;
let pendingText = {};
let textMode  = 'add';
let currentBoard = 1;   // default board 1

const PAD_BTM   = 100;
const ZOOM_STEP = 1.20;
const POL_PAD   = 8;
const CAP_H     = 46;
const DEFAULT_CAP = 'YOU CAN DO IT';
const BOARD_COUNT = 9;

const STICKERS = [
  '⭐','🌟','✨','💫','🌙','☀️','🌸','🌺','🌻','🌹','🌷','🍀',
  '🦋','🕊️','🦁','🐉','🦄','🌊','🏔️','🌈','🔥','💎','🗝️','⚡',
  '❤️','💕','💖','💗','💝','🧡','💛','💚','💙','💜','🤍','🖤',
  '🎯','🏆','👑','🎨','✍️','📿','🪄','🎭','🎬','📚','💡','🚀',
  '🌿','🍃','🌱','🪴','🍁','🌾','🫧','🪨','🌋','🏝️','🌅',
  '💰','🎁','🏠','🚗','✈️','⛵','🎶','🎵','🎸','🎹','📷','🖼️',
  '🙏','💪','🤝','👐','✌️','🫶','💆','🧘','🏃','🎉','🥂',
];

/* ══════════════════════════════════
   INDEXEDDB — multi-board
   ══════════════════════════════════ */
function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if(!d.objectStoreNames.contains(STORE))      d.createObjectStore(STORE);
      if(!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE);
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}
const dbGet=(store,k)=>new Promise((res,rej)=>{
  const t=db.transaction(store,'readonly');const r=t.objectStore(store).get(k);
  r.onsuccess=e=>res(e.target.result);r.onerror=e=>rej(e.target.error);
});
const dbSet=(store,k,v)=>new Promise((res,rej)=>{
  const t=db.transaction(store,'readwrite');const r=t.objectStore(store).put(v,k);
  r.onsuccess=()=>res();r.onerror=e=>rej(e.target.error);
});
const dbGetAll=(store)=>new Promise((res,rej)=>{
  const t=db.transaction(store,'readonly');const r=t.objectStore(store).getAllKeys();
  r.onsuccess=e=>res(e.target.result);r.onerror=e=>rej(e.target.error);
});

/* Key per board */
const boardKey = n => `board_${n}`;

/* ══════════════════════════════════
   SAVE / LOAD per board
   ══════════════════════════════════ */
async function saveCurrentBoard(){
  if(!db) return;
  const payload = {
    items, bgClass: board.dataset.bg||'default', boardH,
    savedAt: Date.now()
  };
  await dbSet(STORE, boardKey(currentBoard), payload);
  showSaveOK();
  updateTabDots();
}

async function loadBoard(n){
  if(!db) return;
  /* clear current canvas */
  board.querySelectorAll('.board-item').forEach(e=>e.remove());
  items=[]; zCtr=10; boardH=900; selectedId=null;
  hideImgToolbar();

  try{
    const d = await dbGet(STORE, boardKey(n));
    if(d){
      if(d.bgClass) applyBg(d.bgClass); else applyBg('default');
      if(d.boardH)  boardH = Math.max(900, d.boardH);
      if(Array.isArray(d.items)){
        d.items.forEach(item=>{
          zCtr = Math.max(zCtr,(item.zIndex||10)+1);
          items.push(item); renderItem(item);
        });
      }
    } else {
      applyBg('default');
    }
  } catch(e){ console.warn('loadBoard err',e); }
  applyBoardHeight(); updateHint(); boardWrapper.scrollTop=0;
}

function debounceSave(){
  clearTimeout(saveTimer);
  saveStatus.textContent='Đang lưu…'; saveStatus.classList.add('saving');
  saveTimer = setTimeout(saveCurrentBoard, 700);
}
function showSaveOK(){
  saveStatus.textContent='Đã lưu ✓'; saveStatus.classList.remove('saving');
}

/* ══════════════════════════════════
   BOARD HEIGHT
   ══════════════════════════════════ */
const BOARD_MIN_H = 900; // minimum board height in px

function applyBoardHeight(){ board.style.minHeight = boardH+'px'; }

function expandIfNeeded(y, h){
  const need = y + h + PAD_BTM;
  if(need > boardH){ boardH = need; applyBoardHeight(); debounceSave(); }
}

/* Recalculate board height from ALL current item positions.
   Called after drag/resize/keyboard-nudge ends so board shrinks
   when items are moved upward. */
function recalcBoardHeight(){
  let maxY = BOARD_MIN_H;
  items.forEach(item => {
    const bottom = item.y + totalItemH(item) + PAD_BTM;
    if(bottom > maxY) maxY = bottom;
  });
  boardH = maxY;
  applyBoardHeight();
  debounceSave();
}

/* ══════════════════════════════════
   BOARD TABS
   ══════════════════════════════════ */
async function switchBoard(n){
  if(n===currentBoard) return;
  if(typeof gtag!=='undefined') gtag('event','switch_board',{from_board:currentBoard,to_board:n});
  await saveCurrentBoard();
  currentBoard = n;
  document.getElementById('currentBoardNum').textContent = n;
  document.querySelectorAll('#boardTabsInline .tab-btn').forEach(b=>{
    b.classList.toggle('active', +b.dataset.tab === n);
  });
  await loadBoard(n);
}

async function updateTabDots(){
  if(!db) return;
  try{
    const keys = await dbGetAll(STORE);
    document.querySelectorAll('#boardTabsInline .tab-btn').forEach(b=>{
      const n = +b.dataset.tab;
      const hasData = keys.includes(boardKey(n));
      b.classList.toggle('has-content', hasData);
    });
  } catch(e){}
}

document.getElementById('boardTabsInline').addEventListener('click', e=>{
  const btn = e.target.closest('.tab-btn');
  if(!btn) return;
  switchBoard(+btn.dataset.tab);
});

/* ══════════════════════════════════
   ITEMS
   ══════════════════════════════════ */
const makeId=()=>'i'+Date.now()+Math.random().toString(36).slice(2,5);

function addItem(item){
  items.push(item); renderItem(item); selectItem(item.id);
  expandIfNeeded(item.y, totalItemH(item));
  updateHint(); debounceSave();
}

function totalItemH(item){
  /* Full visual height of polaroid: top-pad + image + caption-bar */
  if(item.type==='image') return POL_PAD + item.h + CAP_H;
  return item.h||60;
}

function renderItem(item){
  const el = document.createElement('div');
  el.className = `board-item type-${item.type}`;
  el.dataset.id = item.id;
  el.style.cssText=`left:${item.x}px;top:${item.y}px;z-index:${item.zIndex||10};transform:rotate(${item.rotation||0}deg)`;

  if(item.type==='image')   buildPolaroid(el,item);
  else if(item.type==='text'){
    const inner=document.createElement('div');
    inner.className='text-inner'; applyTextStyle(inner,item.data);
    inner.textContent=item.data.text; el.appendChild(inner);
  } else if(item.type==='sticker'){
    el.textContent=item.data.emoji; el.style.fontSize=(item.w||60)+'px';
  }

  const rh=document.createElement('div');
  rh.className='rotate-handle'; rh.textContent='↻'; rh.dataset.action='rotate';
  el.appendChild(rh);

  /* All items get resize handles */
  ['nw','ne','sw','se'].forEach(d=>{
    const h=document.createElement('div');
    h.className=`resize-handle ${d}`; h.dataset.action='resize'; h.dataset.dir=d;
    el.appendChild(h);
  });
  board.appendChild(el);
}

function buildPolaroid(el,item){
  const cap = item.caption||{};
  const pol = document.createElement('div');
  pol.className='polaroid';
  pol.style.background = cap.frameColor||'#f5efe6';
  pol.style.width = (item.w+POL_PAD*2)+'px';

  const frame = document.createElement('div');
  frame.className='image-frame';
  frame.style.width=item.w+'px'; frame.style.height=item.h+'px';

  const img = document.createElement('img');
  img.src = item.data.src; img.draggable=false;
  if(item.data.flipped) img.classList.add('flipped');
  /* mark URL-sourced images */
  if(item.data.isUrl) img.dataset.isUrl='1';
  frame.appendChild(img); pol.appendChild(frame);

  const bar = document.createElement('div');
  bar.className='pol-caption-bar';
  const capEl = document.createElement('div');
  capEl.className='pol-caption'; capEl.contentEditable='true'; capEl.spellcheck=false;
  capEl.textContent = cap.text||DEFAULT_CAP;
  capEl.style.fontSize=(cap.fontSize||16)+'px';
  capEl.style.color=cap.color||'#2a1f0f';
  capEl.style.fontFamily=cap.fontFamily||"'Mulish',sans-serif";
  capEl.addEventListener('mousedown',e=>e.stopPropagation());
  capEl.addEventListener('blur',()=>{
    const it=items.find(i=>i.id===el.dataset.id); if(!it) return;
    it.caption=it.caption||{};
    const txt=capEl.textContent.trim();
    it.caption.text=txt||DEFAULT_CAP;
    if(!txt) capEl.textContent=DEFAULT_CAP;
    debounceSave();
  });
  capEl.addEventListener('keydown',e=>{ if(e.key==='Escape'){capEl.blur();} }); // Enter = new line
  bar.appendChild(capEl); pol.appendChild(bar); el.appendChild(pol);
}

function updateItemDOM(id){
  const item=items.find(i=>i.id===id); if(!item) return;
  const el=board.querySelector(`[data-id="${id}"]`); if(!el) return;
  el.style.left=item.x+'px'; el.style.top=item.y+'px';
  el.style.transform=`rotate(${item.rotation||0}deg)`;
  el.style.zIndex=item.zIndex||10;
  if(item.type==='image'){
    const pol=el.querySelector('.polaroid');
    const frame=el.querySelector('.image-frame');
    const img=el.querySelector('img');
    const capEl=el.querySelector('.pol-caption');
    if(pol){pol.style.width=(item.w+POL_PAD*2)+'px';pol.style.background=item.caption?.frameColor||'#f5efe6';}
    if(frame){frame.style.width=item.w+'px';frame.style.height=item.h+'px';}
    if(img){img.src=item.data.src;img.classList.toggle('flipped',!!item.data.flipped);}
    if(capEl&&!capEl.matches(':focus')){
      const c=item.caption||{};
      capEl.textContent=c.text||DEFAULT_CAP;
      capEl.style.fontSize=(c.fontSize||16)+'px';
      capEl.style.color=c.color||'#2a1f0f';
      capEl.style.fontFamily=c.fontFamily||"'Mulish',sans-serif";
    }
  } else if(item.type==='text'){
    const inner=el.querySelector('.text-inner');
    if(inner){inner.textContent=item.data.text;applyTextStyle(inner,item.data);}
  } else if(item.type==='sticker'){
    el.style.fontSize=(item.w||60)+'px';
  }
}

function applyTextStyle(el,d){
  el.style.color=d.color||'#f5f0e8'; el.style.fontSize=(d.fontSize||24)+'px';
  el.style.fontFamily=d.fontFamily||"'Cormorant Garamond',serif";
  el.style.fontWeight=d.bold?'bold':'normal';
  el.style.fontStyle=d.italic?'italic':'normal';
  el.style.textDecoration=d.underline?'underline':'none';
  el.style.background=d.bg||'transparent';
  if(d.bg&&d.bg!=='transparent'){el.style.padding='6px 12px';el.style.borderRadius='2px';}
}

function updateHint(){boardHint.classList.toggle('hidden',items.length>0);}

/* ══════════════════════════════════
   SELECTION & IMG TOOLBAR
   ══════════════════════════════════ */
function selectItem(id){
  if(selectedId===id) return;
  deselectAll(); selectedId=id;
  const el=board.querySelector(`[data-id="${id}"]`);
  if(el) el.classList.add('selected');
  const item=items.find(i=>i.id===id);
  if(item&&item.type==='image') showImgToolbar(el); else hideImgToolbar();
}
function deselectAll(){
  selectedId=null;
  board.querySelectorAll('.board-item.selected').forEach(e=>e.classList.remove('selected'));
  hideImgToolbar();
}
function showImgToolbar(el){ if(!el) return; imgToolbar.classList.add('visible'); positionToolbar(el); }
function hideImgToolbar(){ imgToolbar.classList.remove('visible'); }
function positionToolbar(el){
  if(!el) return;
  const er=el.getBoundingClientRect(); const tbH=imgToolbar.offsetHeight||46; const m=8;
  let top=er.top-tbH-m; if(top<6) top=er.bottom+m;
  imgToolbar.style.left=(er.left+er.width/2)+'px'; imgToolbar.style.top=top+'px';
}

/* ══════════════════════════════════
   DRAG / RESIZE / ROTATE
   (Mouse + Touch unified)
   ══════════════════════════════════ */
function getBoardPos(cx,cy){ const r=board.getBoundingClientRect(); return{x:cx-r.left,y:cy-r.top}; }

/* Extract {clientX, clientY} from either a MouseEvent or a TouchEvent */
function getEventXY(e){
  if(e.touches && e.touches.length>0)  return {x:e.touches[0].clientX,    y:e.touches[0].clientY};
  if(e.changedTouches && e.changedTouches.length>0) return {x:e.changedTouches[0].clientX, y:e.changedTouches[0].clientY};
  return {x:e.clientX, y:e.clientY};
}

board.addEventListener('mousedown',  onBoardDown);
board.addEventListener('touchstart', onBoardDown, {passive:false});

function onBoardDown(e){
  const {x:clientX, y:clientY} = getEventXY(e);
  const target=e.target; const itemEl=target.closest('.board-item');
  if(!itemEl){deselectAll();return;}
  const id=itemEl.dataset.id; const item=items.find(i=>i.id===id); if(!item) return;
  if(target.closest('.pol-caption')) return;
  selectItem(id);
  if(target.dataset.action==='rotate'){
    e.preventDefault();
    const r=itemEl.getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;
    rotating={id,cx,cy,start:Math.atan2(clientY-cy,clientX-cx)*180/Math.PI,init:item.rotation||0};
    return;
  }
  if(target.dataset.action==='resize'){
    e.preventDefault();
    const pos=getBoardPos(clientX,clientY);
    resizing={id,dir:target.dataset.dir,mx:pos.x,my:pos.y,
      sw:item.w,sh:item.h,sx:item.x,sy:item.y,
      ratio:item.type==='image'?item.w/item.h:null};
    return;
  }
  /* Drag — allow for both mouse left-button and any touch */
  const isTouch = e.type === 'touchstart';
  if(isTouch || e.button===0){
    e.preventDefault();
    const pos=getBoardPos(clientX,clientY);
    dragging={id,offX:pos.x-item.x,offY:pos.y-item.y};
    itemEl.classList.add('dragging'); item.zIndex=++zCtr; itemEl.style.zIndex=zCtr;
  }
}

document.addEventListener('mousemove',  onMouseMove);
document.addEventListener('touchmove',  onMouseMove, {passive:false});
document.addEventListener('mouseup',    onMouseUp);
document.addEventListener('touchend',   onMouseUp);
document.addEventListener('touchcancel',onMouseUp);

function onMouseMove(e){
  if(!dragging && !resizing && !rotating) return;
  e.preventDefault(); // prevent page scroll while dragging on mobile
  const {x:clientX, y:clientY} = getEventXY(e);

  if(dragging){
    const item=items.find(i=>i.id===dragging.id); if(!item) return;
    const pos=getBoardPos(clientX,clientY);
    item.x=Math.max(0,pos.x-dragging.offX); item.y=Math.max(0,pos.y-dragging.offY);
    updateItemDOM(item.id); expandIfNeeded(item.y,totalItemH(item));
    if(item.type==='image') positionToolbar(board.querySelector(`[data-id="${item.id}"]`));
    debounceSave();
  }
  if(resizing){
    const item=items.find(i=>i.id===resizing.id); if(!item) return;
    const pos=getBoardPos(clientX,clientY);
    const dx=pos.x-resizing.mx,dy=pos.y-resizing.my,dir=resizing.dir;
    let nW=resizing.sw,nH=resizing.sh,nX=resizing.sx,nY=resizing.sy;
    if(resizing.ratio){
      let delta=0;
      if(dir==='se') delta=(dx+dy)/2;
      if(dir==='sw') delta=(-dx+dy)/2;
      if(dir==='ne') delta=(dx-dy)/2;
      if(dir==='nw') delta=-(dx+dy)/2;
      nW=Math.max(60,resizing.sw+delta); nH=Math.round(nW/resizing.ratio);
      if(dir==='nw'){nX=resizing.sx+(resizing.sw-nW);nY=resizing.sy+(resizing.sh-nH);}
      if(dir==='sw') nX=resizing.sx+(resizing.sw-nW);
      if(dir==='ne') nY=resizing.sy+(resizing.sh-nH);
    } else {
      if(dir.includes('e'))  nW=Math.max(60,resizing.sw+dx);
      if(dir.includes('s'))  nH=Math.max(30,resizing.sh+dy);
      if(dir.includes('w')){nW=Math.max(60,resizing.sw-dx);nX=resizing.sx+resizing.sw-nW;}
      if(dir.includes('n')){nH=Math.max(30,resizing.sh-dy);nY=resizing.sy+resizing.sh-nH;}
    }
    item.w=nW;item.h=nH;item.x=nX;item.y=nY;
    updateItemDOM(item.id); expandIfNeeded(item.y,totalItemH(item));
    if(item.type==='image') positionToolbar(board.querySelector(`[data-id="${item.id}"]`));
    debounceSave();
  }
  if(rotating){
    const item=items.find(i=>i.id===rotating.id); if(!item) return;
    const a=Math.atan2(clientY-rotating.cy,clientX-rotating.cx)*180/Math.PI;
    item.rotation=rotating.init+(a-rotating.start);
    updateItemDOM(item.id);
    if(item.type==='image') positionToolbar(board.querySelector(`[data-id="${item.id}"]`));
    debounceSave();
  }
}
function onMouseUp(){
  const wasDragging  = !!dragging;
  const wasResizing  = !!resizing;
  const wasRotating  = !!rotating;
  if(dragging){board.querySelector(`[data-id="${dragging.id}"]`)?.classList.remove('dragging');dragging=null;}
  resizing=null; rotating=null;
  if(wasDragging || wasResizing || wasRotating) recalcBoardHeight();
}

/* ══════════════════════════════════
   IMAGE TOOLBAR ACTIONS
   ══════════════════════════════════ */
document.getElementById('itbRotate').addEventListener('click',()=>{
  const item=items.find(i=>i.id===selectedId); if(!item) return;
  item.rotation=((item.rotation||0)+15)%360;
  updateItemDOM(item.id); positionToolbar(board.querySelector(`[data-id="${item.id}"]`)); debounceSave();
});
document.getElementById('itbFlip').addEventListener('click',()=>{
  const item=items.find(i=>i.id===selectedId); if(!item||item.type!=='image') return;
  item.data.flipped=!item.data.flipped; updateItemDOM(item.id); debounceSave(); showToast('Đã lật ảnh');
});
document.getElementById('itbZoomIn').addEventListener('click',()=>{
  const item=items.find(i=>i.id===selectedId); if(!item||item.type!=='image') return;
  item.w=Math.round(item.w*ZOOM_STEP); item.h=Math.round(item.h*ZOOM_STEP);
  updateItemDOM(item.id); expandIfNeeded(item.y,totalItemH(item));
  positionToolbar(board.querySelector(`[data-id="${item.id}"]`)); debounceSave();
});
document.getElementById('itbZoomOut').addEventListener('click',()=>{
  const item=items.find(i=>i.id===selectedId); if(!item||item.type!=='image') return;
  item.w=Math.max(60,Math.round(item.w/ZOOM_STEP)); item.h=Math.max(40,Math.round(item.h/ZOOM_STEP));
  updateItemDOM(item.id); positionToolbar(board.querySelector(`[data-id="${item.id}"]`)); debounceSave();
});
document.getElementById('itbDelete').addEventListener('click',()=>{ if(selectedId) deleteItem(selectedId); });

document.getElementById('itbReplace').addEventListener('click',()=>{ editingId=selectedId; fileReplace.click(); });
fileReplace.addEventListener('change',e=>{
  const file=e.target.files[0]; if(!file) return; fileReplace.value='';
  const reader=new FileReader();
  reader.onload=ev=>{
    const item=items.find(i=>i.id===editingId); if(!item||item.type!=='image') return;
    const img=new Image();
    img.onload=()=>{
      item.data.src=ev.target.result; item.data.flipped=false;
      item.data.isUrl=false;
      item.h=Math.round(item.w/(img.naturalWidth/img.naturalHeight));
      updateItemDOM(item.id); positionToolbar(board.querySelector(`[data-id="${item.id}"]`));
      debounceSave(); showToast('Đã thay ảnh ✓');
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
});

/* ══════════════════════════════════
   ADD IMAGE — local file
   ══════════════════════════════════ */
document.getElementById('btnAddImage').addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',e=>{Array.from(e.target.files).forEach(loadImageFile);fileInput.value='';});

function loadImageFile(file){
  const reader=new FileReader();
  reader.onload=ev=>{
    const src=ev.target.result; const img=new Image();
    img.onload=()=>{
      const bw=boardWrapper.clientWidth; const maxW=Math.min(320,bw*0.28); const maxH=440;
      let w=img.naturalWidth,h=img.naturalHeight; const ratio=w/h;
      if(w>maxW){w=maxW;h=w/ratio;} if(h>maxH){h=maxH;w=h*ratio;}
      w=Math.round(w);h=Math.round(h);
      addItem({id:makeId(),type:'image',
        x:Math.round(40+Math.random()*Math.max(0,bw-w-100)),
        y:Math.round(50+Math.random()*220),
        w,h,rotation:(Math.random()-.5)*6,zIndex:++zCtr,
        data:{src,flipped:false,isUrl:false},
        caption:{text:DEFAULT_CAP,fontSize:16,color:'#2a1f0f',frameColor:'#f5efe6',fontFamily:"'Mulish',sans-serif"}});
    };
    img.src=src;
  };
  reader.readAsDataURL(file);
}

board.addEventListener('dragover',e=>{e.preventDefault();board.classList.add('drag-over');});
board.addEventListener('dragleave',()=>board.classList.remove('drag-over'));
board.addEventListener('drop',e=>{
  e.preventDefault();board.classList.remove('drag-over');
  Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/')).forEach(loadImageFile);
});

/* ══════════════════════════════════
   ADD IMAGE — from URL
   ══════════════════════════════════ */
document.getElementById('btnAddUrl').addEventListener('click',()=>{
  document.getElementById('urlInput').value='';
  urlModal.classList.add('open');
  setTimeout(()=>document.getElementById('urlInput').focus(),100);
});
document.getElementById('urlModalClose').addEventListener('click',()=>urlModal.classList.remove('open'));
document.getElementById('urlModalCancel').addEventListener('click',()=>urlModal.classList.remove('open'));
urlModal.addEventListener('click',e=>{if(e.target===urlModal) urlModal.classList.remove('open');});

document.getElementById('urlModalAdd').addEventListener('click',()=>{
  const url=document.getElementById('urlInput').value.trim();
  if(!url){showToast('Vui lòng nhập URL');return;}
  showToast('Đang tải ảnh…');

  /* Try loading directly first; if CORS blocks, use a proxy */
  function tryLoad(src, attempt){
    const img=new Image();
    if(attempt===0) img.crossOrigin='anonymous';
    img.onload=()=>{
      const bw=boardWrapper.clientWidth; const maxW=Math.min(320,bw*0.28); const maxH=440;
      let w=img.naturalWidth||300,h=img.naturalHeight||300; const ratio=w/h;
      if(w>maxW){w=maxW;h=w/ratio;} if(h>maxH){h=maxH;w=h*ratio;}
      w=Math.round(w);h=Math.round(h);
      addItem({id:makeId(),type:'image',
        x:Math.round(40+Math.random()*Math.max(0,bw-w-100)),
        y:Math.round(50+Math.random()*220),
        w,h,rotation:(Math.random()-.5)*6,zIndex:++zCtr,
        data:{src:url,flipped:false,isUrl:true,originalUrl:url},
        caption:{text:DEFAULT_CAP,fontSize:16,color:'#2a1f0f',frameColor:'#f5efe6',fontFamily:"'Mulish',sans-serif"}});
      urlModal.classList.remove('open');
      showToast('Đã thêm ảnh từ URL ✓');
    };
    img.onerror=()=>{
      if(attempt===0){
        /* retry without crossOrigin */
        tryLoad(url, 1);
      } else if(attempt===1){
        /* try corsproxy */
        const proxy='https://corsproxy.io/?'+encodeURIComponent(url);
        tryLoadProxy(proxy);
      } else {
        /* all failed — add as URL-only, dimensions unknown */
        showToast('⚠️ Không thể xác nhận ảnh — thêm trực tiếp qua URL');
        addUrlItemDirect(url);
        urlModal.classList.remove('open');
      }
    };
    img.src=src;
  }

  function tryLoadProxy(proxySrc){
    const img=new Image();
    img.onload=()=>{
      const bw=boardWrapper.clientWidth; const maxW=Math.min(320,bw*0.28); const maxH=440;
      let w=img.naturalWidth||300,h=img.naturalHeight||300; const ratio=w/h;
      if(w>maxW){w=maxW;h=w/ratio;} if(h>maxH){h=maxH;w=h*ratio;}
      w=Math.round(w);h=Math.round(h);
      addItem({id:makeId(),type:'image',
        x:Math.round(40+Math.random()*Math.max(0,bw-w-100)),
        y:Math.round(50+Math.random()*220),
        w,h,rotation:(Math.random()-.5)*6,zIndex:++zCtr,
        /* store original URL so share link works */
        data:{src:url,flipped:false,isUrl:true,originalUrl:url},
        caption:{text:DEFAULT_CAP,fontSize:16,color:'#2a1f0f',frameColor:'#f5efe6',fontFamily:"'Mulish',sans-serif"}});
      urlModal.classList.remove('open');
      showToast('Đã thêm ảnh từ URL ✓ (via proxy)');
    };
    img.onerror=()=>{ addUrlItemDirect(url); urlModal.classList.remove('open'); };
    img.src=proxySrc;
  }

  function addUrlItemDirect(url){
    const bw=boardWrapper.clientWidth; const w=280; const h=200;
    addItem({id:makeId(),type:'image',
      x:Math.round(40+Math.random()*Math.max(0,bw-w-100)),
      y:Math.round(50+Math.random()*220),
      w,h,rotation:(Math.random()-.5)*6,zIndex:++zCtr,
      data:{src:url,flipped:false,isUrl:true,originalUrl:url},
      caption:{text:DEFAULT_CAP,fontSize:16,color:'#2a1f0f',frameColor:'#f5efe6',fontFamily:"'Mulish',sans-serif"}});
    showToast('Đã thêm (ảnh có thể không hiển thị do CORS)');
  }

  tryLoad(url, 0);
});
document.getElementById('urlInput').addEventListener('keydown',e=>{
  if(e.key==='Enter') document.getElementById('urlModalAdd').click();
});

/* ══════════════════════════════════
   AUTO SORT — Pinterest masonry
   ══════════════════════════════════ */
document.getElementById('btnAutoSort').addEventListener('click',()=>autoSort(items, true));

function autoSort(itemList, save=false){
  const imgItems = itemList.filter(i=>i.type==='image');
  if(!imgItems.length){showToast('Không có ảnh để sắp xếp');return;}

  const bw = boardWrapper.clientWidth - 20;
  /* random column count 2-4 */
  const cols = 2 + Math.floor(Math.random()*3);
  const gap  = 20;
  const margin = 20;
  const colW = Math.floor((bw - margin*2 - gap*(cols-1)) / cols);

  /* shuffle */
  const shuffled = [...imgItems].sort(()=>Math.random()-.5);

  /* track column heights */
  const colH = Array(cols).fill(margin + 80);

  shuffled.forEach(item=>{
    /* pick shortest column */
    const col = colH.indexOf(Math.min(...colH));
    const newW = colW;
    const newH = Math.round(newW / (item.w/item.h));
    item.x = margin + col*(colW+gap);
    item.y = colH[col];
    item.w = newW;
    item.h = newH;
    item.rotation = 0;
    colH[col] += newH + CAP_H + POL_PAD + gap;
    updateItemDOM(item.id);
  });

  /* recalc board height — always update after sort */
  const maxY = Math.max(...colH) + 40;
  boardH = maxY;
  applyBoardHeight();

  if(save) debounceSave();
  showToast(`Auto Sort: ${cols} cột ✓`);
  if(typeof gtag!=='undefined') gtag('event','auto_sort',{board_number:currentBoard,columns:cols,item_count:imgItems.length});
}

/* ══════════════════════════════════
   SHARE — v0.0.6
   ══════════════════════════════════ */
document.getElementById('btnShare').addEventListener('click', openShareModal);

let shareFilter = 'all'; // 'url' | 'local' | 'all'

function openShareModal(){
  document.getElementById('shareBoardNum').textContent = currentBoard;

  const allImg   = items.filter(i => i.type === 'image');
  const urlCount = allImg.filter(i =>  i.data.isUrl).length;
  const locCount = allImg.filter(i => !i.data.isUrl).length;
  const hasMixed = urlCount > 0 && locCount > 0;

  /* Show/hide filter tabs: only when board has BOTH types */
  const filterRow = document.getElementById('shareFilterRow');
  filterRow.style.display = hasMixed ? 'flex' : 'none';

  /* Default filter logic */
  if(!hasMixed){
    /* Only one type — auto-select it, no tabs needed */
    shareFilter = (urlCount > 0) ? 'url' : 'local';
  } else {
    /* Mixed board — default to URL tab */
    shareFilter = 'url';
  }

  /* Sync active tab */
  document.querySelectorAll('.share-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.filter === shareFilter)
  );

  refreshSharePreview();
  shareModal.classList.add('open');
}

/* Wire up filter tabs */
document.querySelectorAll('.share-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    shareFilter = tab.dataset.filter;
    document.querySelectorAll('.share-tab').forEach(t =>
      t.classList.toggle('active', t === tab)
    );
    refreshSharePreview();
  });
});

function getFilteredImgItems(){
  const imgItems = items.filter(i => i.type === 'image');
  if(shareFilter === 'url')   return imgItems.filter(i =>  i.data.isUrl);
  if(shareFilter === 'local') return imgItems.filter(i => !i.data.isUrl);
  return imgItems; // 'all'
}

function refreshSharePreview(){
  const grid = document.getElementById('shareGrid');
  const note = document.getElementById('shareNote');
  grid.innerHTML = '';

  const filtered  = getFilteredImgItems();
  const allImg    = items.filter(i => i.type === 'image');
  const urlCount  = allImg.filter(i =>  i.data.isUrl).length;
  const locCount  = allImg.filter(i => !i.data.isUrl).length;
  const labels    = { url: 'Ảnh URL', local: 'Ảnh local', all: 'Tất cả ảnh' };

  note.textContent = filtered.length
    ? `${labels[shareFilter]}: ${filtered.length} ảnh · Board: ${urlCount} URL + ${locCount} local`
    : '';

  if(!filtered.length){
    const emptyMsg = { url:'Board này chưa có ảnh URL.', local:'Board này chưa có ảnh local.', all:'Không có ảnh để chia sẻ.' };
    grid.innerHTML = `<div class="share-empty">${emptyMsg[shareFilter]}</div>`;
    return;
  }

  /* Masonry preview 3 cols — only filtered items, no gaps */
  const cols   = 3;
  const colEls = [];
  for(let c = 0; c < cols; c++){
    const col = document.createElement('div');
    col.style.cssText = 'display:inline-block;width:100%;vertical-align:top;';
    colEls.push(col);
  }
  const colH = Array(cols).fill(0);

  filtered.forEach(item => {
    const col  = colH.indexOf(Math.min(...colH));
    const card = document.createElement('div');
    card.className = 'share-card';

    const imgEl = document.createElement('img');
    imgEl.src     = item.data.src;
    imgEl.alt     = '';
    imgEl.loading = 'lazy';
    imgEl.onerror = () => { imgEl.style.display = 'none'; };

    const cap = document.createElement('div');
    cap.className   = 'share-cap';
    cap.textContent = (item.caption && item.caption.text) || DEFAULT_CAP;

    card.appendChild(imgEl);
    card.appendChild(cap);
    colEls[col].appendChild(card);
    colH[col] += (item.h || 200) + 60;
  });
  colEls.forEach(c => grid.appendChild(c));
}

/* ── Generate filename from current datetime ── */
function makeSharingFilename(){
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `sharing_${yy}${mm}${dd}_${hh}${mi}.html`;
}

/* ── Build masonry layout for filtered items (export only, board unchanged) ── */
function buildMasonryLayout(filteredImgItems, boardWidth){
  if(!filteredImgItems.length) return [];

  const gap     = 20;
  const margin  = 20;
  const cols    = Math.min(3, filteredImgItems.length);
  const colW    = Math.floor((boardWidth - margin * 2 - gap * (cols - 1)) / cols);
  const colH    = Array(cols).fill(margin + 60); // top offset
  const layout  = [];

  filteredImgItems.forEach(item => {
    const col  = colH.indexOf(Math.min(...colH));
    const newW = colW;
    const newH = Math.round(newW / Math.max(item.w / item.h, 0.1));
    layout.push({
      ...item,
      x: margin + col * (colW + gap),
      y: colH[col],
      w: newW,
      h: newH,
      rotation: 0, // no rotation in sorted export
    });
    colH[col] += newH + CAP_H + POL_PAD + gap;
  });

  return layout;
}

/* ── Build complete standalone HTML for the board ── */
function buildSharingHTML(filterMode){
  filterMode = filterMode || 'all';

  const bgColors = {
    default:'#1a1510', black:'#000000', warm:'#3a2518',
    cream:'#f0ebe0',   slate:'#1c2333', forest:'#1a2416', rose:'#2d1c1c',
  };
  const bgColor   = bgColors[board.dataset.bg || 'default'] || '#1a1510';
  const gridColor = (board.dataset.bg === 'cream')
    ? 'rgba(100,80,40,0.07)' : 'rgba(201,169,110,0.06)';

  const filterLabels = { url:'Ảnh URL', local:'Ảnh local', all:'Tất cả ảnh' };

  const allImg    = items.filter(i => i.type === 'image');
  const urlCount  = allImg.filter(i =>  i.data.isUrl).length;
  const locCount  = allImg.filter(i => !i.data.isUrl).length;
  const hasMixed  = urlCount > 0 && locCount > 0;

  /* Determine which image items to include */
  let imgItems;
  if(filterMode === 'url')   imgItems = allImg.filter(i =>  i.data.isUrl);
  else if(filterMode === 'local') imgItems = allImg.filter(i => !i.data.isUrl);
  else imgItems = allImg;

  const boardWidth = boardWrapper.clientWidth || 1200;

  /*
   * Layout strategy:
   * - "all" or single-type board → preserve original absolute positions
   * - "url" or "local" on mixed board → re-layout as masonry (no gaps from missing items)
   */
  const needsRelayout = hasMixed && (filterMode === 'url' || filterMode === 'local');
  const imgLayout     = needsRelayout
    ? buildMasonryLayout(imgItems, boardWidth)
    : imgItems; // keep original positions

  /* Map id → layout item for fast lookup */
  const layoutMap = {};
  imgLayout.forEach(li => { layoutMap[li.id] = li; });

  /* Also include non-image items (text, stickers) unless we're doing a filtered-image-only export */
  /* They keep original positions always */
  const textAndStickers = items.filter(i => i.type !== 'image');

  /* Collect all items sorted by zIndex */
  const sorted = [
    ...imgLayout,
    ...textAndStickers,
  ].sort((a,b) => (a.zIndex||0) - (b.zIndex||0));

  /* Calculate board height from laid-out items */
  let bh = 600;
  imgLayout.forEach(it => { bh = Math.max(bh, it.y + totalItemH(it) + 80); });
  textAndStickers.forEach(it => { bh = Math.max(bh, it.y + (it.h||60) + 80); });

  /* Build HTML for each item */
  let itemsHTML = '';
  sorted.forEach(item => {
    const rot       = item.rotation || 0;
    const transform = `rotate(${rot}deg)`;

    if(item.type === 'image'){
      const cap         = item.caption || {};
      const frameColor  = cap.frameColor || '#f5efe6';
      const capText     = cap.text || DEFAULT_CAP;
      const capColor    = cap.color || '#2a1f0f';
      const capFontSize = cap.fontSize || 13;
      const fw          = item.w + POL_PAD * 2;
      const flippedStyle = item.data.flipped ? 'transform:scaleX(-1);' : '';

      itemsHTML += `
<div style="position:absolute;left:${item.x - POL_PAD}px;top:${item.y}px;z-index:${item.zIndex||10};transform:${transform};width:${fw}px;">
  <div style="background:${frameColor};border-radius:3px;box-shadow:0 6px 22px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.3);padding:${POL_PAD}px ${POL_PAD}px 0;">
    <div style="width:${item.w}px;height:${item.h}px;overflow:hidden;border-radius:1px;">
      <img src="${escapeAttr(item.data.src)}" style="display:block;width:100%;height:100%;object-fit:cover;${flippedStyle}" loading="lazy"/>
    </div>
    <div style="padding:8px 4px 10px;min-height:${CAP_H}px;display:flex;align-items:center;justify-content:center;">
      <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:${capFontSize}px;letter-spacing:.12em;color:${escapeAttr(capColor)};text-align:center;">${escapeHTML(capText)}</span>
    </div>
  </div>
</div>`;

    } else if(item.type === 'text'){
      const d  = item.data;
      const fs = d.fontSize || 24;
      const ff = d.fontFamily || "'Cormorant Garamond',serif";
      const fw2 = d.bold ? 'bold' : 'normal';
      const fi  = d.italic ? 'italic' : 'normal';
      const td  = d.underline ? 'underline' : 'none';
      const bg  = (d.bg && d.bg !== 'transparent')
        ? `background:${d.bg};padding:6px 12px;border-radius:2px;` : '';
      itemsHTML += `
<div style="position:absolute;left:${item.x}px;top:${item.y}px;z-index:${item.zIndex||10};transform:${transform};">
  <div style="font-family:${ff};font-size:${fs}px;font-weight:${fw2};font-style:${fi};text-decoration:${td};color:${escapeAttr(d.color||'#f5f0e8')};line-height:1.35;white-space:pre-wrap;word-break:break-word;${bg}">${escapeHTML(d.text)}</div>
</div>`;

    } else if(item.type === 'sticker'){
      const sz = item.w || 60;
      itemsHTML += `
<div style="position:absolute;left:${item.x}px;top:${item.y}px;z-index:${item.zIndex||10};transform:${transform};font-size:${sz}px;line-height:1;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5));">${item.data.emoji}</div>`;
    }
  });

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Vision Board — Share Board ${currentBoard}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0b08;font-family:'Cormorant Garamond',serif;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
.vb-header{
  position:sticky;top:0;z-index:999;
  background:rgba(16,12,8,.94);backdrop-filter:blur(12px);
  border-bottom:1px solid rgba(201,169,110,.18);
  padding:10px 20px;display:flex;align-items:center;justify-content:space-between;
}
.vb-logo{font-family:'Cormorant Garamond',serif;font-style:italic;color:#c9a96e;font-size:16px;letter-spacing:.08em;}
.vb-meta{font-family:'DM Mono',monospace;font-size:10px;color:#8b7b6b;letter-spacing:.08em;}
.vb-board{
  position:relative;
  width:${boardWidth}px;
  min-height:${bh}px;
  margin:0 auto;
  background-color:${bgColor};
  background-image:
    linear-gradient(${gridColor} 1px,transparent 1px),
    linear-gradient(90deg,${gridColor} 1px,transparent 1px);
  background-size:40px 40px;
}
@media(max-width:${boardWidth}px){
  .vb-board{width:100%;min-height:auto;}
}
</style>
</head>
<body>
<div class="vb-header">
  <span class="vb-logo">✦ Vision Board</span>
  <span class="vb-meta">Board ${currentBoard} · ${filterLabels[filterMode]} · ${makeSharingFilename().replace('sharing_','').replace('.html','')}</span>
</div>
<div class="vb-board">
${itemsHTML}
</div>
</body>
</html>`;
}

function escapeHTML(str){
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(str){
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Download the generated HTML file ── */
document.getElementById('shareCopyLink').addEventListener('click', () => {
  const filtered = getFilteredImgItems();
  if(!filtered.length){ showToast('Không có ảnh với bộ lọc hiện tại'); return; }

  showToast('Đang tạo file…');
  const filename = makeSharingFilename();
  const html     = buildSharingHTML(shareFilter);
  const blob     = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = filename;
  a.click();
  URL.revokeObjectURL(url);
  const labels   = { url:'Ảnh URL', local:'Ảnh local', all:'Tất cả ảnh' };
  setTimeout(() => showToast(`Đã tải: ${filename} (${labels[shareFilter]}) ✓`), 400);
  if(typeof gtag!=='undefined') gtag('event','share_link',{board_number:currentBoard,filter:shareFilter,image_count:filtered.length});
});

document.getElementById('shareModalClose').addEventListener('click', () => shareModal.classList.remove('open'));
shareModal.addEventListener('click', e => { if(e.target === shareModal) shareModal.classList.remove('open'); });

/* ── Check URL hash on load (legacy shared link) ── */
function checkShareHash(){
  const hash = location.hash;
  if(!hash.startsWith('#share=')) return;
  try{
    const payload = JSON.parse(decodeURIComponent(escape(atob(hash.slice(8)))));
    if(!payload.images||!payload.images.length) return;
    document.getElementById('shareBoardNum').textContent = payload.board || '?';
    document.getElementById('shareNote').textContent = `Shared board — ${payload.images.length} ảnh URL`;
    const grid = document.getElementById('shareGrid'); grid.innerHTML = '';
    const cols = 3; const colEls = [];
    for(let c=0;c<cols;c++){
      const col=document.createElement('div');
      col.style.cssText='display:inline-block;width:100%;vertical-align:top;';
      colEls.push(col);
    }
    const colH = Array(cols).fill(0);
    payload.images.forEach((url, i) => {
      const col = colH.indexOf(Math.min(...colH));
      const card = document.createElement('div'); card.className='share-card';
      const img = document.createElement('img'); img.src=url; img.alt=''; img.loading='lazy';
      img.onerror=()=>img.style.display='none';
      const cap = document.createElement('div'); cap.className='share-cap';
      cap.textContent=(payload.captions&&payload.captions[i])||DEFAULT_CAP;
      card.appendChild(img); card.appendChild(cap);
      colEls[col].appendChild(card); colH[col]+=300;
    });
    colEls.forEach(c=>grid.appendChild(c));
    shareModal.classList.add('open');
    showToast(`Shared board ${payload.board||''} — ${payload.images.length} ảnh`);
  } catch(e){ console.warn('share hash err',e); }
}

/* ══════════════════════════════════
   KEYBOARD
   ══════════════════════════════════ */
document.addEventListener('keydown',e=>{
  const tag=document.activeElement.tagName;
  if(['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
  if(document.activeElement.isContentEditable) return;
  if((e.key==='Delete'||e.key==='Backspace')&&selectedId) deleteItem(selectedId);
  if(e.key==='Escape') deselectAll();
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)&&selectedId){
    e.preventDefault();
    const item=items.find(i=>i.id===selectedId); if(!item) return;
    const step=e.shiftKey?10:1;
    if(e.key==='ArrowUp')    item.y-=step;
    if(e.key==='ArrowDown')  item.y+=step;
    if(e.key==='ArrowLeft')  item.x-=step;
    if(e.key==='ArrowRight') item.x+=step;
    updateItemDOM(item.id);
    if(item.type==='image') positionToolbar(board.querySelector(`[data-id="${item.id}"]`));
    recalcBoardHeight();
    debounceSave();
  }
});
document.addEventListener('mousedown',e=>{
  if(!e.target.closest('.board-item')&&!e.target.closest('.img-toolbar')) deselectAll();
},true);

/* ══════════════════════════════════
   TEXT MODAL
   ══════════════════════════════════ */
document.getElementById('btnAddText').addEventListener('click',()=>{
  textMode='add';editingId=null;resetTextModal();
  textModal.classList.add('open');setTimeout(()=>document.getElementById('textContent').focus(),80);
});
board.addEventListener('dblclick',e=>{
  const itemEl=e.target.closest('.board-item'); if(!itemEl) return;
  const item=items.find(i=>i.id===itemEl.dataset.id);
  if(item&&item.type==='text') openTextModal(item);
});
function openTextModal(item){
  textMode='edit';editingId=item.id;const d=item.data;
  document.getElementById('textContent').value=d.text;
  document.getElementById('fontSize').value=d.fontSize||24;
  document.getElementById('fontSizeVal').textContent=(d.fontSize||24)+'px';
  document.getElementById('fontFamily').value=d.fontFamily||"'Cormorant Garamond',serif";
  document.getElementById('colorPicker').value=toHex(d.color||'#f5f0e8');
  pendingText={...d};refreshStyleBtns();refreshBgSwatches(d.bg||'transparent');
  textModal.classList.add('open');setTimeout(()=>document.getElementById('textContent').focus(),80);
}
function resetTextModal(){
  document.getElementById('textContent').value='';
  document.getElementById('fontSize').value=24;
  document.getElementById('fontSizeVal').textContent='24px';
  document.getElementById('fontFamily').value="'Cormorant Garamond',serif";
  document.getElementById('colorPicker').value='#f5f0e8';
  pendingText={color:'#f5f0e8',fontSize:24,fontFamily:"'Cormorant Garamond',serif",bold:false,italic:false,underline:false,bg:'transparent'};
  refreshStyleBtns();refreshBgSwatches('transparent');
}
document.getElementById('fontSize').addEventListener('input',e=>{pendingText.fontSize=+e.target.value;document.getElementById('fontSizeVal').textContent=e.target.value+'px';});
document.getElementById('fontFamily').addEventListener('change',e=>{pendingText.fontFamily=e.target.value;});
document.getElementById('colorPicker').addEventListener('input',e=>{pendingText.color=e.target.value;});
document.querySelectorAll('.swatch').forEach(s=>s.addEventListener('click',()=>{
  pendingText.color=s.dataset.color;
  document.querySelectorAll('.swatch.active').forEach(x=>x.classList.remove('active'));
  s.classList.add('active');document.getElementById('colorPicker').value=toHex(s.dataset.color);
}));
document.querySelectorAll('.bg-swatch').forEach(s=>s.addEventListener('click',()=>{
  pendingText.bg=s.dataset.bg;refreshBgSwatches(s.dataset.bg);
}));
document.querySelectorAll('.style-btn').forEach(btn=>btn.addEventListener('click',()=>{
  const st=btn.dataset.style;pendingText[st]=!pendingText[st];btn.classList.toggle('active',pendingText[st]);
}));
function refreshStyleBtns(){document.querySelectorAll('.style-btn').forEach(b=>b.classList.toggle('active',!!pendingText[b.dataset.style]));}
function refreshBgSwatches(bg){document.querySelectorAll('.bg-swatch').forEach(s=>s.classList.toggle('active',s.dataset.bg===bg));}
const closeTextModal=()=>textModal.classList.remove('open');
document.getElementById('textModalClose').addEventListener('click',closeTextModal);
document.getElementById('textModalCancel').addEventListener('click',closeTextModal);
textModal.addEventListener('click',e=>{if(e.target===textModal)closeTextModal();});
document.getElementById('textModalSave').addEventListener('click',()=>{
  const text=document.getElementById('textContent').value.trim();
  if(!text){showToast('Vui lòng nhập nội dung');return;}
  const data={text,
    color:pendingText.color||'#f5f0e8',fontSize:pendingText.fontSize||24,
    fontFamily:pendingText.fontFamily||"'Cormorant Garamond',serif",
    bold:!!pendingText.bold,italic:!!pendingText.italic,
    underline:!!pendingText.underline,bg:pendingText.bg||'transparent'};
  if(textMode==='edit'&&editingId){
    const item=items.find(i=>i.id===editingId);
    if(item){item.data=data;updateItemDOM(item.id);debounceSave();}
  } else {
    const bw=boardWrapper.clientWidth;
    addItem({id:makeId(),type:'text',
      x:Math.round(80+Math.random()*(bw*.5)),y:Math.round(80+Math.random()*240),
      w:200,h:60,rotation:0,zIndex:++zCtr,data});
  }
  closeTextModal();
});

/* ══════════════════════════════════
   STICKERS
   ══════════════════════════════════ */
function setupStickers(){
  const grid=document.getElementById('stickerGrid');
  STICKERS.forEach(emoji=>{
    const el=document.createElement('div');el.className='sticker-opt';el.textContent=emoji;
    el.addEventListener('click',()=>{
      const bw=boardWrapper.clientWidth;
      addItem({id:makeId(),type:'sticker',
        x:80+Math.random()*(bw*.6),y:80+Math.random()*350,
        w:60,h:60,rotation:(Math.random()-.5)*20,zIndex:++zCtr,data:{emoji}});
      stickerModal.classList.remove('open');
    });
    grid.appendChild(el);
  });
}
document.getElementById('btnAddSticker').addEventListener('click',()=>stickerModal.classList.add('open'));
document.getElementById('stickerModalClose').addEventListener('click',()=>stickerModal.classList.remove('open'));
stickerModal.addEventListener('click',e=>{if(e.target===stickerModal)stickerModal.classList.remove('open');});

/* ══════════════════════════════════
   BACKGROUND
   ══════════════════════════════════ */
document.querySelectorAll('.bg-opt').forEach(opt=>opt.addEventListener('click',()=>{applyBg(opt.dataset.bg);debounceSave();}));
function applyBg(name){
  board.className=board.className.replace(/\bbg-\S+/g,'').trim();
  board.dataset.bg=name;
  if(name!=='default') board.classList.add('bg-'+name);
  document.querySelectorAll('.bg-opt').forEach(o=>o.classList.toggle('active',o.dataset.bg===name));
}

/* ══════════════════════════════════
   EXPORT PNG
   ══════════════════════════════════ */
document.getElementById('btnExport').addEventListener('click',exportPNG);
async function exportPNG(){
  showToast('Đang xuất ảnh…'); deselectAll(); hideImgToolbar();
  await new Promise(r=>setTimeout(r,120));
  const bw=boardWrapper.clientWidth;
  let maxY=Math.max(boardH,900);
  items.forEach(item=>{maxY=Math.max(maxY,item.y+totalItemH(item)+60);});
  const canvas=document.createElement('canvas');
  canvas.width=bw; canvas.height=maxY;
  const ctx=canvas.getContext('2d');
  const bgColors={default:'#1a1510',black:'#000',warm:'#3a2518',cream:'#f0ebe0',slate:'#1c2333',forest:'#1a2416',rose:'#2d1c1c'};
  ctx.fillStyle=bgColors[board.dataset.bg||'default']||'#1a1510';
  ctx.fillRect(0,0,bw,maxY);
  /* grid */
  ctx.strokeStyle='rgba(201,169,110,0.06)';ctx.lineWidth=1;
  for(let x=0;x<=bw;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,maxY);ctx.stroke();}
  for(let y=0;y<=maxY;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(bw,y);ctx.stroke();}
  const sorted=[...items].sort((a,b)=>(a.zIndex||0)-(b.zIndex||0));
  for(const item of sorted){
    ctx.save();
    if(item.type==='image'){
      /* Polaroid: visual top starts at item.y, polaroid box extends item.y to item.y+h+CAP_H+POL_PAD */
      const totalH = totalItemH(item);
      const cx=item.x-POL_PAD + (item.w+POL_PAD*2)/2;
      const cy=item.y + totalH/2;
      ctx.translate(cx,cy);ctx.rotate((item.rotation||0)*Math.PI/180);ctx.translate(-cx,-cy);

      const cap=item.caption||{};const polBg=cap.frameColor||'#f5efe6';
      const fw=item.w+POL_PAD*2;
      /* Full polaroid height: POL_PAD(top) + image + CAP_H */
      const fh=POL_PAD + item.h + CAP_H;
      const fx=item.x-POL_PAD;
      const fy=item.y;

      ctx.shadowBlur=18;ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowOffsetY=4;
      ctx.fillStyle=polBg;roundRect(ctx,fx,fy,fw,fh,3);ctx.fill();
      ctx.shadowBlur=0;ctx.shadowColor='transparent';ctx.shadowOffsetY=0;

      /* image starts at fy + POL_PAD */
      ctx.save();roundRect(ctx,item.x,fy+POL_PAD,item.w,item.h,1);ctx.clip();
      if(item.data.flipped){
        ctx.translate(item.x+item.w,fy+POL_PAD);ctx.scale(-1,1);
        await drawImgSrc(ctx,item.data.src,0,0,item.w,item.h);
      } else {
        await drawImgSrc(ctx,item.data.src,item.x,fy+POL_PAD,item.w,item.h);
      }
      ctx.restore();

      /* caption centered in bottom strip */
      ctx.font=`700 ${cap.fontSize||13}px "DM Mono",monospace`;
      ctx.fillStyle=cap.color||'#2a1f0f';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(cap.text||DEFAULT_CAP, fx+fw/2, fy+POL_PAD+item.h+CAP_H/2);
      ctx.textAlign='left';
    } else {
      const cx=item.x+item.w/2, cy=item.y+totalItemH(item)/2;
      ctx.translate(cx,cy);ctx.rotate((item.rotation||0)*Math.PI/180);ctx.translate(-cx,-cy);
      if(item.type==='text'){drawTextExport(ctx,item);}
      else if(item.type==='sticker'){ctx.font=`${item.w||60}px serif`;ctx.textBaseline='top';ctx.fillText(item.data.emoji,item.x,item.y);}
    }
    ctx.restore();
  }
  const a=document.createElement('a');
  a.download='vision-board-'+new Date().toISOString().slice(0,10)+'.png';
  a.href=canvas.toDataURL('image/png');a.click();
  showToast('Đã xuất PNG ✓');
  if(typeof gtag!=='undefined') gtag('event','export_png',{board_number:currentBoard,item_count:items.length});
}
function roundRect(ctx,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function drawImgSrc(ctx, src, x, y, w, h) {
  return new Promise(async (resolve) => {
    // Bước 1: Thử tải trực tiếp với CORS anonymous (Tối ưu nhất nếu server gốc mở CORS)
    const successDirect = await tryLoadImage(src, 'anonymous', ctx, x, y, w, h);
    if (successDirect) return resolve();
    // Bước 2: Nếu lỗi, chuyển ngay sang sử dụng CORS Proxy (Dành cho Pinterest, Tinhte...)
    // Mẹo: Sử dụng images.weserv.nl sẽ tối ưu tốc độ và nén ảnh tốt hơn corsproxy.io
    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(src)}`;
    const successProxy = await tryLoadImage(proxyUrl, 'anonymous', ctx, x, y, w, h);
    if (successProxy) return resolve();
    // Bước 3: Thử proxy dự phòng thứ hai nếu proxy 1 chết (Tùy chọn - ví dụ: corsproxy.io)
    const backupProxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(src);
    const successBackup = await tryLoadImage(backupProxyUrl, 'anonymous', ctx, x, y, w, h);
    if (successBackup) return resolve();
    // Bỏ cuộc - Giữ nguyên ô trống không làm sập luồng code
    console.warn('Picnote: Không thể export ảnh từ URL do chặn CORS hoàn toàn:', src);
    resolve();
  });
}
// Hàm bổ trợ giúp cô lập logic tải ảnh, tránh lồng cụm callback hell
function tryLoadImage(url, crossOriginMode, ctx, x, y, w, h) {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOriginMode) {
      img.crossOrigin = crossOriginMode;
    }
    img.onload = () => {
      try {
        ctx.drawImage(img, x, y, w, h);
        resolve(true); // Tải và vẽ thành công
      } catch (e) {
        console.error('Lỗi nhiễm độc Canvas ngầm:', e);
        resolve(false);
      }
    };
    img.onerror = () => resolve(false); // Lỗi kết nối hoặc chặn CORS
    img.src = url;
  });
}
function drawTextExport(ctx,item){
  const d=item.data,size=d.fontSize||24;let f='';
  if(d.italic)f+='italic ';if(d.bold)f+='bold ';
  f+=size+'px '+(d.fontFamily||'Georgia,serif').replace(/'/g,'');
  ctx.font=f;ctx.fillStyle=d.color||'#f5f0e8';ctx.textBaseline='top';
  const lines=d.text.split('\n'),lh=size*1.35,px=12,py=6;
  if(d.bg&&d.bg!=='transparent'){
    const mw=lines.reduce((m,l)=>Math.max(m,ctx.measureText(l).width),0);
    ctx.fillStyle=d.bg;ctx.fillRect(item.x,item.y,mw+px*2,lines.length*lh+py*2);
    ctx.fillStyle=d.color||'#f5f0e8';
  }
  lines.forEach((l,i)=>{ctx.fillText(l,item.x+px,item.y+py+i*lh);if(d.underline){const tw=ctx.measureText(l).width;ctx.fillRect(item.x+px,item.y+py+(i+1)*lh-2,tw,2);}});
}

/* ══════════════════════════════════
   DELETE & CLEAR
   ══════════════════════════════════ */
function deleteItem(id){
  items=items.filter(i=>i.id!==id);
  const el=board.querySelector(`[data-id="${id}"]`);
  if(el){el.style.transition='opacity .18s,transform .18s';el.style.opacity='0';el.style.transform+=' scale(.85)';setTimeout(()=>el.remove(),200);}
  if(selectedId===id){selectedId=null;hideImgToolbar();}
  updateHint();debounceSave();
}
document.getElementById('btnClear').addEventListener('click',async()=>{
  if(!items.length) return;
  if(!confirm(`Xóa toàn bộ Board ${currentBoard}?`)) return;
  items=[];boardH=900;
  board.querySelectorAll('.board-item').forEach(e=>e.remove());
  applyBoardHeight();updateHint();hideImgToolbar();
  await saveCurrentBoard();showToast(`Đã xóa Board ${currentBoard}`);
});

/* ══════════════════════════════════
   TOAST / UTILS
   ══════════════════════════════════ */
function showToast(msg){
  toast.textContent=msg;toast.classList.add('show');
  clearTimeout(showToast._t);showToast._t=setTimeout(()=>toast.classList.remove('show'),2400);
}
function toHex(color){
  if(!color||color==='transparent') return '#f5f0e8';
  if(color.startsWith('#')) return color;
  const d=document.createElement('div');d.style.color=color;document.body.appendChild(d);
  const c=getComputedStyle(d).color;document.body.removeChild(d);
  const m=c.match(/\d+/g);if(!m)return '#f5f0e8';
  return '#'+m.slice(0,3).map(n=>parseInt(n).toString(16).padStart(2,'0')).join('');
}

/* ══════════════════════════════════
   INIT
   ══════════════════════════════════ */
async function init(){
  try{
    db=await openDB();
    await loadBoard(currentBoard);
    await updateTabDots();
  } catch(e){
    console.warn('IndexedDB error:',e);
    showToast('⚠️ Chạy qua http://localhost để lưu được');
  }
  setupStickers();
  applyBoardHeight();
  /* mark active tab */
  document.querySelectorAll('#boardTabsInline .tab-btn').forEach(b=>{
    b.classList.toggle('active',+b.dataset.tab===currentBoard);
  });
  document.getElementById('currentBoardNum').textContent=currentBoard;
  checkShareHash();
}


/* ══════════════════════════════════
   CLIPBOARD PASTE — Ctrl+V image
   ══════════════════════════════════ */
document.addEventListener('paste', e => {
  /* Ignore if user is typing in an input/textarea */
  const tag = document.activeElement.tagName;
  if (['INPUT','TEXTAREA'].includes(tag)) return;
  if (document.activeElement.isContentEditable) return;

  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        loadImageFile(file);
        showToast('Đã dán ảnh từ clipboard ✓');
        if(typeof gtag!=='undefined') gtag('event','paste_image',{board_number:currentBoard});
        e.preventDefault();
      }
    }
  }
});

/* ══════════════════════════════════
   EXPORT PDF
   ══════════════════════════════════ */
document.getElementById('btnExportPDF').addEventListener('click', exportPDF);

async function exportPDF() {
  showToast('Đang tạo PDF…');
  deselectAll(); hideImgToolbar();
  await new Promise(r => setTimeout(r, 120));

  /* Build same canvas as PNG export */
  const bw = boardWrapper.clientWidth;
  let maxY = Math.max(boardH, 900);
  items.forEach(it => { maxY = Math.max(maxY, it.y + totalItemH(it) + 60); });

  const canvas  = document.createElement('canvas');
  canvas.width  = bw;
  canvas.height = maxY;
  const ctx = canvas.getContext('2d');

  /* Background */
  const bgColors = {
    default:'#1a1510', black:'#000', warm:'#3a2518',
    cream:'#f0ebe0',   slate:'#1c2333', forest:'#1a2416', rose:'#2d1c1c',
  };
  ctx.fillStyle = bgColors[board.dataset.bg || 'default'] || '#1a1510';
  ctx.fillRect(0, 0, bw, maxY);

  /* Grid */
  ctx.strokeStyle = 'rgba(201,169,110,0.06)'; ctx.lineWidth = 1;
  for (let x = 0; x <= bw;   x += 40) { ctx.beginPath(); ctx.moveTo(x, 0);   ctx.lineTo(x, maxY); ctx.stroke(); }
  for (let y = 0; y <= maxY; y += 40) { ctx.beginPath(); ctx.moveTo(0, y);   ctx.lineTo(bw, y);   ctx.stroke(); }

  /* Render items */
  const sorted = [...items].sort((a,b) => (a.zIndex||0) - (b.zIndex||0));
  for (const item of sorted) {
    ctx.save();
    if (item.type === 'image') {
      const totalH = totalItemH(item);
      const cx = item.x - POL_PAD + (item.w + POL_PAD*2)/2;
      const cy = item.y + totalH/2;
      ctx.translate(cx,cy); ctx.rotate((item.rotation||0)*Math.PI/180); ctx.translate(-cx,-cy);
      const cap = item.caption||{}; const polBg = cap.frameColor||'#f5efe6';
      const fw = item.w + POL_PAD*2;
      const fh = POL_PAD + item.h + CAP_H;
      const fx = item.x - POL_PAD; const fy = item.y;
      ctx.shadowBlur=18; ctx.shadowColor='rgba(0,0,0,.4)'; ctx.shadowOffsetY=4;
      ctx.fillStyle = polBg; roundRect(ctx,fx,fy,fw,fh,3); ctx.fill();
      ctx.shadowBlur=0; ctx.shadowColor='transparent'; ctx.shadowOffsetY=0;
      ctx.save(); roundRect(ctx,item.x,fy+POL_PAD,item.w,item.h,1); ctx.clip();
      if (item.data.flipped) {
        ctx.translate(item.x+item.w, fy+POL_PAD); ctx.scale(-1,1);
        await drawImgSrc(ctx, item.data.src, 0, 0, item.w, item.h);
      } else {
        await drawImgSrc(ctx, item.data.src, item.x, fy+POL_PAD, item.w, item.h);
      }
      ctx.restore();
      ctx.font = `700 ${cap.fontSize||13}px "DM Mono",monospace`;
      ctx.fillStyle = cap.color||'#2a1f0f'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(cap.text||DEFAULT_CAP, fx+fw/2, fy+POL_PAD+item.h+CAP_H/2);
      ctx.textAlign = 'left';
    } else {
      const cx = item.x + item.w/2, cy = item.y + totalItemH(item)/2;
      ctx.translate(cx,cy); ctx.rotate((item.rotation||0)*Math.PI/180); ctx.translate(-cx,-cy);
      if (item.type === 'text') drawTextExport(ctx, item);
      else if (item.type === 'sticker') { ctx.font=`${item.w||60}px serif`; ctx.textBaseline='top'; ctx.fillText(item.data.emoji, item.x, item.y); }
    }
    ctx.restore();
  }

  /* Convert canvas → image data URL */
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  /* Build minimal PDF with the image embedded */
  /* PDF page size = canvas size in points (1px ≈ 0.75pt) */
  const W_PT = Math.round(bw * 0.75);
  const H_PT = Math.round(maxY * 0.75);

  /* Convert data URL to raw binary for PDF stream */
  const b64 = imgData.split(',')[1];
  const byteLen = Math.floor(b64.length * 3/4);

  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W_PT} ${H_PT}]/Contents 4 0 R/Resources<</XObject<</Im1 5 0 R>>>>>>endobj
4 0 obj<</Length 32>>stream
q ${W_PT} 0 0 ${H_PT} 0 0 cm /Im1 Do Q
endstream
endobj
5 0 obj<</Type/XObject/Subtype/Image/Width ${bw}/Height ${maxY}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${byteLen}>>stream\r\n`;

  /* We need to embed binary JPEG. Build using Blob parts. */
  const header   = new TextEncoder().encode(pdf);
  const footer   = new TextEncoder().encode('\r\nendstream\nendobj\nxref\n0 0\ntrailer<</Root 1 0 R>>\n%%EOF\n');

  /* Base64 decode to binary */
  const binaryStr = atob(b64);
  const bytes     = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  const blob = new Blob([header, bytes, footer], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'picnote-board-' + new Date().toISOString().slice(0,10) + '.pdf';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất PDF ✓');
  if(typeof gtag!=='undefined') gtag('event','export_pdf',{board_number:currentBoard,item_count:items.length});
}

/* ══════════════════════════════════
   QUICK SHARE — QR Code
   ══════════════════════════════════ */
document.getElementById('btnQRShare').addEventListener('click', openQRModal);
document.getElementById('qrModalClose').addEventListener('click', () => document.getElementById('qrModal').classList.remove('open'));
document.getElementById('qrModal').addEventListener('click', e => { if (e.target === document.getElementById('qrModal')) document.getElementById('qrModal').classList.remove('open'); });

function openQRModal() {
  /* Build the share URL — same logic as share link but encode into URL fragment */
  const allImg = items.filter(i => i.type === 'image');
  if (!allImg.length) { showToast('Board chưa có ảnh để share'); return; }
  const urlImgs = allImg.filter(i => i.data.isUrl);
  if (!urlImgs.length) { showToast('QR share chỉ hỗ trợ ảnh URL. Dùng Share Link để xuất file.'); return; }
  const payload = {
    v: 1,
    board: currentBoard,
    images: urlImgs.map(i => i.data.originalUrl || i.data.src),
    captions: urlImgs.map(i => (i.caption && i.caption.text) || DEFAULT_CAP),
  };
  const hash    = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const shareUrl = `${location.origin}${location.pathname}#share=${hash}`;
  document.getElementById('qrNote').textContent =
    `Board ${currentBoard} · ${urlImgs.length} ảnh URL`;
  document.getElementById('qrSubtitle').textContent = 'Quét để xem trên thiết bị khác';
  /* Draw QR using built-in qrcode generator (pure JS, no lib needed) */
  drawQRCode(shareUrl, document.getElementById('qrCanvas'), 240);
  document.getElementById('qrModal').classList.add('open');
  /* GA4 event tracking */
  if(typeof gtag !== 'undefined') gtag('event', 'share_qr', { board_number: currentBoard, url_image_count: urlImgs.length });
}

document.getElementById('qrDownload').addEventListener('click', () => {
  downloadBrandedQR();
});

/* qrCopyUrl removed v1.0.0 */

/* ── Minimal QR Code generator (no external lib) ── */
/* Using a simple approach: encode URL → generate QR matrix via canvas */
function drawQRCode(text, canvas, size) {
  /* We'll use a data URI approach with Google Charts API for reliability */
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&bgcolor=ffffff&color=1a1510&format=png&margin=10`;
  const ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;

  /* Show loading state */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#8b7b6b';
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Đang tải QR…', size/2, size/2);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
  };
  img.onerror = () => {
    /* Fallback: draw text URL as QR placeholder */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#1a1510';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('QR không tải được.', size/2, size/2 - 10);
    ctx.font = '11px monospace';
    ctx.fillText('Copy URL bên dưới.', size/2, size/2 + 10);
  };
  img.src = qrApiUrl;
}

/* ══════════════════════════════════
   INFO MODAL
   ══════════════════════════════════ */
const MOMO_QR_B64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/4RcIRXhpZgAATU0AKgAAAAgABAESAAMAAAABAAEAAAExAAIAAAAHAAAAPgISAAMAAAACAAIAAodpAAQAAAABAAAARgAAANZQaWNhc2EAAAAGkAAABwAAAAQwMjIwoAEAAwAAAAEAAQAAoAIABAAAAAEAAAQ4oAMABAAAAAEAAAbsoAUABAAAAAEAAACUpCAAAgAAACEAAAC0AAAAAAACAAEAAgAAAARSOTgAAAIABwAAAAQwMTAwAAAAAAAAN2NlMmJkYzhkZjcxMDBkNTAwMDAwMDAwMDAwMDAwMDAAAAAGAQMAAwAAAAEABgAAARoABQAAAAEAAAEkARsABQAAAAEAAAEsASgAAwAAAAEAAgAAAgEABAAAAAEAAAE0AgIABAAAAAEAABXLAAAAAAAAAEgAAAABAAAASAAAAAH/2P/bAEMACAYGBwYFCAcHBwkJCAoMFA0MCwsMGRITDxQdGh8eHRocHCAkLicgIiwjHBwoNyksMDE0NDQfJzk9ODI8LjM0Mv/bAEMBCQkJDAsMGA0NGDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMv/AABEIAHgAZQMBIQACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/APf6Mj1oAKKACigAooAKKACigAooAw/GCh/Cl+huVtlZVDSNnG3cMjgEnIyMd84rzmxsrIaS0UF7DP8AvkP2RrOeRJn/AH+SUChuF7joYsHtWsNj1MG5Ki7LS+915d+x6jpO1dG0xY7o3SeRGBOQQZRs+9g889a5TxfrPiLQNY3Webmz1CHyLZBGMwXHABzg7ieoBPPPpXPVlKKujPBUqdbE+zq6J3+XX8rotyeJ7/SkayuILe6u7Wz8+eR5zGZSA5baBGR/AeuOopsnjqVJbiBdNjeeLeNqzOwDJKsbhiIyQcsGUKGZlIJC7gDpRi56MwxlONK0o9enl977nUaferqWl2d+iNGlzCkyo3VQy5wffmsnxJq2rafNbR6VZpcFlLyB42bP7yNAgKn5SfMJ3HOAh4PNVCKcrM5JNqN0c2vjfxA9wkMemRmZ3LxwPbOssiDyfkwGYIf3jjeSQPLIIBBxas/Fuvz3tpFLpTJBPeCLebRw6ptjJDLvIXG9stk8qQUGDjd0YJbmSqSfQtz61qyzajcWYnuoYwFSJrXYFJydy5GSABjvljnAGM79i13JcM0kknlIgUq6KNz4GSMDOB/Mn0rlxVNxnDkej3W/Qzw1Wc21L77W7mjRQdZV1DT7bVbGSyvI/MgkxuXcVzggjkc9QKzU8IaLGgWO2kj2kFWjuJEYH5+jBs/8tH79/YU1JrY2p16lOPLF6GvBbQ2ttDbwIEhhQJGo/hAGAPyqTHrzSMm23dhtGc4oxQIMUtAEX2eD7SbnyY/PKeWZdo3bc5xnrjPOKloAKKACigArhdX+KNhpXii+8PRaB4h1O9slRpv7Os1mUBlVgfvg4wwHI60AVZvi3DbQSTz+CPGsUMSl5JJNKCqigZJJL4AA71oz/Ea3TQtJ1e08OeItSt9TiaWNbCyEzRAY4kw2FJzxyc4NAHZ1xeo/E/QtP8VL4fjju76dUD3VxZBJYbJd5RzO2/MYQjLEj5QRmgDGu/jj4etjfvFpGu3lnZTmCW/tLaOS23ZwCJPMxg8YzjORXW+GPFX/AAk32r/iQ65pX2fZ/wAhWz8jzN2fucnONvPpketAHMaT8ZtE1vxINC0/RtenuhN5UjR2qMkQ3hDI5DkhASMtjgVq+JviNYeGfEcOhNo+talfzWwulTTbZZjsLMvTcD1U9vSgCj/wtQf9CH44/wDBR/8AZ10nhLxVY+MtAj1jT4riK3kdkCXChXBU4OQCR+tAG5RQAV4fqN3cWHxJ+Kl3aTPDcQaHHJFIhwUYQIQR70Acb8P/ABf4i8QQ+MLTV9ZvL23Tw1eyLHNIWAYBQD9cE/nW3c+Ob/wJ4S+Gt/biSe0azuftFmJvLWfhQu44P3S2RxQBbl1668aeJvFmq6X8QL/SPDmlx20iSQ28jKVaPDYT5WGGU9uc1p6B8KZbLSPEHiDT9fk1y48QaHcxwiS28kzNOodXJZ+CSB1x97nFAEGkeGoJ/DkEeh2cepT6VFHaa54c4hju7wABmeVvlJQ5bI3AlRg811c/xA8MeOYD4b8NeLJbPV73i3nis5gybfnbG5VH3VI6jrQB5n8N4B4f+MMtt4auW8TrLaGPULh1+yG2BuEEr4f7+3CnA67uOld9q5K/tEWLKcEeG3IPp+8loA8z+EvjnxRrHxP0ew1HXb66tJfO8yGWUlWxC5GR9QD+FeqfAj/kl9r/ANfM/wD6HQB6XRQAV4v4ms00r4la1rFh8SdL0C+vEhjntZ7aOV1VY0wDvPfAboOtAE39meK/EnhvUZk+LGn3ukeVLDdyxaXBsCbMuCw6fKc9eM0axYW9j8P/AA3o0OoReINONuyNo9sNkmshWUq0bqSyeWf3h2nkLg8UAReIIPEFvNbatr3m3b+Cy10b5oBCmq+bg7UCjCbAApPzZxmuY8L6mviy0tTYRFr6Tx6uszWaHfJDakLmRsfwqWALdM0ATXOk3miaz4u1Wws5ofGkurSy6INpaSW3Zz5jJGcq42F+SDj2qFPGPjPw1b3PhzRPCupaRHfbf7BtHQStbbDvuMb0Jl3FifmPy54oA6fSLaOX+3dJ0q5S28K3Xh+4fULrHmRQ6k+FlZnPIYJglAQAOw61NbeDbjWJ9G13wh44som0jSItHe5itVuFYxglj8xIGQw47etAEenXniXWL6Kx074zaVdXcufLhi0y3ZmwCTgewBP4V2Pws0iz0TwNBZWGrwatAs0jC6gXCsS3Ixk9PrQB2lFABXiPjrwtFbeN9ZvdStrK6PiqOPTNHLRh2tbnylQSPuHyDI+8m4+1AHnXhjxDP4Dub/w5FcJNq0upyadcwag5bSPJJVHlZcq2/cmCxGPLzkVteIvDHieztBrK3F9eX0vzaEPCTySWNkhIEwPGY1ZT8oQ8kHPFAHc6T8WxqukyaT4k8Fa5earGuNQtLPSvMiUMSUyjvuAK7T8w5OccVz1v8SvDPh4ataat4MvfDt7d+dFaTaXpcdpcLZvwjFmYESZBOR8uVGOlAHRfDnx/4f11bi71u60uCbTJPs2mXepSIt68G3G53djlyPvFcAkmuF8OeJrDVb3Xo9nj7WbUfZ/7Mv4Qtxf6fwfNxJkiLeRj5fvKuD0oAveJfDmteBobq28I3l3qtlrWntFdaPeSvPdxmYEPceTGFAwFVd5z8xIOc10vgm2m8OeFLXXLmKe4ngjSwfR/Dyl4txRcvdwnB+0gkiQ54AXigCrB4N/sjxdY6jpcNj/wnTeZvttPX/iT2P7vaPOVVEse+Ikr/ekz2r0vwJo2i6D4XisNA1D7fYLI7LP5yS5YnLDcgA4NAHS0UAFeHfEv4gSS+M38G2nhtLvVreWIaZfG7CNFcSRqUdVK4yC46tjigDzO303VPC/xBFv4y8Kx6xqerruitJ7xF3yyy4Em9NwBLKwwcdc17FD8XPDvhW50fw5dWKaWsSSR6jCjPINNZVyqAqh83ceMqcCgDF1uO8+Ft/NJqfiia5ufFIEU2sG22vZeSAA+xS3mcOBjjp3rNv8AwHrnxS8T2txqLTWWm2ujwpbawUWUaiu9ikuzcpQurM5Q5KcA/eFAGzB+z9YQeH7vTX1GK4u7iZWTUWtSr2yDkhU3kNkjHUcMT2wcrw7ocfwZ8Zzya74okstGnKG2xaFxqe2M78hCxj8tpBjd97PFA2rG9AJfAvxCfxj4p16W80K+0z7LbajJAQVkeXzUhEabnwERm3EAc461meHdbgg8VapP4I8Sy+IptSu571tC+zNaKpkOWk82QYJQY44zigR0txp99aeGfE2leGNUk1Lx9B9l+33oj8iSXL7o8lzs4h3Dgngc8muw8ETeG5/DUT+FAg0rzHC7I3Qb8/Nw4B60AdHRQAV4X4p8ReCNN+Ngj1Tw4x1SK6tS+rPqDxxxnZGVcpnbhRjPrigBPGXiuxvIjp2sac/jbSbnU/NsLrTpvJigkbcsdrui+/Iq5PJyQ446Vm+M7rW9Q+FF7b2ui33hfQ9ISGOSwvYzIbwPMuzbI4DLsYZPJzuGaAMvRNdmTVtGtvAOjXPhGHXJmikvbgm7judnA2+aCPlJbO3+9z0r6ED3mm6B5l2zahfW1rmVo02m4kVOSqjpuIOAPWmio7kdjrC3lwkaiIxuH2TRuWRyrlcA4xnC5xn1xuwSOH+KmlWjeHdfisdr67rdvbRRWMQHm3PkSliyqPmchXOTzgIOwpyVi6keV2OK0y58W+Nfhroa+bPJqlh4sghjnW0B+xxxxcO6gAYRmyd30NXNA05tT8UalFoek3Om67a3E9vqPidy0sE8qn98PKPyIZCd2B93PFSZGn9n8Keb/Yh8eaGPAn/QC89N39//AF+7zP8AXfP9726cV6h4X1i613RI7680i50mVmZfstzneADweQOtAGzRQAV4X4oufD8HxmuY00M6ldzT2yazJqlpHNaWtuY4/wB5GeqELjLPx1oAr6l4b09fDV5YWXiPRUUeKX1uCDSr5ROLbYQsUCgf6/oFUfLnHNbvgbXfB95Drel6rqutzJuhE9p4zuIW5BYjYjH1AJyOy0AeZ+NPD76Vd6fZ+BpvF2pQ6c7tHdhvOtkLBWzbPEMA5LBunI+tepeHvH2oeGdO0qw8fxfZvtFnbyW2ppHMyNuXAjuGcZWf5SzHpyc4xyDR6LBq+mXU1vFb6lZyyXKeZAiTqxlTGdygH5hjnIrzP4jaVqepeMbWz8LT276xfxeRPeyZ36QsQ8xNkkQ3w+aHkBLZ3DAGAKBti2HhWz8IeHroeHde1zU73V9+mH7Pdia2tbyVR/pD7ACm0quX5YA9DT7S01CbRDp93cr4e0qyIg1K/WRrS7v9RRQHlWQ/LJFJx8zAOxBzQScDqOm6fqWn6Lc+MvCsmmTX/n/2dZeEtPWG4bYQJPtCSDngKU254Lk9q+hvD/8Abn9kR/8ACQ/2f/aG47v7P3+Vtz8v3+c460AalFABXnmoaDoWi+O9T1XW9TDx+K0j0yOwNs5DMEVNu9SeoHcL160AcivgzwxL4z1nV9GtYrLQtG0yeCS+RGb7FqcMm4uIydzlEw3AKnGASa89vPDWq6bqkvjzVtNHijwzuMj3csyW32tXHlo5TJdfnZTjb2oA3Phx441pNH0WztYns9A8OPJLrN2sysJIpXZlzHjdwcj5dx+lb0j6xqGs3t94ytjq3hPUpHPhq1mlULdXEjZtVG35o90ZYbnAC5+bBoAtax4T8b2VlbzaJo5uNUMYNlOt3DGdEjPW1Xc2JQFyu/j6VcVPEF78WvHmlaHvtFvP7PE+rq6E2O2Dcv7psGTfyvBGOtAGv4YvfDei30d/pniEjSLq5GkvZLZSKs2qMQTIWPIJUAdNvvXL/Gvxcsnhe70DUbb+ztWW/WWzg8zzftFqrELPuUbU3EN8hO4Y96AMHRvFvjHVNT+HmpTaA2qXkf8AaX2SV7+OM6hlSr9R+78sDHzfexxXvfhvTNS0nRktNV1h9Wuw7M108QjJBPAwCenTrQBr0UAFed+KoPA8c/iaKXWtL03xBq1kbS6kub3BAMYCZQtgDG08AZoA4mwvNf0zTraws/jP4ZjtbWJYYU8u3O1FACjJGTgAda0Piprd/F8HIbGcvrhv4UM+s2aD7OhSaMgttGAG6D3FAG/otxDrMNl8RdJuYdCtNQZn1sXbB/tEcJMUY3NlY8bTyuM5Ga8guvHFsuuy6VZWct+6+OG1mB7ZgwuE3bVRMdS3GD7igDvo/wC3PE3iVLu0nY66xc2eorCGTQUOS1rOgG0yEZX5wSCah8N6T4H1rw2l/pU1no3h2Yn/AISPTLi8Z3cK7LbbpGbdF84LDBXcGwc0Acdpfj661m71m017Wbd7LRrSe90EOI4wl5CQLcqQAZCAThW3Bu4NdJY+H/GOtappniOTx7pieILrRklhge1jEotXBfGwLgjJYbsfjQA/4XeD9H1XwDa6t4curWz8b2+/demVpTbbpXUb4SSo3RBgMr3z15r2nQPD+meGNKTTNItvs9ojFwnmM/JOScsSevvQBp0UAFeE6tFYr8U/iTqF5pWn6i+n6TFcwR31ussYdYIyOD9O2KAOX8LeJLPxlZ+KLO88HeFbT7LoF3dwzWWmCORZFChSGJOMbieOcgV0t/45s/CfwN8NWM2mQajdajaAwQ3luJbY+XIpbzF3A9DkYzyBQB1lp8N7OH4davo/hjxBd6hbajB5Vt9tvRLbQkMSSmxcLkk5wDyK4fw38N5fBVg2trq3hG51yK+Nsrancl7KEAB/lO0Mtyrr68LnvQB2zapZ3vgbWJhpWs2F2s8Yvrnw3biKS9m3DdNbtnMkZOfmPJUmsxYdFWBvEF34fFho8n/Hl4dsrJIrvUsHZILq2Pyy+W37xNp+VSWNAD/EPhDwbfWT6toejRXF1qlsdFggsrWFreynkBZZ5VUZjZCQGcElRjiua1XxB4l8CaRatLJ8Pr2606CPSleFpJL1I1G3axypAGDkcDJPFAFSH+2PAfhW11Pw/wDYTJ4c3/2tdJv+yav9ofbDsdNvn+VuYHcRsbgZr3vw+ddOkofEX9n/ANolju/s/f5W3tjfznHWgDUooAK8e1fQfFNn8SfFWp23g4a7pGs2kVqVOpRW25REit1O7qCOgoAzo/Duuafp+qw6L8H49OudQsJrFrhfEMUm1JBg/KxweQD26daTVvAWvyaD4Bhm8KDWl0m2uI7/AE9r+OAbnChRv3diM/Ln7uO9AF/w94U+IU093bWt4/gfRYAn2HT0EGoAZyZPn3BvvZbn+/gdKyLz4LeKdR1K40S78TvLodw7atLemyjG6+Y7WXyxJuyUJO7O3tjNAHomlaT4lPgyTw3HKdBn04R2llqi+XcG5ijwPN8vPybgv3SSRn2qxdR6jf6Lp/iW68IB/E+neZ9l006iuY97bG/ej5DlAG5B9OtAHmngnQvin4f1HUbVtHa103VHlO4Xls32GWUqPtGMkyFFH3ON2O1a/iD4P2+sX1vp66WqTTRLcX3ifzcmW4yfMU2+8Y3/AHsg4G7HagDpD4LN9Ovho6cNO8F6dnFqJRKuqeZ+85O7fD5Uoz1O7PpWv4Aj8TReFIV8W7v7WEr79zRsdmfl5T5elAHUUUAFFABRQAUUAFFABRQAUUAFFAH/2QD/4gv4SUNDX1BST0ZJTEUAAQEAAAvoAAAAAAIAAABtbnRyUkdCIFhZWiAH2QADABsAFQAkAB9hY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAA9tYAAQAAAADTLQAAAAAp+D3er/JVrnhC+uTKgzkNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBkZXNjAAABRAAAAHliWFlaAAABwAAAABRiVFJDAAAB1AAACAxkbWRkAAAJ4AAAAIhnWFlaAAAKaAAAABRnVFJDAAAB1AAACAxsdW1pAAAKfAAAABRtZWFzAAAKkAAAACRia3B0AAAKtAAAABRyWFlaAAAKyAAAABRyVFJDAAAB1AAACAx0ZWNoAAAK3AAAAAx2dWVkAAAK6AAAAId3dHB0AAALcAAAABRjcHJ0AAALhAAAADdjaGFkAAALvAAAACxkZXNjAAAAAAAAAB9zUkdCIElFQzYxOTY2LTItMSBibGFjayBzY2FsZWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWFlaIAAAAAAAACSgAAAPhAAAts9jdXJ2AAAAAAAABAAAAAAFAAoADwAUABkAHgAjACgALQAyADcAOwBAAEUASgBPAFQAWQBeAGMAaABtAHIAdwB8AIEAhgCLAJAAlQCaAJ8ApACpAK4AsgC3ALwAwQDGAMsA0ADVANsA4ADlAOsA8AD2APsBAQEHAQ0BEwEZAR8BJQErATIBOAE+AUUBTAFSAVkBYAFnAW4BdQF8AYMBiwGSAZoBoQGpAbEBuQHBAckB0QHZAeEB6QHyAfoCAwIMAhQCHQImAi8COAJBAksCVAJdAmcCcQJ6AoQCjgKYAqICrAK2AsECywLVAuAC6wL1AwADCwMWAyEDLQM4A0MDTwNaA2YDcgN+A4oDlgOiA64DugPHA9MD4APsA/kEBgQTBCAELQQ7BEgEVQRjBHEEfgSMBJoEqAS2BMQE0wThBPAE/gUNBRwFKwU6BUkFWAVnBXcFhgWWBaYFtQXFBdUF5QX2BgYGFgYnBjcGSAZZBmoGewaMBp0GrwbABtEG4wb1BwcHGQcrBz0HTwdhB3QHhgeZB6wHvwfSB+UH+AgLCB8IMghGCFoIbgiCCJYIqgi+CNII5wj7CRAJJQk6CU8JZAl5CY8JpAm6Cc8J5Qn7ChEKJwo9ClQKagqBCpgKrgrFCtwK8wsLCyILOQtRC2kLgAuYC7ALyAvhC/kMEgwqDEMMXAx1DI4MpwzADNkM8w0NDSYNQA1aDXQNjg2pDcMN3g34DhMOLg5JDmQOfw6bDrYO0g7uDwkPJQ9BD14Peg+WD7MPzw/sEAkQJhBDEGEQfhCbELkQ1xD1ERMRMRFPEW0RjBGqEckR6BIHEiYSRRJkEoQSoxLDEuMTAxMjE0MTYxODE6QTxRPlFAYUJxRJFGoUixStFM4U8BUSFTQVVhV4FZsVvRXgFgMWJhZJFmwWjxayFtYW+hcdF0EXZReJF64X0hf3GBsYQBhlGIoYrxjVGPoZIBlFGWsZkRm3Gd0aBBoqGlEadxqeGsUa7BsUGzsbYxuKG7Ib2hwCHCocUhx7HKMczBz1HR4dRx1wHZkdwx3sHhYeQB5qHpQevh7pHxMfPh9pH5Qfvx/qIBUgQSBsIJggxCDwIRwhSCF1IaEhziH7IiciVSKCIq8i3SMKIzgjZiOUI8Ij8CQfJE0kfCSrJNolCSU4JWgllyXHJfcmJyZXJocmtyboJxgnSSd6J6sn3CgNKD8ocSiiKNQpBik4KWspnSnQKgIqNSpoKpsqzysCKzYraSudK9EsBSw5LG4soizXLQwtQS12Last4S4WLkwugi63Lu4vJC9aL5Evxy/+MDUwbDCkMNsxEjFKMYIxujHyMioyYzKbMtQzDTNGM38zuDPxNCs0ZTSeNNg1EzVNNYc1wjX9Njc2cjauNuk3JDdgN5w31zgUOFA4jDjIOQU5Qjl/Obw5+To2OnQ6sjrvOy07azuqO+g8JzxlPKQ84z0iPWE9oT3gPiA+YD6gPuA/IT9hP6I/4kAjQGRApkDnQSlBakGsQe5CMEJyQrVC90M6Q31DwEQDREdEikTORRJFVUWaRd5GIkZnRqtG8Ec1R3tHwEgFSEtIkUjXSR1JY0mpSfBKN0p9SsRLDEtTS5pL4kwqTHJMuk0CTUpNk03cTiVObk63TwBPSU+TT91QJ1BxULtRBlFQUZtR5lIxUnxSx1MTU19TqlP2VEJUj1TbVShVdVXCVg9WXFapVvdXRFeSV+BYL1h9WMtZGllpWbhaB1pWWqZa9VtFW5Vb5Vw1XIZc1l0nXXhdyV4aXmxevV8PX2Ffs2AFYFdgqmD8YU9homH1YklinGLwY0Njl2PrZEBklGTpZT1lkmXnZj1mkmboZz1nk2fpaD9olmjsaUNpmmnxakhqn2r3a09rp2v/bFdsr20IbWBtuW4SbmtuxG8eb3hv0XArcIZw4HE6cZVx8HJLcqZzAXNdc7h0FHRwdMx1KHWFdeF2Pnabdvh3VnezeBF4bnjMeSp5iXnnekZ6pXsEe2N7wnwhfIF84X1BfaF+AX5ifsJ/I3+Ef+WAR4CogQqBa4HNgjCCkoL0g1eDuoQdhICE44VHhauGDoZyhteHO4efiASIaYjOiTOJmYn+imSKyoswi5aL/IxjjMqNMY2Yjf+OZo7OjzaPnpAGkG6Q1pE/kaiSEZJ6kuOTTZO2lCCUipT0lV+VyZY0lp+XCpd1l+CYTJi4mSSZkJn8mmia1ZtCm6+cHJyJnPedZJ3SnkCerp8dn4uf+qBpoNihR6G2oiailqMGo3aj5qRWpMelOKWpphqmi6b9p26n4KhSqMSpN6mpqhyqj6sCq3Wr6axcrNCtRK24ri2uoa8Wr4uwALB1sOqxYLHWskuywrM4s660JbSctRO1irYBtnm28Ldot+C4WbjRuUq5wro7urW7LrunvCG8m70VvY++Cr6Evv+/er/1wHDA7MFnwePCX8Lbw1jD1MRRxM7FS8XIxkbGw8dBx7/IPci8yTrJuco4yrfLNsu2zDXMtc01zbXONs62zzfPuNA50LrRPNG+0j/SwdNE08bUSdTL1U7V0dZV1tjXXNfg2GTY6Nls2fHadtr724DcBdyK3RDdlt4c3qLfKd+v4DbgveFE4cziU+Lb42Pj6+Rz5PzlhOYN5pbnH+ep6DLovOlG6dDqW+rl63Dr++yG7RHtnO4o7rTvQO/M8Fjw5fFy8f/yjPMZ86f0NPTC9VD13vZt9vv3ivgZ+Kj5OPnH+lf65/t3/Af8mP0p/br+S/7c/23//2Rlc2MAAAAAAAAALklFQyA2MTk2Ni0yLTEgRGVmYXVsdCBSR0IgQ29sb3VyIFNwYWNlIC0gc1JHQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYWVogAAAAAAAAYpkAALeFAAAY2lhZWiAAAAAAAAAAAABQAAAAAAAAbWVhcwAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACWFlaIAAAAAAAAAMWAAADMwAAAqRYWVogAAAAAAAAb6IAADj1AAADkHNpZyAAAAAAQ1JUIGRlc2MAAAAAAAAALVJlZmVyZW5jZSBWaWV3aW5nIENvbmRpdGlvbiBpbiBJRUMgNjE5NjYtMi0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYWVogAAAAAAAA9tYAAQAAAADTLXRleHQAAAAAQ29weXJpZ2h0IEludGVybmF0aW9uYWwgQ29sb3IgQ29uc29ydGl1bSwgMjAwOQAAc2YzMgAAAAAAAQxEAAAF3///8yYAAAeUAAD9j///+6H///2iAAAD2wAAwHX/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAKhAjwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigBss6QLudlVfUnAo3rnqKx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p/8ApQ9eF1/c1r/7APwV8X65eapqnwv8H3mpahM89zPLYIzzSMSSxPqTz+NVP+Hb3wH/AOiT+Cv/AAXJQB/DhRX9x/8Aw7e+A/8A0SfwV/4Lko/4dvfAf/ok/gr/AMFyUAfw4VJACx49G/lX9xf/AA7e+A//AESfwV/4LkpD/wAE4fgTGysvwn8F59tPSgD5l/4Ngzu/4IqfC1RyzNqpA9cahcKf/HlI+oI7V+hAORXP/D34aaB8IfDFvo3hnSLPRdItS3kWVnEI4YdzF22qOBlmZj7k10AGBQBGw/fqe2DzX8pP/B3Cd3/BYG+xz5XhLS9/+xkzdfTqPzFf1dHkV5f8V/2P/hh8avEr6x4v8A+G/EeqeSIhd3dksszxx4KoWI7MTge1AH8ev/BFkeX/AMFaf2c3b5Uj8faTuY9F/wBITr+Rr+1lDuUEeleOeGf2EPg/8PfEFrrWgfDXwrpusabKLqzuobBVkgnT/VuCOcjb+vvXsSHK/wAXU9RjvQA6vJ/25Pl/Y2+KxPT/AIRfUP8A0mavWKo63oVr4j066sr+Fbuzu4nimgdd0c0bLtZCO4PNAH8CcoxIa/oy/wCDI8bf2bfjQ54X/hJbYbj0ybZMCv1Yh/4Jv/Afylz8JfBS7RgD+z0OAOBXdfCT9nzwR+z/AGV5b+C/C2leGbfUJlluItPtxEk7gABmA9AMZ9qAO2zmikRdi/iTS0Afgp/wfHKX8I/s37QTtu/EROO3yabX8/OnRs1zDhWP79RwO56V/dr8aP2e/A/x2Szbxp4T0nxYukiX7FFf2gmFuZFUybcj+Ly0GfYCuLT/AIJyfAuO58xPhP4L3RyAjOnoAeh3dO39KAO5/ZndZP2c/ATKQyt4esCCDwf9Hjrt6h02xh0zT4bW3iWG3tkEUUaLtWNF4CgegAAqagAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/2Q==';

document.getElementById('btnInfo').addEventListener('click', () => {
  document.getElementById('infoModal').classList.add('open');
  if(typeof gtag!=='undefined') gtag('event','view_about');
});
document.getElementById('infoModalClose').addEventListener('click', () => {
  document.getElementById('infoModal').classList.remove('open');
  /* hide QR when closing */
  document.getElementById('coffeeQrWrap').style.display = 'none';
  document.getElementById('btnCoffee').style.display = 'flex';
});
document.getElementById('infoModal').addEventListener('click', e => {
  if (e.target === document.getElementById('infoModal')) {
    document.getElementById('infoModal').classList.remove('open');
    document.getElementById('coffeeQrWrap').style.display = 'none';
    document.getElementById('btnCoffee').style.display = 'flex';
  }
});

document.getElementById('btnCoffee').addEventListener('click', () => {
  if(typeof gtag!=='undefined') gtag('event','click_donate');
  const wrap = document.getElementById('coffeeQrWrap');
  const img  = document.getElementById('coffeeQrImg');
  img.src = MOMO_QR_B64;
  wrap.style.display = 'flex';
  document.getElementById('btnCoffee').style.display = 'none';
});


/* ══════════════════════════════════
   i18n — Multi-language
   ══════════════════════════════════ */
const LANG_KEY = 'picnote_lang';

const TRANSLATIONS = {
  vi: {
    /* sidebar tooltips */
    'Thêm ảnh từ máy':'Thêm ảnh từ máy',
    'Thêm ảnh từ URL':'Thêm ảnh từ URL',
    'Thêm chữ':'Thêm chữ',
    'Thêm sticker':'Thêm sticker',
    'Auto sort':'Auto sort',
    'Share link':'Share link',
    'Quick Share (QR)':'Quick Share (QR)',
    'Giới thiệu & Donate':'Giới thiệu',
    'Xuất PNG':'Xuất PNG',
    'Xuất PDF':'Xuất PDF',
    'Xóa board hiện tại':'Xóa board hiện tại',
    /* board hint */
    'hint-title':'Không gian sáng tạo của bạn',
    'hint-sub':'Thêm ảnh, chữ, sticker · Ctrl+V để dán ảnh',
    'hint-add-image':'+ Thêm ảnh',
    'hint-add-text':'+ Thêm chữ',
    /* modals */
    'Chỉnh sửa chữ':'Chỉnh sửa chữ',
    'Nhập nội dung...':'Nhập nội dung...',
    'Cỡ chữ':'Cỡ chữ',
    'Font':'Font',
    'Màu chữ':'Màu chữ',
    'Kiểu':'Kiểu',
    'Nền chữ':'Nền chữ',
    'Hủy':'Hủy', 'Lưu':'Lưu',
    'Chọn Sticker':'Chọn Sticker',
    'Thêm ảnh từ URL (modal)':'Thêm ảnh từ URL',
    'URL ảnh':'URL ảnh',
    'url-hint':'Dán link ảnh trực tiếp (jpg, png, webp…).',
    'Thêm ảnh':'Thêm ảnh',
    'Share Board':'Share Board',
    'Preview':'Preview',
    'Tải file sharing':'Tải file sharing',
    'Ảnh URL':'Ảnh URL',
    'Ảnh local':'Ảnh local',
    'Tất cả ảnh':'Tất cả ảnh',
    'Quick Share - QR Code':'Quick Share - QR Code',
    'Tải QR':'Tải QR',
    'Về Picnote':'Về Picnote',
    'Tác giả':'Tạo bởi',
    'info-desc':'Không gian sáng tạo để ghi chú, sắp xếp và chia sẻ những khoảnh khắc đẹp của bạn - từ nhiều nguồn khác nhau, theo phong cách của riêng mình.',
    'Email':'Email',
    'donate-msg':'☕ Nếu Picnote giúp bạn lưu giữ những khoảnh khắc đẹp, hãy mời tác giả một ly cà phê nhé!',
    'Buy Me a Coffee':'Buy Me a Coffee',
    'Mua cà phê cho tác giả':'MoMo · VietQR · Napas 247',
    /* toolbar tips */
    'Xoay':'Xoay', 'Thay ảnh':'Thay ảnh', 'Lật ngang':'Lật ngang',
    'Phóng to':'Phóng to', 'Thu nhỏ':'Thu nhỏ', 'Xóa ảnh':'Xóa ảnh',
    /* bottom bar */
    'Board':'Board', 'Nền':'Nền',
    /* toasts */
    'Đang lưu…':'Đang lưu…',
    'Đã lưu ✓':'Đã lưu ✓',
    'Đã dán ảnh từ clipboard ✓':'Đã dán ảnh từ clipboard ✓',
    'Đã xuất PNG ✓':'Đã xuất PNG ✓',
    'Đã xuất PDF ✓':'Đã xuất PDF ✓',
    'Đã tải QR ✓':'Đã tải QR ✓',
    'Đã tải file ✓':'Đã tải: ',
    'Đang tạo PDF…':'Đang tạo PDF…',
    'Đang tạo file…':'Đang tạo file…',
  },
  en: {
    /* sidebar tooltips */
    'Thêm ảnh từ máy':'Add image from device',
    'Thêm ảnh từ URL':'Add image from URL',
    'Thêm chữ':'Add text',
    'Thêm sticker':'Add sticker',
    'Auto sort':'Auto sort',
    'Share link':'Share link',
    'Quick Share (QR)':'Quick Share (QR)',
    'Giới thiệu & Donate':'About & Donate',
    'Xuất PNG':'Export PNG',
    'Xuất PDF':'Export PDF',
    'Xóa board hiện tại':'Clear current board',
    /* board hint */
    'hint-title':'Your creative space',
    'hint-sub':'Add images, text, stickers · Ctrl+V to paste',
    'hint-add-image':'+ Add image',
    'hint-add-text':'+ Add text',
    /* modals */
    'Chỉnh sửa chữ':'Edit text',
    'Nhập nội dung...':'Enter content...',
    'Cỡ chữ':'Font size',
    'Font':'Font',
    'Màu chữ':'Text color',
    'Kiểu':'Style',
    'Nền chữ':'Background',
    'Hủy':'Cancel', 'Lưu':'Save',
    'Chọn Sticker':'Choose Sticker',
    'Thêm ảnh từ URL (modal)':'Add image from URL',
    'URL ảnh':'Image URL',
    'url-hint':'Paste direct image link (jpg, png, webp…).',
    'Thêm ảnh':'Add image',
    'Share Board':'Share Board',
    'Preview':'Preview',
    'Tải file sharing':'Download sharing file',
    'Ảnh URL':'URL images',
    'Ảnh local':'Local images',
    'Tất cả ảnh':'All images',
    'Quick Share - QR Code':'Quick Share - QR Code',
    'Tải QR':'Download QR',
    'Về Picnote':'About Picnote',
    'Tác giả':'Created by',
    'info-desc':'A creative space to annotate, arrange and share your beautiful moments - from many sources, in your own style.',
    'Email':'Email',
    'donate-msg':'☕ If Picnote helps you preserve beautiful moments, buy the author a coffee!',
    'Buy Me a Coffee':'Buy Me a Coffee',
    'Mua cà phê cho tác giả':'MoMo · VietQR · Napas 247',
    /* toolbar tips */
    'Xoay':'Rotate', 'Thay ảnh':'Replace', 'Lật ngang':'Flip',
    'Phóng to':'Zoom in', 'Thu nhỏ':'Zoom out', 'Xóa ảnh':'Delete',
    /* bottom bar */
    'Board':'Board', 'Nền':'BG',
    /* toasts */
    'Đang lưu…':'Saving…',
    'Đã lưu ✓':'Saved ✓',
    'Đã dán ảnh từ clipboard ✓':'Image pasted ✓',
    'Đã xuất PNG ✓':'PNG exported ✓',
    'Đã xuất PDF ✓':'PDF exported ✓',
    'Đã tải QR ✓':'QR downloaded ✓',
    'Đã tải file ✓':'Downloaded: ',
    'Đang tạo PDF…':'Generating PDF…',
    'Đang tạo file…':'Generating file…',
  }
};

let currentLang = localStorage.getItem(LANG_KEY) || 'vi';

function t(key){ return (TRANSLATIONS[currentLang] || TRANSLATIONS.vi)[key] || key; }

function applyLang(){
  const L = currentLang;
  /* sidebar data-tip */
  const tipMap = {
    btnAddImage:'Thêm ảnh từ máy', btnAddUrl:'Thêm ảnh từ URL',
    btnAddText:'Thêm chữ', btnAddSticker:'Thêm sticker',
    btnAutoSort:'Auto sort', btnShare:'Share link', btnQRShare:'Quick Share (QR)',
    btnInfo:'Giới thiệu & Donate', btnExport:'Xuất PNG',
    btnExportPDF:'Xuất PDF', btnClear:'Xóa board hiện tại',
    itbRotate:'Xoay', itbReplace:'Thay ảnh', itbFlip:'Lật ngang',
    itbZoomIn:'Phóng to', itbZoomOut:'Thu nhỏ', itbDelete:'Xóa ảnh',
  };
  Object.entries(tipMap).forEach(([id, viKey]) => {
    const el = document.getElementById(id);
    if(el) el.setAttribute('data-tip', t(viKey));
  });

  /* hint */
  const htEl = document.querySelector('.hint-title');
  if(htEl) htEl.textContent = t('hint-title');
  const hsSub = document.querySelector('.hint-sub');
  if(hsSub) hsSub.textContent = t('hint-sub');
  const haImg = document.querySelector('.hint-actions button:first-child');
  const haTxt = document.querySelector('.hint-actions button:last-child');
  if(haImg) haImg.textContent = t('hint-add-image');
  if(haTxt) haTxt.textContent = t('hint-add-text');

  /* text modal labels */
  const labelMap = {
    'Cỡ chữ': '.ctrl-row label:nth-of-type(1)',
  };
  document.querySelectorAll('#textModal .ctrl-row label').forEach(el => {
    const viText = el.textContent.trim();
    if(t(viText) !== viText) el.textContent = t(viText);
  });
  const tcEl = document.getElementById('textContent');
  if(tcEl) tcEl.placeholder = t('Nhập nội dung...');

  /* modal headers */
  const mhMap = {
    'textModalClose':   'Chỉnh sửa chữ',
    'stickerModalClose':'Chọn Sticker',
    'urlModalClose':    'Thêm ảnh từ URL (modal)',
    'shareModalClose':  null,
    'qrModalClose':     'Quick Share - QR Code',
    'infoModalClose':   'Về Picnote',
  };
  document.querySelector('#textModal .modal-header span:first-child').textContent = t('Chỉnh sửa chữ');
  document.querySelector('#stickerModal .modal-header span:first-child').textContent = t('Chọn Sticker');
  document.querySelector('#urlModal .modal-header span:first-child').textContent = t('Thêm ảnh từ URL (modal)');
  document.querySelector('#qrModal .modal-header span:first-child').textContent = t('Quick Share - QR Code');
  document.querySelector('#infoModal .modal-header span:first-child').textContent = t('Về Picnote');

  /* buttons text */
  document.querySelectorAll('#textModalCancel, #urlModalCancel, #captionModalCancel, #borderModalCancel').forEach(b => { if(b) b.textContent = t('Hủy'); });
  document.querySelectorAll('#textModalSave, #urlModalAdd').forEach(b => {
    if(b) b.textContent = b.id === 'urlModalAdd' ? t('Thêm ảnh') : t('Lưu');
  });
  ['#textModalCancel','#textModalSave','#urlModalCancel','#urlModalAdd'].forEach(sel => {
    const el = document.querySelector(sel); if(!el) return;
    if(sel.includes('Cancel')) el.textContent = t('Hủy');
    else if(sel === '#textModalSave') el.textContent = t('Lưu');
    else if(sel === '#urlModalAdd') el.textContent = t('Thêm ảnh');
  });

  /* share filter tabs */
  document.querySelectorAll('.share-tab').forEach(tab => {
    const map = { url:'Ảnh URL', local:'Ảnh local', all:'Tất cả ảnh' };
    tab.textContent = t(map[tab.dataset.filter] || tab.dataset.filter);
  });

  /* QR download button text */
  const qrdl = document.getElementById('qrDownloadTxt');
  if(qrdl) qrdl.textContent = t('Tải QR');

  /* bottom bar */
  document.querySelector('.bg-label').textContent = t('Nền');

  /* info modal */
  document.querySelector('#infoModal .info-logo').textContent = '✦ Picnote';
  const infoRows = document.querySelectorAll('#infoModal .info-row .info-label');
  if(infoRows[0]) infoRows[0].textContent = t('Tác giả');
  if(infoRows[1]) infoRows[1].textContent = t('Email');
  const infoDescEl = document.getElementById('infoDesc');
  if(infoDescEl) infoDescEl.textContent = t('info-desc');
  const donateMsg = document.querySelector('#infoModal .donate-msg');
  if(donateMsg) donateMsg.textContent = t('donate-msg');
  const coffeeBtn = document.getElementById('btnCoffee');
  if(coffeeBtn) coffeeBtn.innerHTML = '<span>☕</span> ' + t('Buy Me a Coffee');
  const coffeeLabel = document.querySelector('.coffee-qr-label');
  if(coffeeLabel) coffeeLabel.textContent = t('Mua cà phê cho tác giả');

  /* lang toggle active state */
  document.querySelectorAll('.lang-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === currentLang)
  );
}

/* Wire language toggle */
document.getElementById('langToggle').addEventListener('click', e => {
  const btn = e.target.closest('.lang-btn');
  if (!btn) return;
  const newLang = btn.dataset.lang;
  if (newLang === currentLang) return;
  currentLang = newLang;
  localStorage.setItem(LANG_KEY, currentLang);
  applyLang();
  showToast(currentLang === 'en' ? 'Language: English' : 'Ngôn ngữ: Tiếng Việt');
});

/* ══════════════════════════════════
   FAVICON — embed app icon
   ══════════════════════════════════ */

const APP_ICON_B64 = 'data:image/png;base64,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';

function setFavicon(){
  const link = document.getElementById('faviconLink');
  if(link) link.href = APP_ICON_B64;
}

/* ══════════════════════════════════
   BRANDED QR DOWNLOAD
   ══════════════════════════════════ */
function downloadBrandedQR(){
  const qrCanvas = document.getElementById('qrCanvas');
  const now = new Date();
  const dateStr = now.toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric'});
  const timeStr = now.toLocaleTimeString('vi-VN', {hour:'2-digit',minute:'2-digit'});

  const W = 400, PAD = 24;
  const QR_SIZE = 240;
  const HEADER_H = 90;
  const FOOTER_H = 80;
  const TOTAL_H = HEADER_H + QR_SIZE + FOOTER_H + PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = TOTAL_H;
  const ctx = canvas.getContext('2d');

  /* Background */
  ctx.fillStyle = '#1a1510';
  ctx.fillRect(0, 0, W, TOTAL_H);

  /* Grid overlay */
  ctx.strokeStyle = 'rgba(201,169,110,0.06)'; ctx.lineWidth = 1;
  for(let x=0;x<=W;x+=20){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,TOTAL_H);ctx.stroke();}
  for(let y=0;y<=TOTAL_H;y+=20){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

  /* Gold border */
  ctx.strokeStyle = 'rgba(201,169,110,0.5)'; ctx.lineWidth = 1.5;
  ctx.strokeRect(8, 8, W-16, TOTAL_H-16);
  ctx.strokeStyle = 'rgba(201,169,110,0.2)'; ctx.lineWidth = 1;
  ctx.strokeRect(12, 12, W-24, TOTAL_H-24);

  /* App icon */
  const icon = new Image();
  icon.onload = () => {
    const iconSize = 40;
    /* Draw rounded icon */
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(W/2 - iconSize/2, PAD + 4, iconSize, iconSize, 8);
    ctx.clip();
    ctx.drawImage(icon, W/2 - iconSize/2, PAD + 4, iconSize, iconSize);
    ctx.restore();

    /* App name */
    ctx.fillStyle = '#c9a96e';
    ctx.font = 'bold 18px "DM Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Picnote', W/2, PAD + iconSize + 20);

    /* Subtitle */
    ctx.fillStyle = 'rgba(245,240,232,0.55)';
    ctx.font = '11px "DM Mono",monospace';
    ctx.fillText('www.picnote.app', W/2, PAD + iconSize + 36);

    /* QR code (from existing canvas) */
    const qrX = (W - QR_SIZE) / 2;
    const qrY = HEADER_H + PAD;

    /* White background behind QR */
    ctx.fillStyle = '#ffffff';
    const qrPad = 10;
    roundRectPath(ctx, qrX - qrPad, qrY - qrPad, QR_SIZE + qrPad*2, QR_SIZE + qrPad*2, 8);
    ctx.fill();
    ctx.drawImage(qrCanvas, qrX, qrY, QR_SIZE, QR_SIZE);

    /* Footer info */
    const footerY = HEADER_H + PAD + QR_SIZE + PAD;

    /* Separator */
    ctx.strokeStyle = 'rgba(201,169,110,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, footerY + 4); ctx.lineTo(W - PAD, footerY + 4); ctx.stroke();

    ctx.fillStyle = 'rgba(201,169,110,0.8)';
    ctx.font = 'bold 12px "DM Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Board ' + currentBoard + ' · ' + dateStr + ' ' + timeStr, W/2, footerY + 24);

    ctx.fillStyle = 'rgba(245,240,232,0.4)';
    ctx.font = '10px "DM Mono",monospace';
    ctx.fillText('Quét để xem · Scan to view', W/2, footerY + 44);

    /* Download */
    const a = document.createElement('a');
    a.download = `picnote-qr-b${currentBoard}-${dateStr.replace(/\//g,'-')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    showToast(t('Đã tải QR ✓'));
    if(typeof gtag!=='undefined') gtag('event','download_qr',{board_number:currentBoard});
  };
  icon.src = APP_ICON_B64;
}

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

/* ══════════════════════════════════
   UPDATED drawQRCode — simpler URL
   Use shorter QR by encoding a plain text note when URL too long
   ══════════════════════════════════ */
function drawQRCode(text, canvas, size) {
  /* Use a smaller error correction level = simpler QR pattern */
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&bgcolor=ffffff&color=1a1510&format=png&margin=8&ecc=L`;
  const ctx = canvas.getContext('2d');
  canvas.width = size; canvas.height = size;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(201,169,110,0.6)';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Đang tải…', size/2, size/2);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
  };
  img.onerror = () => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#555'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
    ctx.fillText('QR không tải được.', size/2, size/2 - 10);
    ctx.fillText('Copy URL để chia sẻ.', size/2, size/2 + 10);
  };
  img.src = qrApiUrl;
}

/* ══════════════════════════════════
   INIT (v1.0.0)
   ══════════════════════════════════ */
async function init(){
  try{
    db = await openDB();
    await loadBoard(currentBoard);
    await updateTabDots();
  } catch(e){
    console.warn('IndexedDB error:',e);
    showToast('⚠️ Chạy qua http://localhost để lưu được');
  }
  setupStickers();
  applyBoardHeight();
  /* mark active tab */
  document.querySelectorAll('#boardTabsInline .tab-btn').forEach(b=>{
    b.classList.toggle('active',+b.dataset.tab===currentBoard);
  });
  document.getElementById('currentBoardNum').textContent = currentBoard;
  checkShareHash();
  /* Apply language and favicon */
  currentLang = localStorage.getItem(LANG_KEY) || 'vi';
  applyLang();
  setFavicon();
}

init();
