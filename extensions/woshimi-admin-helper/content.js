(() => {
  'use strict';

  const LEFT_HEADER_ATTRIBUTE = 'data-auto-sequence-header-left';
  const RIGHT_HEADER_ATTRIBUTE = 'data-auto-sequence-header-right';
  const LEFT_CELL_ATTRIBUTE = 'data-auto-sequence-cell-left';
  const RIGHT_CELL_ATTRIBUTE = 'data-auto-sequence-cell-right';
  const IMAGE_HEADER_ATTRIBUTE = 'data-auto-sequence-image-header';
  const IMAGE_CELL_ATTRIBUTE = 'data-auto-sequence-image-cell';
  const ANSWER_HEADER_ATTRIBUTE = 'data-auto-sequence-answer-header';
  const ANSWER_CELL_ATTRIBUTE = 'data-auto-sequence-answer-cell';
  const DELIVERY_HEADER_ATTRIBUTE = 'data-auto-sequence-delivery-header';
  const DELIVERY_CELL_ATTRIBUTE = 'data-auto-sequence-delivery-cell';
  const STYLE_ID = 'auto-sequence-column-style';
  const ACTIVE_TAB_STORAGE_KEY = 'auto-sequence-last-drama-tab';
  const HIDDEN_CONFIG_COLUMNS = new Set([
    '展示问题结果',
    '展示结果标题',
    '展示问题详情结果',
    '说明',
    '角色过滤条件',
    '优先级',
    '上传时间',
    '更新时间',
  ]);
  const ALWAYS_VISIBLE_CONFIG_COLUMNS = new Set(['得分策略', '公共/角色', '操作', '配图', '正确答案', '序号']);
  let updateTimer = null;
  let restoreTimer = null;
  let shellReady = false;
  const imageCache = new Map();
  let deliveryOptionsPromise = null;

  function isDramaShellPage() {
    return /^\/drama(?:\/|$)/.test(window.location.pathname);
  }

  function getActiveMenuTab() {
    return Array.from(document.querySelectorAll('.menuTab')).find(tab => tab.classList.contains('active')) || null;
  }

  function rememberActiveTab() {
    if (!isDramaShellPage() || !shellReady) return;
    const active = getActiveMenuTab();
    const id = active?.getAttribute('data-id');
    if (!id) return;
    try {
      sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, JSON.stringify({ id, savedAt: Date.now() }));
    } catch (_) {
      // 存储不可用时不影响表格功能。
    }
  }

  function restoreActiveTab(attempt = 0) {
    if (!isDramaShellPage()) return;
    let state = null;
    try {
      state = JSON.parse(sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || 'null');
    } catch (_) {
      state = null;
    }
    if (!state?.id || Date.now() - Number(state.savedAt || 0) > 6 * 60 * 60 * 1000) {
      shellReady = true;
      return;
    }
    const target = Array.from(document.querySelectorAll('.menuTab')).find(tab => tab.getAttribute('data-id') === state.id);
    if (!target) {
      if (attempt < 20) restoreTimer = window.setTimeout(() => restoreActiveTab(attempt + 1), 250);
      return;
    }
    shellReady = true;
    if (!target.classList.contains('active')) target.click();
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${LEFT_HEADER_ATTRIBUTE}],
      th[${RIGHT_HEADER_ATTRIBUTE}],
      td[${LEFT_CELL_ATTRIBUTE}],
      td[${RIGHT_CELL_ATTRIBUTE}] {
        width: 58px !important;
        min-width: 58px !important;
        text-align: center !important;
        vertical-align: middle !important;
        white-space: nowrap !important;
      }

      th[${IMAGE_HEADER_ATTRIBUTE}],
      td[${IMAGE_CELL_ATTRIBUTE}] {
        min-width: 150px !important;
        width: 150px !important;
        text-align: center !important;
        vertical-align: middle !important;
      }

      td[${IMAGE_CELL_ATTRIBUTE}] .auto-sequence-image-list {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      td[${IMAGE_CELL_ATTRIBUTE}] img {
        width: 34px;
        height: 34px;
        border-radius: 4px;
        object-fit: cover;
        border: 1px solid #d9e2ec;
        background: #f5f7fa;
      }

      td[${IMAGE_CELL_ATTRIBUTE}] .auto-sequence-image-count {
        color: #1f8b4c;
        font-size: 12px;
        white-space: nowrap;
      }

      td[${IMAGE_CELL_ATTRIBUTE}] .auto-sequence-image-status {
        color: #1f8b4c;
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }

      td[${IMAGE_CELL_ATTRIBUTE}] .auto-sequence-no-image {
        color: #9aa5b1;
      }

      th[${ANSWER_HEADER_ATTRIBUTE}],
      td[${ANSWER_CELL_ATTRIBUTE}] {
        min-width: 180px !important;
        width: 180px !important;
        text-align: center !important;
        vertical-align: middle !important;
      }

      td[${ANSWER_CELL_ATTRIBUTE}] .auto-sequence-answer-text {
        color: #168348;
        font-weight: 600;
        white-space: normal;
      }

      td[${ANSWER_CELL_ATTRIBUTE}] .auto-sequence-no-answer {
        color: #9aa5b1;
      }

      [data-auto-sequence-hidden-column="true"] {
        display: none !important;
      }

      th[${DELIVERY_HEADER_ATTRIBUTE}],
      td[${DELIVERY_CELL_ATTRIBUTE}] {
        min-width: 140px !important;
        width: 140px !important;
        text-align: center !important;
        vertical-align: middle !important;
      }

      td[${DELIVERY_CELL_ATTRIBUTE}] select {
        min-width: 120px;
        max-width: 150px;
        padding: 3px 6px;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        background: #fff;
      }

      td[${DELIVERY_CELL_ATTRIBUTE}].auto-sequence-saving select {
        opacity: .6;
      }

      td[${LEFT_CELL_ATTRIBUTE}],
      td[${RIGHT_CELL_ATTRIBUTE}] {
        color: #2f4050;
        font-weight: 600;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTargetTable() {
    const preferredTable = document.querySelector('#bootstrap-table');
    if (preferredTable) return preferredTable;

    return document.querySelector('.bootstrap-table table');
  }

  function getInsertionIndex(headerRow) {
    const headers = Array.from(headerRow.cells);
    const checkboxIndex = headers.findIndex(header =>
      header.classList.contains('bs-checkbox') ||
      header.querySelector('input[type="checkbox"]')
    );

    if (checkboxIndex >= 0) return checkboxIndex + 1;

    const detailIndex = headers.findIndex(header =>
      header.classList.contains('detail') ||
      header.getAttribute('data-field') === '_detail'
    );

    return detailIndex >= 0 ? detailIndex + 1 : 0;
  }

  function createSequenceHeader(attribute, fieldName) {
    const header = document.createElement('th');
    header.setAttribute(attribute, 'true');
    header.setAttribute('data-field', fieldName);
    header.setAttribute('data-align', 'center');
    header.innerHTML = '<div class="th-inner">序号</div><div class="fht-cell"></div>';
    return header;
  }

  function isVoteConfigPage() {
    return /\/modules\/drama\/drama_vote(?:\/|$)/.test(window.location.pathname);
  }

  function isCharacterStoryPage() {
    return /\/modules\/drama\/character_story(?:\/|$)/.test(window.location.pathname) && !/\/edit\//.test(window.location.pathname);
  }

  function getActionColumnIndex(headerRow) {
    const index = Array.from(headerRow.cells).findIndex(cell => cell.textContent.trim() === '操作');
    return index >= 0 ? index : headerRow.cells.length;
  }

  function ensureImageHeader(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return null;
    let header = headerRow.querySelector(`th[${IMAGE_HEADER_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(IMAGE_HEADER_ATTRIBUTE, 'true');
      header.innerHTML = '<div class="th-inner">配图</div><div class="fht-cell"></div>';
      headerRow.insertBefore(header, headerRow.cells[getActionColumnIndex(headerRow)] || null);
    }
    return header.cellIndex;
  }

  function ensureAnswerHeader(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return null;
    let header = headerRow.querySelector(`th[${ANSWER_HEADER_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(ANSWER_HEADER_ATTRIBUTE, 'true');
      header.innerHTML = '<div class="th-inner">正确答案</div><div class="fht-cell"></div>';
      headerRow.insertBefore(header, headerRow.cells[getActionColumnIndex(headerRow)] || null);
    }
    return header.cellIndex;
  }

  function hideDefaultConfigColumns() {
    if (!isVoteConfigPage()) return;
    document.querySelectorAll('table').forEach(table => {
      const headerRow = table.querySelector('thead tr');
      if (!headerRow) return;
      table.querySelectorAll('[data-auto-sequence-hidden-column="true"]').forEach(cell => {
        cell.removeAttribute('data-auto-sequence-hidden-column');
      });
      const hiddenIndexes = new Set();
      Array.from(headerRow.cells).forEach((header, index) => {
        const name = header.textContent.replace(/\s+/g, ' ').trim();
        if (!HIDDEN_CONFIG_COLUMNS.has(name) || ALWAYS_VISIBLE_CONFIG_COLUMNS.has(name)) return;
        hiddenIndexes.add(index);
        header.setAttribute('data-auto-sequence-hidden-column', 'true');
      });
      if (!hiddenIndexes.size) return;
      table.querySelectorAll('tbody tr').forEach(row => {
        Array.from(row.cells).forEach((cell, index) => {
          if (hiddenIndexes.has(index)) cell.setAttribute('data-auto-sequence-hidden-column', 'true');
        });
      });
    });
  }

  function getPackId(row) {
    const action = row.querySelector('[onclick*="operate.edit("]');
    const match = action?.getAttribute('onclick')?.match(/operate\.edit\(['"](\d+)['"]\)/);
    return match ? match[1] : null;
  }

  function getStoryId(row) {
    const action = row.querySelector('[onclick*="operate.edit("]');
    const match = action?.getAttribute('onclick')?.match(/operate\.edit\(['"](\d+)['"]\)/);
    return match ? match[1] : null;
  }

  async function loadDeliveryOptions(storyId) {
    if (!deliveryOptionsPromise) {
      deliveryOptionsPromise = fetch(`/modules/drama/character_story/edit/${storyId}`)
        .then(response => response.text())
        .then(html => {
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const select = parsed.querySelector('select[name="deliveryScene"]');
          const options = Array.from(select?.options || []).map(option => ({ value: option.value, text: option.textContent.trim() }));
          return options.length ? options : [{ value: '0', text: '无' }];
        })
        .catch(error => {
          console.warn('[投票表格自动序号] 读取下发回合选项失败', error);
          return [{ value: '0', text: '无' }];
        });
    }
    return deliveryOptionsPromise;
  }

  async function saveDeliveryScene(storyId, value, cell) {
    cell.classList.add('auto-sequence-saving');
    const body = new URLSearchParams({ id: storyId, deliveryScene: value });
    try {
      const response = await fetch('/modules/drama/character_story/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      cell.title = '已保存';
      return true;
    } catch (error) {
      cell.title = '保存失败，请重新选择';
      console.warn('[投票表格自动序号] 保存下发回合失败', error);
      return false;
    } finally {
      cell.classList.remove('auto-sequence-saving');
    }
  }

  async function updateDeliverySceneCells(table) {
    if (!isCharacterStoryPage()) return;
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    let header = headerRow.querySelector(`th[${DELIVERY_HEADER_ATTRIBUTE}]`) ||
      Array.from(headerRow.cells).find(cell => cell.textContent.trim() === '下发回合');
    if (!header) {
      header = document.createElement('th');
      header.innerHTML = '<div class="th-inner">下发回合</div><div class="fht-cell"></div>';
      const actionIndex = getActionColumnIndex(headerRow);
      headerRow.insertBefore(header, headerRow.cells[actionIndex] || null);
    }
    header.setAttribute(DELIVERY_HEADER_ATTRIBUTE, 'true');
    const deliveryIndex = header.cellIndex;
    const rows = Array.from(table.querySelectorAll('tbody > tr')).filter(isDataRow);
    const firstId = rows.map(getStoryId).find(Boolean);
    if (!firstId) return;
    const options = await loadDeliveryOptions(firstId);
    rows.forEach(row => {
      const storyId = getStoryId(row);
      if (!storyId) return;
      let cell = row.querySelector(`td[${DELIVERY_CELL_ATTRIBUTE}]`);
      if (!cell) {
        cell = document.createElement('td');
        cell.setAttribute(DELIVERY_CELL_ATTRIBUTE, 'true');
        row.insertBefore(cell, row.cells[deliveryIndex] || null);
      }
      const currentText = row.cells[deliveryIndex]?.textContent.trim() || '';
      const existingSelect = cell.querySelector('select');
      if (existingSelect) return;
      const select = document.createElement('select');
      select.className = 'auto-sequence-delivery-select';
      options.forEach(option => {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.text;
        if (option.text === currentText || (option.value === '0' && (currentText === '-' || currentText === '无'))) item.selected = true;
        select.appendChild(item);
      });
      select.addEventListener('change', () => saveDeliveryScene(storyId, select.value, cell));
      cell.replaceChildren(select);
    });
  }

  function answerLetter(index) {
    let value = index + 1;
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  async function loadPackImages(packId) {
    const cached = imageCache.get(packId);
    if (cached && Date.now() - cached.time < 15000) return { images: cached.images, answers: cached.answers || [] };

    const params = new URLSearchParams(window.location.search);
    params.set('voteId', packId);
    params.set('limit', '100');
    params.set('offset', '0');
    try {
      const response = await fetch(`/modules/drama/vote_option/list?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : (payload.rows || payload.data || []);
      const images = rows.map(item => item?.image).filter(value => typeof value === 'string' && value.trim());
      const answers = rows
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item?.isAnswer === 1 || item?.isAnswer === '1' || item?.isAnswer === true || item?.isAnswer === '是')
        .map(({ item, index }) => `${answerLetter(index)}、${String(item?.title || '').trim()}`)
        .filter(Boolean);
      const result = { images, answers };
      imageCache.set(packId, { time: Date.now(), ...result });
      return result;
    } catch (error) {
      console.warn('[投票表格自动序号] 读取投票选项图片失败', packId, error);
      return { images: [], answers: [] };
    }
  }

  function renderImageCell(cell, images) {
    const signature = images.join('|');
    if (cell.dataset.imageSignature === signature) return;
    cell.dataset.imageSignature = signature;
    cell.replaceChildren();
    if (!images.length) {
      const empty = document.createElement('span');
      empty.className = 'auto-sequence-no-image';
      empty.textContent = '未配图';
      cell.appendChild(empty);
      return;
    }
    const status = document.createElement('span');
    status.className = 'auto-sequence-image-status';
    status.textContent = '已配图';
    cell.appendChild(status);
    const list = document.createElement('span');
    list.className = 'auto-sequence-image-list';
    images.slice(0, 4).forEach(src => {
      const image = document.createElement('img');
      image.src = src;
      image.alt = '已配置图片';
      image.loading = 'lazy';
      list.appendChild(image);
    });
    if (images.length > 4) {
      const count = document.createElement('span');
      count.className = 'auto-sequence-image-count';
      count.textContent = `+${images.length - 4}`;
      list.appendChild(count);
    }
    cell.appendChild(list);
  }

  function renderAnswerCell(cell, answers) {
    const signature = answers.join('|');
    if (cell.dataset.answerSignature === signature) return;
    cell.dataset.answerSignature = signature;
    cell.replaceChildren();
    const text = document.createElement('span');
    text.className = answers.length ? 'auto-sequence-answer-text' : 'auto-sequence-no-answer';
    text.textContent = answers.length ? answers.join('；') : '未配置';
    cell.appendChild(text);
  }

  async function updatePackImages(table) {
    if (!isVoteConfigPage()) return;
    const imageIndex = ensureImageHeader(table);
    const answerIndex = ensureAnswerHeader(table);
    if (imageIndex == null || answerIndex == null) return;
    const rows = Array.from(table.querySelectorAll('tbody > tr')).filter(isDataRow);
    await Promise.all(rows.map(async row => {
      let cell = row.querySelector(`td[${IMAGE_CELL_ATTRIBUTE}]`);
      if (!cell) {
        cell = document.createElement('td');
        cell.setAttribute(IMAGE_CELL_ATTRIBUTE, 'true');
        row.insertBefore(cell, row.cells[imageIndex] || null);
      }
      const packId = getPackId(row);
      if (!packId) {
        renderImageCell(cell, []);
        let answerCell = row.querySelector(`td[${ANSWER_CELL_ATTRIBUTE}]`);
        if (!answerCell) {
          answerCell = document.createElement('td');
          answerCell.setAttribute(ANSWER_CELL_ATTRIBUTE, 'true');
          row.insertBefore(answerCell, row.cells[answerIndex] || null);
        }
        renderAnswerCell(answerCell, []);
        return;
      }
      cell.dataset.packId = packId;
      const result = await loadPackImages(packId);
      renderImageCell(cell, result.images);
      let answerCell = row.querySelector(`td[${ANSWER_CELL_ATTRIBUTE}]`);
      if (!answerCell) {
        answerCell = document.createElement('td');
        answerCell.setAttribute(ANSWER_CELL_ATTRIBUTE, 'true');
        row.insertBefore(answerCell, row.cells[answerIndex] || null);
      }
      renderAnswerCell(answerCell, result.answers);
    }));
  }

  function ensureSequenceHeaders(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return null;

    let leftHeader = headerRow.querySelector(`th[${LEFT_HEADER_ATTRIBUTE}]`);
    if (!leftHeader) {
      const insertionIndex = getInsertionIndex(headerRow);
      leftHeader = createSequenceHeader(LEFT_HEADER_ATTRIBUTE, '_autoSequenceLeft');
      headerRow.insertBefore(leftHeader, headerRow.cells[insertionIndex] || null);
    }

    let rightHeader = headerRow.querySelector(`th[${RIGHT_HEADER_ATTRIBUTE}]`);
    if (!rightHeader) {
      rightHeader = createSequenceHeader(RIGHT_HEADER_ATTRIBUTE, '_autoSequenceRight');
      headerRow.appendChild(rightHeader);
    }

    return {
      leftIndex: leftHeader.cellIndex,
      rightIndex: rightHeader.cellIndex
    };
  }

  function readPositiveInteger(text, fallback) {
    const match = String(text || '').match(/\d+/);
    const value = match ? Number(match[0]) : fallback;
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  function getPagination(table) {
    const container = table.closest('.bootstrap-table') || document;
    const activePage = container.querySelector(
      '.fixed-table-pagination .pagination li.active a, ' +
      '.fixed-table-pagination .pagination .page-item.active .page-link'
    );
    const pageSizeButton = container.querySelector(
      '.fixed-table-pagination .page-list button, ' +
      '.fixed-table-pagination .page-list .dropdown-toggle'
    );

    return {
      pageNumber: readPositiveInteger(activePage?.textContent, 1),
      pageSize: readPositiveInteger(pageSizeButton?.textContent, 10)
    };
  }

  function isDataRow(row) {
    return row.cells.length > 1 &&
      !row.classList.contains('detail-view') &&
      !row.querySelector('.no-records-found');
  }

  function updateSequenceNumbers() {
    addStyles();

    const table = getTargetTable();
    if (!table) return;

    const columnIndexes = ensureSequenceHeaders(table);
    if (!columnIndexes) return;
    hideDefaultConfigColumns();
    updateDeliverySceneCells(table);

    const { pageNumber, pageSize } = getPagination(table);
    const pageOffset = (pageNumber - 1) * pageSize;
    const rows = Array.from(table.querySelectorAll('tbody > tr')).filter(isDataRow);

    rows.forEach((row, rowIndex) => {
      let leftCell = row.querySelector(`td[${LEFT_CELL_ATTRIBUTE}]`);

      if (!leftCell) {
        leftCell = document.createElement('td');
        leftCell.setAttribute(LEFT_CELL_ATTRIBUTE, 'true');
        row.insertBefore(leftCell, row.cells[columnIndexes.leftIndex] || null);
      }

      let rightCell = row.querySelector(`td[${RIGHT_CELL_ATTRIBUTE}]`);
      if (!rightCell) {
        rightCell = document.createElement('td');
        rightCell.setAttribute(RIGHT_CELL_ATTRIBUTE, 'true');
        row.appendChild(rightCell);
      }

      const sequenceNumber = String(pageOffset + rowIndex + 1);
      if (leftCell.textContent !== sequenceNumber) {
        leftCell.textContent = sequenceNumber;
      }
      if (rightCell.textContent !== sequenceNumber) {
        rightCell.textContent = sequenceNumber;
      }
    });

    updatePackImages(table);
  }

  function scheduleUpdate() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateSequenceNumbers, 80);
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  if (isDramaShellPage()) {
    const shellObserver = new MutationObserver(() => {
      rememberActiveTab();
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => restoreActiveTab(), 180);
    });
    shellObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('beforeunload', rememberActiveTab);
    window.setTimeout(() => {
      rememberActiveTab();
      restoreActiveTab();
    }, 500);
  }

  updateSequenceNumbers();
  window.addEventListener('load', scheduleUpdate, { once: true });
})();

// 投票组列表：批量给每个投票组的第一个投票增加“投票动作”。
(() => {
  const BUTTON_ATTRIBUTE = 'data-codex-batch-next-stage';
  const MODAL_ID = 'codex-batch-next-stage-modal';

  const text = element => (element?.textContent || '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isVotePackPage() {
    if (/\/modules\/drama\/vote_pack(?:\/|$)/.test(location.pathname)) return true;
    const headings = [...document.querySelectorAll('th')].map(text);
    return headings.includes('下一阶段') && headings.includes('触发阶段') && headings.includes('投票配置');
  }

  function tableInfo() {
    const table = [...document.querySelectorAll('table')].find(item => {
      const headings = [...item.querySelectorAll('th')].map(text);
      return headings.includes('名称') && headings.includes('触发阶段') && headings.includes('下一阶段');
    });
    if (!table) return null;
    const headings = [...table.querySelectorAll('thead th')].map(text);
    return { table, headings, nameIndex: headings.indexOf('名称') };
  }

  function extractId(button) {
    const source = [button?.getAttribute('onclick'), button?.getAttribute('href'), button?.dataset?.id]
      .filter(Boolean).join(' ');
    const quoted = [...source.matchAll(/["'](\d+)["']/g)].map(match => match[1]);
    if (quoted.length) return quoted[quoted.length - 1];
    return source.match(/(?:id|votePackId|packId)[=:/'"\s]+(\d+)/i)?.[1] || null;
  }

  function getGroups() {
    const info = tableInfo();
    if (!info) return [];
    return [...info.table.querySelectorAll('tbody tr')].map((row, index) => {
      const cells = [...row.children];
      const configButton = [...row.querySelectorAll('a,button')].find(item => text(item).includes('投票配置'));
      return {
        name: text(cells[info.nameIndex]) || `第 ${index + 1} 个投票组`,
        id: extractId(configButton),
        configButton
      };
    }).filter(group => group.configButton);
  }

  function commonParams() {
    const result = new URLSearchParams(location.search);
    result.delete('offset');
    result.delete('limit');
    return result;
  }

  async function parseResponse(response) {
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (_) {}
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    if (data && data.code != null && ![0, 200].includes(Number(data.code))) {
      throw new Error(data.msg || data.message || `后台返回错误 ${data.code}`);
    }
    return { data, raw };
  }

  async function firstVote(group) {
    if (!group.id) throw new Error('无法识别投票组 ID');
    const params = commonParams();
    params.set('votePackId', group.id);
    params.set('packId', group.id);
    params.set('offset', '0');
    params.set('limit', '1');
    const url = new URL('/modules/drama/drama_vote/list', location.origin);
    url.search = commonParams().toString();
    const response = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: params.toString()
    });
    const { data } = await parseResponse(response);
    const rows = data?.rows || data?.data?.rows || (Array.isArray(data?.data) ? data.data : []);
    const matching = rows.filter(row => {
      const owner = row.votePackId ?? row.vote_pack_id ?? row.packId;
      return owner == null || String(owner) === String(group.id);
    });
    const vote = matching[0];
    if (!vote) throw new Error('该投票组没有找到投票');
    const id = vote.id ?? vote.voteId ?? vote.dramaVoteId;
    if (id == null) throw new Error('无法识别第一个投票的 ID');
    return { id: String(id), name: vote.name || vote.title || `投票 ${id}` };
  }

  function serializeForm(form) {
    const body = new URLSearchParams();
    for (const control of form.elements) {
      if (!control.name || control.disabled || ['button', 'submit', 'reset', 'file'].includes(control.type)) continue;
      if (['checkbox', 'radio'].includes(control.type) && !control.checked) continue;
      if (control.tagName === 'SELECT' && control.multiple) {
        [...control.selectedOptions].forEach(option => body.append(control.name, option.value));
      } else body.append(control.name, control.value);
    }
    return body;
  }

  function findActionControls(doc) {
    const candidates = [...doc.querySelectorAll('.form-group, .row, tr, fieldset')]
      .filter(element => /投票动作[：:]?/.test(text(element)))
      .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    const container = candidates.find(element => element.querySelector('input[type="checkbox"],input[type="radio"]'));
    return container ? [...container.querySelectorAll('input[type="checkbox"],input[type="radio"]')].filter(input => input.name && !input.disabled) : [];
  }

  async function enableVoteAction(vote) {
    const editUrl = new URL(`/modules/drama/drama_vote/edit/${encodeURIComponent(vote.id)}`, location.origin);
    editUrl.search = commonParams().toString();
    const editResponse = await fetch(editUrl, { credentials: 'include' });
    const html = await editResponse.text();
    if (!editResponse.ok) throw new Error(`打开投票编辑页失败（HTTP ${editResponse.status}）`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form');
    if (!form) throw new Error('未找到投票编辑表单');
    const controls = findActionControls(doc);
    if (!controls.length) throw new Error('未找到“投票动作”选项');
    const body = serializeForm(form);
    for (const control of controls) {
      body.delete(control.name);
      break;
    }
    controls.forEach(control => body.append(control.name, control.value || '1'));
    // 后台弹窗表单的 action 可能为空、# 或仍指向 /edit/{id} 展示页；
    // 原生“确定”按钮实际统一提交到无 ID 的编辑接口。
    const action = new URL('/modules/drama/drama_vote/edit', location.origin);
    action.search = commonParams().toString();
    const saveResponse = await fetch(action, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: body.toString()
    });
    const raw = await saveResponse.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch (_) {}
    if (!saveResponse.ok) throw new Error(`保存失败（HTTP ${saveResponse.status}）`);
    if (!payload || Number(payload.code) !== 0) {
      throw new Error(payload?.msg || payload?.message || '后台没有返回保存成功状态');
    }
  }

  function closeModal() { document.getElementById(MODAL_ID)?.remove(); }

  function addStyles() {
    if (document.getElementById(`${MODAL_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${MODAL_ID}-style`;
    style.textContent = `#${MODAL_ID}{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:2147483647;display:flex;align-items:center;justify-content:center}#${MODAL_ID} .bns-panel{background:#fff;width:min(760px,90vw);max-height:82vh;overflow:auto;border-radius:8px;padding:28px 34px;box-shadow:0 12px 40px rgba(0,0,0,.25)}#${MODAL_ID} h3{margin:0 0 12px}#${MODAL_ID} .bns-list,#${MODAL_ID} .bns-status{white-space:pre-wrap;line-height:1.75;margin:14px 0;padding:12px;background:#f6f8fa;border-radius:4px}#${MODAL_ID} .bns-status{color:#1677c8}#${MODAL_ID} .bns-actions{text-align:right;margin-top:20px}#${MODAL_ID} button{margin-left:10px}`;
    document.head.appendChild(style);
  }

  function openModal() {
    closeModal(); addStyles();
    const groups = getGroups();
    const modal = document.createElement('div'); modal.id = MODAL_ID;
    const panel = document.createElement('div'); panel.className = 'bns-panel';
    const heading = document.createElement('h3'); heading.textContent = '批量增加下一阶段';
    const note = document.createElement('p'); note.textContent = '将逐个打开以下投票组的第一个投票，勾选其全部“投票动作”并保存。其他投票不会修改。';
    const list = document.createElement('div'); list.className = 'bns-list'; list.textContent = groups.length ? groups.map((group, i) => `${i + 1}. ${group.name}`).join('\n') : '当前列表没有可处理的投票组。';
    const status = document.createElement('div'); status.className = 'bns-status'; status.textContent = `等待确认，共 ${groups.length} 个投票组。`;
    const actions = document.createElement('div'); actions.className = 'bns-actions';
    const cancel = document.createElement('button'); cancel.className = 'btn btn-default'; cancel.textContent = '取消'; cancel.onclick = closeModal;
    const confirm = document.createElement('button'); confirm.className = 'btn btn-danger'; confirm.textContent = `确认处理 ${groups.length} 个投票组`; confirm.disabled = !groups.length;
    confirm.onclick = async () => {
      confirm.disabled = true; cancel.disabled = true;
      let completed = 0; const failures = [];
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i]; status.textContent = `正在处理 ${i + 1}/${groups.length}：${group.name}`;
        try { const vote = await firstVote(group); await enableVoteAction(vote); completed++; }
        catch (error) { failures.push(`${group.name}：${error.message || '处理失败'}`); }
        await sleep(180);
      }
      status.textContent = `已完成 ${completed}/${groups.length} 个投票组。${failures.length ? `\n失败：\n${failures.join('\n')}` : ''}`;
      confirm.textContent = '关闭并刷新'; confirm.disabled = false; cancel.style.display = 'none';
      confirm.onclick = () => location.reload();
    };
    actions.append(cancel, confirm); panel.append(heading, note, list, status, actions); modal.appendChild(panel); document.body.appendChild(modal);
  }

  function addButton() {
    if (!isVotePackPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const anchor = document.querySelector('[data-codex-batch-vote-pack]') || [...document.querySelectorAll('button,a')].find(item => text(item) === '批量添加投票组') || [...document.querySelectorAll('button,a')].find(item => /^\+?\s*添加$/.test(text(item)));
    if (!anchor) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-warning'; button.style.marginLeft = '8px'; button.textContent = '批量增加下一阶段'; button.setAttribute(BUTTON_ATTRIBUTE, 'true'); button.onclick = openModal;
    anchor.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();

// 投票组批量添加：每行一个名称，默认限制时间 600 秒并开启复盘阶段显示结果。
(() => {
  'use strict';
  const BUTTON_ATTRIBUTE = 'data-batch-vote-pack-button';
  const MODAL_ID = 'batch-vote-pack-modal';
  const isPage = () => {
    if (/\/modules\/drama\/vote_pack(?:\/|$)/.test(window.location.pathname) && !/\/vote_pack\/(?:add|edit)(?:\/|$)/.test(window.location.pathname)) return true;
    return Array.from(document.querySelectorAll('table')).some(table => {
      const text = table.querySelector('thead')?.textContent.replace(/\s+/g, '') || '';
      return text.includes('触发阶段') && text.includes('限制时间') && text.includes('复盘阶段显示结果');
    });
  };
  const getAddButton = () => Array.from(document.querySelectorAll('#toolbar a.btn,#toolbar button.btn,a.btn,button.btn')).find(e => e.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  const names = text => Array.from(new Set(String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)));
  const close = () => document.getElementById(MODAL_ID)?.remove();
  const refresh = () => window.location.reload();
  const formUrl = () => { const q = new URLSearchParams(window.location.search); return `/modules/drama/vote_pack/add?${q}`; };
  function setNamed(body, form, candidates, value) { const el = candidates.map(n => form.querySelector(`[name="${n}"]`)).find(Boolean); if (el) body.set(el.name, value); }
  async function createPack(name) {
    const response = await fetch(formUrl(), { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`读取投票组表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.querySelectorAll('form')).find(f => f.querySelector('input[name="name"],input[name="title"]'));
    if (!form) throw new Error('未找到投票组添加表单');
    const body = new URLSearchParams();
    form.querySelectorAll('input[name],textarea[name],select[name]').forEach(control => {
      if (control.type === 'file' || control.type === 'submit' || control.type === 'button') return;
      if ((control.type === 'checkbox' || control.type === 'radio') && !control.checked) return;
      body.append(control.name, control.value || '');
    });
    setNamed(body, form, ['name', 'title'], name);
    setNamed(body, form, ['limitTime', 'limitSecond', 'limitSeconds', 'time'], '600');
    const timeGroup = Array.from(form.querySelectorAll('.form-group,.row,tr,fieldset'))
      .filter(el => /限制时间/.test(el.textContent || '') && el.querySelector('input[name],select[name]'))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
    const timeControl = timeGroup?.querySelector('input[name],select[name]');
    if (timeControl?.name) body.set(timeControl.name, '600');
    const reviewGroup = Array.from(form.querySelectorAll('.form-group,.row,tr,fieldset')).find(el => /复盘阶段显示结果/.test(el.textContent || ''));
    const reviewControls = Array.from(reviewGroup?.querySelectorAll('input[type="radio"],input[type="checkbox"]') || []);
    const review = reviewControls.find(el => {
      const label = el.closest('label')?.textContent || el.nextElementSibling?.textContent || '';
      return label.replace(/\s+/g, '') === '是';
    }) || reviewControls.find(el => el.value === '1') || reviewControls[reviewControls.length - 1];
    if (review?.name) { body.delete(review.name); body.set(review.name, review.value || '1'); }
    const action = form.getAttribute('action') || formUrl();
    const url = new URL(action, window.location.origin); const source = new URL(formUrl(), window.location.origin); source.searchParams.forEach((v, k) => url.searchParams.set(k, v));
    const saved = await fetch(`${url.pathname}${url.search}`, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'}, body: body.toString(), credentials:'same-origin' });
    const payload = await saved.json().catch(() => ({}));
    if (!saved.ok || (payload.code !== undefined && Number(payload.code) !== 0 && Number(payload.code) !== 200)) throw new Error(payload.msg || `保存失败：HTTP ${saved.status}`);
  }
  function addStyles() {
    if (document.getElementById('batch-vote-pack-style')) return;
    const style = document.createElement('style'); style.id = 'batch-vote-pack-style'; style.textContent = `#${MODAL_ID}{position:fixed;z-index:2147483647;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)}#${MODAL_ID} .bvp-panel{width:min(650px,calc(100vw - 36px));padding:20px;border-radius:5px;background:#fff;box-shadow:0 12px 32px rgba(0,0,0,.3)}#${MODAL_ID} textarea{width:100%;min-height:220px;box-sizing:border-box;padding:10px;line-height:1.6}#${MODAL_ID} .bvp-status{margin-top:10px;color:#337ab7;white-space:pre-line}#${MODAL_ID} .bvp-actions{text-align:right;margin-top:16px}#${MODAL_ID} button{margin-left:8px}`; document.head.appendChild(style);
  }
  function open() {
    close(); addStyles(); const m=document.createElement('div'); m.id=MODAL_ID; m.innerHTML='<div class="bvp-panel"><h3>批量添加投票组</h3><p>每行一个投票组名称。默认限制时间 600 秒，默认开启复盘阶段显示结果。</p><textarea placeholder="例如：\n第一幕投票\n第二幕投票\n最终投票"></textarea><div class="bvp-preview"></div><div class="bvp-status"></div><div class="bvp-actions"><button class="btn btn-default bvp-cancel">取消</button><button class="btn btn-danger bvp-confirm">确认创建 0 个投票组</button></div></div>'; document.body.appendChild(m);
    const ta=m.querySelector('textarea'), preview=m.querySelector('.bvp-preview'), status=m.querySelector('.bvp-status'), btn=m.querySelector('.bvp-confirm'); const update=()=>{const ns=names(ta.value);preview.textContent=ns.length?`将创建 ${ns.length} 个投票组：${ns.join('、')}`:'请输入至少一个名称。';btn.textContent=`确认创建 ${ns.length} 个投票组`;return ns;}; ta.oninput=update; m.querySelector('.bvp-cancel').onclick=close; btn.onclick=async()=>{if(btn.dataset.finished==='true'){if(btn.dataset.completed!=='0')refresh();else close();return;}const ns=update();if(!ns.length)return;btn.disabled=true;ta.disabled=true;m.querySelector('.bvp-cancel').disabled=true;let done=0,fail=[];for(const name of ns){status.textContent=`正在创建 ${done+fail.length+1}/${ns.length}：${name}`;try{await createPack(name);done++;}catch(e){fail.push(`${name}：${e.message||'创建失败'}`);}}status.textContent=`已创建 ${done}/${ns.length} 个投票组。${fail.length?'\n失败：'+fail.join('\n'):''}`;btn.disabled=false;btn.dataset.finished='true';btn.dataset.completed=String(done);btn.textContent=fail.length?'关闭':'完成并刷新列表';};
  }
  function add(){if(!isPage()||document.querySelector(`[${BUTTON_ATTRIBUTE}]`))return;const anchor=getAddButton();if(!anchor)return;const b=document.createElement('button');b.type='button';b.className='btn btn-warning';b.textContent='批量添加投票组';b.style.marginLeft='8px';b.setAttribute(BUTTON_ATTRIBUTE,'');b.onclick=open;anchor.insertAdjacentElement('afterend',b);}
  new MutationObserver(add).observe(document.documentElement,{childList:true,subtree:true}); add();
})();

// 投票正确答案批量设置：在投票配置列表中按投票逐项选择正确选项并一次性保存。
(() => {
  'use strict';
  const BUTTON = 'data-batch-vote-answer-button';
  const MODAL = 'batch-vote-answer-modal';
  const isPage = () => /\/modules\/drama\/drama_vote(?:\/|$)/.test(window.location.pathname);
  const rows = () => {
    const tables = Array.from(document.querySelectorAll('table')).map(table => ({ table, score: Array.from(table.querySelectorAll('tbody > tr')).filter(r => Array.from(r.querySelectorAll('a,button')).some(el => /选项配置/.test(el.textContent || ''))).length })).filter(x => x.score).sort((a,b) => b.score-a.score);
    const table = tables[0]?.table; if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr:last-child th'));
    const titleIndex = headers.findIndex(h => h.textContent.replace(/\s+/g, '').trim() === '名称');
    return Array.from(table.querySelectorAll('tbody > tr')).filter(r => !r.classList.contains('no-records-found')).map(row => {
      const button = Array.from(row.querySelectorAll('a,button')).find(el => /选项配置/.test(el.textContent || ''));
      const id = button?.getAttribute('onclick')?.match(/editExt1Tab\s*\(\s*['"](\d+)['"]/)?.[1];
      return id ? { id, title: row.cells[titleIndex]?.textContent.trim() || `投票 ${id}` } : null;
    }).filter(Boolean);
  };
  async function loadOptions(voteId) {
    const q = new URLSearchParams(window.location.search); q.set('voteId', voteId); q.set('limit', '100'); q.set('offset', '0');
    const r = await fetch(`/modules/drama/vote_option/list?${q}`, { method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}, credentials:'same-origin' });
    const p = await r.json(); if (!r.ok) throw new Error(`读取选项失败：HTTP ${r.status}`);
    const list = Array.isArray(p) ? p : (p.rows || p.data || []);
    return list.map((x, i) => ({ id: String(x.id || x.optionId || ''), title: String(x.title || x.name || `选项 ${i + 1}`), answer: x.isAnswer === 1 || x.isAnswer === '1' || x.isAnswer === true || x.isAnswer === '是' })).filter(x => x.id);
  }
  async function loadFields(id) {
    const q = new URLSearchParams(window.location.search);
    const r = await fetch(`/modules/drama/vote_option/edit/${id}?${q}`, {credentials:'same-origin'});
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html'); const form = doc.querySelector('form');
    if (!r.ok || !form) throw new Error('未找到选项编辑表单');
    const f = new URLSearchParams(); Array.from(form.elements).forEach(e => { if (!e.name || e.type === 'file') return; if ((e.type === 'checkbox' || e.type === 'radio') && !e.checked) return; f.append(e.name, e.value); }); return f;
  }
  async function saveOption(id, answer) { const f = await loadFields(id); f.set('isAnswer', answer ? '1' : '0'); const r = await fetch('/modules/drama/vote_option/edit', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'}, body:f.toString(), credentials:'same-origin'}); const p = await r.json().catch(() => ({})); if (!r.ok || Number(p.code) !== 0) throw new Error(p.msg || `保存失败：HTTP ${r.status}`); }
  function close() { document.getElementById(MODAL)?.remove(); }
  function open() {
    const targets = rows(); if (!targets.length) return alert('当前页没有投票配置。'); close();
    const m = document.createElement('div'); m.id = MODAL; m.innerHTML = '<div class="bva-panel"><h3>批量设置投票正确答案</h3><p>每个投票勾选一个或多个正确选项；未勾选表示清除该投票全部正确答案。</p><div class="bva-list"></div><div class="bva-status"></div><div class="bva-actions"><button class="btn btn-default bva-cancel">取消</button><button class="btn btn-danger bva-save">确认保存</button></div></div>';
    document.body.appendChild(m); const list = m.querySelector('.bva-list'); const status = m.querySelector('.bva-status'); const state = new Map();
    Promise.all(targets.map(async t => { const box = document.createElement('div'); box.className='bva-vote'; box.textContent=`${t.title}：加载中`; list.append(box); try { const opts=await loadOptions(t.id); state.set(t.id, opts); box.textContent=''; const label=document.createElement('strong'); label.textContent=t.title; box.append(label); opts.forEach(o=>{ const l=document.createElement('label'); l.innerHTML=`<input type="checkbox" data-vote="${t.id}" data-option="${o.id}" ${o.answer?'checked':''}> ${o.title}`; box.append(l); }); } catch(e) { box.textContent=`${t.title}：${e.message}`; } })).then(()=>{ m.querySelector('.bva-save').disabled=false; });
    m.querySelector('.bva-save').disabled=true; m.querySelector('.bva-cancel').onclick=close;
    m.querySelector('.bva-save').onclick=async()=>{ const btn=m.querySelector('.bva-save'); btn.disabled=true; let done=0, fail=[]; for(const t of targets){ const opts=state.get(t.id)||[]; const chosen=new Set(Array.from(m.querySelectorAll(`input[data-vote="${t.id}"]:checked`)).map(x=>x.dataset.option)); for(const o of opts){ try{ await saveOption(o.id, chosen.has(o.id)); }catch(e){ fail.push(`${t.title}/${o.title}：${e.message}`); } } done++; status.textContent=`已处理 ${done}/${targets.length} 个投票${fail.length?'\n失败：'+fail.join('\n'):''}`; } btn.textContent=fail.length?'关闭':'完成并刷新'; btn.disabled=false; btn.onclick=fail.length?close:()=>window.location.reload(); };
  }
  const style = document.createElement('style'); style.textContent=`#${MODAL}{position:fixed;z-index:2147483647;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}.bva-panel{background:#fff;width:min(760px,calc(100vw - 36px));max-height:calc(100vh - 48px);overflow:auto;padding:20px;border-radius:5px}.bva-list{border:1px solid #ddd}.bva-vote{padding:10px;border-bottom:1px solid #eee}.bva-vote label{display:inline-block;margin:6px 12px 0 0}.bva-status{white-space:pre-line;color:#337ab7;margin-top:10px}.bva-actions{text-align:right;margin-top:16px}.bva-actions button{margin-left:8px}`; document.head.append(style);
  function add(){ if(!isPage()||document.querySelector(`[${BUTTON}]`))return; const anchor=Array.from(document.querySelectorAll('#toolbar a.btn,#toolbar button.btn')).find(e=>e.textContent.trim()==='添加'); if(!anchor)return; const b=document.createElement('button'); b.className='btn btn-warning'; b.textContent='批量设置正确答案'; b.setAttribute(BUTTON,''); b.style.marginLeft='8px'; b.onclick=open; anchor.insertAdjacentElement('afterend',b); }
  new MutationObserver(add).observe(document.documentElement,{childList:true,subtree:true}); add();
})();

// 打包版本列表：用打包详情中的时间戳补全上传/更新时间到秒。
(() => {
  const ROW_STATE_ATTRIBUTE = 'data-womizhi-build-time-state';
  const timestampCache = new Map();
  let enhanceTimer = 0;

  function isBuildListPage() {
    return /^\/modules\/drama\/build\/?$/.test(window.location.pathname);
  }

  function padTimePart(value) {
    return String(value).padStart(2, '0');
  }

  function formatTimestamp(value) {
    let timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    if (timestamp < 1e12) timestamp *= 1000;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return [
      date.getFullYear(),
      padTimePart(date.getMonth() + 1),
      padTimePart(date.getDate()),
    ].join('-') + ' ' + [
      padTimePart(date.getHours()),
      padTimePart(date.getMinutes()),
      padTimePart(date.getSeconds()),
    ].join(':');
  }

  function getBuildId(row) {
    const directId = row.dataset.uniqueid || row.dataset.uniqueId || row.getAttribute('data-id');
    if (/^\d+$/.test(directId || '')) return directId;

    const link = row.querySelector('a[href*="/modules/drama/build/view/"], [onclick*="editExt1Tab"], [onclick*="/build/view/"]');
    if (!link) return '';
    const source = `${link.getAttribute('href') || ''} ${link.getAttribute('onclick') || ''}`;
    const viewMatch = source.match(/\/build\/view\/(\d+)/);
    if (viewMatch) return viewMatch[1];
    const idMatch = source.match(/editExt1Tab\s*\(\s*['"]?(\d+)/);
    return idMatch ? idMatch[1] : '';
  }

  function parseBuildTimestamp(html) {
    const assignment = html.match(/\bvar\s+obj\s*=\s*("(?:\\.|[^"\\])*")\s*;/s);
    if (!assignment) return 0;
    try {
      const serialized = JSON.parse(assignment[1]);
      const detail = JSON.parse(serialized);
      return Number(detail && detail.build && detail.build.timestamp) || 0;
    } catch (error) {
      return 0;
    }
  }

  async function getBuildTimestamp(buildId) {
    if (!timestampCache.has(buildId)) {
      timestampCache.set(buildId, fetch(`/modules/drama/build/view/${encodeURIComponent(buildId)}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      }).then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }).then(parseBuildTimestamp).catch(() => 0));
    }
    return timestampCache.get(buildId);
  }

  function getColumnIndex(table, field) {
    const headers = Array.from(table.querySelectorAll('thead tr:last-child th'));
    return headers.findIndex(header => header.dataset.field === field);
  }

  function applyPreciseTime(cell, preciseTime) {
    if (!cell || !preciseTime) return;
    const originalDate = (cell.textContent || '').trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (originalDate && originalDate !== preciseTime.slice(0, 10)) return;
    cell.textContent = preciseTime;
    cell.title = '精确时间取自该记录的后台打包时间戳';
  }

  async function enhanceRow(row, createdAtIndex, updatedAtIndex) {
    if (row.getAttribute(ROW_STATE_ATTRIBUTE)) return;
    const buildId = getBuildId(row);
    if (!buildId) return;
    row.setAttribute(ROW_STATE_ATTRIBUTE, 'loading');
    const timestamp = await getBuildTimestamp(buildId);
    const preciseTime = formatTimestamp(timestamp);
    if (!preciseTime || !row.isConnected) {
      row.setAttribute(ROW_STATE_ATTRIBUTE, 'failed');
      return;
    }
    applyPreciseTime(row.cells[createdAtIndex], preciseTime);
    applyPreciseTime(row.cells[updatedAtIndex], preciseTime);
    row.setAttribute(ROW_STATE_ATTRIBUTE, 'done');
  }

  function enhanceBuildTimes() {
    if (!isBuildListPage()) return;
    const table = document.querySelector('#bootstrap-table');
    if (!table) return;
    const createdAtIndex = getColumnIndex(table, 'createdAt');
    const updatedAtIndex = getColumnIndex(table, 'updatedAt');
    if (createdAtIndex < 0 && updatedAtIndex < 0) return;
    table.querySelectorAll('tbody tr').forEach(row => {
      if (row.classList.contains('no-records-found')) return;
      enhanceRow(row, createdAtIndex, updatedAtIndex);
    });
  }

  function scheduleEnhance() {
    window.clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(enhanceBuildTimes, 80);
  }

  if (!isBuildListPage()) return;
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnhance();
})();

// 投票组列表：按投票组分别批量添加投票选项。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-vote-options-by-pack-button';
  const MODAL_ID = 'batch-vote-options-by-pack-modal';

  function isVotePackPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/drama_vote(?:\/|$)/.test(path)
      && !/\/modules\/drama\/drama_vote\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn'))
      .find(element => element.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  }

  function getTable() {
    const tables = Array.from(document.querySelectorAll('.bootstrap-table table, table'));
    const candidates = tables.map(table => {
      const rows = Array.from(table.querySelectorAll('tbody > tr')).filter(row =>
        !row.classList.contains('no-records-found') &&
        !/没有找到匹配的记录/.test(row.textContent || '')
      );
      const optionRows = rows.filter(row => Array.from(row.querySelectorAll('a, button')).some(element =>
        /选项配置/.test(element.textContent || '')
      ));
      return { table, rows, optionRows };
    }).filter(item => item.rows.length);

    return candidates.sort((left, right) => {
      const leftScore = left.optionRows.length ? left.optionRows.length * 1000 + left.rows.length : left.rows.length;
      const rightScore = right.optionRows.length ? right.optionRows.length * 1000 + right.rows.length : right.rows.length;
      return rightScore - leftScore;
    })[0]?.table || document.querySelector('#bootstrap-table') || null;
  }

  function getVoteConfig(row) {
    const target = Array.from(row.querySelectorAll('a, button')).find(element =>
      /选项配置/.test(element.textContent || '')
    );
    const onclick = target?.getAttribute('onclick') || '';

    // 后台“选项配置”按钮的真实调用格式为 $.operate.editExt1Tab('3841')。
    // 只接受这里的参数作为投票 ID，避免从序号、行 ID 或其他属性中误取数字。
    const idMatch = onclick.match(/(?:\$\.)?operate\.editExt1Tab\s*\(\s*['"](\d+)['"]/i);
    if (!idMatch) return null;

    const id = idMatch[1];
    const query = new URLSearchParams(window.location.search);
    query.delete('_batchRefresh');
    query.set('voteId', id);
    return {
      id,
      addUrl: `/modules/drama/vote_option/add?${query.toString()}`,
      listUrl: `/modules/drama/vote_option/list?${query.toString()}`,
    };
  }

  function getDataRows(table) {
    return Array.from(table.querySelectorAll('tbody > tr')).filter(row =>
      !row.classList.contains('no-records-found') &&
      !/没有找到匹配的记录/.test(row.textContent || '')
    );
  }

  function getSelectedVotes() {
    const table = getTable();
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr:last-child th'));
    const titleIndex = headers.findIndex(header => header.textContent.replace(/\s+/g, '').trim() === '名称');
    if (titleIndex < 0) return [];
    return getDataRows(table).map(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      const voteConfig = getVoteConfig(row);
      const title = row.cells[titleIndex]?.textContent.replace(/\s+/g, ' ').trim();
      const selected = checkbox?.checked || row.classList.contains('selected');
      return selected && voteConfig && title ? { ...voteConfig, title, row } : null;
    }).filter(Boolean);
  }

  function splitOptions(text) {
    const seen = new Set();
    const result = [];
    const add = value => {
      const item = String(value || '').trim()
        .replace(/^(?:\d{1,3}|[A-Za-z])(?:[.。、,，:：;；)）\]】>\-_]\s*|\s+)/, '')
        .trim();
      if (item && !seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    };
    const lines = String(text || '').split(/\r?\n/)
      .map(line => line.replace(/^\uFEFF/, '').trim())
      .filter(Boolean);

    // 兼容每行直接以连续字母开头、但没有空格或标点的格式：
    // A选项正文
    // B选项正文
    // C选项正文
    // 只有整组前缀连续且正文均含中文时才剥离字母，避免误伤普通英文单词。
    const bareLetterMatches = lines.map(line => line.match(/^([A-Za-z])(.+)$/));
    const isBareLetterSequence = lines.length > 1
      && bareLetterMatches.every(match => match && /[\u3400-\u9fff]/.test(match[2]))
      && bareLetterMatches.every((match, index) => index === 0
        || match[1].toLowerCase().charCodeAt(0) === bareLetterMatches[index - 1][1].toLowerCase().charCodeAt(0) + 1);
    if (isBareLetterSequence) {
      bareLetterMatches.forEach(match => add(match[2]));
      return result;
    }

    lines.forEach(normalized => {
      if (!normalized) return;
      const sequenceParts = normalized
        .replace(/((?:\d{1,3}|[A-Za-z])[.。、,，:：;；)）\]】>\-_]\s*)/g, '\n$1')
        .split(/\r?\n/).map(item => item.trim()).filter(Boolean);
      sequenceParts.forEach(part => {
        if (/^(?:\d{1,3}|[A-Za-z])[.。、,，:：;；)）\]】>\-_]\s*/.test(part)) add(part);
        else part.split(/[，,、；;]/).forEach(add);
      });
    });
    return result;
  }

  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function appendFormControl(body, control) {
    if (!control.name || control.disabled) return;
    if ((control.type === 'checkbox' || control.type === 'radio') && !control.checked) return;
    if (control.type === 'file' || control.type === 'submit' || control.type === 'button') return;
    if (control.tagName === 'SELECT' && control.multiple) {
      Array.from(control.selectedOptions).forEach(option => body.append(control.name, option.value));
      return;
    }
    body.append(control.name, control.value || '');
  }

  async function loadCreateForm(vote) {
    const response = await fetch(vote.addUrl, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取投票 ID ${vote.id} 的添加表单失败：HTTP ${response.status}`);

    const formDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(formDoc.querySelectorAll('form')).find(element =>
      element.querySelector('[name="title"]')
    );
    if (!form) throw new Error(`投票 ID ${vote.id} 的添加表单中没有找到选项字段`);

    const body = new URLSearchParams();
    form.querySelectorAll('input[name], textarea[name], select[name]').forEach(control => {
      appendFormControl(body, control);
    });
    body.set('title', '');
    body.set('isAnswer', '0');
    body.set('image', '');
    body.set('targetType', form.querySelector('select[name="targetType"]')?.value || '0');
    body.set('targetIdTemp', '');

    const expectedUrl = new URL(vote.addUrl, window.location.origin);
    const formUrl = new URL(form.getAttribute('action') || vote.addUrl, window.location.origin);
    expectedUrl.searchParams.forEach((value, key) => formUrl.searchParams.set(key, value));
    return {
      actionUrl: `${formUrl.pathname}${formUrl.search}`,
      body,
    };
  }

  async function loadOptionTitles(vote) {
    const query = new URLSearchParams(new URL(vote.listUrl, window.location.origin).search);
    query.set('limit', '1000');
    query.set('offset', '0');
    const response = await fetch(`/modules/drama/vote_option/list?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`校验投票 ID ${vote.id} 失败：HTTP ${response.status}`);
    const payload = await response.json().catch(() => null);
    if (!payload) throw new Error(`校验投票 ID ${vote.id} 失败：返回内容不是 JSON`);
    const rows = Array.isArray(payload) ? payload : (payload.rows || payload.data || []);
    return rows.map(row => String(
      row?.title ?? row?.name ?? row?.voteOption ?? row?.optionName ?? ''
    ).trim()).filter(Boolean);
  }

  async function verifyOptionCreated(vote, title) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) await delay(250);
      const titles = await loadOptionTitles(vote);
      if (titles.includes(title)) return;
    }
    throw new Error(`后台未在投票 ID ${vote.id} 下找到新选项`);
  }

  async function createOption(vote, title) {
    const formConfig = await loadCreateForm(vote);
    const body = new URLSearchParams(formConfig.body);
    body.set('title', title);
    const response = await fetch(formConfig.actionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch (_) {
      // 某些后台版本保存成功时返回空内容或 HTML，而不是 JSON。
    }
    const code = payload?.code === undefined || payload?.code === null || payload?.code === ''
      ? null
      : Number(payload.code);
    const success = response.ok && (code === null || code === 0 || code === 200);
    if (!success) {
      throw new Error(payload?.msg || `HTTP ${response.status}`);
    }
    await verifyOptionCreated(vote, title);
  }

  function addStyles() {
    if (document.getElementById('batch-vote-options-by-pack-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-vote-options-by-pack-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-vote-options-by-pack-panel { width: min(820px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} .batch-vote-options-by-pack-item { margin-top: 12px; padding: 12px; border: 1px solid #dfe6ee; border-radius: 5px; }
      #${MODAL_ID} .batch-vote-options-by-pack-title { display: block; margin-bottom: 7px; color: #333; font-weight: 600; }
      #${MODAL_ID} textarea { box-sizing: border-box; width: 100%; min-height: 86px; resize: vertical; padding: 8px 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL_ID} .batch-vote-options-by-pack-preview, #${MODAL_ID} .batch-vote-options-by-pack-status { margin-top: 12px; color: #337ab7; white-space: pre-line; line-height: 1.6; }
      #${MODAL_ID} .batch-vote-options-by-pack-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function refreshList() {
    window.location.reload();
  }

  function refreshOptionFrames(voteIds) {
    const ids = new Set(voteIds.map(String));
    try {
      Array.from(window.top.document.querySelectorAll('iframe[src*="/modules/drama/vote_option"]')).forEach(frame => {
        const url = new URL(frame.src, window.location.origin);
        if (!ids.has(url.searchParams.get('voteId'))) return;
        url.searchParams.set('_batchRefresh', String(Date.now()));
        frame.src = url.toString();
      });
    } catch (_) {
      // 无法访问顶层页面时，当前投票列表仍会正常刷新。
    }
  }

  function openModal() {
    const votes = getSelectedVotes();
    if (!votes.length) {
      window.alert('请先勾选需要添加选项的投票组。');
      return;
    }
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-vote-options-by-pack-panel';
    const heading = document.createElement('h3');
    heading.textContent = '按投票组批量添加选项';
    const note = document.createElement('p');
    note.textContent = '每个投票组单独填写选项，支持一行一个，也支持空格、逗号、顿号、中文或英文分号横排输入；支持 A选项、B选项、C选项 这种无空格格式，会自动去除序号、忽略空行并合并重复项。';
    const list = document.createElement('div');
    const textareas = new Map();
    votes.forEach(vote => {
      const item = document.createElement('div');
      item.className = 'batch-vote-options-by-pack-item';
      const label = document.createElement('label');
      label.className = 'batch-vote-options-by-pack-title';
      label.textContent = `${vote.title}（投票 ID：${vote.id}）`;
      const textarea = document.createElement('textarea');
      textarea.placeholder = '例如：\n选项 A\n选项 B\n选项 C';
      textareas.set(vote.id, textarea);
      item.append(label, textarea);
      list.appendChild(item);
    });
    const preview = document.createElement('div');
    preview.className = 'batch-vote-options-by-pack-preview';
    const status = document.createElement('div');
    status.className = 'batch-vote-options-by-pack-status';
    const actions = document.createElement('div');
    actions.className = 'batch-vote-options-by-pack-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 个选项';

    const getPlan = () => votes.map(vote => ({
      ...vote,
      options: splitOptions(textareas.get(vote.id)?.value || ''),
    }));
    const updatePreview = () => {
      const plan = getPlan();
      const total = plan.reduce((sum, item) => sum + item.options.length, 0);
      preview.textContent = total
        ? `将创建 ${total} 个选项：\n${plan.filter(item => item.options.length).map(item => `${item.title}：${item.options.join('、')}`).join('\n')}`
        : '请至少为一个投票组输入选项。';
      confirm.textContent = `确认创建 ${total} 个选项`;
      return plan;
    };
    textareas.forEach(textarea => textarea.addEventListener('input', updatePreview));
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') refreshList();
        else closeModal();
        return;
      }
      const plan = updatePreview();
      const total = plan.reduce((sum, item) => sum + item.options.length, 0);
      if (!total) return;
      confirm.disabled = true;
      cancel.disabled = true;
      textareas.forEach(textarea => { textarea.disabled = true; });
      let completed = 0;
      const failures = [];
      for (const item of plan) {
        for (const option of item.options) {
          status.textContent = `正在创建 ${completed + failures.length + 1}/${total}：${item.title}（ID：${item.id}）→ ${option}`;
          try {
            await createOption(item, option);
            completed += 1;
          } catch (error) {
            failures.push(`${item.title}（ID：${item.id}）/ ${option}：${error.message || '创建失败'}`);
          }
        }
      }
      status.textContent = `已创建 ${completed}/${total} 个选项。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      if (!failures.length && completed > 0) {
        refreshOptionFrames(plan.filter(item => item.options.length).map(item => item.id));
        status.textContent += '\n正在刷新列表……';
        window.setTimeout(refreshList, 350);
        return;
      }
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, list, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    updatePreview();
  }

  function addBatchButton() {
    if (!isVotePackPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '按投票批量添加选项';
    button.title = '勾选投票组后分别填写并批量添加选项';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();

// 投票配置列表：勾选投票后，在一个大预览窗口中为其全部选项逐项配置图片。
(() => {
  'use strict';
  const BUTTON = 'data-vote-list-option-images';
  const MODAL = 'vote-list-option-images-modal';
  const clean = value => String(value?.textContent ?? value ?? '').replace(/\s+/g, ' ').trim();

  function isPage() {
    return /\/modules\/drama\/drama_vote(?:\/|$)/.test(location.pathname)
      && !/\/drama_vote\/(?:add|edit)(?:\/|$)/.test(location.pathname);
  }

  function votes() {
    const tables = [...document.querySelectorAll('table')].filter(item => {
      const headers = [...item.querySelectorAll('thead th')].map(clean);
      return headers.includes('名称') && item.querySelectorAll('tbody tr').length;
    });
    const table = tables.find(item => item.querySelector('tbody input[type="checkbox"]:checked, tbody tr.selected'))
      || tables.find(item => [...item.querySelectorAll('tbody a,tbody button')].some(button => clean(button).includes('选项配置')));
    if (!table) return [];
    const headers = [...table.querySelectorAll('thead tr:last-child th')].map(clean);
    const titleIndex = headers.indexOf('名称');
    return [...table.querySelectorAll('tbody tr')].map(row => {
      const button = [...row.querySelectorAll('a,button')].find(item => clean(item).includes('选项配置'));
      const editButton = [...row.querySelectorAll('a,button')].find(item => clean(item) === '编辑');
      const sources = [
        button?.getAttribute('onclick'), button?.getAttribute('href'), button?.dataset?.id,
        editButton?.getAttribute('onclick'), editButton?.getAttribute('href'), editButton?.dataset?.id,
        row.getAttribute('data-uniqueid'), row.getAttribute('data-id'), row.getAttribute('data-pk')
      ].filter(Boolean).map(String);
      const id = sources.map(source =>
        source.match(/(?:\$\.)?operate\.(?:editExt1Tab|editExt3Tab|editTab|edit)\s*\(\s*['"]?(\d+)/i)?.[1]
        || source.match(/(?:voteId|id)[=/:'"\s]+(\d+)/i)?.[1]
        || (/^\d+$/.test(source) ? source : '')
      ).find(Boolean);
      const checkbox = row.querySelector('input[type="checkbox"]');
      const checked = Boolean(
        checkbox?.checked
        || checkbox?.matches(':checked')
        || checkbox?.getAttribute('aria-checked') === 'true'
        || row.classList.contains('selected')
      );
      return {
        id,
        title: clean(row.cells[titleIndex]) || `投票 ${id}`,
        checked
      };
    }).filter(vote => vote.title && !/没有找到匹配的记录/.test(vote.title));
  }

  async function resolveVoteIds(selectedRows) {
    if (selectedRows.every(vote => vote.id)) return selectedRows;
    const query = new URLSearchParams(location.search);
    query.set('offset', '0'); query.set('limit', '100'); query.set('pageNum', '1'); query.set('pageSize', '100');
    const response = await fetch(`/modules/drama/drama_vote/list?${new URLSearchParams(location.search)}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: query.toString()
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`读取投票列表失败：HTTP ${response.status}`);
    const catalog = (Array.isArray(payload) ? payload : (payload.rows || payload.data?.rows || payload.data || [])).map((row, index) => ({
      id: String(row.id || row.voteId || row.dramaVoteId || ''),
      title: clean(row.title || row.name),
      index,
      used: false
    })).filter(vote => vote.id);
    return selectedRows.map((row, rowIndex) => {
      if (row.id) return row;
      let match = catalog.find(vote => !vote.used && vote.title === row.title);
      if (!match) match = catalog.find(vote => !vote.used && vote.index === rowIndex);
      if (!match) throw new Error(`无法识别投票“${row.title}”的 ID`);
      match.used = true;
      return { ...row, id: match.id };
    });
  }

  async function loadOptions(vote) {
    const query = new URLSearchParams(location.search);
    query.set('voteId', vote.id); query.set('offset', '0'); query.set('limit', '100');
    const response = await fetch(`/modules/drama/vote_option/list?${query}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`读取选项失败：HTTP ${response.status}`);
    const rows = Array.isArray(payload) ? payload : (payload.rows || payload.data?.rows || payload.data || []);
    return rows.map((row, index) => ({
      id: String(row.id || row.optionId || ''),
      title: String(row.title || row.name || row.option || `选项 ${index + 1}`),
      image: String(row.image || row.imageUrl || '')
    })).filter(option => option.id);
  }

  async function optionFields(id) {
    const response = await fetch(`/modules/drama/vote_option/edit/${encodeURIComponent(id)}?${location.search.slice(1)}`, { credentials: 'same-origin' });
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = doc.querySelector('form');
    if (!response.ok || !form) throw new Error('未找到选项编辑表单');
    const body = new URLSearchParams();
    [...form.elements].forEach(control => {
      if (!control.name || control.disabled || ['file', 'button', 'submit', 'reset'].includes(control.type) || control.name === 'image') return;
      if (['checkbox', 'radio'].includes(control.type) && !control.checked) return;
      if (control.tagName === 'SELECT' && control.multiple) [...control.selectedOptions].forEach(option => body.append(control.name, option.value));
      else body.append(control.name, control.value || '');
    });
    return body;
  }

  async function upload(file) {
    const body = new FormData(); body.append('file', file, file.name);
    const joiner = location.search ? '&' : '?';
    const response = await fetch(`/drama/upload${location.search}${joiner}type=image`, { method: 'POST', body, credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));
    const url = payload.url || payload.data?.url;
    if (!response.ok || !url) throw new Error(payload.msg || `上传失败：HTTP ${response.status}`);
    return url;
  }

  async function save(option, file) {
    const body = await optionFields(option.id);
    body.set('image', await upload(file));
    const response = await fetch('/modules/drama/vote_option/edit', {
      method: 'POST', credentials: 'same-origin', body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `保存失败：HTTP ${response.status}`);
  }

  function styles() {
    if (document.getElementById(`${MODAL}-style`)) return;
    const style = document.createElement('style'); style.id = `${MODAL}-style`;
    style.textContent = `#${MODAL}{position:fixed;z-index:2147483647;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center}#${MODAL} .vl-panel{width:min(1180px,calc(100vw - 40px));height:min(820px,calc(100vh - 40px));box-sizing:border-box;background:#fff;border-radius:7px;display:flex;flex-direction:column;padding:22px;box-shadow:0 16px 45px rgba(0,0,0,.3)}#${MODAL} h3{margin:0 0 8px}#${MODAL} .vl-note{color:#666;margin-bottom:12px}#${MODAL} .vl-list{flex:1;overflow:auto;border:1px solid #dfe5eb;background:#f7f9fb;padding:12px}#${MODAL} .vl-vote{background:#fff;border:1px solid #dfe5eb;border-radius:5px;margin-bottom:14px;overflow:hidden}#${MODAL} .vl-vote-title{padding:11px 14px;background:#eef5fb;font-weight:700;color:#245b88}#${MODAL} .vl-vote-picker{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:12px;align-items:center;padding:12px 14px;background:#fff8e8;border-top:1px solid #ead9ad}#${MODAL} .vl-vote-hint{grid-column:1/-1;color:#777;font-size:13px}#${MODAL} .vl-row{display:grid;grid-template-columns:55px minmax(180px,1fr) 170px minmax(180px,1fr);gap:14px;align-items:center;padding:10px 14px;border-top:1px solid #eee}#${MODAL} .vl-index{font-weight:700;color:#888}#${MODAL} .vl-preview{width:150px;height:92px;object-fit:contain;background:#f2f2f2;border:1px solid #ddd;border-radius:4px}#${MODAL} .vl-file-name{color:#666;word-break:break-all}#${MODAL} .vl-picker{width:100%}#${MODAL} .vl-clear{white-space:nowrap}#${MODAL} .vl-status{white-space:pre-line;color:#337ab7;margin-top:10px;max-height:90px;overflow:auto}#${MODAL} .vl-actions{text-align:right;margin-top:14px}#${MODAL} .vl-actions button{margin-left:8px}#${MODAL}.vl-picker-open{justify-content:flex-end;padding:12px}#${MODAL}.vl-picker-open .vl-panel{width:min(420px,calc(100vw - 24px));height:calc(100vh - 24px);padding:14px}#${MODAL}.vl-picker-open .vl-note,#${MODAL}.vl-picker-open .vl-vote-picker,#${MODAL}.vl-picker-open .vl-status,#${MODAL}.vl-picker-open .vl-actions{display:none}#${MODAL}.vl-picker-open .vl-list{padding:6px}#${MODAL}.vl-picker-open .vl-vote{margin-bottom:8px}#${MODAL}.vl-picker-open .vl-row{grid-template-columns:70px minmax(0,1fr);min-height:42px;padding:7px 10px;gap:8px}#${MODAL}.vl-picker-open .vl-preview,#${MODAL}.vl-picker-open .vl-file-name{display:none}`;
    document.head.appendChild(style);
  }

  function close() { document.getElementById(MODAL)?.remove(); }

  async function open() {
    const allVotes = votes();
    const selectedRows = allVotes.filter(vote => vote.checked);
    if (!selectedRows.length) return alert(`请先在投票列表中勾选至少一个投票。\n调试信息：读取到 ${allVotes.length} 行，选中 0 行。`);
    let selected;
    try { selected = await resolveVoteIds(selectedRows); }
    catch (error) { return alert(`读取所选投票失败：${error.message || error}`); }
    close(); styles();
    const modal = document.createElement('div'); modal.id = MODAL;
    modal.innerHTML = `<div class="vl-panel"><h3>添加投票选项图片</h3><div class="vl-note">已选择 ${selected.length} 个投票。每个投票一次选择多张图片，图片将按文件选择顺序依次对应第 1、2、3…个选项。</div><div class="vl-list">正在读取投票选项…</div><div class="vl-status"></div><div class="vl-actions"><button class="btn btn-default vl-cancel">取消</button><button class="btn btn-success vl-save" disabled>上传所选图片</button></div></div>`;
    document.body.appendChild(modal);
    const list = modal.querySelector('.vl-list'), status = modal.querySelector('.vl-status'), saveButton = modal.querySelector('.vl-save'), cancel = modal.querySelector('.vl-cancel');
    cancel.onclick = close;
    const prepared = [];
    list.replaceChildren();
    for (const vote of selected) {
      const block = document.createElement('section'); block.className = 'vl-vote';
      const title = document.createElement('div'); title.className = 'vl-vote-title'; title.textContent = `${vote.title}（读取中…）`; block.appendChild(title); list.appendChild(block);
      try {
        const options = await loadOptions(vote); title.textContent = `${vote.title}（${options.length} 个选项）`;
        if (!options.length) { const empty = document.createElement('div'); empty.className = 'vl-row'; empty.textContent = '该投票暂无选项'; block.appendChild(empty); continue; }
        const pickerRow = document.createElement('div'); pickerRow.className = 'vl-vote-picker';
        const picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/*'; picker.multiple = true; picker.className = 'form-control vl-picker';
        const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn btn-default btn-sm vl-clear'; clear.textContent = '清除本投票图片';
        const hint = document.createElement('div'); hint.className = 'vl-vote-hint'; hint.textContent = `请选择 ${options.length} 张图片，按选择顺序对应下方 ${options.length} 个选项。`;
        pickerRow.append(picker, clear, hint); block.appendChild(pickerRow);
        const group = { vote, options, picker, hint, items: [] }; prepared.push(group);
        options.forEach((option, optionIndex) => {
          const row = document.createElement('div'); row.className = 'vl-row';
          const number = document.createElement('div'); number.className = 'vl-index'; number.textContent = `第 ${optionIndex + 1} 张`;
          const name = document.createElement('div'); name.textContent = option.title;
          const preview = document.createElement('img'); preview.className = 'vl-preview'; preview.alt = option.title;
          if (option.image) preview.src = option.image;
          const fileName = document.createElement('div'); fileName.className = 'vl-file-name'; fileName.textContent = '等待选择图片';
          const item = { vote, option, preview, fileName, file: null, objectUrl: '' }; group.items.push(item);
          row.append(number, name, preview, fileName); block.appendChild(row);
        });
        const resetGroup = () => group.items.forEach(item => { if (item.objectUrl) URL.revokeObjectURL(item.objectUrl); item.objectUrl = ''; item.file = null; item.preview.src = item.option.image || ''; item.fileName.textContent = '等待选择图片'; });
        const restorePickerLayout = () => window.setTimeout(() => modal.classList.remove('vl-picker-open'), 250);
        picker.addEventListener('click', () => {
          modal.classList.add('vl-picker-open');
          window.addEventListener('focus', restorePickerLayout, { once: true });
        });
        picker.onchange = () => {
          restorePickerLayout();
          resetGroup(); const files = [...(picker.files || [])];
          group.items.forEach((item, index) => { const file = files[index]; if (!file) return; item.file = file; item.objectUrl = URL.createObjectURL(file); item.preview.src = item.objectUrl; item.fileName.textContent = file.name; });
          hint.textContent = files.length === options.length ? `已选择 ${files.length} 张，顺序匹配完成。` : `数量不匹配：需要 ${options.length} 张，当前选择 ${files.length} 张。`;
          hint.style.color = files.length === options.length ? '#27864a' : '#d9534f'; update();
        };
        clear.onclick = () => { picker.value = ''; resetGroup(); hint.textContent = `请选择 ${options.length} 张图片，按选择顺序对应下方 ${options.length} 个选项。`; hint.style.color = ''; update(); };
      } catch (error) { title.textContent = `${vote.title}（读取失败：${error.message}）`; }
    }
    const update = () => { const chosen = prepared.filter(group => group.picker.files?.length); const valid = chosen.length > 0 && chosen.every(group => group.picker.files.length === group.options.length); const count = chosen.reduce((sum, group) => sum + group.picker.files.length, 0); saveButton.disabled = !valid; saveButton.textContent = valid ? `按顺序上传 ${count} 张图片` : (chosen.length ? '请修正图片数量' : '请选择图片'); };
    update();
    saveButton.onclick = async () => {
      if (saveButton.dataset.finished) return location.reload();
      const groups = prepared.filter(group => group.picker.files?.length); if (!groups.length || groups.some(group => group.picker.files.length !== group.options.length)) return;
      const targets = groups.flatMap(group => group.items.filter(item => item.file));
      saveButton.disabled = true; cancel.disabled = true; prepared.forEach(group => { group.picker.disabled = true; });
      let completed = 0; const failures = [];
      for (let index = 0; index < targets.length; index++) {
        const item = targets[index]; status.textContent = `正在上传 ${index + 1}/${targets.length}：${item.vote.title} → ${item.option.title}`;
        try { await save(item.option, item.file); completed++; }
        catch (error) { failures.push(`${item.vote.title}/${item.option.title}：${error.message || '上传失败'}`); }
      }
      status.textContent = `已完成 ${completed}/${targets.length} 张图片。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      saveButton.disabled = false; saveButton.dataset.finished = 'true'; saveButton.textContent = '关闭并刷新'; cancel.style.display = 'none';
    };
  }

  function add() {
    if (!isPage() || document.querySelector(`[${BUTTON}]`)) return;
    const toolbar = document.querySelector('#toolbar'); if (!toolbar) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-success'; button.style.marginLeft = '8px'; button.textContent = '添加投票选项图片'; button.setAttribute(BUTTON, 'true'); button.onclick = open; toolbar.appendChild(button);
  }
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true }); add();
})();

// 属性列表：快捷添加“行动点”，仅打开并预填创建表单，不自动提交。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-wsm-quick-action-point-button';
  const ADD_FRAME_SELECTOR = 'iframe[src*="/modules/drama/attr_info/add"]';

  function isAttributeListPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/attr_info(?:\/|$)/.test(path)
      && !/\/modules\/drama\/attr_info\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getHostDocument() {
    try {
      return window.top.document;
    } catch (_) {
      return document;
    }
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn'))
      .find(element => element.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  }

  function triggerChange(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      const hostWindow = getHostDocument().defaultView;
      if (hostWindow?.$) hostWindow.$(element).trigger('change');
    } catch (_) {
      // 原生事件已足够；部分后台版本才需要 jQuery 事件。
    }
  }

  function waitForAddFrame(timeout = 6000) {
    const hostDocument = getHostDocument();
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const frame = hostDocument.querySelector(ADD_FRAME_SELECTOR);
        const addDocument = frame?.contentDocument;
        if (addDocument && addDocument.querySelector('select[name="cateId"]')) {
          resolve(addDocument);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          reject(new Error('没有找到属性创建页面，请先关闭其他弹窗后重试。'));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function setField(addDocument, selector, value) {
    const field = addDocument.querySelector(selector);
    if (!field) return false;
    field.value = value;
    triggerChange(field);
    return true;
  }

  function setRadio(addDocument, name, value) {
    const radio = addDocument.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
    if (!radio) return false;
    radio.checked = true;
    triggerChange(radio);
    return true;
  }

  async function openActionPointForm() {
    const addButton = getAddButton();
    if (!addButton) {
      window.alert('当前属性页没有找到“添加”按钮。');
      return;
    }
    try {
      addButton.click();
      const addDocument = await waitForAddFrame();

      // 按截图中的行动点创建规则预填，仍由用户手动点击“确定”提交。
      setField(addDocument, 'select[name="cateId"]', '1');
      setField(addDocument, 'input[name="key"]', 'ap__');
      setField(addDocument, 'input[name="name"]', '行动点');
      setField(addDocument, 'input[name="value"]', '0');
      setField(addDocument, 'select[name="type"]', '0');
      setField(addDocument, 'input[name="minValue"]', '0');
      setField(addDocument, 'input[name="maxValue"]', '0');
      setField(addDocument, 'input[name="changeTimeLimit"]', '0');
      setField(addDocument, 'input[name="changeTime"]', '0');
      setRadio(addDocument, 'visible', '1');
      setRadio(addDocument, 'readonly', '0');
      setRadio(addDocument, 'public', '0');
      setField(addDocument, 'input[name="priority"]', '0');

      addDocument.querySelector('input[name="name"]')?.focus();
    } catch (error) {
      window.alert(error.message || '打开行动点创建页面失败。');
    }
  }

  function addQuickButton() {
    if (!isAttributeListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '快捷添加行动点';
    button.title = '打开属性创建页并预填行动点默认配置';
    button.addEventListener('click', openActionPointForm);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addQuickButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addQuickButton();
})();

// 地点私聊背景图批量上传：按地点列表顺序将图片预览、上传并保存到 image 字段。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-place-image-button';
  const MODAL_ID = 'batch-place-image-modal';

  function isPlacePage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/place(?:\/|$)/.test(path) &&
      !/\/place\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn'))
      .find(element => element.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  }

  function getPlaceTable() {
    const preferredTable = document.querySelector('#bootstrap-table');
    if (preferredTable) return preferredTable;
    return document.querySelector('.bootstrap-table table');
  }

  function getVisiblePlaceTargets(selectedOnly = false) {
    const table = getPlaceTable();
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr th'));
    const nameIndex = headers.findIndex(header => header.textContent.trim() === '地点名称');
    if (nameIndex < 0) return [];
    return Array.from(table.querySelectorAll('tbody > tr')).filter(row => {
      if (!selectedOnly) return true;
      const checkbox = row.querySelector('input[type="checkbox"]');
      return Boolean(checkbox?.checked || row.classList.contains('selected'));
    }).map(row => {
      const edit = Array.from(row.querySelectorAll('a,button')).find(element =>
        element.textContent.replace(/\s+/g, ' ').trim().includes('编辑')
      );
      const sources = [
        edit?.getAttribute('onclick'),
        edit?.getAttribute('data-id'),
        edit?.getAttribute('data-pk'),
        row.getAttribute('data-id'),
        row.getAttribute('data-uniqueid'),
        row.getAttribute('data-pk'),
      ].filter(Boolean);
      const id = sources.map(source => String(source).match(/(?:operate\.(?:edit|editTab)|^)(?:\(['"]?)?(\d+)/)?.[1]).find(Boolean);
      const name = row.cells[nameIndex]?.textContent.replace(/\s+/g, ' ').trim();
      return id && name ? { id, name } : null;
    }).filter(Boolean);
  }

  function addStyles() {
    if (document.getElementById('batch-place-image-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-place-image-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-place-image-panel { width: min(900px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} input[type=file] { width: 100%; padding: 8px 0; }
      #${MODAL_ID} .batch-place-image-list { max-height: 360px; overflow: auto; margin-top: 12px; border: 1px solid #ddd; border-radius: 4px; }
      #${MODAL_ID} .batch-place-image-row { display: grid; grid-template-columns: 44px 72px minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 10px; min-height: 72px; padding: 8px 10px; border-bottom: 1px solid #eee; }
      #${MODAL_ID} .batch-place-image-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .batch-place-image-thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 4px; background: #f5f5f5; }
      #${MODAL_ID} .batch-place-image-unmatched { color: #999; }
      #${MODAL_ID} .batch-place-image-status { margin-top: 10px; color: #337ab7; white-space: pre-line; line-height: 1.6; }
      #${MODAL_ID} .batch-place-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      #${MODAL_ID}.batch-place-image-picker-open { justify-content: flex-end; padding: 12px; }
      #${MODAL_ID}.batch-place-image-picker-open .batch-place-image-panel { width: min(420px, calc(100vw - 24px)); max-height: calc(100vh - 24px); }
      #${MODAL_ID}.batch-place-image-picker-open .batch-place-image-row { grid-template-columns: 32px minmax(0, 1fr); min-height: 48px; }
      #${MODAL_ID}.batch-place-image-picker-open .batch-place-image-thumb,
      #${MODAL_ID}.batch-place-image-picker-open .batch-place-image-row > span:nth-child(3) { display: none; }
      #${MODAL_ID}.batch-place-image-picker-open .batch-place-image-list { max-height: calc(100vh - 260px); }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.querySelectorAll('[data-preview-url]').forEach(image => URL.revokeObjectURL(image.src));
    modal.remove();
  }

  async function uploadPlaceImage(file) {
    const query = new URLSearchParams(window.location.search);
    const body = new FormData();
    body.append('file', file, file.name);
    const response = await fetch(`/drama/upload?${query.toString()}&type=image`, {
      method: 'POST',
      body,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    const url = payload.url || payload.data?.url;
    if (!response.ok || !url) throw new Error(payload.msg || `上传失败：HTTP ${response.status}`);
    return url;
  }

  async function loadPlaceFields(placeId) {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/place/edit/${placeId}?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取地点失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = doc.querySelector('form');
    if (!form) throw new Error('未找到地点编辑表单');
    const fields = new URLSearchParams();
    Array.from(form.elements).forEach(element => {
      if (!element.name || element.name === 'file' || element.name === 'image') return;
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) return;
      if (element.tagName === 'SELECT') {
        Array.from(element.selectedOptions).forEach(option => fields.append(element.name, option.value));
        return;
      }
      fields.append(element.name, element.value);
    });
    return fields;
  }

  async function savePlaceImage(placeId, file) {
    const fields = await loadPlaceFields(placeId);
    fields.set('image', await uploadPlaceImage(file));
    const response = await fetch('/modules/drama/place/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: fields.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `保存失败：HTTP ${response.status}`);
  }

  function openModal() {
    closeModal();
    const selectedTargets = getVisiblePlaceTargets(true);
    if (!selectedTargets.length) {
      window.alert('请先在地点列表中勾选至少一个地点。');
      return;
    }
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-place-image-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量上传地点图片';
    const note = document.createElement('p');
    note.textContent = '只处理已勾选的地点。图片会按勾选地点在列表中的先后顺序匹配，并上传到“私聊背景图”。先选择图片查看匹配预览，点击确认后才会上传并保存。';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.disabled = true;
    const list = document.createElement('div');
    list.className = 'batch-place-image-list';
    const status = document.createElement('div');
    status.className = 'batch-place-image-status';
    status.textContent = '正在读取地点列表……';
    const actions = document.createElement('div');
    actions.className = 'batch-place-image-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认上传 0 张';
    confirm.disabled = true;
    let targets = selectedTargets;
    let files = [];

    const clearPreviewUrls = () => {
      list.querySelectorAll('[data-preview-url]').forEach(image => URL.revokeObjectURL(image.src));
    };

    const updatePreview = () => {
      clearPreviewUrls();
      files = Array.from(picker.files || []).filter(file => file.type.startsWith('image/'));
      list.replaceChildren();
      const total = Math.max(files.length, targets.length);
      for (let index = 0; index < total; index += 1) {
        const file = files[index];
        const target = targets[index];
        const row = document.createElement('div');
        row.className = 'batch-place-image-row';
        const number = document.createElement('span');
        number.textContent = String(index + 1);
        const thumb = document.createElement('img');
        thumb.className = 'batch-place-image-thumb';
        if (file) {
          thumb.src = URL.createObjectURL(file);
          thumb.setAttribute('data-preview-url', 'true');
          thumb.alt = file.name;
        } else {
          thumb.alt = '暂无图片';
        }
        const fileName = document.createElement('span');
        fileName.className = file ? '' : 'batch-place-image-unmatched';
        fileName.textContent = file ? file.name : '暂无图片';
        const placeName = document.createElement('strong');
        placeName.className = target ? '' : 'batch-place-image-unmatched';
        placeName.textContent = target ? target.name : '无对应地点';
        row.append(number, thumb, fileName, placeName);
        list.appendChild(row);
      }
      const uploadCount = Math.min(files.length, targets.length);
      confirm.textContent = `确认上传 ${uploadCount} 张`;
      confirm.disabled = uploadCount === 0;
      if (!files.length) {
        status.textContent = '请选择图片。';
      } else if (files.length > targets.length) {
        status.textContent = `已匹配 ${uploadCount} 张；多出的 ${files.length - targets.length} 张没有对应地点，不会上传。`;
      } else if (targets.length > files.length) {
        status.textContent = `已匹配 ${uploadCount} 张；还有 ${targets.length - files.length} 个地点没有图片，将保持原样。`;
      } else {
        status.textContent = `已匹配 ${uploadCount} 张图片。`;
      }
    };

    const restorePickerLayout = () => {
      window.setTimeout(() => modal.classList.remove('batch-place-image-picker-open'), 250);
    };
    picker.addEventListener('click', () => {
      modal.classList.add('batch-place-image-picker-open');
      window.addEventListener('focus', restorePickerLayout, { once: true });
    });
    picker.addEventListener('change', () => {
      restorePickerLayout();
      updatePreview();
    });
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else closeModal();
        return;
      }
      const uploadCount = Math.min(files.length, targets.length);
      if (!uploadCount) return;
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      let completed = 0;
      const failures = [];
      for (let index = 0; index < uploadCount; index += 1) {
        status.textContent = `正在上传 ${index + 1}/${uploadCount}：${files[index].name} → ${targets[index].name}`;
        try {
          await savePlaceImage(targets[index].id, files[index]);
          completed += 1;
        } catch (error) {
          failures.push(`${targets[index].name}：${error.message || '上传失败'}`);
        }
      }
      status.textContent = `已完成 ${completed}/${uploadCount} 个地点图片。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });

    actions.append(cancel, confirm);
    panel.append(heading, note, picker, list, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);

    picker.disabled = false;
    status.textContent = `已读取 ${targets.length} 个已勾选地点，请选择图片。`;
    updatePreview();
  }

  function addBatchImageButton() {
    if (!isPlacePage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量上传地点图片';
    button.addEventListener('click', openModal);
    const batchPlaceButton = document.querySelector('[data-batch-place-button]');
    (batchPlaceButton || addButton).insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchImageButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchImageButton();
})();

// 线索主图批量上传：只处理勾选的线索，按列表顺序依次匹配图片并保存到 image 字段。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-clue-image-button';
  const MODAL_ID = 'batch-clue-image-modal';

  function isClueListPage() {
    return /\/modules\/drama\/clue\/?$/.test(window.location.pathname);
  }

  function getToolbarButton(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === normalized
    ) || null;
  }

  function getClueTable() {
    return document.querySelector('#bootstrap-table') || document.querySelector('.bootstrap-table table');
  }

  function getSelectedClues() {
    const table = getClueTable();
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr th')).map(header => header.textContent.trim());
    const idIndex = headers.indexOf('ID');
    const nameIndex = headers.indexOf('名称');
    if (idIndex < 0 || nameIndex < 0) return [];
    return Array.from(table.querySelectorAll('tbody > tr')).filter(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      return Boolean(checkbox?.checked || row.classList.contains('selected'));
    }).map(row => {
      const id = row.cells[idIndex]?.textContent.replace(/\s+/g, '').trim();
      const name = row.cells[nameIndex]?.textContent.replace(/\s+/g, ' ').trim();
      return /^\d+$/.test(id || '') ? { id, name: name || `线索 ${id}` } : null;
    }).filter(Boolean);
  }

  function addStyles() {
    if (document.getElementById('batch-clue-image-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-clue-image-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-clue-image-panel { width: min(900px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} input[type=file] { width: 100%; padding: 8px 0; }
      #${MODAL_ID} .batch-clue-image-list { max-height: 380px; overflow: auto; margin-top: 12px; border: 1px solid #ddd; border-radius: 4px; }
      #${MODAL_ID} .batch-clue-image-row { display: grid; grid-template-columns: 42px 68px minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 10px; min-height: 70px; padding: 8px 10px; border-bottom: 1px solid #eee; }
      #${MODAL_ID} .batch-clue-image-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .batch-clue-image-thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 4px; background: #f5f5f5; }
      #${MODAL_ID} .batch-clue-image-thumb[data-preview-url] { cursor: zoom-in; box-shadow: 0 0 0 1px rgba(0,0,0,.08); transition: transform .15s ease, box-shadow .15s ease; }
      #${MODAL_ID} .batch-clue-image-thumb[data-preview-url]:hover { transform: scale(1.06); box-shadow: 0 2px 10px rgba(0,0,0,.22); }
      #${MODAL_ID} .batch-clue-image-muted { color: #999; }
      #${MODAL_ID} .batch-clue-image-status { margin-top: 10px; color: #337ab7; white-space: pre-line; line-height: 1.6; }
      #${MODAL_ID} .batch-clue-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      #${MODAL_ID} .batch-clue-image-lightbox { position: fixed; z-index: 2147483647; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 28px; background: rgba(0,0,0,.88); }
      #${MODAL_ID} .batch-clue-image-lightbox img { display: block; max-width: calc(100vw - 72px); max-height: calc(100vh - 110px); object-fit: contain; border-radius: 4px; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-clue-image-lightbox-caption { max-width: calc(100vw - 120px); overflow: hidden; color: #fff; text-overflow: ellipsis; white-space: nowrap; }
      #${MODAL_ID} .batch-clue-image-lightbox-close { position: absolute; top: 16px; right: 20px; width: 42px; height: 42px; border: 0; border-radius: 50%; color: #fff; background: rgba(255,255,255,.18); font-size: 28px; line-height: 40px; cursor: pointer; }
      #${MODAL_ID}.batch-clue-image-picker-open { justify-content: flex-end; padding: 12px; }
      #${MODAL_ID}.batch-clue-image-picker-open .batch-clue-image-panel { width: min(420px, calc(100vw - 24px)); max-height: calc(100vh - 24px); }
      #${MODAL_ID}.batch-clue-image-picker-open .batch-clue-image-row { grid-template-columns: 32px minmax(0, 1fr); min-height: 46px; }
      #${MODAL_ID}.batch-clue-image-picker-open .batch-clue-image-thumb,
      #${MODAL_ID}.batch-clue-image-picker-open .batch-clue-image-row > span:nth-child(3) { display: none; }
      #${MODAL_ID}.batch-clue-image-picker-open .batch-clue-image-list { max-height: calc(100vh - 260px); }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.querySelectorAll('[data-preview-url]').forEach(image => URL.revokeObjectURL(image.src));
    modal.remove();
  }

  function openImagePreview(src, fileName) {
    const modal = document.getElementById(MODAL_ID);
    if (!modal || !src) return;
    modal.querySelector('.batch-clue-image-lightbox')?.remove();
    const viewer = document.createElement('div');
    viewer.className = 'batch-clue-image-lightbox';
    viewer.tabIndex = -1;
    const image = document.createElement('img');
    image.src = src;
    image.alt = fileName || '线索图片预览';
    const caption = document.createElement('div');
    caption.className = 'batch-clue-image-lightbox-caption';
    caption.textContent = fileName || '';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'batch-clue-image-lightbox-close';
    close.setAttribute('aria-label', '关闭图片预览');
    close.textContent = '×';
    const closeViewer = () => viewer.remove();
    close.addEventListener('click', closeViewer);
    viewer.addEventListener('click', event => {
      if (event.target === viewer) closeViewer();
    });
    viewer.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeViewer();
    });
    viewer.append(image, caption, close);
    modal.appendChild(viewer);
    viewer.focus();
  }

  async function uploadClueImage(file) {
    const query = new URLSearchParams(window.location.search);
    const body = new FormData();
    body.append('file', file, file.name);
    const response = await fetch(`/drama/upload?${query.toString()}&type=image`, {
      method: 'POST',
      body,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    const url = payload.url || payload.data?.url;
    if (!response.ok || !url) throw new Error(payload.msg || `上传失败：HTTP ${response.status}`);
    return url;
  }

  async function loadClueFields(clueId) {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/clue/edit/${encodeURIComponent(clueId)}?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取线索失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = doc.querySelector('#form-clue-edit, form');
    if (!form) throw new Error('未找到线索编辑表单');
    const fields = new URLSearchParams();
    Array.from(form.elements).forEach(element => {
      if (!element.name || element.disabled || element.type === 'file') return;
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) return;
      if (element.tagName === 'SELECT' && element.multiple) {
        Array.from(element.selectedOptions).forEach(option => fields.append(element.name, option.value));
      } else {
        fields.append(element.name, element.value || '');
      }
    });
    // 部分编辑模板没有把这两个隐藏字段的值渲染出来，按当前记录和页面参数补齐。
    fields.set('id', String(clueId));
    const playbookId = query.get('playbookId');
    if (playbookId) fields.set('playbookId', playbookId);
    return fields;
  }

  async function saveClueImage(clueId, file) {
    const fields = await loadClueFields(clueId);
    fields.set('image', await uploadClueImage(file));
    const response = await fetch('/modules/drama/clue/edit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: fields.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `保存失败：HTTP ${response.status}`);
  }

  function openModal() {
    const targets = getSelectedClues();
    if (!targets.length) {
      window.alert('请先在线索列表中勾选至少一条线索。');
      return;
    }
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-clue-image-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量添加线索图片';
    const note = document.createElement('p');
    note.textContent = '只处理已勾选的线索。图片会按勾选线索在列表中的先后顺序依次匹配到“主图”；确认后逐张上传并保存。';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    const list = document.createElement('div');
    list.className = 'batch-clue-image-list';
    const status = document.createElement('div');
    status.className = 'batch-clue-image-status';
    const actions = document.createElement('div');
    actions.className = 'batch-clue-image-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认上传 0 张';
    confirm.disabled = true;
    let files = [];

    const clearPreviewUrls = () => {
      list.querySelectorAll('[data-preview-url]').forEach(image => URL.revokeObjectURL(image.src));
    };
    const updatePreview = () => {
      clearPreviewUrls();
      files = Array.from(picker.files || []).filter(file => file.type.startsWith('image/'));
      list.replaceChildren();
      const total = Math.max(targets.length, files.length);
      for (let index = 0; index < total; index += 1) {
        const target = targets[index];
        const file = files[index];
        const row = document.createElement('div');
        row.className = 'batch-clue-image-row';
        const number = document.createElement('span');
        number.textContent = String(index + 1);
        const thumb = document.createElement('img');
        thumb.className = 'batch-clue-image-thumb';
        if (file) {
          thumb.src = URL.createObjectURL(file);
          thumb.alt = file.name;
          thumb.setAttribute('data-preview-url', 'true');
          thumb.title = '点击查看完整图片';
          thumb.addEventListener('click', () => openImagePreview(thumb.src, file.name));
        } else {
          thumb.alt = '暂无图片';
        }
        const fileName = document.createElement('span');
        fileName.className = file ? '' : 'batch-clue-image-muted';
        fileName.textContent = file ? file.name : '暂无图片';
        const clueName = document.createElement('strong');
        clueName.className = target ? '' : 'batch-clue-image-muted';
        clueName.textContent = target ? `${target.name}（ID：${target.id}）` : '无对应线索';
        row.append(number, thumb, fileName, clueName);
        list.appendChild(row);
      }
      const uploadCount = Math.min(files.length, targets.length);
      confirm.textContent = `确认上传 ${uploadCount} 张`;
      confirm.disabled = uploadCount === 0;
      if (!files.length) status.textContent = `已选择 ${targets.length} 条线索，请选择图片。`;
      else if (files.length > targets.length) status.textContent = `已匹配 ${uploadCount} 张；多出的 ${files.length - targets.length} 张没有对应线索，不会上传。`;
      else if (targets.length > files.length) status.textContent = `已匹配 ${uploadCount} 张；剩余 ${targets.length - files.length} 条线索保持原图。`;
      else status.textContent = `已按顺序匹配 ${uploadCount} 张图片。`;
    };

    const restorePickerLayout = () => window.setTimeout(() => modal.classList.remove('batch-clue-image-picker-open'), 250);
    picker.addEventListener('click', () => {
      modal.classList.add('batch-clue-image-picker-open');
      window.addEventListener('focus', restorePickerLayout, { once: true });
    });
    picker.addEventListener('change', () => {
      restorePickerLayout();
      updatePreview();
    });
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else closeModal();
        return;
      }
      const uploadCount = Math.min(files.length, targets.length);
      if (!uploadCount) return;
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      let completed = 0;
      const failures = [];
      for (let index = 0; index < uploadCount; index += 1) {
        status.textContent = `正在上传 ${index + 1}/${uploadCount}：${files[index].name} → ${targets[index].name}`;
        try {
          await saveClueImage(targets[index].id, files[index]);
          completed += 1;
        } catch (error) {
          failures.push(`${targets[index].name}：${error.message || '上传失败'}`);
        }
      }
      status.textContent = `已完成 ${completed}/${uploadCount} 条线索主图。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });

    actions.append(cancel, confirm);
    panel.append(heading, note, picker, list, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    updatePreview();
  }

  function addBatchImageButton() {
    if (!isClueListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getToolbarButton('添加');
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量添加线索图片';
    button.addEventListener('click', openModal);
    const anchor = getToolbarButton('填充线索图片') || getToolbarButton('批量添加') || addButton;
    anchor.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchImageButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchImageButton();
})();

// 线索列表批量修改调查点：只处理勾选线索，完整保留原配置并仅替换 packId。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-clue-pack-button';
  const MODAL_ID = 'batch-clue-pack-modal';

  function isClueListPage() {
    return /\/modules\/drama\/clue\/?$/.test(window.location.pathname);
  }

  function getToolbarButton(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === normalized
    ) || null;
  }

  function getClueTable() {
    return document.querySelector('#bootstrap-table') || document.querySelector('.bootstrap-table table');
  }

  function getSelectedClues() {
    const table = getClueTable();
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr th')).map(header => header.textContent.trim());
    const idIndex = headers.indexOf('ID');
    const nameIndex = headers.indexOf('名称');
    if (idIndex < 0 || nameIndex < 0) return [];
    return Array.from(table.querySelectorAll('tbody > tr')).filter(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      return Boolean(checkbox?.checked || row.classList.contains('selected'));
    }).map(row => {
      const id = row.cells[idIndex]?.textContent.replace(/\s+/g, '').trim();
      const name = row.cells[nameIndex]?.textContent.replace(/\s+/g, ' ').trim();
      return /^\d+$/.test(id || '') ? { id, name: name || `线索 ${id}`, row } : null;
    }).filter(Boolean);
  }

  function addStyles() {
    if (document.getElementById('batch-clue-pack-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-clue-pack-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-clue-pack-panel { width: min(620px, calc(100vw - 36px)); padding: 22px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { margin: 0 0 14px; color: #666; line-height: 1.7; }
      #${MODAL_ID} label { display: block; margin-bottom: 7px; font-weight: 600; }
      #${MODAL_ID} select { width: 100%; height: 40px; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
      #${MODAL_ID} .batch-clue-pack-status { margin-top: 12px; color: #337ab7; white-space: pre-line; line-height: 1.6; }
      #${MODAL_ID} .batch-clue-pack-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function loadClueForm(clueId) {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/clue/edit/${encodeURIComponent(clueId)}?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取线索失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = doc.querySelector('#form-clue-edit, form');
    if (!form) throw new Error('未找到线索编辑表单');
    return { form, query };
  }

  function serializeClueForm(form, clueId, query) {
    const fields = new URLSearchParams();
    Array.from(form.elements).forEach(element => {
      if (!element.name || element.disabled || element.type === 'file') return;
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) return;
      if (element.tagName === 'SELECT' && element.multiple) {
        Array.from(element.selectedOptions).forEach(option => fields.append(element.name, option.value));
      } else {
        fields.append(element.name, element.value || '');
      }
    });
    fields.set('id', String(clueId));
    const playbookId = query.get('playbookId');
    if (playbookId) fields.set('playbookId', playbookId);
    return fields;
  }

  async function loadInvestigationPoints(clueId) {
    const { form } = await loadClueForm(clueId);
    const select = form.querySelector('select[name="packId"]');
    if (!select) throw new Error('未找到调查点选择框');
    return Array.from(select.options)
      .map(option => ({ value: option.value, text: option.textContent.replace(/\s+/g, ' ').trim() }))
      .filter(option => /^\d+$/.test(option.value) && Number(option.value) > 0);
  }

  async function saveCluePack(clueId, packId) {
    const { form, query } = await loadClueForm(clueId);
    const fields = serializeClueForm(form, clueId, query);
    fields.set('packId', String(packId));
    const response = await fetch('/modules/drama/clue/edit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: fields.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `保存失败：HTTP ${response.status}`);
  }

  function clearTargetSelection(target) {
    const checkbox = target.row?.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    target.row?.classList.remove('selected');
  }

  async function openModal() {
    const targets = getSelectedClues();
    if (!targets.length) {
      window.alert('请先在线索列表中勾选至少一条线索。');
      return;
    }
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-clue-pack-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量修改线索的调查点';
    const note = document.createElement('p');
    note.textContent = `已选择 ${targets.length} 条线索。提交后只修改调查点，名称、描述、主图、技能包及其他配置保持不变。`;
    const label = document.createElement('label');
    label.textContent = '新的调查点';
    const select = document.createElement('select');
    select.disabled = true;
    select.appendChild(new Option('正在读取调查点……', ''));
    const status = document.createElement('div');
    status.className = 'batch-clue-pack-status';
    status.textContent = '正在读取当前剧本的调查点……';
    const actions = document.createElement('div');
    actions.className = 'batch-clue-pack-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = `确认修改 ${targets.length} 条线索`;
    confirm.disabled = true;

    cancel.addEventListener('click', closeModal);
    select.addEventListener('change', () => {
      confirm.disabled = !select.value;
    });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else closeModal();
        return;
      }
      if (!select.value) return;
      const selectedText = select.selectedOptions[0]?.textContent.trim() || '所选调查点';
      confirm.disabled = true;
      cancel.disabled = true;
      select.disabled = true;
      let completed = 0;
      const failures = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        status.textContent = `正在保存 ${index + 1}/${targets.length}：${target.name} → ${selectedText}`;
        try {
          await saveCluePack(target.id, select.value);
          completed += 1;
          clearTargetSelection(target);
        } catch (error) {
          failures.push(`${target.name}（ID：${target.id}）：${error.message || '保存失败'}`);
        }
      }
      status.textContent = `已修改 ${completed}/${targets.length} 条线索的调查点。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
      cancel.style.display = 'none';
    });

    actions.append(cancel, confirm);
    panel.append(heading, note, label, select, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);

    try {
      const points = await loadInvestigationPoints(targets[0].id);
      if (!points.length) throw new Error('当前剧本没有可用调查点');
      select.replaceChildren(new Option('请选择调查点', ''));
      points.forEach(point => select.appendChild(new Option(point.text, point.value)));
      select.disabled = false;
      status.textContent = `已读取 ${points.length} 个调查点，请选择后提交。`;
    } catch (error) {
      select.replaceChildren(new Option('调查点读取失败', ''));
      status.textContent = `读取失败：${error.message || '未知错误'}`;
      confirm.disabled = true;
    }
  }

  function addBatchPackButton() {
    if (!isClueListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getToolbarButton('添加');
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量修改线索的调查点';
    button.title = '勾选线索后统一修改调查点';
    button.addEventListener('click', openModal);
    const anchor = getToolbarButton('批量添加线索图片') || getToolbarButton('填充线索图片') || getToolbarButton('批量添加') || addButton;
    anchor.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchPackButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchPackButton();
})();

// 角色故事快捷创建：复用后台创建页面，预填同标题和下一个角色，不自动提交。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-next-character-story-button';
  const BATCH_DELIVERY_BUTTON_ATTRIBUTE = 'data-batch-character-story-delivery-button';
  const BATCH_DELIVERY_MODAL_ID = 'batch-character-story-delivery-modal';
  const STORY_ADD_PATH = '/modules/drama/character_story/add';

  function isCharacterStoryListPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/character_story(?:\/|$)/.test(path) &&
      !/\/character_story\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getStoryTable() {
    const preferredTable = document.querySelector('#bootstrap-table');
    if (preferredTable) return preferredTable;
    return document.querySelector('.bootstrap-table table');
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn'))
      .find(element => element.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  }

  function getLastStory() {
    const table = getStoryTable();
    const headerRow = table?.querySelector('thead tr');
    if (!headerRow) return { title: '', role: '' };

    const headers = Array.from(headerRow.cells).map(cell => cell.textContent.replace(/\s+/g, ' ').trim());
    const titleIndex = headers.indexOf('标题');
    const roleIndex = headers.indexOf('角色');
    if (titleIndex < 0 || roleIndex < 0) return { title: '', role: '' };

    const rows = Array.from(table.querySelectorAll('tbody > tr')).filter(row =>
      row.cells.length > Math.max(titleIndex, roleIndex) &&
      !row.classList.contains('detail-view') &&
      !row.querySelector('.no-records-found')
    );
    const row = rows[rows.length - 1];
    if (!row) return { title: '', role: '' };
    return {
      title: row.cells[titleIndex].textContent.replace(/\s+/g, ' ').trim(),
      role: row.cells[roleIndex].textContent.replace(/\s+/g, ' ').trim(),
    };
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function getTopDocument() {
    try {
      return window.top?.document || document;
    } catch (_) {
      return document;
    }
  }

  function findStoryAddForm() {
    const topDocument = getTopDocument();
    const frame = Array.from(topDocument.querySelectorAll(`iframe[src*="${STORY_ADD_PATH}"]`)).pop();
    const form = frame?.contentDocument?.querySelector('#form-character_story-add');
    return form ? { frame, form } : null;
  }

  function waitForStoryAddForm(timeout = 8000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const check = () => {
        const result = findStoryAddForm();
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          reject(new Error('故事创建页面加载超时'));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function dispatchFieldEvents(field) {
    if (!field) return;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectNextCharacter(form, previousRole) {
    const entries = Array.from(form.querySelectorAll('input[name="characterId"]'))
      .map(input => ({
        input,
        label: input.closest('label'),
        wrapper: input.closest('.icheckbox-blue'),
        name: normalizeText(input.closest('label')?.textContent),
      }))
      .filter(entry => entry.input.value !== '-1' && entry.name);
    if (!entries.length) return '';

    const currentIndex = entries.findIndex(entry => entry.name === normalizeText(previousRole));
    const nextEntry = entries[(currentIndex + 1 + entries.length) % entries.length];
    entries.forEach(entry => {
      const shouldCheck = entry === nextEntry;
      const stateChanged = entry.input.checked !== shouldCheck ||
        Boolean(entry.wrapper?.classList.contains('checked')) !== shouldCheck;
      entry.input.checked = shouldCheck;
      entry.wrapper?.classList.toggle('checked', shouldCheck);
      if (stateChanged) {
        dispatchFieldEvents(entry.input);
      }
    });
    return nextEntry.name;
  }

  function clearStoryContent(form) {
    const formWindow = form.ownerDocument.defaultView;
    const editor = form.querySelector('.summernote');
    const jquery = formWindow?.jQuery;
    if (editor && jquery && typeof jquery.fn?.summernote === 'function') {
      try {
        jquery(editor).summernote('code', '');
      } catch (_) {
        // Summernote 未完成初始化时，下面的 DOM 清理仍会生效。
      }
    }

    const editable = form.querySelector('.note-editable[contenteditable="true"]') ||
      form.querySelector('[contenteditable="true"]');
    if (editable) {
      editable.innerHTML = '';
      dispatchFieldEvents(editable);
    }

    const content = form.querySelector('input[name="content"], textarea[name="content"]');
    if (content) {
      content.value = '';
      dispatchFieldEvents(content);
    }
  }

  async function openNextStory() {
    const previousStory = getLastStory();
    const addButton = getAddButton();
    if (!addButton) return;

    addButton.click();
    try {
      const { form } = await waitForStoryAddForm();
      const title = form.querySelector('input[name="name"]');
      if (title && previousStory.title) {
        title.value = previousStory.title;
        dispatchFieldEvents(title);
      }
      selectNextCharacter(form, previousStory.role);
      clearStoryContent(form);
    } catch (error) {
      console.warn('[我是谜后台辅助工具] 打开下一个故事失败', error);
    }
  }

  function addNextStoryButton() {
    if (!isCharacterStoryListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '添加下一个故事';
    button.addEventListener('click', () => {
      if (button.dataset.opening === 'true') return;
      button.dataset.opening = 'true';
      button.disabled = true;
      openNextStory().finally(() => {
        button.disabled = false;
        button.dataset.opening = 'false';
      });
    });
    addButton.insertAdjacentElement('afterend', button);
  }

  function getStoryRows() {
    const table = getStoryTable();
    return Array.from(table?.querySelectorAll('tbody > tr') || []).filter(row =>
      row.cells.length > 1 && !row.classList.contains('detail-view') && !row.querySelector('.no-records-found')
    );
  }

  function getStoryId(row) {
    const action = row.querySelector('[onclick*="operate.edit("]');
    const match = action?.getAttribute('onclick')?.match(/operate\.edit\(['"](\d+)['"]\)/);
    if (match) return match[1];
    const idField = row.querySelector('input[name="id"], input[data-id], [data-id]');
    return idField?.value || idField?.getAttribute('data-id') || null;
  }

  async function loadBatchDeliveryOptions() {
    const firstId = getStoryRows().map(getStoryId).find(Boolean);
    if (!firstId) return [{ value: '0', text: '无' }];
    const response = await fetch(`/modules/drama/character_story/edit/${firstId}`, { credentials: 'same-origin' });
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const select = parsed.querySelector('select[name="deliveryScene"]');
    const options = Array.from(select?.options || []).map(option => ({ value: option.value, text: option.textContent.trim() }));
    return options.length ? options : [{ value: '0', text: '无' }];
  }

  async function saveBatchDeliveryScene(storyId, value, row) {
    const body = new URLSearchParams({ id: storyId, deliveryScene: value });
    const response = await fetch('/modules/drama/character_story/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const deliveryCell = Array.from(row.cells).find(cell => cell.querySelector('select.auto-sequence-delivery-select'));
    const rowSelect = deliveryCell?.querySelector('select.auto-sequence-delivery-select');
    if (rowSelect) rowSelect.value = value;
  }

  function addBatchDeliveryStyles() {
    if (document.getElementById('batch-character-story-delivery-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-character-story-delivery-style';
    style.textContent = `
      #${BATCH_DELIVERY_MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${BATCH_DELIVERY_MODAL_ID} .batch-delivery-panel { width: min(520px, calc(100vw - 36px)); padding: 20px; border-radius: 6px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${BATCH_DELIVERY_MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${BATCH_DELIVERY_MODAL_ID} p { color: #666; line-height: 1.6; }
      #${BATCH_DELIVERY_MODAL_ID} select { width: 100%; padding: 8px; border: 1px solid #ccd6e0; border-radius: 4px; background: #fff; }
      #${BATCH_DELIVERY_MODAL_ID} .batch-delivery-status { margin-top: 10px; color: #337ab7; white-space: pre-line; }
      #${BATCH_DELIVERY_MODAL_ID} .batch-delivery-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeBatchDeliveryModal() {
    document.getElementById(BATCH_DELIVERY_MODAL_ID)?.remove();
  }

  function getCheckedStoryRows() {
    return getStoryRows().filter(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      return checkbox?.checked;
    });
  }

  function clearStoryRowSelection(row) {
    const checkbox = row?.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    // 兼容后台可能使用的 iCheck，以及原生复选框两种实现。
    try {
      const jquery = window.jQuery;
      if (jquery && typeof jquery(checkbox).iCheck === 'function') {
        jquery(checkbox).iCheck('uncheck');
      }
    } catch (_) {
      // iCheck 不存在时使用原生状态清理。
    }
    checkbox.checked = false;
    checkbox.removeAttribute('checked');
    row.classList.remove('selected');
    checkbox.closest('.icheckbox, .icheckbox-blue, .icheckbox_square-blue')?.classList.remove('checked');
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function openBatchDeliveryModal() {
    closeBatchDeliveryModal();
    const rows = getCheckedStoryRows();
    if (!rows.length) {
      window.alert('请先在角色故事列表中勾选至少一个故事。');
      return;
    }
    addBatchDeliveryStyles();
    const modal = document.createElement('div');
    modal.id = BATCH_DELIVERY_MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-delivery-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量设置下发回合';
    const note = document.createElement('p');
    note.textContent = `已选择 ${rows.length} 个故事，请选择要设置的下发回合。`;
    const select = document.createElement('select');
    const status = document.createElement('div');
    status.className = 'batch-delivery-status';
    status.textContent = '正在读取回合选项…';
    const actions = document.createElement('div');
    actions.className = 'batch-delivery-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn-default'; cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button'; confirm.className = 'btn btn-warning'; confirm.textContent = '确认设置';
    cancel.addEventListener('click', closeBatchDeliveryModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') { closeBatchDeliveryModal(); return; }
      if (!select.value || confirm.disabled) return;
      confirm.disabled = true; cancel.disabled = true; select.disabled = true;
      let completed = 0; const failures = [];
      for (const row of rows) {
        const storyId = getStoryId(row);
        try {
          await saveBatchDeliveryScene(storyId, select.value, row);
          completed += 1;
          clearStoryRowSelection(row);
        } catch (error) {
          failures.push(`${storyId || '未知故事'}：${error.message || '保存失败'}`);
        }
        status.textContent = `正在处理 ${completed + failures.length}/${rows.length}…`;
      }
      status.textContent = `已完成 ${completed}/${rows.length} 个故事。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = '关闭';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, select, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeBatchDeliveryModal(); });
    document.body.appendChild(modal);
    try {
      const options = await loadBatchDeliveryOptions();
      select.replaceChildren(...options.map(option => {
        const item = document.createElement('option'); item.value = option.value; item.textContent = option.text; return item;
      }));
      status.textContent = '请选择回合后确认设置。';
    } catch (error) {
      status.textContent = `读取回合选项失败：${error.message || '未知错误'}`;
      confirm.disabled = true;
    }
  }

  function addBatchDeliveryButton() {
    if (!isCharacterStoryListPage() || document.querySelector(`[${BATCH_DELIVERY_BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'btn btn-success';
    button.setAttribute(BATCH_DELIVERY_BUTTON_ATTRIBUTE, 'true');
    button.style.cssText = 'margin-left:8px !important;background-color:#18a689 !important;border-color:#18a689 !important;color:#fff !important;';
    button.textContent = '批量设置回合';
    button.addEventListener('click', openBatchDeliveryModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addNextStoryButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addNextStoryButton();
  const deliveryObserver = new MutationObserver(addBatchDeliveryButton);
  deliveryObserver.observe(document.documentElement, { childList: true, subtree: true });
  addBatchDeliveryButton();
})();

// 角色列表批量添加：解析“姓名：性别，年龄岁，介绍”格式并逐条创建角色。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-character-button';
  const MODAL_ID = 'batch-character-modal';

  function isCharacterPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/character(?:\/|$)/.test(path) &&
      !/\/character_story(?:\/|$)/.test(path);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === '添加'
    ) || null;
  }

  function parseCharacterLine(rawLine) {
    const line = rawLine.trim()
      .replace(/^(?:[①②③④⑤⑥⑦⑧⑨⑩]|\d+[.)、．。])\s*/, '')
      .trim();
    if (!line) return null;

    // 支持“姓名：性别，年龄，介绍”和“姓名，性别，介绍”两种常用格式。
    // 后者是剧本角色清单中更常见的简写格式，不能把整行误识别为角色名。
    const separatorIndex = Math.max(line.indexOf('：'), line.indexOf(':'));
    let name;
    let details;
    if (separatorIndex >= 0) {
      name = line.slice(0, separatorIndex).trim();
      details = line.slice(separatorIndex + 1).trim();
    } else {
      // 同时支持“姓名，性别，年龄岁，介绍”和“姓名，年龄岁，性别，介绍”。
      // 年龄在性别前时，不能把年龄误并入姓名或简介。
      const compactMatch = line.match(/^(.+?)[，,、;；]\s*(男|女|未知)(?:[，,、;；:]|\s|$)(.*)$/);
      const ageFirstMatch = line.match(/^(.+?)[，,、;；]\s*(\d{1,3})\s*岁[，,、;；:]\s*(男|女|未知)(?:[，,、;；:]|\s|$)(.*)$/);
      if (ageFirstMatch) {
        name = ageFirstMatch[1].trim();
        details = `${ageFirstMatch[3]}，${ageFirstMatch[2]}岁${ageFirstMatch[4] ? `，${ageFirstMatch[4].trim()}` : ''}`;
      } else if (!compactMatch) {
        name = line;
        details = '';
      } else {
        name = compactMatch[1].trim();
        details = `${compactMatch[2]}${compactMatch[3] ? `，${compactMatch[3].trim()}` : ''}`;
      }
    }
    if (!name) return null;

    let gender = '0';
    const genderMatch = details.match(/^(男|女|未知)(?=[\s，,、;；]|$)/);
    if (genderMatch) {
      gender = genderMatch[1] === '男' ? '1' : genderMatch[1] === '女' ? '2' : '0';
      details = details.slice(genderMatch[0].length).replace(/^[\s，,、;；:：]+/, '').trim();
    }

    let age = '0';
    const ageMatch = details.match(/^(\d{1,3})\s*岁(?=[\s，,、;；]|$)/);
    if (ageMatch) {
      age = ageMatch[1];
      details = details.slice(ageMatch[0].length).replace(/^[\s，,、;；:：]+/, '').trim();
    }

    return { name, gender, age, description: details || '未知' };
  }

  function parseCharacters(text) {
    const seen = new Set();
    return text.split(/\r?\n/)
      .map(parseCharacterLine)
      .filter(character => {
        if (!character || seen.has(character.name)) return false;
        seen.add(character.name);
        return true;
      });
  }

  function genderText(value) {
    return value === '1' ? '男' : value === '2' ? '女' : '未知';
  }

  function addStyles() {
    if (document.getElementById('batch-character-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-character-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-character-panel { width: min(760px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} textarea { width: 100%; min-height: 230px; resize: vertical; padding: 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL_ID} .batch-character-defaults, #${MODAL_ID} .batch-character-preview, #${MODAL_ID} .batch-character-status { margin-top: 10px; white-space: pre-line; line-height: 1.6; }
      #${MODAL_ID} .batch-character-defaults { padding: 10px 12px; border-radius: 4px; color: #31708f; background: #d9edf7; }
      #${MODAL_ID} .batch-character-preview, #${MODAL_ID} .batch-character-status { color: #337ab7; }
      #${MODAL_ID} .batch-character-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function createCharacter(character) {
    const query = new URLSearchParams(window.location.search);
    const body = new URLSearchParams({
      nickname: character.name,
      gender: character.gender,
      age: character.age,
      image: '',
      carton: '',
      description: character.description,
      cate: '0',
      hostCharacter: '0',
      status: '1',
      priority: '0',
    });
    const response = await fetch(`/modules/drama/character/add?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
  }

  function refreshList() {
    window.location.reload();
  }

  function openModal() {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-character-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量添加角色';
    const note = document.createElement('p');
    note.textContent = '每行一个角色，格式示例：①莫野：男，26岁，下城区义体维修匠人。性格沉默寡言。姓名、性别、年龄会自动识别。';
    const defaults = document.createElement('div');
    defaults.className = 'batch-character-defaults';
    defaults.textContent = '默认配置：角色图片、立绘图、调查点、技能包、绑定角色均留空；角色=普通，角色类型=玩家，生效=是，优先级=0。缺少性别时填“未知”，缺少年龄时填“0”，缺少介绍时填“未知”。';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n①莫野：男，26岁，下城区义体维修匠人。性格沉默寡言，心思缜密。\n②包佳慧：女，28岁，前天枢集团基因学博士。气质斯文沉静。';
    const preview = document.createElement('div');
    preview.className = 'batch-character-preview';
    const status = document.createElement('div');
    status.className = 'batch-character-status';
    const actions = document.createElement('div');
    actions.className = 'batch-character-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 个角色';
    const updatePreview = () => {
      const characters = parseCharacters(textarea.value);
      preview.textContent = characters.length
        ? `将创建 ${characters.length} 个角色：\n${characters.map(item => `${item.name}｜${genderText(item.gender)}｜${item.age === '0' ? '未知' : `${item.age}岁`}｜${item.description}`).join('\n')}`
        : '请输入至少一个角色。';
      confirm.textContent = `确认创建 ${characters.length} 个角色`;
      return characters;
    };
    textarea.addEventListener('input', updatePreview);
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') refreshList();
        else closeModal();
        return;
      }
      const characters = updatePreview();
      if (!characters.length) return;
      confirm.disabled = true;
      cancel.disabled = true;
      textarea.disabled = true;
      let completed = 0;
      const failures = [];
      for (const character of characters) {
        status.textContent = `正在创建 ${completed + failures.length + 1}/${characters.length}：${character.name}`;
        try {
          await createCharacter(character);
          completed += 1;
        } catch (error) {
          failures.push(`${character.name}：${error.message || '创建失败'}`);
        }
      }
      status.textContent = `已创建 ${completed}/${characters.length} 个角色。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, defaults, textarea, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    textarea.focus();
    updatePreview();
  }

  function addBatchButton() {
    if (!isCharacterPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量添加角色';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();

// 动作页：自定义快速创建动作。快捷配置只保存在扩展本地，点击快捷按钮不会提交后台动作。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-wsm-custom-action-quick';
  const QUICK_ITEM_ATTRIBUTE = 'data-wsm-custom-action-quick-item';
  const MODAL_ATTRIBUTE = 'data-wsm-custom-action-quick-modal';
  const STORAGE_PREFIX = 'wsm-custom-action-quick-v1';
  let typesPromise = null;

  function isActionListPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/action(?:\/|$)/.test(path)
      && !/\/modules\/drama\/action\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getHostDocument() {
    try {
      return window.top.document;
    } catch (error) {
      return document;
    }
  }

  function getAddButton() {
    const candidates = Array.from(document.querySelectorAll('#toolbar a, #toolbar button, a, button'));
    return candidates.find(button => {
      const text = (button.textContent || '').replace(/\s+/g, '').trim();
      return text === '添加' && !button.disabled && !button.closest(`[${BUTTON_ATTRIBUTE}]`);
    }) || null;
  }

  function getContextKey() {
    return `${STORAGE_PREFIX}:global`;
  }

  // 兼容旧版本按 mainId/skillId 或当前回合 relateId 保存的配置。
  function getMigrationKeys() {
    const params = new URLSearchParams(window.location.search);
    const currentKey = `${STORAGE_PREFIX}:${[
      params.get('playbookId') || '',
      params.get('mainId') || '',
      params.get('skillId') || '',
    ].map(value => encodeURIComponent(value)).join(':')}`;
    const roundKey = `${STORAGE_PREFIX}:${[
      params.get('playbookId') || '',
      params.get('mainId') || '',
      params.get('skillId') || '',
      params.get('relateType') || '',
      params.get('relateId') || ''
    ].map(value => encodeURIComponent(value)).join(':')}`;
    return Array.from(new Set([currentKey, roundKey].filter(key => key !== getContextKey())));
  }

  function hasExtensionStorage() {
    return typeof chrome !== 'undefined'
      && chrome.storage
      && chrome.storage.local
      && typeof chrome.storage.local.get === 'function';
  }

  function readLocalFallback(key) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : [];
    } catch (error) {
      return [];
    }
  }

  function writeLocalFallback(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // 本地存储不可用时，页面仍然可以正常打开创建动作表单。
    }
  }

  function loadStorageValue(key) {
    if (!hasExtensionStorage()) return Promise.resolve(readLocalFallback(key));
    return new Promise(resolve => {
      chrome.storage.local.get([key], result => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(readLocalFallback(key));
          return;
        }
        resolve(Array.isArray(result[key]) ? result[key] : []);
      });
    });
  }

  function loadLegacyStorageValues() {
    const prefix = `${STORAGE_PREFIX}:`;
    if (!hasExtensionStorage()) {
      try {
        return Promise.resolve(Object.keys(window.localStorage)
          .filter(key => key.startsWith(prefix) && key !== getContextKey())
          .map(key => readLocalFallback(key)));
      } catch (error) {
        return Promise.resolve([]);
      }
    }
    return new Promise(resolve => {
      chrome.storage.local.get(null, result => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Object.entries(result || {})
          .filter(([key, value]) => key.startsWith(prefix) && key !== getContextKey() && Array.isArray(value))
          .map(([, value]) => value));
      });
    });
  }

  async function loadQuickConfigs() {
    const keys = [getContextKey(), ...getMigrationKeys()];
    const merged = [];
    for (const key of keys) {
      const configs = await loadStorageValue(key);
      configs.forEach(config => {
        const duplicate = merged.some(item => item.id === config.id || (
          item.name === config.name && String(item.cate) === String(config.cate)
        ));
        if (!duplicate) merged.push(config);
      });
    }
    const legacyValues = await loadLegacyStorageValues();
    legacyValues.flat().forEach(config => {
      const duplicate = merged.some(item => item.id === config.id || (
        item.name === config.name && String(item.cate) === String(config.cate)
      ));
      if (!duplicate) merged.push(config);
    });
    if (merged.length && keys.length > 1) {
      // 迁移到整个后台共用的稳定键，之后切换剧本、关闭或重开后台仍可读取。
      await saveQuickConfigs(merged);
    }
    return merged;
  }

  function saveQuickConfigs(configs) {
    const key = getContextKey();
    if (!hasExtensionStorage()) {
      writeLocalFallback(key, configs);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: configs }, () => {
        if (chrome.runtime && chrome.runtime.lastError) writeLocalFallback(key, configs);
        resolve();
      });
    });
  }

  function getActionAddUrl() {
    const url = new URL('/modules/drama/action/add', window.location.origin);
    url.search = window.location.search;
    return url.href;
  }

  async function loadActionTypes() {
    if (typesPromise) return typesPromise;
    typesPromise = fetch(getActionAddUrl(), { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(`动作类型加载失败（${response.status}）`);
        return response.text();
      })
      .then(html => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        return Array.from(parsed.querySelectorAll('select[name="cate"] option'))
          .map(option => ({ value: option.value, text: (option.textContent || '').trim() }))
          .filter(option => option.value !== '' && option.text);
      });
    try {
      const types = await typesPromise;
      if (!types.length) throw new Error('后台没有返回动作类型');
      return types;
    } catch (error) {
      typesPromise = null;
      throw error;
    }
  }

  function removeModal() {
    const modal = document.querySelector(`[${MODAL_ATTRIBUTE}]`);
    if (modal) modal.remove();
  }

  function makeModal(title) {
    removeModal();
    const modal = document.createElement('div');
    modal.setAttribute(MODAL_ATTRIBUTE, 'true');
    Object.assign(modal.style, {
      position: 'fixed', zIndex: '2147483000', inset: '0',
      background: 'rgba(0, 0, 0, .42)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '20px'
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(620px, 96vw)', maxHeight: '86vh', overflow: 'auto',
      background: '#fff', borderRadius: '6px', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
      padding: '22px', color: '#555', fontSize: '14px'
    });
    const heading = document.createElement('h3');
    heading.textContent = title;
    Object.assign(heading.style, { margin: '0 0 12px', color: '#333', fontSize: '22px' });
    panel.appendChild(heading);
    modal.appendChild(panel);
    modal.addEventListener('click', event => {
      if (event.target === modal) removeModal();
    });
    document.body.appendChild(modal);
    return { modal, panel };
  }

  function makeButton(text, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className || 'btn btn-default';
    button.textContent = text;
    return button;
  }

  async function openShortcutEditor(onSaved) {
    const { panel } = makeModal('添加快捷动作');
    const note = document.createElement('div');
    note.textContent = '快捷动作只保存到扩展本地，保存或点击快捷按钮都不会自动提交后台动作。';
    Object.assign(note.style, { color: '#888', marginBottom: '18px', lineHeight: '1.7' });

    const nameLabel = document.createElement('label');
    nameLabel.textContent = '自定义名称';
    nameLabel.style.display = 'block';
    nameLabel.style.marginBottom = '6px';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '例如：调查调查点';
    nameInput.style.cssText = 'box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d9d9d9;border-radius:4px;margin-bottom:16px;';

    const typeLabel = document.createElement('label');
    typeLabel.textContent = '动作类型';
    typeLabel.style.display = 'block';
    typeLabel.style.marginBottom = '6px';
    const typeSelect = document.createElement('select');
    typeSelect.style.cssText = 'box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d9d9d9;border-radius:4px;background:#fff;';
    const loadingOption = document.createElement('option');
    loadingOption.textContent = '正在加载动作类型…';
    loadingOption.value = '';
    typeSelect.appendChild(loadingOption);
    typeSelect.disabled = true;

    const status = document.createElement('div');
    Object.assign(status.style, { minHeight: '20px', color: '#d9534f', marginTop: '12px', whiteSpace: 'pre-wrap' });
    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' });
    const cancel = makeButton('取消');
    const save = makeButton('保存快捷动作', 'btn btn-primary');
    save.disabled = true;
    cancel.addEventListener('click', () => {
      removeModal();
      openShortcutManager();
    });
    save.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const selected = typeSelect.options[typeSelect.selectedIndex];
      if (!name) {
        status.textContent = '请输入自定义名称。';
        nameInput.focus();
        return;
      }
      if (!selected || !selected.value) {
        status.textContent = '请选择动作类型。';
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      const configs = await loadQuickConfigs();
      configs.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        cate: selected.value,
        cateText: selected.textContent,
        createdAt: new Date().toISOString()
      });
      await saveQuickConfigs(configs);
      removeModal();
      renderQuickButtons(configs);
      onSaved();
    });
    actions.append(cancel, save);
    panel.append(note, nameLabel, nameInput, typeLabel, typeSelect, status, actions);
    nameInput.focus();
    try {
      const types = await loadActionTypes();
      typeSelect.replaceChildren();
      types.forEach(type => {
        const option = document.createElement('option');
        option.value = type.value;
        option.textContent = type.text;
        typeSelect.appendChild(option);
      });
      typeSelect.disabled = false;
      save.disabled = false;
    } catch (error) {
      status.textContent = `动作类型加载失败：${error.message || '请刷新后重试'}`;
    }
  }

  async function openShortcutManager() {
    const { panel } = makeModal('自定义快速创建动作');
    const note = document.createElement('div');
    note.textContent = '快捷配置保存在扩展本地，整个后台的所有剧本和回合共用。点击快捷按钮后，只会打开动作创建页并切换到对应动作类型。';
    Object.assign(note.style, { color: '#888', marginBottom: '16px', lineHeight: '1.7' });
    const list = document.createElement('div');
    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' });
    const add = makeButton('添加快捷动作', 'btn btn-warning');
    const close = makeButton('关闭');
    add.addEventListener('click', () => openShortcutEditor(() => {}));
    close.addEventListener('click', removeModal);
    footer.append(add, close);
    panel.append(note, list, footer);
    const configs = await loadQuickConfigs();
    if (!configs.length) {
      list.textContent = '暂未配置快捷动作。';
      list.style.color = '#999';
    } else {
      configs.forEach(config => {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 0', borderBottom: '1px solid #eee' });
        const label = document.createElement('span');
        label.textContent = `${config.name}（${config.cateText || config.cate}）`;
        label.style.flex = '1';
        const use = makeButton('打开创建页', 'btn btn-primary');
        use.addEventListener('click', () => {
          removeModal();
          openActionCreateForm(config);
        });
        const remove = makeButton('删除', 'btn btn-default');
        remove.addEventListener('click', async () => {
          const next = (await loadQuickConfigs()).filter(item => item.id !== config.id);
          await saveQuickConfigs(next);
          openShortcutManager();
        });
        row.append(label, use, remove);
        list.appendChild(row);
      });
    }
  }

  function waitForActionAddFrame(timeout = 6000) {
    const hostDocument = getHostDocument();
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const iframe = hostDocument.querySelector('iframe[src*="/modules/drama/action/add?"]');
        const addDocument = iframe && iframe.contentDocument;
        if (addDocument && addDocument.querySelector('select[name="cate"]')) {
          resolve(addDocument);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          reject(new Error('没有找到动作创建页面，请先关闭其他弹窗后重试。'));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function triggerSelectChange(select) {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      const hostWindow = getHostDocument().defaultView;
      if (hostWindow && hostWindow.$) hostWindow.$(select).trigger('change');
    } catch (error) {
      // 原生 change 已经足够；部分后台版本只有 jQuery 事件才需要上面的补充触发。
    }
  }

  async function openActionCreateForm(config) {
    const addButton = getAddButton();
    if (!addButton) {
      window.alert('当前动作页没有找到“添加”按钮。');
      return;
    }
    try {
      addButton.click();
      const addDocument = await waitForActionAddFrame();
      ensureActionNameFallback(addDocument);
      const select = addDocument.querySelector('select[name="cate"]');
      if (!select) throw new Error('动作创建表单中没有找到动作类型。');
      select.value = String(config.cate);
      triggerSelectChange(select);
      const nameInput = addDocument.querySelector('input[name="name"], input[name="title"]');
      if (nameInput) nameInput.focus();
    } catch (error) {
      window.alert(error.message || '打开动作创建页面失败。');
    }
  }

  function readActionDescription(form) {
    const fields = Array.from(form.querySelectorAll(
      'textarea[name="description"], input[name="description"], textarea[name="desc"], input[name="desc"]'
    ));
    // 动作表单会把所有动作类型的描述模板一起渲染出来，只有当前动作类型的
    // 字段可见。不能使用 querySelector 的第一个字段，否则会读到隐藏模板。
    const isVisible = (field) => {
      if (!field || field.disabled) return false;
      const view = field.ownerDocument?.defaultView;
      const style = view?.getComputedStyle(field);
      return style?.display !== 'none' && style?.visibility !== 'hidden' && field.getClientRects().length > 0;
    };
    const visibleField = fields.find(isVisible);
    const field = visibleField || fields.find(item => String(item.value || '').trim());
    if (field && String(field.value || '').trim()) return String(field.value).trim();
    const editors = Array.from(form.querySelectorAll('.note-editable[contenteditable="true"], [contenteditable="true"]'));
    const editor = editors.find(isVisible) || editors.find(item => String(item.innerText || item.textContent || '').trim());
    if (editor) return String(editor.innerText || editor.textContent || '').trim();
    const summernotes = Array.from(form.querySelectorAll('.summernote'));
    const summernote = summernotes.find(isVisible) || summernotes.find(item => String(item.value || item.textContent || '').trim());
    return String(summernote?.value || summernote?.textContent || '').replace(/<[^>]+>/g, ' ').trim();
  }

  function ensureActionNameFallback(addDocument) {
    if (!addDocument) return;
    const form = addDocument.querySelector('form');
    if (!form || form.getAttribute('data-wsm-name-fallback') === 'true') return;
    form.setAttribute('data-wsm-name-fallback', 'true');
    const fillNameFromDescription = () => {
      const nameInput = form.querySelector('input[name="name"], input[name="title"]');
      if (!nameInput || String(nameInput.value || '').trim()) return;
      const description = readActionDescription(form);
      if (!description) return;
      nameInput.value = description;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    };
    form.addEventListener('submit', fillNameFromDescription, true);
    // 不同动作类型/版本的确定按钮标签不完全一致，统一监听表单内的提交控件，
    // 同时保留 submit 捕获监听，覆盖原页面的 onclick/jQuery 提交方式。
    form.querySelectorAll('button, input[type="submit"], input[type="button"], a').forEach(button => {
      const text = String(button.textContent || button.value || '').trim();
      if (button.type === 'submit' || button.matches('.btn-primary, [lay-submit], [data-submit]') || /^(确定|保存|提交)$/.test(text)) {
      button.addEventListener('click', fillNameFromDescription, true);
      }
    });

    // RuoYi 的“确定”按钮位于 iframe 外层的 layui 弹窗中，并会直接调用
    // iframe 内的 submitHandler()，不会触发表单 submit，也不属于 form。
    // 因此必须在父文档的捕获阶段先补齐名称，后台随后序列化时才能拿到值。
    try {
      const frameElement = addDocument.defaultView?.frameElement;
      const parentDocument = frameElement?.ownerDocument;
      if (frameElement && parentDocument && frameElement.getAttribute('data-wsm-parent-confirm-watch') !== 'true') {
        frameElement.setAttribute('data-wsm-parent-confirm-watch', 'true');
        parentDocument.addEventListener('click', event => {
          const confirmButton = event.target?.closest?.('.layui-layer-btn0');
          if (!confirmButton) return;
          const layer = confirmButton.closest('.layui-layer');
          if (layer && layer.contains(frameElement)) fillNameFromDescription();
        }, true);
      }
    } catch (_) {
      // 同源弹窗检查失败时，仍保留表单自身的提交监听。
    }
  }

  function renderQuickButtons(configs) {
    if (!isActionListPage()) return;
    const addButton = getAddButton();
    if (!addButton || !addButton.parentElement) return;
    addButton.parentElement.querySelectorAll(`[${QUICK_ITEM_ATTRIBUTE}]`).forEach(item => item.remove());
    configs.forEach(config => {
      const button = makeButton(config.name, 'btn btn-success');
      button.setAttribute(QUICK_ITEM_ATTRIBUTE, 'true');
      button.title = `快速打开：${config.cateText || config.cate}`;
      button.style.marginLeft = '8px';
      button.style.backgroundColor = '#18a689';
      button.style.borderColor = '#18a689';
      button.style.color = '#fff';
      button.addEventListener('click', () => openActionCreateForm(config));
      addButton.insertAdjacentElement('afterend', button);
    });
  }

  async function addActionQuickButton() {
    if (!isActionListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = makeButton('自定义快速创建动作', 'btn btn-warning');
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.addEventListener('click', openShortcutManager);
    addButton.insertAdjacentElement('afterend', button);
    renderQuickButtons(await loadQuickConfigs());
  }

  const observer = new MutationObserver(() => { addActionQuickButton(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addActionQuickButton();
  const actionHostDocument = getHostDocument();
  const watchActionForms = () => {
    if (!isActionListPage()) return;
    // layui 会把新增/编辑弹窗挂到最外层页面，而不是动作列表 iframe 内。
    // 必须扫描 top document，才能覆盖原生“添加”“编辑”和所有动作类型。
    actionHostDocument.querySelectorAll(
      'iframe[src*="/modules/drama/action/add?"], iframe[src*="/modules/drama/action/edit/"]'
    ).forEach(frame => {
      if (frame.getAttribute('data-wsm-action-form-watch') !== 'true') {
        frame.setAttribute('data-wsm-action-form-watch', 'true');
        frame.addEventListener('load', () => { try { ensureActionNameFallback(frame.contentDocument); } catch (_) {} });
      }
      try { if (frame.contentDocument) ensureActionNameFallback(frame.contentDocument); } catch (_) { /* 同源检查失败时忽略 */ }
    });
  };
  const actionFormObserver = new MutationObserver(watchActionForms);
  actionFormObserver.observe(actionHostDocument.documentElement, { childList: true, subtree: true });
  watchActionForms();
})();

// 条件页：自定义快捷创建条件。配置仅保存在扩展本地，快捷按钮只打开并预填新增表单。
(() => {
  'use strict';

  const BUTTON = 'data-wsm-custom-condition-quick';
  const ITEM = 'data-wsm-custom-condition-quick-item';
  const MODAL = 'data-wsm-custom-condition-quick-modal';
  const STORAGE_KEY = 'wsm-custom-condition-quick-v1:global';
  let typesPromise = null;

  const isList = () => /\/modules\/drama\/condition(?:\/|$)/.test(location.pathname)
    && !/\/modules\/drama\/condition\/(?:add|edit)(?:\/|$)/.test(location.pathname);
  const addButton = () => Array.from(document.querySelectorAll('#toolbar a, #toolbar button, a, button')).find(element =>
    (element.textContent || '').replace(/\s+/g, '').trim() === '添加' && !element.disabled && !element.closest(`[${BUTTON}]`)
  );
  const hostDocument = () => { try { return top.document; } catch (error) { return document; } };
  const hasStorage = () => typeof chrome !== 'undefined' && chrome.storage?.local;
  const load = () => new Promise(resolve => {
    if (!hasStorage()) {
      try { resolve(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch (error) { resolve([]); }
      return;
    }
    chrome.storage.local.get([STORAGE_KEY], result => resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []));
  });
  const save = configs => new Promise(resolve => {
    if (!hasStorage()) { localStorage.setItem(STORAGE_KEY, JSON.stringify(configs)); resolve(); return; }
    chrome.storage.local.set({ [STORAGE_KEY]: configs }, resolve);
  });
  const button = (text, className = 'btn btn-default') => {
    const element = document.createElement('button'); element.type = 'button'; element.className = className; element.textContent = text; return element;
  };
  const close = () => document.querySelector(`[${MODAL}]`)?.remove();
  function modal(title) {
    close();
    const layer = document.createElement('div'); layer.setAttribute(MODAL, 'true');
    Object.assign(layer.style, { position: 'fixed', zIndex: '2147483000', inset: '0', background: 'rgba(0,0,0,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' });
    const panel = document.createElement('div');
    Object.assign(panel.style, { width: 'min(620px,96vw)', maxHeight: '86vh', overflow: 'auto', background: '#fff', borderRadius: '6px', boxShadow: '0 8px 30px rgba(0,0,0,.25)', padding: '22px', color: '#555', fontSize: '14px' });
    const heading = document.createElement('h3'); heading.textContent = title; Object.assign(heading.style, { margin: '0 0 12px', color: '#333', fontSize: '22px' });
    panel.appendChild(heading); layer.appendChild(panel); document.body.appendChild(layer);
    layer.onclick = event => { if (event.target === layer) close(); };
    return panel;
  }

  function addUrl() {
    const url = new URL('/modules/drama/condition/add', location.origin); url.search = location.search; return url.href;
  }
  async function types() {
    if (typesPromise) return typesPromise;
    typesPromise = fetch(addUrl(), { credentials: 'same-origin' }).then(async response => {
      if (!response.ok) throw new Error(`条件类型加载失败（${response.status}）`);
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      const select = parsed.querySelector('select[name="cate"], select[name="type"]');
      if (!select) throw new Error('新增条件表单中没有找到条件类型');
      const result = Array.from(select.options).map(option => ({ value: option.value, text: (option.textContent || '').trim() })).filter(item => item.value !== '' && item.text);
      if (!result.length) throw new Error('后台没有返回条件类型');
      return result;
    }).catch(error => { typesPromise = null; throw error; });
    return typesPromise;
  }

  function fireChange(select) {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try { const win = hostDocument().defaultView; if (win?.$) win.$(select).trigger('change'); } catch (error) { /* 原生事件已触发 */ }
  }
  function waitForAdd(timeout = 6000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const frame = hostDocument().querySelector('iframe[src*="/modules/drama/condition/add"]');
        const formDocument = frame?.contentDocument;
        const select = formDocument?.querySelector('select[name="cate"], select[name="type"]');
        if (select) return resolve({ formDocument, select });
        if (Date.now() - started >= timeout) return reject(new Error('没有找到条件新增页面，请关闭其他弹窗后重试。'));
        setTimeout(check, 100);
      };
      check();
    });
  }
  async function openCreate(config) {
    const add = addButton();
    if (!add) return alert('当前条件页没有找到“添加”按钮。');
    try {
      add.click();
      const { formDocument, select } = await waitForAdd();
      select.value = String(config.type);
      fireChange(select);
      formDocument.querySelector('input[name="name"], input[name="title"]')?.focus();
    } catch (error) { alert(error.message || '打开条件新增页面失败。'); }
  }

  async function renderItems(configs) {
    if (!isList()) return;
    const add = addButton(); if (!add?.parentElement) return;
    add.parentElement.querySelectorAll(`[${ITEM}]`).forEach(element => element.remove());
    let anchor = add;
    configs.forEach(config => {
      const quick = button(config.name, 'btn btn-success'); quick.setAttribute(ITEM, 'true'); quick.style.marginLeft = '8px'; quick.title = `快速打开：${config.typeText || config.type}`;
      quick.style.backgroundColor = '#17a2b8'; quick.style.borderColor = '#17a2b8'; quick.style.color = '#fff';
      quick.onclick = () => openCreate(config); anchor.insertAdjacentElement('afterend', quick); anchor = quick;
    });
  }

  async function editor() {
    const panel = modal('添加快捷条件');
    const note = document.createElement('div'); note.textContent = '快捷条件只保存在扩展本地，点击快捷按钮只会打开并预填新增条件，不会自动提交。'; note.style.cssText = 'color:#888;margin-bottom:18px;line-height:1.7;';
    const nameLabel = document.createElement('label'); nameLabel.textContent = '自定义名称'; nameLabel.style.display = 'block';
    const name = document.createElement('input'); name.type = 'text'; name.placeholder = '例如：当前回合'; name.style.cssText = 'box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d9d9d9;border-radius:4px;margin:6px 0 16px;';
    const typeLabel = document.createElement('label'); typeLabel.textContent = '条件类型'; typeLabel.style.display = 'block';
    const select = document.createElement('select'); select.disabled = true; select.style.cssText = 'box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d9d9d9;border-radius:4px;background:#fff;margin-top:6px;';
    select.append(new Option('正在加载条件类型…', ''));
    const status = document.createElement('div'); status.style.cssText = 'min-height:20px;color:#d9534f;margin-top:12px;';
    const footer = document.createElement('div'); footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:20px;';
    const cancel = button('取消'), submit = button('保存快捷条件', 'btn btn-primary'); submit.disabled = true;
    cancel.onclick = manager;
    submit.onclick = async () => {
      const customName = name.value.trim(), option = select.selectedOptions[0];
      if (!customName) { status.textContent = '请输入自定义名称。'; return name.focus(); }
      if (!option?.value) { status.textContent = '请选择条件类型。'; return; }
      const configs = await load(); configs.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: customName, type: option.value, typeText: option.textContent, createdAt: new Date().toISOString() });
      await save(configs); close(); await renderItems(configs); await manager();
    };
    footer.append(cancel, submit); panel.append(note, nameLabel, name, typeLabel, select, status, footer); name.focus();
    try { (await types()).forEach((item, index, all) => { if (index === 0) select.replaceChildren(); select.append(new Option(item.text, item.value)); }); select.disabled = false; submit.disabled = false; }
    catch (error) { status.textContent = error.message || '条件类型加载失败'; }
  }

  async function manager() {
    const panel = modal('自定义快捷条件');
    const note = document.createElement('div'); note.textContent = '快捷配置在整个后台共用。点击绿色快捷按钮后，只会打开条件新增页并切换到对应条件类型。'; note.style.cssText = 'color:#888;margin-bottom:16px;line-height:1.7;';
    const list = document.createElement('div'), footer = document.createElement('div'); footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;';
    const add = button('添加快捷条件', 'btn btn-warning'), done = button('关闭'); add.onclick = editor; done.onclick = close; footer.append(add, done); panel.append(note, list, footer);
    const configs = await load();
    if (!configs.length) { list.textContent = '暂未配置快捷条件。'; list.style.color = '#999'; return; }
    configs.forEach(config => {
      const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #eee;';
      const label = document.createElement('span'); label.textContent = `${config.name}（${config.typeText || config.type}）`; label.style.flex = '1';
      const use = button('打开创建页', 'btn btn-primary'); use.onclick = () => { close(); openCreate(config); };
      const remove = button('删除'); remove.onclick = async () => { await save((await load()).filter(item => item.id !== config.id)); manager(); };
      row.append(label, use, remove); list.append(row);
    });
  }

  async function addMainButton() {
    if (!isList() || document.querySelector(`[${BUTTON}]`)) return;
    const add = addButton(); if (!add) return;
    const custom = button('自定义快捷条件', 'btn btn-warning'); custom.setAttribute(BUTTON, 'true'); custom.style.marginLeft = '8px'; custom.onclick = manager;
    add.insertAdjacentElement('afterend', custom); await renderItems(await load());
  }
  new MutationObserver(addMainButton).observe(document.documentElement, { childList: true, subtree: true });
  addMainButton();
})();

// 全局条件页：按输入的回合标题，批量创建“当前回合 ID 属于列表 L1”条件。
(() => {
  'use strict';

  const BUTTON = 'data-wsm-batch-round-condition';
  const MODAL = 'wsm-batch-round-condition-modal';
  const TYPE_TEXT = '当前回合ID属于列表L1或不属于列表L2';

  const isList = () => /\/modules\/drama\/condition(?:\/|$)/.test(location.pathname)
    && !/\/modules\/drama\/condition\/(?:add|edit)(?:\/|$)/.test(location.pathname);
  const addButton = () => Array.from(document.querySelectorAll('#toolbar a, #toolbar button, a, button')).find(element =>
    (element.textContent || '').replace(/\s+/g, '').trim() === '添加' && !element.disabled
  );
  const clean = value => String(value || '').replace(/\s+/g, '').trim();
  const addUrl = () => {
    const url = new URL('/modules/drama/condition/add', location.origin);
    url.search = location.search;
    return url.href;
  };

  function addStyles() {
    if (document.getElementById('wsm-batch-round-condition-style')) return;
    const style = document.createElement('style');
    style.id = 'wsm-batch-round-condition-style';
    style.textContent = `
      #${MODAL} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL} .wsm-batch-round-condition-panel { width: min(660px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL} p { color: #666; line-height: 1.65; }
      #${MODAL} textarea { box-sizing: border-box; width: 100%; min-height: 210px; resize: vertical; padding: 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL} .wsm-batch-round-condition-defaults { margin: 12px 0; padding: 10px 12px; border-radius: 4px; color: #31708f; background: #d9edf7; line-height: 1.65; }
      #${MODAL} .wsm-batch-round-condition-preview, #${MODAL} .wsm-batch-round-condition-status { margin-top: 10px; color: #337ab7; white-space: pre-line; line-height: 1.6; }
      #${MODAL} .wsm-batch-round-condition-error { color: #a94442; }
      #${MODAL} .wsm-batch-round-condition-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL)?.remove();
  }

  function parseTitles(text) {
    const seen = new Set();
    return text.split(/\r?\n/).map(title => title.trim()).filter(title => {
      if (!title || seen.has(title)) return false;
      seen.add(title);
      return true;
    });
  }

  async function getSceneCatalog() {
    const query = new URLSearchParams(location.search);
    const body = new URLSearchParams({ pageNum: '1', pageSize: '1000' });
    const response = await fetch(`/modules/drama/scene/list?${query.toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.rows)) {
      throw new Error(`读取回合列表失败：${payload.msg || `HTTP ${response.status}`}`);
    }
    return payload.rows.map(row => ({
      id: String(row.id || '').trim(),
      title: String(row.title || '').trim(),
    })).filter(row => row.id && row.title);
  }

  function triggerTypeChange(select, frameWindow) {
    const FrameEvent = frameWindow?.Event || Event;
    select.dispatchEvent(new FrameEvent('input', { bubbles: true }));
    select.dispatchEvent(new FrameEvent('change', { bubbles: true }));
    const dollar = frameWindow?.jQuery || frameWindow?.$;
    if (typeof dollar === 'function') dollar(select).trigger('change');
  }

  async function loadConditionTemplate() {
    // 使用真实新增页执行其类型切换逻辑，并按目标类型所在的 conditon_N 容器读取字段。
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;border:0;opacity:0;pointer-events:none;';
      frame.src = addUrl();

      frame.addEventListener('load', async () => {
        try {
          const doc = frame.contentDocument;
          const frameWindow = frame.contentWindow;
          if (!doc) throw new Error('无法读取条件新增页');
          const typeSelect = doc.querySelector('select[name="cate"], select[name="type"]');
          const typeOption = Array.from(typeSelect?.options || []).find(option => clean(option.textContent) === clean(TYPE_TEXT));
          if (!typeSelect || !typeOption?.value) throw new Error(`未找到条件类型“${TYPE_TEXT}”`);

          typeSelect.value = typeOption.value;
          triggerTypeChange(typeSelect, frameWindow);
          // 新增页会同时输出全部条件类型，每一类配置位于 conditon_N 容器中。
          // 必须按目标 option 的序号锁定回合条件容器；全页搜索“列表L1”会误取到角色条件。
          const conditionGroup = doc.getElementById(`conditon_${typeOption.index}`);
          if (!conditionGroup) throw new Error('条件新增页未找到回合条件配置');
          const list1Inputs = Array.from(conditionGroup.querySelectorAll('input[type="checkbox"][name="jsonA"]'));
          if (!list1Inputs.length) throw new Error('回合条件配置中未找到列表 L1');
          const nameField = doc.querySelector('input[name="name"], input[name="title"]');
          if (!nameField?.name) throw new Error('条件新增页未找到名称字段');
          const descriptionField = conditionGroup.querySelector('input[name="description"], input[name="remark"], textarea[name="description"], textarea[name="remark"]');
          resolve({
            doc,
            typeSelect,
            typeOption,
            nameField,
            descriptionField,
            list1Inputs,
            cleanup: () => frame.remove(),
          });
        } catch (error) {
          frame.remove();
          reject(error);
        }
      }, { once: true });
      document.body.appendChild(frame);
    });
  }

  function getDefaultBody(doc) {
    const body = new URLSearchParams();
    doc.querySelectorAll('input[name], select[name], textarea[name]').forEach(field => {
      if (field.disabled || !field.name) return;
      if (field.tagName === 'INPUT') {
        const type = String(field.type || '').toLowerCase();
        if (['checkbox', 'radio', 'file', 'submit', 'button', 'reset'].includes(type)) {
          if ((type === 'radio') && field.checked) body.append(field.name, field.value);
          return;
        }
      }
      if (field.tagName === 'SELECT' && field.multiple) {
        Array.from(field.selectedOptions).forEach(option => body.append(field.name, option.value));
      } else {
        body.append(field.name, field.value || '');
      }
    });
    return body;
  }

  function findList1Input(template, scene) {
    const normalizedTitle = clean(scene.title);
    return template.list1Inputs.find(input => String(input.value || '').trim() === scene.id) ||
      template.list1Inputs.find(input => clean(input.closest('label, .check-box, .checkbox')?.textContent || input.parentElement?.textContent).includes(normalizedTitle));
  }

  async function createCondition(scene, template) {
    const listInput = findList1Input(template, scene);
    if (!listInput?.name) throw new Error(`条件配置中未找到回合“${scene.title}”`);
    const body = getDefaultBody(template.doc);
    body.set(template.nameField.name, scene.title);
    body.set(template.typeSelect.name, template.typeOption.value);
    if (template.descriptionField?.name) body.set(template.descriptionField.name, TYPE_TEXT);
    body.delete(listInput.name);
    body.append(listInput.name, listInput.value);
    const response = await fetch(addUrl(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
  }

  function refreshList() {
    const refresh = Array.from(document.querySelectorAll('button, a')).find(element =>
      /刷新/.test(element.getAttribute('title') || '') || element.textContent.trim() === '刷新'
    );
    if (refresh) refresh.click();
    else location.reload();
  }

  function openModal() {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL;
    const panel = document.createElement('div');
    panel.className = 'wsm-batch-round-condition-panel';
    const heading = document.createElement('h3');
    heading.textContent = '快速创建回合条件';
    const note = document.createElement('p');
    note.textContent = '每行输入一个已有回合标题。系统会精确匹配回合，并为每个匹配项创建同名条件。';
    const defaults = document.createElement('div');
    defaults.className = 'wsm-batch-round-condition-defaults';
    defaults.textContent = `条件类型固定为“${TYPE_TEXT}”；匹配到的回合会勾选到列表 L1，列表 L2 保持为空，取反为“否”。`;
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n第一幕\n一幕搜证\n第一轮圆桌';
    const preview = document.createElement('div');
    preview.className = 'wsm-batch-round-condition-preview';
    const status = document.createElement('div');
    status.className = 'wsm-batch-round-condition-status';
    const actions = document.createElement('div');
    actions.className = 'wsm-batch-round-condition-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '匹配回合';
    let matchedScenes = [];

    const updatePreview = () => {
      const titles = parseTitles(textarea.value);
      preview.classList.remove('wsm-batch-round-condition-error');
      preview.textContent = titles.length ? `准备匹配 ${titles.length} 个回合：\n${titles.join('\n')}` : '请输入至少一个回合名称。';
      return titles;
    };
    textarea.addEventListener('input', updatePreview);
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') refreshList();
        else closeModal();
        return;
      }
      if (!matchedScenes.length) {
        const titles = updatePreview();
        if (!titles.length) return;
        confirm.disabled = true;
        cancel.disabled = true;
        status.textContent = '正在匹配回合……';
        try {
          const catalog = await getSceneCatalog();
          const byTitle = new Map(catalog.map(scene => [clean(scene.title), scene]));
          matchedScenes = titles.map(title => byTitle.get(clean(title)) || null).filter(Boolean);
          const missing = titles.filter(title => !byTitle.has(clean(title)));
          preview.textContent = `已匹配 ${matchedScenes.length}/${titles.length} 个回合：\n${matchedScenes.map(scene => `✓ ${scene.title}`).join('\n')}${missing.length ? `\n\n未找到：\n${missing.map(title => `× ${title}`).join('\n')}` : ''}`;
          if (!matchedScenes.length) {
            preview.classList.add('wsm-batch-round-condition-error');
            status.textContent = '没有匹配到回合，请检查名称后重试。';
            return;
          }
          textarea.disabled = true;
          status.textContent = missing.length ? '未找到的回合不会创建条件。' : '请确认匹配结果。';
          confirm.textContent = `确认创建 ${matchedScenes.length} 个条件`;
        } catch (error) {
          status.textContent = error.message || '回合匹配失败';
        } finally {
          confirm.disabled = false;
          cancel.disabled = false;
        }
        return;
      }

      confirm.disabled = true;
      cancel.disabled = true;
      let completed = 0;
      const failures = [];
      let template = null;
      try {
        status.textContent = '正在读取条件配置……';
        template = await loadConditionTemplate();
        for (let index = 0; index < matchedScenes.length; index += 1) {
          const scene = matchedScenes[index];
          status.textContent = `正在创建 ${index + 1}/${matchedScenes.length}：${scene.title}`;
          try {
            await createCondition(scene, template);
            completed += 1;
          } catch (error) {
            failures.push(`${scene.title}：${error.message || '创建失败'}`);
          }
        }
      } catch (error) {
        failures.push(error.message || '初始化条件配置失败');
      } finally {
        template?.cleanup?.();
      }
      status.textContent = `已创建 ${completed}/${matchedScenes.length} 个回合条件。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });

    actions.append(cancel, confirm);
    panel.append(heading, note, defaults, textarea, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    textarea.focus();
    updatePreview();
  }

  function addMainButton() {
    if (!isList() || document.querySelector(`[${BUTTON}]`)) return;
    const add = addButton();
    if (!add) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '快速创建回合条件';
    button.addEventListener('click', openModal);
    const anchor = document.querySelector('[data-wsm-custom-condition-quick]') || add;
    anchor.insertAdjacentElement('afterend', button);
  }

  new MutationObserver(addMainButton).observe(document.documentElement, { childList: true, subtree: true });
  addMainButton();
})();

// 事件页：自定义快捷创建事件。快捷配置只保存在扩展本地，点击快捷按钮不会提交后台事件。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-wsm-custom-event-quick';
  const QUICK_ITEM_ATTRIBUTE = 'data-wsm-custom-event-quick-item';
  const MODAL_ATTRIBUTE = 'data-wsm-custom-event-quick-modal';
  const STORAGE_PREFIX = 'wsm-custom-event-quick-v1';
  let typesPromise = null;

  function isEventListPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/event(?:\/|$)/.test(path)
      && !/\/modules\/drama\/event\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getHostDocument() {
    try {
      return window.top.document;
    } catch (error) {
      return document;
    }
  }

  function getAddButton() {
    const candidates = Array.from(document.querySelectorAll('#toolbar a, #toolbar button, a, button'));
    return candidates.find(button => {
      const text = (button.textContent || '').replace(/\s+/g, '').trim();
      return text === '添加' && !button.disabled && !button.closest(`[${BUTTON_ATTRIBUTE}]`);
    }) || null;
  }

  function getContextKey() {
    return `${STORAGE_PREFIX}:global`;
  }

  function getMigrationKeys() {
    const params = new URLSearchParams(window.location.search);
    const currentKey = `${STORAGE_PREFIX}:${[
      params.get('playbookId') || '',
      params.get('mainId') || '',
      params.get('skillId') || '',
    ].map(value => encodeURIComponent(value)).join(':')}`;
    return Array.from(new Set([currentKey].filter(key => key !== getContextKey())));
  }

  function hasExtensionStorage() {
    return typeof chrome !== 'undefined'
      && chrome.storage
      && chrome.storage.local
      && typeof chrome.storage.local.get === 'function';
  }

  function readLocalFallback(key) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : [];
    } catch (error) {
      return [];
    }
  }

  function writeLocalFallback(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // 页面存储不可用时不影响事件创建表单。
    }
  }

  function loadStorageValue(key) {
    if (!hasExtensionStorage()) return Promise.resolve(readLocalFallback(key));
    return new Promise(resolve => {
      chrome.storage.local.get([key], result => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(readLocalFallback(key));
          return;
        }
        resolve(Array.isArray(result[key]) ? result[key] : []);
      });
    });
  }

  function loadLegacyStorageValues() {
    const prefix = `${STORAGE_PREFIX}:`;
    if (!hasExtensionStorage()) {
      try {
        return Promise.resolve(Object.keys(window.localStorage)
          .filter(key => key.startsWith(prefix) && key !== getContextKey())
          .map(key => readLocalFallback(key)));
      } catch (error) {
        return Promise.resolve([]);
      }
    }
    return new Promise(resolve => {
      chrome.storage.local.get(null, result => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Object.entries(result || {})
          .filter(([key, value]) => key.startsWith(prefix) && key !== getContextKey() && Array.isArray(value))
          .map(([, value]) => value));
      });
    });
  }

  async function loadQuickConfigs() {
    const keys = [getContextKey(), ...getMigrationKeys()];
    const merged = [];
    for (const key of keys) {
      const configs = await loadStorageValue(key);
      configs.forEach(config => {
        const duplicate = merged.some(item => item.id === config.id || (
          item.name === config.name && String(item.eventType) === String(config.eventType)
        ));
        if (!duplicate) merged.push(config);
      });
    }
    const legacyValues = await loadLegacyStorageValues();
    legacyValues.flat().forEach(config => {
      const duplicate = merged.some(item => item.id === config.id || (
        item.name === config.name && String(item.eventType) === String(config.eventType)
      ));
      if (!duplicate) merged.push(config);
    });
    if (merged.length && keys.length > 1) await saveQuickConfigs(merged);
    return merged;
  }

  function saveQuickConfigs(configs) {
    const key = getContextKey();
    if (!hasExtensionStorage()) {
      writeLocalFallback(key, configs);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: configs }, () => {
        if (chrome.runtime && chrome.runtime.lastError) writeLocalFallback(key, configs);
        resolve();
      });
    });
  }

  function getEventAddUrl() {
    const url = new URL('/modules/drama/event/add', window.location.origin);
    url.search = window.location.search;
    return url.href;
  }

  function findEventTypeSelect(root) {
    const selects = Array.from(root.querySelectorAll('select'));
    return selects.find(select => Array.from(select.options).some(option => {
      const text = (option.textContent || '').trim();
      return /角色获得了能力|角色获得了线索|回合开始|游戏开始|投票结束/.test(text);
    })) || selects[0] || null;
  }

  async function loadEventTypes() {
    if (typesPromise) return typesPromise;
    typesPromise = fetch(getEventAddUrl(), { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(`事件类型加载失败（${response.status}）`);
        return response.text();
      })
      .then(html => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const select = findEventTypeSelect(parsed);
        if (!select) throw new Error('后台没有找到事件类型选择框');
        return Array.from(select.options)
          .map(option => ({ value: option.value, text: (option.textContent || '').trim() }))
          .filter(option => option.value !== '' && option.text);
      });
    try {
      const types = await typesPromise;
      if (!types.length) throw new Error('后台没有返回事件类型');
      return types;
    } catch (error) {
      typesPromise = null;
      throw error;
    }
  }

  function removeModal() {
    const modal = document.querySelector(`[${MODAL_ATTRIBUTE}]`);
    if (modal) modal.remove();
  }

  function makeModal(title) {
    removeModal();
    const modal = document.createElement('div');
    modal.setAttribute(MODAL_ATTRIBUTE, 'true');
    Object.assign(modal.style, {
      position: 'fixed', zIndex: '2147483000', inset: '0',
      background: 'rgba(0, 0, 0, .42)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: '20px'
    });
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(620px, 96vw)', maxHeight: '86vh', overflow: 'auto',
      background: '#fff', borderRadius: '6px', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
      padding: '22px', color: '#555', fontSize: '14px'
    });
    const heading = document.createElement('h3');
    heading.textContent = title;
    Object.assign(heading.style, { margin: '0 0 12px', color: '#333', fontSize: '22px' });
    panel.appendChild(heading);
    modal.appendChild(panel);
    modal.addEventListener('click', event => {
      if (event.target === modal) removeModal();
    });
    document.body.appendChild(modal);
    return { modal, panel };
  }

  function makeButton(text, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className || 'btn btn-default';
    button.textContent = text;
    return button;
  }

  async function openShortcutEditor() {
    const { panel } = makeModal('添加快捷事件');
    const note = document.createElement('div');
    note.textContent = '快捷事件只保存到扩展本地，保存或点击快捷按钮都不会自动提交后台事件。';
    Object.assign(note.style, { color: '#888', marginBottom: '18px', lineHeight: '1.7' });
    const nameLabel = document.createElement('label');
    nameLabel.textContent = '自定义名称';
    nameLabel.style.display = 'block';
    nameLabel.style.marginBottom = '6px';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '例如：角色获得线索';
    nameInput.style.cssText = 'box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d9d9d9;border-radius:4px;margin-bottom:16px;';
    const typeLabel = document.createElement('label');
    typeLabel.textContent = '事件类型';
    typeLabel.style.display = 'block';
    typeLabel.style.marginBottom = '6px';
    const typeSelect = document.createElement('select');
    typeSelect.style.cssText = 'box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #d9d9d9;border-radius:4px;background:#fff;';
    const loadingOption = document.createElement('option');
    loadingOption.value = '';
    loadingOption.textContent = '正在加载事件类型…';
    typeSelect.appendChild(loadingOption);
    typeSelect.disabled = true;
    const status = document.createElement('div');
    Object.assign(status.style, { minHeight: '20px', color: '#d9534f', marginTop: '12px', whiteSpace: 'pre-wrap' });
    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' });
    const cancel = makeButton('取消');
    const save = makeButton('保存快捷事件', 'btn btn-primary');
    save.disabled = true;
    cancel.addEventListener('click', () => {
      removeModal();
      openShortcutManager();
    });
    save.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const selected = typeSelect.options[typeSelect.selectedIndex];
      if (!name) {
        status.textContent = '请输入自定义名称。';
        nameInput.focus();
        return;
      }
      if (!selected || !selected.value) {
        status.textContent = '请选择事件类型。';
        return;
      }
      save.disabled = true;
      cancel.disabled = true;
      const configs = await loadQuickConfigs();
      configs.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        eventType: selected.value,
        eventTypeText: selected.textContent,
        createdAt: new Date().toISOString()
      });
      await saveQuickConfigs(configs);
      removeModal();
      renderQuickButtons(configs);
      openShortcutManager();
    });
    actions.append(cancel, save);
    panel.append(note, nameLabel, nameInput, typeLabel, typeSelect, status, actions);
    nameInput.focus();
    try {
      const types = await loadEventTypes();
      typeSelect.replaceChildren();
      types.forEach(type => {
        const option = document.createElement('option');
        option.value = type.value;
        option.textContent = type.text;
        typeSelect.appendChild(option);
      });
      typeSelect.disabled = false;
      save.disabled = false;
    } catch (error) {
      status.textContent = `事件类型加载失败：${error.message || '请刷新后重试'}`;
    }
  }

  async function openShortcutManager() {
    const { panel } = makeModal('自定义快速创建事件');
    const note = document.createElement('div');
    note.textContent = '快捷配置保存在扩展本地，整个后台的所有剧本和回合共用。点击快捷按钮后，只会打开事件创建页并切换到对应事件类型。';
    Object.assign(note.style, { color: '#888', marginBottom: '16px', lineHeight: '1.7' });
    const list = document.createElement('div');
    const footer = document.createElement('div');
    Object.assign(footer.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '18px' });
    const add = makeButton('添加快捷事件', 'btn btn-warning');
    const close = makeButton('关闭');
    add.addEventListener('click', openShortcutEditor);
    close.addEventListener('click', removeModal);
    footer.append(add, close);
    panel.append(note, list, footer);
    const configs = await loadQuickConfigs();
    if (!configs.length) {
      list.textContent = '暂未配置快捷事件。';
      list.style.color = '#999';
      return;
    }
    configs.forEach(config => {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 0', borderBottom: '1px solid #eee' });
      const label = document.createElement('span');
      label.textContent = `${config.name}（${config.eventTypeText || config.eventType}）`;
      label.style.flex = '1';
      const use = makeButton('打开创建页', 'btn btn-primary');
      use.addEventListener('click', () => {
        removeModal();
        openEventCreateForm(config);
      });
      const remove = makeButton('删除', 'btn btn-default');
      remove.addEventListener('click', async () => {
        const next = (await loadQuickConfigs()).filter(item => item.id !== config.id);
        await saveQuickConfigs(next);
        openShortcutManager();
      });
      row.append(label, use, remove);
      list.appendChild(row);
    });
  }

  function waitForEventAddFrame(timeout = 6000) {
    const hostDocument = getHostDocument();
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const iframe = hostDocument.querySelector('iframe[src*="/modules/drama/event/add"]');
        const addDocument = iframe && iframe.contentDocument;
        if (addDocument && findEventTypeSelect(addDocument)) {
          resolve(addDocument);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          reject(new Error('没有找到事件创建页面，请先关闭其他弹窗后重试。'));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function triggerSelectChange(select) {
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      const hostWindow = getHostDocument().defaultView;
      if (hostWindow && hostWindow.$) hostWindow.$(select).trigger('change');
    } catch (error) {
      // 原生 change 已经足够；需要 jQuery 事件的后台版本会使用上面的补充触发。
    }
  }

  async function openEventCreateForm(config) {
    const addButton = getAddButton();
    if (!addButton) {
      window.alert('当前事件页没有找到“添加”按钮。');
      return;
    }
    try {
      addButton.click();
      const addDocument = await waitForEventAddFrame();
      const select = findEventTypeSelect(addDocument);
      if (!select) throw new Error('事件创建表单中没有找到事件类型。');
      select.value = String(config.eventType);
      triggerSelectChange(select);
      select.focus();
    } catch (error) {
      window.alert(error.message || '打开事件创建页面失败。');
    }
  }

  function renderQuickButtons(configs) {
    if (!isEventListPage()) return;
    const addButton = getAddButton();
    if (!addButton || !addButton.parentElement) return;
    addButton.parentElement.querySelectorAll(`[${QUICK_ITEM_ATTRIBUTE}]`).forEach(item => item.remove());
    configs.forEach(config => {
      const button = makeButton(config.name, 'btn btn-success');
      button.setAttribute(QUICK_ITEM_ATTRIBUTE, 'true');
      button.title = `快速打开：${config.eventTypeText || config.eventType}`;
      button.style.marginLeft = '8px';
      button.style.backgroundColor = '#8e44ad';
      button.style.borderColor = '#8e44ad';
      button.style.color = '#fff';
      button.addEventListener('click', () => openEventCreateForm(config));
      addButton.insertAdjacentElement('afterend', button);
    });
  }

  async function addEventQuickButton() {
    if (!isEventListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = makeButton('自定义快速创建事件', 'btn btn-warning');
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.addEventListener('click', openShortcutManager);
    addButton.insertAdjacentElement('afterend', button);
    renderQuickButtons(await loadQuickConfigs());
  }

  const observer = new MutationObserver(() => { addEventQuickButton(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventQuickButton();
})();

// 调查点列表：将“可见条件”改为行内下拉编辑，保存时只更新对应调查点。
(() => {
  'use strict';

  const CELL_ATTRIBUTE = 'data-wsm-inline-clue-condition';
  const SAVING_CLASS = 'wsm-inline-clue-condition-saving';
  const BULK_BUTTON_ATTRIBUTE = 'data-wsm-bulk-clue-condition-button';
  const BULK_MODAL_ID = 'wsm-bulk-clue-condition-modal';
  let conditionOptionsPromise = null;
  let decorationScheduled = false;

  function isCluePackageListPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/clue_package(?:\/|$)/.test(path)
      && !/\/modules\/drama\/clue_package\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getTable() {
    const preferred = document.querySelector('#bootstrap-table');
    if (preferred?.querySelector('tbody > tr')) return preferred;
    return Array.from(document.querySelectorAll('.bootstrap-table table, table'))
      .find(table => table.querySelector('tbody > tr')) || preferred || null;
  }

  function getHeaderIndexes(table) {
    const headers = Array.from(table.querySelectorAll('thead tr:last-child th'));
    return {
      id: headers.findIndex(header => header.textContent.replace(/\s+/g, '').trim() === 'id'),
      condition: headers.findIndex(header => header.textContent.replace(/\s+/g, '').trim() === '可见条件'),
    };
  }

  function getVisibleTargets() {
    const table = getTable();
    if (!table) return [];
    const indexes = getHeaderIndexes(table);
    if (indexes.id < 0 || indexes.condition < 0) return [];
    return Array.from(table.querySelectorAll('tbody > tr')).map(row => {
      const id = row.cells[indexes.id]?.textContent.trim();
      const cell = row.cells[indexes.condition];
      return id && cell ? { id, cell } : null;
    }).filter(Boolean);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn'))
      .find(element => element.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  }

  function getSelectedTargets() {
    const table = getTable();
    if (!table) return [];
    const indexes = getHeaderIndexes(table);
    if (indexes.id < 0 || indexes.condition < 0) return [];
    return Array.from(table.querySelectorAll('tbody > tr')).map(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      const id = row.cells[indexes.id]?.textContent.trim();
      const cell = row.cells[indexes.condition];
      return checkbox?.checked && id && cell ? { id, cell } : null;
    }).filter(Boolean);
  }

  function getEditUrl(id) {
    const query = new URLSearchParams(window.location.search);
    return `/modules/drama/clue_package/edit/${encodeURIComponent(id)}?${query.toString()}`;
  }

  async function loadConditionOptions(id) {
    const response = await fetch(getEditUrl(id), {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取可见条件失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const select = doc.querySelector('select[name="showCondition"]');
    if (!select) throw new Error('编辑表单中没有找到可见条件列表');
    const options = Array.from(select.options)
      .map(option => ({ value: option.value, text: option.textContent.trim() }))
      .filter(option => option.value !== '' && option.text);
    if (!options.length) throw new Error('可见条件列表为空');
    return options;
  }

  async function getConditionOptions(id) {
    if (!conditionOptionsPromise) {
      conditionOptionsPromise = loadConditionOptions(id).catch(error => {
        conditionOptionsPromise = null;
        throw error;
      });
    }
    return conditionOptionsPromise;
  }

  async function loadCluePackageFields(id) {
    const response = await fetch(getEditUrl(id), {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取调查点失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = doc.querySelector('form');
    if (!form) throw new Error('未找到调查点编辑表单');
    const fields = new URLSearchParams();
    Array.from(form.elements).forEach(element => {
      if (!element.name || element.name === 'file' || element.name === 'image') return;
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) return;
      if (element.tagName === 'SELECT') {
        Array.from(element.selectedOptions).forEach(option => fields.append(element.name, option.value));
        return;
      }
      fields.append(element.name, element.value);
    });
    return fields;
  }

  async function saveCondition(id, value) {
    const fields = await loadCluePackageFields(id);
    fields.set('showCondition', value);
    const response = await fetch('/modules/drama/clue_package/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: fields.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `保存失败：HTTP ${response.status}`);
    }
  }

  function addStyles() {
    if (document.getElementById('wsm-inline-clue-condition-style')) return;
    const style = document.createElement('style');
    style.id = 'wsm-inline-clue-condition-style';
    style.textContent = `
      td[${CELL_ATTRIBUTE}] { min-width: 92px; text-align: center; vertical-align: middle; }
      td[${CELL_ATTRIBUTE}] select {
        min-width: 76px; max-width: 110px; padding: 3px 6px;
        border: 1px solid #cbd5e1; border-radius: 4px; background: #fff;
        color: #555; cursor: pointer;
      }
      td[${CELL_ATTRIBUTE}].${SAVING_CLASS} select { opacity: .55; cursor: wait; }
      #${BULK_MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${BULK_MODAL_ID} .wsm-bulk-clue-condition-panel { width: min(520px, calc(100vw - 36px)); padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${BULK_MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${BULK_MODAL_ID} p, #${BULK_MODAL_ID} .wsm-bulk-clue-condition-status { color: #666; line-height: 1.6; white-space: pre-line; }
      #${BULK_MODAL_ID} select { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid #ccd6e0; border-radius: 4px; background: #fff; }
      #${BULK_MODAL_ID} .wsm-bulk-clue-condition-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function decorateCell(target, options) {
    const { id, cell } = target;
    if (cell.hasAttribute(CELL_ATTRIBUTE)) return;
    const currentText = cell.textContent.replace(/\s+/g, '').trim();
    const select = document.createElement('select');
    select.setAttribute(CELL_ATTRIBUTE, 'true');
    select.title = '修改可见条件后自动保存';
    options.forEach(option => {
      const item = document.createElement('option');
      item.value = option.value;
      item.textContent = option.text;
      select.appendChild(item);
    });
    const currentOption = options.find(option => option.text.replace(/\s+/g, '').trim() === currentText);
    select.value = currentOption?.value || options[0].value;
    let savedValue = select.value;
    select.addEventListener('change', async () => {
      const nextValue = select.value;
      if (nextValue === savedValue) return;
      cell.classList.add(SAVING_CLASS);
      select.disabled = true;
      try {
        await saveCondition(id, nextValue);
        savedValue = nextValue;
      } catch (error) {
        select.value = savedValue;
        window.alert(`调查点“${id}”可见条件保存失败：${error.message || '未知错误'}`);
      } finally {
        select.disabled = false;
        cell.classList.remove(SAVING_CLASS);
      }
    });
    cell.setAttribute(CELL_ATTRIBUTE, 'true');
    cell.replaceChildren(select);
  }

  function closeBulkModal() {
    document.getElementById(BULK_MODAL_ID)?.remove();
  }

  function clearClueRowSelection(row) {
    const checkbox = row?.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    try {
      const jquery = window.jQuery;
      if (jquery && typeof jquery(checkbox).iCheck === 'function') jquery(checkbox).iCheck('uncheck');
    } catch (_) {
      // 回退到原生复选框状态清理。
    }
    checkbox.checked = false;
    checkbox.removeAttribute('checked');
    row.classList.remove('selected');
    checkbox.closest('.icheckbox, .icheckbox-blue, .icheckbox_square-blue')?.classList.remove('checked');
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function openBulkModal() {
    closeBulkModal();
    const targets = getSelectedTargets();
    if (!targets.length) {
      window.alert('请先勾选要设置可见条件的调查点。');
      return;
    }
    addStyles();
    const modal = document.createElement('div');
    modal.id = BULK_MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'wsm-bulk-clue-condition-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量设置可见条件';
    const note = document.createElement('p');
    note.textContent = `已选择 ${targets.length} 个调查点。选择条件后会逐条保存，操作不会修改调查点其他配置。`;
    const select = document.createElement('select');
    const status = document.createElement('div');
    status.className = 'wsm-bulk-clue-condition-status';
    status.style.marginTop = '12px';
    const actions = document.createElement('div');
    actions.className = 'wsm-bulk-clue-condition-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-primary';
    confirm.textContent = `保存到 ${targets.length} 个调查点`;
    cancel.addEventListener('click', closeBulkModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        closeBulkModal();
        return;
      }
      if (!select.value) return;
      confirm.disabled = true;
      cancel.disabled = true;
      select.disabled = true;
      let completed = 0;
      const failures = [];
      for (const target of targets) {
        status.textContent = `正在保存 ${completed + failures.length + 1}/${targets.length}：调查点 ${target.id}`;
        try {
          await saveCondition(target.id, select.value);
          const inlineSelect = target.cell.querySelector('select');
          if (inlineSelect) inlineSelect.value = select.value;
          completed += 1;
          clearClueRowSelection(target.cell.closest('tr'));
        } catch (error) {
          failures.push(`调查点 ${target.id}：${error.message || '保存失败'}`);
        }
      }
      status.textContent = `已保存 ${completed}/${targets.length} 个调查点。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = '关闭';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, select, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => {
      if (event.target === modal && !confirm.disabled) closeBulkModal();
    });
    document.body.appendChild(modal);
    try {
      const options = await getConditionOptions(targets[0].id);
      options.forEach(option => {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.text;
        select.appendChild(item);
      });
      select.value = options[0]?.value || '';
    } catch (error) {
      status.textContent = error.message || '可见条件读取失败';
      confirm.disabled = true;
    }
  }

  function addBulkButton() {
    if (!isCluePackageListPage() || document.querySelector(`[${BULK_BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BULK_BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量设置可见条件';
    button.title = '勾选调查点后统一设置可见条件';
    button.addEventListener('click', openBulkModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  async function decorateVisibleRows() {
    if (!isCluePackageListPage()) return;
    const targets = getVisibleTargets();
    if (!targets.length) return;
    addStyles();
    try {
      const options = await getConditionOptions(targets[0].id);
      targets.forEach(target => decorateCell(target, options));
    } catch (error) {
      // 读取失败时保留后台原始文本，不影响列表其它功能。
      console.warn('[我是谜后台辅助工具] 可见条件行内编辑未加载：', error.message || error);
    }
  }

  function scheduleDecoration() {
    if (decorationScheduled) return;
    decorationScheduled = true;
    window.setTimeout(() => {
      decorationScheduled = false;
      decorateVisibleRows();
      addBulkButton();
    }, 80);
  }

  const observer = new MutationObserver(scheduleDecoration);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleDecoration();
  addBulkButton();
})();

// 地点列表批量添加：按地点名称自动勾选所有同名调查点。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-place-button';
  const MODAL_ID = 'batch-place-modal';

  function isPlacePage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/place(?:\/|$)/.test(path) &&
      !/\/place\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn'))
      .find(element => element.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  }

  function getNames(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  function normalizeName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function addStyles() {
    if (document.getElementById('batch-place-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-place-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-place-panel { width: min(760px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} textarea { width: 100%; min-height: 230px; resize: vertical; padding: 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL_ID} .batch-place-defaults, #${MODAL_ID} .batch-place-preview, #${MODAL_ID} .batch-place-status { margin-top: 10px; white-space: pre-line; line-height: 1.6; }
      #${MODAL_ID} .batch-place-defaults { padding: 10px 12px; border-radius: 4px; color: #31708f; background: #d9edf7; }
      #${MODAL_ID} .batch-place-preview, #${MODAL_ID} .batch-place-status { color: #337ab7; }
      #${MODAL_ID} .batch-place-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function getCluePackages() {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/place/add?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取调查点列表失败：HTTP ${response.status}`);
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(parsed.querySelectorAll('input[name="cluePackages"]'))
      .map(input => ({
        id: input.value,
        name: normalizeName(input.closest('label')?.textContent),
      }))
      .filter(item => item.id && item.name);
  }

  async function createPlace(name, cluePackageIds) {
    const query = new URLSearchParams(window.location.search);
    const body = new URLSearchParams({
      name,
      description: '',
      image: '',
      indicator: '',
      showCondition: '0',
      hotPos: '',
      indicatorPos: '',
      openSound: '',
      status: '1',
      privacy: '1',
      autoTrigger: '0',
      fadein: '0',
      mapId: '0',
      priority: '0',
      defaultHide: '0',
    });
    cluePackageIds.forEach(id => body.append('cluePackages', id));
    const response = await fetch(`/modules/drama/place/add?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
  }

  function openModal() {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-place-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量添加地点';
    const note = document.createElement('p');
    note.textContent = '每行一个地点名称。空行会忽略；同名地点按出现顺序依次关联同名调查点（第一个对应第一个，第二个对应第二个）。';
    const defaults = document.createElement('div');
    defaults.className = 'batch-place-defaults';
    defaults.textContent = '默认配置：简介、图片、坐标、音效、地图等字段留空；生效“是”、开启私聊“是”、自动触发技能“否”、开启淡入“否”、默认不可见“否”。';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n野哥修配铺\n天枢集团\n后山';
    const preview = document.createElement('div');
    preview.className = 'batch-place-preview';
    const status = document.createElement('div');
    status.className = 'batch-place-status';
    const actions = document.createElement('div');
    actions.className = 'batch-place-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 个地点';

    const updatePreview = () => {
      const names = getNames(textarea.value);
      preview.textContent = names.length ? `将创建 ${names.length} 个地点：\n${names.join('、')}` : '请输入至少一个地点名称。';
      confirm.textContent = `确认创建 ${names.length} 个地点`;
      return names;
    };

    textarea.addEventListener('input', updatePreview);
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else closeModal();
        return;
      }
      const names = updatePreview();
      if (!names.length) return;
      confirm.disabled = true;
      cancel.disabled = true;
      textarea.disabled = true;
      let completed = 0;
      const failures = [];
      try {
        status.textContent = '正在读取调查点列表……';
        const cluePackages = await getCluePackages();
        // 同名调查点按后台返回顺序建立队列；每创建一个同名地点只取一个，
        // 避免过去把同名地点全部关联到同一组调查点。
        const clueQueues = new Map();
        cluePackages.forEach(item => {
          const key = normalizeName(item.name);
          if (!clueQueues.has(key)) clueQueues.set(key, []);
          clueQueues.get(key).push(item.id);
        });
        for (const name of names) {
          const key = normalizeName(name);
          const queue = clueQueues.get(key) || [];
          const matchingIds = queue.length ? [queue.shift()] : [];
          status.textContent = `正在创建 ${completed + 1}/${names.length}：${name}`;
          try {
            await createPlace(name, matchingIds);
            completed += 1;
          } catch (error) {
            failures.push(`${name}：${error.message || '创建失败'}`);
          }
        }
      } catch (error) {
        failures.push(error.message || '读取调查点列表失败');
      }
      status.textContent = `已创建 ${completed}/${names.length} 个地点。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });

    actions.append(cancel, confirm);
    panel.append(heading, note, defaults, textarea, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    textarea.focus();
    updatePreview();
  }

  function addBatchButton() {
    if (!isPlacePage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量添加地点';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();

// 调查点列表批量添加：每行一个名称，默认绑定“搜查[地点技能]”。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-clue-package-button';
  const MODAL_ID = 'batch-clue-package-modal';

  function isCluePackagePage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/clue_package(?:\/|$)/.test(path) &&
      !/\/clue_package\/(?:add|edit)(?:\/|$)/.test(path);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn'))
      .find(element => element.textContent.replace(/\s+/g, ' ').trim() === '添加') || null;
  }

  function getNames(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  function normalizeRoleName(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function addStyles() {
    if (document.getElementById('batch-clue-package-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-clue-package-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-clue-package-panel { width: min(760px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} textarea { width: 100%; min-height: 230px; resize: vertical; padding: 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL_ID} .batch-clue-package-defaults, #${MODAL_ID} .batch-clue-package-preview, #${MODAL_ID} .batch-clue-package-status { margin-top: 10px; white-space: pre-line; line-height: 1.6; }
      #${MODAL_ID} .batch-clue-package-defaults { padding: 10px 12px; border-radius: 4px; color: #31708f; background: #d9edf7; }
      #${MODAL_ID} .batch-clue-package-preview, #${MODAL_ID} .batch-clue-package-status { color: #337ab7; }
      #${MODAL_ID} .batch-clue-package-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function getSearchSkill() {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/clue_package/add?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取技能列表失败：HTTP ${response.status}`);
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const input = Array.from(parsed.querySelectorAll('input[name="skillList"]')).find(item =>
      /搜查/.test(item.closest('label')?.textContent || '')
    );
    if (!input?.value) throw new Error('没有找到“搜查[地点技能]”技能');
    return { id: input.value, name: input.closest('label')?.textContent.replace(/\s+/g, ' ').trim() || '搜查[地点技能]' };
  }

  async function getRoleLimits() {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/clue_package/add?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取角色列表失败：HTTP ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const title = Array.from(parsed.querySelectorAll('label, .control-label, th, dt')).find(element =>
      normalizeRoleName(element.textContent).replace(/：$/, '') === '互动限制角色'
    );
    let group = title?.closest('.form-group');
    if (!group && title) {
      let parent = title.parentElement;
      for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
        if (parent.querySelectorAll('input[type="checkbox"]').length) {
          group = parent;
          break;
        }
      }
    }
    const inputs = Array.from(group?.querySelectorAll('input[type="checkbox"]') || []);
    return inputs.map(input => {
      const linkedLabel = input.id ? parsed.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      const label = input.closest('label') || linkedLabel;
      return {
        name: input.name,
        id: input.value,
        roleName: normalizeRoleName(label?.textContent || ''),
      };
    }).filter(item => item.name && item.id && item.roleName);
  }

  async function createCluePackage(name, skillId, roleLimit) {
    const query = new URLSearchParams(window.location.search);
    const body = new URLSearchParams({
      name,
      displayName: '',
      drawMode: '1',
      skillList: skillId,
      showCondition: '0',
      status: '1',
      priority: '0',
    });
    if (roleLimit?.name && roleLimit.id) body.append(roleLimit.name, roleLimit.id);
    const response = await fetch(`/modules/drama/clue_package/add?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
  }

  function openModal() {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-clue-package-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量添加调查点';
    const note = document.createElement('p');
    note.textContent = '每行一个调查点名称。空行会忽略，名称允许重复。';
    const defaults = document.createElement('div');
    defaults.className = 'batch-clue-package-defaults';
    defaults.textContent = '默认配置：搜查模式“随机抽取”、技能列表勾选“搜查[地点技能]”；如果调查点名称与角色昵称相同，则自动勾选互动限制角色；生效“是”、优先级“0”。其他字段留空或使用后台默认值。';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n厨房\n卧室\n后院';
    const preview = document.createElement('div');
    preview.className = 'batch-clue-package-preview';
    const status = document.createElement('div');
    status.className = 'batch-clue-package-status';
    const actions = document.createElement('div');
    actions.className = 'batch-clue-package-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 个调查点';

    const updatePreview = () => {
      const names = getNames(textarea.value);
      preview.textContent = names.length ? `将创建 ${names.length} 个调查点：\n${names.join('、')}` : '请输入至少一个调查点名称。';
      confirm.textContent = `确认创建 ${names.length} 个调查点`;
      return names;
    };

    textarea.addEventListener('input', updatePreview);
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else closeModal();
        return;
      }
      const names = updatePreview();
      if (!names.length) return;
      confirm.disabled = true;
      cancel.disabled = true;
      textarea.disabled = true;
      let completed = 0;
      const failures = [];
      try {
        status.textContent = '正在读取“搜查[地点技能]”……';
        const skill = await getSearchSkill();
        status.textContent = '正在读取角色列表……';
        const roleLimits = await getRoleLimits();
        for (const name of names) {
          const roleLimit = roleLimits.find(item => item.roleName === normalizeRoleName(name));
          status.textContent = `正在创建 ${completed + 1}/${names.length}：${name}`;
          try {
            await createCluePackage(name, skill.id, roleLimit);
            completed += 1;
          } catch (error) {
            failures.push(`${name}：${error.message || '创建失败'}`);
          }
        }
      } catch (error) {
        failures.push(error.message || '读取默认技能失败');
      }
      status.textContent = `已创建 ${completed}/${names.length} 个调查点。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });

    actions.append(cancel, confirm);
    panel.append(heading, note, defaults, textarea, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    textarea.focus();
    updatePreview();
  }

  function addBatchButton() {
    if (!isCluePackagePage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量添加调查点';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();

// 角色头像批量上传：按角色列表从上到下，将图片上传后保存到角色图片字段。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-character-image-button';
  const MODAL_ID = 'batch-character-image-modal';

  function isCharacterPage() {
    const path = window.location.pathname;
    return /\/modules\/drama\/character(?:\/|$)/.test(path) &&
      !/\/character_story(?:\/|$)/.test(path);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === '添加'
    ) || null;
  }

  function getCharacterTable() {
    const preferredTable = document.querySelector('#bootstrap-table');
    if (preferredTable) return preferredTable;
    return document.querySelector('.bootstrap-table table');
  }

  function getVisibleCharacterNames() {
    const table = getCharacterTable();
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr th'));
    const nameIndex = headers.findIndex(header => header.textContent.trim() === '昵称');
    if (nameIndex < 0) return [];
    return Array.from(table.querySelectorAll('tbody > tr')).map(row => row.cells[nameIndex]?.textContent.trim()).filter(Boolean);
  }

  function getDomTargets() {
    const table = getCharacterTable();
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr th'));
    const nameIndex = headers.findIndex(header => header.textContent.trim() === '昵称');
    if (nameIndex < 0) return [];
    return Array.from(table.querySelectorAll('tbody > tr')).map(row => {
      const edit = Array.from(row.querySelectorAll('a,button')).find(element =>
        element.textContent.replace(/\s+/g, ' ').trim().includes('编辑')
      );
      const sources = [
        edit?.getAttribute('onclick'),
        edit?.getAttribute('data-id'),
        edit?.getAttribute('data-pk'),
        row.getAttribute('data-id'),
        row.getAttribute('data-uniqueid'),
        row.getAttribute('data-pk'),
      ].filter(Boolean);
      const id = sources.map(source => String(source).match(/(?:operate\.(?:edit|editTab)|^)(?:\(['"]?)?(\d+)/)?.[1]).find(Boolean);
      const cells = Array.from(row.cells);
      return id && nameIndex >= 0 ? { id, name: cells[nameIndex]?.textContent.trim() || `角色 ${id}` } : null;
    }).filter(Boolean);
  }

  async function getTargets() {
    const visibleNames = getVisibleCharacterNames();
    const domTargets = getDomTargets();
    if (domTargets.length === visibleNames.length && domTargets.length) return domTargets;

    const query = new URLSearchParams(window.location.search);
    query.set('pageNum', '1');
    query.set('pageSize', '1000');
    const response = await fetch(`/modules/drama/character/list?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.rows)) throw new Error('无法读取角色列表数据');
    const rows = payload.rows.map(row => ({
      id: String(row.id || row.characterId || '').trim(),
      name: String(row.nickname || row.name || '').trim(),
    })).filter(row => row.id && row.name);
    if (!visibleNames.length) return rows;

    const used = new Set();
    return visibleNames.map(name => {
      const index = rows.findIndex((row, rowIndex) => row.name === name && !used.has(rowIndex));
      if (index < 0) return null;
      used.add(index);
      return rows[index];
    }).filter(Boolean);
  }

  function addStyles() {
    if (document.getElementById('batch-character-image-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-character-image-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-character-image-panel { width: min(700px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} input[type=file] { width: 100%; padding: 8px 0; }
      #${MODAL_ID} .batch-character-image-list { max-height: 260px; overflow: auto; margin-top: 10px; border: 1px solid #ddd; }
      #${MODAL_ID} .batch-character-image-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1fr); gap: 8px; padding: 8px 10px; border-bottom: 1px solid #eee; }
      #${MODAL_ID} .batch-character-image-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .batch-character-image-status { margin-top: 10px; color: #337ab7; white-space: pre-line; }
      #${MODAL_ID} .batch-character-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function uploadCharacterImage(file) {
    const query = new URLSearchParams(window.location.search);
    const body = new FormData();
    body.append('file', file, file.name);
    const response = await fetch(`/drama/upload?${query.toString()}&type=image`, {
      method: 'POST',
      body,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    const url = payload.url || payload.data?.url;
    if (!response.ok || !url) throw new Error(payload.msg || `上传失败：HTTP ${response.status}`);
    return url;
  }

  async function loadCharacterFields(characterId) {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/character/edit/${characterId}?${query.toString()}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取角色失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = doc.querySelector('form');
    if (!form) throw new Error('未找到角色编辑表单');
    const fields = new URLSearchParams();
    Array.from(form.elements).forEach(element => {
      if (!element.name || element.name === 'file' || element.name === 'image') return;
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) return;
      if (element.tagName === 'SELECT') {
        Array.from(element.selectedOptions).forEach(option => fields.append(element.name, option.value));
        return;
      }
      fields.append(element.name, element.value);
    });
    return fields;
  }

  async function saveCharacterImage(characterId, file) {
    const fields = await loadCharacterFields(characterId);
    fields.set('image', await uploadCharacterImage(file));
    const response = await fetch('/modules/drama/character/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: fields.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `保存失败：HTTP ${response.status}`);
  }

  async function openModal() {
    let targets;
    try {
      targets = await getTargets();
    } catch (error) {
      window.alert(`读取角色列表失败：${error.message || '未知错误'}`);
      return;
    }
    if (!targets.length) {
      window.alert('当前页没有可上传头像的角色。');
      return;
    }
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-character-image-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量上传角色头像';
    const note = document.createElement('p');
    note.textContent = `图片会按角色列表从上到下对应。当前页有 ${targets.length} 个角色，可选择不超过 ${targets.length} 张图片。点击确认后才会上传并保存。`;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    const list = document.createElement('div');
    list.className = 'batch-character-image-list';
    const status = document.createElement('div');
    status.className = 'batch-character-image-status';
    const actions = document.createElement('div');
    actions.className = 'batch-character-image-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认上传 0 张';
    let files = [];

    const updatePreview = () => {
      files = Array.from(picker.files || []).filter(file => file.type.startsWith('image/'));
      list.replaceChildren();
      files.slice(0, targets.length).forEach((file, index) => {
        const row = document.createElement('div');
        row.className = 'batch-character-image-row';
        row.innerHTML = `<span>${index + 1}</span><strong>${targets[index].name}</strong><span>${file.name}</span>`;
        list.appendChild(row);
      });
      if (files.length > targets.length) status.textContent = `图片数量超过角色数量，请减少到 ${targets.length} 张以内。`;
      else status.textContent = files.length ? `将按顺序上传 ${files.length} 张头像。` : '请选择图片。';
      confirm.textContent = `确认上传 ${Math.min(files.length, targets.length)} 张`;
    };
    picker.addEventListener('change', updatePreview);
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else closeModal();
        return;
      }
      if (!files.length || files.length > targets.length) return;
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      let completed = 0;
      const failures = [];
      for (let index = 0; index < files.length; index += 1) {
        status.textContent = `正在上传 ${index + 1}/${files.length}：${targets[index].name}`;
        try {
          await saveCharacterImage(targets[index].id, files[index]);
          completed += 1;
        } catch (error) {
          failures.push(`${targets[index].name}：${error.message || '上传失败'}`);
        }
      }
      status.textContent = `已完成 ${completed}/${files.length} 个头像。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, picker, list, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
  }

  function addBatchImageButton() {
    if (!isCharacterPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量上传头像';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchImageButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchImageButton();
})();

// 回合列表批量添加：仅按输入顺序创建回合，不再自动创建动作或事件。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-scene-button';
  const MODAL_ID = 'batch-scene-modal';

  function isSceneListPage() {
    return /\/modules\/drama\/scene\/?$/.test(window.location.pathname);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === '添加'
    ) || null;
  }

  function addStyles() {
    if (document.getElementById('batch-scene-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-scene-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-scene-panel { width: min(680px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.65; }
      #${MODAL_ID} textarea { width: 100%; min-height: 210px; resize: vertical; padding: 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL_ID} .batch-scene-defaults { margin: 12px 0; padding: 10px 12px; border-radius: 4px; color: #31708f; background: #d9edf7; line-height: 1.65; }
      #${MODAL_ID} .batch-scene-preview, #${MODAL_ID} .batch-scene-status { margin-top: 10px; color: #337ab7; white-space: pre-line; }
      #${MODAL_ID} .batch-scene-error { color: #a94442; }
      #${MODAL_ID} .batch-scene-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function parseScenes(text) {
    const seen = new Set();
    const scenes = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const separator = line.indexOf('|');
      const title = (separator < 0 ? line : line.slice(0, separator)).trim();
      const customWord = separator < 0 ? '' : line.slice(separator + 1).trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      scenes.push({ title, customWord });
    }
    const nonLastCustom = scenes.find((scene, index) => scene.customWord && index !== scenes.length - 1);
    if (nonLastCustom) {
      throw new Error(`“${nonLastCustom.title}”不是最后一行；仅最后一个回合支持自定义按钮文字。`);
    }
    return scenes;
  }

  function getTableTitles() {
    const table = document.querySelector('#bootstrap-table, .bootstrap-table table');
    if (!table) return new Set();
    const headers = Array.from(table.querySelectorAll('thead tr th'));
    const titleIndex = headers.findIndex(header => header.textContent.trim() === '标题');
    if (titleIndex < 0) return new Set();
    return new Set(Array.from(table.querySelectorAll('tbody tr')).map(row => row.cells[titleIndex]?.textContent.trim()).filter(Boolean));
  }

  async function getExistingScenes() {
    const query = new URLSearchParams(window.location.search);
    query.set('pageNum', '1');
    query.set('pageSize', '1000');
    try {
      const response = await fetch(`${window.location.pathname.replace(/\/$/, '')}/list?${query.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const payload = await response.json();
      if (!response.ok || !Array.isArray(payload.rows)) throw new Error('列表数据不可用');
      return {
        titles: new Set(payload.rows.map(row => String(row.title || '').trim()).filter(Boolean)),
        maxPriority: Math.max(0, ...payload.rows.map(row => Number(row.priority) || 0)),
      };
    } catch (_) {
      const titles = getTableTitles();
      return { titles, maxPriority: 0 };
    }
  }

  async function createScene(scene, priority) {
    const query = new URLSearchParams(window.location.search);
    const body = new URLSearchParams({
      title: scene.title,
      word: scene.word,
      time: '',
      guideline: '',
      privacy: '1',
      useAbility: '1',
      enterTitle: '',
      enterContent: '',
      enterCdMs: '3000',
      priority: String(priority),
      status: '1',
      hideGuideline: '0',
      playAnimation: '1',
      type: scene.type || '0',
    });
    const response = await fetch(`${window.location.pathname.replace(/\/$/, '')}/add?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
    return payload;
  }

  function refreshList() {
    const refresh = Array.from(document.querySelectorAll('button, a')).find(element =>
      /刷新/.test(element.getAttribute('title') || '') || element.textContent.trim() === '刷新'
    );
    if (refresh) refresh.click();
    else window.location.reload();
  }

  function openModal() {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-scene-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量添加回合';
    const note = document.createElement('p');
    note.textContent = '每行一个回合标题。最后一行可写“标题 | 自定义按钮文字”；其他回合会自动把下一行标题作为按钮文字。不会创建任何动作或事件。';
    const defaults = document.createElement('div');
    defaults.className = 'batch-scene-defaults';
    defaults.textContent = '默认配置：允许私聊、使用技能、是否生效、播放转场特效均为“是”；隐藏规则为“否”；默认类型为“读本”；标题包含“搜证”的回合自动选择“搜证”；进入回合按钮等待时长为 3000 毫秒。回合会严格按输入的从上到下顺序创建。';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n第一幕\n自我介绍\n一轮搜证\n一幕圆桌 | 开始投票';
    const preview = document.createElement('div');
    preview.className = 'batch-scene-preview';
    const status = document.createElement('div');
    status.className = 'batch-scene-status';
    const actions = document.createElement('div');
    actions.className = 'batch-scene-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 个回合';

    const updatePreview = () => {
      try {
        const scenes = parseScenes(textarea.value);
        preview.classList.remove('batch-scene-error');
        preview.textContent = scenes.length
          ? `将创建 ${scenes.length} 个回合：\n${scenes.map((scene, index) => `${index + 1}. ${scene.title}${index === scenes.length - 1 && scene.customWord ? ` → ${scene.customWord}` : ''}`).join('\n')}`
          : '请输入至少一个回合标题。';
        confirm.textContent = `确认创建 ${scenes.length} 个回合`;
        return scenes;
      } catch (error) {
        preview.classList.add('batch-scene-error');
        preview.textContent = error.message;
        confirm.textContent = '确认创建 0 个回合';
        return null;
      }
    };

    textarea.addEventListener('input', updatePreview);
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') refreshList();
        else closeModal();
        return;
      }
      const scenes = updatePreview();
      if (!scenes?.length) return;

      // 只有用户确认后才会向后台写入；后台列表按创建顺序展示，因此必须按输入顺序提交。
      confirm.disabled = true;
      cancel.disabled = true;
      textarea.disabled = true;
      let completed = 0;
      let skipped = 0;
      const failures = [];
      try {
        const existing = await getExistingScenes();
        const total = scenes.length;
        for (let index = 0; index < total; index += 1) {
          const item = scenes[index];
          if (existing.titles.has(item.title)) {
            skipped += 1;
            continue;
          }
          const word = index === total - 1 ? item.customWord : scenes[index + 1].title;
          const type = item.title.includes('搜证') ? '1' : '0';
          status.textContent = `正在创建 ${completed + skipped + 1}/${total}：${item.title}${type === '1' ? '（搜证）' : ''}`;
          try {
            await createScene({ title: item.title, word, type }, existing.maxPriority + (total - index) * 10);
            existing.titles.add(item.title);
            completed += 1;
          } catch (error) {
            failures.push(`${item.title}：${error.message || '创建失败'}`);
          }
        }
      } catch (error) {
        failures.push(error.message || '批量创建初始化失败');
      }
      status.textContent = `回合：已创建 ${completed} 个，跳过同名 ${skipped} 个。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });

    actions.append(cancel, confirm);
    panel.append(heading, note, defaults, textarea, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    textarea.focus();
    updatePreview();
  }

  function addBatchButton() {
    if (!isSceneListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量添加回合';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();

// 勾选回合批量创建标准“所有角色进入回合”动作。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-round-action-button';
  const MODAL_ID = 'batch-round-action-modal';

  function isSceneListPage() {
    return /\/modules\/drama\/scene\/?$/.test(window.location.pathname);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === '添加'
    ) || null;
  }

  function getSceneTable() {
    // bootstrap-table 会额外生成一个空的固定表头副本，必须优先取真正的数据表。
    return document.querySelector('#bootstrap-table') || document.querySelector('.bootstrap-table table');
  }

  function getHeaderIndex(table, label) {
    const headers = Array.from(table?.querySelectorAll('thead tr:last-child th') || []);
    const normalized = label.replace(/\s+/g, '');
    return headers.findIndex(header => header.textContent.replace(/\s+/g, '').includes(normalized));
  }

  function getSceneId(row) {
    const action = Array.from(row.querySelectorAll('a,button')).find(element =>
      /editExt3Tab/.test(element.getAttribute('onclick') || '')
    );
    return action?.getAttribute('onclick')?.match(/editExt3Tab\(['"]?(\d+)/)?.[1] || '';
  }

  function getSelectedScenes() {
    const table = getSceneTable();
    if (!table) return [];
    const titleIndex = getHeaderIndex(table, '标题');
    const wordIndex = getHeaderIndex(table, '按钮文字');
    return Array.from(table.querySelectorAll('tbody tr')).filter(row =>
      // 不依赖后台表格给复选框设置的 name；不同版本页面的 name 不一致。
      row.querySelector('input[type="checkbox"]:checked')
    ).map(row => ({
      id: getSceneId(row),
      title: titleIndex >= 0 ? row.cells[titleIndex]?.textContent.trim() : '',
      word: wordIndex >= 0 ? row.cells[wordIndex]?.textContent.trim() : '',
    })).filter(scene => scene.id);
  }

  async function getSceneCatalog() {
    const query = new URLSearchParams(window.location.search);
    const body = new URLSearchParams({
      pageNum: '1',
      pageSize: '1000',
    });
    const response = await fetch(`${window.location.pathname.replace(/\/$/, '')}/list?${query.toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.rows)) {
      throw new Error(`读取回合目录失败：${payload.msg || `HTTP ${response.status}`}`);
    }
    return payload.rows.map(row => ({
      id: String(row.id || '').trim(),
      title: String(row.title || '').trim(),
      word: String(row.word || '').trim(),
    })).filter(row => row.id && row.title);
  }

  async function getVotePackCatalog(sceneId) {
    const query = new URLSearchParams(window.location.search);
    query.set('relateType', '3');
    query.set('relateId', sceneId);
    const response = await fetch(`/modules/drama/action/add?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取投票组目录失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    // 后台动作类型 49 为“开启投票组”，对应的投票组参数字段为 paramA。
    const select = doc.querySelector('#paramA_49')
      || doc.querySelector('#action_49 select[name="paramA"]');
    if (!select) throw new Error('动作表单中没有找到“开启投票组”的投票组列表');
    return Array.from(select.options).map(option => ({
      id: String(option.value || '').trim(),
      name: String(option.textContent || '').trim(),
    })).filter(item => item.id && item.name);
  }

  async function getExistingActions(sceneId) {
    const query = new URLSearchParams(window.location.search);
    query.set('relateType', '3');
    query.set('relateId', sceneId);
    const body = new URLSearchParams({
      pageNum: '1',
      pageSize: '1000',
    });
    const response = await fetch(`/modules/drama/action/list?${query.toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.rows)) {
      throw new Error(`读取回合“${sceneId}”动作列表失败：${payload.msg || `HTTP ${response.status}`}`);
    }
    return payload.rows;
  }

  async function createRoundAction(sceneId, targetRoundId, name) {
    const query = new URLSearchParams(window.location.search);
    query.set('relateType', '3');
    query.set('relateId', sceneId);
    const body = new URLSearchParams({
      name,
      cate: '11',
      paramA: targetRoundId,
      errorNext: '0',
      break: '0',
      delay: '0',
      preCondition: '0',
      priority: '0',
      description: '所有角色进入回合',
    });
    const response = await fetch(`/modules/drama/action/add?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `HTTP ${response.status}`);
    return payload;
  }

  async function createVotePackAction(sceneId, votePackId, name) {
    const query = new URLSearchParams(window.location.search);
    query.set('relateType', '3');
    query.set('relateId', sceneId);
    const body = new URLSearchParams({
      name,
      cate: '49',
      paramA: votePackId,
      errorNext: '0',
      break: '0',
      delay: '0',
      preCondition: '0',
      priority: '0',
      description: '开启投票组',
    });
    const response = await fetch(`/modules/drama/action/add?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `HTTP ${response.status}`);
    return payload;
  }

  function addStyles() {
    if (document.getElementById('batch-round-action-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-round-action-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-round-action-panel { width: min(720px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.65; }
      #${MODAL_ID} .batch-round-action-preview, #${MODAL_ID} .batch-round-action-status { margin-top: 12px; padding: 10px 12px; color: #337ab7; white-space: pre-line; line-height: 1.7; background: #f5f9fd; border-radius: 4px; }
      #${MODAL_ID} .batch-round-action-error { color: #a94442; background: #fdf0f0; }
      #${MODAL_ID} .batch-round-action-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function openModal() {
    closeModal();
    addStyles();
    const selected = getSelectedScenes();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-round-action-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量创建标准回合动作';
    const note = document.createElement('p');
    note.textContent = '仅处理当前勾选的回合。普通按钮创建“所有角色进入回合”动作；按钮文字包含“投票”时创建“开启投票组”动作，并自动匹配同名投票组。不会创建重复动作。';
    const preview = document.createElement('div');
    preview.className = 'batch-round-action-preview';
    const status = document.createElement('div');
    status.className = 'batch-round-action-status';
    const actions = document.createElement('div');
    actions.className = 'batch-round-action-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = `确认创建 ${selected.length} 个动作`;

    if (!selected.length) {
      preview.classList.add('batch-round-action-error');
      preview.textContent = '请先在回合列表中勾选至少一个回合。';
      confirm.disabled = true;
    } else {
      preview.textContent = `已勾选 ${selected.length} 个回合：\n${selected.map((scene, index) => `${index + 1}. ${scene.title} → ${scene.word || '未设置按钮文字'}`).join('\n')}`;
    }

    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        closeModal();
        return;
      }
      if (!selected.length) return;
      confirm.disabled = true;
      cancel.disabled = true;
      let created = 0;
      let skipped = 0;
      const failures = [];
      try {
        const catalog = await getSceneCatalog();
        const byTitle = new Map(catalog.map(scene => [scene.title, scene]));
        let votePacksByName = null;
        for (let index = 0; index < selected.length; index += 1) {
          const scene = selected[index];
          status.textContent = `正在处理 ${index + 1}/${selected.length}：${scene.title}`;
          if (!scene.word) {
            failures.push(`${scene.title}：没有按钮文字，无法确定目标回合`);
            continue;
          }
          try {
            const existing = await getExistingActions(scene.id);
            const isVoteButton = scene.word.includes('投票');
            if (isVoteButton) {
              if (!votePacksByName) {
                const votePacks = await getVotePackCatalog(scene.id);
                votePacksByName = new Map(votePacks.map(pack => [pack.name, pack]));
              }
              const votePack = votePacksByName.get(scene.word);
              if (!votePack) {
                failures.push(`${scene.title}：按钮文字“${scene.word}”没有匹配到同名投票组`);
                continue;
              }
              const duplicate = existing.some(action =>
                String(action.cate) === '49'
                && String(action.paramA) === votePack.id
                && String(action.name || '').trim() === scene.word
              );
              if (duplicate) {
                skipped += 1;
                continue;
              }
              await createVotePackAction(scene.id, votePack.id, scene.word);
              created += 1;
              continue;
            }
            const target = byTitle.get(scene.word);
            if (!target) {
              failures.push(`${scene.title}：按钮文字“${scene.word}”没有匹配到回合`);
              continue;
            }
            const duplicate = existing.some(action =>
              String(action.cate) === '11'
              && String(action.paramA) === target.id
              && String(action.name || '').trim() === scene.word
            );
            if (duplicate) {
              skipped += 1;
              continue;
            }
            await createRoundAction(scene.id, target.id, scene.word);
            created += 1;
          } catch (error) {
            failures.push(`${scene.title}：${error.message || '创建失败'}`);
          }
        }
      } catch (error) {
        failures.push(error.message || '批量处理初始化失败');
      }
      status.textContent = `已创建 ${created} 个，跳过重复 ${skipped} 个。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = '关闭';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
  }

  function addBatchButton() {
    if (!isSceneListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-danger';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量创建回合动作';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();

// 勾选回合批量创建“所有角色都点击了主按钮”标准事件，并关联第一个动作。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-round-event-button';
  const ACTION_BUTTON_ATTRIBUTE = 'data-batch-round-action-button';
  const MODAL_ID = 'batch-round-event-modal';
  const STANDARD_EVENT_NAME = '所有角色都点击了主按钮';

  function isSceneListPage() {
    return /\/modules\/drama\/scene\/?$/.test(window.location.pathname);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn, a.btn, button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === '添加'
    ) || null;
  }

  function getSceneTable() {
    return document.querySelector('#bootstrap-table') || document.querySelector('.bootstrap-table table');
  }

  function getHeaderIndex(table, label) {
    const headers = Array.from(table?.querySelectorAll('thead tr:last-child th') || []);
    const normalized = label.replace(/\s+/g, '');
    return headers.findIndex(header => header.textContent.replace(/\s+/g, '').includes(normalized));
  }

  function getSceneId(row) {
    const action = Array.from(row.querySelectorAll('a,button')).find(element =>
      /editExt(?:1|3)Tab/.test(element.getAttribute('onclick') || '')
    );
    return action?.getAttribute('onclick')?.match(/editExt(?:1|3)Tab\(['"]?(\d+)/)?.[1] || '';
  }

  function getSelectedScenes() {
    const table = getSceneTable();
    if (!table) return [];
    const titleIndex = getHeaderIndex(table, '标题');
    return Array.from(table.querySelectorAll('tbody tr')).filter(row =>
      row.querySelector('input[type="checkbox"]:checked')
    ).map(row => ({
      id: getSceneId(row),
      title: titleIndex >= 0 ? row.cells[titleIndex]?.textContent.trim() : '',
    })).filter(scene => scene.id);
  }

  function makeListRequestBody() {
    return new URLSearchParams({ pageNum: '1', pageSize: '1000' });
  }

  function makeRelatedQuery(sceneId) {
    const query = new URLSearchParams(window.location.search);
    query.set('relateType', '3');
    query.set('relateId', sceneId);
    return query;
  }

  async function fetchRows(path, sceneId, label) {
    const response = await fetch(`${path}?${makeRelatedQuery(sceneId).toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: makeListRequestBody().toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.rows)) {
      throw new Error(`读取${label}失败：${payload.msg || `HTTP ${response.status}`}`);
    }
    return payload.rows;
  }

  function getExistingActions(sceneId) {
    return fetchRows('/modules/drama/action/list', sceneId, '动作列表');
  }

  function getExistingEvents(sceneId) {
    return fetchRows('/modules/drama/event/list', sceneId, '事件列表');
  }

  function isDuplicateEvent(event, action) {
    const cate = String(event.eventCate ?? event.cate ?? '').trim();
    const cateName = String(event.eventCateName || '').trim();
    if (cate !== '7' && cateName !== STANDARD_EVENT_NAME) return false;
    const actionId = String(action.id || '').trim();
    const actionName = String(action.name || '').trim();
    const values = [
      event.triggerAction,
      event.triggerActionId,
      event.actionId,
      event.triggerActionName,
    ].flatMap(value => Array.isArray(value) ? value : [value]).map(value => String(value ?? '').trim());
    return values.some(value => value === actionId || (actionName && value === actionName));
  }

  async function createRoundEvent(sceneId, actionId) {
    const body = new URLSearchParams({
      eventCate: '7',
      triggerCondition: '0',
      triggerAction: String(actionId),
    });
    const response = await fetch(`/modules/drama/event/add?${makeRelatedQuery(sceneId).toString()}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
    return payload;
  }

  function addStyles() {
    if (document.getElementById('batch-round-event-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-round-event-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-round-event-panel { width: min(760px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.65; }
      #${MODAL_ID} .batch-round-event-preview, #${MODAL_ID} .batch-round-event-status { margin-top: 12px; padding: 10px 12px; color: #337ab7; white-space: pre-line; line-height: 1.7; background: #f5f9fd; border-radius: 4px; }
      #${MODAL_ID} .batch-round-event-error { color: #a94442; background: #fdf0f0; }
      #${MODAL_ID} .batch-round-event-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function prepareTargets(selected, preview) {
    const prepared = [];
    for (let index = 0; index < selected.length; index += 1) {
      const scene = selected[index];
      preview.textContent = `正在读取 ${index + 1}/${selected.length}：${scene.title}`;
      try {
        const [actions, events] = await Promise.all([
          getExistingActions(scene.id),
          getExistingEvents(scene.id),
        ]);
        const firstAction = actions[0];
        if (!firstAction?.id) {
          prepared.push({ scene, state: 'missing', message: '没有可关联的动作' });
          continue;
        }
        const duplicate = events.some(event => isDuplicateEvent(event, firstAction));
        prepared.push({
          scene,
          action: firstAction,
          state: duplicate ? 'duplicate' : 'ready',
          message: duplicate ? '已存在，跳过' : '',
        });
      } catch (error) {
        prepared.push({ scene, state: 'error', message: error.message || '读取失败' });
      }
    }
    return prepared;
  }

  async function openModal() {
    closeModal();
    addStyles();
    const selected = getSelectedScenes();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-round-event-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量创建标准回合事件';
    const note = document.createElement('p');
    note.textContent = `仅处理当前勾选的回合。事件类型固定为“${STANDARD_EVENT_NAME}”，条件为“无”，并自动关联每个回合动作列表中的第一个动作。`;
    const preview = document.createElement('div');
    preview.className = 'batch-round-event-preview';
    const status = document.createElement('div');
    status.className = 'batch-round-event-status';
    const actions = document.createElement('div');
    actions.className = 'batch-round-event-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-success';
    confirm.disabled = true;
    confirm.textContent = '正在读取动作…';
    cancel.addEventListener('click', closeModal);
    actions.append(cancel, confirm);
    panel.append(heading, note, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);

    if (!selected.length) {
      preview.classList.add('batch-round-event-error');
      preview.textContent = '请先在回合列表中勾选至少一个回合。';
      confirm.textContent = '确认创建 0 个事件';
      return;
    }

    const prepared = await prepareTargets(selected, preview);
    if (!document.getElementById(MODAL_ID)) return;
    const ready = prepared.filter(item => item.state === 'ready');
    preview.textContent = `已勾选 ${selected.length} 个回合：\n${prepared.map((item, index) => {
      const actionName = item.action?.name || item.action?.id || item.message;
      const suffix = item.state === 'ready' ? '' : `（${item.message}）`;
      return `${index + 1}. ${item.scene.title} → ${actionName}${suffix}`;
    }).join('\n')}`;
    if (!ready.length) preview.classList.add('batch-round-event-error');
    confirm.textContent = `确认创建 ${ready.length} 个事件`;
    confirm.disabled = ready.length === 0;

    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        closeModal();
        return;
      }
      confirm.disabled = true;
      cancel.disabled = true;
      let created = 0;
      const failures = [];
      for (let index = 0; index < ready.length; index += 1) {
        const item = ready[index];
        status.textContent = `正在创建 ${index + 1}/${ready.length}：${item.scene.title} → ${item.action.name || item.action.id}`;
        try {
          await createRoundEvent(item.scene.id, item.action.id);
          created += 1;
        } catch (error) {
          failures.push(`${item.scene.title}：${error.message || '创建失败'}`);
        }
      }
      const skipped = prepared.filter(item => item.state === 'duplicate').length;
      const missing = prepared.filter(item => item.state === 'missing').length;
      const readFailures = prepared.filter(item => item.state === 'error').map(item => `${item.scene.title}：${item.message}`);
      failures.unshift(...readFailures);
      status.textContent = `已创建 ${created} 个，跳过重复 ${skipped} 个，无动作 ${missing} 个。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = '关闭';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
    });
  }

  function addBatchEventButton() {
    if (!isSceneListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const anchor = document.querySelector(`[${ACTION_BUTTON_ATTRIBUTE}]`) || getAddButton();
    if (!anchor) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量创建回合事件';
    button.addEventListener('click', openModal);
    anchor.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchEventButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchEventButton();
})();

// 投票选项批量配图：按表格行顺序将所选图片上传并保存到已有选项。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-vote-image-button';
  const MODAL_ID = 'batch-vote-image-modal';

  function isVoteOptionPage() {
    return /\/modules\/drama\/vote_option(?:\/|$)/.test(window.location.pathname);
  }

  function getToolbar() {
    return document.querySelector('#toolbar');
  }

  function getVisibleOptions() {
    const table = document.querySelector('#bootstrap-table');
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead tr:last-child th'));
    const titleIndex = headers.findIndex(header => header.textContent.replace(/\s+/g, '').includes('投票选项'));
    return Array.from(table.querySelectorAll('tbody tr')).map(row => {
      const edit = Array.from(row.querySelectorAll('a[onclick*="operate.edit"]')).find(Boolean);
      const id = edit?.getAttribute('onclick')?.match(/operate\.edit\(['"](\d+)['"]\)/)?.[1];
      if (!id) return null;
      return {
        id,
        title: row.cells[titleIndex]?.textContent.trim() || `选项 ${id}`,
        checked: Boolean(row.querySelector('input[type="checkbox"]:checked')),
      };
    }).filter(Boolean);
  }

  function getTargets() {
    const options = getVisibleOptions();
    const selected = options.filter(option => option.checked);
    return selected.length ? selected : options;
  }

  function addStyles() {
    if (document.getElementById('batch-vote-image-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-vote-image-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-image-panel { width: min(700px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} .batch-image-list { margin-top: 14px; max-height: 300px; overflow: auto; border: 1px solid #ddd; }
      #${MODAL_ID} .batch-image-row { display: grid; grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr); gap: 8px; padding: 8px 10px; border-bottom: 1px solid #eee; }
      #${MODAL_ID} .batch-image-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .batch-image-target { font-weight: 600; word-break: break-all; }
      #${MODAL_ID} .batch-image-file { color: #337ab7; word-break: break-all; }
      #${MODAL_ID} .batch-image-status { margin-top: 10px; color: #337ab7; white-space: pre-line; }
      #${MODAL_ID} .batch-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function refreshList() {
    const refresh = Array.from(document.querySelectorAll('button, a')).find(element =>
      /刷新/.test(element.getAttribute('title') || '') || element.textContent.trim() === '刷新'
    );
    if (refresh) refresh.click();
    else window.location.reload();
  }

  async function loadOptionFields(optionId) {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/vote_option/edit/${optionId}?${query.toString()}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取选项失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = doc.querySelector('form');
    if (!form) throw new Error('未找到选项编辑表单');
    const fields = new URLSearchParams();
    Array.from(form.elements).forEach(element => {
      if (!element.name || element.name === 'file' || element.name === 'image') return;
      if ((element.type === 'checkbox' || element.type === 'radio') && !element.checked) return;
      if (element.tagName === 'SELECT') {
        Array.from(element.selectedOptions).forEach(option => fields.append(element.name, option.value));
        return;
      }
      fields.append(element.name, element.value);
    });
    return fields;
  }

  async function uploadImage(file) {
    const query = new URLSearchParams(window.location.search);
    const body = new FormData();
    body.append('file', file, file.name);
    const response = await fetch(`/drama/upload?${query.toString()}&type=image`, {
      method: 'POST',
      body,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    const url = payload.url || payload.data?.url;
    if (!response.ok || !url) throw new Error(payload.msg || `上传失败：HTTP ${response.status}`);
    return url;
  }

  async function saveImage(optionId, file) {
    const fields = await loadOptionFields(optionId);
    const imageUrl = await uploadImage(file);
    fields.set('image', imageUrl);
    const response = await fetch('/modules/drama/vote_option/edit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: fields.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) throw new Error(payload.msg || `保存失败：HTTP ${response.status}`);
  }

  function openModal() {
    const targets = getTargets();
    if (!targets.length) {
      window.alert('当前页没有可配图的投票选项。');
      return;
    }
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-image-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量上传投票图片';
    const note = document.createElement('p');
    note.textContent = '图片会按顺序对应选项。若先勾选表格行，则只处理已勾选行；未勾选时，从当前页第一项开始处理。图片数量不能超过目标选项数量。';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.className = 'form-control';
    const list = document.createElement('div');
    list.className = 'batch-image-list';
    const status = document.createElement('div');
    status.className = 'batch-image-status';
    const actions = document.createElement('div');
    actions.className = 'batch-image-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认上传 0 张图片';
    let files = [];
    const renderPairs = () => {
      list.replaceChildren();
      if (!files.length) {
        list.textContent = '请选择图片。';
        return;
      }
      files.forEach((file, index) => {
        const row = document.createElement('div');
        row.className = 'batch-image-row';
        const target = document.createElement('span');
        target.className = 'batch-image-target';
        target.textContent = targets[index] ? targets[index].title : '超出目标选项数量';
        const arrow = document.createElement('span');
        arrow.textContent = '→';
        const name = document.createElement('span');
        name.className = 'batch-image-file';
        name.textContent = file.name;
        row.append(target, arrow, name);
        list.appendChild(row);
      });
    };
    picker.addEventListener('change', () => {
      files = Array.from(picker.files || []).filter(file => file.type.startsWith('image/'));
      renderPairs();
      const tooMany = files.length > targets.length;
      confirm.disabled = tooMany || !files.length;
      confirm.textContent = `确认上传 ${files.length} 张图片`;
      status.textContent = tooMany ? `图片数量超过目标选项数量（${targets.length} 个），请减少图片。` : '';
    });
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') refreshList();
        else closeModal();
        return;
      }
      if (!files.length || files.length > targets.length) return;
      // 仅在用户明确点击“确认上传”后，才上传图片并修改选项。
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      let completed = 0;
      const failures = [];
      for (const [index, file] of files.entries()) {
        const target = targets[index];
        status.textContent = `正在上传 ${index + 1}/${files.length}：${target.title} ← ${file.name}`;
        try {
          await saveImage(target.id, file);
          completed += 1;
        } catch (error) {
          failures.push(`${target.title}：${error.message || '上传失败'}`);
        }
      }
      status.textContent = `已完成 ${completed}/${files.length} 张图片。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, picker, list, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
  }

  function addButton() {
    if (!isVoteOptionPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const toolbar = getToolbar();
    if (!toolbar) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量上传图片';
    button.addEventListener('click', openModal);
    toolbar.appendChild(button);
  }

  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();

// 投票选项批量添加：粘贴多行文本后，用户确认才逐条创建“无图片、非正确项”的选项。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-vote-option-button';
  const MODAL_ID = 'batch-vote-option-modal';

  function isVoteOptionPage() {
    return /\/modules\/drama\/vote_option(?:\/|$)/.test(window.location.pathname);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === '添加'
    ) || null;
  }

  function stripDelimitedSequence(item) {
    // 支持：1. xxx、1、xxx、a. xxx、A) xxx，以及序号后的空格。
    return item.replace(/^(?:\d{1,3}|[A-Za-z])(?:[.。、,，:：;；)）\]】>]\s*|[-_]\s*|\s+)/, '').trim();
  }

  function splitHorizontalItems(text) {
    return text.split(/\r?\n/).flatMap(line => {
      const normalizedLine = line.replace(/^\uFEFF/, '').trim();
      if (!normalizedLine) return [];

      // 先按“B、”“C.”等序号边界切开，避免后面的顿号分隔把“A、莫野”拆成“A”和“莫野”。
      const sequenceParts = normalizedLine
        .replace(/((?:\d{1,3}|[A-Za-z])[.。、,，:：;；)）\]】>\-_]\s*)/g, '\n$1')
        .split(/\r?\n/)
        .map(part => part.trim())
        .filter(Boolean);

      return sequenceParts.flatMap(part => {
        const hasSequencePrefix = /^(?:\d{1,3}|[A-Za-z])[.。、,，:：;；)）\]】>\-_]\s*/.test(part);
        if (hasSequencePrefix) return [part];

        const commaParts = part.split(/[，,、；;]/).map(item => item.trim()).filter(Boolean);
        if (commaParts.length > 1) return commaParts;

        // 兼容“1xxx 2xxx”“axxx bxxx”这类没有标点的横排序号。
        const parts = part.split(/\s+/).filter(Boolean);
        const hasBareSequencePrefix = item => /^(?:\d{1,3}|[A-Za-z])\S+$/.test(item);
        return parts.length > 1 && parts.every(hasBareSequencePrefix) ? parts : [part];
      });
    });
  }

  function isSequentialPrefixGroup(items, prefixType) {
    const candidates = items.map(item => item.match(/^([0-9A-Za-z])\S+$/));
    if (candidates.some(match => !match)) return false;
    const prefixes = candidates.map(match => match[1]);
    if (new Set(prefixes.map(prefix => prefix.toLowerCase())).size !== prefixes.length) return false;

    if (prefixType === 'digit' && prefixes.every(prefix => /\d/.test(prefix))) {
      const values = prefixes.map(Number);
      return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
    }

    if (prefixType === 'letter' && prefixes.every(prefix => /[A-Za-z]/.test(prefix))) {
      const values = prefixes.map(prefix => prefix.toLowerCase().charCodeAt(0));
      const suffixes = items.map(item => item.slice(1));
      const hasChineseText = suffixes.every(suffix => /[\u3400-\u9fff]/.test(suffix));
      const hasSameSuffix = new Set(suffixes).size === 1;
      return values.every((value, index) => index === 0 || value === values[index - 1] + 1) && (hasChineseText || hasSameSuffix);
    }

    return false;
  }

  function getItems(text) {
    const rawItems = splitHorizontalItems(text);
    const items = rawItems.map(stripDelimitedSequence);
    const barePrefixTypes = ['digit', 'letter'].filter(prefixType => {
      const barePrefixItems = items.filter(item => prefixType === 'digit'
        ? /^\d\S+$/.test(item)
        : /^[A-Za-z]\S+$/.test(item));
      return barePrefixItems.length > 1 && isSequentialPrefixGroup(barePrefixItems, prefixType);
    });

    return Array.from(new Set(items.map(item => {
      if (!barePrefixTypes.length || !/^([0-9A-Za-z])\S+$/.test(item)) return item;
      const prefix = item[0];
      const isMatchingType = (barePrefixTypes.includes('digit') && /\d/.test(prefix)) ||
        (barePrefixTypes.includes('letter') && /[A-Za-z]/.test(prefix));
      return isMatchingType ? item.slice(1).trim() : item;
    }).filter(Boolean)));
  }

  function addStyles() {
    if (document.getElementById('batch-vote-option-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-vote-option-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-vote-panel { width: min(620px, calc(100vw - 36px)); padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.6; }
      #${MODAL_ID} textarea { width: 100%; min-height: 210px; resize: vertical; padding: 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL_ID} .batch-vote-preview { margin-top: 10px; color: #337ab7; white-space: pre-line; }
      #${MODAL_ID} .batch-vote-role-hint { margin-top: 6px; color: #337ab7; white-space: pre-line; }
      #${MODAL_ID} .batch-vote-status { margin-top: 10px; color: #337ab7; white-space: pre-line; }
      #${MODAL_ID} .batch-vote-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function refreshList() {
    window.location.reload();
  }

  async function loadRoleOptionConfig() {
    const query = new URLSearchParams(window.location.search);
    const formResponse = await fetch(`/modules/drama/vote_option/add?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!formResponse.ok) throw new Error(`读取投票选项配置失败：HTTP ${formResponse.status}`);

    const formDoc = new DOMParser().parseFromString(await formResponse.text(), 'text/html');
    const typeSelect = formDoc.querySelector('select[name="targetType"]');
    const roleTypeOption = Array.from(typeSelect?.options || []).find(option => /角色/.test(option.textContent));
    if (!roleTypeOption) throw new Error('未找到“角色”关联展示实体类型');

    // 后台真正保存关联角色的字段是 targetId；直接读取添加表单可获得当前剧本的准确角色 ID。
    const roleInputs = Array.from(formDoc.querySelectorAll('input[type="checkbox"][name]')).filter(input =>
      /targetId/i.test(input.name) && input.value
    );
    const roleTargetField = roleInputs[0]?.name || 'targetId';
    const roles = roleInputs.map(input => ({
      id: String(input.value).trim(),
      name: String(
        input.closest('.check-box')?.textContent ||
        input.closest('label')?.textContent ||
        input.parentElement?.parentElement?.textContent ||
        ''
      ).replace(/\s+/g, ' ').trim(),
    })).filter(role => role.id && role.name);
    if (!roles.length) throw new Error('添加表单中没有找到可关联的角色');
    return { targetType: roleTypeOption.value, targetField: roleTargetField, roles };
  }

  async function createOption(title, roleSelection) {
    const params = new URLSearchParams(window.location.search);
    const body = new URLSearchParams({
      title,
      isAnswer: '0',
      image: '',
      targetType: roleSelection?.targetType || '0',
    });
    if (roleSelection) {
      if (roleSelection.role) body.append(roleSelection.targetField, roleSelection.role.id);
    } else {
      body.set('targetIdTemp', '');
    }
    const response = await fetch(`/modules/drama/vote_option/add?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
  }

  function openModal() {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-vote-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量添加投票选项';
    const note = document.createElement('p');
    note.textContent = '每行一个投票选项，也支持空格、英文逗号、中文逗号、顿号、中文或英文分号分隔的横排选项。会自动转为竖排并去除 1. xxx、a. xxx、1xxx、axxx 形式的列表序号；空行会忽略，重复行会自动合并。创建后的选项默认：非正确项、无图片、默认关联展示实体类型。';
    const roleModeLabel = document.createElement('label');
    roleModeLabel.style.display = 'block';
    roleModeLabel.style.margin = '12px 0 0';
    roleModeLabel.style.color = '#555';
    const roleMode = document.createElement('input');
    roleMode.type = 'checkbox';
    roleMode.style.marginRight = '6px';
    roleModeLabel.append(roleMode, document.createTextNode('角色类型选项：自动选择与选项同名的角色'));
    const roleHint = document.createElement('div');
    roleHint.className = 'batch-vote-role-hint';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n选项 A\n选项 B\n选项 C';
    const preview = document.createElement('div');
    preview.className = 'batch-vote-preview';
    const status = document.createElement('div');
    status.className = 'batch-vote-status';
    const actions = document.createElement('div');
    actions.className = 'batch-vote-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 个选项';
    let roleConfig = null;
    let roleConfigPromise = null;

    const getRoleSelections = items => items.map(title => ({
      title,
      role: roleConfig?.roles.find(item => item.name === title) || null,
    }));

    const updatePreview = () => {
      const items = getItems(textarea.value);
      if (roleMode.checked && roleConfig) {
        const selections = getRoleSelections(items);
        preview.textContent = selections.length
          ? `将创建 ${selections.length} 个角色类型选项：\n${selections.map((item, index) => `${index + 1}. ${item.title} → ${item.role ? `角色：${item.role.name}` : '未找到同名角色'}`).join('\n')}`
          : '请输入至少一个选项。';
        const missing = selections.filter(item => !item.role).length;
        roleHint.textContent = missing ? `有 ${missing} 个选项未找到同名角色；这些选项不会创建，请检查名称。` : '已找到所有同名角色，确认后会自动勾选关联。';
      } else {
        preview.textContent = items.length ? `将创建 ${items.length} 个选项：\n${items.join('\n')}` : '请输入至少一个选项。';
        roleHint.textContent = roleMode.checked ? '正在读取角色列表……' : '';
      }
      confirm.textContent = `确认创建 ${items.length} 个选项`;
      confirm.disabled = roleMode.checked && !roleConfig;
      return items;
    };
    textarea.addEventListener('input', updatePreview);
    roleMode.addEventListener('change', async () => {
      if (!roleMode.checked) {
        roleConfig = null;
        roleConfigPromise = null;
        updatePreview();
        return;
      }
      updatePreview();
      if (!roleConfigPromise) roleConfigPromise = loadRoleOptionConfig();
      try {
        roleConfig = await roleConfigPromise;
        updatePreview();
      } catch (error) {
        roleConfigPromise = null;
        roleHint.textContent = `读取角色配置失败：${error.message || '未知错误'}`;
        confirm.disabled = true;
      }
    });
    cancel.addEventListener('click', closeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') refreshList();
        else closeModal();
        return;
      }
      const items = updatePreview();
      if (!items.length) return;
      const selections = roleMode.checked
        ? getRoleSelections(items)
        : items.map(title => ({ title, role: null }));
      // 只有用户明确点击“确认创建”后才会写入后台。
      confirm.disabled = true;
      cancel.disabled = true;
      textarea.disabled = true;
      roleMode.disabled = true;
      let completed = 0;
      const failures = [];
      for (let index = 0; index < selections.length; index += 1) {
        const selection = selections[index];
        status.textContent = `正在创建 ${index + 1}/${selections.length}：${selection.title}`;
        if (roleMode.checked && !selection.role) {
          failures.push(`${selection.title}：未找到同名角色，已跳过`);
          continue;
        }
        try {
          await createOption(selection.title, roleMode.checked ? { ...roleConfig, role: selection.role } : null);
          completed += 1;
        } catch (error) {
          failures.push(`${selection.title}：${error.message || '创建失败'}`);
        }
      }
      status.textContent = `已创建 ${completed}/${selections.length} 个选项。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      if (!failures.length && completed > 0) {
        status.textContent += '\n正在刷新列表……';
        window.setTimeout(refreshList, 350);
        return;
      }
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, roleModeLabel, roleHint, textarea, preview, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    textarea.focus();
    updatePreview();
  }

  function addBatchButton() {
    if (!isVoteOptionPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量添加选项';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();

// 投票配置批量添加：粘贴多行投票名称后，按用户指定的固定默认值逐条创建。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-batch-vote-config-button';
  const MODAL_ID = 'batch-vote-config-modal';

  function isVoteConfigPage() {
    return /\/modules\/drama\/drama_vote(?:\/|$)/.test(window.location.pathname);
  }

  function getAddButton() {
    return Array.from(document.querySelectorAll('#toolbar a.btn, #toolbar button.btn')).find(element =>
      element.textContent.replace(/\s+/g, ' ').trim() === '添加'
    ) || null;
  }

  function getTitles(text) {
    return Array.from(new Set(text.split(/\r?\n/).map(item => item.trim()).filter(Boolean)));
  }

  function addStyles() {
    if (document.getElementById('batch-vote-config-style')) return;
    const style = document.createElement('style');
    style.id = 'batch-vote-config-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 2147483647; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .batch-vote-config-panel { width: min(860px, calc(100vw - 36px)); max-height: calc(100vh - 40px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} p { color: #666; line-height: 1.65; }
      #${MODAL_ID} textarea { width: 100%; min-height: 210px; resize: vertical; padding: 10px; border: 1px solid #ccd6e0; border-radius: 4px; line-height: 1.6; }
      #${MODAL_ID} .batch-vote-config-defaults { margin: 12px 0; padding: 10px 12px; border-radius: 4px; color: #31708f; background: #d9edf7; line-height: 1.65; }
      #${MODAL_ID} .batch-vote-config-preview, #${MODAL_ID} .batch-vote-config-status { margin-top: 10px; color: #337ab7; white-space: pre-line; }
      #${MODAL_ID} .batch-vote-config-role-section { margin-top: 14px; }
      #${MODAL_ID} .batch-vote-config-role-title { margin: 0 0 8px; font-size: 16px; color: #333; }
      #${MODAL_ID} .batch-vote-config-role-note { margin: 0 0 10px; color: #666; line-height: 1.6; }
      #${MODAL_ID} .batch-vote-config-role-list { display: grid; gap: 10px; }
      #${MODAL_ID} .batch-vote-config-role-card { padding: 12px; border: 1px solid #dfe6ee; border-radius: 5px; background: #fafcff; }
      #${MODAL_ID} .batch-vote-config-role-card strong { display: block; margin-bottom: 8px; color: #333; }
      #${MODAL_ID} .batch-vote-config-role-options { display: flex; flex-wrap: wrap; gap: 7px 16px; }
      #${MODAL_ID} .batch-vote-config-role-option { display: inline-flex; align-items: center; gap: 5px; margin: 0; color: #555; font-weight: normal; }
      #${MODAL_ID} .batch-vote-config-role-option input { margin: 0; }
      #${MODAL_ID} .batch-vote-config-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function refreshList() {
    const refresh = Array.from(document.querySelectorAll('button, a')).find(element =>
      /刷新/.test(element.getAttribute('title') || '') || element.textContent.trim() === '刷新'
    );
    if (refresh) refresh.click();
    else window.location.reload();
  }

  // 标题以“（多选）”“(多选)”或“多选”收尾时，保留标题原文但应用多选配置。
  function isMultipleChoiceTitle(title) {
    return /(?:[（(]\s*多选\s*[）)]|多选)\s*$/.test(title);
  }

  function getVoteSettings(title, config) {
    if (!isMultipleChoiceTitle(title)) {
      return { defaultScore: '1', type: '0', scoreStrategy: '0', label: '单选｜独立计分｜1分' };
    }
    if (!config.multiType || !config.multiScoreStrategy) {
      throw new Error('未在投票配置页找到“多选”或“多选全匹配”配置');
    }
    return {
      defaultScore: '2',
      type: config.multiType,
      scoreStrategy: config.multiScoreStrategy,
      label: '多选｜多选全匹配｜2分',
    };
  }

  async function loadVoteRoleConfig() {
    const query = new URLSearchParams(window.location.search);
    const response = await fetch(`/modules/drama/drama_vote/add?${query.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`读取投票配置失败：HTTP ${response.status}`);

    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const group = Array.from(doc.querySelectorAll('.form-group, .form-group-sm, .row, div')).find(element => {
      const content = (element.textContent || '').replace(/\s+/g, ' ').trim();
      return /公共\s*\/\s*角色|公共角色/.test(content) &&
        element.querySelector('input[type="checkbox"][name]');
    });
    const inputs = Array.from(group?.querySelectorAll('input[type="checkbox"][name]') || []);
    const roles = inputs.map(input => {
      const option = input.closest('label, .check-box, .checkbox') || input.parentElement;
      return {
        field: input.name,
        value: String(input.value || '').trim(),
        name: (option?.textContent || '').replace(/\s+/g, ' ').trim(),
      };
    }).filter(item => item.field && item.value && item.name);
    if (!roles.length) throw new Error('投票配置页未找到“公共/角色”勾选项');

    const getOptionValue = (fieldName, optionText) => Array.from(doc.querySelectorAll(`select[name="${fieldName}"] option`))
      .find(option => option.textContent.replace(/\s+/g, '').includes(optionText))?.value || '';
    return {
      roles,
      multiType: getOptionValue('type', '多选'),
      multiScoreStrategy: getOptionValue('scoreStrategy', '多选全匹配'),
    };
  }

  async function createVote(title, roleSelections = [], settings) {
    const query = new URLSearchParams(window.location.search);
    // 与后台“添加投票配置”表单一致：红框中的项目采用固定值，其余字段保持空/默认。
    const body = new URLSearchParams({
      title,
      style: '1',                 // 带图
      showResult: '1',            // 展示问题结果：是
      resultTitle: '',
      defaultScore: settings.defaultScore,
      type: settings.type,
      scoreStrategy: settings.scoreStrategy,
      showDetail: '1',
      backgroundHit: '',
      backgroundNotHit: '',
      note: '',
      cFilterCondition: '0',
      isKeyVote: '0',
      priority: '0',
    });
    roleSelections.forEach(item => body.append(item.field, item.value));
    const response = await fetch(`/modules/drama/drama_vote/add?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || Number(payload.code) !== 0) {
      throw new Error(payload.msg || `HTTP ${response.status}`);
    }
  }

  function openModal() {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'batch-vote-config-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量添加投票';
    const note = document.createElement('p');
    note.textContent = '先输入投票名称，再为每个投票勾选“公共/角色”关联，最后一次性提交。标题末尾标注“（多选）”或“多选”时，将自动创建多选题。空行会忽略，重复名称会自动合并。';
    const defaults = document.createElement('div');
    defaults.className = 'batch-vote-config-defaults';
    defaults.textContent = '默认配置：展示样式“带图”、展示问题结果“是”。普通题：1分、单选、独立计分；标题末尾标“（多选）”的题目：2分、多选、多选全匹配。可在下一步按投票设置“公共/角色”关联；配图、投票动作、说明、筛选条件等其余配置均不填写。';
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n一号客人的癖好为？\n二号客人的癖好为？\n三号客人的癖好为？';
    const preview = document.createElement('div');
    preview.className = 'batch-vote-config-preview';
    const roleSection = document.createElement('section');
    roleSection.className = 'batch-vote-config-role-section';
    roleSection.hidden = true;
    const roleTitle = document.createElement('h4');
    roleTitle.className = 'batch-vote-config-role-title';
    roleTitle.textContent = '设置每个投票的公共/角色关联';
    const roleNote = document.createElement('p');
    roleNote.className = 'batch-vote-config-role-note';
    roleNote.textContent = '不勾选则保持不关联。每个投票可独立勾选公共角色或指定角色。';
    const roleList = document.createElement('div');
    roleList.className = 'batch-vote-config-role-list';
    roleSection.append(roleTitle, roleNote, roleList);
    const status = document.createElement('div');
    status.className = 'batch-vote-config-status';
    const actions = document.createElement('div');
    actions.className = 'batch-vote-config-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '下一步：设置角色关联';
    let titlesForSubmit = [];
    let voteConfig = { roles: [], multiType: '', multiScoreStrategy: '' };
    let isRoleStep = false;
    const updatePreview = () => {
      const titles = getTitles(textarea.value);
      preview.textContent = titles.length
        ? `将创建 ${titles.length} 个投票：\n${titles.map(title => `${title}（${isMultipleChoiceTitle(title) ? '多选｜2分｜多选全匹配' : '单选｜1分｜独立计分'}）`).join('\n')}`
        : '请输入至少一个投票名称。';
      if (!isRoleStep) confirm.textContent = '下一步：设置角色关联';
      return titles;
    };
    textarea.addEventListener('input', updatePreview);
    cancel.addEventListener('click', closeModal);

    const getSelections = title => Array.from(roleList.querySelectorAll('input[data-vote-title]:checked'))
      .filter(input => input.dataset.voteTitle === title)
      .map(input => ({
        field: input.dataset.field,
        value: input.value,
      }));

    const renderRoleSelections = () => {
      roleList.replaceChildren();
      titlesForSubmit.forEach(title => {
        const card = document.createElement('div');
        card.className = 'batch-vote-config-role-card';
        const name = document.createElement('strong');
        name.textContent = title;
        const options = document.createElement('div');
        options.className = 'batch-vote-config-role-options';
        const settings = getVoteSettings(title, voteConfig);
        name.textContent = `${title}（${settings.label}）`;
        voteConfig.roles.forEach(role => {
          const label = document.createElement('label');
          label.className = 'batch-vote-config-role-option';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = role.value;
          input.dataset.field = role.field;
          input.dataset.voteTitle = title;
          const text = document.createElement('span');
          text.textContent = role.name;
          label.append(input, text);
          options.appendChild(label);
        });
        card.append(name, options);
        roleList.appendChild(card);
      });
    };

    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') refreshList();
        else closeModal();
        return;
      }
      if (!isRoleStep) {
        const titles = updatePreview();
        if (!titles.length) return;
        confirm.disabled = true;
        cancel.disabled = true;
        status.textContent = '正在读取投票配置中的角色列表……';
        try {
          voteConfig = await loadVoteRoleConfig();
          if (titles.some(isMultipleChoiceTitle)) getVoteSettings(titles.find(isMultipleChoiceTitle), voteConfig);
          titlesForSubmit = titles;
          isRoleStep = true;
          textarea.disabled = true;
          roleSection.hidden = false;
          renderRoleSelections();
          preview.textContent = `已导入 ${titles.length} 个投票名称，请分别设置角色关联后确认提交。`;
          status.textContent = '';
          confirm.textContent = `确认创建 ${titles.length} 个投票`;
        } catch (error) {
          status.textContent = `读取角色关联配置失败：${error.message || '未知错误'}`;
        } finally {
          confirm.disabled = false;
          cancel.disabled = false;
        }
        return;
      }
      // 仅在用户确认角色关联后，才逐条写入后台。
      confirm.disabled = true;
      cancel.disabled = true;
      roleSection.querySelectorAll('input').forEach(input => { input.disabled = true; });
      let completed = 0;
      const failures = [];
      for (let index = 0; index < titlesForSubmit.length; index += 1) {
        const title = titlesForSubmit[index];
        status.textContent = `正在创建 ${index + 1}/${titlesForSubmit.length}：${title}`;
        try {
          await createVote(title, getSelections(title), getVoteSettings(title, voteConfig));
          completed += 1;
        } catch (error) {
          failures.push(`${title}：${error.message || '创建失败'}`);
        }
      }
      status.textContent = `已创建 ${completed}/${titlesForSubmit.length} 个投票。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, defaults, textarea, preview, roleSection, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) closeModal(); });
    document.body.appendChild(modal);
    textarea.focus();
    updatePreview();
  }

  function addBatchButton() {
    if (!isVoteConfigPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const addButton = getAddButton();
    if (!addButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量添加投票';
    button.addEventListener('click', openModal);
    addButton.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addBatchButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addBatchButton();
})();
