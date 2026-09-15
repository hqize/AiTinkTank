const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');

    // 导入服务的端口（import.html / import_service.py 默认跑在 8000）
    const IMPORT_PORT = '8000';

    // 解析接口地址，兼容三种打开方式：
    //   1) 页面由导入服务自己提供（正常情况）→ 同源相对路径，局域网/域名访问都不用改
    //   2) 页面被别的端口打开（两个服务都挂了整个 page 目录）→ 指向同一主机的 8000
    //   3) file:// 直接打开页面调试 → 兜底到本机 8000
    // 不要写死 http://127.0.0.1:8000：局域网访问时它会指向访问者自己的机器。
    function resolveApiBase(servicePort){
      if(location.protocol === 'file:') return `http://127.0.0.1:${servicePort}`;
      if(location.port === servicePort) return '';
      return `${location.protocol}//${location.hostname}:${servicePort}`;
    }

    const API_BASE = resolveApiBase(IMPORT_PORT);

    // 允许的文件类型，与后端 import_service.ALLOWED_SUFFIXES 保持一致
    const ALLOWED_EXTENSIONS = ['.pdf', '.md'];
    const POLL_INTERVAL_MS = 2000;   // 轮询间隔
    const MAX_POLL_TIMES = 900;      // 最多轮询 900 次（约30分钟），避免异常时无限轮询

    // 进度条颜色
    const COLOR_RUNNING = '#f39c12'; // 橘色：进行中
    const COLOR_DONE = '#2ecc71';    // 绿色：已完成
    const COLOR_ERROR = '#e74c3c';   // 红色：失败

    // 上传阶段占进度条 0~20%，节点处理阶段占 20~95%，完成时 100%
    const UPLOAD_PHASE_MAX = 20;
    const PROCESS_PHASE_MAX = 95;
    const PROCESS_NODE_TOTAL = 8;    // 上传阶段1个 + 图中7个节点（MD文件跳过PDF转Markdown属正常偏差）

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '#ecf6fd';
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.backgroundColor = '';
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        // 清空 value，保证连续选择同一个文件也能再次触发 change
        e.target.value = '';
    });

    function handleFiles(files) {
        Array.from(files).forEach(uploadFile);
    }

    function escapeHtml(text) {
        // 文件名会拼进 innerHTML，必须先转义（Linux/macOS 文件名可以包含 < > 等字符）
        return String(text).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));
    }

    function getExtension(fileName) {
        const name = String(fileName);
        const index = name.lastIndexOf('.');
        return index === -1 ? '' : name.slice(index).toLowerCase();
    }

    function isAllowedFile(file) {
        return ALLOWED_EXTENSIONS.includes(getExtension(file.name));
    }

    function setProgressBar(bar, percentage, color) {
        const value = Math.max(0, Math.min(100, Math.round(percentage)));
        bar.style.width = value + '%';
        bar.style.backgroundColor = color || (value >= 100 ? COLOR_DONE : COLOR_RUNNING);
    }

    function setStatus(badge, text, className) {
        badge.textContent = text;
        badge.className = 'status-badge ' + className;
    }

    // 创建文件项UI，返回各元素的引用，避免后续反复查询DOM
    function createFileItem(file) {
        const id = 'file-' + Math.random().toString(36).slice(2, 11);
        const html = `
            <div class="file-item" id="${id}">
                <div class="file-info">
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    <span class="file-size">${(file.size / 1024).toFixed(2)} KB</span>
                    <div class="progress-bar-container">
                        <div class="progress-bar"></div>
                    </div>
                    <details class="log-details">
                        <summary>日志（点击展开）</summary>
                        <ul class="log-list"></ul>
                    </details>
                </div>
                <div class="status-badge status-uploading">上传中...</div>
            </div>
        `;
        fileList.insertAdjacentHTML('afterbegin', html);

        const itemEl = document.getElementById(id);
        return {
            itemEl,
            statusBadge: itemEl.querySelector('.status-badge'),
            progressBar: itemEl.querySelector('.progress-bar'),
            progressContainer: itemEl.querySelector('.progress-bar-container'),
            logDetails: itemEl.querySelector('.log-details'),
            logSummary: itemEl.querySelector('.log-details summary'),
            logListEl: itemEl.querySelector('.log-list'),
        };
    }

    // 用 XMLHttpRequest 上传：fetch 拿不到上传进度，XHR 的 upload.onprogress 可以
    function uploadWithProgress(file, onProgress) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('files', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE}/upload`);

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    onProgress((e.loaded / e.total) * 100);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error(`上传失败，HTTP ${xhr.status}`));
                    return;
                }
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                    reject(new Error('上传响应解析失败'));
                }
            });

            xhr.addEventListener('error', () => reject(new Error('上传请求失败，请确认后端服务已启动')));
            xhr.addEventListener('abort', () => reject(new Error('上传已中止')));

            xhr.send(formData);
        });
    }

    async function uploadFile(file) {
        const ui = createFileItem(file);
        ui.progressContainer.style.display = 'block';

        // 1. 前端先做类型校验，避免把不支持的文件传上去再等后端报错
        if (!isAllowedFile(file)) {
            setProgressBar(ui.progressBar, 100, COLOR_ERROR);
            setStatus(ui.statusBadge, '失败', 'status-error');
            renderLogs(ui, [], [], `不支持的文件类型，仅支持 ${ALLOWED_EXTENSIONS.join(' / ')}`);
            return;
        }

        // 2. 上传文件（带真实进度）
        let taskId;
        try {
            const result = await uploadWithProgress(file, (percent) => {
                setProgressBar(ui.progressBar, (percent / 100) * UPLOAD_PHASE_MAX, COLOR_RUNNING);
            });

            taskId = (result.task_ids || [])[0];
            if (!taskId) throw new Error('后端未返回 task_id');
        } catch (error) {
            console.error(error);
            setProgressBar(ui.progressBar, 100, COLOR_ERROR);
            setStatus(ui.statusBadge, '失败', 'status-error');
            renderLogs(ui, [], [], error.message || String(error));
            return;
        }

        // 3. 上传完成，进入处理中，开始轮询节点状态
        setProgressBar(ui.progressBar, UPLOAD_PHASE_MAX, COLOR_RUNNING);
        setStatus(ui.statusBadge, '处理中...', 'status-processing');
        pollStatus(taskId, ui);
    }

    function normalizeDoneLog(text) {
        // 后端可能返回中文节点名，也可能已拼接“已完成”
        if (typeof text !== 'string') return String(text);
        return text.endsWith('已完成') ? text : `${text}已完成`;
    }

    function normalizeRunningLog(text) {
        // 后端可能返回中文节点名，也可能已拼接“正在进行.../处理中...”
        if (typeof text !== 'string') return String(text);
        if (text.startsWith('正在进行')) return text.endsWith('...') ? text : `${text}...`;
        return `正在进行${text}...`;
    }

    function renderLogs(ui, doneList, runningList, errorText) {
        const done = Array.isArray(doneList) ? doneList : [];
        const running = Array.isArray(runningList) ? runningList : [];
        const error = errorText ? String(errorText) : '';

        // 更新 summary（即使收起也能看到进度和失败原因）
        ui.logSummary.textContent = `日志（已完成${done.length}，进行中${running.length}${error ? '，失败' : ''}，点击展开）`;

        // 清空并重建列表
        ui.logListEl.innerHTML = '';
        const lines = [
            ...done.map(normalizeDoneLog),
            ...running.map(normalizeRunningLog),
        ];
        if (error) lines.push(`失败原因：${error}`);

        if (lines.length === 0) {
            const li = document.createElement('li');
            li.textContent = '暂无日志';
            ui.logListEl.appendChild(li);
            // 如果没有任何日志，默认收起
            ui.logDetails.open = false;
        } else {
            for (const line of lines) {
                const li = document.createElement('li');
                // 用 textContent 而不是 innerHTML，内容自动转义
                li.textContent = line;
                ui.logListEl.appendChild(li);
            }
            // 失败时自动展开，让用户直接看到原因
            if (error) ui.logDetails.open = true;
        }
    }

    function finishWithError(ui, message) {
        setProgressBar(ui.progressBar, 100, COLOR_ERROR);
        setStatus(ui.statusBadge, '失败', 'status-error');
        renderLogs(ui, [], [], message);
    }

    function pollStatus(taskId, ui) {
        let pollTimes = 0;

        const interval = setInterval(async () => {
            pollTimes += 1;
            if (pollTimes > MAX_POLL_TIMES) {
                clearInterval(interval);
                finishWithError(ui, '轮询超时，任务可能已被中断（如后端服务重启），请刷新页面后重新上传');
                return;
            }

            try {
                const res = await fetch(`${API_BASE}/status/${taskId}`);
                if (!res.ok) throw new Error(`状态查询失败，HTTP ${res.status}`);
                const data = await res.json();

                const done = Array.isArray(data.done_list) ? data.done_list : [];

                if (data.status === 'completed') {
                    clearInterval(interval);
                    renderLogs(ui, done, [], '');
                    setStatus(ui.statusBadge, '已完成', 'status-completed');
                    setProgressBar(ui.progressBar, 100, COLOR_DONE);
                    return;
                }

                if (data.status === 'failed') {
                    clearInterval(interval);
                    renderLogs(ui, done, [], data.error || '未知错误');
                    setStatus(ui.statusBadge, '失败', 'status-error');
                    setProgressBar(ui.progressBar, 100, COLOR_ERROR);
                    return;
                }

                if (data.status === 'pending' || data.status === 'processing') {
                    // 保持处理中状态，进度按已完成节点数推进（不会倒退）
                    renderLogs(ui, done, data.running_list, '');
                    setStatus(ui.statusBadge, '处理中...', 'status-processing');
                    const processed = UPLOAD_PHASE_MAX
                        + (done.length / PROCESS_NODE_TOTAL) * (PROCESS_PHASE_MAX - UPLOAD_PHASE_MAX);
                    setProgressBar(ui.progressBar, Math.min(PROCESS_PHASE_MAX, processed), COLOR_RUNNING);
                    return;
                }

                // status 为空：后端不认识这个 task_id（例如服务重启后内存状态丢失），继续轮询没有意义
                if (!data.status) {
                    clearInterval(interval);
                    finishWithError(ui, '未查询到该任务（后端可能已重启），请刷新页面后重新上传');
                }
            } catch (e) {
                // 单次轮询失败（如网络抖动、后端重启中）不终止轮询，等下一次
                console.error('Polling error', e);
            }
        }, POLL_INTERVAL_MS);
    }
