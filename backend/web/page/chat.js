    // 查询服务的端口（chat.html / query_service.py 默认跑在 8001）
    const QUERY_PORT = '8001';

    // 解析接口地址，兼容三种打开方式：
    //   1) 页面由查询服务自己提供（正常情况）→ 同源相对路径，局域网/域名访问都不用改
    //   2) 页面被别的端口打开（两个服务都挂了整个 page 目录）→ 指向同一主机的 8001
    //   3) file:// 直接打开页面调试 → 兜底到本机 8001
    // 不要写死 http://127.0.0.1:8001：局域网访问时它会指向访问者自己的机器。
    function resolveApiBase(servicePort){
      if(location.protocol === 'file:') return `http://127.0.0.1:${servicePort}`;
      if(location.port === servicePort) return '';
      return `${location.protocol}//${location.hostname}:${servicePort}`;
    }

    const API_BASE = resolveApiBase(QUERY_PORT);
    const chatEl = document.getElementById('chat');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const apiPill = document.getElementById('apiPill');
    const btnClear = document.getElementById('btnClear');
    const streamToggle = document.getElementById('streamToggle');
    const webSearchSel = document.getElementById('webSearchSel');

    // 联网搜索实现的选择记到本地，刷新后保持（方便对比 mcp / llm 两种方案）
    if(webSearchSel){
      const savedProvider = localStorage.getItem('kb_web_search_provider');
      if(savedProvider) webSearchSel.value = savedProvider;
      webSearchSel.addEventListener('change', () => {
        localStorage.setItem('kb_web_search_provider', webSearchSel.value);
      });
    }

    // Session ID Logic
    let sessionId = localStorage.getItem('kb_session_id');
    if (!sessionId) {
      sessionId = 'sess-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('kb_session_id', sessionId);
    }

    function scrollToBottom(){
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    function nowTime(){
      const d = new Date();
      return d.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
    }
    function formatTime(ts){
      if(!ts) return nowTime();
      const d = new Date(Number(ts) * 1000);
      if(Number.isNaN(d.getTime())) return nowTime();
      return d.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
    }
    function escapeHtml(str){
      return String(str)
        .replaceAll('&','&amp;')
        .replaceAll('<','&lt;')
        .replaceAll('>','&gt;')
        .replaceAll('"','&quot;')
        .replaceAll("'","&#039;");
    }

    function isImageUrl(url){
      // 增加宽松度，有些 url 可能后面跟了奇怪的参数
      // 只要包含 .jpg .png 等扩展名，且后面是 ? # 或 结束，或者被某些标点截断前
      // 简单判断：路径部分以图片后缀结尾
      try {
        const u = new URL(url);
        return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(u.pathname);
      } catch (e) {
        // 如果 new URL 失败（比如相对路径或非法字符），退回正则匹配
        return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url || '');
      }
    }

    function normalizeUrl(rawUrl){
      const s = String(rawUrl || '').trim();
      if(!s) return '';
      // 尽量保留原始 URL，但把空格编码，避免 img src 失败
      return s.replace(/\s/g, '%20');
    }

    function dedupeKeepOrder(arr){
      const seen = new Set();
      const out = [];
      for(const x of (Array.isArray(arr) ? arr : [])){
        const v = String(x || '');
        if(!v) continue;
        if(seen.has(v)) continue;
        seen.add(v);
        out.push(v);
      }
      return out;
    }

    function extractUrlsLoose(text){
      const s = String(text || '');
      // 简单正则提取：匹配 http/https 开头，直到遇到空白字符
      // [^\s] 包含中文、特殊符号等，直到遇到换行或空格
      const regex = /(https?:\/\/[^\s]+)/g;
      const matches = s.match(regex) || [];
      const urls = [];

      // 去除首尾标点
      const trimTailPunct = (u) => String(u || '').replace(/[)\]}'">，。,;；\]】）＞]+$/g, '');
      const trimHeadPunct = (u) => String(u || '').replace(/^[<([{'"]+|^[＜（【\[]+/g, '');

      for(const m of matches){
        let u = trimHeadPunct(trimTailPunct(m));
        // 简单清洗可能混入的结尾
        if(u) urls.push(u);
      }
      return dedupeKeepOrder(urls);
    }

    function parseImagesFromTextLoosely(text){
      const urls = extractUrlsLoose(text).filter(isImageUrl);
      return dedupeKeepOrder(urls);
    }

    function findLastImageMarkerIndex(raw){
      const s = String(raw || '');
      // 支持多种写法：【图片】、【 图片 】、[图片]、[ 图片 ]
      const re = /【\s*图片\s*】|\[\s*图片\s*\]/g;
      let m;
      let lastIdx = -1;
      let lastLen = 0;
      while((m = re.exec(s)) !== null){
        lastIdx = m.index;
        lastLen = m[0].length;
      }
      return { idx: lastIdx, len: lastLen };
    }

    function parseAnswerAndImages(text){
      const raw = String(text || '');
      const { idx, len } = findLastImageMarkerIndex(raw);
      if(idx === -1) return { text: raw, images: [] };

      const before = raw.slice(0, idx).trimEnd();
      const after = raw.slice(idx + len).trim();
      const urls = [];

      // 优先按“每行一个 URL”的方式解析，允许 URL 中包含空格
      const lines = after.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for(const line of lines){
        if(line.startsWith('http://') || line.startsWith('https://')){
          urls.push(line);
        }else{
          // 兼容同一行包含多个 URL 的情况
          const matches = extractUrlsLoose(line);
          for(const u of matches){
            urls.push(u);
          }
        }
      }

      // 去重保序 + 过滤图片链接
      const seen = new Set();
      const images = [];
      for(const u of urls){
        const normalized = normalizeUrl(u);
        if(!isImageUrl(normalized)) continue;
        if(seen.has(normalized)) continue;
        seen.add(normalized);
        images.push(normalized);
      }
      return { text: before, images };
    }

    function shouldShowImagesByAnswer(answerText){
      const t = String(answerText || '');
      // 常见“需要看图/见图/如下图”的表述
      const keywords = [
        '如图', '如下图', '见图', '见下图', '下图', '上图',
        '图片', '示意图', '结构图', '外观', '接线图', '电路图', '原理图', '安装图', '尺寸图', '截图'
      ];
      return keywords.some(k => t.includes(k));
    }

    function renderAnswerWithImages(containerEl, answerText, candidateImageUrls){
      const { text, images: imagesFromBlock } = parseAnswerAndImages(answerText);
      const candidates = Array.isArray(candidateImageUrls)
        ? candidateImageUrls.map(normalizeUrl).filter(isImageUrl)
        : [];
      const hasBlockImages = imagesFromBlock && imagesFromBlock.length > 0;

      // 使用宽松提取
      const looseImages = extractUrlsLoose(answerText).map(normalizeUrl).filter(isImageUrl);

      // 只要后端给了候选图片，就展示（避免答案没写“如图”但用户仍需要看图）
      // 或者从文本里提取到了图片 URL
      const shouldShow = hasBlockImages || (candidates.length > 0) || (looseImages.length > 0);

      // 优先级：Block 显式标记 > 后端候选 > 文本宽松提取
      // 注意：这里做个并集可能更好，防止漏掉
      const allImages = new Set([
          ...(hasBlockImages ? imagesFromBlock : []),
          ...candidates,
          ...looseImages
      ]);
      const images = Array.from(allImages);

      containerEl.textContent = '';

      if((text || '').trim().length > 0){
        const textEl = document.createElement('div');
        textEl.className = 'answer-text';
        textEl.textContent = text;
        containerEl.appendChild(textEl);
      }else{
        const textEl = document.createElement('div');
        textEl.className = 'answer-text';
        textEl.textContent = '（已完成，但未返回答案）';
        containerEl.appendChild(textEl);
      }

      if(images && images.length > 0){
        const imgWrap = document.createElement('div');
        imgWrap.className = 'answer-images';
        for(const url of images){
          const safeUrl = normalizeUrl(url);
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.src = safeUrl;
          img.alt = '参考图片';
          img.referrerPolicy = 'no-referrer';
          img.addEventListener('error', () => {
            img.style.display = 'none';
          });
          imgWrap.appendChild(img);

          const link = document.createElement('a');
          link.href = safeUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = url;
          imgWrap.appendChild(link);
        }
        containerEl.appendChild(imgWrap);
      }
    }

    function addUserMsg(text){
      const html = `
        <div class="msg user">
          <div>
            <div class="bubble">${escapeHtml(text)}</div>
            <div class="meta">${nowTime()}</div>
          </div>
          <div class="avatar">我</div>
        </div>
      `;
      chatEl.insertAdjacentHTML('beforeend', html);
      scrollToBottom();
    }

    function addUserMsgWithTime(text, ts){
      const html = `
        <div class="msg user">
          <div>
            <div class="bubble">${escapeHtml(text)}</div>
            <div class="meta">${formatTime(ts)}</div>
          </div>
          <div class="avatar">我</div>
        </div>
      `;
      chatEl.insertAdjacentHTML('beforeend', html);
      scrollToBottom();
    }

    function addBotMsgWithTime(text, ts, imageUrls){
      const id = 'bot-his-' + Math.random().toString(36).slice(2);
      const html = `
        <div class="msg bot" id="${id}">
          <div class="avatar bot">智能客服</div>
          <div>
            <div class="bubble"><div class="answer"></div></div>
            <div class="meta">${formatTime(ts)}</div>
          </div>
        </div>
      `;
      chatEl.insertAdjacentHTML('beforeend', html);
      const el = document.getElementById(id);
      if(el){
        const answerEl = el.querySelector('.answer');
        renderAnswerWithImages(answerEl, text || '', imageUrls || []);
      }
      scrollToBottom();
    }

    function addBotMsgSkeleton(){
      const id = 'bot-' + Math.random().toString(36).slice(2);
      const html = `
        <div class="msg bot" id="${id}">
          <div class="avatar bot">智能客服</div>
          <div style="min-width: 180px;">
            <div class="bubble">
              <span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>
              <details class="progress" open>
                <summary>阶段进度（等待中）</summary>
                <ul></ul>
              </details>
            </div>
            <div class="meta">${nowTime()}</div>
          </div>
        </div>
      `;
      chatEl.insertAdjacentHTML('beforeend', html);
      scrollToBottom();
      return document.getElementById(id);
    }

    function renderProgress(botMsgEl, doneList, runningList, status){
      const details = botMsgEl.querySelector('details.progress');
      const summary = details.querySelector('summary');
      const ul = details.querySelector('ul');
      const done = Array.isArray(doneList) ? doneList : [];
      const running = Array.isArray(runningList) ? runningList : [];
      const totalDone = done.length;
      const totalRun = running.length;

      const statusMap = {
        'processing': '处理中',
        'completed': '已完成',
        'failed': '失败',
        'pending': '等待中',
      };
      const displayStatus = statusMap[status] || status || 'unknown';

      summary.textContent = `阶段进度（已完成${totalDone}，进行中${totalRun}，状态：${displayStatus}）`;

      const lines = [
        ...done.map(x => `✅ ${x}`),
        ...running.map(x => `⏳ ${x}`)
      ];
      ul.innerHTML = '';
      if(lines.length === 0){
        ul.insertAdjacentHTML('beforeend', '<li>暂无进度</li>');
      }else{
        for(const line of lines){
          ul.insertAdjacentHTML('beforeend', `<li>${escapeHtml(line)}</li>`);
        }
      }
    }

    function finalizeBotAnswer(botMsgEl, answer, error, imageUrls){
      const bubble = botMsgEl.querySelector('.bubble');
      const progress = botMsgEl.querySelector('details.progress');
      const err = (error || '').trim();

      if(err){
        // 失败时保留进度面板但收起：bubble.textContent='' 已经把它从DOM上摘下来，
        // 下面再 appendChild 挂回去，这样用户仍能展开查看走到哪一步失败
        const progressEl = progress ? progress : null;
        if(progressEl) {
            progressEl.removeAttribute('open');
        }
        bubble.textContent = '';
        const errEl = document.createElement('div');
        errEl.className = 'answer';
        errEl.textContent = `抱歉，本次处理失败：\n${err}`;
        bubble.appendChild(errEl);
        if(progressEl) bubble.appendChild(progressEl);
        return;
      }

      const progressEl = progress ? progress : null;
      if(progressEl) {
        progressEl.remove();
        progressEl.removeAttribute('open'); // 完成后自动收起
      }
      bubble.textContent = '';
      const answerEl = document.createElement('div');
      answerEl.className = 'answer';
      bubble.appendChild(answerEl);
      renderAnswerWithImages(answerEl, answer || '', imageUrls || []);
      if(progressEl) bubble.appendChild(progressEl);
    }

    async function apiHealth(){
      try{
        const res = await fetch(`${API_BASE}/health`);
        if(!res.ok) throw new Error('health not ok');
        apiPill.textContent = `API: 已连接`;
      }catch(e){
        apiPill.textContent = `API: 未连接`;
      }
    }

    async function loadHistory(){
      try{
        const res = await fetch(`${API_BASE}/history/${sessionId}`);
        if(!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        if(items.length === 0) return;
        // 保留首条欢迎消息，其余先清空再渲染历史
        const nodes = Array.from(chatEl.querySelectorAll('.msg'));
        for(let i=1;i<nodes.length;i++) nodes[i].remove();
        for(const item of items){
          if(item.role === 'user'){
            addUserMsgWithTime(item.text || '', item.ts);
          }else{
            addBotMsgWithTime(item.text || '', item.ts, item.image_urls || []);
          }
        }
        scrollToBottom();
      }catch(_){}
    }

    async function submitQuery(text){
      const isStream = streamToggle.checked;
      // 联网搜索实现（mcp / llm / off），单次请求覆盖后端默认配置，方便对比两种方案
      const webSearchProvider = webSearchSel ? webSearchSel.value : '';
      const res = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          query: text,
          session_id: sessionId,
          is_stream: isStream,
          web_search_provider: webSearchProvider
        })
      });
      if(!res.ok){
        const msg = await res.text();
        throw new Error(msg || '请求失败');
      }
      return await res.json();
    }

    // 说明：原先这里有一个 poll(taskId, botMsgEl) 轮询函数，
    // 但查询服务只提供 /stream/{session_id} 的 SSE 推送，并没有 /status/{taskId} 接口，
    // 这个函数从未被调用（属于走不到的死代码），为避免误导已删除。

    async function onSend(){
      console.log('[perf] A onSend start', performance.now());
      const text = (inputEl.value || '').trim();
      if(!text) return;
      inputEl.value = '';
      addUserMsg(text);
      const botMsgEl = addBotMsgSkeleton();
      sendBtn.disabled = true;

      try{
        const isStream = streamToggle.checked;
        console.log('[perf] B submitQuery start', performance.now(), { isStream });
        const data = await submitQuery(text);
        console.log('[perf] B submitQuery end', performance.now(), data);

        // 渲染初始状态
        renderProgress(botMsgEl, [], [], 'pending');

        if (!isStream) {
          // 非流式：/query 已把答案、错误原因、图片URL一并返回
          // data: { session_id, answer, error, image_urls, status, done_list, message }
          const finalStatus = data.error ? 'failed' : (data.status || 'completed');
          renderProgress(botMsgEl, data.done_list || [], data.running_list || [], finalStatus);
          finalizeBotAnswer(botMsgEl, data.answer, data.error, data.image_urls || []);
          sendBtn.disabled = false;
          return;
        }

        // 流式：SSE
        const { session_id } = data; // 此时 backend 返回 session_id

        const bubble = botMsgEl.querySelector('.bubble');
        let answerEl = bubble.querySelector('.answer');
        if(!answerEl){
          answerEl = document.createElement('div');
          answerEl.className = 'answer';
          bubble.insertBefore(answerEl, bubble.firstChild);
        }

        const es = new EventSource(`${API_BASE}/stream/${session_id}`);
        console.log('[perf] C EventSource created', performance.now(), { session_id });
        let rawAnswerText = '';
        // 标记本轮流是否已正常收尾（收到 final / final_answer）：
        // 服务端推送 final 后会主动关闭连接，浏览器会再派发一次原生 error 事件，
        // 不做标记的话会被误判成"连接中断"，把已经渲染好的答案污染掉。
        let finished = false;

        es.addEventListener('progress', (e) => {
          try{
            const d = JSON.parse(e.data || '{}');
            renderProgress(botMsgEl, d.done_list, d.running_list, d.status);
            // 当进度状态已完成时，提前结束“...”等待态
            if(d && d.status === 'completed'){
              const typing = botMsgEl.querySelector('.typing');
              if(typing) typing.remove();
              // 防止后端未发送 final 导致按钮一直禁用
              sendBtn.disabled = false;
            }
          }catch(_){}
        });

        es.addEventListener('delta', (e) => {
          try{
            const d = JSON.parse(e.data || '{}');
            const delta = d.delta || '';
            if(delta){
              rawAnswerText += delta;
              // 即使后端未发送 final，也尽可能在流式过程中渲染图片
              renderAnswerWithImages(answerEl, rawAnswerText, []);
              scrollToBottom();
            }
          }catch(_){}
        });

        es.addEventListener('final', (e) => {
          finished = true;
          const typing = botMsgEl.querySelector('.typing');
          if(typing) typing.remove();
          // 收起进度条
          const progress = botMsgEl.querySelector('details.progress');
          if(progress) progress.removeAttribute('open');

          try{
            const d = JSON.parse(e.data || '{}');
            // 流式 delta 可能不包含“【图片】/图片列表”，最终包的 d.answer 才是完整答案；优先使用 d.answer
            const finalText = (d && typeof d.answer === 'string' && d.answer.trim().length > 0) ? d.answer : (rawAnswerText || answerEl.textContent || '');
            renderAnswerWithImages(answerEl, finalText, d.image_urls || []);
          }catch(_){

          }
          es.close();
          sendBtn.disabled = false;
        });

        es.addEventListener('final_answer', (e) => {
           // 响应用户的 final_answer 信号，确保图片渲染
          finished = true;
          const typing = botMsgEl.querySelector('.typing');
          if(typing) typing.remove();
          const progress = botMsgEl.querySelector('details.progress');
          if(progress) progress.removeAttribute('open');

          try{
            const d = JSON.parse(e.data || '{}');
            const finalText = (d && typeof d.answer === 'string' && d.answer.trim().length > 0) ? d.answer : (rawAnswerText || answerEl.textContent || '');
            renderAnswerWithImages(answerEl, finalText, d.image_urls || []);
          }catch(_){}
          es.close();
          sendBtn.disabled = false;
        });

        es.addEventListener('error', (e) => {
          // 服务端正常收尾（final 之后主动关闭连接）时浏览器也会派发一次 error，
          // 此时直接关闭即可，绝不能把它当成失败去污染已经渲染好的答案。
          if(finished){ es.close(); return; }
          const typing = botMsgEl.querySelector('.typing');
          if(typing) typing.remove();
          // 收起进度条
          const progress = botMsgEl.querySelector('details.progress');
          if(progress) progress.removeAttribute('open');

          try{
            const msg = e && e.data ? (JSON.parse(e.data).error || 'SSE 连接中断/失败') : 'SSE 连接中断/失败';
            rawAnswerText += `\n\n（错误：${msg}）`;
            renderAnswerWithImages(answerEl, rawAnswerText, []);
          }catch(_){
            rawAnswerText += `\n\n（错误：SSE 连接中断/失败）`;
            renderAnswerWithImages(answerEl, rawAnswerText, []);
          }
          es.close();
          sendBtn.disabled = false;
        });
      }catch(e){
        const bubble = botMsgEl.querySelector('.bubble');
        // 请求失败时进度面板可能还没创建，用空对象兜底，避免下面读 outerHTML 抛错
        const progress = botMsgEl.querySelector('details.progress') || { outerHTML: '' };
        const typing = botMsgEl.querySelector('.typing');
        if(typing) typing.remove();
        bubble.innerHTML = `请求失败：${escapeHtml(e.message || e)}\n\n` + progress.outerHTML;
        sendBtn.disabled = false;
      }
    }

    sendBtn.addEventListener('click', onSend);
    inputEl.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        onSend();
      }
    });
    btnClear.addEventListener('click', async () => {
      if(!confirm('确定要清空当前会话的历史记录吗？这将无法恢复。')) return;

      try {
        const res = await fetch(`${API_BASE}/history/${sessionId}`, { method: 'DELETE' });
        if(!res.ok) {
           console.error("Failed to clear history backend, status:", res.status);
           alert('服务端清空失败，仅清空本地显示');
        }
      } catch(e) {
        console.error("Failed to clear history backend", e);
        alert('服务端清空失败，仅清空本地显示');
      }

      // 清空除首条欢迎消息外的内容
      const nodes = Array.from(chatEl.querySelectorAll('.msg'));
      for(let i=1;i<nodes.length;i++) nodes[i].remove();
      scrollToBottom();
    });

    apiHealth();
    setInterval(apiHealth, 5000);
    console.log('加载当前会话的历史聊天记忆11');
    loadHistory();
    console.log('加载当前会话的历史聊天记忆22');
    setTimeout(() => inputEl.focus(), 200);