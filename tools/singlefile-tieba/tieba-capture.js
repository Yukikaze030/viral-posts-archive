// Local Tieba capture additions, AGPL-3.0-or-later.
(() => {
  const tid = location.pathname.match(/^\/p\/(\d+)/)?.[1];
  if (!tid || window !== top || document.getElementById('tieba-archive-host')) return;
  const host = document.createElement('div');host.id='tieba-archive-host';
  host.style.cssText='position:fixed;right:16px;bottom:80px;z-index:2147483647';
  document.documentElement.append(host);
  const ui=host.attachShadow({mode:'open'});
  ui.innerHTML=`<style>:host{font:14px sans-serif}section{width:280px;background:#fff;color:#222;padding:16px;border:1px solid #bbb;border-radius:12px;box-shadow:0 4px 24px #0004}button{padding:7px;margin:4px 2px;cursor:pointer}p{line-height:1.5;margin:8px 0}small{color:#666}summary{cursor:pointer;font-weight:bold}</style><section><details open><summary>贴吧长帖采集 · 测试版</summary><p id="status">正在恢复本地记录…</p><button id="start">开始／继续滚动</button><button id="stop">停止</button><button id="save">导出／重试图片</button><button id="reset">清空本帖缓存</button><p><small>建议从顶部开始。仅采集楼主主楼；不展开楼中楼。导出 HTML、MD、JSON。达到底部只代表本次扫描结束，不保证原帖完整。</small></p></details></section>`;
  const status=ui.getElementById('status');let running=false,busy=false,db;
  let state={tid,title:document.title.replace(/-百度贴吧.*$/,''),posts:{},images:{}};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const imageKey=url=>url.replace(/\?.*$/,'');
  function fetchImage(url){
    return new Promise((resolve,reject)=>{
      const port=chrome.runtime.connect({name:'tieba-image-v2'});let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);port.disconnect();error?reject(error):resolve(result);};
      const timer=setTimeout(()=>finish(Error('图片后台通信超时（35 秒）')),35000);
      port.onMessage.addListener(result=>finish(null,result));
      port.onDisconnect.addListener(()=>{const message=chrome.runtime.lastError?.message;finish(Error('图片后台连接断开：'+(message||'请重新加载扩展并刷新页面')));});
      port.postMessage({url});
    });
  }
  const persist=()=>new Promise((resolve,reject)=>{const tx=db.transaction('threads','readwrite');tx.objectStore('threads').put(state,tid);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  function scan(){
    for(const item of document.querySelectorAll('.pb-comment-item')){
      const head=item.querySelector('.user-info');if(!head?.textContent.includes('楼主'))continue;
      const floor=Number(item.textContent.match(/第\s*(\d+)\s*楼/)?.[1]);if(!floor)continue;
      const root=item.querySelector('.comment-content');if(!root)continue;
      const content=root.querySelector('.pb-rich-text');
      const text=content?.innerText.trim()||'';
      const pictures=[...root.querySelectorAll('.image-card-wrapper img, img[data-src]')].map(i=>i.getAttribute('data-src')||i.currentSrc||i.src).filter(u=>/^https:\/\/(tiebapic|imgsrc|imgsa)\.baidu\.com\//.test(u));
      const old=state.posts[floor];
      state.posts[floor]={floor,pid:item.dataset.id||old?.pid||'',author:head.querySelector('.head-name')?.textContent.trim()||old?.author||'',text:text||old?.text||'',pictures:[...new Map([...(old?.pictures||[]),...pictures].map(u=>[imageKey(u),u])).values()]};
    }
  }
  function show(extra=''){const posts=Object.values(state.posts);const urls=new Set(posts.flatMap(p=>p.pictures).map(imageKey));status.textContent=`已收集 ${posts.length} 楼、${urls.size} 张配图；已下载 ${Object.keys(state.images).length} 张。${extra}`;}
  async function start(){
    if(running||busy)return;running=true;let stable=0,last='';
    try{while(running){scan();await persist();show('滚动采集中…');
      const elements=[document.scrollingElement,...document.querySelectorAll('main, [class*="scroll"], [class*="comment-list"]')];
      const candidates=elements.filter(e=>e&&e.scrollHeight>e.clientHeight+100&&e.clientHeight>100);
      const scroller=candidates.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]||document.scrollingElement;
      const before=scroller.scrollTop;scroller.scrollBy({top:Math.max(300,scroller.clientHeight*.75),behavior:'instant'});
      await sleep(1800);scan();
      const key=Object.keys(state.posts).length+':'+scroller.scrollHeight+':'+scroller.scrollTop;
      stable=(key===last&&Math.abs(scroller.scrollTop-before)<3)?stable+1:0;last=key;
      if(stable>=8){running=false;show('已停止增长，请确认末尾；可再次继续。');}
    }}catch(e){show('错误：'+e.message);}finally{running=false;await persist();show('已停止，可导出或继续。');}
  }
  function download(name,content,type){const u=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}
  async function save(){
    if(busy||running){show('请先停止滚动再导出。');return;}busy=true;
    try{scan();const failures=[];const posts=Object.values(state.posts).sort((a,b)=>a.floor-b.floor);const urls=[...new Map(posts.flatMap(p=>p.pictures).map(u=>[imageKey(u),u])).values()];
      for(let n=0;n<urls.length;n++){const url=urls[n],key=imageKey(url);if(state.images[key])continue;show(`下载图片 ${n+1}/${urls.length}…`);
        try{const result=await fetchImage(url);if(!result?.data)throw Error(result?.error||'图片后台未返回数据');
          await new Promise((ok,no)=>{const im=new Image();im.onload=()=>im.naturalWidth>2&&im.naturalHeight>2?ok():no(Error('占位图片'));im.onerror=()=>no(Error('图片损坏'));im.src=result.data;});
          state.images[key]=result.data;
        }catch(e){failures.push({url,floors:posts.filter(p=>p.pictures.some(u=>imageKey(u)===key)).map(p=>p.floor),reason:e.message});}
        await persist();await sleep(350);
      }
      const name=state.title.replace(/[\\/:*?"<>|]/g,'_')+'_'+tid;
      const body=posts.map(p=>`<article><h2>第 ${p.floor} 楼 · ${esc(p.author)}</h2><p>${esc(p.text).replace(/\n/g,'<br>')}</p>${p.pictures.map(u=>state.images[imageKey(u)]?`<img src="${state.images[imageKey(u)]}" alt="第${p.floor}楼配图">`:`<p>图片未下载：${esc(u)}</p>`).join('')}</article>`).join('');
      download(name+'.html',`<!doctype html><meta charset="utf-8"><title>${esc(state.title)}</title><style>body{max-width:850px;margin:40px auto;padding:20px;font:18px/1.8 sans-serif}img{max-width:100%;height:auto}article{border-bottom:1px solid #ccc;padding:20px 0}</style><h1>${esc(state.title)}</h1><p>来源：https://tieba.baidu.com/p/${tid}<br>本次累计 ${posts.length} 楼；图片下载失败 ${failures.length} 张。仅保存已采集内容，未经完整性认证。</p>${body}`,'text/html;charset=utf-8');
      download(name+'.md',`# ${state.title}\n\n来源：https://tieba.baidu.com/p/${tid}\n\n`+posts.map(p=>`## 第 ${p.floor} 楼 · ${p.author}\n\n${p.text}\n\n`+p.pictures.map(u=>`![第${p.floor}楼配图](${u})`).join('\n')).join('\n\n'),'text/markdown;charset=utf-8');
      download(name+'-记录与失败清单.json',JSON.stringify({tid,title:state.title,exportedAt:new Date().toISOString(),posts,failures,complete:false},null,2),'application/json');show(`导出完成，失败 ${failures.length} 张。MD 的图片为在线链接，离线图片在 HTML 中。`);
    }catch(e){show('导出失败：'+e.message);}finally{busy=false;}
  }
  const request=indexedDB.open('tieba-long-archive-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('threads');
  request.onsuccess=()=>{db=request.result;const q=db.transaction('threads').objectStore('threads').get(tid);q.onsuccess=()=>{if(q.result)state=q.result;scan();show();ui.getElementById('start').onclick=start;ui.getElementById('stop').onclick=()=>{running=false;};ui.getElementById('save').onclick=save;ui.getElementById('reset').onclick=async()=>{if(busy||running)return;if(confirm('清空本帖采集缓存？已导出的文件不受影响。')){state.posts={};state.images={};await persist();show();}};};};
  request.onerror=()=>{status.textContent='本地缓存不可用：'+request.error;};
})();
