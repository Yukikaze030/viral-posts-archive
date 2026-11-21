// Local Tieba capture additions, AGPL-3.0-or-later.
importScripts('lib/single-file-extension-background.js');
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'tieba-image-v2') return;
  port.onMessage.addListener(m => {
  const sender = port.sender;
  const reply = result => { try { port.postMessage(result); } catch {} };
  (async () => {
    if (!sender.tab || new URL(sender.tab.url).hostname !== 'tieba.baidu.com') throw Error('仅允许贴吧页面');
    const u = new URL(m.url);
    const photo = ['tiebapic.baidu.com', 'imgsrc.baidu.com', 'imgsa.baidu.com'].includes(u.hostname);
    const emoji = (/^tb\d*\.bdstatic\.com$/.test(u.hostname) || u.hostname === 'tieba.baidu.com')
      && /(?:^|\/)(?:face|emoji|emoticon|smiley)(?:\/|_)/i.test(u.pathname);
    if (u.protocol !== 'https:' || !(photo || emoji)) throw Error('非贴吧图片地址');
    const response = await fetch(u.href, {signal: AbortSignal.timeout(25000)});
    if (!response.ok) throw Error('HTTP ' + response.status);
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || !blob.size || blob.size > 30000000) throw Error('图片格式或大小异常');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i=0;i<bytes.length;i+=16384) binary += String.fromCharCode(...bytes.subarray(i,i+16384));
    reply({data:'data:'+blob.type+';base64,'+btoa(binary)});
  })().catch(e => reply({error:e.message}));
  });
});
