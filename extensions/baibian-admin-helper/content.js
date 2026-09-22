(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-copy-condition-button';
  const ID_HEADER_ATTRIBUTE = 'data-bb-condition-id-header';
  const ID_CELL_ATTRIBUTE = 'data-bb-condition-id-cell';
  const STYLE_ID = 'copy-condition-style';
  const PENDING_COPY_HASH_KEY = 'bb-condition-copy';
  const PENDING_COPY_WINDOW_PREFIX = '__bb_condition_copy__=';
  const PENDING_COPY_STORAGE_KEY = 'bb-condition-copy-pending-v2';
  let updateTimer = null;

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] {
        margin-left: 6px;
        color: #fff !important;
        background: #f39c12 !important;
        border-color: #e08e0b !important;
      }
      a[${BUTTON_ATTRIBUTE}].copy-condition-done {
        background: #00a65a !important;
        border-color: #008d4c !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getCreateForm() {
    return Array.from(document.querySelectorAll('form')).find(form =>
      form.method.toLowerCase() === 'post' && form.querySelector('[name="name"]') && form.querySelector('[name="cate"]')
    ) || null;
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/conditions/create"]')).find(link =>
      /添加条件/.test(normalizeText(link.textContent))
    ) || null;
  }

  function getEditUrl(row) {
    return row.querySelector('a[href*="/conditions/"][href*="/edit"]')?.href || null;
  }

  function getConditionId(row) {
    const link = row.querySelector('a[href*="/conditions/"][href*="/edit"], a[href*="/conditions/"]:not([href*="/create"])');
    const match = link?.href?.match(/\/conditions\/(\d+)(?:\/edit)?(?:[?#]|$)/);
    return match?.[1] || '';
  }

  function updateIdColumns() {
    document.querySelectorAll('table').forEach(table => {
      const rows = Array.from(table.querySelectorAll('tbody tr')).filter(row => getConditionId(row));
      if (!rows.length) return;

      const headerRow = table.querySelector('thead tr:last-child');
      if (headerRow && !headerRow.querySelector(`[${ID_HEADER_ATTRIBUTE}]`)) {
        const header = document.createElement('th');
        header.setAttribute(ID_HEADER_ATTRIBUTE, 'true');
        header.textContent = 'ID';
        header.style.cssText = 'width:90px;min-width:90px;';
        headerRow.insertBefore(header, headerRow.firstElementChild);
      }

      rows.forEach(row => {
        if (row.querySelector(`[${ID_CELL_ATTRIBUTE}]`)) return;
        const cell = document.createElement('td');
        cell.setAttribute(ID_CELL_ATTRIBUTE, 'true');
        cell.textContent = getConditionId(row);
        cell.style.cssText = 'width:90px;min-width:90px;white-space:nowrap;';
        row.insertBefore(cell, row.firstElementChild);
      });
    });
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function getCopyContext() {
    const url = new URL(window.location.href);
    // 回合条件在 /conditions 列表内嵌创建；全局条件会跳到 /conditions/create。
    // 两种地址都必须认作同一个待复制上下文，才能在新建页取回缓存的数据。
    const conditionPath = url.pathname.replace(/\/conditions\/create$/, '/conditions');
    const entries = Array.from(url.searchParams.entries())
      .filter(([key]) => key !== 'cate')
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
      );
    return `${url.origin}${conditionPath}?${new URLSearchParams(entries).toString()}`;
  }

  function getPendingStorageKey() {
    return `${PENDING_COPY_STORAGE_KEY}:${getCopyContext()}`;
  }

  function isValidPendingCopy(pending) {
    return Boolean(
      pending && pending.context === getCopyContext() && Date.now() - pending.createdAt <= 5 * 60 * 1000
    );
  }

  async function savePendingCopy(fields, cate) {
    const pending = {
      context: getCopyContext(),
      cate: String(cate),
      fields,
      createdAt: Date.now(),
      previousWindowName: window.name,
    };
    // 部分条件类型会由后台重定向到规范 URL，重定向可能丢掉 hash。
    // window.name 在同一个标签页的跨页面跳转中会保留，用作可靠备用通道。
    window.name = `${PENDING_COPY_WINDOW_PREFIX}${encodeURIComponent(JSON.stringify(pending))}`;
    // 扩展自身的存储不受后台页面重定向影响；保存完成后才允许跳转。
    try {
      await chrome.storage.local.set({ [getPendingStorageKey()]: pending });
    } catch (error) {
      console.warn('[百变后台复制条件] 扩展存储不可用，改用地址备用数据', error);
    }
    return pending;
  }

  function parsePendingCopy(raw) {
    try {
      if (!raw) return null;
      const pending = JSON.parse(decodeURIComponent(raw));
      return isValidPendingCopy(pending) ? pending : null;
    } catch (_) {
      return null;
    }
  }

  async function getPendingCopy() {
    const hashMatch = window.location.hash.match(new RegExp(`^#${PENDING_COPY_HASH_KEY}=(.+)$`));
    const fromHash = parsePendingCopy(hashMatch?.[1]);
    if (fromHash) return fromHash;
    const fromWindowName = window.name.startsWith(PENDING_COPY_WINDOW_PREFIX)
      ? window.name.slice(PENDING_COPY_WINDOW_PREFIX.length)
      : '';
    const fromWindow = parsePendingCopy(fromWindowName);
    if (fromWindow) return fromWindow;
    try {
      const stored = await chrome.storage.local.get(getPendingStorageKey());
      const fromStorage = stored[getPendingStorageKey()];
      return isValidPendingCopy(fromStorage) ? fromStorage : null;
    } catch (_) {
      return null;
    }
  }

  async function clearPendingCopy(pending) {
    if (window.location.hash.startsWith(`#${PENDING_COPY_HASH_KEY}=`)) {
      window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    }
    if (window.name.startsWith(PENDING_COPY_WINDOW_PREFIX)) {
      window.name = pending.previousWindowName || '';
    }
    try { await chrome.storage.local.remove(getPendingStorageKey()); } catch (_) { /* ignore */ }
  }

  function navigateToCreateType(cate, pending, baseUrl = window.location.href) {
    const target = new URL(baseUrl, window.location.href);
    target.searchParams.set('cate', cate);
    target.hash = `${PENDING_COPY_HASH_KEY}=${encodeURIComponent(JSON.stringify(pending))}`;
    const current = new URL(window.location.href);
    const sameConditionType = target.origin === current.origin
      && target.pathname === current.pathname
      && target.search === current.search;
    if (sameConditionType) {
      window.location.hash = target.hash;
      return false;
    }
    window.location.href = target.href;
    return true;
  }

  function findConditionTypeOption(createForm, editUrl, description) {
    const select = createForm.querySelector('select[name="cate"]');
    if (!select) throw new Error('未找到“选择条件”控件');

    // 编辑链接自带 cate，它是后台真正的条件类型编号；描述只是备选匹配依据。
    let cate = '';
    try { cate = new URL(editUrl, window.location.href).searchParams.get('cate') || ''; } catch (_) { /* ignore */ }
    let option = cate ? Array.from(select.options).find(item => item.value === cate) : null;
    if (!option) {
      const targetDescription = normalizeText(description);
      if (!targetDescription) throw new Error('原条件缺少类型编号和描述，无法匹配条件类型');
      option = Array.from(select.options).find(item =>
        normalizeText(item.textContent) === targetDescription
      );
      if (!option) throw new Error(`未找到匹配的条件类型：${targetDescription}`);
    }
    return { select, option };
  }

  async function resolveConditionCate(createForm, createUrl, editUrl, description) {
    try {
      const fromEditUrl = new URL(editUrl, window.location.href).searchParams.get('cate');
      if (fromEditUrl) return fromEditUrl;
    } catch (_) { /* ignore */ }

    if (createForm) return findConditionTypeOption(createForm, editUrl, description).option.value;

    // 极少数编辑链接没有 cate 时，再读取原生新建页的下拉选项，用描述匹配。
    const response = await fetch(createUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取新建页失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.querySelectorAll('form')).find(item => item.querySelector('select[name="cate"]'));
    if (!form) throw new Error('未找到“选择条件”控件');
    return findConditionTypeOption(form, editUrl, description).option.value;
  }

  function selectConditionType(createForm, editUrl, description) {
    const { select, option } = findConditionTypeOption(createForm, editUrl, description);

    select.value = option.value;
    Array.from(createForm.querySelectorAll('[name="cate"]')).forEach(control => {
      control.value = option.value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return option.value;
  }

  function showCopyNotice(createForm) {
    let notice = document.getElementById('copy-condition-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'copy-condition-notice';
      notice.style.cssText = 'margin:12px 20px;padding:10px 14px;color:#0b6b36;background:#e8f7ee;border:1px solid #a9dec0;border-radius:4px;';
      createForm.parentElement?.insertBefore(notice, createForm);
    }
    notice.textContent = '已复制原条件配置到创建表单。请确认后使用后台原有的“提交”。';
  }

  async function restorePendingCopy(attempt = 0) {
    const pending = await getPendingCopy();
    if (!pending) return;
    const createForm = getCreateForm();
    const selectedCate = createForm?.querySelector('select[name="cate"]')?.value;
    if (!createForm || selectedCate !== pending.cate) {
      if (attempt < 20) window.setTimeout(() => restorePendingCopy(attempt + 1), 150);
      return;
    }

    const fieldsForCreate = { ...pending.fields };
    delete fieldsForCreate.cate;
    await setFieldValues(createForm, fieldsForCreate);
    installMultipleSelectSubmitGuard(createForm);
    sanitizeMultipleSelectValues(createForm);
    await clearPendingCopy(pending);
    showCopyNotice(createForm);
    createForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function readSourceForm(editUrl) {
    const response = await fetch(editUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取编辑页失败：HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // 编辑条件页没有“选择条件/cate”控件；真实类型来自编辑链接中的 cate。
    // 这里只用名称与描述定位真实编辑表单，读取原有配置字段。
    const form = Array.from(doc.querySelectorAll('form')).find(item =>
      item.method.toLowerCase() === 'post' && item.querySelector('[name="name"]') && item.querySelector('[name="description"]')
    );
    if (!form) throw new Error('未找到条件编辑表单');

    const fields = {};
    const appendFieldValue = (name, value) => {
      if (!(name in fields)) {
        fields[name] = value;
        return;
      }
      const previous = Array.isArray(fields[name]) ? fields[name] : [fields[name]];
      fields[name] = [...previous, value];
    };
    Array.from(form.elements).forEach(element => {
      const name = element.getAttribute('name');
      if (!name || name === 'id' || name === '_token' || name === '_method' || name === 'after-save' || name === '_previous_') return;

      if (element.type === 'checkbox') {
        if (element.checked) appendFieldValue(name, element.value || 'on');
        return;
      }
      if (element.type === 'radio') {
        if (element.checked) fields[name] = element.value;
        return;
      }
      if (element.tagName === 'SELECT') {
        const selected = Array.from(element.selectedOptions).map(option => option.value);
        fields[name] = element.multiple ? selected : (selected[0] ?? '');
        return;
      }
      // Select2 会同时保留一个同名 hidden 输入；已有可见控件值时不让 hidden 覆盖它。
      if (!(name in fields) || element.type !== 'hidden') {
        fields[name] = element.value;
      }
    });

    const inverseCheckbox = Array.from(form.querySelectorAll('input[type="checkbox"]')).find(input =>
      input.closest('.form-group')?.textContent.includes('取反')
    );
    if (inverseCheckbox) fields.inverse = inverseCheckbox.checked ? 'on' : 'off';
    return fields;
  }

  function applyFieldValues(form, entries) {
    entries.forEach(([name, value]) => {
      const controls = Array.from(form.querySelectorAll(`[name="${CSS.escape(name)}"]`));
      if (!controls.length) return;
      const values = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
      const multipleSelect = controls.find(control => control.tagName === 'SELECT' && control.multiple);
      controls.forEach(control => {
        if (control.tagName === 'SELECT') {
          if (control.multiple) {
            Array.from(control.options).forEach(option => { option.selected = values.includes(option.value); });
          } else {
            control.value = values[0] ?? '';
          }
        } else if (control.type === 'checkbox') {
          control.checked = values.includes(control.value) || values.includes('on') || values.includes('1') || values.includes('true');
        } else if (control.type === 'radio') {
          control.checked = values.includes(control.value);
        } else {
          control.value = values[0];
        }
        control.dispatchEvent(new Event('change', { bubbles: true }));
        control.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // Select2/后台表单有时会额外生成同名 hidden 输入。多选框存在时，
      // hidden 只用于“没有选择项”的兜底，不能继续携带复制前的旧角色。
      if (multipleSelect) {
        controls
          .filter(control => control !== multipleSelect && control.type === 'hidden')
          .forEach(control => { control.disabled = true; });
        try {
          if (window.jQuery) window.jQuery(multipleSelect).val(values).trigger('change');
        } catch (_) { /* 原生选项状态已完成同步 */ }
      }
    });
  }

  function sanitizeMultipleSelectValues(form) {
    form.querySelectorAll('select[multiple][name]').forEach(select => {
      const name = select.getAttribute('name');
      if (!name) return;
      const sameNameControls = Array.from(form.querySelectorAll(`[name="${CSS.escape(name)}"]`));
      sameNameControls
        .filter(control => control !== select && control.type === 'hidden')
        .forEach(control => { control.disabled = true; });
    });
  }

  function installMultipleSelectSubmitGuard(form) {
    if (form.dataset.bbMultipleSelectGuard === 'true') return;
    form.dataset.bbMultipleSelectGuard = 'true';
    form.addEventListener('submit', () => sanitizeMultipleSelectValues(form), true);
  }

  async function setFieldValues(form, fields) {
    const entries = Object.entries(fields);
    // json_a/json_b 等多选项常依赖前面的下拉字段（如投票问题）。
    // 先填父字段，等待后台加载依赖选项后，再多次尝试填入选项值。
    const delayedEntries = entries.filter(([name]) => /^json_/.test(name));
    const primaryEntries = entries.filter(([name]) => !/^json_/.test(name));
    applyFieldValues(form, primaryEntries);
    if (!delayedEntries.length) return;

    for (const waitTime of [250, 600, 900]) {
      await new Promise(resolve => window.setTimeout(resolve, waitTime));
      applyFieldValues(form, delayedEntries);
    }
  }

  async function copyCondition(button, editUrl) {
    if (button.dataset.copying === 'true') return;
    const createForm = getCreateForm();
    const createLink = getCreateLink();
    if (!createForm && !createLink) throw new Error('未找到创建条件表单或“添加条件”入口');
    button.dataset.copying = 'true';
    button.textContent = '读取中…';
    button.classList.remove('copy-condition-done');
    const fields = await readSourceForm(editUrl);

    // 选择条件会跳转到 ?cate=... 的原生创建页，因此必须在跳转前保存字段，
    // 等新页面生成对应表单后再回填名称、列表等配置。
    // 全局条件列表没有右侧创建表单：先走后台原有的“添加条件”页面。
    // 回合条件列表仍继续使用原有的内嵌创建表单。
    const createUrl = createForm ? window.location.href : createLink.href;
    const cate = await resolveConditionCate(createForm, createUrl, editUrl, fields.description);
    // 将原字段随新建页地址携带。页面跳转后插件会回填并立即从地址栏清除临时数据。
    const pending = await savePendingCopy(fields, cate);
    const didNavigate = navigateToCreateType(cate, pending, createUrl);
    // 同类型不会触发页面重载，直接回填第二条及后续条件。
    if (!didNavigate) {
      await restorePendingCopy();
      button.textContent = '复制完成';
      button.classList.add('copy-condition-done');
      window.setTimeout(() => {
        button.textContent = '复制条件';
        button.classList.remove('copy-condition-done');
        delete button.dataset.copying;
      }, 1200);
    }
  }

  function updateButtons() {
    addStyles();
    updateIdColumns();
    document.querySelectorAll('table tbody tr').forEach(row => {
      const editLink = row.querySelector('a[href*="/conditions/"][href*="/edit"]');
      if (!editLink || row.querySelector(`a[${BUTTON_ATTRIBUTE}]`)) return;
      const button = document.createElement('a');
      button.href = '#';
      button.className = 'btn btn-xs btn-warning';
      button.setAttribute(BUTTON_ATTRIBUTE, 'true');
      button.textContent = '复制条件';
      button.addEventListener('click', event => {
        event.preventDefault();
        copyCondition(button, editLink.href).catch(error => {
          console.warn('[百变后台复制条件] 填充创建表单失败', error);
          button.textContent = '复制失败';
          delete button.dataset.copying;
          window.setTimeout(() => { button.textContent = '复制条件'; }, 1800);
        });
      });
      editLink.parentElement?.appendChild(button);
    });
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateButtons, 100);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => { restorePendingCopy(); });
  restorePendingCopy();
  updateButtons();
})();

// 回合动作列表：从 Excel/CSV 批量创建“强制角色进入地图”动作。
(() => {
  'use strict';

  const STYLE_ID = 'bb-batch-map-action-import-style';
  const MODAL_ID = 'bb-batch-map-action-import-modal';
  const BUTTON_ATTRIBUTE = 'data-bb-batch-map-action-import';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizeKey = value => normalize(value).toLowerCase();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const isActionList = () => /\/playbook\/actions\/?$/.test(location.pathname);

  function context() {
    const url = new URL(location.href);
    return {
      playbookId: url.searchParams.get('playbook_id') || '',
      relateId: url.searchParams.get('relate_id') || '',
      relateType: url.searchParams.get('relate_type') || '',
      basePath: url.pathname.match(/^\/[^/]+/)?.[0] || '/16d7m',
    };
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bb-batch-map-action-import-button { margin-left: 8px; }
      #${MODAL_ID} { position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center; justify-content: center; padding: 22px; background: rgba(0,0,0,.5); }
      #${MODAL_ID} .bb-bmai-dialog { width: min(1120px, 97vw); max-height: 91vh; display: flex; flex-direction: column; overflow: hidden; border-radius: 7px; background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
      #${MODAL_ID} .bb-bmai-header { padding: 20px 24px 12px; }
      #${MODAL_ID} .bb-bmai-title { margin: 0 0 7px; color: #34495e; font-size: 24px; font-weight: 600; }
      #${MODAL_ID} .bb-bmai-note { color: #6b7b8b; font-size: 14px; line-height: 1.65; }
      #${MODAL_ID} .bb-bmai-tools { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 14px; }
      #${MODAL_ID} .bb-bmai-tools input[type=file] { width: min(560px, 100%); }
      #${MODAL_ID} .bb-bmai-body { min-height: 210px; padding: 8px 24px 18px; overflow: auto; }
      #${MODAL_ID} .bb-bmai-status { padding: 14px; border-radius: 4px; color: #6b7b8b; background: #f4f7f9; white-space: pre-wrap; }
      #${MODAL_ID} .bb-bmai-status.is-error { color: #c0392b; background: #fff2f0; }
      #${MODAL_ID} .bb-bmai-summary { margin-bottom: 10px; color: #34495e; font-weight: 600; }
      #${MODAL_ID} .bb-bmai-table-wrap { overflow: auto; border: 1px solid #d8e3ed; border-radius: 4px; }
      #${MODAL_ID} table { width: 100%; min-width: 920px; margin: 0; border-collapse: collapse; }
      #${MODAL_ID} th, #${MODAL_ID} td { padding: 9px 10px; border-bottom: 1px solid #edf1f4; text-align: left; vertical-align: top; }
      #${MODAL_ID} th { color: #34495e; background: #f7f9fb; white-space: nowrap; }
      #${MODAL_ID} tr:last-child td { border-bottom: 0; }
      #${MODAL_ID} tr.is-error td { background: #fff5f4; }
      #${MODAL_ID} .bb-bmai-ok { color: #00a65a; }
      #${MODAL_ID} .bb-bmai-error { color: #dd4b39; }
      #${MODAL_ID} .bb-bmai-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 24px 20px; border-top: 1px solid #edf1f4; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function findActionForm(doc) {
    return Array.from(doc.forms).find(form =>
      String(form.method).toLowerCase() === 'post'
      && form.querySelector('select[name="cate"] option[value="61"]')
      && form.querySelector('select[name="json_a[]"]')
      && form.querySelector('select[name="param_a"]')
      && form.querySelector('select[name="pre_condition"]')
    ) || null;
  }

  function optionRecords(select, kind) {
    return Array.from(select?.options || []).map(option => {
      const id = normalize(option.value);
      let name = normalize(option.textContent);
      if (kind === 'condition') name = name.replace(/\|\s*\d+\s*$/, '').trim();
      return { id, name, rawName: normalize(option.textContent) };
    }).filter(item => item.id);
  }

  async function loadReferences() {
    const page = new URL(location.href);
    page.searchParams.set('cate', '61');
    const response = await fetch(page.href, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取地图动作表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = findActionForm(doc);
    if (!form) throw new Error('没有识别到“强制角色进入地图”创建表单');
    const token = form.querySelector('input[name="_token"]')?.value
      || doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    if (!token) throw new Error('没有识别到动作表单令牌');
    return {
      formAction: new URL(form.getAttribute('action') || page.href, page.href).href,
      token,
      characters: optionRecords(form.querySelector('select[name="json_a[]"]'), 'character'),
      maps: optionRecords(form.querySelector('select[name="param_a"]'), 'map')
        .filter(item => /^\d+$/.test(item.id)),
      conditions: optionRecords(form.querySelector('select[name="pre_condition"]'), 'condition')
        .filter(item => /^\d+$/.test(item.id)),
    };
  }

  function resolveOne(input, items, label) {
    const source = normalize(input);
    if (!source) return { error: `${label}不能为空` };
    const byId = items.filter(item => item.id === source);
    if (byId.length === 1) return { item: byId[0] };
    const key = normalizeKey(source);
    const byName = items.filter(item => normalizeKey(item.name) === key || normalizeKey(item.rawName) === key);
    if (byName.length === 1) return { item: byName[0] };
    if (byName.length > 1) return { error: `${label}“${source}”存在 ${byName.length} 个同名项，请改填 ID` };
    return { error: `未匹配到${label}“${source}”` };
  }

  function resolveCharacters(input, items) {
    const source = normalize(input);
    if (!source) return { error: '角色不能为空' };
    const parts = source.split(/[,，、;；\n]+/).map(normalize).filter(Boolean);
    const matched = [];
    const errors = [];
    parts.forEach(part => {
      const aliases = /^(全部角色|所有角色)$/i.test(part) ? '$all-characters' : part;
      const result = resolveOne(aliases, items, '角色');
      if (result.error) errors.push(result.error);
      else if (!matched.some(item => item.id === result.item.id)) matched.push(result.item);
    });
    return errors.length ? { error: errors.join('；') } : { items: matched };
  }

  function cell(row, aliases) {
    const key = Object.keys(row).find(header => aliases.includes(normalizeKey(header)));
    return key ? normalize(row[key]) : '';
  }

  function buildRows(sheetRows, refs) {
    return sheetRows.map((row, index) => {
      const raw = {
        name: cell(row, ['名称', '动作名称', 'name']),
        character: cell(row, ['角色', '人物', 'character']),
        map: cell(row, ['地图', 'map']),
        condition: cell(row, ['条件', '先决条件', 'condition']),
      };
      const errors = [];
      if (!raw.name) errors.push('名称不能为空');
      const characters = resolveCharacters(raw.character, refs.characters);
      if (characters.error) errors.push(characters.error);
      const map = resolveOne(raw.map, refs.maps, '地图');
      if (map.error) errors.push(map.error);
      let condition = { item: null };
      if (raw.condition) {
        condition = resolveOne(raw.condition, refs.conditions, '条件');
        if (condition.error) errors.push(condition.error);
      }
      return {
        line: index + 2,
        raw,
        characters: characters.items || [],
        map: map.item || null,
        condition: condition.item || null,
        errors,
      };
    }).filter(item => Object.values(item.raw).some(Boolean));
  }

  async function readSpreadsheet(file) {
    if (!globalThis.XLSX) throw new Error('Excel 解析组件未加载，请重新加载扩展后刷新页面');
    const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    const firstName = workbook.SheetNames[0];
    if (!firstName) throw new Error('表格中没有工作表');
    const rows = globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[firstName], { defval: '', raw: false });
    if (!rows.length) throw new Error('第一张工作表没有可导入的数据');
    const headers = Object.keys(rows[0]).map(normalizeKey);
    const required = [['名称', '动作名称', 'name'], ['角色', '人物', 'character'], ['地图', 'map']];
    if (required.some(group => !group.some(name => headers.includes(name)))) {
      throw new Error('表头至少需要“名称、角色、地图”三列；“条件”列可以留空');
    }
    return rows;
  }

  function renderPreview(body, rows) {
    const invalid = rows.filter(row => row.errors.length).length;
    body.innerHTML = `
      <div class="bb-bmai-summary">共 ${rows.length} 行；可创建 ${rows.length - invalid} 行；需修正 ${invalid} 行。</div>
      <div class="bb-bmai-table-wrap"><table>
        <thead><tr><th>行号</th><th>名称</th><th>角色匹配</th><th>地图匹配</th><th>条件匹配</th><th>状态</th></tr></thead>
        <tbody>${rows.map(row => `
          <tr class="${row.errors.length ? 'is-error' : ''}">
            <td>${row.line}</td>
            <td>${escapeHtml(row.raw.name)}</td>
            <td>${escapeHtml(row.characters.length ? row.characters.map(item => `${item.name}（${item.id}）`).join('、') : row.raw.character)}</td>
            <td>${escapeHtml(row.map ? `${row.map.name}（${row.map.id}）` : row.raw.map)}</td>
            <td>${escapeHtml(row.condition ? `${row.condition.name}（${row.condition.id}）` : (row.raw.condition || '无'))}</td>
            <td class="${row.errors.length ? 'bb-bmai-error' : 'bb-bmai-ok'}">${escapeHtml(row.errors.length ? row.errors.join('；') : '匹配成功')}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  }

  async function submitRow(row, refs) {
    const ctx = context();
    const data = new URLSearchParams({
      _token: refs.token,
      cate: '61',
      name: row.raw.name,
      playbook_id: ctx.playbookId,
      relate_id: ctx.relateId,
      relate_type: ctx.relateType,
      param_a: row.map.id,
      description: '取消线索对角色可见',
      error_next: '0',
      break: '0',
      delay: '0',
      priority: '10',
      pre_condition: row.condition?.id || '0',
      _previous_: location.href,
    });
    row.characters.forEach((item, index) => data.set(`json_a[${index}]`, item.id));
    data.set(`json_a[${row.characters.length}]`, '');
    const actionUrl = new URL(refs.formAction, location.href);
    actionUrl.searchParams.set('playbook_id', ctx.playbookId);
    actionUrl.searchParams.set('relate_id', ctx.relateId);
    actionUrl.searchParams.set('relate_type', ctx.relateType);
    const response = await fetch(actionUrl.href, { method: 'POST', body: data, credentials: 'same-origin' });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      let result = null;
      try { result = JSON.parse(text); } catch (_) { /* HTML 式成功响应 */ }
      if (result && (result.status === false || result.success === false)) throw new Error(normalize(result.message) || '后台返回失败');
    } else {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const error = normalize(doc.querySelector('.alert-danger, .callout-danger, .has-error .help-block')?.textContent);
      if (error) throw new Error(error);
    }
  }

  function downloadTemplate() {
    if (!globalThis.XLSX) return;
    const sheet = globalThis.XLSX.utils.json_to_sheet([
      { 名称: '示例地图动作', 角色: '角色名或角色ID', 地图: '地图名或地图ID', 条件: '条件名或条件ID（可留空）' }
    ]);
    const book = globalThis.XLSX.utils.book_new();
    globalThis.XLSX.utils.book_append_sheet(book, sheet, '地图动作');
    globalThis.XLSX.writeFile(book, '批量创建地图动作模板.xlsx');
  }

  function openModal() {
    closeModal();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-bmai-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-bmai-title">
        <div class="bb-bmai-header">
          <h3 class="bb-bmai-title" id="bb-bmai-title">批量创建地图动作</h3>
          <div class="bb-bmai-note">读取第一张工作表。表头使用“名称、角色、地图、条件”；条件可留空。角色、地图和条件支持名称或 ID，多个角色用逗号、顿号或分号分隔。导入只做预览，点击确认后才会创建。</div>
          <div class="bb-bmai-tools">
            <input type="file" class="form-control" accept=".xlsx,.xls,.csv,.tsv" data-bb-bmai-file>
            <button type="button" class="btn btn-default" data-bb-bmai-template>下载模板</button>
          </div>
        </div>
        <div class="bb-bmai-body"><div class="bb-bmai-status">请选择表格文件。</div></div>
        <div class="bb-bmai-footer">
          <button type="button" class="btn btn-default" data-bb-bmai-cancel>取消</button>
          <button type="button" class="btn btn-success" data-bb-bmai-submit disabled>确认批量创建</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const picker = modal.querySelector('[data-bb-bmai-file]');
    const body = modal.querySelector('.bb-bmai-body');
    const submit = modal.querySelector('[data-bb-bmai-submit]');
    const cancel = modal.querySelector('[data-bb-bmai-cancel]');
    let currentRows = [];
    let refs = null;
    cancel.addEventListener('click', closeModal);
    modal.querySelector('[data-bb-bmai-template]').addEventListener('click', downloadTemplate);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      submit.disabled = true;
      body.innerHTML = '<div class="bb-bmai-status">正在读取表格并匹配本回合数据…</div>';
      try {
        const [sheetRows, loadedRefs] = await Promise.all([readSpreadsheet(file), loadReferences()]);
        refs = loadedRefs;
        currentRows = buildRows(sheetRows, refs);
        if (!currentRows.length) throw new Error('没有识别到有效数据行');
        renderPreview(body, currentRows);
        submit.disabled = currentRows.some(row => row.errors.length);
      } catch (error) {
        body.innerHTML = `<div class="bb-bmai-status is-error">${escapeHtml(error.message || error)}</div>`;
      }
    });
    submit.addEventListener('click', async () => {
      if (!refs || !currentRows.length || currentRows.some(row => row.errors.length)) return;
      submit.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      const lines = [];
      let success = 0;
      let failed = 0;
      for (let index = 0; index < currentRows.length; index += 1) {
        const row = currentRows[index];
        body.innerHTML = `<div class="bb-bmai-status">正在创建 ${index + 1}/${currentRows.length}：${escapeHtml(row.raw.name)}\n${escapeHtml(lines.join('\n'))}</div>`;
        try {
          await submitRow(row, refs);
          success += 1;
          lines.push(`✓ 第 ${row.line} 行：${row.raw.name}`);
        } catch (error) {
          failed += 1;
          lines.push(`✗ 第 ${row.line} 行：${row.raw.name}：${error.message || error}`);
        }
      }
      body.innerHTML = `<div class="bb-bmai-status ${failed ? 'is-error' : ''}">完成：成功 ${success} 个，失败 ${failed} 个。请关闭弹窗后刷新页面查看列表。\n${escapeHtml(lines.join('\n'))}</div>`;
      cancel.disabled = false;
      cancel.textContent = '关闭';
      submit.hidden = true;
    });
  }

  function updateButton() {
    if (!isActionList()) return;
    addStyles();
    if (document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const anchor = document.querySelector('.bb-custom-action-panel')
      || document.querySelector('table')?.previousElementSibling
      || document.querySelector('.box-header');
    if (!anchor) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success bb-batch-map-action-import-button';
    button.setAttribute(BUTTON_ATTRIBUTE, '1');
    button.textContent = '批量导入地图动作';
    button.addEventListener('click', openModal);
    anchor.appendChild(button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateButton, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.setInterval(updateButton, 800);
  updateButton();
})();

// 剧本信息轮播图批量上传：复刻后台“选择一张图片并保存”的流程，逐张累积提交。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-carousel-batch-button';
  const MODAL_ID = 'bb-carousel-batch-modal';
  const STYLE_ID = 'bb-carousel-batch-style';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isPlaybookInfoEdit = () => /\/playbook\/info\/\d+\/edit\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${BUTTON_ATTRIBUTE}] { margin-left: 8px !important; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 18px; box-sizing: border-box; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-carousel-panel { width: min(700px, calc(100vw - 36px)); max-height: calc(100vh - 36px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-carousel-note { color: #687786; line-height: 1.7; }
      #${MODAL_ID} input[type="file"] { margin: 12px 0; }
      #${MODAL_ID} .bb-carousel-list { max-height: 280px; overflow: auto; border: 1px solid #ddd; }
      #${MODAL_ID} .bb-carousel-row { display: grid; grid-template-columns: 54px minmax(0, 1fr) 92px; gap: 12px; align-items: center; padding: 9px 10px; border-bottom: 1px solid #eee; }
      #${MODAL_ID} .bb-carousel-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-carousel-file { word-break: break-all; }
      #${MODAL_ID} .bb-carousel-size { color: #888; text-align: right; }
      #${MODAL_ID} .bb-carousel-empty { padding: 12px; color: #999; }
      #${MODAL_ID} .bb-carousel-status { min-height: 24px; margin-top: 12px; color: #337ab7; white-space: pre-wrap; }
      #${MODAL_ID} .bb-carousel-error { color: #c0392b; }
      #${MODAL_ID} .bb-carousel-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findCarouselGroup(root = document) {
    const labels = Array.from(root.querySelectorAll('label, .control-label'));
    const label = labels.find(item => normalize(item.textContent) === '轮播图');
    if (!label) return null;
    return label.closest('.form-group') || label.parentElement?.parentElement || null;
  }

  function findCarouselUploadField(root = document) {
    const group = findCarouselGroup(root);
    if (!group) return null;
    const fileInput = group.querySelector('input[type="file"]');
    const namedInputs = Array.from(group.querySelectorAll('input[name]')).filter(input =>
      input.type !== 'button' && input.type !== 'submit'
    );
    const hiddenField = namedInputs.find(input => input.type === 'hidden' && /\[\]$/.test(input.name))
      || namedInputs.find(input => input.type === 'hidden')
      || namedInputs[0]
      || null;
    const uploadName = fileInput?.name || hiddenField?.name || '';
    return { group, fileInput, hiddenField, uploadName };
  }

  function formatSize(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function renderFiles(container, files) {
    container.replaceChildren();
    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'bb-carousel-empty';
      empty.textContent = '尚未选择图片。';
      container.appendChild(empty);
      return;
    }
    files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'bb-carousel-row';
      const number = document.createElement('span');
      number.textContent = `${index + 1}.`;
      const name = document.createElement('span');
      name.className = 'bb-carousel-file';
      name.textContent = file.name;
      const size = document.createElement('span');
      size.className = 'bb-carousel-size';
      size.textContent = formatSize(file.size);
      row.append(number, name, size);
      container.appendChild(row);
    });
  }

  function resolveAction(form, baseUrl) {
    return new URL(form.getAttribute('action') || baseUrl, baseUrl).href;
  }

  function buildUploadBody(form, uploadName, file) {
    const original = new FormData(form);
    const body = new FormData();
    for (const [name, value] of original.entries()) {
      // 只移除浏览器为未选择文件生成的空 File；同名隐藏值是后台累计轮播图的关键，必须保留。
      if (name === uploadName && value instanceof File && !value.name && value.size === 0) continue;
      body.append(name, value);
    }
    body.append(uploadName, file, file.name);
    return body;
  }

  async function parseFailure(response, actionName) {
    if (!response.ok) throw new Error(`${actionName}失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      if (payload.status === false || payload.success === false) {
        throw new Error(payload.message || payload.error || `${actionName}失败`);
      }
      return;
    }
    const html = await response.text();
    const page = new DOMParser().parseFromString(html, 'text/html');
    const validation = page.querySelector('.alert-danger, .callout-danger, .has-error .help-block');
    if (validation && normalize(validation.textContent)) {
      throw new Error(normalize(validation.textContent));
    }
  }

  async function uploadOne(file) {
    // 每张上传前重新读取编辑页，让上一张提交后产生的隐藏字段参与下一次提交。
    const pageResponse = await fetch(location.href, { credentials: 'same-origin', cache: 'no-store' });
    if (!pageResponse.ok) throw new Error(`读取剧本信息失败：HTTP ${pageResponse.status}`);
    const page = new DOMParser().parseFromString(await pageResponse.text(), 'text/html');
    const found = findCarouselUploadField(page);
    if (!found?.uploadName) throw new Error('未读取到“轮播图”的实际上传字段');
    const form = found.fileInput?.closest('form') || found.hiddenField?.closest('form') || found.group.closest('form');
    if (!form) throw new Error('未找到剧本信息保存表单');
    const response = await fetch(resolveAction(form, pageResponse.url || location.href), {
      method: (form.getAttribute('method') || 'POST').toUpperCase(),
      body: buildUploadBody(form, found.uploadName, file),
      credentials: 'same-origin',
    });
    await parseFailure(response, `上传“${file.name}”`);
  }

  function openModal() {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    let files = [];
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-carousel-panel">
        <h3>批量上传轮播图</h3>
        <p class="bb-carousel-note">选择多张图片后，插件会按照列表顺序逐张执行后台原有的“上传并保存”流程。每张成功后都会重新读取最新表单，确保前面已保存的轮播图继续保留。</p>
        <input type="file" class="form-control" accept="image/*" multiple>
        <div class="bb-carousel-list"></div>
        <div class="bb-carousel-status"></div>
        <div class="bb-carousel-actions">
          <button type="button" class="btn btn-default" data-role="cancel">取消</button>
          <button type="button" class="btn btn-success" data-role="confirm" disabled>确认上传</button>
        </div>
      </div>
    `;
    const picker = modal.querySelector('input[type="file"]');
    const list = modal.querySelector('.bb-carousel-list');
    const status = modal.querySelector('.bb-carousel-status');
    const cancel = modal.querySelector('[data-role="cancel"]');
    const confirm = modal.querySelector('[data-role="confirm"]');
    renderFiles(list, files);

    picker.addEventListener('change', () => {
      files = Array.from(picker.files || []).filter(file =>
        file.type.startsWith('image/') || /\.(?:jpe?g|png|gif|webp|bmp|avif)$/i.test(file.name)
      );
      renderFiles(list, files);
      confirm.disabled = files.length === 0;
      confirm.textContent = files.length ? `确认上传 ${files.length} 张` : '确认上传';
      status.className = 'bb-carousel-status';
      status.textContent = files.length ? '' : '请选择至少一张图片。';
    });
    cancel.addEventListener('click', () => {
      if (cancel.dataset.refresh === 'true') location.reload();
      else modal.remove();
    });
    modal.addEventListener('click', event => {
      if (event.target === modal && !confirm.disabled) modal.remove();
    });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        location.reload();
        return;
      }
      if (!files.length) return;
      picker.disabled = true;
      cancel.disabled = true;
      confirm.disabled = true;
      const failures = [];
      let completed = 0;
      for (let index = 0; index < files.length; index += 1) {
        status.className = 'bb-carousel-status';
        status.textContent = `正在上传 ${index + 1}/${files.length}：${files[index].name}`;
        try {
          await uploadOne(files[index]);
          completed += 1;
        } catch (error) {
          failures.push(`${files[index].name}：${error.message || error}`);
          // 累积上传依赖上一张成功后的最新表单；单张失败后仍可继续尝试后续图片。
        }
      }
      status.className = failures.length ? 'bb-carousel-status bb-carousel-error' : 'bb-carousel-status';
      status.textContent = `已成功上传 ${completed}/${files.length} 张。${failures.length ? `\n失败：\n${failures.join('\n')}` : ''}`;
      cancel.disabled = false;
      cancel.dataset.refresh = completed ? 'true' : 'false';
      cancel.textContent = completed ? '关闭并刷新' : '关闭';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.textContent = completed ? '完成并刷新' : '关闭';
    });

    document.body.appendChild(modal);
    picker.focus();
  }

  function addButton() {
    if (!isPlaybookInfoEdit()) return;
    const found = findCarouselUploadField();
    if (!found) return;
    addStyles();
    let button = found.group.querySelector(`[${BUTTON_ATTRIBUTE}]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-success';
      button.setAttribute(BUTTON_ATTRIBUTE, 'true');
      button.textContent = '批量上传';
      button.addEventListener('click', openModal);
    }
    // Bootstrap-fileinput 的预览区里也有 button。必须分步查找浏览按钮容器，不能用带
    // “button”兜底的组合选择器，否则 querySelector 会先命中隐藏预览区的关闭按钮。
    const buttonGroup = found.group.querySelector('.file-caption-main .input-group-btn, .file-caption-main .input-group-append')
      || found.group.querySelector('.input-group-btn, .input-group-append');
    const browseButton = found.group.querySelector('.btn-file');
    if (buttonGroup) buttonGroup.appendChild(button);
    else if (browseButton?.parentElement) browseButton.insertAdjacentElement('afterend', button);
    else found.group.appendChild(button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(addButton, 140);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(addButton, 800);
  addButton();
})();

// 回合列表批量工具：批量添加回合、创建标准回合动作、创建标准回合事件。
(() => {
  'use strict';

  const STYLE_ID = 'bb-scene-batch-tools-style';
  const MODAL_ID = 'bb-scene-batch-modal';
  const SELECT_ALL = 'data-bb-scene-select-all';
  const SELECT_ROW = 'data-bb-scene-select';
  const BUTTONS = {
    add: 'data-bb-scene-batch-add',
    action: 'data-bb-scene-batch-action',
    event: 'data-bb-scene-batch-event',
  };
  let updateTimer = null;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isSceneList = () => /^\/16d7m\/playbook\/scenes\/?$/.test(location.pathname);

  function pageContext() {
    const url = new URL(location.href);
    return {
      playbookId: url.searchParams.get('playbook_id') || '',
      basePath: url.pathname.match(/^\/[^/]+/)?.[0] || '/16d7m',
    };
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${SELECT_ALL}], td[${SELECT_ROW}] { width:42px; min-width:42px; text-align:center; vertical-align:middle !important; }
      #${MODAL_ID} { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.48); }
      #${MODAL_ID} .bb-scene-batch-panel { width:min(760px, 94vw); max-height:88vh; overflow:auto; padding:22px; border-radius:7px; background:#fff; box-shadow:0 18px 55px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin:0 0 10px; color:#34495e; font-size:23px; }
      #${MODAL_ID} .bb-scene-batch-note { color:#687786; line-height:1.65; }
      #${MODAL_ID} textarea { width:100%; min-height:220px; margin-top:12px; padding:10px; resize:vertical; border:1px solid #ccd6e0; border-radius:4px; line-height:1.6; }
      #${MODAL_ID} .bb-scene-batch-preview, #${MODAL_ID} .bb-scene-batch-status { margin-top:12px; padding:10px 12px; color:#337ab7; white-space:pre-line; line-height:1.65; background:#f5f9fd; border-radius:4px; }
      #${MODAL_ID} .bb-scene-vote-map { margin-top:14px; border:1px solid #d8e3ed; border-radius:4px; overflow:hidden; }
      #${MODAL_ID} .bb-scene-vote-map-title { padding:10px 12px; color:#34495e; font-weight:600; background:#eef5f9; }
      #${MODAL_ID} .bb-scene-vote-map-row { display:grid; grid-template-columns:minmax(150px, 1fr) minmax(220px, 1.4fr); gap:12px; align-items:center; padding:10px 12px; border-top:1px solid #edf1f4; }
      #${MODAL_ID} .bb-scene-vote-map-row select { width:100%; min-height:34px; padding:5px 8px; border:1px solid #ccd6e0; border-radius:3px; background:#fff; }
      #${MODAL_ID} .is-error { color:#a94442; background:#fdf0f0; }
      #${MODAL_ID} .bb-scene-batch-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function sceneTable() {
    return Array.from(document.querySelectorAll('table.grid-table, table')).find(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(item => clean(item.textContent));
      return headers.includes('ID') && headers.includes('标题') && headers.includes('按钮文字');
    }) || null;
  }

  function sceneFromRow(row) {
    const table = row.closest('table');
    const headers = Array.from(table?.querySelectorAll('thead th') || []);
    const cells = Array.from(row.children);
    const column = label => headers.findIndex(item => clean(item.textContent) === label);
    const editLink = Array.from(row.querySelectorAll('a[href]')).find(link => /\/playbook\/scenes\/\d+\/edit/.test(link.getAttribute('href') || ''));
    const id = clean(row.dataset.key)
      || (editLink?.getAttribute('href') || '').match(/\/playbook\/scenes\/(\d+)\/edit/)?.[1]
      || clean(cells[column('ID')]?.textContent);
    if (!/^\d+$/.test(id)) return null;
    return {
      id,
      title: clean(cells[column('标题')]?.textContent) || `回合 ${id}`,
      word: clean(cells[column('按钮文字')]?.textContent),
      row,
    };
  }

  function allScenes() {
    const table = sceneTable();
    return table ? Array.from(table.querySelectorAll('tbody > tr')).map(sceneFromRow).filter(Boolean) : [];
  }

  function selectedScenes() {
    return allScenes().filter(scene => scene.row.querySelector(`input[${SELECT_ROW}]`)?.checked);
  }

  function toolbarAnchor() {
    return Array.from(document.querySelectorAll('a.btn, button.btn')).find(item => clean(item.textContent) === '添加回合')
      || Array.from(document.querySelectorAll('a[href]')).find(item => /\/playbook\/scenes\/create/.test(item.getAttribute('href') || ''))
      || null;
  }

  async function fetchDocument(url, label) {
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function findPostForm(doc, actionPattern) {
    return Array.from(doc.forms).find(form => {
      try {
        return String(form.method).toLowerCase() === 'post'
          && actionPattern.test(new URL(form.getAttribute('action') || '', location.origin).pathname);
      } catch (_) { return false; }
    }) || null;
  }

  function fieldGroup(form, labels) {
    const wanted = labels.map(label => clean(label).replace(/[：:]/g, ''));
    const label = Array.from(form.querySelectorAll('label, .control-label')).find(item =>
      wanted.includes(clean(item.textContent).replace(/[：:]/g, ''))
    );
    return label?.closest('.form-group') || label?.parentElement?.parentElement || null;
  }

  function setField(form, labels, names, value, required = false) {
    const group = fieldGroup(form, labels);
    let control = group?.querySelector('input[name], textarea[name], select[name]') || null;
    if (!control) control = names.map(name => form.querySelector(`[name="${name}"]`)).find(Boolean) || null;
    if (!control) {
      if (required) throw new Error(`没有识别到字段：${labels[0]}`);
      return false;
    }
    if (control.tagName === 'SELECT') {
      const option = Array.from(control.options).find(item => String(item.value) === String(value) || clean(item.textContent) === clean(value));
      control.value = option?.value ?? value;
    } else control.value = value;
    return true;
  }

  async function submitForm(form, baseUrl, label) {
    const response = await fetch(new URL(form.getAttribute('action') || baseUrl, baseUrl).href, {
      method:'POST', body:new FormData(form), credentials:'same-origin',
    });
    const resultText = await response.text();
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      let payload = null;
      try { payload = JSON.parse(resultText); } catch (_) { /* 继续按普通成功响应处理 */ }
      if (payload && (payload.status === false || payload.success === false)) throw new Error(clean(payload.message) || `${label}失败`);
    } else {
      const resultDoc = new DOMParser().parseFromString(resultText, 'text/html');
      const error = clean(resultDoc.querySelector('.alert-danger, .callout-danger, .has-error .help-block')?.textContent);
      if (error) throw new Error(error);
    }
  }

  function parseSceneLines(value) {
    const result = [];
    const seen = new Set();
    String(value || '').split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      const separator = line.indexOf('|');
      const title = (separator < 0 ? line : line.slice(0, separator)).trim();
      const customWord = separator < 0 ? '' : line.slice(separator + 1).trim();
      if (!title || seen.has(title)) return;
      seen.add(title);
      result.push({ title, customWord });
    });
    const invalid = result.find((item, index) => item.customWord && index !== result.length - 1);
    if (invalid) throw new Error(`“${invalid.title}”不是最后一行；仅最后一个回合支持自定义按钮文字。`);
    return result;
  }

  async function createScene(item, word) {
    const { playbookId, basePath } = pageContext();
    const listUrl = new URL(`${basePath}/playbook/scenes`, location.origin);
    listUrl.searchParams.set('playbook_id', playbookId);
    const doc = await fetchDocument(listUrl.href, '读取回合创建表单');
    const form = findPostForm(doc, /\/playbook\/scenes\/?$/);
    if (!form) throw new Error('没有识别到回合创建表单');
    setField(form, ['标题'], ['title'], item.title, true);
    setField(form, ['按钮文字'], ['word', 'button_word'], word);
    setField(form, ['剧中时间'], ['time'], '');
    setField(form, ['规则说明'], ['guideline', 'description'], '');
    setField(form, ['剧本ID'], ['playbook_id'], playbookId);
    await submitForm(form, listUrl.href, `创建回合“${item.title}”`);
  }

  function actionListUrl(sceneId, cate = '') {
    const { playbookId, basePath } = pageContext();
    const url = new URL(`${basePath}/playbook/actions`, location.origin);
    url.searchParams.set('playbook_id', playbookId);
    url.searchParams.set('relate_id', sceneId);
    url.searchParams.set('relate_type', '3');
    url.searchParams.set('page', '0');
    if (cate) url.searchParams.set('cate', cate);
    return url;
  }

  function actionRows(doc) {
    return Array.from(doc.querySelectorAll('table tbody tr')).map(row => {
      const cells = row.querySelectorAll('td');
      const id = clean(cells[0]?.textContent);
      return /^\d+$/.test(id) ? { id, type:clean(cells[1]?.textContent), name:clean(cells[2]?.textContent) } : null;
    }).filter(Boolean);
  }

  function findActionForm(doc) {
    return findPostForm(doc, /\/playbook\/actions\/?$/);
  }

  function readActionCate(form, expectedName) {
    const select = form.querySelector('select[name="cate"]') || fieldGroup(form, ['选择动作', '动作类型'])?.querySelector('select');
    const option = select && Array.from(select.options).find(item => clean(item.textContent) === expectedName);
    if (!option?.value) throw new Error(`动作列表中没有找到“${expectedName}”`);
    return option.value;
  }

  function selectActionTarget(form, target, labels) {
    const preferred = labels.flatMap(label => Array.from(fieldGroup(form, [label])?.querySelectorAll('select') || []));
    const candidates = [...preferred, ...Array.from(form.querySelectorAll('select[name]:not([name="cate"])'))];
    const select = candidates.find(item => Array.from(item.options).some(option =>
      (target.id && String(option.value) === String(target.id)) || clean(option.textContent) === target.name
    ));
    if (!select) throw new Error(`动作表单中没有匹配到目标：${target.name}`);
    const option = Array.from(select.options).find(item => target.id && String(item.value) === String(target.id))
      || Array.from(select.options).find(item => clean(item.textContent) === target.name);
    Array.from(select.options).forEach(item => { item.selected = item === option; });
  }

  async function loadVotePackCatalog(sceneId) {
    const initialUrl = actionListUrl(sceneId);
    const initialForm = findActionForm(await fetchDocument(initialUrl.href, '读取动作类型'));
    if (!initialForm) throw new Error('没有识别到动作创建表单');
    const cate = readActionCate(initialForm, '开启投票组');
    const listUrl = actionListUrl(sceneId, cate);
    const form = findActionForm(await fetchDocument(listUrl.href, '读取投票组列表'));
    if (!form) throw new Error('没有识别到“开启投票组”动作表单');
    const preferred = Array.from(fieldGroup(form, ['投票组'])?.querySelectorAll('select') || []);
    const select = preferred[0] || Array.from(form.querySelectorAll('select[name]:not([name="cate"])')).find(item =>
      Array.from(item.options).filter(option => option.value).length > 0
    );
    if (!select) throw new Error('动作表单中没有识别到投票组列表');
    const packs = Array.from(select.options).map(option => ({
      id:String(option.value || '').trim(), name:clean(option.textContent),
    })).filter(item => item.id && item.name && !/^请选择/.test(item.name) && item.name !== '投票组');
    if (!packs.length) throw new Error('当前剧本没有可选择的投票组');
    return packs;
  }

  function resolveRoundTarget(scene, catalog) {
    const matched = catalog.find(item => item.title === scene.word);
    if (matched) return { id:matched.id, name:matched.title, matchedBy:'button' };
    const currentIndex = catalog.findIndex(item => String(item.id) === String(scene.id));
    const next = currentIndex >= 0 ? catalog[currentIndex + 1] : null;
    return next ? { id:next.id, name:next.title, matchedBy:'next' } : null;
  }

  async function createStandardAction(scene, catalog, voteTarget = null) {
    const initialUrl = actionListUrl(scene.id);
    const initialDoc = await fetchDocument(initialUrl.href, '读取动作类型');
    const initialForm = findActionForm(initialDoc);
    if (!initialForm) throw new Error('没有识别到动作创建表单');
    const isVote = scene.word.includes('投票');
    const typeName = isVote ? '开启投票组' : '所有角色进入回合';
    const cate = readActionCate(initialForm, typeName);
    const listUrl = actionListUrl(scene.id, cate);
    const doc = await fetchDocument(listUrl.href, '读取动作创建表单');
    const form = findActionForm(doc);
    if (!form) throw new Error('没有识别到动作创建表单');
    if (actionRows(doc).some(action => action.type === typeName && action.name === scene.word)) return 'skipped';
    const target = isVote ? voteTarget : resolveRoundTarget(scene, catalog);
    if (isVote && !target) throw new Error('尚未选择需要关联的投票组');
    if (!target) throw new Error(`按钮文字“${scene.word}”没有匹配到同名回合，且当前回合后面没有下一回合`);
    selectActionTarget(form, target, isVote ? ['投票组'] : ['回合', '下一回合', '目标回合']);
    setField(form, ['名称'], ['name'], scene.word, true);
    setField(form, ['剧本ID'], ['playbook_id'], pageContext().playbookId);
    setField(form, ['关联ID'], ['relate_id'], scene.id);
    setField(form, ['关联类型'], ['relate_type'], '3');
    const cateControl = form.querySelector('select[name="cate"], input[name="cate"]');
    if (cateControl) cateControl.value = cate;
    await submitForm(form, listUrl.href, `创建动作“${scene.word}”`);
    return 'created';
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function makeModal(title, note, confirmText) {
    closeModal();
    addStyles();
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.innerHTML = `<div class="bb-scene-batch-panel" role="dialog" aria-modal="true"><h3></h3><div class="bb-scene-batch-note"></div><div data-bb-scene-body></div><div class="bb-scene-batch-status"></div><div class="bb-scene-batch-actions"><button type="button" class="btn btn-default" data-bb-scene-cancel>取消</button><button type="button" class="btn btn-primary" data-bb-scene-confirm></button></div></div>`;
    root.querySelector('h3').textContent = title;
    root.querySelector('.bb-scene-batch-note').textContent = note;
    root.querySelector('[data-bb-scene-confirm]').textContent = confirmText;
    root.querySelector('[data-bb-scene-cancel]').addEventListener('click', closeModal);
    root.addEventListener('click', event => { if (event.target === root) closeModal(); });
    document.body.appendChild(root);
    return {
      body:root.querySelector('[data-bb-scene-body]'), status:root.querySelector('.bb-scene-batch-status'),
      cancel:root.querySelector('[data-bb-scene-cancel]'), confirm:root.querySelector('[data-bb-scene-confirm]'),
    };
  }

  function openAddModal() {
    const ui = makeModal('批量添加回合', '每行一个回合标题。除最后一行外，按钮文字自动使用下一行标题；最后一行可写“标题 | 自定义按钮文字”。只创建回合，不创建动作和事件。', '确认创建');
    const textarea = document.createElement('textarea');
    textarea.placeholder = '例如：\n第一幕\n第一幕搜证\n第二幕\n结局 | 最终结算';
    const preview = document.createElement('div');
    preview.className = 'bb-scene-batch-preview';
    ui.body.append(textarea, preview);
    const refresh = () => {
      try {
        const items = parseSceneLines(textarea.value);
        preview.classList.remove('is-error');
        preview.textContent = items.length ? `将创建 ${items.length} 个回合：\n${items.map((item, index) => `${index + 1}. ${item.title} → ${index === items.length - 1 ? (item.customWord || '空') : items[index + 1].title}`).join('\n')}` : '请输入回合标题。';
        ui.confirm.disabled = !items.length;
        return items;
      } catch (error) {
        preview.classList.add('is-error'); preview.textContent = error.message; ui.confirm.disabled = true; return [];
      }
    };
    textarea.addEventListener('input', refresh);
    refresh();
    ui.confirm.addEventListener('click', async () => {
      if (ui.confirm.dataset.finished) return location.reload();
      const items = refresh();
      if (!items.length) return;
      const existing = new Set(allScenes().map(item => item.title));
      ui.confirm.disabled = ui.cancel.disabled = textarea.disabled = true;
      let created = 0; let skipped = 0; const failures = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (existing.has(item.title)) { skipped += 1; continue; }
        const word = index === items.length - 1 ? item.customWord : items[index + 1].title;
        ui.status.textContent = `正在创建 ${index + 1}/${items.length}：${item.title}`;
        try { await createScene(item, word); created += 1; existing.add(item.title); }
        catch (error) { failures.push(`${item.title}：${error.message || error}`); }
      }
      ui.status.classList.toggle('is-error', Boolean(failures.length));
      ui.status.textContent = `已创建 ${created} 个，跳过同名 ${skipped} 个。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      ui.confirm.disabled = false; ui.confirm.dataset.finished = 'true'; ui.confirm.textContent = '完成并刷新'; ui.cancel.disabled = false;
    });
  }

  async function openActionModal() {
    const selected = selectedScenes();
    const catalog = allScenes();
    const ui = makeModal('批量创建回合动作', '普通按钮优先用按钮文字匹配同名回合；匹配不到时自动关联列表中的下一回合。按钮文字包含“投票”时，需要手动选择关联投票组。重复动作会跳过。', `确认创建 ${selected.length} 个动作`);
    const preview = document.createElement('div');
    preview.className = `bb-scene-batch-preview${selected.length ? '' : ' is-error'}`;
    preview.textContent = selected.length ? selected.map((item, index) => {
      if (!item.word) return `${index + 1}. ${item.title} → 未设置按钮文字`;
      if (item.word.includes('投票')) return `${index + 1}. ${item.title} → ${item.word}（手动选择投票组）`;
      const target = resolveRoundTarget(item, catalog);
      if (!target) return `${index + 1}. ${item.title} → ${item.word}（未找到目标回合）`;
      return `${index + 1}. ${item.title} → ${target.name}${target.matchedBy === 'next' ? '（按下一回合匹配）' : ''}`;
    }).join('\n') : '请先勾选至少一个回合。';
    ui.body.appendChild(preview);
    ui.confirm.disabled = !selected.length;
    const voteScenes = selected.filter(scene => scene.word.includes('投票'));
    const voteTargets = new Map();
    if (voteScenes.length) {
      ui.confirm.disabled = true;
      ui.status.textContent = '正在读取投票组列表…';
      try {
        const packs = await loadVotePackCatalog(voteScenes[0].id);
        if (!document.getElementById(MODAL_ID)) return;
        const mapping = document.createElement('div');
        mapping.className = 'bb-scene-vote-map';
        const title = document.createElement('div');
        title.className = 'bb-scene-vote-map-title';
        title.textContent = '请选择每个投票回合需要关联的投票组';
        mapping.appendChild(title);
        const syncConfirm = () => {
          ui.confirm.disabled = voteScenes.some(scene => !voteTargets.has(scene.id));
        };
        voteScenes.forEach(scene => {
          const row = document.createElement('label');
          row.className = 'bb-scene-vote-map-row';
          const name = document.createElement('span');
          name.textContent = `${scene.title}（${scene.word}）`;
          const select = document.createElement('select');
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = '请选择投票组';
          select.appendChild(placeholder);
          packs.forEach(pack => {
            const option = document.createElement('option');
            option.value = pack.id;
            option.textContent = `${pack.name}（ID：${pack.id}）`;
            select.appendChild(option);
          });
          select.addEventListener('change', () => {
            const pack = packs.find(item => item.id === select.value);
            if (pack) voteTargets.set(scene.id, pack); else voteTargets.delete(scene.id);
            syncConfirm();
          });
          row.append(name, select);
          mapping.appendChild(row);
        });
        ui.body.appendChild(mapping);
        ui.status.textContent = '';
        syncConfirm();
      } catch (error) {
        ui.status.classList.add('is-error');
        ui.status.textContent = `读取投票组失败：${error.message || error}`;
        ui.confirm.disabled = true;
      }
    }
    ui.confirm.addEventListener('click', async () => {
      if (ui.confirm.dataset.finished) return closeModal();
      ui.confirm.disabled = ui.cancel.disabled = true;
      let created = 0; let skipped = 0; const failures = [];
      for (let index = 0; index < selected.length; index += 1) {
        const scene = selected[index];
        ui.status.textContent = `正在处理 ${index + 1}/${selected.length}：${scene.title}`;
        if (!scene.word) { failures.push(`${scene.title}：没有按钮文字`); continue; }
        try { (await createStandardAction(scene, catalog, voteTargets.get(scene.id) || null)) === 'created' ? created += 1 : skipped += 1; }
        catch (error) { failures.push(`${scene.title}：${error.message || error}`); }
      }
      ui.status.classList.toggle('is-error', Boolean(failures.length));
      ui.status.textContent = `已创建 ${created} 个，跳过重复 ${skipped} 个。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      ui.confirm.disabled = false; ui.confirm.dataset.finished = 'true'; ui.confirm.textContent = '关闭'; ui.cancel.disabled = false;
    });
  }

  async function openEventModal() {
    const selected = selectedScenes();
    const ui = makeModal('批量创建回合事件', '为每个勾选回合读取动作列表中的第一条动作，并创建或追加到“所有角色都点击了主按钮”事件。', '正在读取动作…');
    const preview = document.createElement('div');
    preview.className = 'bb-scene-batch-preview';
    ui.body.appendChild(preview);
    ui.confirm.disabled = true;
    if (!selected.length) {
      preview.classList.add('is-error'); preview.textContent = '请先勾选至少一个回合。'; ui.confirm.textContent = '确认创建 0 个事件'; return;
    }
    const prepared = [];
    for (let index = 0; index < selected.length; index += 1) {
      const scene = selected[index];
      preview.textContent = `正在读取 ${index + 1}/${selected.length}：${scene.title}`;
      try {
        const first = actionRows(await fetchDocument(actionListUrl(scene.id).href, '读取动作列表'))[0];
        prepared.push(first ? { scene, action:first } : { scene, error:'没有可关联的动作' });
      } catch (error) { prepared.push({ scene, error:error.message || '读取失败' }); }
    }
    const ready = prepared.filter(item => item.action);
    preview.textContent = prepared.map((item, index) => `${index + 1}. ${item.scene.title} → ${item.action?.name || item.error}`).join('\n');
    if (!ready.length) preview.classList.add('is-error');
    ui.confirm.textContent = `确认创建 ${ready.length} 个事件`;
    ui.confirm.disabled = !ready.length;
    ui.confirm.addEventListener('click', async () => {
      if (ui.confirm.dataset.finished) return closeModal();
      ui.confirm.disabled = ui.cancel.disabled = true;
      let changed = 0; let existed = 0; const failures = [];
      for (let index = 0; index < ready.length; index += 1) {
        const item = ready[index];
        ui.status.textContent = `正在处理 ${index + 1}/${ready.length}：${item.scene.title}`;
        try {
          const api = globalThis.__bbQuickEventApi;
          if (!api?.createOrAppendEvent) throw new Error('快捷事件组件尚未加载');
          const result = await api.createOrAppendEvent(item.action.id, '7', { playbookId:pageContext().playbookId, relateId:item.scene.id, relateType:'3' });
          result === 'exists' ? existed += 1 : changed += 1;
        } catch (error) { failures.push(`${item.scene.title}：${error.message || error}`); }
      }
      ui.status.classList.toggle('is-error', Boolean(failures.length));
      ui.status.textContent = `已创建或追加 ${changed} 个，已存在 ${existed} 个，无动作 ${prepared.length - ready.length} 个。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      ui.confirm.disabled = false; ui.confirm.dataset.finished = 'true'; ui.confirm.textContent = '关闭'; ui.cancel.disabled = false;
    });
  }

  function syncSelectAll() {
    const all = document.querySelector(`input[${SELECT_ALL}]`);
    const inputs = Array.from(document.querySelectorAll(`input[${SELECT_ROW}]`));
    if (!all) return;
    const checked = inputs.filter(input => input.checked).length;
    all.checked = inputs.length > 0 && checked === inputs.length;
    all.indeterminate = checked > 0 && checked < inputs.length;
  }

  function addTool(attribute, label, className, handler, anchor) {
    const existing = document.querySelector(`[${attribute}]`);
    if (existing) return existing;
    const button = document.createElement('button');
    button.type = 'button'; button.className = `btn ${className}`; button.style.marginLeft = '8px';
    button.setAttribute(attribute, 'true'); button.textContent = label; button.addEventListener('click', handler);
    anchor.insertAdjacentElement('afterend', button);
    return button;
  }

  function update() {
    if (!isSceneList()) return;
    const table = sceneTable(); const anchor = toolbarAnchor();
    if (!table || !anchor) return;
    addStyles();
    const header = table.querySelector('thead tr');
    if (header && !header.querySelector(`th[${SELECT_ALL}]`)) {
      const th = document.createElement('th'); const input = document.createElement('input');
      th.setAttribute(SELECT_ALL, 'true'); input.type = 'checkbox'; input.setAttribute(SELECT_ALL, 'true');
      input.addEventListener('change', () => { document.querySelectorAll(`input[${SELECT_ROW}]`).forEach(item => { item.checked = input.checked; }); syncSelectAll(); });
      th.appendChild(input); header.insertBefore(th, header.firstElementChild);
    }
    table.querySelectorAll('tbody > tr').forEach(row => {
      if (!sceneFromRow(row) || row.querySelector(`td[${SELECT_ROW}]`)) return;
      const td = document.createElement('td'); const input = document.createElement('input');
      td.setAttribute(SELECT_ROW, 'true'); input.type = 'checkbox'; input.setAttribute(SELECT_ROW, 'true'); input.addEventListener('change', syncSelectAll);
      td.appendChild(input); row.insertBefore(td, row.firstElementChild);
    });
    const action = addTool(BUTTONS.action, '批量创建回合动作', 'btn-danger', openActionModal, anchor);
    const event = addTool(BUTTONS.event, '批量创建回合事件', 'btn-primary', openEventModal, action);
    addTool(BUTTONS.add, '批量添加回合', 'btn-warning', openAddModal, event);
    syncSelectAll();
  }

  function schedule() { clearTimeout(updateTimer); updateTimer = setTimeout(update, 180); }
  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
  window.setInterval(update, 900);
  update();
})();

// 角色故事批量导入：读取标准 JSON，按角色名精确匹配，只保留段落、加粗和文字颜色。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-character-story-import';
  const MODAL_ID = 'bb-character-story-import-modal';
  const PREVIEW_MODAL_ID = 'bb-character-story-preview-modal';
  const STYLE_ID = 'bb-character-story-import-style';
  const SCHEMA = 'baibian.characterStories.v1';
  let updateTimer = null;

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isListPage() {
    return /^\/16d7m\/playbook\/characterstorys\/?$/.test(location.pathname);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/characterstorys/create"]'))
      .find(link => /添加角色故事/.test(normalize(link.textContent)))
      || document.querySelector('a[href*="/playbook/characterstorys/create"]');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-left: 6px; }
      #${MODAL_ID}, #${PREVIEW_MODAL_ID} { position:fixed; z-index:2147483647; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.48); }
      #${MODAL_ID} .bb-story-dialog { display:flex; flex-direction:column; width:min(1460px, calc(100vw - 44px)); max-height:calc(100vh - 44px); overflow:hidden; border-radius:8px; background:#fff; box-shadow:0 14px 50px rgba(0,0,0,.35); }
      #${MODAL_ID} .bb-story-header, #${MODAL_ID} .bb-story-footer { flex:0 0 auto; padding:18px 22px; border-bottom:1px solid #e5e9ee; }
      #${MODAL_ID} .bb-story-header { display:flex; align-items:center; justify-content:space-between; gap:18px; }
      #${MODAL_ID} .bb-story-header h3 { margin:0; font-size:24px; }
      #${MODAL_ID} .bb-story-close { border:0; background:transparent; color:#63758a; font-size:28px; line-height:1; }
      #${MODAL_ID} .bb-story-body { flex:1 1 auto; min-height:0; overflow:auto; padding:18px 22px; }
      #${MODAL_ID} .bb-story-file { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px; border:1px dashed #91a7bf; border-radius:6px; background:#f7fafd; }
      #${MODAL_ID} .bb-story-file input { max-width:420px; }
      #${MODAL_ID} .bb-story-overwrite { display:flex; align-items:center; gap:8px; margin:14px 0; padding:11px 13px; border:1px solid #f2c48d; border-radius:5px; background:#fff8ef; color:#a95519; }
      #${MODAL_ID} .bb-story-summary { margin:10px 0; color:#52677c; line-height:1.65; }
      #${MODAL_ID} .bb-story-table-wrap { overflow:auto; max-height:calc(100vh - 360px); border:1px solid #dce3ea; border-radius:6px; }
      #${MODAL_ID} table { width:100%; min-width:1120px; border-collapse:collapse; }
      #${MODAL_ID} th, #${MODAL_ID} td { padding:10px 9px; border-bottom:1px solid #e5e9ee; text-align:left; vertical-align:top; line-height:1.5; }
      #${MODAL_ID} th { position:sticky; top:0; z-index:2; background:#f3f7fb; white-space:nowrap; }
      #${MODAL_ID} tr.is-existing { background:#fff7ee; color:#9a4f1e; }
      #${MODAL_ID} tr.is-error { background:#fff0f0; color:#b73434; }
      #${MODAL_ID} tr.is-success { background:#effaf2; }
      #${MODAL_ID} .bb-story-preview-text { max-width:520px; color:#465d73; }
      #${MODAL_ID} .bb-story-full { margin-top:7px; }
      #${MODAL_ID} .bb-story-status { min-height:22px; margin-top:10px; white-space:pre-wrap; color:#337ab7; }
      #${MODAL_ID} .bb-story-status.is-error { color:#d9534f; }
      #${MODAL_ID} .bb-story-footer { display:flex; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid #e5e9ee; border-bottom:0; }
      #${MODAL_ID} .bb-story-actions { display:flex; gap:8px; }
      #${PREVIEW_MODAL_ID} .bb-story-preview-dialog { display:flex; flex-direction:column; width:min(920px, calc(100vw - 44px)); max-height:calc(100vh - 44px); padding:20px; border-radius:8px; background:#fff; box-shadow:0 14px 50px rgba(0,0,0,.35); }
      #${PREVIEW_MODAL_ID} .bb-story-preview-head { display:flex; align-items:center; justify-content:space-between; gap:15px; margin-bottom:14px; }
      #${PREVIEW_MODAL_ID} .bb-story-preview-head h3 { margin:0; }
      #${PREVIEW_MODAL_ID} .bb-story-preview-content { overflow:auto; min-height:240px; padding:18px; border:1px solid #dce3ea; border-radius:5px; font-size:16px; line-height:1.75; color:#25384b; }
      #${PREVIEW_MODAL_ID} .bb-story-preview-content > div { min-height:1.75em; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function parseRgb(value) {
    const input = normalize(value).toLowerCase();
    let match = input.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (match) {
      let hex = match[1];
      if (hex.length === 3) hex = hex.split('').map(character => character + character).join('');
      if (hex.length === 8) hex = hex.slice(0, 6);
      return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16));
    }
    match = input.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
    if (match) return match.slice(1, 4).map(value => Math.max(0, Math.min(255, Number(value))));
    const named = {
      black:[0,0,0], red:[255,0,0], blue:[0,0,255], green:[0,128,0], yellow:[255,255,0],
      orange:[255,165,0], purple:[128,0,128], gray:[128,128,128], grey:[128,128,128], white:[255,255,255],
    };
    return named[input] || null;
  }

  function sanitizeStoryHtml(sourceHtml, sourceText = '') {
    const html = String(sourceHtml || '').trim();
    if (!html) {
      const lines = String(sourceText || '').replace(/\r/g, '').split('\n');
      return lines.map(line => line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>').join('');
    }
    const sourceDoc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const outputDoc = document.implementation.createHTMLDocument('');

    const appendInline = (node, parent, inherited = {}) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.appendChild(outputDoc.createTextNode(node.nodeValue || ''));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'img', 'video', 'audio', 'iframe', 'object', 'svg', 'canvas'].includes(tag)) return;
      if (tag === 'br') {
        parent.appendChild(outputDoc.createElement('br'));
        return;
      }
      const styleColor = node.style?.color || node.getAttribute('color') || '';
      const rgb = parseRgb(styleColor);
      const bold = inherited.bold || ['b', 'strong'].includes(tag)
        || Number.parseInt(node.style?.fontWeight || '0', 10) >= 600;
      const color = rgb || inherited.color || null;
      let target = parent;
      if (bold && !inherited.bold) {
        const strong = outputDoc.createElement('b');
        target.appendChild(strong);
        target = strong;
      }
      if (color && (!inherited.color || inherited.color.join(',') !== color.join(','))) {
        const span = outputDoc.createElement('span');
        span.setAttribute('style', `color: rgb(${color[0]}, ${color[1]}, ${color[2]});`);
        target.appendChild(span);
        target = span;
      }
      Array.from(node.childNodes).forEach(child => appendInline(child, target, { bold, color }));
    };

    const blocks = [];
    const blockTags = new Set(['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);
    const emitBlock = node => {
      const block = outputDoc.createElement('div');
      Array.from(node.childNodes).forEach(child => appendInline(child, block));
      if (!normalize(block.textContent) && !block.querySelector('br')) block.appendChild(outputDoc.createElement('br'));
      blocks.push(block);
    };
    let inlineBucket = [];
    const flushInline = () => {
      if (!inlineBucket.length) return;
      const wrapper = outputDoc.createElement('div');
      inlineBucket.forEach(node => wrapper.appendChild(node.cloneNode(true)));
      emitBlock(wrapper);
      inlineBucket = [];
    };
    Array.from(sourceDoc.body.childNodes).forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName.toLowerCase())) {
        flushInline();
        emitBlock(node);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'br') {
        flushInline();
        const blank = outputDoc.createElement('div');
        blank.appendChild(outputDoc.createElement('br'));
        blocks.push(blank);
      } else if (node.nodeType === Node.TEXT_NODE && !node.nodeValue?.trim()) {
        // 顶层排版空白不作为段落。
      } else {
        inlineBucket.push(node);
      }
    });
    flushInline();
    return blocks.map(block => block.outerHTML).join('') || '<div><br></div>';
  }

  function plainTextFromHtml(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    return Array.from(doc.body.children).map(block => block.textContent || '').join('\n').trim();
  }

  function validatePackage(payload) {
    if (!payload || payload.schema !== SCHEMA || !Array.isArray(payload.records)) {
      throw new Error(`无法识别的数据格式，应为 ${SCHEMA}`);
    }
    const records = payload.records.map((record, index) => {
      const title = normalize(record.title);
      const roles = Array.isArray(record.roles) ? record.roles.map(normalize).filter(Boolean) : [normalize(record.role)].filter(Boolean);
      if (!title) throw new Error(`第 ${index + 1} 条缺少标题`);
      if (!roles.length) throw new Error(`第 ${index + 1} 条缺少角色`);
      const contentHtml = sanitizeStoryHtml(record.contentHtml, record.contentText);
      const contentText = plainTextFromHtml(contentHtml);
      if (!contentText) throw new Error(`第 ${index + 1} 条缺少故事正文`);
      const taskStory = /任务/.test(title) || /^【?你的任务】?[:：]?/.test(contentText);
      return {
        index,
        title,
        roles: Array.from(new Set(roles)),
        category: normalize(record.category || (taskStory ? '目的' : (payload.defaults?.category || '人设'))),
        visible: Boolean(record.visible ?? payload.defaults?.visible ?? false),
        aiSummary: Boolean(record.aiSummary ?? payload.defaults?.aiSummary ?? false),
        priority: String(record.priority ?? payload.defaults?.priority ?? '10'),
        publicStoryTitle: normalize(record.publicStoryTitle || ''),
        deliveryRound: normalize(record.deliveryRound || ''),
        contentHtml,
        contentText,
        selected: true,
        status: '待检查',
        existing: null,
      };
    });
    return { payload, records };
  }

  function canonicalKey(title, roles) {
    return `${normalize(title)}\u0000${roles.map(normalize).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN')).join('\u0001')}`;
  }

  function splitRoles(value) {
    return normalize(value).replace(/^全部角色\s*[\(（]?/, '').replace(/[\)）]$/, '')
      .split(/[,，、]/).map(normalize).filter(Boolean);
  }

  function tableRows(doc) {
    const table = Array.from(doc.querySelectorAll('table')).find(item => {
      const head = normalize(item.querySelector('thead')?.textContent);
      return head.includes('角色') && head.includes('标题') && head.includes('操作');
    });
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead th')).map(cell => normalize(cell.textContent));
    const titleIndex = headers.findIndex(value => value === '标题');
    const roleIndex = headers.findIndex(value => value === '角色');
    return Array.from(table.querySelectorAll('tbody tr')).map(row => {
      const cells = Array.from(row.children);
      const edit = row.querySelector('a[href*="/characterstorys/"][href*="/edit"]');
      const title = normalize(cells[titleIndex]?.textContent);
      const roleLabels = Array.from(cells[roleIndex]?.querySelectorAll('.label') || []).map(label => normalize(label.textContent)).filter(Boolean);
      const roles = roleLabels.length ? roleLabels : splitRoles(cells[roleIndex]?.textContent);
      return edit && title && roles.length ? { title, roles, editUrl: edit.href } : null;
    }).filter(Boolean);
  }

  async function readExistingRecords() {
    const first = new DOMParser().parseFromString(document.documentElement.outerHTML, 'text/html');
    const urls = new Set(Array.from(first.querySelectorAll('.pagination a[href]')).map(link =>
      new URL(link.getAttribute('href'), location.href).href
    ));
    const docs = [first];
    for (const url of urls) {
      const response = await fetch(url, { credentials:'same-origin', cache:'no-store' });
      if (response.ok) docs.push(new DOMParser().parseFromString(await response.text(), 'text/html'));
    }
    const result = new Map();
    docs.flatMap(tableRows).forEach(record => result.set(canonicalKey(record.title, record.roles), record));
    return result;
  }

  function findFieldGroup(doc, labelText) {
    const labels = Array.from(doc.querySelectorAll('label, .control-label, .field-label'));
    const label = labels.find(item => normalize(item.textContent).replace(/[\s：:]/g, '') === labelText.replace(/[\s：:]/g, ''));
    return label?.closest('.form-group, .form-row, .field, .row') || label?.parentElement || null;
  }

  function setInput(group, value) {
    const control = group?.querySelector('input:not([type="hidden"]), textarea');
    if (!control) throw new Error('未找到文本字段');
    control.value = String(value ?? '');
  }

  function setSelectByText(group, value, { multiple = false, optional = false } = {}) {
    const select = group?.querySelector('select');
    if (!select) {
      if (optional) return;
      throw new Error('未找到下拉字段');
    }
    const values = Array.isArray(value) ? value.map(normalize) : [normalize(value)];
    const matched = [];
    Array.from(select.options).forEach(option => {
      const selected = values.includes(normalize(option.textContent));
      option.selected = selected;
      if (selected) matched.push(normalize(option.textContent));
    });
    if (!multiple && matched.length) select.value = Array.from(select.options).find(option => option.selected)?.value || '';
    const missing = values.filter(item => item && !matched.includes(item));
    if (missing.length && !optional) throw new Error(`未找到角色：${missing.join('、')}`);
  }

  function setSwitch(group, enabled) {
    const checkbox = group?.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = Boolean(enabled);
  }

  function findStoryForm(doc) {
    return Array.from(doc.forms).find(form => form.method.toLowerCase() === 'post'
      && (form.querySelector('[name="name"]') || findFieldGroup(doc, '标题'))
      && findFieldGroup(doc, '故事')) || null;
  }

  function configureForm(doc, form, record) {
    const titleInput = form.querySelector('[name="name"]') || findFieldGroup(doc, '标题')?.querySelector('input, textarea');
    if (!titleInput) throw new Error('未找到标题字段');
    titleInput.value = record.title;
    setSelectByText(findFieldGroup(doc, '角色'), record.roles, { multiple:true });
    setSelectByText(findFieldGroup(doc, '分类'), record.category, { optional:true });
    if (record.deliveryRound) setSelectByText(findFieldGroup(doc, '下发回合'), record.deliveryRound, { optional:true });
    if (record.publicStoryTitle) setSelectByText(findFieldGroup(doc, '指向公共角色故事'), record.publicStoryTitle, { optional:true });
    const priorityGroup = findFieldGroup(doc, '优先级');
    const priority = priorityGroup?.querySelector('input:not([type="hidden"]), textarea');
    if (priority) priority.value = record.priority;
    const contentInput = form.querySelector('input[name="content"]');
    if (!contentInput) throw new Error('未找到故事正文提交字段');
    contentInput.value = record.contentHtml;
    const statusInput = form.querySelector('input[name="status"]');
    const aiInput = form.querySelector('input[name="ai"]');
    if (statusInput) statusInput.value = record.visible ? 'on' : 'off';
    if (aiInput) aiInput.value = record.aiSummary ? 'on' : 'off';
    setSwitch(findFieldGroup(doc, '是否可见'), record.visible);
    setSwitch(findFieldGroup(doc, '是否有ai总结'), record.aiSummary);
  }

  async function saveRecord(createUrl, record, existing) {
    const targetUrl = existing?.editUrl || createUrl;
    const response = await fetch(targetUrl, { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) throw new Error(`读取表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = findStoryForm(doc);
    if (!form) throw new Error('未找到角色故事表单');
    configureForm(doc, form, record);
    const body = new FormData(form);
    body.delete('after-save');
    const playbookId = new URL(location.href).searchParams.get('playbook_id') || '';
    if (playbookId) body.set('playbook_id', playbookId);
    const token = normalize(window.LA?.token)
      || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
      || '';
    if (token) body.set('_token', token);
    if (existing) body.set('_method', 'PUT');
    else body.delete('_method');
    const action = new URL(form.getAttribute('action') || targetUrl, targetUrl).href;
    const saveResponse = await fetch(action, {
      method:'POST',
      headers:{ 'X-Requested-With':'XMLHttpRequest' },
      body,
      credentials:'same-origin',
    });
    const resultText = await saveResponse.text();
    if (!saveResponse.ok) throw new Error(`保存失败：HTTP ${saveResponse.status}`);
    if ((saveResponse.headers.get('content-type') || '').includes('application/json')) {
      let payload = null;
      try { payload = JSON.parse(resultText); } catch (_) { /* 后续按 HTML 处理 */ }
      if (payload && (payload.status === false || payload.success === false)) {
        throw new Error(normalize(payload.message) || '后台返回保存失败');
      }
    }
    if (/has-error|alert-danger|callout-danger/.test(resultText)) {
      const resultDoc = new DOMParser().parseFromString(resultText, 'text/html');
      const message = normalize(resultDoc.querySelector('.alert-danger, .callout-danger, .has-error .help-block')?.textContent);
      throw new Error(message || '后台校验失败');
    }
  }

  function closePreview() {
    document.getElementById(PREVIEW_MODAL_ID)?.remove();
  }

  function openPreview(record) {
    closePreview();
    const modal = document.createElement('div');
    modal.id = PREVIEW_MODAL_ID;
    modal.innerHTML = `<div class="bb-story-preview-dialog"><div class="bb-story-preview-head"><h3></h3><button type="button" class="btn btn-default">关闭</button></div><div class="bb-story-preview-content"></div></div>`;
    modal.querySelector('h3').textContent = `${record.title} / ${record.roles.join('、')}`;
    modal.querySelector('.bb-story-preview-content').innerHTML = record.contentHtml;
    modal.querySelector('button').addEventListener('click', closePreview);
    modal.addEventListener('click', event => { if (event.target === modal) closePreview(); });
    document.body.appendChild(modal);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
    closePreview();
  }

  function renderRows(modal, records, overwrite) {
    const tbody = modal.querySelector('tbody');
    tbody.replaceChildren();
    records.forEach((record, index) => {
      const row = document.createElement('tr');
      if (record.existing) row.classList.add('is-existing');
      if (record.status.startsWith('失败')) row.classList.add('is-error');
      if (record.status.endsWith('成功')) row.classList.add('is-success');
      const checked = record.selected && (!record.existing || overwrite);
      row.innerHTML = `<td><input type="checkbox" data-index="${index}" ${checked ? 'checked' : ''}></td><td>${index + 1}</td><td>${escapeHtml(record.title)}</td><td>${escapeHtml(record.roles.join('、'))}</td><td>${escapeHtml(record.category)}</td><td>${record.visible ? '是' : '否'}</td><td>${escapeHtml(record.priority)}</td><td class="bb-story-preview-text">${escapeHtml(record.contentText.slice(0, 150))}${record.contentText.length > 150 ? '…' : ''}<br><button type="button" class="btn btn-xs btn-info bb-story-full" data-preview="${index}">查看全文</button></td><td>${escapeHtml(record.status)}</td>`;
      tbody.appendChild(row);
    });
    tbody.querySelectorAll('input[data-index]').forEach(input => input.addEventListener('change', () => {
      records[Number(input.dataset.index)].selected = input.checked;
      updateSummary(modal, records, overwrite);
    }));
    tbody.querySelectorAll('button[data-preview]').forEach(button => button.addEventListener('click', () => openPreview(records[Number(button.dataset.preview)])));
  }

  function updateSummary(modal, records, overwrite) {
    const selected = records.filter(record => record.selected && (!record.existing || overwrite));
    const newCount = selected.filter(record => !record.existing).length;
    const overwriteCount = selected.filter(record => record.existing).length;
    const existingCount = records.filter(record => record.existing).length;
    modal.querySelector('.bb-story-summary').textContent = `共 ${records.length} 条；检测到 ${existingCount} 条已存在；当前选择 ${selected.length} 条（新增 ${newCount} 条，覆盖 ${overwriteCount} 条）。`;
    modal.querySelector('[data-bb-story-submit]').disabled = selected.length === 0;
  }

  function openModal(createLink) {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-story-dialog" role="dialog" aria-modal="true">
        <div class="bb-story-header"><h3>批量导入故事</h3><button type="button" class="bb-story-close" title="关闭">×</button></div>
        <div class="bb-story-body">
          <div class="bb-story-file"><strong>选择标准 JSON 数据包</strong><input type="file" accept=".json,application/json"><span>只在当前浏览器中读取，不会上传给第三方。</span></div>
          <label class="bb-story-overwrite"><input type="checkbox" data-bb-story-overwrite> <strong>覆盖已存在记录</strong><span>默认关闭；勾选后可选择重复的“标题 + 角色组合”并覆盖。</span></label>
          <div class="bb-story-summary">等待选择文件。</div>
          <div class="bb-story-table-wrap"><table><thead><tr><th><input type="checkbox" data-bb-story-all checked></th><th>#</th><th>标题</th><th>角色</th><th>分类</th><th>可见</th><th>优先级</th><th>正文预览</th><th>状态</th></tr></thead><tbody></tbody></table></div>
          <div class="bb-story-status"></div>
        </div>
        <div class="bb-story-footer"><span>导入前请核对标题、角色、段落和颜色。</span><div class="bb-story-actions"><button type="button" class="btn btn-default" data-bb-story-cancel>关闭</button><button type="button" class="btn btn-primary" data-bb-story-submit disabled>开始导入</button></div></div>
      </div>`;
    document.body.appendChild(modal);
    let records = [];
    const fileInput = modal.querySelector('input[type="file"]');
    const overwriteInput = modal.querySelector('[data-bb-story-overwrite]');
    const selectAll = modal.querySelector('[data-bb-story-all]');
    const status = modal.querySelector('.bb-story-status');
    const submit = modal.querySelector('[data-bb-story-submit]');
    const rerender = () => {
      renderRows(modal, records, overwriteInput.checked);
      updateSummary(modal, records, overwriteInput.checked);
    };
    fileInput.addEventListener('change', async () => {
      status.className = 'bb-story-status';
      status.textContent = '正在解析文件并检查已有记录…';
      submit.disabled = true;
      try {
        const file = fileInput.files?.[0];
        if (!file) return;
        const parsed = validatePackage(JSON.parse(await file.text()));
        const currentPlaybookId = new URL(location.href).searchParams.get('playbook_id') || '';
        const packagePlaybookId = normalize(parsed.payload.playbookId || '');
        if (packagePlaybookId && currentPlaybookId && packagePlaybookId !== currentPlaybookId) {
          throw new Error(`数据包剧本 ID 为 ${packagePlaybookId}，当前页面剧本 ID 为 ${currentPlaybookId}，已停止读取。`);
        }
        records = parsed.records;
        const existingMap = await readExistingRecords();
        records.forEach(record => {
          record.existing = existingMap.get(canonicalKey(record.title, record.roles)) || null;
          record.status = record.existing ? '已存在，跳过' : '待新增';
          record.selected = !record.existing;
        });
        selectAll.checked = true;
        status.textContent = `已读取 ${file.name}，导入前仍会再次清洗富文本。`;
        rerender();
      } catch (error) {
        records = [];
        modal.querySelector('tbody').replaceChildren();
        modal.querySelector('.bb-story-summary').textContent = '文件读取失败。';
        status.className = 'bb-story-status is-error';
        status.textContent = error.message || String(error);
      }
    });
    overwriteInput.addEventListener('change', () => {
      records.forEach(record => {
        if (record.existing) {
          record.selected = overwriteInput.checked;
          record.status = overwriteInput.checked ? '已存在，待覆盖' : '已存在，跳过';
        }
      });
      rerender();
    });
    selectAll.addEventListener('change', () => {
      records.forEach(record => { record.selected = selectAll.checked && (!record.existing || overwriteInput.checked); });
      rerender();
    });
    modal.querySelector('.bb-story-close').addEventListener('click', closeModal);
    modal.querySelector('[data-bb-story-cancel]').addEventListener('click', closeModal);
    submit.addEventListener('click', async () => {
      const selected = records.filter(record => record.selected && (!record.existing || overwriteInput.checked));
      if (!selected.length) return;
      fileInput.disabled = true;
      overwriteInput.disabled = true;
      submit.disabled = true;
      modal.querySelector('[data-bb-story-cancel]').disabled = true;
      let success = 0;
      for (let index = 0; index < selected.length; index += 1) {
        const record = selected[index];
        status.className = 'bb-story-status';
        status.textContent = `正在导入 ${index + 1}/${selected.length}：${record.title} / ${record.roles.join('、')}`;
        try {
          await saveRecord(createLink.href, record, record.existing);
          success += 1;
          record.status = record.existing ? '覆盖成功' : '新增成功';
        } catch (error) {
          record.status = `失败：${error.message || error}`;
        }
        renderRows(modal, records, overwriteInput.checked);
      }
      const failures = selected.length - success;
      status.className = `bb-story-status${failures ? ' is-error' : ''}`;
      status.textContent = `导入结束：成功 ${success} 条，失败 ${failures} 条。`;
      modal.querySelector('[data-bb-story-cancel]').disabled = false;
      modal.querySelector('[data-bb-story-cancel]').textContent = '关闭并刷新页面';
      modal.querySelector('[data-bb-story-cancel]').onclick = () => location.reload();
    });
  }

  function update() {
    if (!isListPage()) return;
    const createLink = getCreateLink();
    if (!createLink || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '批量导入故事';
    button.addEventListener('click', event => { event.preventDefault(); openModal(createLink); });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
  window.setInterval(update, 900);
  update();
})();

// 百变角色故事列表：在“是否有ai总结”后增加“故事”列，按需读取编辑页并预览全文。
(() => {
  'use strict';

  const COLUMN_ATTRIBUTE = 'data-bb-story-list-preview-column';
  const BATCH_BUTTON_ATTRIBUTE = 'data-bb-story-batch-preview-button';
  const ROW_CHECKBOX_ATTRIBUTE = 'data-bb-round-story-select';
  const MODAL_ID = 'bb-story-list-preview-modal';
  const STYLE_ID = 'bb-story-list-preview-style';
  const CACHE = new Map();
  let updateTimer = null;

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isListPage() {
    return /^\/16d7m\/playbook\/characterstorys\/?$/.test(location.pathname);
  }

  function storyTable() {
    return Array.from(document.querySelectorAll('table.grid-table, table')).find(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(cell => normalize(cell.textContent));
      return headers.includes('角色') && headers.includes('标题') && headers.includes('是否有ai总结') && headers.includes('操作');
    }) || null;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${COLUMN_ATTRIBUTE}], td[${COLUMN_ATTRIBUTE}] { min-width:112px; text-align:center; vertical-align:middle !important; }
      .bb-story-list-preview-button { white-space:nowrap; cursor:pointer; }
      #${MODAL_ID} { position:fixed; z-index:2147483647; inset:0; display:flex; align-items:center; justify-content:center; padding:22px; background:rgba(0,0,0,.48); }
      #${MODAL_ID} .bb-story-list-preview-dialog { display:flex; flex-direction:column; width:min(920px, calc(100vw - 44px)); max-height:calc(100vh - 44px); padding:20px; border-radius:8px; background:#fff; box-shadow:0 14px 50px rgba(0,0,0,.35); }
      #${MODAL_ID} .bb-story-list-preview-head { display:flex; align-items:center; justify-content:space-between; gap:15px; margin-bottom:14px; }
      #${MODAL_ID} .bb-story-list-preview-head h3 { margin:0; font-size:20px; }
      #${MODAL_ID} .bb-story-list-preview-content { overflow:auto; min-height:240px; padding:18px; border:1px solid #dce3ea; border-radius:5px; font-size:16px; line-height:1.75; color:#25384b; }
      #${MODAL_ID} .bb-story-list-preview-content > div { min-height:1.75em; }
      #${MODAL_ID} .bb-story-batch-preview-section { padding:4px 0 28px; border-bottom:2px solid #e8eef3; }
      #${MODAL_ID} .bb-story-batch-preview-section + .bb-story-batch-preview-section { padding-top:28px; }
      #${MODAL_ID} .bb-story-batch-preview-section:last-child { padding-bottom:4px; border-bottom:0; }
      #${MODAL_ID} .bb-story-batch-preview-title { margin:0 0 14px; padding:10px 14px; border-left:4px solid #00a65a; background:#f4f9f6; color:#25384b; font-size:18px; line-height:1.5; }
      #${MODAL_ID} .bb-story-batch-preview-body { min-height:1.75em; }
      #${MODAL_ID} .bb-story-list-preview-loading { color:#60758a; }
      #${MODAL_ID} .bb-story-list-preview-error { color:#d9534f; white-space:pre-wrap; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function closePreview() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function createPreview(title) {
    closePreview();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-story-list-preview-dialog" role="dialog" aria-modal="true">
        <div class="bb-story-list-preview-head"><h3></h3><button type="button" class="btn btn-default">关闭</button></div>
        <div class="bb-story-list-preview-content"><span class="bb-story-list-preview-loading">正在读取故事正文…</span></div>
      </div>`;
    modal.querySelector('h3').textContent = title || '角色故事全文';
    modal.querySelector('button').addEventListener('click', closePreview);
    modal.addEventListener('click', event => { if (event.target === modal) closePreview(); });
    document.body.appendChild(modal);
    return modal;
  }

  function safePreviewHtml(sourceHtml) {
    const source = new DOMParser().parseFromString(`<body>${String(sourceHtml || '')}</body>`, 'text/html');
    source.querySelectorAll('script, style, iframe, object, embed, form, input, button, textarea, select, svg, canvas, video, audio').forEach(node => node.remove());
    source.querySelectorAll('*').forEach(node => {
      Array.from(node.attributes).forEach(attribute => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || ['href', 'src', 'srcdoc', 'action'].includes(name)) node.removeAttribute(attribute.name);
      });
    });
    return source.body.innerHTML || '<div><br></div>';
  }

  async function loadStory(editUrl) {
    if (CACHE.has(editUrl)) return CACHE.get(editUrl);
    const pending = (async () => {
      const response = await fetch(editUrl, { credentials:'same-origin', cache:'no-store' });
      if (!response.ok) throw new Error(`读取故事失败：HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const field = doc.querySelector('input[name="content"], textarea[name="content"]');
      const editorSource = doc.querySelector('#content');
      const html = field?.value || field?.getAttribute('value') || editorSource?.innerHTML || '';
      if (!html.trim()) throw new Error('编辑页中没有找到故事正文');
      return safePreviewHtml(html);
    })();
    CACHE.set(editUrl, pending);
    try {
      return await pending;
    } catch (error) {
      CACHE.delete(editUrl);
      throw error;
    }
  }

  async function openPreview(editUrl, title) {
    const modal = createPreview(title);
    const content = modal.querySelector('.bb-story-list-preview-content');
    try {
      content.innerHTML = await loadStory(editUrl);
    } catch (error) {
      content.innerHTML = '';
      const message = document.createElement('div');
      message.className = 'bb-story-list-preview-error';
      message.textContent = error.message || String(error);
      content.appendChild(message);
    }
  }

  function storyFromSelectedInput(input) {
    const row = input.closest('tr');
    const table = row?.closest('table');
    const editLink = row?.querySelector('a[href*="/playbook/characterstorys/"][href*="/edit"]');
    if (!row || !table || !editLink) return null;
    const headers = Array.from(table.querySelectorAll('thead th'));
    const cells = Array.from(row.children);
    const titleIndex = headers.findIndex(cell => normalize(cell.textContent) === '标题');
    const roleIndex = headers.findIndex(cell => normalize(cell.textContent) === '角色');
    return {
      editUrl: editLink.href,
      title: normalize(cells[titleIndex]?.textContent) || '未命名故事',
      role: normalize(cells[roleIndex]?.textContent),
    };
  }

  function selectedStoriesInTableOrder() {
    return Array.from(document.querySelectorAll(`input[${ROW_CHECKBOX_ATTRIBUTE}]:checked`))
      .map(storyFromSelectedInput)
      .filter(Boolean);
  }

  async function openBatchPreview() {
    const stories = selectedStoriesInTableOrder();
    if (!stories.length) {
      window.alert('请先勾选至少一个角色故事');
      return;
    }
    const modal = createPreview(`已选故事全文（${stories.length} 篇）`);
    const content = modal.querySelector('.bb-story-list-preview-content');
    content.innerHTML = '';
    for (let index = 0; index < stories.length; index += 1) {
      if (!modal.isConnected) return;
      const story = stories[index];
      const loading = document.createElement('div');
      loading.className = 'bb-story-list-preview-loading';
      loading.textContent = `正在读取第 ${index + 1}/${stories.length} 篇：${[story.role, story.title].filter(Boolean).join(' / ')}`;
      content.appendChild(loading);
      try {
        const html = await loadStory(story.editUrl);
        if (!modal.isConnected) return;
        loading.remove();
        const section = document.createElement('section');
        section.className = 'bb-story-batch-preview-section';
        const heading = document.createElement('h4');
        heading.className = 'bb-story-batch-preview-title';
        heading.textContent = `${index + 1}. ${[story.role, story.title].filter(Boolean).join(' / ')}`;
        const body = document.createElement('div');
        body.className = 'bb-story-batch-preview-body';
        body.innerHTML = html;
        section.append(heading, body);
        content.appendChild(section);
      } catch (error) {
        loading.className = 'bb-story-list-preview-error';
        loading.textContent = `第 ${index + 1} 篇读取失败（${[story.role, story.title].filter(Boolean).join(' / ')}）：${error.message || error}`;
      }
    }
  }

  function updateBatchButton() {
    let button = document.querySelector(`[${BATCH_BUTTON_ATTRIBUTE}]`);
    if (!button) {
      const anchor = document.querySelector('[data-bb-batch-round-story-button]')
        || document.querySelector('[data-bb-character-story-import]')
        || Array.from(document.querySelectorAll('a.btn, button.btn')).find(item => normalize(item.textContent).includes('添加角色故事'));
      if (!anchor) return;
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-sm btn-primary';
      button.style.marginLeft = '8px';
      button.setAttribute(BATCH_BUTTON_ATTRIBUTE, 'true');
      button.addEventListener('click', openBatchPreview);
      anchor.insertAdjacentElement('afterend', button);
    }
    const count = selectedStoriesInTableOrder().length;
    const label = count ? `查看全文（${count}）` : '查看全文';
    if (button.textContent !== label) button.textContent = label;
  }

  function update() {
    if (!isListPage()) return;
    const table = storyTable();
    if (!table) return;
    addStyles();

    const headerCells = Array.from(table.querySelectorAll('thead th'));
    const aiIndex = headerCells.findIndex(cell => normalize(cell.textContent) === '是否有ai总结');
    if (aiIndex < 0) return;
    let previewHeader = table.querySelector(`thead th[${COLUMN_ATTRIBUTE}]`);
    if (!previewHeader) {
      previewHeader = document.createElement('th');
      previewHeader.setAttribute(COLUMN_ATTRIBUTE, 'true');
      previewHeader.textContent = '故事';
      headerCells[aiIndex].insertAdjacentElement('afterend', previewHeader);
    }

    table.querySelectorAll('tbody > tr').forEach(row => {
      if (row.querySelector(`td[${COLUMN_ATTRIBUTE}]`)) return;
      const cells = Array.from(row.children);
      const editLink = row.querySelector('a[href*="/playbook/characterstorys/"][href*="/edit"]');
      if (!cells[aiIndex] || !editLink) return;
      const titleIndex = headerCells.findIndex(cell => normalize(cell.textContent) === '标题');
      const roleIndex = headerCells.findIndex(cell => normalize(cell.textContent) === '角色');
      const title = normalize(cells[titleIndex]?.textContent);
      const role = normalize(cells[roleIndex]?.textContent);
      const previewCell = document.createElement('td');
      previewCell.setAttribute(COLUMN_ATTRIBUTE, 'true');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-info bb-story-list-preview-button';
      button.textContent = '点击查看全文';
      button.addEventListener('click', () => openPreview(editLink.href, [title, role].filter(Boolean).join(' / ')));
      previewCell.appendChild(button);
      cells[aiIndex].insertAdjacentElement('afterend', previewCell);
    });
    updateBatchButton();
  }

  function schedule() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 160);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
  window.setInterval(update, 900);
  update();
})();

// 角色故事批量下发：勾选故事后，在指定回合创建一条“开启角色故事S”动作。
(() => {
  'use strict';

  const STYLE_ID = 'bb-batch-round-story-style';
  const MODAL_ID = 'bb-batch-round-story-modal';
  const BUTTON_ATTRIBUTE = 'data-bb-batch-round-story-button';
  const ROW_CHECKBOX_ATTRIBUTE = 'data-bb-round-story-select';
  const HEADER_CHECKBOX_ATTRIBUTE = 'data-bb-round-story-select-all';
  const RECORD_COLUMN_ATTRIBUTE = 'data-bb-round-story-record-column';
  const RECORD_STORAGE_PREFIX = 'bb-round-story-records:';
  const selectedStoryIds = new Set();
  let updateTimer = null;

  const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isListPage = () => /^\/16d7m\/playbook\/characterstorys\/?$/.test(location.pathname);

  function getPageContext() {
    const url = new URL(location.href);
    return {
      playbookId: url.searchParams.get('playbook_id') || '',
      basePath: url.pathname.match(/^\/[^/]+/)?.[0] || '/16d7m',
    };
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${HEADER_CHECKBOX_ATTRIBUTE}], td[${ROW_CHECKBOX_ATTRIBUTE}] { width:42px; min-width:42px; text-align:center; vertical-align:middle !important; }
      th[${RECORD_COLUMN_ATTRIBUTE}], td[${RECORD_COLUMN_ATTRIBUTE}] { min-width:140px; vertical-align:middle !important; }
      .bb-round-story-record { display:block; color:#00a65a; font-size:12px; line-height:1.6; white-space:normal; }
      #${MODAL_ID} { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.48); }
      #${MODAL_ID} .bb-batch-round-story-dialog { width:min(720px, 94vw); max-height:88vh; display:flex; flex-direction:column; overflow:hidden; border-radius:7px; background:#fff; box-shadow:0 18px 55px rgba(0,0,0,.3); }
      #${MODAL_ID} .bb-batch-round-story-header { padding:20px 24px 12px; }
      #${MODAL_ID} h3 { margin:0 0 7px; color:#34495e; font-size:24px; }
      #${MODAL_ID} .bb-batch-round-story-note { color:#6b7b8b; line-height:1.6; }
      #${MODAL_ID} .bb-batch-round-story-body { min-height:180px; padding:6px 24px 18px; overflow:auto; }
      #${MODAL_ID} .bb-batch-round-story-field { margin-bottom:15px; }
      #${MODAL_ID} .bb-batch-round-story-field > label { display:block; margin-bottom:6px; }
      #${MODAL_ID} .bb-batch-round-story-name { width:100%; height:38px; padding:6px 10px; border:1px solid #d2d6de; border-radius:3px; }
      #${MODAL_ID} .bb-batch-round-story-list { border:1px solid #d8e3ed; border-radius:4px; overflow:hidden; }
      #${MODAL_ID} .bb-batch-round-story-option { display:flex; align-items:center; gap:10px; margin:0; padding:11px 14px; border-bottom:1px solid #edf1f4; cursor:pointer; font-weight:400; }
      #${MODAL_ID} .bb-batch-round-story-option:last-child { border-bottom:0; }
      #${MODAL_ID} .bb-batch-round-story-option:hover { background:#f4f9fc; }
      #${MODAL_ID} .bb-batch-round-story-option input { margin:0; }
      #${MODAL_ID} .bb-batch-round-story-round-id { margin-left:auto; color:#95a5a6; font-size:12px; }
      #${MODAL_ID} .bb-batch-round-story-status { margin-bottom:12px; color:#3c8dbc; white-space:pre-line; }
      #${MODAL_ID} .bb-batch-round-story-status.is-error { color:#dd4b39; }
      #${MODAL_ID} .bb-batch-round-story-selected { margin-top:14px; padding:10px 12px; border-radius:4px; background:#f5f8fa; color:#60758a; line-height:1.6; }
      #${MODAL_ID} .bb-batch-round-story-footer { display:flex; justify-content:flex-end; gap:10px; padding:14px 24px 20px; border-top:1px solid #edf1f4; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function storyTable() {
    return Array.from(document.querySelectorAll('table.grid-table, table')).find(table => {
      const headers = Array.from(table.querySelectorAll('thead th')).map(cell => normalizeText(cell.textContent));
      return headers.includes('角色') && headers.includes('标题') && headers.includes('操作');
    }) || null;
  }

  function storyFromRow(row) {
    const editLink = Array.from(row.querySelectorAll('a[href]')).find(link =>
      /\/playbook\/characterstorys\/\d+\/edit\/?/.test(link.getAttribute('href') || '')
    );
    const id = normalizeText(row.getAttribute('data-key'))
      || (editLink?.getAttribute('href') || '').match(/\/playbook\/characterstorys\/(\d+)\/edit/)?.[1]
      || normalizeText(row.querySelector('.column-id')?.textContent);
    if (!/^\d+$/.test(id)) return null;
    const table = row.closest('table');
    const headers = Array.from(table?.querySelectorAll('thead th') || []);
    const cells = Array.from(row.children);
    const titleIndex = headers.findIndex(cell => normalizeText(cell.textContent) === '标题');
    const roleIndex = headers.findIndex(cell => normalizeText(cell.textContent) === '角色');
    return {
      id,
      title: normalizeText(cells[titleIndex]?.textContent) || `故事 ${id}`,
      role: normalizeText(cells[roleIndex]?.textContent),
      row,
    };
  }

  function visibleStories() {
    const table = storyTable();
    return table ? Array.from(table.querySelectorAll('tbody > tr')).map(storyFromRow).filter(Boolean) : [];
  }

  function selectedStories() {
    return visibleStories().filter(story => selectedStoryIds.has(story.id));
  }

  function recordsStorageKey() {
    const { playbookId } = getPageContext();
    return `${RECORD_STORAGE_PREFIX}${playbookId || location.pathname}`;
  }

  function readAllRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(recordsStorageKey()) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function saveStoryRecords(stories, round, actionId) {
    try {
      const allRecords = readAllRecords();
      stories.forEach(story => {
        const records = Array.isArray(allRecords[story.id]) ? allRecords[story.id] : [];
        const next = {
          roundId: String(round.id),
          roundName: round.name,
          actionId: String(actionId || ''),
          createdAt: Date.now(),
        };
        const existing = records.find(record => String(record.roundId) === String(round.id));
        if (existing) Object.assign(existing, next);
        else records.push(next);
        allRecords[story.id] = records;
      });
      localStorage.setItem(recordsStorageKey(), JSON.stringify(allRecords));
    } catch (_) {
      // 本地记录不可用时，不影响后台动作创建。
    }
  }

  function recordText(storyId) {
    const records = readAllRecords()[String(storyId)];
    if (!Array.isArray(records) || !records.length) return '—';
    return records.map(record => record.roundName || `回合 ${record.roundId}`).join('、');
  }

  function syncSelectionLabel() {
    const button = document.querySelector(`[${BUTTON_ATTRIBUTE}]`);
    if (button) button.textContent = selectedStoryIds.size ? `批量下发回合故事（${selectedStoryIds.size}）` : '批量下发回合故事';
    const all = document.querySelector(`input[${HEADER_CHECKBOX_ATTRIBUTE}]`);
    const rowInputs = Array.from(document.querySelectorAll(`input[${ROW_CHECKBOX_ATTRIBUTE}]`));
    if (all) {
      const checked = rowInputs.filter(input => input.checked).length;
      all.checked = rowInputs.length > 0 && checked === rowInputs.length;
      all.indeterminate = checked > 0 && checked < rowInputs.length;
    }
  }

  async function fetchDocument(url, label) {
    const response = await fetch(url, { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function readRounds(doc, sourceUrl) {
    const rounds = [];
    const seen = new Set();
    doc.querySelectorAll('table tbody tr').forEach(row => {
      const editLink = Array.from(row.querySelectorAll('a[href]')).find(link => {
        try { return /\/playbook\/scenes\/\d+\/edit\/?$/.test(new URL(link.getAttribute('href'), sourceUrl).pathname); }
        catch (_) { return false; }
      });
      const editUrl = editLink ? new URL(editLink.getAttribute('href'), sourceUrl) : null;
      const id = editUrl?.pathname.match(/\/playbook\/scenes\/(\d+)\/edit\/?$/)?.[1]
        || normalizeText(row.children[0]?.textContent).match(/^\d+$/)?.[0];
      if (!id || seen.has(id)) return;
      seen.add(id);
      rounds.push({ id, name: normalizeText(row.children[1]?.textContent) || `回合 ${id}` });
    });
    return rounds;
  }

  async function loadRounds() {
    const { playbookId, basePath } = getPageContext();
    if (!playbookId) throw new Error('当前页面缺少剧本 ID');
    const url = new URL(`${basePath}/playbook/scenes`, location.origin);
    url.searchParams.set('playbook_id', playbookId);
    const rounds = readRounds(await fetchDocument(url.href, '读取回合列表'), url.href);
    if (!rounds.length) throw new Error('没有识别到可用回合');
    return rounds;
  }

  function findActionForm(doc) {
    return Array.from(doc.forms).find(form => {
      try {
        return String(form.method).toLowerCase() === 'post'
          && /\/playbook\/actions\/?$/.test(new URL(form.getAttribute('action') || '', location.origin).pathname);
      } catch (_) { return false; }
    }) || null;
  }

  function fieldGroupByLabel(form, labelText) {
    const labels = Array.from(form.querySelectorAll('label, .control-label'));
    const label = labels.find(item => normalizeText(item.textContent).replace(/[：:]/g, '') === labelText);
    return label?.closest('.form-group') || label?.parentElement?.parentElement || null;
  }

  function selectStoryField(form, stories) {
    const ids = new Set(stories.map(story => String(story.id)));
    const group = fieldGroupByLabel(form, '剧情S');
    const candidates = Array.from(group?.querySelectorAll('select') || []);
    if (!candidates.length) {
      candidates.push(...Array.from(form.querySelectorAll('select[multiple], select[name*="json"], select[name*="story"]')));
    }
    const select = candidates.find(item => Array.from(item.options).some(option => ids.has(String(option.value)))) || candidates[0];
    if (!select?.name) throw new Error('动作表单中没有识别到“剧情S”字段');
    Array.from(select.options).forEach(option => { option.selected = ids.has(String(option.value)); });
    const found = new Set(Array.from(select.selectedOptions).map(option => String(option.value)));
    stories.forEach(story => {
      if (found.has(String(story.id))) return;
      const option = form.ownerDocument.createElement('option');
      option.value = story.id;
      option.textContent = [story.role, story.title].filter(Boolean).join(' ') || story.id;
      option.selected = true;
      select.appendChild(option);
    });
    return select.name;
  }

  function clearSpecifiedRole(form) {
    const group = fieldGroupByLabel(form, '指定角色');
    if (!group) return;
    group.querySelectorAll('select').forEach(select => Array.from(select.options).forEach(option => { option.selected = false; }));
    group.querySelectorAll('input:not([type="hidden"]), textarea').forEach(input => {
      if ('checked' in input) input.checked = false;
      input.value = '';
    });
    group.querySelectorAll('input[type="hidden"][name]').forEach(input => { input.value = ''; });
  }

  function readActionRows(doc) {
    return Array.from(doc.querySelectorAll('table tbody tr')).map(row => {
      const cells = row.querySelectorAll('td');
      const id = normalizeText(cells[0]?.textContent);
      if (!/^\d+$/.test(id)) return null;
      return { id, type:normalizeText(cells[1]?.textContent), name:normalizeText(cells[2]?.textContent) };
    }).filter(Boolean);
  }

  async function createRoundStoryAction(stories, round, actionName) {
    const { playbookId, basePath } = getPageContext();
    const listUrl = new URL(`${basePath}/playbook/actions`, location.origin);
    listUrl.searchParams.set('playbook_id', playbookId);
    listUrl.searchParams.set('cate', '52');
    listUrl.searchParams.set('relate_id', round.id);
    listUrl.searchParams.set('relate_type', '3');
    listUrl.searchParams.set('page', '0');
    listUrl.searchParams.set('_sort[column]', 'id');
    listUrl.searchParams.set('_sort[type]', 'desc');

    const beforeDoc = await fetchDocument(listUrl.href, '读取动作创建表单');
    const previousIds = new Set(readActionRows(beforeDoc).map(item => item.id));
    const form = findActionForm(beforeDoc);
    if (!form) throw new Error('没有识别到动作创建表单');
    const token = form.querySelector('input[name="_token"]')?.value;
    if (!token) throw new Error('没有识别到动作表单令牌');

    selectStoryField(form, stories);
    clearSpecifiedRole(form);
    const data = new FormData(form);
    data.set('_token', token);
    data.set('cate', '52');
    data.set('name', actionName);
    data.set('playbook_id', playbookId);
    data.set('relate_id', round.id);
    data.set('relate_type', '3');
    data.set('_previous_', listUrl.href);
    if (!data.has('error_next')) data.set('error_next', '0');
    if (!data.has('break')) data.set('break', '0');
    if (!data.has('delay')) data.set('delay', '0');
    if (!data.has('pre_condition')) data.set('pre_condition', '0');
    if (!data.has('priority')) data.set('priority', '10');

    const actionUrl = new URL(form.getAttribute('action') || listUrl.href, listUrl.href);
    actionUrl.searchParams.set('playbook_id', playbookId);
    actionUrl.searchParams.set('cate', '52');
    actionUrl.searchParams.set('relate_id', round.id);
    actionUrl.searchParams.set('relate_type', '3');
    const response = await fetch(actionUrl.href, { method:'POST', body:data, credentials:'same-origin' });
    const resultText = await response.text();
    if (!response.ok) throw new Error(`创建动作失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      let payload = null;
      try { payload = JSON.parse(resultText); } catch (_) { /* 通过列表继续确认 */ }
      if (payload && (payload.status === false || payload.success === false)) {
        throw new Error(normalizeText(payload.message) || '后台返回创建失败');
      }
    } else {
      const resultDoc = new DOMParser().parseFromString(resultText, 'text/html');
      const errorText = normalizeText(resultDoc.querySelector('.alert-danger, .callout-danger, .has-error .help-block')?.textContent);
      if (errorText) throw new Error(errorText);
    }

    const afterDoc = await fetchDocument(listUrl.href, '确认新动作');
    const created = readActionRows(afterDoc).filter(item =>
      !previousIds.has(item.id) && item.type === '开启角色故事S' && item.name === actionName
    ).sort((left, right) => Number(right.id) - Number(left.id))[0];
    if (!created) throw new Error('动作已提交，但没有在所选回合识别到新动作');
    return created.id;
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function openModal(stories) {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-batch-round-story-dialog" role="dialog" aria-modal="true">
        <div class="bb-batch-round-story-header">
          <h3>批量下发回合故事</h3>
          <div class="bb-batch-round-story-note">选择一个回合后创建一条“开启角色故事S”动作；动作名称留空时默认使用回合名称，指定角色保持为空。</div>
        </div>
        <div class="bb-batch-round-story-body">
          <div class="bb-batch-round-story-status">正在读取回合列表…</div>
        </div>
        <div class="bb-batch-round-story-footer">
          <button type="button" class="btn btn-default" data-bb-round-story-cancel>取消</button>
          <button type="button" class="btn btn-success" data-bb-round-story-submit disabled>创建动作</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const body = modal.querySelector('.bb-batch-round-story-body');
    const submit = modal.querySelector('[data-bb-round-story-submit]');
    const cancel = modal.querySelector('[data-bb-round-story-cancel]');
    cancel.addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });

    try {
      const rounds = await loadRounds();
      if (!modal.isConnected) return;
      body.innerHTML = `
        <div class="bb-batch-round-story-status" hidden></div>
        <div class="bb-batch-round-story-field"><label>动作名称（可不填）</label><input class="bb-batch-round-story-name" type="text" placeholder="留空时使用所选回合名称" autocomplete="off"></div>
        <div class="bb-batch-round-story-field"><label>选择回合</label><div class="bb-batch-round-story-list"></div></div>
        <div class="bb-batch-round-story-selected"></div>`;
      const nameInput = body.querySelector('.bb-batch-round-story-name');
      const list = body.querySelector('.bb-batch-round-story-list');
      const selected = body.querySelector('.bb-batch-round-story-selected');
      selected.textContent = `已选 ${stories.length} 个故事：${stories.map(story => [story.role, story.title].filter(Boolean).join(' / ')).join('、')}`;
      const syncSubmit = () => {
        submit.disabled = !modal.querySelector('input[name="bb-batch-round-story-round"]:checked');
      };
      nameInput.addEventListener('input', syncSubmit);
      rounds.forEach(round => {
        const label = document.createElement('label');
        label.className = 'bb-batch-round-story-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'bb-batch-round-story-round';
        radio.value = round.id;
        radio.addEventListener('change', syncSubmit);
        const name = document.createElement('span');
        name.textContent = round.name;
        const id = document.createElement('span');
        id.className = 'bb-batch-round-story-round-id';
        id.textContent = `ID：${round.id}`;
        label.append(radio, name, id);
        list.appendChild(label);
      });
      nameInput.focus();

      submit.addEventListener('click', async () => {
        if (submit.dataset.finished === 'true') {
          closeModal();
          return;
        }
        const roundId = modal.querySelector('input[name="bb-batch-round-story-round"]:checked')?.value;
        const round = rounds.find(item => item.id === roundId);
        if (!round) return;
        const actionName = normalizeText(nameInput.value) || round.name;
        submit.disabled = true;
        cancel.disabled = true;
        nameInput.disabled = true;
        modal.querySelectorAll('input[type="radio"]').forEach(input => { input.disabled = true; });
        const status = body.querySelector('.bb-batch-round-story-status');
        status.hidden = false;
        status.className = 'bb-batch-round-story-status';
        status.textContent = `正在向“${round.name}”创建动作…`;
        try {
          const actionId = await createRoundStoryAction(stories, round, actionName);
          saveStoryRecords(stories, round, actionId);
          update();
          status.textContent = `创建成功：动作 ${actionId} 已加入“${round.name}”，包含 ${stories.length} 个故事。`;
          submit.textContent = '完成';
          submit.dataset.finished = 'true';
          submit.disabled = false;
          cancel.textContent = '关闭';
          cancel.disabled = false;
        } catch (error) {
          console.warn('[百变后台批量下发回合故事] 创建失败', error);
          status.classList.add('is-error');
          status.textContent = `创建失败：${error.message || error}`;
          submit.disabled = false;
          cancel.disabled = false;
          nameInput.disabled = false;
          modal.querySelectorAll('input[type="radio"]').forEach(input => { input.disabled = false; });
        }
      });
    } catch (error) {
      body.innerHTML = '';
      const status = document.createElement('div');
      status.className = 'bb-batch-round-story-status is-error';
      status.textContent = error.message || String(error);
      body.appendChild(status);
    }
  }

  function update() {
    if (!isListPage()) return;
    const table = storyTable();
    if (!table) return;
    addStyles();

    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector(`th[${HEADER_CHECKBOX_ATTRIBUTE}]`)) {
      const cell = document.createElement('th');
      cell.setAttribute(HEADER_CHECKBOX_ATTRIBUTE, 'true');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute(HEADER_CHECKBOX_ATTRIBUTE, 'true');
      input.title = '全选当前页故事';
      input.addEventListener('change', () => {
        document.querySelectorAll(`input[${ROW_CHECKBOX_ATTRIBUTE}]`).forEach(rowInput => {
          rowInput.checked = input.checked;
          const id = rowInput.getAttribute('data-story-id');
          if (input.checked) selectedStoryIds.add(id); else selectedStoryIds.delete(id);
        });
        syncSelectionLabel();
      });
      cell.appendChild(input);
      headerRow.insertBefore(cell, headerRow.firstElementChild);
    }

    if (headerRow && !headerRow.querySelector(`th[${RECORD_COLUMN_ATTRIBUTE}]`)) {
      const operationHeader = Array.from(headerRow.children).find(cell => normalizeText(cell.textContent) === '操作');
      const cell = document.createElement('th');
      cell.setAttribute(RECORD_COLUMN_ATTRIBUTE, 'true');
      cell.textContent = '下发回合';
      headerRow.insertBefore(cell, operationHeader || null);
    }

    Array.from(table.querySelectorAll('tbody > tr')).forEach(row => {
      const story = storyFromRow(row);
      if (!story) return;
      if (!row.querySelector(`td[${ROW_CHECKBOX_ATTRIBUTE}]`)) {
        const cell = document.createElement('td');
        cell.setAttribute(ROW_CHECKBOX_ATTRIBUTE, 'true');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute(ROW_CHECKBOX_ATTRIBUTE, 'true');
        input.setAttribute('data-story-id', story.id);
        input.checked = selectedStoryIds.has(story.id);
        input.addEventListener('change', () => {
          if (input.checked) selectedStoryIds.add(story.id); else selectedStoryIds.delete(story.id);
          syncSelectionLabel();
        });
        cell.appendChild(input);
        row.insertBefore(cell, row.firstElementChild);
      }
      let recordCell = row.querySelector(`td[${RECORD_COLUMN_ATTRIBUTE}]`);
      if (!recordCell) {
        const operationCell = Array.from(row.querySelectorAll('a[href]')).find(link =>
          /\/playbook\/characterstorys\/\d+\/edit\/?/.test(link.getAttribute('href') || '')
        )?.closest('td');
        recordCell = document.createElement('td');
        recordCell.setAttribute(RECORD_COLUMN_ATTRIBUTE, 'true');
        row.insertBefore(recordCell, operationCell || null);
      }
      let record = recordCell.querySelector('.bb-round-story-record');
      if (!record) {
        record = document.createElement('span');
        record.className = 'bb-round-story-record';
        recordCell.appendChild(record);
      }
      record.textContent = recordText(story.id);
    });

    if (!document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) {
      const anchor = document.querySelector('[data-bb-character-story-import]')
        || Array.from(document.querySelectorAll('a.btn, button.btn')).find(item => normalizeText(item.textContent).includes('添加角色故事'));
      if (anchor) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-info';
        button.style.marginLeft = '8px';
        button.setAttribute(BUTTON_ATTRIBUTE, 'true');
        button.textContent = '批量下发回合故事';
        button.addEventListener('click', () => {
          const stories = selectedStories();
          if (!stories.length) {
            window.alert('请先勾选至少一个角色故事');
            return;
          }
          openModal(stories);
        });
        anchor.insertAdjacentElement('afterend', button);
      }
    }
    syncSelectionLabel();
  }

  function schedule() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
  window.setInterval(update, 900);
  update();
})();

// 百变投票列表：按勾选的投票批量添加选项，并批量设置正确答案。
(() => {
  'use strict';

  const OPTION_BUTTON_ATTRIBUTE = 'data-bb-batch-vote-options-button';
  const ANSWER_BUTTON_ATTRIBUTE = 'data-bb-batch-vote-answers-button';
  const ROW_CHECKBOX_ATTRIBUTE = 'data-bb-vote-select';
  const HEADER_CHECKBOX_ATTRIBUTE = 'data-bb-vote-select-all';
  const OPTION_MODAL_ID = 'bb-batch-vote-options-modal';
  const ANSWER_MODAL_ID = 'bb-batch-vote-answers-modal';
  const STYLE_ID = 'bb-batch-vote-tools-style';

  function isVoteListPage() {
    return /^\/16d7m\/playbook\/votes\/?$/.test(window.location.pathname);
  }

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function currentParams() {
    return new URLSearchParams(window.location.search);
  }

  function csrfToken() {
    return text(window.LA?.token)
      || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
      || '';
  }

  function voteTable() {
    return Array.from(document.querySelectorAll('table.grid-table, table')).find(table =>
      Array.from(table.querySelectorAll('tbody > tr[data-key]')).some(row => row.getAttribute('data-key'))
      && text(table.querySelector('thead')?.textContent).includes('标题')
    ) || null;
  }

  function voteRows(table = voteTable()) {
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody > tr[data-key]')).map(row => {
      const id = text(row.getAttribute('data-key')) || text(row.querySelector('.column-id')?.textContent);
      const title = text(row.querySelector('.column-title')?.textContent) || `投票 ${id}`;
      return id ? { id, title, row } : null;
    }).filter(Boolean);
  }

  function selectedVotes() {
    return Array.from(document.querySelectorAll(`input[${ROW_CHECKBOX_ATTRIBUTE}]:checked`)).map(input => ({
      id: text(input.getAttribute('data-vote-id')),
      title: text(input.getAttribute('data-vote-title')) || `投票 ${input.getAttribute('data-vote-id')}`,
      row: input.closest('tr'),
    })).filter(item => item.id);
  }

  function parseVoteOptions(value) {
    const source = String(value || '').replace(/\r/g, '').trim();
    if (!source) return [];

    // 兼容“每行一个”以及“A.选项一 B.选项二 C.选项三”这种常见录入方式。
    const marker = /(?:^|[\s,，、;；])([A-Za-zＡ-Ｚ][.)．、）:：])\s*/g;
    const markers = [];
    let match;
    while ((match = marker.exec(source))) {
      markers.push({ start: marker.lastIndex, markerStart: match.index });
    }
    if (markers.length >= 2) {
      return Array.from(new Set(markers.map((item, index) => text(source.slice(
        item.start,
        markers[index + 1]?.markerStart ?? source.length,
      )).replace(/[\s,，、;；]+$/, '')).filter(Boolean)));
    }

    return Array.from(new Set(source
      .split(/[\r\n,，、;；]+/)
      .map(item => text(item).replace(/^[A-Za-zＡ-Ｚ][.)．、）:：]\s*/, ''))
      .filter(Boolean)));
  }

  function formFieldValue(form, selector) {
    return text(form.querySelector(selector)?.value);
  }

  function collectFormFields(form, overrides = {}) {
    const body = new URLSearchParams();
    Array.from(form.elements || []).forEach(control => {
      if (!control.name || control.disabled || control.type === 'file'
        || control.type === 'submit' || control.type === 'button' || control.type === 'reset') return;
      if (control.closest('.cascade-group.hide')) return;
      if ((control.type === 'checkbox' || control.type === 'radio') && !control.checked) return;
      body.append(control.name, control.value || '');
    });

    Object.entries(overrides).forEach(([name, value]) => {
      body.delete(name);
      if (value !== undefined && value !== null) body.set(name, String(value));
    });
    const token = csrfToken();
    if (token && !body.get('_token')) body.set('_token', token);
    return body;
  }

  async function loadForm(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const html = await response.text();
    if (!response.ok) throw new Error(`读取表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = Array.from(doc.querySelectorAll('form')).find(item =>
      item.querySelector('input[name="title"], input[name="is_answer"]')
    );
    if (!form) throw new Error('未找到后台表单');
    return { form, doc, response };
  }

  function formAction(form, fallback) {
    const action = form.getAttribute('action') || fallback;
    const url = new URL(action, window.location.origin);
    return `${url.pathname}${url.search}`;
  }

  async function postForm(form, fallback, body) {
    const response = await fetch(formAction(form, fallback), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
      credentials: 'same-origin',
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (/\/create(?:\?|$)/.test(response.url) && /has-error|alert-danger|错误|必填/.test(html)) {
      throw new Error('后台校验失败，请检查字段');
    }
    return response;
  }

  async function createOption(voteId, title) {
    const params = currentParams();
    params.set('playbook_id', params.get('playbook_id') || '');
    params.set('vote_id', voteId);
    params.delete('pack_id');
    const url = `/16d7m/playbook/voteoptions/create?${params.toString()}`;
    const { form } = await loadForm(url);
    const body = collectFormFields(form, {
      playbook_id: params.get('playbook_id') || '',
      vote_id: voteId,
      title,
      is_answer: 'off',
      order: '0',
      target_type: '0',
      target_id1: '0',
    });
    body.delete('image');
    body.delete('after-save');
    body.delete('target_id');
    await postForm(form, '/16d7m/playbook/voteoptions', body);
  }

  function answerState(value) {
    return ['是', 'on', '1', 'true', 'yes'].includes(text(value).toLowerCase());
  }

  async function loadOptions(voteId) {
    const params = currentParams();
    params.set('vote_id', voteId);
    const response = await fetch(`/16d7m/playbook/voteoptions?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`读取选项失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('table tbody > tr[data-key]')).map((row, index) => {
      const id = text(row.getAttribute('data-key')) || text(row.querySelector('.column-id')?.textContent);
      const title = text(row.querySelector('.column-title')?.textContent) || `选项 ${index + 1}`;
      const answer = answerState(row.querySelector('.column-is_answer')?.textContent);
      return id ? { id, title, answer } : null;
    }).filter(Boolean);
  }

  async function saveOptionAnswer(voteId, optionId, answer) {
    const params = currentParams();
    params.set('playbook_id', params.get('playbook_id') || '');
    params.set('vote_id', voteId);
    const url = `/16d7m/playbook/voteoptions/${encodeURIComponent(optionId)}/edit?${params.toString()}`;
    const { form } = await loadForm(url);
    const targetType = formFieldValue(form, 'select[name="target_type"]');
    const visibleTargetId = form.querySelector('.cascade-group:not(.hide) select[name="target_id"]')?.value;
    const body = collectFormFields(form, {
      playbook_id: params.get('playbook_id') || '',
      vote_id: voteId,
      is_answer: answer ? 'on' : 'off',
      target_type: targetType,
      _method: 'PUT',
    });
    body.delete('target_type');
    body.set('target_type', targetType || '0');
    if (targetType && targetType !== '0') {
      body.delete('target_id');
      body.delete('target_id1');
      body.set('target_id', visibleTargetId || '');
    } else {
      body.delete('target_id');
      body.set('target_id1', formFieldValue(form, 'input[name="target_id1"]') || '0');
    }
    body.delete('image');
    body.delete('after-save');
    await postForm(form, `/16d7m/playbook/voteoptions/${encodeURIComponent(optionId)}`, body);
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bb-vote-batch-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 10px; }
      .bb-vote-batch-toolbar .btn { margin:0; }
      th.bb-vote-select-cell, td.bb-vote-select-cell { width:44px; min-width:44px; text-align:center; vertical-align:middle; }
      .bb-vote-select-cell input { width:16px; height:16px; cursor:pointer; }
      #${OPTION_MODAL_ID}, #${ANSWER_MODAL_ID} { position:fixed; z-index:2147483647; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.48); }
      .bb-vote-modal-panel { width:min(820px, calc(100vw - 36px)); max-height:calc(100vh - 44px); overflow:auto; box-sizing:border-box; padding:22px; border-radius:6px; background:#fff; box-shadow:0 12px 40px rgba(0,0,0,.35); }
      .bb-vote-modal-panel h3 { margin:0 0 10px; font-size:22px; }
      .bb-vote-modal-panel p { color:#66788a; line-height:1.6; }
      .bb-vote-batch-item { margin:12px 0; padding:12px; border:1px solid #d9e2ec; border-radius:4px; }
      .bb-vote-batch-item strong { display:block; margin-bottom:8px; color:#40566c; line-height:1.5; }
      .bb-vote-batch-item textarea { width:100%; min-height:100px; resize:vertical; box-sizing:border-box; padding:9px; border:1px solid #c9d5e1; border-radius:3px; line-height:1.55; }
      .bb-vote-option-preview { margin-top:8px; padding:8px 10px; border-radius:3px; background:#f5f9fc; color:#536b80; line-height:1.7; }
      .bb-vote-option-preview.is-empty { color:#9aa8b5; }
      .bb-vote-option-preview-title { color:#40566c; font-weight:600; }
      .bb-vote-option-preview-list { margin:3px 0 0; padding-left:22px; }
      .bb-vote-option-summary { margin-top:12px; padding:10px 12px; border-radius:3px; background:#f5f9fc; color:#337ab7; line-height:1.7; }
      .bb-vote-option-summary.is-empty { color:#9aa8b5; }
      .bb-vote-option-summary-list { margin:3px 0 0; padding-left:22px; }
      .bb-vote-answer-option { display:inline-flex; align-items:center; gap:5px; margin:5px 15px 2px 0; color:#435a70; }
      .bb-vote-answer-option input { width:16px; height:16px; }
      .bb-vote-batch-status { min-height:22px; margin-top:10px; white-space:pre-line; color:#337ab7; line-height:1.55; }
      .bb-vote-batch-status.is-error { color:#d9534f; }
      .bb-vote-batch-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal(id) {
    document.getElementById(id)?.remove();
  }

  function modalTargets() {
    const targets = selectedVotes();
    if (!targets.length) {
      window.alert('请先勾选至少一个投票。');
      return null;
    }
    return targets;
  }

  function openOptionModal() {
    const targets = modalTargets();
    if (!targets) return;
    closeModal(OPTION_MODAL_ID);
    addStyles();
    const modal = document.createElement('div');
    modal.id = OPTION_MODAL_ID;
    modal.innerHTML = `<div class="bb-vote-modal-panel">
      <h3>批量添加投票选项</h3>
      <p>每个投票填写一组选项，支持每行一个，或使用 A.、B.、C. 标记连续选项，也支持逗号、顿号或分号分隔。下方会实时预览分词结果，提交后逐条创建为非正确答案选项。</p>
      <div class="bb-vote-batch-list"></div>
      <div class="bb-vote-option-summary is-empty">将创建 0 个选项。</div>
      <div class="bb-vote-batch-status"></div>
      <div class="bb-vote-batch-actions"><button type="button" class="btn btn-default bb-vote-cancel">取消</button><button type="button" class="btn btn-danger bb-vote-confirm">确认创建 0 个选项</button></div>
    </div>`;
    document.body.appendChild(modal);
    const list = modal.querySelector('.bb-vote-batch-list');
    targets.forEach(target => {
      const item = document.createElement('div');
      item.className = 'bb-vote-batch-item';
      item.innerHTML = `<strong>${target.title}（投票 ID：${target.id}）</strong><textarea data-vote-id="${target.id}" placeholder="例如：\n选项 A\n选项 B\n选项 C"></textarea><div class="bb-vote-option-preview is-empty"><span class="bb-vote-option-preview-title">选项预览：</span><span class="bb-vote-option-preview-empty">请输入选项</span></div>`;
      list.appendChild(item);
    });
    const status = modal.querySelector('.bb-vote-batch-status');
    const confirm = modal.querySelector('.bb-vote-confirm');
    const summary = modal.querySelector('.bb-vote-option-summary');
    const updatePreview = area => {
      const preview = area.parentElement.querySelector('.bb-vote-option-preview');
      if (!preview) return [];
      const options = parseVoteOptions(area.value);
      preview.classList.toggle('is-empty', options.length === 0);
      preview.innerHTML = `<span class="bb-vote-option-preview-title">选项预览：</span>${options.length
        ? `<ol class="bb-vote-option-preview-list">${options.map(option => `<li>${escapeHtml(option)}</li>`).join('')}</ol>`
        : '<span class="bb-vote-option-preview-empty">请输入选项</span>'}`;
      return options;
    };
    const updateCount = () => {
      const entries = Array.from(modal.querySelectorAll('textarea')).map(area => ({
        title: targets.find(target => target.id === area.getAttribute('data-vote-id'))?.title || `投票 ${area.getAttribute('data-vote-id')}`,
        options: parseVoteOptions(area.value),
      })).filter(entry => entry.options.length);
      const count = entries.reduce((total, entry) => total + entry.options.length, 0);
      confirm.textContent = `确认创建 ${count} 个选项`;
      summary.classList.toggle('is-empty', count === 0);
      summary.innerHTML = count
        ? `<div><strong>将创建 ${count} 个选项：</strong></div><ol class="bb-vote-option-summary-list">${entries.map(entry => `<li>${escapeHtml(entry.title)}：${entry.options.map(escapeHtml).join('、')}</li>`).join('')}</ol>`
        : '将创建 0 个选项。';
      return count;
    };
    modal.querySelectorAll('textarea').forEach(area => area.addEventListener('input', () => {
      updatePreview(area);
      updateCount();
    }));
    modal.querySelector('.bb-vote-cancel').onclick = () => closeModal(OPTION_MODAL_ID);
    confirm.onclick = async () => {
      if (confirm.dataset.finished === 'true') { closeModal(OPTION_MODAL_ID); window.location.reload(); return; }
      const jobs = [];
      modal.querySelectorAll('textarea').forEach(area => parseVoteOptions(area.value).forEach(title => jobs.push({ voteId: area.getAttribute('data-vote-id'), title })));
      if (!jobs.length) { status.textContent = '请至少填写一个投票选项。'; status.classList.add('is-error'); return; }
      confirm.disabled = true;
      modal.querySelector('.bb-vote-cancel').disabled = true;
      modal.querySelectorAll('textarea').forEach(area => { area.disabled = true; });
      let done = 0;
      const failures = [];
      for (const job of jobs) {
        status.textContent = `正在创建 ${done + failures.length + 1}/${jobs.length}：${job.title}`;
        try { await createOption(job.voteId, job.title); done += 1; }
        catch (error) { failures.push(`投票 ${job.voteId} / ${job.title}：${error.message || error}`); }
      }
      status.textContent = `已成功创建 ${done}/${jobs.length} 个选项。${failures.length ? `\n失败：\n${failures.join('\n')}` : ''}`;
      status.classList.toggle('is-error', failures.length > 0);
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.textContent = failures.length ? '关闭并刷新' : '完成并刷新';
    };
    updateCount();
  }

  async function openAnswerModal() {
    const targets = modalTargets();
    if (!targets) return;
    closeModal(ANSWER_MODAL_ID);
    addStyles();
    const modal = document.createElement('div');
    modal.id = ANSWER_MODAL_ID;
    modal.innerHTML = `<div class="bb-vote-modal-panel">
      <h3>批量设置投票正确答案</h3>
      <p>每个投票勾选一个或多个正确选项；不勾选表示清除该投票的全部正确答案。</p>
      <div class="bb-vote-batch-list"></div>
      <div class="bb-vote-batch-status">正在读取已选投票的选项…</div>
      <div class="bb-vote-batch-actions"><button type="button" class="btn btn-default bb-vote-cancel">取消</button><button type="button" class="btn btn-danger bb-vote-confirm" disabled>确认保存</button></div>
    </div>`;
    document.body.appendChild(modal);
    const list = modal.querySelector('.bb-vote-batch-list');
    const status = modal.querySelector('.bb-vote-batch-status');
    const state = new Map();
    const errors = [];
    for (const target of targets) {
      const item = document.createElement('div');
      item.className = 'bb-vote-batch-item';
      item.innerHTML = `<strong>${target.title}（投票 ID：${target.id}）</strong><div class="bb-vote-answer-options">正在读取选项…</div>`;
      list.appendChild(item);
      try {
        const options = await loadOptions(target.id);
        state.set(target.id, options);
        const optionBox = item.querySelector('.bb-vote-answer-options');
        optionBox.replaceChildren();
        if (!options.length) { optionBox.textContent = '该投票暂无选项。'; continue; }
        options.forEach(option => {
          const label = document.createElement('label');
          label.className = 'bb-vote-answer-option';
          const input = document.createElement('input');
          input.type = 'checkbox'; input.checked = option.answer;
          input.setAttribute('data-vote-id', target.id); input.setAttribute('data-option-id', option.id);
          label.append(input, document.createTextNode(option.title));
          optionBox.appendChild(label);
        });
      } catch (error) {
        errors.push(`${target.title}：${error.message || error}`);
        item.querySelector('.bb-vote-answer-options').textContent = `读取失败：${error.message || error}`;
      }
    }
    status.textContent = errors.length ? `部分投票读取失败：\n${errors.join('\n')}` : '请选择正确答案后保存。';
    status.classList.toggle('is-error', errors.length > 0);
    const confirm = modal.querySelector('.bb-vote-confirm');
    confirm.disabled = false;
    modal.querySelector('.bb-vote-cancel').onclick = () => closeModal(ANSWER_MODAL_ID);
    confirm.onclick = async () => {
      if (confirm.dataset.finished === 'true') { closeModal(ANSWER_MODAL_ID); window.location.reload(); return; }
      confirm.disabled = true;
      modal.querySelector('.bb-vote-cancel').disabled = true;
      let done = 0;
      const failures = [];
      for (const target of targets) {
        const options = state.get(target.id) || [];
        const chosen = new Set(Array.from(modal.querySelectorAll(`input[data-vote-id="${target.id}"]:checked`)).map(input => input.getAttribute('data-option-id')));
        for (const option of options) {
          status.textContent = `正在保存 ${done + 1}/${targets.reduce((total, item) => total + (state.get(item.id)?.length || 0), 0)}：${target.title} / ${option.title}`;
          try { await saveOptionAnswer(target.id, option.id, chosen.has(option.id)); done += 1; }
          catch (error) { failures.push(`${target.title} / ${option.title}：${error.message || error}`); }
        }
      }
      status.textContent = `已处理 ${done} 个选项。${failures.length ? `\n失败：\n${failures.join('\n')}` : ''}`;
      status.classList.toggle('is-error', failures.length > 0);
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.textContent = failures.length ? '关闭并刷新' : '完成并刷新';
    };
  }

  function ensureSelectionControls(table) {
    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector(`th[${HEADER_CHECKBOX_ATTRIBUTE}]`)) {
      const header = document.createElement('th');
      header.className = 'bb-vote-select-cell';
      header.setAttribute(HEADER_CHECKBOX_ATTRIBUTE, 'true');
      header.innerHTML = '<label title="全选当前页投票"><input type="checkbox" aria-label="全选当前页投票"></label>';
      header.querySelector('input').addEventListener('change', event => {
        table.querySelectorAll(`input[${ROW_CHECKBOX_ATTRIBUTE}]`).forEach(input => { input.checked = event.target.checked; });
      });
      headerRow.insertBefore(header, headerRow.firstElementChild);
    }
    voteRows(table).forEach(vote => {
      if (vote.row.querySelector(`td[${ROW_CHECKBOX_ATTRIBUTE}]`)) return;
      const cell = document.createElement('td');
      cell.className = 'bb-vote-select-cell';
      cell.setAttribute(ROW_CHECKBOX_ATTRIBUTE, 'true');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.setAttribute(ROW_CHECKBOX_ATTRIBUTE, 'true');
      input.setAttribute('data-vote-id', vote.id); input.setAttribute('data-vote-title', vote.title);
      input.setAttribute('aria-label', `选择投票 ${vote.title}`);
      cell.appendChild(input);
      vote.row.insertBefore(cell, vote.row.firstElementChild);
    });
  }

  function ensureButtons(table) {
    const grid = table.closest('.grid-box');
    const header = Array.from(grid?.querySelectorAll('.box-header') || [])
      .find(item => !item.classList.contains('filter-box')) || table.parentElement;
    if (!header) return;
    let toolbar = header.querySelector('.bb-vote-batch-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'bb-vote-batch-toolbar';
      header.insertBefore(toolbar, header.firstElementChild);
    }
    if (!toolbar.querySelector(`[${OPTION_BUTTON_ATTRIBUTE}]`)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn-warning'; button.textContent = '批量添加投票选项';
      button.setAttribute(OPTION_BUTTON_ATTRIBUTE, 'true'); button.addEventListener('click', openOptionModal);
      toolbar.appendChild(button);
    }
    if (!toolbar.querySelector(`[${ANSWER_BUTTON_ATTRIBUTE}]`)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn-warning'; button.textContent = '批量设置正确答案';
      button.setAttribute(ANSWER_BUTTON_ATTRIBUTE, 'true'); button.addEventListener('click', openAnswerModal);
      toolbar.appendChild(button);
    }
  }

  function update() {
    if (!isVoteListPage()) return;
    const table = voteTable();
    if (!table) return;
    addStyles();
    ensureSelectionControls(table);
    ensureButtons(table);
  }

  let updateTimer = 0;
  function scheduleUpdate() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 0);
  }

  // 投票列表是异步 Tab，首次进入时表格和 box-header 可能会被后台重新渲染。
  // 在 Tab 展示、页面加载和 hash 路由变化后的多个时点重试，确保按钮挂载在最终容器上。
  function scheduleUpdateBurst() {
    [0, 50, 150, 300, 600, 1000, 1800].forEach(delay => {
      window.setTimeout(update, delay);
    });
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', scheduleUpdateBurst, { once: true });
  window.addEventListener('load', scheduleUpdateBurst);
  window.addEventListener('pageshow', scheduleUpdateBurst);
  window.addEventListener('hashchange', scheduleUpdateBurst);
  window.addEventListener('popstate', scheduleUpdateBurst);
  document.addEventListener('click', event => {
    const tab = event.target?.closest?.('a[href^="#tab_"], [data-toggle="tab"], [data-bs-toggle="tab"]');
    if (tab) scheduleUpdateBurst();
  }, true);
  if (window.jQuery) {
    window.jQuery(document).on('shown.bs.tab.bbVoteBatch', scheduleUpdateBurst);
  }
  window.setInterval(scheduleUpdate, 700);
  scheduleUpdateBurst();
})();

// 背景音乐列表快速播放：在列表中直接播放/暂停当前音乐，播放新音乐时自动暂停上一首。
(() => {
  'use strict';

  const STYLE_ID = 'bb-music-list-preview-style';
  const BUTTON_ATTRIBUTE = 'data-bb-music-list-preview';
  let activeAudio = null;
  let activeButton = null;
  let requestSerial = 0;
  const audioUrlPromises = new WeakMap();

  const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isMusicList = () => /\/playbook\/bmgs\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bb-music-list-preview-button { margin-left: 6px; padding: 1px 6px; line-height: 1.4; vertical-align: middle; }
      .bb-music-list-preview-button.is-loading { cursor: wait; opacity: .75; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function setButtonState(button, state) {
    if (!button) return;
    button.classList.toggle('is-loading', state === 'loading');
    button.disabled = state === 'loading';
    if (state === 'playing') {
      button.textContent = '⏸';
      button.title = '暂停播放';
      button.setAttribute('aria-label', '暂停播放');
    } else if (state === 'loading') {
      button.textContent = '…';
      button.title = '正在加载音频';
      button.setAttribute('aria-label', '正在加载音频');
    } else if (state === 'error') {
      button.textContent = '▶';
      button.title = '音频加载失败，点击重试';
      button.setAttribute('aria-label', '音频加载失败，点击重试');
    } else {
      button.textContent = '▶';
      button.title = '播放音频';
      button.setAttribute('aria-label', '播放音频');
    }
  }

  function stopActiveAudio() {
    const audio = activeAudio;
    const button = activeButton;
    activeAudio = null;
    activeButton = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setButtonState(button, 'idle');
  }

  function decodeAudioUrlValue(value) {
    let decoded = String(value || '').trim();
    if (!decoded) return '';
    // Laravel Admin 的 fileinput 会把地址写进 JSON 脚本，斜杠和中文常被转义。
    decoded = decoded
      .replace(/\\\//g, '/')
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    try {
      const textarea = new DOMParser()
        .parseFromString(`<textarea>${decoded}</textarea>`, 'text/html')
        .querySelector('textarea');
      decoded = textarea?.value || decoded;
    } catch (_) { /* 保留原值 */ }
    return decoded.trim();
  }

  function normalizeAudioUrl(value, sourceUrl) {
    const decoded = decodeAudioUrlValue(value);
    if (!decoded || /^javascript:/i.test(decoded)) return '';
    try { return new URL(decoded, sourceUrl).href; } catch (_) { return ''; }
  }

  function getAudioUrls(doc, sourceUrl, html = '') {
    const attributeNames = [
      'src',
      'href',
      'value',
      'data-url',
      'data-src',
      'data-file',
      'data-download-url',
      'data-initial-preview'
    ];
    const candidates = Array.from(doc.querySelectorAll(
      'audio, source, a[href], input, [data-url], [data-src], [data-file], [data-download-url], [data-initial-preview]'
    )).flatMap(element => attributeNames.map(name => element.getAttribute(name) || ''));

    // 编辑页原始 HTML 中，音频地址还会出现在 fileinput 的 downloadUrl JSON 配置里。
    const serializedSource = `${html}\n${Array.from(doc.querySelectorAll('script'))
      .map(script => script.textContent || '')
      .join('\n')}`;
    const serializedMatches = serializedSource.match(
      /https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp3|wav|ogg|m4a|aac|flac)(?:\\?[?#][^"'<>\s]*)?/gi
    ) || [];
    candidates.push(...serializedMatches);

    const normalizedCandidates = candidates
      .map(value => normalizeAudioUrl(value, sourceUrl))
      .filter(Boolean);
    const audioUrls = normalizedCandidates.filter(url =>
      /\.(mp3|wav|ogg|m4a|aac|flac)(?:[?#]|$)/i.test(url)
      || /\/files\//i.test(url)
    );
    const uniqueUrls = Array.from(new Set(audioUrls));
    // 后台页面是 HTTPS，但部分历史音频地址仍是 HTTP；两种协议都保留，播放时依次尝试。
    return Array.from(new Set(uniqueUrls.flatMap(url => {
      if (location.protocol === 'https:' && /^http:/i.test(url)) {
        return [url.replace(/^http:/i, 'https:'), url];
      }
      return [url];
    })));
  }

  async function loadAudioUrls(music) {
    const editUrl = music.editLink?.href;
    if (!editUrl) throw new Error('未找到音乐编辑页面');
    const response = await fetch(editUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取音乐失败：HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const urls = getAudioUrls(doc, editUrl, html);
    if (!urls.length) throw new Error('未找到音频地址');
    return urls;
  }

  function getCachedAudioUrls(button) {
    if (!button) return [];
    try {
      const urls = JSON.parse(button.dataset.audioUrls || '[]');
      if (Array.isArray(urls) && urls.length) return urls;
    } catch (_) { /* 继续兼容旧缓存 */ }
    return button.dataset.audioUrl ? [button.dataset.audioUrl] : [];
  }

  function primeAudioUrls(music, button) {
    const cached = getCachedAudioUrls(button);
    if (cached.length) return Promise.resolve(cached);
    const existing = audioUrlPromises.get(button);
    if (existing) return existing;
    const promise = loadAudioUrls(music)
      .then(urls => {
        if (button.isConnected) {
          button.dataset.audioUrls = JSON.stringify(urls);
          button.dataset.audioUrl = urls[0];
          delete button.dataset.audioError;
        }
        return urls;
      })
      .catch(error => {
        audioUrlPromises.delete(button);
        throw error;
      });
    audioUrlPromises.set(button, promise);
    return promise;
  }

  async function playAudioUrls(audio, urls) {
    let lastError = null;
    for (const url of urls) {
      audio.src = url;
      audio.load();
      try {
        // 这个调用必须发生在用户点击的同步调用链中，不能在这里之前再等待网络请求。
        await audio.play();
        return url;
      } catch (error) {
        lastError = error;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    }
    throw lastError || new Error('音频播放失败');
  }

  async function togglePreview(music, button) {
    if (button === activeButton && activeAudio) {
      try {
        if (activeAudio.paused) {
          await activeAudio.play();
          setButtonState(button, 'playing');
        } else {
          activeAudio.pause();
          setButtonState(button, 'idle');
        }
      } catch (error) {
        setButtonState(button, 'error');
        console.warn('[百变后台音乐预览] 恢复播放失败', error);
      }
      return;
    }

    stopActiveAudio();
    const serial = ++requestSerial;
    setButtonState(button, 'loading');
    try {
      // 地址未预取完成时先完成预取，不在异步请求结束后强行播放，避免触发浏览器自动播放拦截。
      const urls = getCachedAudioUrls(button);
      if (!urls.length) {
        await primeAudioUrls(music, button);
        if (serial === requestSerial && button.isConnected) {
          setButtonState(button, 'idle');
          button.title = '音频地址已准备好，请再次点击播放';
        }
        return;
      }
      if (serial !== requestSerial || !button.isConnected) {
        if (button.isConnected) setButtonState(button, 'idle');
        return;
      }
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.addEventListener('ended', () => {
        if (activeAudio === audio) {
          setButtonState(button, 'idle');
          activeAudio = null;
          activeButton = null;
        }
      });
      // 地址可能需要从 HTTPS 回退到 HTTP。候选地址尝试期间不能让首个 error
      // 清空播放器引用，否则后续地址虽然播放成功，暂停按钮也找不到该实例。
      await playAudioUrls(audio, urls);
      if (serial !== requestSerial || !button.isConnected) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (button.isConnected) setButtonState(button, 'idle');
        return;
      }
      activeAudio = audio;
      activeButton = button;
      audio.addEventListener('error', () => {
        if (activeAudio === audio) {
          setButtonState(button, 'error');
          activeAudio = null;
          activeButton = null;
        }
      });
      setButtonState(button, 'playing');
    } catch (error) {
      if (serial === requestSerial) {
        stopActiveAudio();
        setButtonState(button, 'error');
        console.warn('[百变后台音乐预览] 播放失败', error);
      }
    }
  }

  function getMusicFromRow(row) {
    const editLink = Array.from(row.querySelectorAll('a[href]')).find(link =>
      /\/playbook\/bmgs\/\d+\/edit/.test(link.getAttribute('href') || '')
    );
    if (!editLink) return null;
    const id = (editLink.getAttribute('href') || '').match(/\/playbook\/bmgs\/(\d+)\/edit/)?.[1]
      || normalizeText(row.children[0]?.textContent);
    const nameCell = row.children[1];
    const name = normalizeText(nameCell?.childNodes[0]?.textContent || nameCell?.textContent) || `音乐 ${id}`;
    return id ? { id, name, editLink } : null;
  }

  function updateButtons() {
    if (!isMusicList()) return;
    addStyles();
    document.querySelectorAll('table tbody tr').forEach(row => {
      const music = getMusicFromRow(row);
      if (!music) return;
      const nameCell = row.children[1];
      if (!nameCell || nameCell.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-default bb-music-list-preview-button';
      button.setAttribute(BUTTON_ATTRIBUTE, music.id);
      setButtonState(button, 'idle');
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        togglePreview(getMusicFromRow(row) || music, button);
      });
      nameCell.appendChild(button);
      // 预先读取真实音频地址，确保用户点击时可以直接调用 audio.play()。
      primeAudioUrls(music, button).catch(error => {
        if (button.isConnected) {
          button.dataset.audioError = error.message || '音频地址读取失败';
          setButtonState(button, 'idle');
        }
      });
    });
  }

  function schedule() {
    window.clearTimeout(schedule.timer);
    schedule.timer = window.setTimeout(updateButtons, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('beforeunload', stopActiveAudio);
  window.setInterval(updateButtons, 700);
  updateButtons();
})();

// 礼包/合集快速添加剧本：按剧本名称匹配后台商品，并复用原生创建表单逐条提交。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-quick-add-pack-playbooks';
  const MODAL_ID = 'bb-quick-add-pack-playbooks-modal';
  const STYLE_ID = 'bb-quick-add-pack-playbooks-style';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));
  const isListPage = () => /\/pack\/products\/?$/.test(location.pathname)
    && Boolean(new URL(location.href).searchParams.get('pack_id'));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-left: 8px; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.44); }
      #${MODAL_ID} .bb-pack-playbook-dialog { width: min(620px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-pack-playbook-hint { margin-bottom: 10px; color: #687786; line-height: 1.6; }
      #${MODAL_ID} textarea { box-sizing: border-box; width: 100%; min-height: 190px; padding: 9px; border: 1px solid #ccd6df; border-radius: 4px; resize: vertical; }
      #${MODAL_ID} .bb-pack-playbook-status { min-height: 24px; margin-top: 10px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-pack-playbook-error { color: #c0392b; }
      #${MODAL_ID} .bb-pack-playbook-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/pack/products/create"]'))
      .find(link => /添加商品/.test(normalize(link.textContent)))
      || document.querySelector('a[href*="/pack/products/create"]');
  }

  function parseNames(value) {
    const seen = new Set();
    return String(value || '')
      .split(/\r?\n|[，,；;]+/)
      .map(normalize)
      .filter(name => name && !seen.has(name) && seen.add(name));
  }

  function getGroupLabel(control) {
    const group = control?.closest('.form-group, .form-row, .field, .row');
    return normalize(group?.querySelector('label, .control-label')?.textContent || '');
  }

  function setControlValue(control, value) {
    if (!control) return;
    const textValue = String(value ?? '');
    control.value = textValue;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      const jq = control.ownerDocument?.defaultView?.jQuery;
      if (jq) jq(control).val(textValue).trigger('change');
    } catch (_) { /* 原生 change 已完成 */ }
  }

  function findProductType(form) {
    return Array.from(form.querySelectorAll('select')).find(select =>
      getGroupLabel(select) === '商品类型'
      && Array.from(select.options).some(option => normalize(option.textContent) === '剧本')
    ) || null;
  }

  function findProductControl(form, typeSelect) {
    const groups = Array.from(form.querySelectorAll('.form-group, .form-row, .field'));
    for (const group of groups) {
      const label = normalize(group.querySelector('label, .control-label')?.textContent || '');
      if (label !== '商品名称') continue;
      // 后台有些页面会同时保留 Select2 的隐藏 input 和真正的 select。
      // 优先使用 select，避免拿到切换商品类型前遗留的隐藏控件。
      const control = group.querySelector('select[name]')
        || group.querySelector('input[type="hidden"][name]');
      if (control && control !== typeSelect) return control;
    }
    const candidates = [
      ...form.querySelectorAll('select[name]'),
      ...form.querySelectorAll('input[type="hidden"][name]'),
    ];
    return candidates.find(control => control !== typeSelect
      && /商品名称/.test(normalize(control.closest('.form-group, .form-row, .field, .row')?.textContent))) || null;
  }

  function getSelect2Instance(control) {
    try {
      const jq = control?.ownerDocument?.defaultView?.jQuery;
      return jq?.(control).data('select2') || null;
    } catch (_) {
      return null;
    }
  }

  function getSelect2Container(control) {
    if (!control) return null;
    const doc = control.ownerDocument;
    if (control.id) {
      const legacy = doc.getElementById(`s2id_${control.id}`);
      if (legacy) return legacy;
    }
    const sibling = control.nextElementSibling;
    if (sibling?.classList?.contains('select2-container')) return sibling;
    return control.closest('.form-group, .form-row, .field, .row')?.querySelector('.select2-container') || null;
  }

  function isSearchableProductControl(control) {
    if (!control) return false;
    if (control.tagName === 'SELECT'
      && Array.from(control.options || []).some(option => option.value)) return true;
    const instance = getSelect2Instance(control);
    return Boolean(instance?.dataAdapter?.query
      || instance?.opts?.query
      || instance?.options?.options?.ajax
      || instance?.opts?.ajax
      || getSelect2Container(control));
  }

  async function prepareLiveForm(createUrl) {
    const frame = document.createElement('iframe');
    // 保留正常的页面尺寸，Select2 才会完整初始化搜索框和结果列表；整体移出视口即可。
    frame.style.cssText = 'position:fixed;width:1280px;height:900px;left:-10000px;top:-10000px;border:0;';
    document.body.appendChild(frame);
    try {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('添加商品页面加载超时')), 15000);
        frame.addEventListener('load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
        frame.src = createUrl;
      });
      const doc = frame.contentDocument;
      const form = Array.from(doc?.forms || []).find(item =>
        String(item.method).toLowerCase() === 'post' && findProductType(item)
      );
      if (!form) throw new Error('没有识别到添加商品表单');
      const typeSelect = findProductType(form);
      const playbookOption = Array.from(typeSelect.options)
        .find(option => normalize(option.textContent) === '剧本');
      if (!playbookOption) throw new Error('商品类型中没有找到“剧本”');
      const previousProductControl = findProductControl(form, typeSelect);
      setControlValue(typeSelect, playbookOption.value);

      // 商品名称是跟随商品类型异步重建的级联下拉框。先给后台一次重建机会，
      // 再读取当前控件，避免查询到切换前的空下拉框。
      await wait(700);
      let productControl = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const current = findProductControl(form, typeSelect);
        if (current && (current !== previousProductControl || isSearchableProductControl(current))) {
          productControl = current;
          break;
        }
        await wait(200);
      }
      if (!productControl) throw new Error('选择“剧本”后没有识别到商品名称下拉框');
      return { frame, doc, form, typeSelect, productControl };
    } catch (error) {
      frame.remove();
      throw error;
    }
  }

  function flattenResults(items, output = []) {
    (items || []).forEach(item => {
      if (Array.isArray(item.children)) flattenResults(item.children, output);
      else if (item && item.id != null && normalize(item.text)) output.push({ id: String(item.id), text: normalize(item.text) });
    });
    return output;
  }

  function canonicalTitle(value) {
    return normalize(value)
      .replace(/[|｜]\s*\d+\s*$/, '')
      .replace(/\s*\(\s*ID\s*[:：]?\s*\d+\s*\)\s*$/i, '')
      .trim();
  }

  function chooseProduct(results, requestedName) {
    const target = normalize(requestedName);
    const unique = Array.from(new Map(results.map(item => [String(item.id || item.text), item])).values());
    const exact = unique.filter(item => canonicalTitle(item.text) === target);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw new Error(`找到多个同名剧本“${requestedName}”，请改用更明确的名称`);
    const contains = unique.filter(item => canonicalTitle(item.text).includes(target));
    if (contains.length === 1) return contains[0];
    if (contains.length > 1) throw new Error(`“${requestedName}”匹配到多个剧本，请输入完整名称`);
    throw new Error(`没有找到剧本“${requestedName}”`);
  }

  function querySelect2(control, term) {
    const jq = control.ownerDocument?.defaultView?.jQuery;
    const instance = jq?.(control).data('select2');
    if (!instance) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = data => {
        if (finished) return;
        finished = true;
        resolve(flattenResults(data?.results || data));
      };
      const timer = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        reject(new Error(`搜索“${term}”超时`));
      }, 10000);
      const complete = data => {
        window.clearTimeout(timer);
        finish(data);
      };
      try {
        if (instance.dataAdapter?.query) {
          instance.dataAdapter.query({ term, page: 1 }, complete);
        } else if (typeof instance.opts?.query === 'function') {
          instance.opts.query({ term, page: 1, callback: complete });
        } else {
          window.clearTimeout(timer);
          finish([]);
        }
      } catch (error) {
        window.clearTimeout(timer);
        reject(error);
      }
    });
  }

  async function querySelect2Interface(control, term) {
    const doc = control.ownerDocument;
    const win = doc.defaultView;
    const jq = win?.jQuery;
    const container = getSelect2Container(control);
    if (!container && !getSelect2Instance(control)) return [];

    let opened = false;
    if (jq && getSelect2Instance(control)) {
      try {
        jq(control).select2('open');
        opened = true;
      } catch (_) { /* 使用 DOM 事件兼容隔离脚本环境 */ }
    }
    if (!opened && container) {
      const opener = container.querySelector('.select2-selection, .select2-choice') || container;
      ['mousedown', 'mouseup', 'click'].forEach(type => opener.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: win,
      })));
    }

    const searchSelectors = [
      '.select2-container--open .select2-search__field',
      '.select2-drop-active .select2-input',
      '.select2-drop.select2-drop-active input.select2-input',
    ];
    let search = null;
    for (let attempt = 0; attempt < 20 && !search; attempt += 1) {
      search = searchSelectors.map(selector => doc.querySelector(selector)).find(Boolean) || null;
      if (!search) await wait(100);
    }
    if (!search) {
      if (jq) try { jq(control).select2('close'); } catch (_) { /* 忽略 */ }
      return [];
    }

    search.value = term;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keyup', {
      bubbles: true,
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      which: 65,
    }));
    search.dispatchEvent(new Event('change', { bubbles: true }));
    if (jq) try {
      jq(search).val(term).trigger('input').trigger('keyup').trigger('change');
    } catch (_) { /* 原生事件已触发 */ }

    const resultSelectors = [
      '.select2-container--open .select2-results__option[aria-selected]',
      '.select2-drop-active .select2-result-selectable',
    ];
    let resultNodes = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      resultNodes = resultSelectors.flatMap(selector => Array.from(doc.querySelectorAll(selector)))
        .filter((node, index, nodes) => nodes.indexOf(node) === index)
        .filter(node => !/正在搜索|搜索中|加载中|没有找到|无结果/i.test(normalize(node.textContent)));
      const hasRequestedResult = resultNodes.some(node => canonicalTitle(node.textContent).includes(normalize(term)));
      if (hasRequestedResult || (attempt >= 10 && resultNodes.length)) break;
      await wait(150);
    }

    const results = resultNodes.map(node => {
      const data = jq ? (jq(node).data('data') || jq(node).data('select2-data') || {}) : {};
      const id = data.id ?? node.getAttribute('data-id') ?? node.dataset?.value;
      return { id: id == null ? '' : String(id), text: normalize(data.text || node.textContent), node };
    }).filter(item => item.text);

    let matched = null;
    try {
      matched = chooseProduct(results.map(({ id, text }) => ({ id, text })), term);
    } catch (_) {
      search.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      if (jq) try { jq(control).select2('close'); } catch (_) { /* 忽略 */ }
      return results.filter(item => item.id).map(({ id, text }) => ({ id, text }));
    }

    const matchedNode = results.find(item => item.id === matched.id && item.text === matched.text)?.node;
    if (matchedNode) {
      ['mousedown', 'mouseup', 'click'].forEach(type => matchedNode.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: win,
      })));
      await wait(200);
    }
    if (jq) try { jq(control).select2('close'); } catch (_) { /* 忽略 */ }
    const selectedId = String(control.value || matched.id || '');
    return selectedId ? [{ id: selectedId, text: matched.text }] : [];
  }

  async function resolveProduct(control, requestedName) {
    const nativeResults = control.tagName === 'SELECT'
      ? Array.from(control.options).filter(option => option.value)
        .map(option => ({ id: String(option.value), text: normalize(option.textContent) }))
      : [];
    try {
      return chooseProduct(nativeResults, requestedName);
    } catch (_) {
      let remoteResults = [];
      try {
        remoteResults = await querySelect2(control, requestedName);
      } catch (_) { /* 继续尝试真实下拉框搜索 */ }
      try {
        return chooseProduct(remoteResults, requestedName);
      } catch (_) {
        const interfaceResults = await querySelect2Interface(control, requestedName);
        return chooseProduct(interfaceResults, requestedName);
      }
    }
  }

  function selectProduct(form, control, product) {
    if (control.tagName === 'SELECT') {
      let option = Array.from(control.options).find(item => String(item.value) === product.id);
      if (!option) {
        option = new Option(product.text, product.id, true, true);
        control.add(option);
      }
      Array.from(control.options).forEach(item => { item.selected = item === option; });
    }
    const name = control.getAttribute('name');
    if (name) {
      Array.from(form.querySelectorAll(`[name="${CSS.escape(name)}"]`)).forEach(item => {
        if (item !== control && item.type === 'hidden') item.value = product.id;
      });
    }
    setControlValue(control, product.id);
  }

  async function checkCreateResponse(response, requestedName) {
    const text = await response.text();
    if (!response.ok) throw new Error(`添加“${requestedName}”失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      let payload = null;
      try { payload = JSON.parse(text); } catch (_) { return; }
      if (payload?.status === false || payload?.success === false) {
        throw new Error(normalize(payload.message) || `后台未接受“${requestedName}”`);
      }
      return;
    }
    const resultDoc = new DOMParser().parseFromString(text, 'text/html');
    const errorText = normalize(resultDoc.querySelector('.alert-danger, .callout-danger, .has-error .help-block')?.textContent);
    if (errorText) throw new Error(errorText);
    if (/\/pack\/products\/create\/?$/.test(new URL(response.url).pathname)) {
      throw new Error(`后台未接受“${requestedName}”，请检查剧本匹配结果`);
    }
  }

  async function createProduct(createUrl, live, requestedName) {
    // 级联控件可能在第一次查询后再次被后台替换，因此每条数据提交前都重新定位。
    const currentControl = findProductControl(live.form, live.typeSelect) || live.productControl;
    live.productControl = currentControl;
    const product = await resolveProduct(currentControl, requestedName);
    selectProduct(live.form, currentControl, product);
    const body = new FormData(live.form);
    const packId = new URL(createUrl).searchParams.get('pack_id') || '';
    if (packId && !body.get('pack_id')) body.append('pack_id', packId);
    const action = new URL(live.form.getAttribute('action') || createUrl, createUrl).href;
    const response = await fetch(action, { method: 'POST', body, credentials: 'same-origin' });
    await checkCreateResponse(response, requestedName);
    return product;
  }

  function openModal(createUrl) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-pack-playbook-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-pack-playbook-title">
        <h3 id="bb-pack-playbook-title">快速添加剧本</h3>
        <div class="bb-pack-playbook-hint">每行输入一个剧本名称，也可以使用逗号或分号分隔。系统将选择“商品类型：剧本”，按名称搜索并逐条添加；其余字段沿用后台默认值。</div>
        <textarea data-bb-pack-playbook-names placeholder="例如：\n暮去朝来\n求真：心怀鬼塔"></textarea>
        <div class="bb-pack-playbook-status" data-bb-pack-playbook-status></div>
        <div class="bb-pack-playbook-actions">
          <button type="button" class="btn btn-default" data-bb-pack-playbook-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-pack-playbook-confirm>确认添加</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('[data-bb-pack-playbook-names]');
    const status = modal.querySelector('[data-bb-pack-playbook-status]');
    const cancel = modal.querySelector('[data-bb-pack-playbook-cancel]');
    const confirm = modal.querySelector('[data-bb-pack-playbook-confirm]');
    let completed = 0;
    const close = () => {
      modal.remove();
      if (completed) window.location.reload();
    };
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });

    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        close();
        return;
      }
      const names = parseNames(input.value);
      if (!names.length) {
        status.className = 'bb-pack-playbook-status bb-pack-playbook-error';
        status.textContent = '请至少输入一个剧本名称';
        return;
      }
      confirm.disabled = true;
      cancel.disabled = true;
      input.disabled = true;
      status.className = 'bb-pack-playbook-status';
      const failures = [];
      for (let index = 0; index < names.length; index += 1) {
        let live = null;
        status.textContent = `正在读取表单并添加 ${index + 1}/${names.length}：${names[index]}`;
        try {
          // 后台新增页包含级联下拉框及表单状态，成功提交一次后不能可靠复用。
          // 每个剧本重新加载一张原生表单，确保默认字段、令牌和控件状态都是新的。
          live = await prepareLiveForm(createUrl);
          await createProduct(createUrl, live, names[index]);
          completed += 1;
        } catch (error) {
          failures.push(`${names[index]}：${error.message || '添加失败'}`);
        } finally {
          live?.frame.remove();
        }
      }

      status.className = failures.length
        ? 'bb-pack-playbook-status bb-pack-playbook-error'
        : 'bb-pack-playbook-status';
      status.textContent = `已成功添加 ${completed}/${names.length} 个剧本。${failures.length ? `\n失败：\n${failures.join('\n')}` : ''}`;
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.textContent = completed ? '完成并刷新' : '关闭';
      cancel.disabled = false;
      cancel.textContent = completed ? '关闭并刷新' : '取消';
    });
    input.focus();
  }

  function update() {
    if (!isListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '快速添加剧本';
    button.addEventListener('click', event => {
      event.preventDefault();
      openModal(createLink.href);
    });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 160);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(update, 800);
  update();
})();

// 地图快捷创建回合动作：在地图列表选择回合，一键创建“全部角色进入该地图”的动作。
(() => {
  'use strict';

  const STYLE_ID = 'bb-round-map-action-style';
  const MODAL_ID = 'bb-round-map-action-modal';
  const BATCH_MODAL_ID = 'bb-round-map-batch-action-modal';
  const BUTTON_ATTRIBUTE = 'data-bb-round-map-action';
  const BATCH_BUTTON_ATTRIBUTE = 'data-bb-round-map-batch-action';
  const SELECT_ATTRIBUTE = 'data-bb-round-map-select';
  const SELECT_ALL_ATTRIBUTE = 'data-bb-round-map-select-all';
  const SELECT_CELL_ATTRIBUTE = 'data-bb-round-map-select-cell';
  const RECORD_ATTRIBUTE = 'data-bb-round-map-record';
  const RECORD_STORAGE_PREFIX = 'bb-round-map-records:';
  let updateTimer = null;

  const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isMapList = () => /\/playbook\/maps\/?$/.test(location.pathname);

  function getPageContext() {
    const url = new URL(location.href);
    const prefixMatch = url.pathname.match(/^\/[^/]+/);
    return {
      playbookId: url.searchParams.get('playbook_id') || '',
      basePath: prefixMatch ? prefixMatch[0] : '/16d7m',
    };
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bb-round-map-action-button { margin-left: 6px; }
      .bb-round-map-batch-button { margin-left: 8px; }
      .bb-round-map-batch-count { margin-left: 8px; color: #6b7b8b; vertical-align: middle; }
      th[${SELECT_CELL_ATTRIBUTE}], td[${SELECT_CELL_ATTRIBUTE}] { width: 42px; min-width: 42px; text-align: center; vertical-align: middle !important; }
      th[${SELECT_CELL_ATTRIBUTE}] input, td[${SELECT_CELL_ATTRIBUTE}] input { margin: 0; }
      span[${RECORD_ATTRIBUTE}] { display: block; margin-top: 5px; color: #00a65a; font-size: 12px; line-height: 1.5; white-space: normal; }
      #${MODAL_ID} { position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.48); }
      #${MODAL_ID} .bb-round-map-dialog { width: min(620px, 94vw); max-height: 86vh; display: flex; flex-direction: column; overflow: hidden; border-radius: 6px; background: #fff; box-shadow: 0 18px 55px rgba(0,0,0,.28); }
      #${MODAL_ID} .bb-round-map-header { padding: 20px 24px 12px; }
      #${MODAL_ID} .bb-round-map-title { margin: 0 0 6px; color: #34495e; font-size: 24px; font-weight: 600; }
      #${MODAL_ID} .bb-round-map-subtitle { color: #6b7b8b; font-size: 14px; }
      #${MODAL_ID} .bb-round-map-note { margin-top: 8px; color: #8a9aa9; font-size: 13px; }
      #${MODAL_ID} .bb-round-map-character-control { margin-top: 12px; padding: 10px 12px; border: 1px solid #d8e3ed; border-radius: 4px; background: #f8fbfd; }
      #${MODAL_ID} .bb-round-map-character-label { display: flex; align-items: center; gap: 8px; margin: 0; color: #34495e; cursor: pointer; font-weight: 600; }
      #${MODAL_ID} .bb-round-map-character-label input { margin: 0; }
      #${MODAL_ID} .bb-round-map-character-match { margin-top: 6px; color: #6b7b8b; font-size: 13px; }
      #${MODAL_ID} .bb-round-map-character-match.is-error { color: #dd4b39; }
      #${MODAL_ID} .bb-round-map-character-match.is-success { color: #00a65a; }
      #${MODAL_ID} .bb-round-map-body { min-height: 150px; padding: 8px 24px 18px; overflow: auto; }
      #${MODAL_ID} .bb-round-map-status { padding: 18px 4px; color: #6b7b8b; }
      #${MODAL_ID} .bb-round-map-status.is-error { color: #dd4b39; }
      #${MODAL_ID} .bb-round-map-list { border: 1px solid #d8e3ed; border-radius: 4px; overflow: hidden; }
      #${MODAL_ID} .bb-round-map-option { display: flex; align-items: center; gap: 10px; margin: 0; padding: 12px 14px; border-bottom: 1px solid #edf1f4; cursor: pointer; font-weight: 400; }
      #${MODAL_ID} .bb-round-map-option:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-round-map-option:hover { background: #f4f9fc; }
      #${MODAL_ID} .bb-round-map-option input { margin: 0; }
      #${MODAL_ID} .bb-round-map-option-id { margin-left: auto; color: #95a5a6; font-size: 12px; }
      #${MODAL_ID} .bb-round-map-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 24px 20px; border-top: 1px solid #edf1f4; }
      #${BATCH_MODAL_ID} { position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.48); }
      #${BATCH_MODAL_ID} .bb-round-map-dialog { width: min(880px, 96vw); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; border-radius: 6px; background: #fff; box-shadow: 0 18px 55px rgba(0,0,0,.28); }
      #${BATCH_MODAL_ID} .bb-round-map-header { padding: 20px 24px 12px; }
      #${BATCH_MODAL_ID} .bb-round-map-title { margin: 0 0 6px; color: #34495e; font-size: 24px; font-weight: 600; }
      #${BATCH_MODAL_ID} .bb-round-map-subtitle { color: #6b7b8b; font-size: 14px; }
      #${BATCH_MODAL_ID} .bb-round-map-body { min-height: 150px; padding: 8px 24px 18px; overflow: auto; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-list { border: 1px solid #d8e3ed; border-radius: 4px; overflow: hidden; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-row { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(260px, 1.25fr); gap: 14px; align-items: center; padding: 12px 14px; border-bottom: 1px solid #edf1f4; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-row:last-child { border-bottom: 0; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-map-name { color: #34495e; font-weight: 600; overflow-wrap: anywhere; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-map-id { margin-top: 3px; color: #95a5a6; font-size: 12px; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-select { width: 100%; min-height: 34px; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-result { margin-top: 12px; padding: 10px 12px; border-radius: 4px; color: #6b7b8b; background: #f4f7f9; white-space: pre-wrap; }
      #${BATCH_MODAL_ID} .bb-round-map-batch-result.is-error { color: #dd4b39; background: #fff3f2; }
      #${BATCH_MODAL_ID} .bb-round-map-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 24px 20px; border-top: 1px solid #edf1f4; }
      @media (max-width: 720px) { #${BATCH_MODAL_ID} .bb-round-map-batch-row { grid-template-columns: 1fr; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function recordsStorageKey() {
    const { playbookId } = getPageContext();
    return `${RECORD_STORAGE_PREFIX}${playbookId || location.pathname}`;
  }

  function readAllRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(recordsStorageKey()) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function readMapRecords(mapId) {
    const records = readAllRecords()[String(mapId)];
    return Array.isArray(records) ? records : [];
  }

  function saveMapRecord(map, round, actionId) {
    try {
      const allRecords = readAllRecords();
      const mapId = String(map.id);
      const records = Array.isArray(allRecords[mapId]) ? allRecords[mapId] : [];
      const nextRecord = {
        roundId: String(round.id),
        roundName: round.name,
        actionId: String(actionId || ''),
        createdAt: Date.now(),
      };
      const existing = records.find(record => String(record.roundId) === String(round.id));
      if (existing) Object.assign(existing, nextRecord);
      else records.push(nextRecord);
      allRecords[mapId] = records;
      localStorage.setItem(recordsStorageKey(), JSON.stringify(allRecords));
    } catch (_) {
      // 本地历史记录不可用时，不影响后台动作和事件的正常创建。
    }
  }

  function renderMapRecord(row, map) {
    const container = map.editLink?.parentElement;
    if (!container) return;
    let recordElement = container.querySelector(`span[${RECORD_ATTRIBUTE}]`);
    if (!recordElement) {
      recordElement = document.createElement('span');
      recordElement.setAttribute(RECORD_ATTRIBUTE, map.id);
      container.appendChild(recordElement);
    }
    const records = readMapRecords(map.id);
    recordElement.textContent = records.length
      ? `所在回合：${records.map(record => `${record.roundName || `回合 ${record.roundId}`}（${record.roundId}）`).join('、')}`
      : '';
    recordElement.hidden = !records.length;
  }

  async function fetchDocument(url, label) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    const html = await response.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function readRounds(doc, sourceUrl) {
    const rounds = [];
    const seen = new Set();
    doc.querySelectorAll('table tbody tr').forEach(row => {
      const editLink = Array.from(row.querySelectorAll('a[href]')).find(link => {
        try {
          const url = new URL(link.getAttribute('href'), sourceUrl);
          return /\/playbook\/scenes\/\d+\/edit\/?$/.test(url.pathname);
        } catch (_) {
          return false;
        }
      });
      const editUrl = editLink ? new URL(editLink.getAttribute('href'), sourceUrl) : null;
      const pathId = editUrl?.pathname.match(/\/playbook\/scenes\/(\d+)\/edit\/?$/)?.[1];
      const cellId = normalizeText(row.children[0]?.textContent).match(/^\d+$/)?.[0];
      const id = pathId || cellId;
      if (!id || seen.has(id)) return;
      const cells = Array.from(row.children);
      const name = normalizeText(cells[1]?.textContent) || `回合 ${id}`;
      seen.add(id);
      rounds.push({ id, name });
    });
    return rounds;
  }

  async function loadRounds() {
    const { playbookId, basePath } = getPageContext();
    if (!playbookId) throw new Error('当前页面缺少剧本 ID');
    const url = new URL(`${basePath}/playbook/scenes`, location.origin);
    url.searchParams.set('playbook_id', playbookId);
    const doc = await fetchDocument(url.href, '读取回合列表');
    const rounds = readRounds(doc, url.href);
    if (!rounds.length) throw new Error('没有识别到可用回合');
    return rounds;
  }

  function readCharacters(doc, sourceUrl) {
    const characters = [];
    const seen = new Set();
    doc.querySelectorAll('table tbody tr').forEach(row => {
      const editLink = Array.from(row.querySelectorAll('a[href]')).find(link => {
        try {
          return /\/playbook\/characters\/\d+\/edit\/?$/.test(
            new URL(link.getAttribute('href'), sourceUrl).pathname
          );
        } catch (_) {
          return false;
        }
      });
      const editUrl = editLink ? new URL(editLink.getAttribute('href'), sourceUrl) : null;
      const pathId = editUrl?.pathname.match(/\/playbook\/characters\/(\d+)\/edit\/?$/)?.[1];
      const id = row.dataset.key || pathId || normalizeText(row.children[0]?.textContent).match(/^\d+$/)?.[0];
      const name = normalizeText(row.querySelector('td.column-nickname')?.textContent || row.children[1]?.textContent);
      if (!id || !name || seen.has(String(id))) return;
      seen.add(String(id));
      characters.push({ id: String(id), name });
    });
    return characters;
  }

  async function loadCharacters() {
    const { playbookId, basePath } = getPageContext();
    if (!playbookId) throw new Error('当前页面缺少剧本 ID');
    const url = new URL(`${basePath}/playbook/characters`, location.origin);
    url.searchParams.set('playbook_id', playbookId);
    url.searchParams.set('_per_page', '100');
    const doc = await fetchDocument(url.href, '读取角色列表');
    const characters = readCharacters(doc, url.href);
    if (!characters.length) throw new Error('没有识别到本剧本角色');
    return characters;
  }

  function matchCharacterFromMapName(mapName, characters) {
    const normalizedMapName = normalizeText(mapName);
    // 地图名只需以角色名开头，后续幕次、用途、尺寸、版本等后缀全部忽略。
    // 角色名互为前缀时优先更长名称，避免短名称抢先误匹配。
    return [...characters]
      .sort((left, right) => normalizeText(right.name).length - normalizeText(left.name).length)
      .find(character => normalizedMapName.startsWith(normalizeText(character.name))) || null;
  }

  function findActionForm(doc) {
    return Array.from(doc.forms).find(form => {
      try {
        const action = form.getAttribute('action') || '';
        return String(form.method).toLowerCase() === 'post'
          && /\/playbook\/actions\/?$/.test(new URL(action, location.origin).pathname);
      } catch (_) {
        return false;
      }
    }) || null;
  }

  function readActionRows(doc) {
    return Array.from(doc.querySelectorAll('table tbody tr')).map(row => {
      const cells = row.querySelectorAll('td');
      const id = normalizeText(cells[0]?.textContent);
      if (!/^\d+$/.test(id)) return null;
      return {
        id,
        type: normalizeText(cells[1]?.textContent),
        name: normalizeText(cells[2]?.textContent),
      };
    }).filter(Boolean);
  }

  function findCreatedActionId(documents, previousIds) {
    const candidates = documents.flatMap(readActionRows).filter(item =>
      !previousIds.has(item.id)
      && item.type === '强制角色进入地图'
      && item.name === '地图'
    );
    candidates.sort((left, right) => Number(right.id) - Number(left.id));
    return candidates[0]?.id || '';
  }

  async function createRoundMapAction(map, round, character = null) {
    const { playbookId, basePath } = getPageContext();
    const listUrl = new URL(`${basePath}/playbook/actions`, location.origin);
    listUrl.searchParams.set('playbook_id', playbookId);
    listUrl.searchParams.set('relate_id', round.id);
    listUrl.searchParams.set('relate_type', '3');
    listUrl.searchParams.set('page', '0');
    listUrl.searchParams.set('_sort[column]', 'id');
    listUrl.searchParams.set('_sort[type]', 'desc');

    // 先读取目标回合的原生创建表单，以便沿用当前登录态、CSRF token 和后台默认字段。
    const doc = await fetchDocument(listUrl.href, '读取动作创建表单');
    const previousIds = new Set(readActionRows(doc).map(item => item.id));
    const form = findActionForm(doc);
    if (!form) throw new Error('没有识别到动作创建表单');
    const token = form.querySelector('input[name="_token"]')?.value;
    if (!token) throw new Error('没有识别到动作表单令牌');

    // 参数完全对齐后台“强制角色进入地图”的原生复制链接，避免动态表单未渲染导致字段丢失。
    const data = new URLSearchParams({
      _token: token,
      cate: '61',
      name: '地图',
      playbook_id: playbookId,
      relate_id: round.id,
      relate_type: '3',
      param_a: map.id,
      error_next: '0',
      break: '0',
      delay: '0',
      pre_condition: '0',
      priority: '10',
      description: '取消线索对角色可见',
      _previous_: listUrl.href,
    });
    data.set('json_a[0]', character ? character.id : '$all-characters');
    data.set('json_a[1]', '');

    const actionUrl = new URL(form.getAttribute('action') || listUrl.href, listUrl.href);
    actionUrl.searchParams.set('playbook_id', playbookId);
    actionUrl.searchParams.set('relate_id', round.id);
    actionUrl.searchParams.set('relate_type', '3');
    const response = await fetch(actionUrl.href, {
      method: 'POST',
      body: data,
      credentials: 'same-origin',
    });
    const resultText = await response.text();
    if (!response.ok) throw new Error(`创建动作失败：HTTP ${response.status}`);

    let resultDoc = null;
    let createdId = response.url.match(/\/playbook\/actions\/(\d+)(?:\/edit)?/)?.[1] || '';
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      let result = null;
      try { result = JSON.parse(resultText); } catch (_) { /* 交给后续页面校验 */ }
      if (result && (result.status === false || result.success === false)) {
        throw new Error(normalizeText(result.message) || '后台返回创建失败');
      }
      createdId = createdId || String(result?.id || result?.data?.id || '');
    } else {
      resultDoc = new DOMParser().parseFromString(resultText, 'text/html');
      const error = resultDoc.querySelector('.alert-danger, .callout-danger, .has-error .help-block');
      const errorText = normalizeText(error?.textContent);
      if (errorText) throw new Error(errorText);
    }

    if (!/^\d+$/.test(createdId)) {
      const afterDoc = await fetchDocument(listUrl.href, '确认新动作');
      createdId = findCreatedActionId([resultDoc, afterDoc].filter(Boolean), previousIds);
    }
    if (!/^\d+$/.test(createdId)) throw new Error('动作已提交，但没有识别到新动作 ID');
    return createdId;
  }

  async function addToRoundStart(actionId, round) {
    const api = globalThis.__bbQuickEventApi;
    if (!api?.createOrAppendEvent) throw new Error('快捷事件组件尚未加载');
    const { playbookId } = getPageContext();
    return api.createOrAppendEvent(actionId, '9', {
      playbookId,
      relateId: round.id,
      relateType: '3',
    });
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function closeBatchModal() {
    document.getElementById(BATCH_MODAL_ID)?.remove();
  }

  async function openRoundModal(map, sourceButton) {
    closeModal();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-round-map-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-round-map-title">
        <div class="bb-round-map-header">
          <h3 class="bb-round-map-title" id="bb-round-map-title">快捷创建回合地图</h3>
          <div class="bb-round-map-subtitle"></div>
          <div class="bb-round-map-note">创建地图动作后，将自动加入所选回合的“回合开始”事件。</div>
          <div class="bb-round-map-character-control">
            <label class="bb-round-map-character-label">
              <input type="checkbox" data-bb-round-map-character-only>
              角色独立地图
            </label>
            <div class="bb-round-map-character-match" data-bb-round-map-character-match>未勾选时，动作默认选择全部角色。</div>
          </div>
        </div>
        <div class="bb-round-map-body"><div class="bb-round-map-status">正在读取回合列表…</div></div>
        <div class="bb-round-map-footer">
          <button type="button" class="btn btn-default" data-bb-round-map-cancel>取消</button>
          <button type="button" class="btn btn-success" data-bb-round-map-submit disabled>创建动作并添加事件</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.bb-round-map-subtitle').textContent = `地图：${map.name}（ID：${map.id}）`;
    const body = modal.querySelector('.bb-round-map-body');
    const submit = modal.querySelector('[data-bb-round-map-submit]');
    const characterOnly = modal.querySelector('[data-bb-round-map-character-only]');
    const characterMatch = modal.querySelector('[data-bb-round-map-character-match]');
    modal.querySelector('[data-bb-round-map-cancel]').addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });

    try {
      const [rounds, characters] = await Promise.all([loadRounds(), loadCharacters()]);
      if (!modal.isConnected) return;
      const matchedCharacter = matchCharacterFromMapName(map.name, characters);
      let createdActionId = '';
      const updateSubmitState = () => {
        const hasRound = Boolean(modal.querySelector('input[name="bb-round-map-round"]:checked'));
        submit.disabled = !hasRound || (characterOnly.checked && !matchedCharacter);
        characterMatch.classList.toggle('is-error', characterOnly.checked && !matchedCharacter);
        characterMatch.classList.toggle('is-success', characterOnly.checked && Boolean(matchedCharacter));
        characterMatch.textContent = characterOnly.checked
          ? (matchedCharacter
            ? `已根据地图名称识别角色：${matchedCharacter.name}（ID：${matchedCharacter.id}）`
            : `未能从地图名称“${map.name}”开头匹配到本剧本角色，请检查地图名称。`)
          : '未勾选时，动作默认选择全部角色。';
      };
      characterOnly.addEventListener('change', updateSubmitState);
      const list = document.createElement('div');
      list.className = 'bb-round-map-list';
      rounds.forEach((round, index) => {
        const label = document.createElement('label');
        label.className = 'bb-round-map-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'bb-round-map-round';
        radio.value = round.id;
        radio.addEventListener('change', updateSubmitState);
        const name = document.createElement('span');
        name.textContent = round.name;
        const id = document.createElement('span');
        id.className = 'bb-round-map-option-id';
        id.textContent = `ID：${round.id}`;
        label.append(radio, name, id);
        list.appendChild(label);
        if (index === 0) radio.focus();
      });
      body.replaceChildren(list);
      updateSubmitState();

      submit.addEventListener('click', async () => {
        const selected = modal.querySelector('input[name="bb-round-map-round"]:checked');
        const round = rounds.find(item => item.id === selected?.value);
        if (!round) return;
        submit.disabled = true;
        const status = document.createElement('div');
        status.className = 'bb-round-map-status';
        body.querySelector('.bb-round-map-status')?.remove();
        body.prepend(status);
        try {
          if (!createdActionId) {
            submit.textContent = '正在创建动作…';
            status.textContent = '正在创建地图动作…';
            const actionCharacter = characterOnly.checked ? matchedCharacter : null;
            if (characterOnly.checked && !actionCharacter) throw new Error('角色独立地图未匹配到角色');
            createdActionId = await createRoundMapAction(map, round, actionCharacter);
            modal.querySelectorAll('input[name="bb-round-map-round"]').forEach(input => { input.disabled = true; });
            characterOnly.disabled = true;
          }
          submit.textContent = '正在添加事件…';
          status.textContent = `动作 ${createdActionId} 已创建，正在加入回合开始事件…`;
          await addToRoundStart(createdActionId, round);
          saveMapRecord(map, round, createdActionId);
          renderMapRecord(sourceButton.closest('tr'), map);
          sourceButton.textContent = '已添加';
          sourceButton.classList.remove('btn-info');
          sourceButton.classList.add('btn-success');
          closeModal();
          window.setTimeout(() => {
            sourceButton.textContent = '快捷创建回合地图';
            sourceButton.classList.remove('btn-success');
            sourceButton.classList.add('btn-info');
          }, 1800);
        } catch (error) {
          console.warn('[百变后台回合地图动作] 创建失败', error);
          status.classList.add('is-error');
          status.textContent = createdActionId
            ? `动作 ${createdActionId} 已创建，但添加回合开始事件失败：${error.message || error}`
            : `创建失败：${error.message || error}`;
          submit.disabled = false;
          submit.textContent = createdActionId ? '重试添加事件' : '重新创建';
        }
      });
    } catch (error) {
      body.innerHTML = '';
      const status = document.createElement('div');
      status.className = 'bb-round-map-status is-error';
      status.textContent = error.message || String(error);
      body.appendChild(status);
    }
  }

  function getMapFromRow(row) {
    const editLink = Array.from(row.querySelectorAll('a[href]')).find(link =>
      /\/playbook\/maps\/\d+\/edit/.test(link.getAttribute('href') || '')
    );
    if (!editLink) return null;
    const match = (editLink.getAttribute('href') || '').match(/\/playbook\/maps\/(\d+)\/edit/);
    const id = match?.[1] || '';
    const nameCell = editLink.closest('td');
    const name = normalizeText(nameCell?.dataset.bbMapTitle || nameCell?.textContent) || `地图 ${id}`;
    return id ? { id, name, editLink } : null;
  }

  function selectedMaps(table) {
    return Array.from(table.querySelectorAll(`tbody input[${SELECT_ATTRIBUTE}]:checked`)).map(input => {
      const row = input.closest('tr');
      const map = row ? getMapFromRow(row) : null;
      return map ? { ...map, row, checkbox: input } : null;
    }).filter(Boolean);
  }

  function updateBatchSelectionState(table) {
    const boxes = Array.from(table.querySelectorAll(`tbody input[${SELECT_ATTRIBUTE}]`));
    const checked = boxes.filter(input => input.checked);
    const all = table.querySelector(`thead input[${SELECT_ALL_ATTRIBUTE}]`);
    if (all) {
      all.checked = boxes.length > 0 && checked.length === boxes.length;
      all.indeterminate = checked.length > 0 && checked.length < boxes.length;
    }
    const button = document.querySelector(`[${BATCH_BUTTON_ATTRIBUTE}]`);
    const count = button?.parentElement?.querySelector('.bb-round-map-batch-count');
    if (button) button.disabled = checked.length === 0;
    if (count) count.textContent = `已选 ${checked.length} 张地图`;
  }

  function ensureSelectionColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector(`[${SELECT_CELL_ATTRIBUTE}]`)) {
      const th = document.createElement('th');
      th.setAttribute(SELECT_CELL_ATTRIBUTE, 'header');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute(SELECT_ALL_ATTRIBUTE, '1');
      input.title = '全选当前列表地图';
      input.addEventListener('change', () => {
        table.querySelectorAll(`tbody input[${SELECT_ATTRIBUTE}]`).forEach(box => { box.checked = input.checked; });
        updateBatchSelectionState(table);
      });
      th.appendChild(input);
      headerRow.prepend(th);
    }
    table.querySelectorAll('tbody tr').forEach(row => {
      const map = getMapFromRow(row);
      if (!map || row.querySelector(`[${SELECT_CELL_ATTRIBUTE}]`)) return;
      const td = document.createElement('td');
      td.setAttribute(SELECT_CELL_ATTRIBUTE, map.id);
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute(SELECT_ATTRIBUTE, map.id);
      input.title = `选择地图：${map.name}`;
      input.addEventListener('change', () => updateBatchSelectionState(table));
      td.appendChild(input);
      row.prepend(td);
    });
    updateBatchSelectionState(table);
  }

  async function openBatchRoundModal(maps, table) {
    closeBatchModal();
    const modal = document.createElement('div');
    modal.id = BATCH_MODAL_ID;
    modal.innerHTML = `
      <div class="bb-round-map-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-round-map-batch-title">
        <div class="bb-round-map-header">
          <h3 class="bb-round-map-title" id="bb-round-map-batch-title">快速创建回合地图</h3>
          <div class="bb-round-map-subtitle">已选择 ${maps.length} 张地图。请为每张地图指定回合，提交后将按列表顺序逐条创建动作并加入“回合开始”事件。</div>
        </div>
        <div class="bb-round-map-body"><div class="bb-round-map-status">正在读取回合列表…</div></div>
        <div class="bb-round-map-footer">
          <button type="button" class="btn btn-default" data-bb-round-map-batch-cancel>取消</button>
          <button type="button" class="btn btn-success" data-bb-round-map-batch-submit disabled>依次创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const body = modal.querySelector('.bb-round-map-body');
    const submit = modal.querySelector('[data-bb-round-map-batch-submit]');
    const cancel = modal.querySelector('[data-bb-round-map-batch-cancel]');
    cancel.addEventListener('click', closeBatchModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeBatchModal(); });

    try {
      const rounds = await loadRounds();
      if (!modal.isConnected) return;
      const list = document.createElement('div');
      list.className = 'bb-round-map-batch-list';
      maps.forEach(map => {
        const row = document.createElement('div');
        row.className = 'bb-round-map-batch-row';
        const info = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'bb-round-map-batch-map-name';
        name.textContent = map.name;
        const id = document.createElement('div');
        id.className = 'bb-round-map-batch-map-id';
        id.textContent = `地图 ID：${map.id}`;
        info.append(name, id);
        const select = document.createElement('select');
        select.className = 'form-control bb-round-map-batch-select';
        select.dataset.mapId = map.id;
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '请选择回合';
        select.appendChild(placeholder);
        rounds.forEach(round => {
          const option = document.createElement('option');
          option.value = round.id;
          option.textContent = `${round.name}（ID：${round.id}）`;
          select.appendChild(option);
        });
        row.append(info, select);
        list.appendChild(row);
      });
      const result = document.createElement('div');
      result.className = 'bb-round-map-batch-result';
      result.hidden = true;
      body.replaceChildren(list, result);
      const selects = Array.from(list.querySelectorAll('select[data-map-id]'));
      const updateSubmit = () => { submit.disabled = selects.some(select => !select.value); };
      selects.forEach(select => select.addEventListener('change', updateSubmit));
      updateSubmit();

      submit.addEventListener('click', async () => {
        if (selects.some(select => !select.value)) return;
        submit.disabled = true;
        cancel.disabled = true;
        selects.forEach(select => { select.disabled = true; });
        const lines = [];
        let successCount = 0;
        let failureCount = 0;
        result.hidden = false;
        for (let index = 0; index < maps.length; index += 1) {
          const map = maps[index];
          const select = selects.find(item => item.dataset.mapId === String(map.id));
          const round = rounds.find(item => item.id === select?.value);
          submit.textContent = `正在创建 ${index + 1}/${maps.length}`;
          result.classList.remove('is-error');
          result.textContent = [...lines, `正在处理：${map.name} → ${round?.name || ''}`].join('\n');
          let actionId = '';
          try {
            actionId = await createRoundMapAction(map, round);
            await addToRoundStart(actionId, round);
            saveMapRecord(map, round, actionId);
            renderMapRecord(map.row, map);
            map.checkbox.checked = false;
            successCount += 1;
            lines.push(`✓ ${map.name} → ${round.name}（动作 ${actionId}）`);
          } catch (error) {
            failureCount += 1;
            lines.push(actionId
              ? `✗ ${map.name}：动作 ${actionId} 已创建，但加入事件失败：${error.message || error}`
              : `✗ ${map.name}：${error.message || error}`);
          }
        }
        updateBatchSelectionState(table);
        result.classList.toggle('is-error', failureCount > 0);
        result.textContent = [`完成：成功 ${successCount} 张，失败 ${failureCount} 张。`, ...lines].join('\n');
        cancel.disabled = false;
        cancel.textContent = '关闭';
        submit.hidden = true;
      });
    } catch (error) {
      body.innerHTML = '';
      const status = document.createElement('div');
      status.className = 'bb-round-map-status is-error';
      status.textContent = error.message || String(error);
      body.appendChild(status);
    }
  }

  function ensureBatchButton(table) {
    let button = document.querySelector(`[${BATCH_BUTTON_ATTRIBUTE}]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-warning bb-round-map-batch-button';
      button.setAttribute(BATCH_BUTTON_ATTRIBUTE, '1');
      button.textContent = '快速创建回合地图';
      const count = document.createElement('span');
      count.className = 'bb-round-map-batch-count';
      count.textContent = '已选 0 张地图';
      const anchor = document.querySelector('[data-bb-map-folder-status]')
        || document.querySelector('[data-bb-map-folder-button]')
        || document.querySelector('[data-bb-batch-map-button]')
        || table.closest('.box')?.querySelector('.box-header .btn');
      const parent = anchor?.parentElement || table.parentElement;
      if (anchor?.parentElement === parent) anchor.after(button, count);
      else parent?.prepend(button, count);
      button.addEventListener('click', () => {
        const maps = selectedMaps(table);
        if (maps.length) openBatchRoundModal(maps, table);
      });
    }
    updateBatchSelectionState(table);
  }

  function updateButtons() {
    if (!isMapList()) return;
    addStyles();
    const table = Array.from(document.querySelectorAll('table')).find(candidate =>
      Array.from(candidate.querySelectorAll('tbody tr')).some(row => getMapFromRow(row))
    );
    if (!table) return;
    ensureSelectionColumn(table);
    ensureBatchButton(table);
    table.querySelectorAll('tbody tr').forEach(row => {
      const map = getMapFromRow(row);
      if (!map) return;
      renderMapRecord(row, map);
      if (row.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-info bb-round-map-action-button';
      button.setAttribute(BUTTON_ATTRIBUTE, map.id);
      button.textContent = '快捷创建回合地图';
      button.addEventListener('click', event => {
        event.preventDefault();
        openRoundModal(getMapFromRow(row) || map, button);
      });
      map.editLink.parentElement?.appendChild(button);
    });
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateButtons, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.setInterval(updateButtons, 700);
  updateButtons();
})();

// 地图名称行内编辑：点击名称后直接修改，并复用地图原生编辑表单保存其余字段。
(() => {
  'use strict';

  const STYLE_ID = 'bb-map-inline-title-style';
  const CELL_ATTRIBUTE = 'data-bb-map-inline-title';
  const EDITING_ATTRIBUTE = 'data-bb-map-inline-title-editing';
  let updateTimer = null;

  const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isMapList = () => /\/playbook\/maps\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      td[${CELL_ATTRIBUTE}] { min-width: 190px; }
      .bb-map-inline-title-button { padding: 3px 5px; border: 0; color: #333; background: transparent; font-size: inherit; text-align: left; white-space: normal; }
      .bb-map-inline-title-button:hover, .bb-map-inline-title-button:focus { color: #3c8dbc; background: #eef7fc; text-decoration: none; }
      .bb-map-inline-title-pencil { margin-left: 6px; color: #3c8dbc; opacity: .72; }
      .bb-map-inline-title-editor { display: flex; align-items: center; gap: 5px; min-width: 260px; }
      .bb-map-inline-title-editor input { width: 180px; min-width: 0; }
      .bb-map-inline-title-status { display: block; margin-top: 4px; color: #dd4b39; font-size: 12px; white-space: normal; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  async function getEditForm(editUrl) {
    const response = await fetch(editUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取地图失败：HTTP ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = Array.from(doc.forms).find(item => {
      if (String(item.method).toLowerCase() !== 'post') return false;
      try {
        const action = item.getAttribute('action') || '';
        return /\/playbook\/maps\/\d+\/?$/.test(new URL(action, editUrl).pathname);
      } catch (_) {
        return false;
      }
    });
    if (!form) throw new Error('没有识别到地图编辑表单');
    return { form, editUrl };
  }

  function removeEmptyFile(formData, name) {
    const values = formData.getAll(name);
    if (values.length && values.every(value => typeof value !== 'string' && !value.name)) {
      formData.delete(name);
    }
  }

  async function saveTitle(editUrl, title) {
    const { form } = await getEditForm(editUrl);
    const data = new FormData(form);
    data.set('title', title);
    data.delete('after-save');
    data.set('_previous_', location.href);
    removeEmptyFile(data, 'image');
    removeEmptyFile(data, 'video');

    const actionUrl = new URL(form.getAttribute('action') || editUrl, editUrl);
    const response = await fetch(actionUrl.href, {
      method: 'POST',
      body: data,
      credentials: 'same-origin',
    });
    const resultText = await response.text();
    if (!response.ok) throw new Error(`保存失败：HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      let result = null;
      try { result = JSON.parse(resultText); } catch (_) { /* 继续按成功响应处理 */ }
      if (result && (result.status === false || result.success === false)) {
        throw new Error(normalizeText(result.message) || '后台返回保存失败');
      }
      return;
    }

    const resultDoc = new DOMParser().parseFromString(resultText, 'text/html');
    const error = resultDoc.querySelector('.alert-danger, .callout-danger, .has-error .help-block');
    const errorText = normalizeText(error?.textContent);
    if (errorText) throw new Error(errorText);
  }

  function renderName(cell, row, editUrl, name) {
    cell.removeAttribute(EDITING_ATTRIBUTE);
    cell.dataset.bbMapTitle = name;
    cell.replaceChildren();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bb-map-inline-title-button';
    button.title = '点击直接修改地图名称';
    const label = document.createElement('span');
    label.textContent = name;
    const pencil = document.createElement('span');
    pencil.className = 'bb-map-inline-title-pencil';
    pencil.textContent = '✎';
    button.append(label, pencil);
    button.addEventListener('click', event => {
      event.preventDefault();
      beginEdit(cell, row, editUrl);
    });
    cell.appendChild(button);
  }

  function beginEdit(cell, row, editUrl) {
    if (cell.hasAttribute(EDITING_ATTRIBUTE)) return;
    cell.setAttribute(EDITING_ATTRIBUTE, 'true');
    const currentName = cell.dataset.bbMapTitle || '';
    cell.replaceChildren();

    const editor = document.createElement('div');
    editor.className = 'bb-map-inline-title-editor';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control input-sm';
    input.value = currentName;
    input.maxLength = 100;
    input.setAttribute('aria-label', '地图名称');
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn-xs btn-success';
    saveButton.textContent = '保存';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn-xs btn-default';
    cancelButton.textContent = '取消';
    editor.append(input, saveButton, cancelButton);
    const status = document.createElement('span');
    status.className = 'bb-map-inline-title-status';
    cell.append(editor, status);

    const cancel = () => renderName(cell, row, editUrl, currentName);
    const save = async () => {
      const nextName = normalizeText(input.value);
      if (!nextName) {
        status.textContent = '地图名称不能为空';
        input.focus();
        return;
      }
      if (nextName === currentName) {
        cancel();
        return;
      }
      input.disabled = true;
      saveButton.disabled = true;
      cancelButton.disabled = true;
      saveButton.textContent = '保存中…';
      status.textContent = '';
      try {
        await saveTitle(editUrl, nextName);
        renderName(cell, row, editUrl, nextName);
      } catch (error) {
        console.warn('[百变后台地图名称] 保存失败', error);
        status.textContent = `保存失败：${error.message || error}`;
        input.disabled = false;
        saveButton.disabled = false;
        cancelButton.disabled = false;
        saveButton.textContent = '保存';
        input.focus();
      }
    };

    saveButton.addEventListener('click', save);
    cancelButton.addEventListener('click', cancel);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.focus();
    input.select();
  }

  function updateCells() {
    if (!isMapList()) return;
    addStyles();
    document.querySelectorAll('table tbody tr').forEach(row => {
      const editLink = Array.from(row.querySelectorAll('a[href]')).find(link =>
        /\/playbook\/maps\/\d+\/edit/.test(link.getAttribute('href') || '')
      );
      const cell = row.querySelector(`td[${CELL_ATTRIBUTE}]`)
        || (row.querySelector('td[data-bb-round-map-select-cell]') ? row.children[2] : row.children[1]);
      if (!editLink || !cell || cell.hasAttribute(CELL_ATTRIBUTE)) return;
      const name = normalizeText(cell.textContent);
      cell.setAttribute(CELL_ATTRIBUTE, 'true');
      renderName(cell, row, editLink.href, name);
    });
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateCells, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.setInterval(updateCells, 700);
  updateCells();
})();

// 活动模块剧本列表快速添加：输入多个线上本 ID，复用原生添加表单逐条创建。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-quick-add-module-playbooks';
  const MODAL_ID = 'bb-quick-add-module-playbooks-modal';
  const STYLE_ID = 'bb-quick-add-module-playbooks-style';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isListPage = () => /\/dm\/activity\/module\/playbook_item\/?$/.test(location.pathname)
    && Boolean(new URL(location.href).searchParams.get('module_list_id'));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-left: 8px; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.42); }
      #${MODAL_ID} .bb-module-playbook-dialog { width: min(560px, calc(100vw - 36px)); padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-module-playbook-hint { margin-bottom: 10px; color: #687786; }
      #${MODAL_ID} textarea { box-sizing: border-box; width: 100%; min-height: 150px; padding: 9px; border: 1px solid #ccd6df; border-radius: 4px; resize: vertical; }
      #${MODAL_ID} .bb-module-playbook-status { min-height: 24px; margin-top: 10px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-module-playbook-error { color: #c0392b; }
      #${MODAL_ID} .bb-module-playbook-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/dm/activity/module/playbook_item/create"]'))
      .find(link => /添加剧本/.test(normalize(link.textContent))) || null;
  }

  function parseIds(value) {
    const seen = new Set();
    return String(value || '').split(/[，,\s]+/).map(normalize)
      .filter(id => /^\d+$/.test(id) && !seen.has(id) && seen.add(id));
  }

  async function readCreateForm(createUrl) {
    const response = await fetch(createUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取添加剧本表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.forms).find(item => item.method.toLowerCase() === 'post'
      && item.querySelector('[name="module_list_id"]') && item.querySelector('[name="playbook_id"]'));
    const playbookSelect = form?.querySelector('.cascade-type-31 select[name="playbook_id"]');
    if (!form || !playbookSelect) throw new Error('未找到线上本剧本列表');
    const playbooks = new Map(Array.from(playbookSelect.options)
      .filter(option => option.value)
      .map(option => [String(option.value), normalize(option.textContent)]));
    return { form, playbooks };
  }

  async function createOne(createUrl, sourceForm, playbookId) {
    const body = new FormData();
    const value = name => sourceForm.querySelector(`[name="${name}"]`)?.value || '';
    body.append('module_list_id', value('module_list_id') || new URL(createUrl).searchParams.get('module_list_id') || '');
    body.append('type', '1');
    body.append('playbook_id', playbookId);
    body.append('want_count', value('want_count'));
    body.append('hot_value_d', value('hot_value_d'));
    body.append('priority', value('priority'));
    body.append('_token', value('_token'));
    body.append('_previous_', value('_previous_'));
    const action = new URL(sourceForm.getAttribute('action') || createUrl, createUrl).href;
    const response = await fetch(action, { method: 'POST', body, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (/\/create\/?(?:\?|$)/.test(new URL(response.url).pathname + new URL(response.url).search)) {
      throw new Error('后台未接受该剧本');
    }
  }

  function openModal(createUrl) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-module-playbook-dialog">
        <h3>快速添加剧本</h3>
        <div class="bb-module-playbook-hint">输入线上本剧本 ID，多个 ID 可用逗号、空格或换行分隔。</div>
        <textarea data-bb-module-playbook-ids placeholder="例如：\n2491\n2489\n2488"></textarea>
        <div class="bb-module-playbook-status" data-bb-module-playbook-status></div>
        <div class="bb-module-playbook-actions">
          <button type="button" class="btn btn-default" data-bb-module-playbook-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-module-playbook-confirm>确认添加</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('[data-bb-module-playbook-ids]');
    const status = modal.querySelector('[data-bb-module-playbook-status]');
    const cancel = modal.querySelector('[data-bb-module-playbook-cancel]');
    const confirm = modal.querySelector('[data-bb-module-playbook-confirm]');
    const close = () => modal.remove();
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });
    confirm.addEventListener('click', async () => {
      const ids = parseIds(input.value);
      if (!ids.length) {
        status.className = 'bb-module-playbook-status bb-module-playbook-error';
        status.textContent = '请输入至少一个有效的数字剧本 ID';
        return;
      }
      confirm.disabled = true;
      cancel.disabled = true;
      status.className = 'bb-module-playbook-status';
      status.textContent = '正在读取线上本剧本列表…';
      try {
        const { form, playbooks } = await readCreateForm(createUrl);
        const missing = ids.filter(id => !playbooks.has(id));
        if (missing.length) throw new Error(`以下 ID 不在线上本列表中：${missing.join('、')}`);
        for (let index = 0; index < ids.length; index += 1) {
          status.textContent = `正在添加 ${index + 1}/${ids.length}：${playbooks.get(ids[index])}`;
          await createOne(createUrl, form, ids[index]);
        }
        status.textContent = `成功添加 ${ids.length} 个线上本，即将刷新列表。`;
        window.setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        status.className = 'bb-module-playbook-status bb-module-playbook-error';
        status.textContent = error.message || '添加失败';
        confirm.disabled = false;
        cancel.disabled = false;
      }
    });
    input.focus();
  }

  function update() {
    if (!isListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '快速添加剧本';
    button.addEventListener('click', event => { event.preventDefault(); openModal(createLink.href); });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(update, 800);
  update();
})();

// 活动模块快速增加：按“模块类型 | 模块名称”批量复用原生创建表单。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-quick-add-activity-modules';
  const MODAL_ID = 'bb-quick-add-activity-modules-modal';
  const STYLE_ID = 'bb-quick-add-activity-modules-style';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isListPage = () => /\/dm\/activity\/modules\/?$/.test(location.pathname)
    && Boolean(new URL(location.href).searchParams.get('ac_id'));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-left: 8px; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.42); }
      #${MODAL_ID} .bb-activity-module-dialog { width: min(650px, calc(100vw - 36px)); padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-activity-module-hint { margin-bottom: 10px; color: #687786; line-height: 1.7; }
      #${MODAL_ID} .bb-activity-module-priority { display: block; margin: 10px 0; color: #596b7b; }
      #${MODAL_ID} .bb-activity-module-priority input { box-sizing: border-box; width: 180px; margin-left: 8px; padding: 7px 9px; border: 1px solid #ccd6df; border-radius: 4px; }
      #${MODAL_ID} textarea { box-sizing: border-box; width: 100%; min-height: 220px; padding: 9px; border: 1px solid #ccd6df; border-radius: 4px; resize: vertical; }
      #${MODAL_ID} .bb-activity-module-types { max-height: 72px; margin-top: 8px; overflow: auto; color: #82909c; font-size: 12px; line-height: 1.6; }
      #${MODAL_ID} .bb-activity-module-status { min-height: 24px; margin-top: 10px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-activity-module-error { color: #c0392b; }
      #${MODAL_ID} .bb-activity-module-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/dm/activity/modules/create"]'))
      .find(link => /增加模块/.test(normalize(link.textContent))) || null;
  }

  function getMaxPriority() {
    const table = Array.from(document.querySelectorAll('table')).find(item =>
      Array.from(item.querySelectorAll('thead th')).some(th => /排序/.test(normalize(th.textContent)))
    );
    if (!table) return 0;
    const headers = Array.from(table.querySelectorAll('thead th'));
    const priorityIndex = headers.findIndex(th => /排序/.test(normalize(th.textContent)));
    if (priorityIndex < 0) return 0;
    return Math.max(0, ...Array.from(table.querySelectorAll('tbody tr')).map(row => {
      const value = normalize(row.children[priorityIndex]?.textContent);
      const match = value.match(/-?\d+/);
      return match ? Number(match[0]) : 0;
    }));
  }

  async function readCreateForm(createUrl) {
    const response = await fetch(createUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取增加模块表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.forms).find(item => item.method.toLowerCase() === 'post'
      && item.querySelector('select[name="module_type"]') && item.querySelector('[name="ac_id"]'));
    const typeSelect = form?.querySelector('select[name="module_type"]');
    if (!form || !typeSelect) throw new Error('未找到模块类型下拉框');
    const types = new Map(Array.from(typeSelect.options)
      .filter(option => option.value && normalize(option.textContent))
      .map(option => [normalize(option.textContent), String(option.value)]));
    return { form, types };
  }

  function parseEntries(value, types) {
    const typeNames = Array.from(types.keys()).sort((left, right) => right.length - left.length);
    const entries = [];
    const errors = [];
    String(value || '').split(/\r?\n/).forEach((rawLine, index) => {
      const line = normalize(rawLine);
      if (!line) return;
      let typeName = '';
      let name = '';
      const delimiterMatch = line.match(/^(.+?)[\t|｜,，]+(.+)$/);
      if (delimiterMatch) {
        typeName = normalize(delimiterMatch[1]);
        name = normalize(delimiterMatch[2]);
      } else {
        typeName = typeNames.find(type => line === type
          || new RegExp(`^${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:\-—\\s]+`).test(line)) || '';
        name = typeName ? normalize(line.slice(typeName.length).replace(/^[：:\-—\s]+/, '')) : '';
      }
      if (!types.has(typeName)) {
        errors.push(`第 ${index + 1} 行模块类型不存在：${typeName || line}`);
      } else if (!name) {
        errors.push(`第 ${index + 1} 行缺少模块名称`);
      } else {
        entries.push({ typeName, typeValue: types.get(typeName), name });
      }
    });
    return { entries, errors };
  }

  async function createOne(createUrl, sourceForm, entry, priority) {
    const value = name => sourceForm.querySelector(`[name="${name}"]`)?.value || '';
    const body = new FormData();
    body.append('ac_id', value('ac_id') || new URL(createUrl).searchParams.get('ac_id') || '');
    body.append('module_type', entry.typeValue);
    body.append('exhibition_id', value('exhibition_id') || '0');
    body.append('name', entry.name);
    body.append('relate_id', value('relate_id'));
    body.append('start_at', '');
    body.append('end_at', '');
    body.append('enable', value('enable') || 'on');
    body.append('priority', String(priority));
    body.append('_token', value('_token'));
    body.append('_previous_', value('_previous_'));
    const action = new URL(sourceForm.getAttribute('action') || createUrl, createUrl).href;
    const response = await fetch(action, { method: 'POST', body, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const resultDoc = new DOMParser().parseFromString(html, 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    const stillOnCreatePage = /\/dm\/activity\/modules\/create\/?$/.test(new URL(response.url).pathname)
      || Boolean(resultDoc.querySelector('form select[name="module_type"]'));
    if (errorText || stillOnCreatePage) throw new Error(errorText || '后台未接受该模块');
  }

  function openModal(createUrl) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-activity-module-dialog">
        <h3>快速增加模块</h3>
        <div class="bb-activity-module-hint">
          每行一个模块，格式：模块类型 | 模块名称。也支持制表符、逗号或空格分隔。<br>
          时间保持空白；第一行使用起始优先级，后续每行依次减 1。
        </div>
        <label class="bb-activity-module-priority">起始优先级
          <input type="number" step="1" data-bb-activity-module-priority>
        </label>
        <textarea data-bb-activity-module-entries placeholder="例如：\n图片 | 头图\n剧本列表 | 经验加成剧本\n剧本合集 | 硬核推理剧本合集"></textarea>
        <div class="bb-activity-module-types" data-bb-activity-module-types>正在读取可用模块类型…</div>
        <div class="bb-activity-module-status" data-bb-activity-module-status></div>
        <div class="bb-activity-module-actions">
          <button type="button" class="btn btn-default" data-bb-activity-module-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-activity-module-confirm disabled>确认创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const priorityInput = modal.querySelector('[data-bb-activity-module-priority]');
    const input = modal.querySelector('[data-bb-activity-module-entries]');
    const typesHint = modal.querySelector('[data-bb-activity-module-types]');
    const status = modal.querySelector('[data-bb-activity-module-status]');
    const cancel = modal.querySelector('[data-bb-activity-module-cancel]');
    const confirm = modal.querySelector('[data-bb-activity-module-confirm]');
    let nativeForm = null;
    let moduleTypes = null;
    priorityInput.value = String(getMaxPriority() + 1);
    const close = () => modal.remove();
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });
    readCreateForm(createUrl).then(({ form, types }) => {
      nativeForm = form;
      moduleTypes = types;
      typesHint.textContent = `可用模块类型：${Array.from(types.keys()).join('、')}`;
      confirm.disabled = false;
    }).catch(error => {
      status.className = 'bb-activity-module-status bb-activity-module-error';
      status.textContent = error.message;
    });
    confirm.addEventListener('click', async () => {
      if (!nativeForm || !moduleTypes) return;
      const { entries, errors } = parseEntries(input.value, moduleTypes);
      if (errors.length || !entries.length) {
        status.className = 'bb-activity-module-status bb-activity-module-error';
        status.textContent = errors.join('\n') || '请至少输入一个模块';
        return;
      }
      const startPriority = Number(priorityInput.value);
      if (!priorityInput.value.trim() || !Number.isSafeInteger(startPriority)) {
        status.className = 'bb-activity-module-status bb-activity-module-error';
        status.textContent = '请输入有效的整数起始优先级';
        priorityInput.focus();
        return;
      }
      confirm.disabled = true;
      cancel.disabled = true;
      status.className = 'bb-activity-module-status';
      let completed = 0;
      try {
        for (let index = 0; index < entries.length; index += 1) {
          const priority = startPriority - index;
          status.textContent = `正在创建 ${index + 1}/${entries.length}：${entries[index].typeName} | ${entries[index].name}（优先级 ${priority}）`;
          await createOne(createUrl, nativeForm, entries[index], priority);
          completed += 1;
        }
        status.textContent = `成功创建 ${entries.length} 个活动模块，即将刷新列表。`;
        window.setTimeout(() => window.location.reload(), 700);
      } catch (error) {
        status.className = 'bb-activity-module-status bb-activity-module-error';
        status.textContent = `已创建 ${completed}/${entries.length} 个；当前创建失败：${error.message || '未知错误'}`;
        confirm.disabled = false;
        cancel.disabled = false;
      }
    });
    input.focus();
  }

  function update() {
    if (!isListPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '快速增加模块';
    button.addEventListener('click', event => { event.preventDefault(); openModal(createLink.href); });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(update, 800);
  update();
})();

// 剧本活动详情页：从活动列表一键创建活动、图片模块并上传详情页图片。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-create-playbook-detail-page';
  const MODAL_ID = 'bb-create-playbook-detail-page-modal';
  const STYLE_ID = 'bb-create-playbook-detail-page-style';
  const MODULE_NAME = '详情页图片';
  const DEFAULT_START_AT = '2026-08-31 00:00:00';
  const DEFAULT_END_AT = '9999-08-31 00:00:00';
  const DEFAULT_BACKGROUND_COLOR = '#1a2b3c';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isActivityList = () => /\/dm\/activity\/main\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-right: 8px; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-detail-page-dialog { width: min(580px, calc(100vw - 36px)); padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-detail-page-hint { margin-bottom: 14px; color: #687786; line-height: 1.7; }
      #${MODAL_ID} label { display: block; margin: 12px 0 6px; color: #3c4b5a; font-weight: 600; }
      #${MODAL_ID} input[type="text"], #${MODAL_ID} input[type="file"] { box-sizing: border-box; width: 100%; min-height: 36px; padding: 7px 9px; border: 1px solid #ccd6df; border-radius: 4px; background: #fff; }
      #${MODAL_ID} input[type="file"] { padding: 5px; }
      #${MODAL_ID} .bb-detail-page-time { margin-top: 12px; padding: 9px 10px; color: #687786; background: #f5f8fa; border-radius: 4px; font-size: 13px; line-height: 1.7; }
      #${MODAL_ID} .bb-detail-page-status { min-height: 24px; margin-top: 12px; color: #337ab7; white-space: pre-wrap; }
      #${MODAL_ID} .bb-detail-page-error { color: #c0392b; }
      #${MODAL_ID} .bb-detail-page-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/dm/activity/main/create"]'))
      .find(link => /新增/.test(normalize(link.textContent))) || null;
  }

  function getActivityListUrl() {
    return new URL('/16d7m/dm/activity/main', location.origin).href;
  }

  function getModuleUrls(activityId) {
    const listUrl = new URL('/16d7m/dm/activity/modules', location.origin);
    listUrl.searchParams.set('ac_id', String(activityId));
    const createUrl = new URL(listUrl.href);
    createUrl.pathname = '/16d7m/dm/activity/modules/create';
    return { listUrl: listUrl.href, createUrl: createUrl.href };
  }

  function findField(form, names = [], labels = []) {
    for (const name of names) {
      const field = form.querySelector(`[name="${name}"]`);
      if (field) return field;
    }
    const wanted = labels.map(normalize).filter(Boolean);
    const labelNode = Array.from(form.querySelectorAll('label, .control-label, .field-label')).find(item => {
      const content = normalize(item.textContent);
      return wanted.some(label => content === label || content.startsWith(label));
    });
    if (labelNode) {
      const group = labelNode.closest('.form-group, .form-row, .field') || labelNode.parentElement;
      const field = group?.querySelector('input:not([type="hidden"]), textarea, select');
      if (field) return field;
    }
    const groups = Array.from(form.querySelectorAll('.form-group, .form-row, .field'));
    for (const group of groups) {
      const content = normalize(group.textContent);
      if (!wanted.some(label => content.startsWith(label) || content.includes(label))) continue;
      const field = group.querySelector('input:not([type="hidden"]), textarea, select');
      if (field) return field;
    }
    return null;
  }

  function setFormValue(data, field, value) {
    if (field?.name) data.set(field.name, value);
  }

  function getErrorText(doc) {
    return normalize(Array.from(doc.querySelectorAll('.alert-danger, .callout-danger, .has-error .help-block, .error-message'))
      .map(item => item.textContent).join(' '));
  }

  function getActivityRows(doc) {
    return Array.from(doc.querySelectorAll('table tbody tr')).map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const id = normalize(row.dataset.key || cells[0]?.textContent);
      const name = normalize(cells[1]?.textContent);
      return /^\d+$/.test(id) && name ? { id, name } : null;
    }).filter(Boolean);
  }

  function getModuleRows(doc, listUrl) {
    return Array.from(doc.querySelectorAll('table tbody tr')).map(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const genericEditLink = Array.from(row.querySelectorAll('a[href]')).find(link =>
        /\/dm\/activity\/modules\/\d+\/edit\/?/.test(link.getAttribute('href') || '')
      );
      const moduleEditorLink = Array.from(row.querySelectorAll('a[href]')).find(link =>
        /模块编辑/.test(normalize(link.textContent))
        && /\/dm\/activity\/module\//.test(link.getAttribute('href') || '')
      );
      const linkedId = genericEditLink?.href.match(/\/modules\/(\d+)\/edit\/?/)?.[1] || '';
      const id = normalize(row.dataset.key || linkedId || cells[0]?.textContent);
      const rowText = normalize(row.textContent);
      const editUrl = moduleEditorLink?.href || genericEditLink?.href || (id
        ? new URL(`/16d7m/dm/activity/modules/${id}/edit`, location.origin).href + new URL(listUrl).search
        : '');
      return /^\d+$/.test(id) ? { id, rowText, editUrl } : null;
    }).filter(Boolean);
  }

  async function fetchDocument(url, description) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取${description}失败：HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function isActivityCreateForm(form) {
    try {
      return String(form.method).toLowerCase() === 'post'
        && /\/dm\/activity\/main\/?$/.test(new URL(form.getAttribute('action') || '', location.origin).pathname)
        && Boolean(findField(form, ['name'], ['活动名称']))
        && Boolean(findField(form, ['start_at'], ['开始时间']));
    } catch (_) {
      return false;
    }
  }

  function isModuleCreateForm(form) {
    try {
      return String(form.method).toLowerCase() === 'post'
        && /\/dm\/activity\/modules\/?$/.test(new URL(form.getAttribute('action') || '', location.origin).pathname)
        && Boolean(form.querySelector('select[name="module_type"]'))
        && Boolean(form.querySelector('[name="ac_id"]'));
    } catch (_) {
      return false;
    }
  }

  async function readActivityCreateForm(createUrl) {
    const doc = await fetchDocument(createUrl, '活动创建表单');
    const form = Array.from(doc.forms).find(isActivityCreateForm);
    if (!form) throw new Error('未识别到活动创建表单');
    return form;
  }

  async function createActivity(createUrl, sourceForm, name, knownIds) {
    const data = new FormData(sourceForm);
    setFormValue(data, findField(sourceForm, ['name'], ['活动名称']), name);
    setFormValue(data, findField(sourceForm, ['start_at'], ['开始时间']), DEFAULT_START_AT);
    setFormValue(data, findField(sourceForm, ['end_at'], ['结束时间']), DEFAULT_END_AT);
    setFormValue(data, findField(sourceForm, ['enable'], ['生效']), 'on');
    const backgroundField = findField(sourceForm, ['background_color', 'background'], ['背景色']);
    if (backgroundField?.name && !String(backgroundField.value || '').trim()) {
      setFormValue(data, backgroundField, DEFAULT_BACKGROUND_COLOR);
    }
    data.set('_previous_', getActivityListUrl());
    const action = new URL(sourceForm.getAttribute('action') || createUrl, createUrl).href;
    const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
    const resultDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const errorText = getErrorText(resultDoc);
    if (!response.ok) throw new Error(errorText || `创建活动失败：HTTP ${response.status}`);
    if (errorText || Array.from(resultDoc.forms).some(isActivityCreateForm)) {
      throw new Error(errorText || '后台未接受该活动');
    }
    const findCreated = doc => getActivityRows(doc).find(item => item.name === name && !knownIds.has(item.id));
    let created = findCreated(resultDoc);
    if (!created) created = findCreated(await fetchDocument(getActivityListUrl(), '活动列表'));
    if (!created) throw new Error('活动已提交，但未能识别新活动 ID；请刷新活动列表确认后再处理图片模块。');
    return created;
  }

  async function readModuleCreateForm(createUrl) {
    const doc = await fetchDocument(createUrl, '模块创建表单');
    const form = Array.from(doc.forms).find(isModuleCreateForm);
    const imageOption = Array.from(form?.querySelector('select[name="module_type"]')?.options || [])
      .find(option => normalize(option.textContent) === '图片');
    if (!form || !imageOption) throw new Error('未找到“图片”模块类型');
    return { form, imageType: String(imageOption.value) };
  }

  async function createImageModule(activityId, moduleUrls) {
    const beforeDoc = await fetchDocument(moduleUrls.listUrl, '活动模块列表');
    const knownIds = new Set(getModuleRows(beforeDoc, moduleUrls.listUrl).map(item => item.id));
    const { form, imageType } = await readModuleCreateForm(moduleUrls.createUrl);
    const data = new FormData(form);
    setFormValue(data, findField(form, ['ac_id'], ['活动']), String(activityId));
    setFormValue(data, findField(form, ['module_type'], ['模块类型']), imageType);
    setFormValue(data, findField(form, ['name'], ['名字', '名称']), MODULE_NAME);
    setFormValue(data, findField(form, ['start_at'], ['开始时间']), '');
    setFormValue(data, findField(form, ['end_at'], ['结束时间']), '');
    data.set('_previous_', moduleUrls.listUrl);
    const action = new URL(form.getAttribute('action') || moduleUrls.createUrl, moduleUrls.createUrl).href;
    const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
    const resultDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const errorText = getErrorText(resultDoc);
    if (!response.ok) throw new Error(errorText || `创建图片模块失败：HTTP ${response.status}`);
    if (errorText || Array.from(resultDoc.forms).some(isModuleCreateForm)) {
      throw new Error(errorText || '后台未接受图片模块');
    }
    const findCreated = doc => getModuleRows(doc, moduleUrls.listUrl)
      .find(item => item.rowText.includes(MODULE_NAME) && !knownIds.has(item.id));
    let created = findCreated(resultDoc);
    if (!created) created = findCreated(await fetchDocument(moduleUrls.listUrl, '活动模块列表'));
    if (!created?.editUrl) throw new Error('图片模块已提交，但未能识别模块编辑页。');
    return resolveImageModuleEditor(moduleUrls, created.id);
  }

  async function findExistingImageModule(moduleUrls) {
    const doc = await fetchDocument(moduleUrls.listUrl, '活动模块列表');
    const matches = getModuleRows(doc, moduleUrls.listUrl)
      .filter(item => item.rowText.includes(MODULE_NAME) && item.editUrl);
    return matches.length === 1 ? matches[0] : null;
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function resolveImageModuleEditor(moduleUrls, moduleId) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await wait(350 * attempt);
      const freshListUrl = new URL(moduleUrls.listUrl);
      freshListUrl.searchParams.set('_bb_refresh', `${Date.now()}-${attempt}`);
      const doc = await fetchDocument(freshListUrl.href, '活动模块列表');
      const row = getModuleRows(doc, moduleUrls.listUrl).find(item => item.id === String(moduleId));
      if (row?.editUrl && /\/dm\/activity\/module\/image\//.test(row.editUrl)) return row;
    }
    const fallbackUrl = new URL('/16d7m/dm/activity/module/image/create', location.origin);
    fallbackUrl.searchParams.set('module_id', String(moduleId));
    return { id: String(moduleId), rowText: MODULE_NAME, editUrl: fallbackUrl.href };
  }

  function findImageModuleForm(doc) {
    return Array.from(doc.forms).find(form => {
      try {
        const action = new URL(form.getAttribute('action') || '', location.origin).pathname;
        return String(form.method).toLowerCase() === 'post'
          && /\/dm\/activity\/module\/image(?:\/\d+)?\/?$/.test(action)
          && Boolean(form.querySelector('select[name="module_id"]'))
          && Boolean(form.querySelector('input[type="file"][name="image"]'));
      } catch (_) {
        return false;
      }
    }) || null;
  }

  function hasSavedImageRecord(doc, moduleId) {
    return Array.from(doc.querySelectorAll('table tbody tr')).some(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const rowId = normalize(row.dataset.key || cells[0]?.textContent);
      if (rowId !== String(moduleId)) return false;
      return Array.from(row.querySelectorAll('a[href]')).some(link =>
        /\/dm\/activity\/module\/image\/\d+\/edit\/?/.test(link.getAttribute('href') || '')
      );
    });
  }

  function waitForFrameLoad(frame, timeoutMs, description) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        frame.removeEventListener('load', onLoad);
        reject(new Error(`${description}超时`));
      }, timeoutMs);
      const onLoad = () => {
        window.clearTimeout(timer);
        frame.removeEventListener('load', onLoad);
        resolve();
      };
      frame.addEventListener('load', onLoad);
    });
  }

  async function openNativeFormPage(pageUrl, description) {
    const frame = document.createElement('iframe');
    frame.name = `bb-detail-image-upload-${Date.now()}`;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none;';
    const loaded = waitForFrameLoad(frame, 20000, description);
    // Set src before insertion. Inserting a src-less iframe can emit an
    // about:blank load event first and make callers inspect an empty document.
    frame.src = pageUrl;
    document.body.appendChild(frame);
    await loaded;
    if (!frame.contentDocument) {
      frame.remove();
      throw new Error('无法进入图片模块编辑页');
    }
    return frame;
  }

  async function waitForImageModuleForm(frame, timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const form = frame.contentDocument && findImageModuleForm(frame.contentDocument);
      if (form) return form;
      await wait(120);
    }
    return null;
  }

  async function uploadModuleImage(editUrl, file, moduleId, moduleListUrl) {
    const uploadUrl = new URL('/16d7m/dm/activity/module/image/create', location.origin);
    uploadUrl.searchParams.set('module_id', String(moduleId));
    const frame = await openNativeFormPage(uploadUrl.href, '打开图片模块编辑页');
    try {
      const form = await waitForImageModuleForm(frame);
      const doc = frame.contentDocument;
      const field = form?.querySelector('input[type="file"][name="image"]');
      const moduleSelect = form?.querySelector('select[name="module_id"]');
      if (!form || !field || !moduleSelect) throw new Error('未找到图片模块上传字段');
      moduleSelect.value = String(moduleId);
      moduleSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const transfer = new DataTransfer();
      transfer.items.add(file);
      field.files = transfer.files;
      field.dispatchEvent(new Event('change', { bubbles: true }));
      if (!field.files?.length) throw new Error('图片没有写入后台上传控件');
      const token = form.querySelector('[name="_token"]');
      if (token && !token.value) {
        token.value = doc.querySelector('meta[name="csrf-token"]')?.content
          || document.querySelector('meta[name="csrf-token"]')?.content
          || '';
      }
      const submitted = waitForFrameLoad(frame, 30000, '提交详情页图片');
      const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
      if (typeof form.requestSubmit === 'function') form.requestSubmit(submitButton || undefined);
      else form.submit();
      await submitted;
      const errorText = getErrorText(frame.contentDocument);
      if (errorText) throw new Error(errorText);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await wait(450 * attempt);
        const verificationUrl = new URL(moduleListUrl);
        verificationUrl.searchParams.set('_bb_verify', `${Date.now()}-${attempt}`);
        const listDoc = await fetchDocument(verificationUrl.href, '活动模块列表');
        if (hasSavedImageRecord(listDoc, moduleId)) return;
      }
      throw new Error('后台未生成图片记录，模块ID仍为 0。');
    } finally {
      frame.remove();
    }
  }

  function getPlaybookRelationUrls() {
    const listUrl = new URL('/16d7m/dm/activity/playbook_relation', location.origin);
    const createUrl = new URL('/16d7m/dm/activity/playbook_relation/create', location.origin);
    return { listUrl: listUrl.href, createUrl: createUrl.href };
  }

  function isPlaybookRelationCreateForm(form) {
    try {
      const action = new URL(form.getAttribute('action') || '', location.origin).pathname;
      return String(form.method).toLowerCase() === 'post'
        && /\/dm\/activity\/playbook_relation\/?$/.test(action)
        && Boolean(form.querySelector('[name="playbook_ac_id"]'))
        && Boolean(form.querySelector('select[name="playbook_type"]'))
        && Boolean(form.querySelector('select[name^="playbook_id"]'));
    } catch (_) {
      return false;
    }
  }

  function getOptionName(option) {
    return normalize(option?.textContent).replace(/\|\d+$/, '').trim();
  }

  function findOnlinePlaybook(form, activityName, frameWindow = null) {
    const typeSelect = form.querySelector('select[name="playbook_type"]');
    const onlineType = Array.from(typeSelect?.options || [])
      .find(option => normalize(option.textContent) === '线上本');
    if (!onlineType) throw new Error('关联页面没有“线上本”类型');
    typeSelect.value = String(onlineType.value);
    typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const selects = Array.from(form.querySelectorAll('select[name^="playbook_id"]'));
    const onlineGroupSelects = selects.filter(select =>
      Boolean(select.closest('.cascade-playbook_type-31'))
    );
    const visibleSelects = frameWindow ? selects.filter(select => {
      const group = select.closest('.form-group') || select.parentElement;
      return group && frameWindow.getComputedStyle(group).display !== 'none';
    }) : [];
    const candidates = onlineGroupSelects.length ? onlineGroupSelects : visibleSelects.length ? visibleSelects : selects;
    const onlineSelect = candidates.find(select =>
      Array.from(select.options).some(option => option.value && getOptionName(option) === activityName)
    ) || selects.findLast?.(select =>
      Array.from(select.options).some(option => option.value && getOptionName(option) === activityName)
    );
    const unique = Array.from(new Map(Array.from(onlineSelect?.options || [])
      .filter(option => option.value && getOptionName(option) === activityName)
      .map(option => [String(option.value), { id: String(option.value), name: getOptionName(option), option }])).values());
    if (!unique.length) throw new Error(`线上本列表中未找到同名剧本“${activityName}”`);
    if (unique.length > 1) throw new Error(`线上本列表中存在多个同名剧本“${activityName}”，无法自动确定`);
    return { typeValue: String(onlineType.value), playbook: unique[0], typeSelect, onlineSelect };
  }

  function hasPlaybookRelation(doc, activityId, playbookId) {
    return Array.from(doc.querySelectorAll('table tbody tr')).some(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      const activityText = normalize(cells[1]?.textContent);
      const playbookText = normalize(cells[3]?.textContent);
      return activityText.includes(`|${activityId}`) && playbookText.includes(`|${playbookId}`);
    });
  }

  async function createPlaybookRelation(activity, activityName) {
    const urls = getPlaybookRelationUrls();
    const beforeDoc = await fetchDocument(urls.listUrl, '剧本关联列表');
    const doc = await fetchDocument(urls.createUrl, '剧本关联创建页');
    const form = Array.from(doc.forms).find(isPlaybookRelationCreateForm);
    const activitySelect = form?.querySelector('select[name="playbook_ac_id"]');
    if (!form || !activitySelect) throw new Error('未识别到剧本关联表单');
    const activityOption = Array.from(activitySelect.options)
      .find(option => String(option.value) === String(activity.id));
    if (!activityOption) throw new Error(`关联页面中未找到活动 ${activity.id}`);
    const { playbook, typeValue } = findOnlinePlaybook(form, activityName);
    if (hasPlaybookRelation(beforeDoc, activity.id, playbook.id)) return playbook;
    const token = form.querySelector('[name="_token"]');
    if (token && !token.value) {
      token.value = doc.querySelector('meta[name="csrf-token"]')?.content
        || document.querySelector('meta[name="csrf-token"]')?.content
        || '';
    }

    // Laravel Admin inserts empty hidden inputs before each select. A native
    // submission therefore sends duplicate keys and this endpoint may keep the
    // empty value. Build the payload explicitly so the selected online script
    // is the only playbook id received by the backend.
    const payload = new URLSearchParams();
    payload.set('playbook_ac_id', String(activity.id));
    payload.set('playbook_type', typeValue);
    payload.append('playbook_id[]', String(playbook.id));
    payload.set('status', 'on');
    if (token?.value) payload.set('_token', token.value);
    const response = await fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'follow',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: payload.toString()
    });
    if (!response.ok) throw new Error(`剧本关联提交失败（HTTP ${response.status}）`);
    const responseDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const errorText = getErrorText(responseDoc);
    if (errorText) throw new Error(errorText);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await wait(350 * attempt);
      const verificationUrl = new URL(urls.listUrl);
      verificationUrl.searchParams.set('_bb_verify', `${Date.now()}-${attempt}`);
      const listDoc = await fetchDocument(verificationUrl.href, '剧本关联列表');
      if (hasPlaybookRelation(listDoc, activity.id, playbook.id)) return playbook;
    }
    throw new Error('关联请求已提交，但关联列表中未找到对应记录');
  }

  function openModal(createUrl) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-detail-page-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-detail-page-title">
        <h3 id="bb-detail-page-title">创建剧本详情页</h3>
        <div class="bb-detail-page-hint">将创建活动、新增“${MODULE_NAME}”图片模块并上传图片，最后按名称关联同名线上本。活动时间与 382 保持一致，模块时间留空。</div>
        <label for="bb-detail-page-name">活动名称（需与线上本名称一致）</label>
        <input id="bb-detail-page-name" type="text" maxlength="120" autocomplete="off" data-bb-detail-page-name placeholder="输入活动名称">
        <label for="bb-detail-page-image">剧本详情页图片</label>
        <input id="bb-detail-page-image" type="file" accept="image/*" data-bb-detail-page-image>
        <div class="bb-detail-page-time">活动开始时间：${DEFAULT_START_AT}<br>活动结束时间：${DEFAULT_END_AT}<br>模块名称：${MODULE_NAME}；模块开始、结束时间为空。</div>
        <div class="bb-detail-page-status" data-bb-detail-page-status>正在读取活动创建表单…</div>
        <div class="bb-detail-page-actions">
          <button type="button" class="btn btn-default" data-bb-detail-page-cancel>取消</button>
          <button type="button" class="btn btn-success" data-bb-detail-page-confirm disabled>确认创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const nameInput = modal.querySelector('[data-bb-detail-page-name]');
    const imageInput = modal.querySelector('[data-bb-detail-page-image]');
    const status = modal.querySelector('[data-bb-detail-page-status]');
    const cancel = modal.querySelector('[data-bb-detail-page-cancel]');
    const confirm = modal.querySelector('[data-bb-detail-page-confirm]');
    let activityForm = null;
    let createdActivity = null;
    let createdModule = null;
    let imageUploaded = false;
    let relationCreated = false;
    const refreshConfirm = () => {
      confirm.disabled = !activityForm || !normalize(nameInput.value) || !imageInput.files?.[0];
    };
    const close = () => modal.remove();
    nameInput.addEventListener('input', refreshConfirm);
    imageInput.addEventListener('change', refreshConfirm);
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });
    readActivityCreateForm(createUrl).then(form => {
      activityForm = form;
      status.textContent = '请输入活动名称并选择详情页图片。';
      refreshConfirm();
    }).catch(error => {
      status.className = 'bb-detail-page-status bb-detail-page-error';
      status.textContent = error.message || String(error);
    });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        window.location.reload();
        return;
      }
      const name = normalize(nameInput.value);
      const file = imageInput.files?.[0];
      if (!activityForm || !name || !file) return;
      confirm.disabled = true;
      cancel.disabled = true;
      nameInput.disabled = true;
      imageInput.disabled = true;
      try {
        if (!createdActivity) {
          status.className = 'bb-detail-page-status';
          const sameNameActivities = getActivityRows(document).filter(item => item.name === name);
          if (sameNameActivities.length === 1) {
            createdActivity = sameNameActivities[0];
            status.textContent = `检测到同名活动（ID：${createdActivity.id}），将继续补充图片模块和详情页图片…`;
          } else {
            status.textContent = '正在创建活动…';
            const knownIds = new Set(sameNameActivities.map(item => item.id));
            createdActivity = await createActivity(createUrl, activityForm, name, knownIds);
          }
        }
        if (!createdModule) {
          status.textContent = `活动 ${createdActivity.id} 已创建，正在新增图片模块…`;
          const moduleUrls = getModuleUrls(createdActivity.id);
          createdModule = await findExistingImageModule(moduleUrls)
            || await createImageModule(createdActivity.id, moduleUrls);
        }
        const moduleUrls = getModuleUrls(createdActivity.id);
        if (!imageUploaded) {
          status.textContent = '图片模块已创建，正在返回模块列表并进入“模块编辑”…';
          createdModule = await resolveImageModuleEditor(moduleUrls, createdModule.id);
          if (/\/dm\/activity\/module\/image\/\d+\/edit\/?/.test(createdModule.editUrl)) {
            imageUploaded = true;
          } else {
            status.textContent = '已进入图片模块编辑页，正在上传详情页图片…';
            await uploadModuleImage(createdModule.editUrl, file, createdModule.id, moduleUrls.listUrl);
            imageUploaded = true;
          }
        }
        if (!relationCreated) {
          status.textContent = `图片已保存，正在按名称“${name}”匹配线上本并建立关联…`;
          const playbook = await createPlaybookRelation(createdActivity, name);
          relationCreated = true;
          status.textContent = `已创建活动“${name}”（ID：${createdActivity.id}）、上传图片，并关联线上本“${playbook.name}”（ID：${playbook.id}）。`;
        }
        confirm.disabled = false;
        confirm.dataset.finished = 'true';
        confirm.textContent = '完成并刷新';
        cancel.style.display = 'none';
      } catch (error) {
        status.className = 'bb-detail-page-status bb-detail-page-error';
        status.textContent = `${error.message || '创建失败'}\n再次点击“确认创建”会从已完成的阶段继续。`;
        confirm.disabled = false;
        cancel.disabled = false;
      }
    });
    nameInput.focus();
  }

  function update() {
    if (!isActivityList() || document.querySelector(`a[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-warning';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '创建剧本详情页';
    button.addEventListener('click', event => { event.preventDefault(); openModal(createLink.href); });
    createLink.insertAdjacentElement('beforebegin', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(update, 900);
  update();
})();

// 计划任务快捷发放剧本：在任务列表直接填写用户和剧本，并复用后台原生创建表单提交。
(() => {
  'use strict';

  const BUTTON_ID = 'bb-quick-grant-playbook-button';
  const MODAL_ID = 'bb-quick-grant-playbook-modal';
  const STYLE_ID = 'bb-quick-grant-playbook-style';
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isTaskList = () => /\/tasks\/?$/.test(location.pathname) && !/\/create\/?$/.test(location.pathname);
  const isTaskCreate = () => /\/tasks\/create\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.42); }
      #${MODAL_ID} .bb-quick-dialog { width: min(520px, calc(100vw - 36px)); padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 16px; color: #3c4b5a; }
      #${MODAL_ID} label { display: block; margin: 10px 0; color: #596b7b; }
      #${MODAL_ID} input, #${MODAL_ID} select, #${MODAL_ID} textarea { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 5px 8px; border: 1px solid #ccd6df; border-radius: 3px; background: #fff; } #${MODAL_ID} textarea { min-height: 72px; resize: vertical; }
      #${MODAL_ID} [data-quick-playbook] { min-height: 180px; }
      #${MODAL_ID} .bb-quick-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      #${MODAL_ID} button { padding: 7px 14px; border: 0; border-radius: 3px; cursor: pointer; }
      #${MODAL_ID} [data-quick-cancel] { background: #eee; } #${MODAL_ID} [data-quick-confirm] { color: #fff; background: #00a65a; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/tasks/create"]')).find(link => /新增/.test(normalize(link.textContent)))
      || document.querySelector('a[href*="/tasks/create"]');
  }

  const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));

  async function prepareLiveForm(createUrl) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;border:0;';
    document.body.appendChild(frame);
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('新建任务页面加载超时')), 12000);
      frame.addEventListener('load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
      frame.src = createUrl;
    });
    const initialDoc = frame.contentDocument;
    const type = Array.from(initialDoc.querySelectorAll('select')).find(select =>
      Array.from(select.options).some(option => /发放剧本/.test(normalize(option.textContent)))
    );
    const typeOption = type && Array.from(type.options).find(option => /发放剧本/.test(normalize(option.textContent)));
    if (!typeOption) { frame.remove(); throw new Error('未找到“发放剧本”任务类型'); }
    setValue(type, typeOption.value);
    let playbook = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const doc = frame.contentDocument;
      const currentForm = Array.from(doc?.forms || []).find(item => item.method.toLowerCase() === 'post') || doc?.forms[0];
      playbook = Array.from(currentForm?.querySelectorAll('select[name="__playbook_id"]') || []).find(item => item.offsetWidth || item.offsetHeight)
        || Array.from(currentForm?.querySelectorAll('select') || []).find(item =>
          (item.offsetWidth || item.offsetHeight) && /剧本/.test(normalize(item.closest('.form-group, .form-row, .field, .row')?.textContent))
        );
      if (playbook && Array.from(playbook.options).some(option => option.value)) return { frame, doc, form: currentForm, playbook };
      await wait(200);
    }
    frame.remove();
    throw new Error('发放剧本表单已打开，但剧本列表加载超时');
  }

  async function readPlaybooks(createUrl) {
    const live = await prepareLiveForm(createUrl);
    try {
      const playbooks = Array.from(live.playbook.options).filter(option => option.value && !/请选择/.test(normalize(option.textContent)))
        .map(option => ({ value: option.value, label: normalize(option.textContent) }))
        .reverse();
      if (!playbooks.length) throw new Error('剧本下拉框已识别，但没有可选剧本');
      return playbooks;
    } finally { live.frame.remove(); }
  }

  function openModal(createUrl) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `<div class="bb-quick-dialog"><h3>快捷发放剧本</h3><div data-quick-status>正在读取剧本列表…</div><label>剧本（可多选）<input data-quick-playbook-search type="search" placeholder="搜索剧本名称或ID" autocomplete="off" disabled /><select data-quick-playbook multiple size="8" disabled></select><div data-quick-playbook-empty hidden>没有匹配的剧本</div></label><label>用户 ID（多个用逗号、空格或换行分隔）<textarea data-quick-user placeholder="例如：5037,5038"></textarea></label><label>计划执行时间<input data-quick-time type="date" /></label><div class="bb-quick-actions"><button type="button" data-quick-cancel>取消</button><button type="button" data-quick-confirm disabled>创建任务</button></div></div>`;
    document.body.appendChild(modal);
    const playbook = modal.querySelector('[data-quick-playbook]');
    const playbookSearch = modal.querySelector('[data-quick-playbook-search]');
    const playbookEmpty = modal.querySelector('[data-quick-playbook-empty]');
    const user = modal.querySelector('[data-quick-user]');
    const time = modal.querySelector('[data-quick-time]');
    const status = modal.querySelector('[data-quick-status]');
    const confirm = modal.querySelector('[data-quick-confirm]');
    const today = new Date();
    let allPlaybookOptions = [];
    const selectedPlaybookValues = new Set();
    time.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    modal.querySelector('[data-quick-cancel]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    playbook.addEventListener('change', () => {
      Array.from(playbook.options).forEach(option => {
        if (option.selected) selectedPlaybookValues.add(option.value);
        else selectedPlaybookValues.delete(option.value);
      });
    });
    const filterPlaybooks = () => {
      const query = normalize(playbookSearch.value).toLocaleLowerCase();
      const visibleOptions = allPlaybookOptions.filter(item =>
        !query || `${normalize(item.label)} ${normalize(item.value)}`.toLocaleLowerCase().includes(query)
      );
      playbook.replaceChildren(...visibleOptions.map(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        option.selected = selectedPlaybookValues.has(item.value);
        return option;
      }));
      const visibleCount = visibleOptions.length;
      playbookEmpty.hidden = !query || visibleCount > 0;
    };
    playbookSearch.addEventListener('input', filterPlaybooks);
    readPlaybooks(createUrl).then(options => {
      allPlaybookOptions = options;
      playbookSearch.disabled = false; playbook.disabled = false; confirm.disabled = false; filterPlaybooks(); status.textContent = '任务名称将自动生成：给用户ID发放剧本';
    }).catch(error => { status.textContent = error.message; status.style.color = '#c0392b'; });
    confirm.addEventListener('click', () => {
      const userIds = normalize(user.value).split(/[，,\s]+/).filter(Boolean);
      const selected = allPlaybookOptions.filter(item => selectedPlaybookValues.has(item.value));
      if (!userIds.length || userIds.some(id => !/^\d+$/.test(id))) return window.alert('请输入有效的用户ID');
      if (!selected.length) return window.alert('请至少选择一个剧本');
      createTasks(createUrl, selected, userIds, time.value, modal);
    });
    user.focus();
  }

  function findField(form, patterns, tag = 'input,select,textarea') {
    return Array.from(form.querySelectorAll(tag)).find(control => {
      const groupText = normalize(control.closest('.form-group, .form-row, .field, .row')?.textContent);
      return patterns.some(pattern => pattern.test(`${control.name} ${control.id} ${control.placeholder || ''} ${groupText}`));
    });
  }

  function setValue(control, value) {
    if (!control) return false;
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    try { const jq = control.ownerDocument?.defaultView?.jQuery; if (jq) jq(control).val(value).trigger('change'); } catch (_) { /* ignore */ }
    return true;
  }

  async function createTasks(createUrl, playbooks, userIds, date, modal) {
    const status = modal.querySelector('[data-quick-status]');
    const button = modal.querySelector('[data-quick-confirm]'); button.disabled = true;
    status.style.color = '';
    status.textContent = `准备创建 ${playbooks.length} 条任务…`;
    try {
      for (let index = 0; index < playbooks.length; index += 1) {
        const live = await prepareLiveForm(createUrl);
        const { form } = live;
        const name = form.querySelector('[name="name"]');
        const planTime = form.querySelector('[name="schedule_at"]');
        const activeGroup = live.playbook.closest('div.cascade-group');
        const userId = activeGroup?.querySelector('[name="__multi_uid"]');
        const activity = activeGroup?.querySelector('select[name="__section"]');
        const shareCate = activeGroup?.querySelector('input[name="__share_cate"]');
        if (![name, planTime, activeGroup, userId, activity, shareCate].every(Boolean)) throw new Error('发放剧本参数字段识别不完整');
        setValue(name, `给${userIds.join(',')}发放${playbooks[index].label}`);
        setValue(live.playbook, playbooks[index].value);
        setValue(userId, userIds.join(','));
        setValue(activity, '2');
        setValue(shareCate, 'off');
        setValue(planTime, `${date} 00:00:00`);
        const action = new URL(form.getAttribute('action') || createUrl, createUrl).href;
        const body = new FormData();
        body.append('_token', form.querySelector('[name="_token"]')?.value || '');
        body.append('cate', '22');
        body.append('name', name.value);
        body.append('__playbook_id', playbooks[index].value);
        body.append('__multi_uid', userIds.join(','));
        body.append('__section', '2');
        body.append('__share_cate', 'off');
        body.append('schedule_at', planTime.value);
        body.append('_previous_', form.querySelector('[name="_previous_"]')?.value || new URL('/16d7m/tasks', createUrl).href);
        const result = await fetch(action, { method: 'POST', body, credentials: 'same-origin' });
        live.frame.remove();
        if (!result.ok) throw new Error(`创建失败：HTTP ${result.status}`);
        if (/\/tasks\/create\/?(?:\?|$)/.test(new URL(result.url).pathname + new URL(result.url).search)) {
          throw new Error('后台未接受任务参数，请检查填写内容');
        }
        status.textContent = `正在创建 ${index + 1}/${playbooks.length} 个任务…`;
      }
      status.textContent = `已成功创建 ${playbooks.length} 条发放剧本任务`;
      window.setTimeout(() => { modal.remove(); window.location.reload(); }, 900);
    } catch (error) { status.textContent = error.message || '创建失败'; status.style.color = '#c0392b'; button.disabled = false; }
  }

  function update() {
    if (!isTaskList() || document.getElementById(BUTTON_ID)) return;
    const link = findCreateLink(); if (!link) return;
    addStyles(); const button = document.createElement('button'); button.id = BUTTON_ID; button.type = 'button'; button.className = 'btn btn-success'; button.textContent = '快捷发放剧本';
    button.addEventListener('click', () => openModal(link.href)); link.insertAdjacentElement('afterend', button);
  }
  const schedule = () => window.setTimeout(update, 180);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(update, 800); update();
})();

// 主菜单自定义快捷功能：从后台现有菜单中选择页面，设置自定义名称并持久化到浏览器。
(() => {
  'use strict';

  const PANEL_ID = 'bb-main-menu-shortcuts';
  const STYLE_ID = 'bb-main-menu-shortcuts-style';
  const STORAGE_KEY = 'bb-main-menu-shortcuts-v1';
  let updateTimer = null;

  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isAdminPage = () => location.hostname.endsWith('mszmapp.com')
    && location.pathname.startsWith('/16d7m/');

  function getSidebar() {
    return document.querySelector('.main-sidebar .sidebar-menu')
      || document.querySelector('.sidebar-menu')
      || document.querySelector('aside ul');
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} { display: block !important; position: relative !important; float: none !important; clear: both !important; z-index: 20; width: 100%; height: auto !important; min-height: 48px; box-sizing: border-box; list-style: none; margin: 0 0 8px !important; padding: 0 !important; overflow: visible !important; background: #f4f4f5; }
      #${PANEL_ID} .bb-menu-shortcuts-header { display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 21; min-height: 48px; box-sizing: border-box; padding: 10px 15px 6px; color: #9aa4ad; font-size: 12px; background: #f4f4f5; }
      #${PANEL_ID} .bb-menu-shortcuts-add { border: 0; color: #fff; background: #3c8dbc; border-radius: 3px; padding: 1px 7px; cursor: pointer; }
      #${PANEL_ID} .bb-menu-shortcuts-form { display: none; position: relative; z-index: 21; margin: 4px 10px 8px; padding: 8px; background: #e9e9ea; }
      #${PANEL_ID} .bb-menu-shortcuts-form.is-open { display: block; }
      #${PANEL_ID} select, #${PANEL_ID} input { display: block; box-sizing: border-box; width: 100%; height: 29px; margin-bottom: 6px; padding: 3px 6px; border: 1px solid #ccd6df; border-radius: 3px; background: #fff; color: #333; }
      #${PANEL_ID} .bb-menu-shortcuts-actions { display: flex; gap: 5px; }
      #${PANEL_ID} .bb-menu-shortcuts-actions button { flex: 1; border: 0; border-radius: 3px; padding: 4px; cursor: pointer; }
      #${PANEL_ID} .bb-menu-shortcuts-save { color: #fff; background: #00a65a; }
      #${PANEL_ID} .bb-menu-shortcuts-cancel { color: #333; background: #eee; }
      #${PANEL_ID} .bb-menu-shortcuts-list { display: block !important; position: relative; z-index: 21; width: 100%; height: auto !important; min-height: 0; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
      #${PANEL_ID} .bb-menu-shortcut-link { display: flex; align-items: center; min-height: 32px; }
      #${PANEL_ID} .bb-menu-shortcut-link a { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${PANEL_ID} .bb-menu-shortcut-delete { margin-right: 10px; border: 0; color: #f2a0a0; background: transparent; cursor: pointer; font-size: 15px; }
      #${PANEL_ID} .bb-menu-shortcuts-empty { display: block; padding: 4px 15px 8px; color: #71808d; font-size: 12px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  async function loadShortcuts() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    } catch (_) {
      return [];
    }
  }

  async function saveShortcuts(shortcuts) {
    await chrome.storage.local.set({ [STORAGE_KEY]: shortcuts });
  }

  function getMenuOptions(sidebar) {
    const seen = new Set();
    return Array.from(sidebar.querySelectorAll('a[href]'))
      .map(link => ({
        url: link.href,
        label: text(link.querySelector('span')?.textContent || link.textContent),
      }))
      .filter(item => item.label && /^https?:/.test(item.url)
        && item.url.includes('/16d7m/')
        && !item.url.endsWith('#')
        && !seen.has(item.url)
        && seen.add(item.url));
  }

  function createPanel(sidebar, menuOptions, shortcuts) {
    const panel = document.createElement('li');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="bb-menu-shortcuts-header">
        <span>自定义快捷功能</span>
        <button type="button" class="bb-menu-shortcuts-add" title="添加自定义快捷功能">+</button>
      </div>
      <div class="bb-menu-shortcuts-form">
        <select data-bb-menu-target aria-label="选择后台菜单"></select>
        <input type="text" data-bb-menu-name placeholder="输入自定义名称" maxlength="30" />
        <div class="bb-menu-shortcuts-actions">
          <button type="button" class="bb-menu-shortcuts-save">保存</button>
          <button type="button" class="bb-menu-shortcuts-cancel">取消</button>
        </div>
      </div>
      <ul class="bb-menu-shortcuts-list"></ul>
    `;
    const target = panel.querySelector('[data-bb-menu-target]');
    menuOptions.forEach(optionData => {
      const option = document.createElement('option');
      option.value = optionData.url;
      option.textContent = optionData.label;
      target.appendChild(option);
    });
    const list = panel.querySelector('.bb-menu-shortcuts-list');
    if (!shortcuts.length) {
      const empty = document.createElement('li');
      empty.className = 'bb-menu-shortcuts-empty';
      empty.textContent = '暂未添加快捷功能';
      list.appendChild(empty);
    } else {
      shortcuts.forEach(shortcut => {
        const item = document.createElement('li');
        item.className = 'bb-menu-shortcut-link';
        const link = document.createElement('a');
        link.href = shortcut.url;
        link.textContent = shortcut.name;
        link.title = shortcut.sourceLabel || shortcut.url;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'bb-menu-shortcut-delete';
        remove.title = `删除快捷功能：${shortcut.name}`;
        remove.textContent = '×';
        remove.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          if (!window.confirm(`确定删除快捷功能“${shortcut.name}”吗？`)) return;
          await saveShortcuts((await loadShortcuts()).filter(itemData => itemData.id !== shortcut.id));
          schedule();
        });
        item.append(link, remove);
        list.appendChild(item);
      });
    }

    const form = panel.querySelector('.bb-menu-shortcuts-form');
    panel.querySelector('.bb-menu-shortcuts-add').addEventListener('click', () => {
      form.classList.add('is-open');
      panel.querySelector('[data-bb-menu-name]').focus();
    });
    panel.querySelector('.bb-menu-shortcuts-cancel').addEventListener('click', () => {
      form.classList.remove('is-open');
    });
    panel.querySelector('.bb-menu-shortcuts-save').addEventListener('click', async () => {
      const nameControl = panel.querySelector('[data-bb-menu-name]');
      const name = text(nameControl.value);
      const option = target.selectedOptions[0];
      if (!option || !name) return window.alert('请选择菜单并输入自定义名称');
      const current = await loadShortcuts();
      if (current.some(itemData => itemData.name === name)) {
        return window.alert('自定义名称已存在，请换一个名称');
      }
      current.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        url: option.value,
        sourceLabel: text(option.textContent),
      });
      await saveShortcuts(current);
      form.classList.remove('is-open');
      nameControl.value = '';
      schedule();
    });
    return panel;
  }

  async function update() {
    if (!isAdminPage()) return;
    const sidebar = getSidebar();
    if (!sidebar) {
      window.setTimeout(update, 300);
      return;
    }
    addStyles();
    let panel = document.getElementById(PANEL_ID);
    if (panel && !sidebar.contains(panel)) {
      panel.remove();
      panel = null;
    }
    if (panel) return;
    const menuOptions = getMenuOptions(sidebar);
    const shortcuts = await loadShortcuts();
    panel = createPanel(sidebar, menuOptions, shortcuts);
    sidebar.prepend(panel);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 150);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(update, 800);
  update();
})();

// 剧本活动新增跳转动作：顶部只放一个按钮，先按活动 ID/名称选择活动，再填充系统动作表单。
(() => {
  'use strict';

  const BUTTON_ID = 'bb-create-activity-action-button';
  const MODAL_ID = 'bb-create-activity-action-modal';
  const STYLE_ID = 'bb-create-activity-action-style';
  const PENDING_KEY = 'bb-activity-action-pending-v1';
  const ACTION_URL = 'https://m.mszmapp.com/web2023/playbook/activity-module?activity_id=';

  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isActivityList = () => /\/dm\/activity\/main\/?$/.test(location.pathname);
  const isActionCreate = () => /\/sys\/actions\/create\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} { margin-left: 8px; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.42); }
      #${MODAL_ID} .bb-activity-action-dialog { width: min(520px, calc(100vw - 36px)); padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 16px; color: #3c4b5a; }
      #${MODAL_ID} label { display: block; margin-bottom: 8px; color: #596b7b; }
      #${MODAL_ID} input, #${MODAL_ID} select { box-sizing: border-box; width: 100%; height: 34px; margin-top: 6px; padding: 5px 8px; border: 1px solid #ccd6df; border-radius: 3px; background: #fff; }
      #${MODAL_ID} .bb-activity-action-url { margin: 10px 0 18px; padding: 8px; color: #65788a; word-break: break-all; background: #f4f7f9; border-radius: 3px; font-size: 12px; }
      #${MODAL_ID} .bb-activity-action-actions { display: flex; justify-content: flex-end; gap: 8px; }
      #${MODAL_ID} button { padding: 7px 14px; border: 0; border-radius: 3px; cursor: pointer; }
      #${MODAL_ID} [data-activity-action-cancel] { color: #333; background: #eee; }
      #${MODAL_ID} [data-activity-action-confirm] { color: #fff; background: #3c8dbc; }
      #bb-activity-action-notice { margin: 12px 20px; padding: 10px 14px; color: #0b6b36; background: #e8f7ee; border: 1px solid #a9dec0; border-radius: 4px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function readActivities() {
    const table = document.querySelector('table');
    return Array.from(table?.querySelectorAll('tbody tr') || []).map(row => {
      const cells = row.querySelectorAll('td');
      const id = text(cells[0]?.textContent);
      const name = text(cells[1]?.textContent);
      return /^\d+$/.test(id) && name ? { id, name } : null;
    }).filter(Boolean);
  }

  function openActivityPicker(activities) {
    document.getElementById(MODAL_ID)?.remove();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-activity-action-dialog">
        <h3>新增跳转动作</h3>
        <label>按活动 ID 或名称查找
          <input type="search" data-activity-action-search placeholder="输入活动 ID 或活动名称" />
        </label>
        <label>选择活动
          <select data-activity-action-select></select>
        </label>
        <div class="bb-activity-action-url" data-activity-action-url></div>
        <div class="bb-activity-action-actions">
          <button type="button" data-activity-action-cancel>取消</button>
          <button type="button" data-activity-action-confirm>进入动作新建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const search = modal.querySelector('[data-activity-action-search]');
    const select = modal.querySelector('[data-activity-action-select]');
    const urlPreview = modal.querySelector('[data-activity-action-url]');

    function renderOptions() {
      const keyword = text(search.value).toLowerCase();
      const filtered = activities.filter(item => !keyword
        || item.id.toLowerCase().includes(keyword)
        || item.name.toLowerCase().includes(keyword));
      const previous = select.value;
      select.replaceChildren();
      filtered.forEach(item => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.id}｜${item.name}`;
        option.dataset.name = item.name;
        select.appendChild(option);
      });
      if (filtered.some(item => item.id === previous)) select.value = previous;
      updatePreview();
    }

    function updatePreview() {
      const item = activities.find(activity => activity.id === select.value);
      urlPreview.textContent = item ? `${ACTION_URL}${item.id}` : '没有匹配的活动';
    }

    search.addEventListener('input', renderOptions);
    select.addEventListener('change', updatePreview);
    modal.querySelector('[data-activity-action-cancel]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('[data-activity-action-confirm]').addEventListener('click', async () => {
      const item = activities.find(activity => activity.id === select.value);
      if (!item) return window.alert('请先选择活动');
      await chrome.storage.local.set({
        [PENDING_KEY]: {
          name: item.name,
          activityId: item.id,
          parameter: `${ACTION_URL}${item.id}`,
          createdAt: Date.now(),
        },
      });
      window.location.href = '/16d7m/sys/actions/create';
    });
    renderOptions();
    search.focus();
  }

  function addActivityButton() {
    if (!isActivityList() || document.getElementById(BUTTON_ID)) return;
    const addLink = Array.from(document.querySelectorAll('a[href*="/dm/activity/main/create"]'))
      .find(link => /新增/.test(text(link.textContent)));
    if (!addLink) return;
    addStyles();
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'btn btn-info btn-sm';
    button.textContent = '新增跳转动作';
    button.addEventListener('click', () => {
      const activities = readActivities();
      if (!activities.length) return window.alert('当前页面没有可选择的活动');
      openActivityPicker(activities);
    });
    addLink.insertAdjacentElement('afterend', button);
  }

  function findActionField(form, labelText) {
    const target = text(labelText);
    const label = Array.from(form.querySelectorAll('label, .control-label, .field-label'))
      .find(item => text(item.textContent) === target);
    if (label) {
      let node = label;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        const input = node.querySelector('input:not([type="hidden"])');
        if (input) return input;
      }
    }
    return Array.from(form.querySelectorAll('input:not([type="hidden"])')).find(input =>
      text(input.closest('.form-group, .form-row, .field, .row')?.textContent).includes(target)
    ) || null;
  }

  async function fillPendingAction() {
    if (!isActionCreate()) return;
    const stored = await chrome.storage.local.get(PENDING_KEY);
    const pending = stored[PENDING_KEY];
    if (!pending || Date.now() - pending.createdAt > 5 * 60 * 1000) return;
    const form = Array.from(document.forms).find(item =>
      findActionField(item, '名称') && findActionField(item, '参数')
    );
    if (!form) {
      window.setTimeout(fillPendingAction, 300);
      return;
    }
    const nameInput = findActionField(form, '名称');
    const parameterInput = findActionField(form, '参数');
    nameInput.value = pending.name;
    parameterInput.value = pending.parameter;
    [nameInput, parameterInput].forEach(input => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const typeSelect = Array.from(form.querySelectorAll('select')).find(select =>
      Array.from(select.options).some(option => /跳转网页/.test(text(option.textContent)))
    );
    if (typeSelect) {
      const option = Array.from(typeSelect.options).find(item => /跳转网页/.test(text(item.textContent)));
      typeSelect.value = option.value;
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      try { if (window.jQuery) window.jQuery(typeSelect).val(option.value).trigger('change'); } catch (_) { /* ignore */ }
    }
    await chrome.storage.local.remove(PENDING_KEY);
    const notice = document.createElement('div');
    notice.id = 'bb-activity-action-notice';
    notice.textContent = `已填入活动“${pending.name}”的跳转动作，请确认后点击后台原有的“提交”。`;
    form.parentElement?.insertBefore(notice, form);
  }

  let timer = null;
  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { addActivityButton(); fillPendingAction(); }, 150);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => { addActivityButton(); fillPendingAction(); }, 800);
  schedule();
})();

// 上架与售价快捷设置：一键填写免费本、金币本或钻石本的价格字段。
(() => {
  'use strict';

  const PANEL_ID = 'bb-product-price-panel';
  const STYLE_ID = 'bb-product-price-style';
  const priceLabels = [
    '售价（钻石）', '售价（金币）', '原价(钻石)', '原价(金币)',
    '纷享售价(钻石)', '纷享售价(金币)', '纷享原价(钻石)', '纷享原价(金币)',
  ];

  const normalize = value => String(value ?? '').replace(/[\s：:]/g, '').trim();
  const isProductEdit = () => /\/playbook\/products\/[^/]+\/edit\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} { margin: 0 0 14px; padding: 14px 16px; border: 1px solid #d8e3ed; border-radius: 4px; background: #f8fbfd; }
      #${PANEL_ID} .bb-price-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      #${PANEL_ID} .bb-price-title { color: #3c4b5a; font-size: 16px; font-weight: 600; margin-right: 4px; }
      #${PANEL_ID} .bb-price-toolbar button.is-active { box-shadow: inset 0 0 0 2px rgba(255,255,255,.7); }
      #${PANEL_ID} .bb-price-inputs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
      #${PANEL_ID} input { width: 100px; height: 30px; padding: 4px 8px; border: 1px solid #ccd6df; border-radius: 3px; }
      #${PANEL_ID} .bb-price-preview { margin-top: 12px; color: #596b7b; font-size: 13px; }
      #${PANEL_ID} .bb-price-preview table { margin-top: 6px; background: #fff; }
      #${PANEL_ID} .bb-price-preview td, #${PANEL_ID} .bb-price-preview th { padding: 4px 10px; border: 1px solid #e2e8ee; }
      #${PANEL_ID} .bb-price-status { margin-left: 8px; color: #00a65a; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findForm() {
    return Array.from(document.forms).find(form => {
      const text = normalize(form.textContent);
      return priceLabels.every(label => text.includes(normalize(label)))
        && form.querySelector('input');
    }) || null;
  }

  function findInput(form, labelText) {
    const target = normalize(labelText);
    const labels = Array.from(form.querySelectorAll('label, .control-label, .field-label, .input-group-addon'));
    const label = labels.find(item => normalize(item.textContent) === target);
    if (label) {
      let node = label;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        const input = node.querySelector('input:not([type="hidden"])');
        if (input) return input;
      }
    }
    return Array.from(form.querySelectorAll('input:not([type="hidden"])')).find(input => {
      const group = input.closest('.form-group, .form-row, .field, .row');
      return group && normalize(group.textContent).includes(target);
    }) || null;
  }

  function getPriceInputs(form) {
    return Object.fromEntries(priceLabels.map(label => [label, findInput(form, label)]));
  }

  // “吉利数”采用向下取到个位 9：265 → 259，229 → 229，避免把价格向上抬高。
  function luckyDown(value) {
    const number = Math.max(0, Math.floor(Number(value) || 0));
    if (number < 10) return number;
    const candidate = Math.floor(number / 10) * 10 + 9;
    return candidate <= number ? candidate : candidate - 10;
  }

  function calculate(mode, players, diamondSale) {
    if (mode === 'free') return Object.fromEntries(priceLabels.map(label => [label, 0]));
    if (mode === 'gold') {
      return {
        '售价（钻石）': 0, '售价（金币）': 1000,
        '原价(钻石)': 0, '原价(金币)': 1500,
        '纷享售价(钻石)': 0, '纷享售价(金币)': 1000 * players - 500,
        '纷享原价(钻石)': 0, '纷享原价(金币)': 1500 * players,
      };
    }
    const sale = Math.max(0, Math.floor(Number(diamondSale) || 0));
    const original = sale + 10;
    return {
      '售价（钻石）': sale, '售价（金币）': 0,
      '原价(钻石)': original, '原价(金币)': 0,
      '纷享售价(钻石)': luckyDown(sale * players - 20), '纷享售价(金币)': 0,
      '纷享原价(钻石)': luckyDown(original * players), '纷享原价(金币)': 0,
    };
  }

  function createPanel(form, inputs) {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="bb-price-toolbar">
        <span class="bb-price-title">快捷设置剧本价格</span>
        <button type="button" class="btn btn-xs btn-default" data-price-mode="free">免费本</button>
        <button type="button" class="btn btn-xs btn-info" data-price-mode="gold">金币本</button>
        <button type="button" class="btn btn-xs btn-primary" data-price-mode="diamond">钻石本</button>
      </div>
      <div class="bb-price-inputs" data-price-inputs>
        <label>剧本人数 <input type="number" min="1" step="1" value="6" data-price-players></label>
        <label data-price-diamond-label>钻石售价 <input type="number" min="0" step="1" value="59" data-price-diamond-sale></label>
        <button type="button" class="btn btn-xs btn-success" data-price-apply>应用价格</button>
        <span class="bb-price-status" data-price-status></span>
      </div>
      <div class="bb-price-preview" data-price-preview>请选择一种剧本价格类型。</div>
    `;
    const inputBox = panel.querySelector('[data-price-inputs]');
    const playersControl = panel.querySelector('[data-price-players]');
    const diamondSaleControl = panel.querySelector('[data-price-diamond-sale]');
    const preview = panel.querySelector('[data-price-preview]');
    const status = panel.querySelector('[data-price-status]');
    let mode = 'free';

    function currentValues() {
      const players = Math.max(1, parseInt(playersControl.value, 10) || 1);
      const diamondSale = Math.max(0, parseInt(diamondSaleControl.value, 10) || 0);
      return { players, diamondSale, values: calculate(mode, players, diamondSale) };
    }

    function renderPreview() {
      const { players, diamondSale, values } = currentValues();
      const rows = [
        ['售价', values['售价（钻石）'], values['售价（金币）']],
        ['原价', values['原价(钻石)'], values['原价(金币)']],
        ['纷享售价', values['纷享售价(钻石)'], values['纷享售价(金币)']],
        ['纷享原价', values['纷享原价(钻石)'], values['纷享原价(金币)']],
      ];
      preview.innerHTML = `<div>人数：${players}${mode === 'diamond' ? `，钻石售价：${diamondSale}（原价自动 +10，分享价格尾数向下取 9）` : ''}</div>
        <table><thead><tr><th>项目</th><th>钻石</th><th>金币</th></tr></thead><tbody>
        ${rows.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td></tr>`).join('')}
        </tbody></table>`;
    }

    function selectMode(nextMode) {
      mode = nextMode;
      panel.querySelectorAll('[data-price-mode]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.priceMode === mode);
      });
      inputBox.classList.add('is-open');
      playersControl.closest('label').style.display = mode === 'free' ? 'none' : '';
      panel.querySelector('[data-price-diamond-label]').style.display = mode === 'diamond' ? '' : 'none';
      status.textContent = '';
      renderPreview();
    }

    panel.querySelectorAll('[data-price-mode]').forEach(button => {
      button.addEventListener('click', () => selectMode(button.dataset.priceMode));
    });
    [playersControl, diamondSaleControl].forEach(control => control.addEventListener('input', renderPreview));
    panel.querySelector('[data-price-apply]').addEventListener('click', () => {
      const { values } = currentValues();
      priceLabels.forEach(label => {
        const input = inputs[label];
        if (!input) return;
        input.value = String(values[label]);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      status.textContent = '已写入表单，请确认后点击后台原有的“提交”。';
    });
    selectMode('free');
    return panel;
  }

  let updateTimer = null;

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 120);
  }

  function update() {
    if (!isProductEdit()) return;
    addStyles();
    const form = findForm();
    if (!form || !form.isConnected) {
      window.setTimeout(update, 300);
      return;
    }
    const inputs = getPriceInputs(form);
    if (priceLabels.some(label => !inputs[label])) {
      window.setTimeout(update, 300);
      return;
    }
    let panel = document.getElementById(PANEL_ID);
    if (panel && !form.contains(panel)) {
      panel.remove();
      panel = null;
    }
    if (!panel) form.prepend(createPanel(form, inputs));
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      schedule();
      return result;
    };
  });
  // 页面首次进入、后台 PJAX 切换和表单异步渲染都可能错过一次 DOM 事件，持续补偿检查。
  window.setInterval(update, 500);
  update();
})();

// 技能动作自定义快速创建：从后台真实动作下拉框读取类型，保存用户自定义快捷按钮。
(() => {
  'use strict';

  const PANEL_ID = 'bb-custom-action-panel';
  const STYLE_ID = 'bb-custom-action-style';
  const STORAGE_KEY = 'bb-custom-action-shortcuts-global-v2';
  const LEGACY_STORAGE_PREFIX = 'bb-custom-action-shortcuts-v1';
  const BUTTON_ATTRIBUTE = 'data-bb-custom-action';
  let updateTimer = null;

  function isActionList() {
    return /\/playbook\/actions\/?$/.test(location.pathname);
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function storageKey() {
    const url = new URL(location.href);
    const values = ['playbook_id', 'relate_id', 'relate_type']
      .map(key => `${key}=${url.searchParams.get(key) || ''}`)
      .join('&');
    return `${LEGACY_STORAGE_PREFIX}:${url.origin}${url.pathname}?${values}`;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} { margin: 10px 0; padding: 12px 14px; border: 1px solid #d8e3ed; border-radius: 4px; background: #f8fbfd; }
      #${PANEL_ID} .bb-custom-action-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      #${PANEL_ID} .bb-custom-action-title { font-weight: 600; color: #3c4b5a; margin-right: 4px; }
      #${PANEL_ID} .bb-custom-action-form { display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e3ebf2; }
      #${PANEL_ID} .bb-custom-action-form.is-open { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #${PANEL_ID} select, #${PANEL_ID} input { min-width: 180px; height: 30px; padding: 4px 8px; border: 1px solid #ccd6df; border-radius: 3px; background: #fff; }
      #${PANEL_ID} .bb-custom-action-shortcuts { display: flex; gap: 6px; flex-wrap: wrap; }
      #${PANEL_ID} .bb-custom-action-shortcut-wrap { display: inline-flex; align-items: stretch; }
      #${PANEL_ID} .bb-custom-action-shortcut { margin: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; }
      #${PANEL_ID} .bb-custom-action-delete { padding: 0 7px; border: 1px solid #d9534f; border-left: 0; border-radius: 0 3px 3px 0; color: #fff; background: #d9534f; }
      #${PANEL_ID} .bb-custom-action-empty { color: #8b98a5; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getCreateForm() {
    return Array.from(document.forms).find(form =>
      Array.from(form.querySelectorAll('select')).some(select => select.options.length > 10)
    ) || document.body;
  }

  function getActionTypeSelect() {
    const label = Array.from(document.querySelectorAll('label, .control-label, .field-label'))
      .find(item => normalizeText(item.textContent) === '选择动作');
    if (label) {
      const group = label.closest('.form-group, .form-row, .field, .row') || label.parentElement;
      const labeledSelect = group?.querySelector('select');
      if (labeledSelect && !labeledSelect.closest(`#${PANEL_ID}`)) return labeledSelect;
    }

    // 兼容后台主题没有输出 label 的情况：优先查找“选择动作”文本所在表单组。
    const group = Array.from(document.querySelectorAll('.form-group, .form-row, .field, .row'))
      .find(item => normalizeText(item.firstElementChild?.textContent) === '选择动作' && item.querySelector('select'));
    const groupedSelect = group?.querySelector('select');
    if (groupedSelect && !groupedSelect.closest(`#${PANEL_ID}`)) return groupedSelect;

    return null;
  }

  function readActionTypes() {
    const select = getActionTypeSelect();
    if (!select) return [];
    return Array.from(select.options)
      .map(option => ({ value: option.value, label: normalizeText(option.textContent) }))
      .filter(option => option.value && option.label && !/选择动作/.test(option.label));
  }

  async function loadShortcuts() {
    try {
      const stored = await chrome.storage.local.get(null);
      if (Array.isArray(stored[STORAGE_KEY])) return stored[STORAGE_KEY];
      // 合并旧版本按技能保存的快捷配置，避免更换技能或 URL 参数后丢失按钮。
      const legacy = Object.entries(stored)
        .filter(([key, value]) => key.startsWith(`${LEGACY_STORAGE_PREFIX}:`) && Array.isArray(value))
        .flatMap(([, value]) => value);
      const merged = [];
      const seen = new Set();
      legacy.forEach(item => {
        const identity = `${item.value}\u0000${item.name}`;
        if (!seen.has(identity)) {
          seen.add(identity);
          merged.push(item);
        }
      });
      if (merged.length) {
        await chrome.storage.local.set({ [STORAGE_KEY]: merged });
        return merged;
      }
      return [];
    } catch (error) {
      console.warn('[百变后台自定义动作] 读取快捷配置失败', error);
      return [];
    }
  }

  async function saveShortcuts(shortcuts) {
    await chrome.storage.local.set({ [STORAGE_KEY]: shortcuts });
  }

  function findActionOption(select, shortcut) {
    return Array.from(select.options).find(option => String(option.value) === String(shortcut.value))
      || Array.from(select.options).find(option => normalizeText(option.textContent) === shortcut.typeLabel);
  }

  function refreshActionForm(select, option) {
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // 后台使用 Select2 时，补发 jQuery change 事件，确保右侧动态子表单刷新。
    try {
      if (window.jQuery) window.jQuery(select).val(option.value).trigger('change');
    } catch (_) { /* 原生事件已足够时忽略 */ }
  }

  function createShortcutButton(shortcut, select, onDelete) {
    const wrapper = document.createElement('span');
    wrapper.className = 'bb-custom-action-shortcut-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-xs btn-primary bb-custom-action-shortcut';
    button.setAttribute(BUTTON_ATTRIBUTE, shortcut.id);
    button.title = `动作类型：${shortcut.typeLabel}`;
    button.textContent = shortcut.name;
    button.addEventListener('click', event => {
      event.preventDefault();
      const currentSelect = getActionTypeSelect() || select;
      const option = currentSelect && findActionOption(currentSelect, shortcut);
      if (!option) {
        window.alert(`当前页面找不到动作类型：${shortcut.typeLabel}`);
        return;
      }
      refreshActionForm(currentSelect, option);
      currentSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'bb-custom-action-delete';
    deleteButton.title = `删除快捷动作：${shortcut.name}`;
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onDelete(shortcut);
    });
    wrapper.append(button, deleteButton);
    return wrapper;
  }

  function renderShortcuts(panel, shortcuts, select) {
    const container = panel.querySelector('.bb-custom-action-shortcuts');
    container.replaceChildren();
    if (!shortcuts.length) {
      const empty = document.createElement('span');
      empty.className = 'bb-custom-action-empty';
      empty.textContent = '暂未添加快捷动作';
      container.appendChild(empty);
      return;
    }
    const onDelete = async shortcut => {
      const confirmed = window.confirm(`确定删除快捷动作“${shortcut.name}”吗？`);
      if (!confirmed) return;
      const latest = await loadShortcuts();
      const remaining = latest.filter(item => item.id !== shortcut.id);
      await saveShortcuts(remaining);
      renderShortcuts(panel, remaining, getActionTypeSelect() || select);
    };
    shortcuts.forEach(shortcut => container.appendChild(createShortcutButton(shortcut, select, onDelete)));
  }

  function renderActionOptions(panel, actionTypes) {
    const select = panel.querySelector('[data-bb-custom-action-type]');
    const signature = actionTypes.map(action => `${action.value}\u0000${action.label}`).join('\u0001');
    if (select.dataset.optionsSignature === signature) return;
    select.dataset.optionsSignature = signature;
    const current = select.value;
    select.replaceChildren();
    actionTypes.forEach(action => {
      const option = document.createElement('option');
      option.value = action.value;
      option.textContent = action.label;
      select.appendChild(option);
    });
    if (actionTypes.some(action => action.value === current)) select.value = current;
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="bb-custom-action-toolbar">
        <span class="bb-custom-action-title">自定义快速创建动作</span>
        <button type="button" class="btn btn-xs btn-info" data-bb-custom-action-toggle>添加快捷动作</button>
        <div class="bb-custom-action-shortcuts"></div>
      </div>
      <div class="bb-custom-action-form" data-bb-custom-action-form>
        <select data-bb-custom-action-type aria-label="动作类型"></select>
        <input type="text" data-bb-custom-action-name placeholder="输入自定义名称" maxlength="50" />
        <button type="button" class="btn btn-xs btn-success" data-bb-custom-action-save>保存按钮</button>
        <button type="button" class="btn btn-xs btn-default" data-bb-custom-action-cancel>取消</button>
      </div>
    `;
    return panel;
  }

  async function update() {
    if (!isActionList()) return;
    const actionSelect = getActionTypeSelect();
    addStyles();
    let panel = document.getElementById(PANEL_ID);

    // 动作页由后台异步渲染，首次进入时脚本可能早于列表和右侧表单执行。
    // 等真实动作下拉框和列表容器都出现后再插入，避免面板插到错误位置或永远没有动作选项。
    const table = document.querySelector('.box-body table') || document.querySelector('table');
    const tableBox = table?.closest('.box') || table?.parentElement;
    if (!actionSelect || !tableBox) {
      if (!panel) window.setTimeout(update, 500);
      return;
    }

    // 后台切换 tab/PJAX 时可能替换整个列表节点，发现面板已脱离当前列表就重新挂载。
    if (panel && !tableBox.contains(panel)) {
      panel.remove();
      panel = null;
    }

    if (!panel) {
      panel = createPanel();
      tableBox.prepend(panel);
      const actionTypes = readActionTypes();
      renderActionOptions(panel, actionTypes);
      const shortcuts = await loadShortcuts();
      renderShortcuts(panel, shortcuts, actionSelect);

      panel.querySelector('[data-bb-custom-action-toggle]').addEventListener('click', () => {
        panel.querySelector('[data-bb-custom-action-form]').classList.add('is-open');
        panel.querySelector('[data-bb-custom-action-name]').focus();
      });
      panel.querySelector('[data-bb-custom-action-cancel]').addEventListener('click', () => {
        panel.querySelector('[data-bb-custom-action-form]').classList.remove('is-open');
      });
      panel.querySelector('[data-bb-custom-action-save]').addEventListener('click', async () => {
        const typeControl = panel.querySelector('[data-bb-custom-action-type]');
        const nameControl = panel.querySelector('[data-bb-custom-action-name]');
        const name = normalizeText(nameControl.value);
        const option = typeControl.selectedOptions[0];
        if (!option || !name) {
          window.alert('请选择动作类型并输入自定义名称');
          return;
        }
        const currentShortcuts = await loadShortcuts();
        const duplicate = currentShortcuts.some(item => item.name === name);
        if (duplicate) {
          window.alert('自定义名称已存在，请换一个名称');
          return;
        }
        currentShortcuts.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          value: option.value,
          typeLabel: normalizeText(option.textContent),
        });
        await saveShortcuts(currentShortcuts);
        renderShortcuts(panel, currentShortcuts, getActionTypeSelect() || actionSelect);
        nameControl.value = '';
        panel.querySelector('[data-bb-custom-action-form]').classList.remove('is-open');
      });
    } else {
      const actionTypes = readActionTypes();
      if (actionTypes.length) renderActionOptions(panel, actionTypes);
    }
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  // 兼容后台首次进入和 tab/PJAX 局部切换时没有触发后续 DOM 变更的情况。
  window.setInterval(update, 800);
  update();
})();

// 技能条件自定义快速创建：从右侧“选择条件”读取真实条件类型并保存快捷按钮。
(() => {
  'use strict';

  const PANEL_ID = 'bb-custom-condition-panel';
  const STYLE_ID = 'bb-custom-condition-style';
  const STORAGE_KEY = 'bb-custom-condition-shortcuts-global-v1';
  const BUTTON_ATTRIBUTE = 'data-bb-custom-condition';
  let updateTimer = null;

  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isConditionList = () => /\/playbook\/conditions\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} { margin: 10px 0; padding: 12px 14px; border: 1px solid #d8e3ed; border-radius: 4px; background: #f8fbfd; }
      #${PANEL_ID} .bb-condition-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      #${PANEL_ID} .bb-condition-title { font-weight: 600; color: #3c4b5a; margin-right: 4px; }
      #${PANEL_ID} .bb-condition-form { display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e3ebf2; }
      #${PANEL_ID} .bb-condition-form.is-open { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #${PANEL_ID} select, #${PANEL_ID} input { min-width: 180px; height: 30px; padding: 4px 8px; border: 1px solid #ccd6df; border-radius: 3px; background: #fff; }
      #${PANEL_ID} .bb-condition-shortcuts { display: flex; gap: 6px; flex-wrap: wrap; }
      #${PANEL_ID} .bb-condition-shortcut-wrap { display: inline-flex; align-items: stretch; }
      #${PANEL_ID} .bb-condition-shortcut { margin: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; }
      #${PANEL_ID} .bb-condition-delete { padding: 0 7px; border: 1px solid #d9534f; border-left: 0; border-radius: 0 3px 3px 0; color: #fff; background: #d9534f; }
      #${PANEL_ID} .bb-condition-empty { color: #8b98a5; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getConditionSelect() {
    const label = Array.from(document.querySelectorAll('label, .control-label, .field-label'))
      .find(item => text(item.textContent) === '选择条件');
    if (label) {
      const group = label.closest('.form-group, .form-row, .field, .row') || label.parentElement;
      const select = group?.querySelector('select');
      if (select && !select.closest(`#${PANEL_ID}`)) return select;
    }
    const group = Array.from(document.querySelectorAll('.form-group, .form-row, .field, .row'))
      .find(item => text(item.firstElementChild?.textContent) === '选择条件' && item.querySelector('select'));
    return group?.querySelector('select') || null;
  }

  function readConditionTypes() {
    const select = getConditionSelect();
    if (!select) return [];
    return Array.from(select.options)
      .map(option => ({ value: option.value, label: text(option.textContent) }))
      .filter(option => option.value && option.label && !/选择条件/.test(option.label));
  }

  async function loadShortcuts() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    } catch (error) {
      console.warn('[百变后台自定义条件] 读取快捷配置失败', error);
      return [];
    }
  }

  async function saveShortcuts(shortcuts) {
    await chrome.storage.local.set({ [STORAGE_KEY]: shortcuts });
  }

  function refreshConditionForm(select, option) {
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (window.jQuery) window.jQuery(select).val(option.value).trigger('change');
    } catch (_) { /* 原生事件已触发 */ }
  }

  function renderOptions(panel, types) {
    const select = panel.querySelector('[data-bb-custom-condition-type]');
    const signature = types.map(item => `${item.value}\u0000${item.label}`).join('\u0001');
    if (select.dataset.optionsSignature === signature) return;
    select.dataset.optionsSignature = signature;
    select.replaceChildren();
    types.forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
  }

  function renderShortcuts(panel, shortcuts, conditionSelect) {
    const container = panel.querySelector('.bb-condition-shortcuts');
    container.replaceChildren();
    if (!shortcuts.length) {
      const empty = document.createElement('span');
      empty.className = 'bb-condition-empty';
      empty.textContent = '暂未添加快捷条件';
      container.appendChild(empty);
      return;
    }
    shortcuts.forEach(shortcut => {
      const wrapper = document.createElement('span');
      wrapper.className = 'bb-condition-shortcut-wrap';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-primary bb-condition-shortcut';
      button.textContent = shortcut.name;
      button.title = `条件类型：${shortcut.typeLabel}`;
      button.addEventListener('click', () => {
        const select = getConditionSelect() || conditionSelect;
        const option = select && Array.from(select.options).find(item =>
          String(item.value) === String(shortcut.value) || text(item.textContent) === shortcut.typeLabel
        );
        if (!option) return window.alert(`当前页面找不到条件类型：${shortcut.typeLabel}`);
        refreshConditionForm(select, option);
        select.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bb-condition-delete';
      remove.title = `删除快捷条件：${shortcut.name}`;
      remove.textContent = '×';
      remove.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!window.confirm(`确定删除快捷条件“${shortcut.name}”吗？`)) return;
        const latest = await loadShortcuts();
        const remaining = latest.filter(item => item.id !== shortcut.id);
        await saveShortcuts(remaining);
        renderShortcuts(panel, remaining, getConditionSelect() || conditionSelect);
      });
      wrapper.append(button, remove);
      container.appendChild(wrapper);
    });
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="bb-condition-toolbar">
        <span class="bb-condition-title">自定义快速创建条件</span>
        <button type="button" class="btn btn-xs btn-info" data-bb-custom-condition-toggle>添加快捷条件</button>
        <div class="bb-condition-shortcuts"></div>
      </div>
      <div class="bb-condition-form" data-bb-custom-condition-form>
        <select data-bb-custom-condition-type aria-label="条件类型"></select>
        <input type="text" data-bb-custom-condition-name placeholder="输入自定义名称" maxlength="50" />
        <button type="button" class="btn btn-xs btn-success" data-bb-custom-condition-save>保存按钮</button>
        <button type="button" class="btn btn-xs btn-default" data-bb-custom-condition-cancel>取消</button>
      </div>
    `;
    return panel;
  }

  async function update() {
    if (!isConditionList()) return;
    const conditionSelect = getConditionSelect();
    addStyles();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = createPanel();
      const table = document.querySelector('.box-body table') || document.querySelector('table');
      const tableBox = table?.closest('.box') || table?.parentElement;
      (tableBox || document.body).prepend(panel);
      renderOptions(panel, readConditionTypes());
      renderShortcuts(panel, await loadShortcuts(), conditionSelect);
      panel.querySelector('[data-bb-custom-condition-toggle]').addEventListener('click', () => {
        panel.querySelector('[data-bb-custom-condition-form]').classList.add('is-open');
        panel.querySelector('[data-bb-custom-condition-name]').focus();
      });
      panel.querySelector('[data-bb-custom-condition-cancel]').addEventListener('click', () => {
        panel.querySelector('[data-bb-custom-condition-form]').classList.remove('is-open');
      });
      panel.querySelector('[data-bb-custom-condition-save]').addEventListener('click', async () => {
        const typeControl = panel.querySelector('[data-bb-custom-condition-type]');
        const nameControl = panel.querySelector('[data-bb-custom-condition-name]');
        const name = text(nameControl.value);
        const option = typeControl.selectedOptions[0];
        if (!option || !name) return window.alert('请选择条件类型并输入自定义名称');
        const shortcuts = await loadShortcuts();
        if (shortcuts.some(item => item.name === name)) return window.alert('自定义名称已存在，请换一个名称');
        shortcuts.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, value: option.value, typeLabel: text(option.textContent) });
        await saveShortcuts(shortcuts);
        renderShortcuts(panel, shortcuts, getConditionSelect() || conditionSelect);
        nameControl.value = '';
        panel.querySelector('[data-bb-custom-condition-form]').classList.remove('is-open');
      });
    } else {
      renderOptions(panel, readConditionTypes());
    }
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 回合事件自定义快速创建：从右侧“事件类型”读取真实事件类型并保存快捷按钮。
(() => {
  'use strict';

  const PANEL_ID = 'bb-custom-scene-event-panel';
  const STYLE_ID = 'bb-custom-scene-event-style';
  const STORAGE_KEY = 'bb-custom-scene-event-shortcuts-global-v1';
  let updateTimer = null;
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isEventList = () => /\/playbook\/sceneevents\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} { margin: 10px 0; padding: 12px 14px; border: 1px solid #d8e3ed; border-radius: 4px; background: #f8fbfd; }
      #${PANEL_ID} .bb-event-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      #${PANEL_ID} .bb-event-title { font-weight: 600; color: #3c4b5a; margin-right: 4px; }
      #${PANEL_ID} .bb-event-form { display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e3ebf2; }
      #${PANEL_ID} .bb-event-form.is-open { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #${PANEL_ID} select, #${PANEL_ID} input { min-width: 180px; height: 30px; padding: 4px 8px; border: 1px solid #ccd6df; border-radius: 3px; background: #fff; }
      #${PANEL_ID} .bb-event-shortcuts { display: flex; gap: 6px; flex-wrap: wrap; }
      #${PANEL_ID} .bb-event-shortcut-wrap { display: inline-flex; align-items: stretch; }
      #${PANEL_ID} .bb-event-shortcut { margin: 0; border-top-right-radius: 0; border-bottom-right-radius: 0; }
      #${PANEL_ID} .bb-event-delete { padding: 0 7px; border: 1px solid #d9534f; border-left: 0; border-radius: 0 3px 3px 0; color: #fff; background: #d9534f; }
      #${PANEL_ID} .bb-event-empty { color: #8b98a5; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getEventTypeSelect() {
    const label = Array.from(document.querySelectorAll('label, .control-label, .field-label'))
      .find(item => text(item.textContent) === '事件类型');
    if (label) {
      const group = label.closest('.form-group, .form-row, .field, .row') || label.parentElement;
      const select = group?.querySelector('select');
      if (select && !select.closest(`#${PANEL_ID}`)) return select;
    }
    const group = Array.from(document.querySelectorAll('.form-group, .form-row, .field, .row'))
      .find(item => text(item.firstElementChild?.textContent) === '事件类型' && item.querySelector('select'));
    return group?.querySelector('select') || null;
  }

  function readEventTypes() {
    const select = getEventTypeSelect();
    if (!select) return [];
    return Array.from(select.options)
      .map(option => ({ value: option.value, label: text(option.textContent) }))
      .filter(option => option.value && option.label && !/事件类型/.test(option.label));
  }

  async function loadShortcuts() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
    } catch (error) {
      console.warn('[百变后台自定义事件] 读取快捷配置失败', error);
      return [];
    }
  }

  async function saveShortcuts(shortcuts) {
    await chrome.storage.local.set({ [STORAGE_KEY]: shortcuts });
  }

  function refreshEventForm(select, option) {
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (window.jQuery) window.jQuery(select).val(option.value).trigger('change');
    } catch (_) { /* 原生事件已触发 */ }
  }

  function renderOptions(panel, types) {
    const select = panel.querySelector('[data-bb-custom-event-type]');
    const signature = types.map(item => `${item.value}\u0000${item.label}`).join('\u0001');
    if (select.dataset.optionsSignature === signature) return;
    select.dataset.optionsSignature = signature;
    select.replaceChildren();
    types.forEach(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
  }

  function renderShortcuts(panel, shortcuts, eventSelect) {
    const container = panel.querySelector('.bb-event-shortcuts');
    container.replaceChildren();
    if (!shortcuts.length) {
      const empty = document.createElement('span');
      empty.className = 'bb-event-empty';
      empty.textContent = '暂未添加快捷事件';
      container.appendChild(empty);
      return;
    }
    shortcuts.forEach(shortcut => {
      const wrapper = document.createElement('span');
      wrapper.className = 'bb-event-shortcut-wrap';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-xs btn-primary bb-event-shortcut';
      button.textContent = shortcut.name;
      button.title = `事件类型：${shortcut.typeLabel}`;
      button.addEventListener('click', () => {
        const select = getEventTypeSelect() || eventSelect;
        const option = select && Array.from(select.options).find(item =>
          String(item.value) === String(shortcut.value) || text(item.textContent) === shortcut.typeLabel
        );
        if (!option) return window.alert(`当前页面找不到事件类型：${shortcut.typeLabel}`);
        refreshEventForm(select, option);
        select.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bb-event-delete';
      remove.title = `删除快捷事件：${shortcut.name}`;
      remove.textContent = '×';
      remove.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!window.confirm(`确定删除快捷事件“${shortcut.name}”吗？`)) return;
        const latest = await loadShortcuts();
        const remaining = latest.filter(item => item.id !== shortcut.id);
        await saveShortcuts(remaining);
        renderShortcuts(panel, remaining, getEventTypeSelect() || eventSelect);
      });
      wrapper.append(button, remove);
      container.appendChild(wrapper);
    });
  }

  function createPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="bb-event-toolbar">
        <span class="bb-event-title">自定义快速创建事件</span>
        <button type="button" class="btn btn-xs btn-info" data-bb-custom-event-toggle>添加快捷事件</button>
        <div class="bb-event-shortcuts"></div>
      </div>
      <div class="bb-event-form" data-bb-custom-event-form>
        <select data-bb-custom-event-type aria-label="事件类型"></select>
        <input type="text" data-bb-custom-event-name placeholder="输入自定义名称" maxlength="50" />
        <button type="button" class="btn btn-xs btn-success" data-bb-custom-event-save>保存按钮</button>
        <button type="button" class="btn btn-xs btn-default" data-bb-custom-event-cancel>取消</button>
      </div>
    `;
    return panel;
  }

  async function update() {
    if (!isEventList()) return;
    const eventSelect = getEventTypeSelect();
    addStyles();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = createPanel();
      const table = document.querySelector('.box-body table') || document.querySelector('table');
      const tableBox = table?.closest('.box') || table?.parentElement;
      (tableBox || document.body).prepend(panel);
      renderOptions(panel, readEventTypes());
      renderShortcuts(panel, await loadShortcuts(), eventSelect);
      panel.querySelector('[data-bb-custom-event-toggle]').addEventListener('click', () => {
        panel.querySelector('[data-bb-custom-event-form]').classList.add('is-open');
        panel.querySelector('[data-bb-custom-event-name]').focus();
      });
      panel.querySelector('[data-bb-custom-event-cancel]').addEventListener('click', () => {
        panel.querySelector('[data-bb-custom-event-form]').classList.remove('is-open');
      });
      panel.querySelector('[data-bb-custom-event-save]').addEventListener('click', async () => {
        const typeControl = panel.querySelector('[data-bb-custom-event-type]');
        const nameControl = panel.querySelector('[data-bb-custom-event-name]');
        const name = text(nameControl.value);
        const option = typeControl.selectedOptions[0];
        if (!option || !name) return window.alert('请选择事件类型并输入自定义名称');
        const shortcuts = await loadShortcuts();
        if (shortcuts.some(item => item.name === name)) return window.alert('自定义名称已存在，请换一个名称');
        shortcuts.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, value: option.value, typeLabel: text(option.textContent) });
        await saveShortcuts(shortcuts);
        renderShortcuts(panel, shortcuts, getEventTypeSelect() || eventSelect);
        nameControl.value = '';
        panel.querySelector('[data-bb-custom-event-form]').classList.remove('is-open');
      });
    } else {
      renderOptions(panel, readEventTypes());
    }
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 调查点批量创建：每行一个调查点名称，可统一关联一个可选技能包 ID。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-batch-clue-package';
  const MODAL_ID = 'bb-batch-clue-package-modal';
  let updateTimer = null;
  let currentRows = [];

  function isList() {
    return /\/playbook\/cluepackages\/?$/.test(location.pathname);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/cluepackages/create"]'))
      .find(link => /添加调查点/.test(link.textContent)) || null;
  }

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function addStyles() {
    const styleId = 'bb-batch-clue-package-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 10000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); }
      #${MODAL_ID} .bb-clue-dialog { width: min(860px, calc(100vw - 40px)); max-height: calc(100vh - 60px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 12px; }
      #${MODAL_ID} .bb-clue-hint { color: #687786; margin-bottom: 10px; }
      #${MODAL_ID} textarea { width: 100%; min-height: 150px; box-sizing: border-box; resize: vertical; padding: 8px; border: 1px solid #ccd6df; border-radius: 4px; font-family: monospace; }
      #${MODAL_ID} .bb-clue-skill-row { display: grid; grid-template-columns: 150px minmax(220px, 1fr); gap: 10px; align-items: center; margin-top: 12px; }
      #${MODAL_ID} .bb-clue-skill-row label { margin: 0; font-weight: 600; }
      #${MODAL_ID} .bb-clue-skill-row input { width: 100%; min-height: 34px; box-sizing: border-box; padding: 6px 8px; border: 1px solid #ccd6df; border-radius: 4px; }
      #${MODAL_ID} table { width: 100%; margin-top: 12px; border-collapse: collapse; }
      #${MODAL_ID} th, #${MODAL_ID} td { padding: 7px 9px; border: 1px solid #e1e6eb; text-align: left; }
      #${MODAL_ID} th { background: #f5f8fa; }
      #${MODAL_ID} .bb-clue-status { min-height: 24px; margin-top: 10px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-clue-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      #${MODAL_ID} .bb-clue-error { color: #c0392b; }
    `;
    document.head.appendChild(style);
  }

  function parseRows(raw) {
    return String(raw || '').split(/\r?\n/).map((line, index) => {
      const name = line.trim();
      return name ? { line: index + 1, name } : null;
    }).filter(Boolean);
  }

  function renderPreview(panel, rows) {
    const body = panel.querySelector('tbody');
    body.replaceChildren();
    rows.forEach(row => {
      const tr = document.createElement('tr');
      [row.line, row.name || '-', '待创建'].forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
  }

  function findFieldGroup(doc, labelText) {
    const label = Array.from(doc.querySelectorAll('label, .control-label, .field-label'))
      .find(item => normalize(item.textContent) === labelText);
    if (label) return label.closest('.form-group, .form-row, .field, .row') || label.parentElement;
    return Array.from(doc.querySelectorAll('.form-group, .form-row, .field, .row'))
      .find(item => normalize(item.firstElementChild?.textContent) === labelText) || null;
  }

  function setNameField(form, value) {
    const input = form.querySelector('[name="name"]')
      || findFieldGroup(form.ownerDocument, '调查点名')?.querySelector('input, textarea');
    if (!input) throw new Error('未找到调查点名字段');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSkillPackageField(form, skillId) {
    const group = findFieldGroup(form.ownerDocument, '技能包');
    const select = group?.querySelector('select') || form.querySelector('select[name*="skill"]');
    if (!select) throw new Error('未找到技能包字段');
    let option = Array.from(select.options).find(item => String(item.value) === String(skillId));
    if (!option) {
      option = new Option(`[${skillId}]`, skillId, true, true);
      select.add(option);
    }
    if (select.multiple) {
      Array.from(select.options).forEach(item => { item.selected = item === option; });
    } else {
      select.value = skillId;
    }
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (window.jQuery) window.jQuery(select).val(select.multiple ? [skillId] : skillId).trigger('change');
    } catch (_) { /* 原生事件已触发 */ }
  }

  function resolveFormAction(form, baseUrl) {
    return new URL(form.getAttribute('action') || baseUrl, baseUrl).href;
  }

  async function createOne(createUrl, row, skillId) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(createUrl, { credentials: 'same-origin', signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('读取新建表单超时');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`读取新建表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.forms).find(item => item.method.toLowerCase() === 'post' && (item.querySelector('[name="name"]') || findFieldGroup(doc, '调查点名')));
    if (!form) throw new Error('未找到调查点新建表单');
    setNameField(form, row.name);
    if (skillId) setSkillPackageField(form, skillId);
    const data = new FormData(form);
    const createResponse = await fetch(resolveFormAction(form, createUrl), { method: 'POST', body: data, credentials: 'same-origin' });
    if (!createResponse.ok) throw new Error(`创建失败：HTTP ${createResponse.status}`);
    const contentType = createResponse.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await createResponse.json();
      if (payload.status === false) throw new Error(payload.message || '后台返回创建失败');
    }
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function openModal(createLink) {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-clue-dialog">
        <h3>批量创建调查点</h3>
        <div class="bb-clue-hint">每行输入一个调查点名称。允许名称重复，将严格按照输入行数逐条创建。</div>
        <textarea data-bb-clue-input placeholder="例如：\n厕所\n书房\n厕所"></textarea>
        <div class="bb-clue-skill-row">
          <label for="bb-clue-global-skill-id">统一技能包 ID（可选）</label>
          <input id="bb-clue-global-skill-id" type="text" inputmode="numeric" data-bb-clue-skill-id placeholder="不填写则不关联技能包">
        </div>
        <table><thead><tr><th>行号</th><th>调查点名称</th><th>状态</th></tr></thead><tbody></tbody></table>
        <div class="bb-clue-status" data-bb-clue-status></div>
        <div class="bb-clue-actions">
          <button type="button" class="btn btn-default" data-bb-clue-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-clue-confirm>确认创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('[data-bb-clue-input]');
    const skillInput = modal.querySelector('[data-bb-clue-skill-id]');
    const status = modal.querySelector('[data-bb-clue-status]');
    const refresh = () => {
      currentRows = parseRows(input.value);
      renderPreview(modal, currentRows);
      const skillId = skillInput.value.trim();
      status.className = 'bb-clue-status';
      status.textContent = currentRows.length
        ? `共 ${currentRows.length} 个调查点${skillId ? `，统一关联技能包 ${skillId}` : '，不关联技能包'}`
        : '';
    };
    input.addEventListener('input', refresh);
    skillInput.addEventListener('input', refresh);
    modal.querySelector('[data-bb-clue-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-bb-clue-confirm]').addEventListener('click', async event => {
      refresh();
      const validRows = currentRows;
      const skillId = skillInput.value.trim();
      if (!validRows.length) {
        status.textContent = '请至少输入一个调查点名称';
        status.className = 'bb-clue-status bb-clue-error';
        return;
      }
      if (skillId && !/^\d+$/.test(skillId)) {
        status.textContent = '技能包 ID 必须是数字，或者留空';
        status.className = 'bb-clue-status bb-clue-error';
        return;
      }
      const confirmButton = event.currentTarget;
      confirmButton.disabled = true;
      modal.querySelector('[data-bb-clue-cancel]').disabled = true;
      const failures = [];
      for (let index = 0; index < validRows.length; index += 1) {
        const row = validRows[index];
        status.textContent = `正在创建 ${index + 1}/${validRows.length}：${row.name}`;
        try {
          await createOne(createLink.href, row, skillId);
        } catch (error) {
          failures.push(`第 ${row.line} 行 ${row.name}：${error.message || '创建失败'}`);
        }
      }
      if (failures.length) {
        status.className = 'bb-clue-status bb-clue-error';
        status.textContent = `完成，但有 ${failures.length} 行失败：\n${failures.join('\n')}`;
        confirmButton.disabled = false;
        modal.querySelector('[data-bb-clue-cancel]').disabled = false;
      } else {
        status.className = 'bb-clue-status';
        status.textContent = `成功创建 ${validRows.length} 个调查点，即将刷新列表。`;
        window.setTimeout(() => window.location.reload(), 700);
      }
    });
    refresh();
  }

  function update() {
    if (!isList()) return;
    const createLink = getCreateLink();
    if (!createLink || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '批量创建调查点';
    button.addEventListener('click', event => { event.preventDefault(); openModal(createLink); });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 技能列表批量创建调查点：勾选技能后，按技能名称创建调查点并自动绑定对应技能包。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-skill-batch-clue-package';
  const CHECKBOX_ATTRIBUTE = 'data-bb-skill-select';
  const HEADER_ATTRIBUTE = 'data-bb-skill-select-all';
  const MODAL_ID = 'bb-skill-batch-clue-package-modal';
  let updateTimer = null;
  const selectedIds = new Set();

  function isList() {
    return /\/playbook\/skills\/?$/.test(location.pathname);
  }

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function getCreateCluePackageUrl() {
    const url = new URL(window.location.href);
    url.pathname = url.pathname.replace(/\/skills\/?$/, '/cluepackages/create');
    return url.href;
  }

  function getSkillRows() {
    const table = document.querySelector('table');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr')).map(row => {
      const cells = Array.from(row.children).filter(item => item.tagName === 'TD');
      const id = normalize(cells[0]?.textContent).match(/\d+/)?.[0] || '';
      const name = normalize(cells[1]?.textContent);
      return { row, id, name };
    }).filter(item => item.id && item.name);
  }

  function addStyles() {
    const styleId = 'bb-skill-batch-clue-package-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 10000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); }
      #${MODAL_ID} .bb-skill-clue-dialog { width: min(760px, calc(100vw - 40px)); max-height: calc(100vh - 60px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 12px; }
      #${MODAL_ID} .bb-skill-clue-hint { color: #687786; margin-bottom: 12px; }
      #${MODAL_ID} table { width: 100%; border-collapse: collapse; }
      #${MODAL_ID} th, #${MODAL_ID} td { padding: 8px 10px; border: 1px solid #e1e6eb; text-align: left; }
      #${MODAL_ID} th { background: #f5f8fa; }
      #${MODAL_ID} .bb-skill-clue-status { min-height: 24px; margin-top: 12px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-skill-clue-status.error { color: #c0392b; }
      #${MODAL_ID} .bb-skill-clue-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    document.head.appendChild(style);
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function findFieldGroup(doc, labelText) {
    const labels = Array.from(doc.querySelectorAll('label, .control-label, .field-label'));
    const label = labels.find(item => normalize(item.textContent) === labelText);
    if (label) return label.closest('.form-group, .form-row, .field, .row') || label.parentElement;
    return Array.from(doc.querySelectorAll('.form-group, .form-row, .field, .row'))
      .find(item => normalize(item.firstElementChild?.textContent) === labelText) || null;
  }

  function setNameField(form, value) {
    const input = form.querySelector('[name="name"]')
      || findFieldGroup(form.ownerDocument, '调查点名')?.querySelector('input, textarea');
    if (!input) throw new Error('未找到调查点名字段');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSkillPackageField(form, skillId) {
    const group = findFieldGroup(form.ownerDocument, '技能包');
    const select = group?.querySelector('select') || form.querySelector('select[name*="skill"]');
    if (!select) throw new Error('未找到技能包字段');
    let option = Array.from(select.options).find(item => String(item.value) === String(skillId));
    if (!option) {
      option = new Option(`[${skillId}]`, skillId, true, true);
      select.add(option);
    }
    if (select.multiple) {
      Array.from(select.options).forEach(item => { item.selected = item === option; });
    } else {
      select.value = skillId;
    }
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (window.jQuery) window.jQuery(select).val(select.multiple ? [skillId] : skillId).trigger('change');
    } catch (_) { /* 原生事件已触发 */ }
  }

  function resolveFormAction(form, baseUrl) {
    return new URL(form.getAttribute('action') || baseUrl, baseUrl).href;
  }

  async function createOne(createUrl, skill) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(createUrl, { credentials: 'same-origin', signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('读取新建表单超时');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`读取新建表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.forms).find(item => item.method.toLowerCase() === 'post'
      && (item.querySelector('[name="name"]') || findFieldGroup(doc, '调查点名')));
    if (!form) throw new Error('未找到调查点新建表单');
    setNameField(form, skill.name);
    setSkillPackageField(form, skill.id);
    const data = new FormData(form);
    const playbookId = new URL(createUrl).searchParams.get('playbook_id') || '';
    if (playbookId) data.set('playbook_id', playbookId);
    data.delete('skill_list[]');
    data.append('skill_list[]', String(skill.id));
    const createResponse = await fetch(resolveFormAction(form, createUrl), {
      method: 'POST', body: data, credentials: 'same-origin'
    });
    if (!createResponse.ok) throw new Error(`创建失败：HTTP ${createResponse.status}`);
    const contentType = createResponse.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await createResponse.json();
      if (payload.status === false) throw new Error(payload.message || '后台返回创建失败');
      return;
    }
    const responseText = await createResponse.text();
    const resultDoc = new DOMParser().parseFromString(responseText, 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .callout-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    if (errorText) throw new Error(errorText);
    if (/\/playbook\/cluepackages\/create\/?$/.test(new URL(createResponse.url).pathname)) {
      throw new Error('后台未接受创建请求');
    }
  }

  function openModal(skills) {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-skill-clue-dialog">
        <h3>批量创建调查点</h3>
        <div class="bb-skill-clue-hint">将按技能名称创建调查点，并自动将对应技能设置为技能包；其他字段沿用后台默认值。</div>
        <table><thead><tr><th>技能 ID</th><th>技能名称</th><th>状态</th></tr></thead><tbody></tbody></table>
        <div class="bb-skill-clue-status" data-bb-skill-clue-status>将创建 ${skills.length} 个调查点。</div>
        <div class="bb-skill-clue-actions">
          <button type="button" class="btn btn-default" data-bb-skill-clue-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-skill-clue-confirm>确认创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const body = modal.querySelector('tbody');
    skills.forEach(skill => {
      const tr = document.createElement('tr');
      [skill.id, skill.name, '待创建'].forEach(value => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      tr.dataset.skillId = skill.id;
      body.appendChild(tr);
    });
    const status = modal.querySelector('[data-bb-skill-clue-status]');
    modal.querySelector('[data-bb-skill-clue-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-bb-skill-clue-confirm]').addEventListener('click', async event => {
      const confirmButton = event.currentTarget;
      confirmButton.disabled = true;
      modal.querySelector('[data-bb-skill-clue-cancel]').disabled = true;
      const failures = [];
      for (let index = 0; index < skills.length; index += 1) {
        const skill = skills[index];
        const row = body.querySelector(`[data-skill-id="${CSS.escape(skill.id)}"]`);
        status.className = 'bb-skill-clue-status';
        status.textContent = `正在创建 ${index + 1}/${skills.length}：${skill.name}`;
        try {
          await createOne(getCreateCluePackageUrl(), skill);
          row.lastElementChild.textContent = '创建成功';
        } catch (error) {
          const message = error.message || '创建失败';
          row.lastElementChild.textContent = message;
          failures.push(`${skill.name}：${message}`);
        }
      }
      if (failures.length) {
        status.className = 'bb-skill-clue-status error';
        status.textContent = `完成，但有 ${failures.length} 个调查点创建失败：\n${failures.join('\n')}`;
        confirmButton.disabled = false;
        modal.querySelector('[data-bb-skill-clue-cancel]').disabled = false;
      } else {
        status.className = 'bb-skill-clue-status';
        status.textContent = `成功创建 ${skills.length} 个调查点，即将刷新列表。`;
        window.setTimeout(() => window.location.reload(), 700);
      }
    });
  }

  function ensureHeaderCheckbox(table) {
    const header = table.querySelector('thead th');
    if (!header) return null;
    let checkbox = header.querySelector(`[${HEADER_ATTRIBUTE}]`);
    if (!checkbox) {
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.title = '全选当前页技能';
      checkbox.setAttribute(HEADER_ATTRIBUTE, 'true');
      checkbox.style.marginRight = '6px';
      header.prepend(checkbox);
      checkbox.addEventListener('change', () => {
        getSkillRows().forEach(item => checkbox.checked ? selectedIds.add(item.id) : selectedIds.delete(item.id));
        update();
      });
    }
    const rows = getSkillRows();
    const selectedCount = rows.filter(item => selectedIds.has(item.id)).length;
    checkbox.checked = rows.length > 0 && selectedCount === rows.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < rows.length;
    return checkbox;
  }

  function ensureRowCheckboxes() {
    const table = document.querySelector('table');
    if (!table) return;
    ensureHeaderCheckbox(table);
    getSkillRows().forEach(item => {
      const cell = item.row.children[0];
      if (!cell) return;
      let checkbox = cell.querySelector(`[${CHECKBOX_ATTRIBUTE}]`);
      if (!checkbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.setAttribute(CHECKBOX_ATTRIBUTE, 'true');
        checkbox.style.marginRight = '8px';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedIds.add(item.id);
          else selectedIds.delete(item.id);
          update();
        });
        cell.prepend(checkbox);
      }
      checkbox.checked = selectedIds.has(item.id);
    });
  }

  function ensureButton() {
    const createSkillLink = Array.from(document.querySelectorAll('a[href*="/playbook/skills/create"]'))
      .find(link => /添加技能/.test(link.textContent));
    if (!createSkillLink || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '批量创建调查点';
    button.addEventListener('click', event => {
      event.preventDefault();
      const skills = getSkillRows().filter(item => selectedIds.has(item.id));
      if (!skills.length) return window.alert('请先勾选要创建调查点的技能');
      openModal(skills);
    });
    createSkillLink.insertAdjacentElement('afterend', button);
  }

  function update() {
    if (!isList()) return;
    ensureRowCheckboxes();
    ensureButton();
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 调查点批量创建地点：先勾选调查点，为每个调查点选择地图后复用快速创建地点表单提交。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-clue-package-place-batch-button';
  const DEFAULT_HOT_POSITION = '1088\n1419\n160\n100';
  const SELECT_ATTRIBUTE = 'data-bb-clue-package-place-select';
  const SELECT_BOUND_ATTRIBUTE = 'data-bb-clue-package-place-select-bound';
  const SELECT_ALL_ATTRIBUTE = 'data-bb-clue-package-place-select-all';
  const SELECT_CELL_ATTRIBUTE = 'data-bb-clue-package-place-select-cell';
  const MODAL_ID = 'bb-clue-package-place-batch-modal';
  const STYLE_ID = 'bb-clue-package-place-batch-style';
  const COUNTER_ID = 'bb-clue-package-place-selected-count';
  const selectedIds = new Set();
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isList = () => /\/playbook\/cluepackages\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${SELECT_CELL_ATTRIBUTE}], td[${SELECT_CELL_ATTRIBUTE}] { width: 48px !important; min-width: 48px !important; padding-left: 8px !important; padding-right: 8px !important; text-align: center !important; vertical-align: middle !important; }
      a[${BUTTON_ATTRIBUTE}] { margin-left: 8px; }
      #${COUNTER_ID} { display: inline-block; margin-left: 10px; color: #777; vertical-align: middle; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-clue-package-place-panel { width: min(760px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-clue-package-place-note { color: #687786; line-height: 1.7; }
      #${MODAL_ID} .bb-clue-package-place-global { display: grid; grid-template-columns: auto minmax(220px, 1fr); gap: 10px; align-items: center; margin-top: 12px; padding: 10px; border: 1px solid #e1e7ec; border-radius: 4px; color: #3c4b5a; }
      #${MODAL_ID} .bb-clue-package-place-global label { margin: 0; font-weight: 600; }
      #${MODAL_ID} .bb-clue-package-place-global select { margin: 0; }
      #${MODAL_ID} .bb-clue-package-place-status { min-height: 24px; margin-top: 10px; color: #337ab7; white-space: pre-wrap; }
      #${MODAL_ID} .bb-clue-package-place-error { color: #c0392b; }
      #${MODAL_ID} .bb-clue-package-place-list { margin-top: 12px; border: 1px solid #ddd; }
      #${MODAL_ID} .bb-clue-package-place-row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(220px, 1fr); gap: 12px; padding: 9px 10px; border-bottom: 1px solid #eee; align-items: center; }
      #${MODAL_ID} .bb-clue-package-place-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-clue-package-place-name { font-weight: 600; }
      #${MODAL_ID} .bb-clue-package-place-id { margin-right: 8px; color: #687786; }
      #${MODAL_ID} select { width: 100%; min-height: 34px; padding: 6px 8px; border: 1px solid #ccd6df; border-radius: 4px; background: #fff; }
      #${MODAL_ID} .bb-clue-package-place-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      @media (max-width: 620px) {
        #${MODAL_ID} .bb-clue-package-place-row { grid-template-columns: 1fr; gap: 6px; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTable() {
    return Array.from(document.querySelectorAll('table')).find(table =>
      table.querySelector('tbody tr[data-key]') && /调查点名/.test(normalize(table.querySelector('thead')?.textContent))
    ) || Array.from(document.querySelectorAll('table')).find(table => table.querySelector('tbody tr[data-key]')) || null;
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/cluepackages/create"]'))
      .find(link => /添加调查点/.test(normalize(link.textContent))) || null;
  }

  function getColumnIndex(table, patterns) {
    const headerRow = table.tHead?.rows[0] || table.querySelector('thead tr');
    if (!headerRow) return -1;
    return Array.from(headerRow.cells).findIndex(cell => patterns.some(pattern =>
      pattern.test(normalize(cell.textContent))
    ));
  }

  function getNameCell(row, table) {
    return row.querySelector('td.column-name') || row.cells[getColumnIndex(table, [/调查点名/, /^名称$/])];
  }

  function getQuickCreateLink(row) {
    return Array.from(row.querySelectorAll('a[href]')).find(link =>
      /快速创建地点/.test(normalize(link.textContent))
      && /\/playbook\/places\/create/.test(link.getAttribute('href') || '')
    ) || Array.from(row.querySelectorAll('a[href*="/playbook/places/create"]'))[0] || null;
  }

  function findHotPositionField(form) {
    const groups = Array.from(form.querySelectorAll('.form-group, .form-row, .field, .row'));
    const group = groups.find(item => normalize(item.firstElementChild?.textContent) === '热区位置'
      || normalize(item.textContent).startsWith('热区位置'));
    return group?.querySelector('textarea, input')
      || form.querySelector('textarea[name*="hot"], input[name*="hot"]')
      || null;
  }

  function updateCounter(table) {
    const boxes = Array.from(table.querySelectorAll(`tbody tr[data-key] input[${SELECT_ATTRIBUTE}]`));
    const checked = boxes.filter(input => input.checked);
    const counter = document.getElementById(COUNTER_ID);
    if (counter) counter.textContent = `已选 ${checked.length} 个调查点`;
    const selectAll = table.querySelector(`input[${SELECT_ALL_ATTRIBUTE}]`);
    if (selectAll) {
      selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < boxes.length;
    }
  }

  function ensureSelectionColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    const nameHeader = Array.from(headerRow.cells).find(cell =>
      /调查点名/.test(normalize(cell.textContent)) || /^名称$/.test(normalize(cell.textContent))
    ) || headerRow.firstElementChild;
    let header = headerRow.querySelector(`th[${SELECT_CELL_ATTRIBUTE}]`);
    let selectAll = header?.querySelector(`input[${SELECT_ALL_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
      selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute(SELECT_ALL_ATTRIBUTE, 'true');
      header.appendChild(selectAll);
      headerRow.insertBefore(header, nameHeader || headerRow.firstElementChild);
    }
    if (!selectAll) {
      selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute(SELECT_ALL_ATTRIBUTE, 'true');
      header.appendChild(selectAll);
    }
    if (selectAll.getAttribute(SELECT_BOUND_ATTRIBUTE) !== 'true') {
      selectAll.setAttribute(SELECT_BOUND_ATTRIBUTE, 'true');
      selectAll.title = '全选/取消全选';
      selectAll.addEventListener('change', () => {
        table.querySelectorAll(`tbody tr[data-key] input[${SELECT_ATTRIBUTE}]`).forEach(input => {
          input.checked = selectAll.checked;
          const row = input.closest('tr');
          if (selectAll.checked) selectedIds.add(row?.dataset.key || '');
          else selectedIds.delete(row?.dataset.key || '');
        });
        updateCounter(table);
      });
    }

    table.querySelectorAll('tbody tr[data-key]').forEach(row => {
      const nameCell = getNameCell(row, table);
      if (!nameCell) return;
      let cell = row.querySelector(`td[${SELECT_CELL_ATTRIBUTE}]`);
      let input = cell?.querySelector(`input[${SELECT_ATTRIBUTE}]`);
      if (!cell) {
        cell = document.createElement('td');
        cell.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
        input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute(SELECT_ATTRIBUTE, 'true');
        cell.appendChild(input);
        row.insertBefore(cell, nameCell);
      }
      if (!input) return;
      input.checked = selectedIds.has(row.dataset.key || '');
      if (input.getAttribute(SELECT_BOUND_ATTRIBUTE) === 'true') return;
      input.setAttribute(SELECT_ATTRIBUTE, 'true');
      input.setAttribute(SELECT_BOUND_ATTRIBUTE, 'true');
      input.title = '选择此调查点';
      input.addEventListener('change', () => {
        const id = row.dataset.key || '';
        if (input.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateCounter(table);
      });
    });
    updateCounter(table);
  }

  function getSelectedCluePackages(table) {
    return Array.from(table.querySelectorAll('tbody tr[data-key]')).map(row => {
      const input = row.querySelector(`input[${SELECT_ATTRIBUTE}]:checked`);
      const quickLink = getQuickCreateLink(row);
      return {
        id: row.dataset.key || '',
        name: normalize(getNameCell(row, table)?.textContent),
        quickCreateUrl: quickLink?.href || '',
        selected: Boolean(input),
      };
    }).filter(item => item.id && item.name && item.quickCreateUrl && item.selected);
  }

  function findPlaceForm(doc) {
    return Array.from(doc.forms).find(form => {
      try {
        return String(form.method).toLowerCase() === 'post'
          && /\/playbook\/places\/?$/.test(new URL(form.getAttribute('action') || '', location.origin).pathname)
          && form.querySelector('[name="name"]')
          && form.querySelector('select[name="map_id"]');
      } catch (_) {
        return false;
      }
    }) || null;
  }

  async function fetchMaps(url) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取地点创建页失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = findPlaceForm(doc);
    if (!form) throw new Error('没有识别到地点创建表单');
    const select = form.querySelector('select[name="map_id"]');
    const maps = Array.from(select.options).map(option => ({
      id: String(option.value || ''),
      name: normalize(option.textContent),
    })).filter(map => map.id && map.id !== '0' && map.name && map.name !== '无');
    if (!maps.length) throw new Error('地图列表为空');
    return maps;
  }

  async function createPlace(clue, mapId) {
    const response = await fetch(clue.quickCreateUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取地点创建页失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = findPlaceForm(doc);
    if (!form) throw new Error('没有识别到地点创建表单');
    const data = new FormData(form);
    data.set('name', clue.name);
    data.set('map_id', String(mapId));
    const hotPositionField = findHotPositionField(form);
    if (hotPositionField?.name && !String(hotPositionField.value || '').trim()) {
      data.set(hotPositionField.name, DEFAULT_HOT_POSITION);
    }
    data.set('_previous_', window.location.href);
    const action = new URL(form.getAttribute('action') || clue.quickCreateUrl, clue.quickCreateUrl).href;
    const createResponse = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
    const html = await createResponse.text();
    if (!createResponse.ok) throw new Error(`创建失败：HTTP ${createResponse.status}`);
    const resultDoc = new DOMParser().parseFromString(html, 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .callout-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    if (errorText) throw new Error(errorText);
    if (/\/playbook\/places\/create\/?$/.test(new URL(createResponse.url).pathname)) {
      throw new Error('后台未接受地点创建');
    }
  }

  function renderRows(container, clues, maps, onChange) {
    container.replaceChildren();
    clues.forEach(clue => {
      const row = document.createElement('div');
      row.className = 'bb-clue-package-place-row';
      const name = document.createElement('div');
      name.className = 'bb-clue-package-place-name';
      const id = document.createElement('span');
      id.className = 'bb-clue-package-place-id';
      id.textContent = `调查点 ${clue.id}`;
      const label = document.createElement('span');
      label.textContent = clue.name;
      name.append(id, label);
      const select = document.createElement('select');
      select.setAttribute('data-bb-clue-package-place-map', clue.id);
      const placeholder = new Option('请选择地图', '');
      select.add(placeholder);
      maps.forEach(map => select.add(new Option(map.name, map.id)));
      select.addEventListener('change', event => {
        event.currentTarget.dataset.override = 'true';
        onChange();
      });
      row.append(name, select);
      container.appendChild(row);
    });
  }

  function openModal(clues) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-clue-package-place-panel">
        <h3>批量创建地点</h3>
        <div class="bb-clue-package-place-note">已选择 ${clues.length} 个调查点。可先设置统一默认地图，下方单独选择的地图优先级更高；提交后会复用“快速创建地点”的配置，其他字段沿用后台默认值。</div>
        <div class="bb-clue-package-place-global">
          <label for="bb-clue-package-place-global-map">统一默认地图（可选）</label>
          <select id="bb-clue-package-place-global-map" data-bb-clue-package-place-global-map disabled>
            <option value="">正在读取地图列表…</option>
          </select>
        </div>
        <div class="bb-clue-package-place-list" data-bb-clue-package-place-list></div>
        <div class="bb-clue-package-place-status" data-bb-clue-package-place-status>正在读取地图列表…</div>
        <div class="bb-clue-package-place-actions">
          <button type="button" class="btn btn-default" data-bb-clue-package-place-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-clue-package-place-confirm disabled>确认创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const list = modal.querySelector('[data-bb-clue-package-place-list]');
    const globalMapSelect = modal.querySelector('[data-bb-clue-package-place-global-map]');
    const status = modal.querySelector('[data-bb-clue-package-place-status]');
    const cancel = modal.querySelector('[data-bb-clue-package-place-cancel]');
    const confirm = modal.querySelector('[data-bb-clue-package-place-confirm]');
    let maps = [];
    const close = () => modal.remove();
    const refreshConfirm = () => {
      const selections = Array.from(modal.querySelectorAll('[data-bb-clue-package-place-map]'));
      confirm.disabled = !maps.length || selections.length !== clues.length
        || selections.some(select => !select.value && !globalMapSelect.value);
    };
    globalMapSelect.addEventListener('change', () => {
      modal.querySelectorAll('[data-bb-clue-package-place-map]').forEach(select => {
        if (select.dataset.override !== 'true') select.value = globalMapSelect.value;
      });
      refreshConfirm();
    });
    fetchMaps(clues[0].quickCreateUrl).then(result => {
      maps = result;
      globalMapSelect.replaceChildren(
        new Option('不设置统一默认地图', ''),
        ...maps.map(map => new Option(map.name, map.id)),
      );
      globalMapSelect.disabled = false;
      renderRows(list, clues, maps, refreshConfirm);
      status.textContent = '可选择统一默认地图，也可以在下方逐项覆盖。';
      refreshConfirm();
    }).catch(error => {
      status.className = 'bb-clue-package-place-status bb-clue-package-place-error';
      status.textContent = error.message || String(error);
    });
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (Number(confirm.dataset.completed) > 0) window.location.reload();
        else close();
        return;
      }
      const selects = Array.from(modal.querySelectorAll('[data-bb-clue-package-place-map]'));
      const assignments = clues.map((clue, index) => {
        const mapId = selects[index]?.value || globalMapSelect.value || '';
        return { clue, mapId, mapName: maps.find(map => map.id === mapId)?.name || '' };
      });
      if (assignments.some(item => !item.mapId)) {
        status.className = 'bb-clue-package-place-status bb-clue-package-place-error';
        status.textContent = '请为每个调查点选择地图。';
        return;
      }
      confirm.disabled = true;
      cancel.disabled = true;
      let completed = 0;
      const failures = [];
      for (const { clue, mapId, mapName } of assignments) {
        status.className = 'bb-clue-package-place-status';
        status.textContent = `正在创建 ${completed + failures.length + 1}/${assignments.length}：${clue.name} → ${mapName}`;
        try {
          await createPlace(clue, mapId);
          completed += 1;
        } catch (error) {
          failures.push(`${clue.name}：${error.message || '创建失败'}`);
        }
      }
      status.className = failures.length ? 'bb-clue-package-place-status bb-clue-package-place-error' : 'bb-clue-package-place-status';
      status.textContent = `已成功创建 ${completed}/${assignments.length} 个地点。${failures.length ? `\n失败：\n${failures.join('\n')}` : ''}`;
      confirm.disabled = false;
      cancel.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
      confirm.textContent = completed ? '完成并刷新' : '关闭';
      cancel.style.display = 'none';
    });
  }

  function update() {
    if (!isList()) return;
    addStyles();
    const table = getTable();
    if (table) ensureSelectionColumn(table);
    let button = document.querySelector(`a[${BUTTON_ATTRIBUTE}]`);
    if (!button) {
      const createLink = getCreateLink();
      if (!createLink) return;
      const anchor = document.querySelector('a[data-bb-batch-clue-package]') || createLink;
      button = document.createElement('a');
      button.href = '#';
      button.className = 'btn btn-sm btn-info';
      button.setAttribute(BUTTON_ATTRIBUTE, 'true');
      button.textContent = '批量添加地点';
      button.addEventListener('click', event => {
        event.preventDefault();
        const currentTable = getTable();
        const clues = currentTable ? getSelectedCluePackages(currentTable) : [];
        if (!clues.length) {
          window.alert('请先在调查点列表中勾选至少一个调查点');
          return;
        }
        openModal(clues);
      });
      anchor.insertAdjacentElement('afterend', button);
    }
    let counter = document.getElementById(COUNTER_ID);
    if (!counter) {
      counter = document.createElement('span');
      counter.id = COUNTER_ID;
      button.insertAdjacentElement('afterend', counter);
    }
    if (table) updateCounter(table);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 160);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 调查点列表增强：反查“调查点 → 地点 → 地图”，在列表中显示每个调查点所属地图。
(() => {
  'use strict';

  const HEADER_ATTRIBUTE = 'data-bb-clue-package-map-header';
  const CELL_ATTRIBUTE = 'data-bb-clue-package-map-cell';
  const STYLE_ID = 'bb-clue-package-map-style';
  let mappingPromise = null;
  let resolvedMapping = null;
  let mappingFailed = false;
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isList = () => /\/playbook\/cluepackages\/?$/.test(location.pathname)
    && Boolean(new URL(location.href).searchParams.get('playbook_id'));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${HEADER_ATTRIBUTE}], td[${CELL_ATTRIBUTE}] { min-width: 130px !important; width: 150px !important; vertical-align: middle !important; }
      td[${CELL_ATTRIBUTE}] { color: #337ab7; font-weight: 600; line-height: 1.55; white-space: pre-line !important; }
      td[${CELL_ATTRIBUTE}].bb-clue-package-map-loading,
      td[${CELL_ATTRIBUTE}].bb-clue-package-map-empty { color: #999; font-weight: normal; }
      td[${CELL_ATTRIBUTE}].bb-clue-package-map-error { color: #c0392b; font-weight: normal; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTable(doc = document) {
    return Array.from(doc.querySelectorAll('table')).find(table =>
      table.querySelector('tbody tr[data-key]') && /调查点名/.test(normalize(table.querySelector('thead')?.textContent))
    ) || null;
  }

  function ensureColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return -1;
    let header = headerRow.querySelector(`th[${HEADER_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(HEADER_ATTRIBUTE, 'true');
      header.textContent = '所属地图';
      const actionHeader = Array.from(headerRow.cells).find(cell => normalize(cell.textContent) === '操作');
      headerRow.insertBefore(header, actionHeader || null);
    }
    return header.cellIndex;
  }

  function ensureCell(row, index) {
    let cell = row.querySelector(`td[${CELL_ATTRIBUTE}]`);
    if (!cell) {
      cell = document.createElement('td');
      cell.setAttribute(CELL_ATTRIBUTE, 'true');
      row.insertBefore(cell, row.cells[index] || null);
    }
    return cell;
  }

  function render(cell, state, names = []) {
    const values = Array.from(new Set(names.filter(Boolean)));
    const key = `${state}:${values.join('\u0001')}`;
    if (cell.dataset.bbCluePackageMapValue === key) return;
    cell.dataset.bbCluePackageMapValue = key;
    cell.classList.remove('bb-clue-package-map-loading', 'bb-clue-package-map-empty', 'bb-clue-package-map-error');
    if (state === 'loading') {
      cell.classList.add('bb-clue-package-map-loading');
      cell.textContent = '读取中…';
    } else if (state === 'error') {
      cell.classList.add('bb-clue-package-map-error');
      cell.textContent = '读取失败';
    } else if (!values.length) {
      cell.classList.add('bb-clue-package-map-empty');
      cell.textContent = '暂无地图';
    } else {
      cell.textContent = values.join('\n');
    }
  }

  function selectedOption(select) {
    return Array.from(select?.options || []).find(option => option.selected && String(option.value || '') !== '0' && option.value)
      || select?.querySelector('option[selected]');
  }

  function findClueIds(doc) {
    const ids = new Set();
    const candidates = Array.from(doc.querySelectorAll('select')).filter(select => {
      const name = String(select.name || '').toLowerCase();
      if (/clue.*package|package.*clue/.test(name)) return true;
      const group = select.closest('.form-group, .form-row, .field, .row');
      return /调查点/.test(normalize(group?.textContent).slice(0, 80));
    });
    candidates.forEach(select => {
      Array.from(select.selectedOptions || []).forEach(option => {
        if (/^\d+$/.test(String(option.value || '')) && option.value !== '0') ids.add(String(option.value));
      });
    });
    doc.querySelectorAll('input[name]').forEach(input => {
      const name = String(input.name || '').toLowerCase();
      if (/clue.*package|package.*clue/.test(name) && /^\d+$/.test(String(input.value || '')) && input.value !== '0') {
        ids.add(String(input.value));
      }
    });
    return Array.from(ids);
  }

  async function fetchDocument(url, label) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function readPlaceRows(doc, sourceUrl) {
    const table = Array.from(doc.querySelectorAll('table')).find(item => item.querySelector('a[href*="/playbook/places/"][href*="/edit"]'));
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('thead th')).map(cell => normalize(cell.textContent));
    const clueIndex = headers.findIndex(text => /调查点/.test(text));
    return Array.from(table.querySelectorAll('tbody tr[data-key]')).map(row => {
      const editLink = row.querySelector('a[href*="/playbook/places/"][href*="/edit"]');
      if (!editLink) return null;
      return {
        editUrl: new URL(editLink.getAttribute('href') || '', sourceUrl).href,
        clueNames: clueIndex >= 0
          ? normalize(row.cells[clueIndex]?.textContent).split(/[、,，\n]+/).map(normalize).filter(Boolean)
          : [],
      };
    }).filter(Boolean);
  }

  async function loadMapping() {
    const currentUrl = new URL(location.href);
    const listUrl = new URL(currentUrl.pathname.replace(/\/cluepackages\/?$/, '/places'), currentUrl.origin);
    listUrl.searchParams.set('playbook_id', currentUrl.searchParams.get('playbook_id') || '');
    listUrl.searchParams.set('per-page', '1000');
    const listDoc = await fetchDocument(listUrl.href, '读取地点列表');
    const places = readPlaceRows(listDoc, listUrl.href);
    const mapping = new Map();
    const clueNameToIds = new Map();
    getTable()?.querySelectorAll('tbody tr[data-key]').forEach(row => {
      const id = String(row.dataset.key || '');
      const name = normalize(row.querySelector('td.column-name')?.textContent || row.cells[2]?.textContent);
      if (!id || !name) return;
      if (!clueNameToIds.has(name)) clueNameToIds.set(name, []);
      clueNameToIds.get(name).push(id);
    });

    let cursor = 0;
    const workers = Array.from({ length: Math.min(5, places.length) }, async () => {
      while (cursor < places.length) {
        const place = places[cursor++];
        try {
          const doc = await fetchDocument(place.editUrl, '读取地点配置');
          const mapSelect = doc.querySelector('select[name="map_id"]');
          const mapName = normalize(selectedOption(mapSelect)?.textContent);
          if (!mapName || mapName === '无') continue;
          let clueIds = findClueIds(doc);
          if (!clueIds.length) {
            clueIds = place.clueNames.flatMap(name => clueNameToIds.get(name) || []);
          }
          clueIds.forEach(clueId => {
            if (!mapping.has(clueId)) mapping.set(clueId, new Set());
            mapping.get(clueId).add(mapName);
          });
        } catch (error) {
          console.warn('[百变后台调查点地图] 读取地点失败', place.editUrl, error);
        }
      }
    });
    await Promise.all(workers);
    return mapping;
  }

  function update() {
    if (!isList()) return;
    const table = getTable();
    if (!table) return;
    addStyles();
    const index = ensureColumn(table);
    if (index < 0) return;
    const rows = Array.from(table.querySelectorAll('tbody tr[data-key]'));
    if (resolvedMapping) {
      rows.forEach(row => render(ensureCell(row, index), 'loaded', Array.from(resolvedMapping.get(String(row.dataset.key || '')) || [])));
      return;
    }
    if (mappingFailed) {
      rows.forEach(row => render(ensureCell(row, index), 'error'));
      return;
    }
    rows.forEach(row => render(ensureCell(row, index), 'loading'));
    if (!mappingPromise) {
      mappingPromise = loadMapping().then(mapping => {
        resolvedMapping = mapping;
        schedule();
      }).catch(error => {
        mappingFailed = true;
        console.warn('[百变后台调查点地图] 反查失败', error);
        schedule();
      });
    }
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 160);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', () => {
    mappingPromise = null;
    resolvedMapping = null;
    mappingFailed = false;
    schedule();
  });
  update();
})();

// 投票批量创建：在投票列表/编辑页面按“标题 + 分数”逐条创建投票。
// 其它字段使用后台新建表单，并覆盖为统一的默认配置。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-batch-vote-question';
  const MODAL_ID = 'bb-batch-vote-question-modal';
  const DEFAULT_SCORE_KEY = 'bb-batch-vote-question-default-score-v1';
  let updateTimer = null;
  let currentRows = [];

  function isVoteEditPage() {
    return /\/playbook\/votes\/\d+\/edit\/?$/.test(location.pathname);
  }

  function getCreateUrl() {
    const url = new URL(window.location.href);
    url.pathname = url.pathname.replace(/\/votes\/\d+\/edit\/?$/, '/votes/create');
    return url.href;
  }

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  async function loadDefaultScore() {
    try {
      const stored = await chrome.storage.local.get(DEFAULT_SCORE_KEY);
      return /^\d+(?:\.\d+)?$/.test(String(stored[DEFAULT_SCORE_KEY] ?? ''))
        ? String(stored[DEFAULT_SCORE_KEY])
        : '2';
    } catch (_) {
      return '2';
    }
  }

  async function saveDefaultScore(value) {
    try {
      await chrome.storage.local.set({ [DEFAULT_SCORE_KEY]: value });
    } catch (_) { /* 存储不可用时仍可继续本次创建 */ }
  }

  function addStyles() {
    const styleId = 'bb-batch-vote-question-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 10000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); }
      #${MODAL_ID} .bb-vote-question-dialog { width: min(820px, calc(100vw - 40px)); max-height: calc(100vh - 60px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 12px; }
      #${MODAL_ID} .bb-vote-question-hint { color: #687786; margin-bottom: 10px; }
      #${MODAL_ID} .bb-vote-question-default { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      #${MODAL_ID} .bb-vote-question-default label { color: #394b59; white-space: nowrap; }
      #${MODAL_ID} .bb-vote-question-default input { width: 110px; padding: 6px 8px; border: 1px solid #ccd6df; border-radius: 4px; }
      #${MODAL_ID} textarea { width: 100%; min-height: 170px; box-sizing: border-box; resize: vertical; padding: 8px; border: 1px solid #ccd6df; border-radius: 4px; font-family: monospace; }
      #${MODAL_ID} table { width: 100%; margin-top: 12px; border-collapse: collapse; }
      #${MODAL_ID} th, #${MODAL_ID} td { padding: 7px 9px; border: 1px solid #e1e6eb; text-align: left; }
      #${MODAL_ID} th { background: #f5f8fa; }
      #${MODAL_ID} .bb-vote-question-status { min-height: 24px; margin-top: 10px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-vote-question-role-section { margin-top: 14px; }
      #${MODAL_ID} .bb-vote-question-role-section h4 { margin: 0 0 8px; color: #394b59; }
      #${MODAL_ID} .bb-vote-question-role-note { margin-bottom: 10px; color: #687786; }
      #${MODAL_ID} .bb-vote-question-role-list { display: grid; gap: 10px; }
      #${MODAL_ID} .bb-vote-question-role-card { padding: 11px 12px; border: 1px solid #dfe6ee; border-radius: 5px; background: #fafcff; }
      #${MODAL_ID} .bb-vote-question-role-card strong { display: block; margin-bottom: 8px; color: #333; }
      #${MODAL_ID} .bb-vote-question-role-options { display: flex; flex-wrap: wrap; gap: 7px 16px; }
      #${MODAL_ID} .bb-vote-question-role-option { display: inline-flex; align-items: center; gap: 5px; margin: 0; color: #555; font-weight: normal; }
      #${MODAL_ID} .bb-vote-question-role-option input { margin: 0; }
      #${MODAL_ID} .bb-vote-question-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      #${MODAL_ID} .bb-vote-question-error { color: #c0392b; }
      a[${BUTTON_ATTRIBUTE}] { margin-left: 6px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function parseRows(raw, defaultScore = '2') {
    return String(raw || '').split(/\r?\n/).map((line, index) => {
      const value = line.trim();
      if (!value) return null;
      const parts = value.split(/\t|,|，/).map(normalize);
      const title = parts.shift() || '';
      const scoreText = parts.join('').trim();
      if (!title) return null;
      if (!scoreText) return { line: index + 1, title, score: defaultScore };
      if (!/^\d+(?:\.\d+)?$/.test(scoreText)) {
        return { line: index + 1, title, score: scoreText, error: '分数必须是数字' };
      }
      return { line: index + 1, title, score: scoreText };
    }).filter(Boolean);
  }

  function renderPreview(panel, rows) {
    const body = panel.querySelector('tbody');
    body.replaceChildren();
    rows.forEach(row => {
      const tr = document.createElement('tr');
      [row.line, row.title || '-', row.score || '-', row.error || '待创建'].forEach((value, index) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (row.error && index === 3) cell.className = 'bb-vote-question-error';
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
  }

  function findFieldGroup(doc, labelText) {
    const label = Array.from(doc.querySelectorAll('label, .control-label, .field-label'))
      .find(item => normalize(item.textContent) === labelText);
    if (label) return label.closest('.form-group, .form-row, .field, .row') || label.parentElement;
    return Array.from(doc.querySelectorAll('.form-group, .form-row, .field, .row'))
      .find(item => normalize(item.firstElementChild?.textContent) === labelText) || null;
  }

  function setControlValue(control, value) {
    if (!control) throw new Error('未找到目标字段');
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelectByText(form, labelText, text) {
    const group = findFieldGroup(form.ownerDocument, labelText);
    const select = group?.querySelector('select');
    if (!select) throw new Error(`未找到${labelText}字段`);
    const option = Array.from(select.options).find(item => normalize(item.textContent) === text)
      || Array.from(select.options).find(item => normalize(item.textContent).includes(text));
    if (!option) throw new Error(`${labelText}中未找到“${text}”选项`);
    if (select.multiple) {
      Array.from(select.options).forEach(item => { item.selected = item === option; });
    } else {
      select.value = option.value;
    }
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (window.jQuery) window.jQuery(select).val(select.multiple ? [option.value] : option.value).trigger('change');
    } catch (_) { /* 原生事件已触发 */ }
  }

  function getVoteRoleSelect(form) {
    return findFieldGroup(form.ownerDocument, '公共/角色')?.querySelector('select')
      || form.querySelector('select[name*="character"], select[name*="role"]');
  }

  function setVoteRoleValues(form, values = []) {
    const select = getVoteRoleSelect(form);
    if (!select) throw new Error('未找到公共/角色字段');
    let selectedValues = values.map(String).filter(value =>
      Array.from(select.options).some(option => String(option.value) === value)
    );
    if (!selectedValues.length) {
      const publicOption = Array.from(select.options).find(option => normalize(option.textContent).includes('公共投票组'));
      if (publicOption) selectedValues = [String(publicOption.value)];
    }
    if (!selectedValues.length) throw new Error('未选择投票关联角色');
    Array.from(select.options).forEach(option => {
      option.selected = select.multiple
        ? selectedValues.includes(String(option.value))
        : String(option.value) === selectedValues[0];
    });
    if (!select.multiple) select.value = selectedValues[0];
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function loadVoteRoleOptions(createUrl) {
    const response = await fetch(createUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取角色列表失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.forms).find(item => item.method.toLowerCase() === 'post' && findFieldGroup(doc, '标题'));
    if (!form) throw new Error('未找到投票新建表单');
    const select = getVoteRoleSelect(form);
    if (!select) throw new Error('未找到公共/角色字段');
    const roles = Array.from(select.options).map(option => ({
      value: String(option.value || ''),
      name: normalize(option.textContent),
      selected: option.selected,
    })).filter(role => role.value && role.name && !/请选择/.test(role.name));
    if (!roles.length) throw new Error('公共/角色字段中没有可用选项');
    const selectedValues = roles.filter(role => role.selected).map(role => role.value);
    const publicRole = roles.find(role => role.name.includes('公共投票组'));
    return {
      roles,
      multiple: Boolean(select.multiple),
      defaultValues: selectedValues.length ? selectedValues : (publicRole ? [publicRole.value] : [roles[0].value]),
    };
  }

  function setToggle(form, labelText, enabled) {
    const group = findFieldGroup(form.ownerDocument, labelText);
    const checkbox = group?.querySelector('input[type="checkbox"]');
    if (!checkbox) throw new Error(`未找到${labelText}开关`);
    checkbox.checked = enabled;
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setVoteFields(form, row, roleValues) {
    const titleInput = findFieldGroup(form.ownerDocument, '标题')?.querySelector('input, textarea')
      || form.querySelector('[name="title"], [name="name"]');
    if (!titleInput) throw new Error('未找到标题字段');
    setControlValue(titleInput, row.title);

    setVoteRoleValues(form, roleValues);
    setSelectByText(form, '展示样式', '纯文字');
    setSelectByText(form, '投票形式', '单选');
    setSelectByText(form, '得分策略', '独立计分模式');
    setToggle(form, '是否展示问题结果', true);
    setToggle(form, '是否展示问题详情结果', true);

    const resultTitle = findFieldGroup(form.ownerDocument, '展示结果标题')?.querySelector('input, textarea');
    if (!resultTitle) throw new Error('未找到展示结果标题字段');
    setControlValue(resultTitle, row.title);

    const score = findFieldGroup(form.ownerDocument, '默认分数')?.querySelector('input, textarea');
    if (!score) throw new Error('未找到默认分数字段');
    setControlValue(score, row.score || '2');
  }

  async function createOne(createUrl, row, roleValues) {
    const response = await fetch(createUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取新建表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.forms).find(item =>
      item.method.toLowerCase() === 'post' && findFieldGroup(doc, '标题')
    );
    if (!form) throw new Error('未找到投票新建表单');
    setVoteFields(form, row, roleValues);
    const formAction = new URL(form.getAttribute('action') || createUrl, createUrl).href;
    const createResponse = await fetch(formAction, {
      method: 'POST',
      body: new FormData(form),
      credentials: 'same-origin',
    });
    if (!createResponse.ok) throw new Error(`创建失败：HTTP ${createResponse.status}`);
    const contentType = createResponse.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await createResponse.json();
      if (payload.status === false) throw new Error(payload.message || '后台返回创建失败');
    }
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function openModal(createUrl) {
    closeModal();
    addStyles();
    const defaultScore = await loadDefaultScore();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-vote-question-dialog">
        <h3>批量添加投票</h3>
        <div class="bb-vote-question-hint">每行输入：投票标题[TAB]投票分数；投票分数可留空，使用下方全局默认分数。展示结果标题自动与投票标题相同。</div>
        <div class="bb-vote-question-default">
          <label for="bb-vote-question-default-score">全局默认分数</label>
          <input id="bb-vote-question-default-score" data-bb-vote-question-default-score type="number" min="0" step="1" value="${defaultScore}" />
          <span>分（会保存，下次打开继续使用）</span>
        </div>
        <textarea data-bb-vote-question-input placeholder="例如：\n任智遇到鬼的直播间\t2\n谁拿走了手机？\t"></textarea>
        <table><thead><tr><th>行号</th><th>投票标题</th><th>投票分数</th><th>状态</th></tr></thead><tbody></tbody></table>
        <section class="bb-vote-question-role-section" data-bb-vote-question-role-section hidden>
          <h4>投票关联角色</h4>
          <div class="bb-vote-question-role-note">请为每条投票选择“公共投票组”或具体角色。默认保持“公共投票组”。</div>
          <div class="bb-vote-question-role-list" data-bb-vote-question-role-list></div>
        </section>
        <div class="bb-vote-question-status" data-bb-vote-question-status></div>
        <div class="bb-vote-question-actions">
          <button type="button" class="btn btn-default" data-bb-vote-question-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-vote-question-confirm>下一步：投票关联角色</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('[data-bb-vote-question-input]');
    const defaultScoreInput = modal.querySelector('[data-bb-vote-question-default-score]');
    const roleSection = modal.querySelector('[data-bb-vote-question-role-section]');
    const roleList = modal.querySelector('[data-bb-vote-question-role-list]');
    const status = modal.querySelector('[data-bb-vote-question-status]');
    const confirmButton = modal.querySelector('[data-bb-vote-question-confirm]');
    const cancelButton = modal.querySelector('[data-bb-vote-question-cancel]');
    let rowsForSubmit = [];
    let roleConfig = null;
    let isRoleStep = false;
    const refresh = () => {
      const score = normalize(defaultScoreInput.value);
      currentRows = parseRows(input.value, score || '2');
      renderPreview(modal, currentRows);
      status.className = 'bb-vote-question-status';
      status.textContent = currentRows.length ? `共 ${currentRows.length} 个投票` : '';
      if (!isRoleStep) confirmButton.textContent = '下一步：投票关联角色';
    };
    input.addEventListener('input', refresh);
    defaultScoreInput.addEventListener('input', refresh);
    defaultScoreInput.addEventListener('change', async () => {
      const score = normalize(defaultScoreInput.value);
      if (/^\d+(?:\.\d+)?$/.test(score)) await saveDefaultScore(score);
    });
    cancelButton.addEventListener('click', closeModal);

    const renderRoleCards = () => {
      roleList.replaceChildren();
      rowsForSubmit.forEach((row, index) => {
        const card = document.createElement('div');
        card.className = 'bb-vote-question-role-card';
        const title = document.createElement('strong');
        title.textContent = `${index + 1}. ${row.title}`;
        const options = document.createElement('div');
        options.className = 'bb-vote-question-role-options';
        roleConfig.roles.forEach(role => {
          const label = document.createElement('label');
          label.className = 'bb-vote-question-role-option';
          const control = document.createElement('input');
          control.type = roleConfig.multiple ? 'checkbox' : 'radio';
          control.name = `bb-vote-role-${index}`;
          control.value = role.value;
          control.dataset.voteRow = String(index);
          control.checked = roleConfig.defaultValues.includes(role.value);
          const name = document.createElement('span');
          name.textContent = role.name;
          label.append(control, name);
          options.appendChild(label);
        });
        card.append(title, options);
        roleList.appendChild(card);
      });
    };
    const getRoleValues = index => Array.from(roleList.querySelectorAll(`input[data-vote-row="${index}"]:checked`))
      .map(control => control.value);

    confirmButton.addEventListener('click', async () => {
      status.className = 'bb-vote-question-status';
      status.textContent = isRoleStep ? '正在准备创建…' : '正在读取角色列表…';
      try {
        if (!isRoleStep) {
          refresh();
          const configuredDefaultScore = normalize(defaultScoreInput.value);
          if (!/^\d+(?:\.\d+)?$/.test(configuredDefaultScore)) {
            status.className = 'bb-vote-question-status bb-vote-question-error';
            status.textContent = '全局默认分数必须是数字';
            defaultScoreInput.focus();
            return;
          }
          saveDefaultScore(configuredDefaultScore);
          const validRows = currentRows.filter(row => !row.error);
          if (!validRows.length || validRows.length !== currentRows.length) {
            status.className = 'bb-vote-question-status bb-vote-question-error';
            status.textContent = '请先修正预览中的错误行';
            return;
          }
          confirmButton.disabled = true;
          cancelButton.disabled = true;
          try {
            roleConfig = await loadVoteRoleOptions(createUrl);
            rowsForSubmit = validRows;
            isRoleStep = true;
            input.disabled = true;
            defaultScoreInput.disabled = true;
            roleSection.hidden = false;
            renderRoleCards();
            status.textContent = '';
            confirmButton.textContent = `确认创建 ${validRows.length} 个投票`;
          } finally {
            confirmButton.disabled = false;
            cancelButton.disabled = false;
          }
          return;
        }

        const missingRoleIndex = rowsForSubmit.findIndex((_, index) => !getRoleValues(index).length);
        if (missingRoleIndex >= 0) {
          status.className = 'bb-vote-question-status bb-vote-question-error';
          status.textContent = `请为第 ${missingRoleIndex + 1} 条投票选择关联角色`;
          return;
        }

        confirmButton.disabled = true;
        cancelButton.disabled = true;
        roleList.querySelectorAll('input').forEach(control => { control.disabled = true; });
        const failures = [];
        for (let index = 0; index < rowsForSubmit.length; index += 1) {
          const row = rowsForSubmit[index];
          status.textContent = `正在创建 ${index + 1}/${rowsForSubmit.length}：${row.title}`;
          try {
            await createOne(createUrl, row, getRoleValues(index));
          } catch (error) {
            failures.push(`第 ${row.line} 行 ${row.title}：${error.message || '创建失败'}`);
          }
        }
        if (failures.length) {
          status.className = 'bb-vote-question-status bb-vote-question-error';
          status.textContent = `完成，但有 ${failures.length} 行失败：\n${failures.join('\n')}`;
          confirmButton.disabled = false;
          cancelButton.disabled = false;
          roleList.querySelectorAll('input').forEach(control => { control.disabled = false; });
        } else {
          status.textContent = `成功创建 ${rowsForSubmit.length} 个投票，即将刷新列表。`;
          window.setTimeout(() => window.location.reload(), 700);
        }
      } catch (error) {
        status.className = 'bb-vote-question-status bb-vote-question-error';
        status.textContent = `创建流程异常：${error.message || '未知错误'}`;
        confirmButton.disabled = false;
        cancelButton.disabled = false;
      }
    });
    refresh();
  }

  function update() {
    if (!isVoteEditPage() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const filter = Array.from(document.querySelectorAll('label, .btn, a, span'))
      .find(item => /筛选/.test(normalize(item.textContent)) && item.closest('.box, .panel, .container'));
    const table = document.querySelector('.box-body table') || document.querySelector('table');
    const anchor = filter || table?.closest('.box')?.querySelector('.box-header') || table;
    if (!anchor) {
      // 投票列表是异步加载的，工具栏尚未生成时稍后主动重试一次。
      window.setTimeout(update, 500);
      return;
    }
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '批量添加投票';
    button.addEventListener('click', event => { event.preventDefault(); openModal(getCreateUrl()); });
    anchor.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  // 后台切换分页、PJAX 刷新时可能直接替换工具栏节点，持续轻量检查确保快捷按钮补回。
  window.setInterval(update, 800);
  update();
})();

// 投票组批量创建：每行一个标题，限制时间统一为 600 秒，其余字段沿用后台默认值。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-batch-vote-pack';
  const MODAL_ID = 'bb-batch-vote-pack-modal';
  let updateTimer = null;
  let currentTitles = [];

  function isList() {
    return /\/playbook\/votepacks\/?$/.test(location.pathname);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/votepacks/create"]'))
      .find(link => /添加组/.test(link.textContent)) || null;
  }

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function addStyles() {
    const styleId = 'bb-batch-vote-pack-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 10000; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.35); }
      #${MODAL_ID} .bb-vote-dialog { width: min(760px, calc(100vw - 40px)); max-height: calc(100vh - 60px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 8px 30px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 12px; }
      #${MODAL_ID} .bb-vote-hint { color: #687786; margin-bottom: 10px; }
      #${MODAL_ID} textarea { width: 100%; min-height: 170px; box-sizing: border-box; resize: vertical; padding: 8px; border: 1px solid #ccd6df; border-radius: 4px; }
      #${MODAL_ID} table { width: 100%; margin-top: 12px; border-collapse: collapse; }
      #${MODAL_ID} th, #${MODAL_ID} td { padding: 7px 9px; border: 1px solid #e1e6eb; text-align: left; }
      #${MODAL_ID} th { background: #f5f8fa; }
      #${MODAL_ID} .bb-vote-status { min-height: 24px; margin-top: 10px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-vote-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      #${MODAL_ID} .bb-vote-error { color: #c0392b; }
      a[${BUTTON_ATTRIBUTE}] { margin-left: 6px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function parseTitles(raw) {
    return String(raw || '').split(/\r?\n/).map((line, index) => ({
      line: index + 1,
      title: normalize(line),
    })).filter(row => row.title);
  }

  function renderPreview(panel, titles) {
    const body = panel.querySelector('tbody');
    body.replaceChildren();
    titles.forEach(row => {
      const tr = document.createElement('tr');
      [row.line, row.title, '600 秒', '待创建'].forEach(value => {
        const cell = document.createElement('td');
        cell.textContent = value;
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });
  }

  function findFieldGroup(doc, labelText) {
    const label = Array.from(doc.querySelectorAll('label, .control-label, .field-label'))
      .find(item => normalize(item.textContent) === labelText);
    if (label) return label.closest('.form-group, .form-row, .field, .row') || label.parentElement;
    return Array.from(doc.querySelectorAll('.form-group, .form-row, .field, .row'))
      .find(item => normalize(item.firstElementChild?.textContent) === labelText) || null;
  }

  function setControlValue(control, value) {
    if (!control) throw new Error('未找到目标字段');
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setVoteFields(form, title) {
    const titleInput = form.querySelector('[name="name"]')
      || findFieldGroup(form.ownerDocument, '标题')?.querySelector('input, textarea');
    if (!titleInput) throw new Error('未找到标题字段');
    setControlValue(titleInput, title);

    const timeGroup = findFieldGroup(form.ownerDocument, '限制时间(秒)');
    const timeInput = timeGroup?.querySelector('input, textarea')
      || form.querySelector('[name*="limit" i], [name*="time" i]');
    if (!timeInput) throw new Error('未找到限制时间字段');
    setControlValue(timeInput, '600');
  }

  function resolveFormAction(form, baseUrl) {
    return new URL(form.getAttribute('action') || baseUrl, baseUrl).href;
  }

  async function createOne(createUrl, title) {
    const response = await fetch(createUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取新建表单失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = Array.from(doc.forms).find(item =>
      item.method.toLowerCase() === 'post' &&
      (item.querySelector('[name="name"]') || findFieldGroup(doc, '标题'))
    );
    if (!form) throw new Error('未找到投票组新建表单');
    setVoteFields(form, title);
    const createResponse = await fetch(resolveFormAction(form, createUrl), {
      method: 'POST',
      body: new FormData(form),
      credentials: 'same-origin',
    });
    if (!createResponse.ok) throw new Error(`创建失败：HTTP ${createResponse.status}`);
    const contentType = createResponse.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await createResponse.json();
      if (payload.status === false) throw new Error(payload.message || '后台返回创建失败');
    }
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function openModal(createLink) {
    closeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-vote-dialog">
        <h3>批量添加投票组</h3>
        <div class="bb-vote-hint">每行输入一个投票组标题；限制时间统一为 600 秒，复盘阶段显示结果和手动展示结果沿用后台默认值。</div>
        <textarea data-bb-vote-input placeholder="例如：\n第一幕投票\n第二幕投票\n最终投票"></textarea>
        <table><thead><tr><th>行号</th><th>标题</th><th>限制时间</th><th>状态</th></tr></thead><tbody></tbody></table>
        <div class="bb-vote-status" data-bb-vote-status></div>
        <div class="bb-vote-actions">
          <button type="button" class="btn btn-default" data-bb-vote-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-vote-confirm>确认创建</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('[data-bb-vote-input]');
    const status = modal.querySelector('[data-bb-vote-status]');
    const refresh = () => {
      currentTitles = parseTitles(input.value);
      renderPreview(modal, currentTitles);
      status.className = 'bb-vote-status';
      status.textContent = currentTitles.length ? `共 ${currentTitles.length} 个投票组` : '';
    };
    input.addEventListener('input', refresh);
    modal.querySelector('[data-bb-vote-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-bb-vote-confirm]').addEventListener('click', async event => {
      refresh();
      if (!currentTitles.length) {
        status.className = 'bb-vote-status bb-vote-error';
        status.textContent = '请至少输入一个投票组标题';
        return;
      }
      const confirmButton = event.currentTarget;
      confirmButton.disabled = true;
      modal.querySelector('[data-bb-vote-cancel]').disabled = true;
      const failures = [];
      for (let index = 0; index < currentTitles.length; index += 1) {
        const row = currentTitles[index];
        status.textContent = `正在创建 ${index + 1}/${currentTitles.length}：${row.title}`;
        try {
          await createOne(createLink.href, row.title);
        } catch (error) {
          failures.push(`第 ${row.line} 行 ${row.title}：${error.message || '创建失败'}`);
        }
      }
      if (failures.length) {
        status.className = 'bb-vote-status bb-vote-error';
        status.textContent = `完成，但有 ${failures.length} 行失败：\n${failures.join('\n')}`;
        confirmButton.disabled = false;
        modal.querySelector('[data-bb-vote-cancel]').disabled = false;
      } else {
        status.textContent = `成功创建 ${currentTitles.length} 个投票组，即将刷新列表。`;
        window.setTimeout(() => window.location.reload(), 700);
      }
    });
    refresh();
  }

  function update() {
    if (!isList()) return;
    const createLink = getCreateLink();
    if (!createLink || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '批量添加投票组';
    button.addEventListener('click', event => { event.preventDefault(); openModal(createLink); });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 背景音乐批量上传：用户确认后，按音频文件名创建背景音乐并自动读取时长。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-batch-music-button';
  const MODAL_ID = 'bb-batch-music-modal';
  let selectedTracks = [];

  function isMusicList() {
    return /\/playbook\/bmgs$/.test(location.pathname);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/bmgs/create"]')).find(link =>
      /添加背景/.test(link.textContent)
    ) || null;
  }

  function isAudioFile(file) {
    return file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
  }

  function readDuration(file) {
    return new Promise(resolve => {
      const audio = document.createElement('audio');
      const url = URL.createObjectURL(file);
      const finish = duration => {
        URL.revokeObjectURL(url);
        audio.remove();
        resolve(Number.isFinite(duration) && duration > 0 ? Math.max(1, Math.round(duration)) : 60);
      };
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(60);
      audio.src = url;
    });
  }

  function addStyles() {
    if (document.getElementById('bb-batch-music-style')) return;
    const style = document.createElement('style');
    style.id = 'bb-batch-music-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 99999; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-batch-panel { width: min(680px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} .bb-batch-note { color: #777; line-height: 1.6; }
      #${MODAL_ID} .bb-batch-list { margin: 14px 0; max-height: 260px; overflow: auto; border: 1px solid #ddd; }
      #${MODAL_ID} .bb-batch-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 10px; border-bottom: 1px solid #eee; }
      #${MODAL_ID} .bb-batch-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-batch-title { font-weight: 600; word-break: break-all; }
      #${MODAL_ID} .bb-batch-file { color: #888; word-break: break-all; text-align: right; }
      #${MODAL_ID} .bb-batch-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      #${MODAL_ID} .bb-batch-status { margin-top: 12px; color: #337ab7; white-space: pre-line; }
    `;
    document.head.appendChild(style);
  }

  function removeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function renderTrackList(container) {
    container.replaceChildren();
    if (!selectedTracks.length) {
      container.textContent = '尚未选择音频。';
      return;
    }
    selectedTracks.forEach(({ file, duration }) => {
      const row = document.createElement('div');
      row.className = 'bb-batch-row';
      const title = document.createElement('span');
      title.className = 'bb-batch-title';
      title.textContent = file.name;
      const meta = document.createElement('span');
      meta.className = 'bb-batch-file';
      meta.textContent = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
      row.append(title, meta);
      container.appendChild(row);
    });
  }

  function createModal(createLink) {
    removeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'bb-batch-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量上传背景音乐';
    const note = document.createElement('p');
    note.className = 'bb-batch-note';
    note.textContent = '每个音频文件将创建一条背景音乐：名称保留完整文件名，时长自动读取，作者和备注留空。';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac';
    picker.multiple = true;
    picker.className = 'form-control';
    const list = document.createElement('div');
    list.className = 'bb-batch-list';
    renderTrackList(list);
    const status = document.createElement('div');
    status.className = 'bb-batch-status';
    const actions = document.createElement('div');
    actions.className = 'bb-batch-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 首音乐';
    picker.addEventListener('change', async () => {
      const files = Array.from(picker.files || []).filter(isAudioFile);
      status.textContent = files.length ? '正在读取音频时长…' : '请选择至少一首音频。';
      selectedTracks = await Promise.all(files.map(async file => ({ file, duration: await readDuration(file) })));
      renderTrackList(list);
      confirm.textContent = `确认创建 ${selectedTracks.length} 首音乐`;
      status.textContent = selectedTracks.length ? '' : '请选择至少一首音频。';
    });
    cancel.addEventListener('click', removeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else removeModal();
        return;
      }
      if (!selectedTracks.length) {
        status.textContent = '请选择至少一首音频。';
        return;
      }
      // 仅在用户点击“确认创建”后，才执行实际的后台新增。
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      let completed = 0;
      const failures = [];
      try {
        const createResponse = await fetch(createLink.href, { credentials: 'same-origin' });
        if (!createResponse.ok) throw new Error(`读取创建页面失败：HTTP ${createResponse.status}`);
        const createDoc = new DOMParser().parseFromString(await createResponse.text(), 'text/html');
        const form = Array.from(createDoc.forms).find(item => item.method.toLowerCase() === 'post' && item.querySelector('[name="link"]'));
        if (!form) throw new Error('未找到后台音乐创建表单');
        const action = form.action;
        const token = form.querySelector('[name="_token"]')?.value;
        const playbookId = form.querySelector('[name="playbook_id"]')?.value;
        if (!token || !playbookId) throw new Error('未读取到后台创建凭据');
        for (const { file, duration } of selectedTracks) {
          status.textContent = `正在创建 ${completed + 1}/${selectedTracks.length}：${file.name}`;
          const data = new FormData();
          data.append('playbook_id', playbookId);
          data.append('name', file.name);
          data.append('link', file, file.name);
          data.append('url', '');
          data.append('author', '');
          data.append('length', String(duration));
          data.append('remarks', '');
          data.append('_token', token);
          try {
            const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            completed += 1;
          } catch (error) {
            failures.push(`${file.name}：${error.message || '创建失败'}`);
          }
        }
      } catch (error) {
        failures.push(error.message || '批量创建初始化失败');
      }
      status.textContent = `已创建 ${completed}/${selectedTracks.length} 首音乐。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, picker, list, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) removeModal(); });
    document.body.appendChild(modal);
  }

  function addButton() {
    if (!isMusicList() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量上传音乐';
    button.addEventListener('click', () => createModal(createLink));
    createLink.insertAdjacentElement('afterend', button);
  }

  new MutationObserver(addButton).observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();

// 地图文件夹配置：记住地图素材目录，并让地图图片选择优先从该目录打开。
(() => {
  'use strict';

  const API_KEY = '__bbMapFolderApi';
  const BUTTON_ATTRIBUTE = 'data-bb-map-folder-button';
  const STATUS_ATTRIBUTE = 'data-bb-map-folder-status';
  const STYLE_ID = 'bb-map-folder-style';
  const DB_NAME = 'bb-map-folder-preferences';
  const STORE_NAME = 'settings';
  const SETTING_KEY = 'map-folder';
  let updateTimer = null;
  let cachedFolder = null;
  let loaded = false;
  let loadedPlaybookId = '';

  const isMapPage = () => /\/playbook\/maps(?:\/create|\/\d+\/edit)?\/?$/.test(location.pathname);
  const isMapList = () => /\/playbook\/maps\/?$/.test(location.pathname);
  const isMapEditor = () => /\/playbook\/maps(?:\/create|\/\d+\/edit)\/?$/.test(location.pathname);

  function currentPlaybookId() {
    return new URL(location.href).searchParams.get('playbook_id')
      || document.querySelector('input[name="playbook_id"]')?.value
      || '';
  }

  function pickerId() {
    const playbookId = currentPlaybookId();
    return playbookId ? `bb-map-image-folder-${playbookId}` : 'bb-map-image-folder-unassigned';
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bb-map-folder-status { display: inline-block; margin-left: 8px; color: #6b7b8b; vertical-align: middle; }
      .bb-map-folder-status.is-error { color: #dd4b39; }
      .bb-map-folder-picker-note { display: inline-block; margin-left: 6px; color: #6b7b8b; font-size: 12px; vertical-align: middle; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('当前浏览器不支持保存文件夹配置'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('打开文件夹配置失败'));
    });
  }

  async function readPreference() {
    try {
      const db = await openDatabase();
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(SETTING_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('读取文件夹配置失败'));
      });
    } catch (error) {
      console.warn('[百变后台地图文件夹] 读取配置失败', error);
      return null;
    }
  }

  async function writePreference(preference) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).put(preference, SETTING_KEY);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('保存文件夹配置失败'));
    });
  }

  async function deletePreference() {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).delete(SETTING_KEY);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('清除文件夹配置失败'));
    });
  }

  async function loadPreference() {
    const playbookId = currentPlaybookId();
    if (loaded && loadedPlaybookId === playbookId) return cachedFolder;
    const preference = await readPreference();
    if (preference && playbookId && String(preference.playbookId || '') === playbookId) {
      cachedFolder = preference;
    } else {
      cachedFolder = null;
      if (preference) {
        try {
          await deletePreference();
        } catch (error) {
          console.warn('[百变后台地图文件夹] 清除其他剧本的配置失败', error);
        }
      }
    }
    loadedPlaybookId = playbookId;
    loaded = true;
    return cachedFolder;
  }

  function folderName() {
    if (String(cachedFolder?.playbookId || '') !== currentPlaybookId()) return '';
    return cachedFolder?.name || cachedFolder?.directoryName || '';
  }

  function canUseRememberedFolder() {
    return Boolean(
      String(cachedFolder?.playbookId || '') === currentPlaybookId()
      && cachedFolder?.handle
      && typeof window.showOpenFilePicker === 'function'
    );
  }

  function setInputFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pickerTypes(accept) {
    if (accept !== 'image/*') return undefined;
    return [{
      description: '图片',
      accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] },
    }];
  }

  function openFilesFromRememberedFolder(input, accept = input.accept || '', multiple = input.multiple) {
    if (!canUseRememberedFolder()) return false;

    const options = {
      id: pickerId(),
      startIn: cachedFolder.handle,
      multiple: Boolean(multiple),
    };
    const types = pickerTypes(accept);
    if (types) options.types = types;

    // 立即调用系统选择器，保持用户点击带来的授权上下文。
    const pickerPromise = window.showOpenFilePicker(options);
    pickerPromise.then(async handles => {
      const files = await Promise.all(handles.map(handle => handle.getFile()));
      setInputFiles(input, files);
    }).catch(error => {
      if (error?.name !== 'AbortError') {
        console.warn('[百变后台地图文件夹] 从已配置目录选择文件失败', error);
      }
    });
    return true;
  }

  function enhanceFileInput(input, options = {}) {
    if (!input || input.dataset.bbMapFolderEnhanced === 'true') return;
    input.dataset.bbMapFolderEnhanced = 'true';
    input.addEventListener('click', event => {
      if (!canUseRememberedFolder()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openFilesFromRememberedFolder(input, options.accept || input.accept || '', options.multiple ?? input.multiple);
    }, true);
  }

  function attachEditorInputs() {
    if (!isMapEditor()) return;
    document.querySelectorAll('input[type="file"][name="image"]').forEach(input => {
      enhanceFileInput(input, { accept: 'image/*', multiple: false });
    });
  }

  function updateFolderStatus(status) {
    if (!status) return;
    const name = folderName();
    status.classList.toggle('is-error', false);
    status.textContent = name ? `当前：${name}` : '当前：未设置';
    status.title = name ? `地图图片将优先从“${name}”打开` : '尚未设置地图文件夹';
  }

  function addConfigButton() {
    if (!isMapList() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = Array.from(document.querySelectorAll('a[href*="/playbook/maps/create"]'))
      .find(link => /添加地图/.test(String(link.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!createLink) return;
    addStyles();

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-default';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '设置地图文件夹';
    const status = document.createElement('span');
    status.className = 'bb-map-folder-status';
    status.setAttribute(STATUS_ATTRIBUTE, 'true');
    updateFolderStatus(status);

    button.addEventListener('click', async () => {
      try {
        let preference = null;
        const playbookId = currentPlaybookId();
        if (!playbookId) throw new Error('没有识别到当前剧本 ID');
        if (typeof window.showDirectoryPicker === 'function') {
          const handle = await window.showDirectoryPicker({ id: pickerId(), mode: 'read' });
          if (typeof handle.requestPermission === 'function') {
            await handle.requestPermission({ mode: 'read' });
          }
          preference = { handle, name: handle.name, playbookId, updatedAt: Date.now() };
        } else {
          const picker = document.createElement('input');
          picker.type = 'file';
          picker.multiple = true;
          picker.setAttribute('webkitdirectory', '');
          picker.style.display = 'none';
          document.body.appendChild(picker);
          preference = await new Promise(resolve => {
            picker.addEventListener('change', () => {
              const firstFile = picker.files?.[0];
              const directoryName = firstFile?.webkitRelativePath?.split('/')[0] || '';
              picker.remove();
              resolve(directoryName ? { directoryName, name: directoryName, playbookId, updatedAt: Date.now() } : null);
            }, { once: true });
            picker.click();
          });
          if (picker.isConnected) picker.remove();
          if (!preference) return;
        }
        await writePreference(preference);
        cachedFolder = preference;
        loadedPlaybookId = playbookId;
        loaded = true;
        updateFolderStatus(status);
        status.textContent += canUseRememberedFolder() ? '' : '（当前浏览器无法记忆目录）';
      } catch (error) {
        if (error?.name !== 'AbortError') {
          status.classList.add('is-error');
          status.textContent = `设置失败：${error.message || error}`;
        }
      }
    });

    createLink.insertAdjacentElement('afterend', button);
    button.insertAdjacentElement('afterend', status);
  }

  window[API_KEY] = {
    enhanceFileInput,
    getFolderName: folderName,
    canUseRememberedFolder,
    loadPreference,
  };

  loadPreference().then(() => {
    attachEditorInputs();
    document.querySelectorAll(`[${STATUS_ATTRIBUTE}]`).forEach(updateFolderStatus);
  });
  const observer = new MutationObserver(() => {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(async () => {
      if (loadedPlaybookId !== currentPlaybookId()) {
        loaded = false;
        await loadPreference();
        document.querySelectorAll(`[${STATUS_ATTRIBUTE}]`).forEach(updateFolderStatus);
      }
      addConfigButton();
      attachEditorInputs();
    }, 120);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => {
    if (loadedPlaybookId !== currentPlaybookId()) {
      loaded = false;
      loadPreference().then(() => {
        document.querySelectorAll(`[${STATUS_ATTRIBUTE}]`).forEach(updateFolderStatus);
        addConfigButton();
        attachEditorInputs();
      });
      return;
    }
    addConfigButton();
    attachEditorInputs();
  }, 700);
  addConfigButton();
  attachEditorInputs();
})();

// 地图批量上传：用户明确确认后，按“图片文件名 = 地图名称”逐张创建静态地图。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-batch-map-button';
  const MODAL_ID = 'bb-batch-map-modal';
  let selectedFiles = [];

  function isMapList() {
    return /\/playbook\/maps$/.test(location.pathname);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/maps/create"]')).find(link =>
      /添加地图/.test(link.textContent)
    ) || null;
  }

  function mapTitleFromFile(file) {
    return file.name.replace(/\.[^.]+$/, '').trim() || file.name;
  }

  function addStyles() {
    if (document.getElementById('bb-batch-map-style')) return;
    const style = document.createElement('style');
    style.id = 'bb-batch-map-style';
    style.textContent = `
      #${MODAL_ID} { position: fixed; z-index: 99999; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-batch-panel { width: min(680px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 20px; border-radius: 5px; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
      #${MODAL_ID} h3 { margin: 0 0 12px; font-size: 20px; }
      #${MODAL_ID} .bb-batch-note { color: #777; line-height: 1.6; }
      #${MODAL_ID} .bb-batch-list { margin: 14px 0; max-height: 260px; overflow: auto; border: 1px solid #ddd; }
      #${MODAL_ID} .bb-batch-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 10px; border-bottom: 1px solid #eee; }
      #${MODAL_ID} .bb-batch-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-batch-title { font-weight: 600; word-break: break-all; }
      #${MODAL_ID} .bb-batch-file { color: #888; word-break: break-all; text-align: right; }
      #${MODAL_ID} .bb-batch-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      #${MODAL_ID} .bb-batch-status { margin-top: 12px; color: #337ab7; white-space: pre-line; }
    `;
    document.head.appendChild(style);
  }

  function removeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function renderFileList(container) {
    container.replaceChildren();
    if (!selectedFiles.length) {
      container.textContent = '尚未选择图片。';
      return;
    }
    selectedFiles.forEach(file => {
      const row = document.createElement('div');
      row.className = 'bb-batch-row';
      const title = document.createElement('span');
      title.className = 'bb-batch-title';
      title.textContent = mapTitleFromFile(file);
      const fileName = document.createElement('span');
      fileName.className = 'bb-batch-file';
      fileName.textContent = file.name;
      row.append(title, fileName);
      container.appendChild(row);
    });
  }

  function createModal(createLink) {
    removeModal();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    const panel = document.createElement('div');
    panel.className = 'bb-batch-panel';
    const heading = document.createElement('h3');
    heading.textContent = '批量上传静态地图';
    const note = document.createElement('p');
    note.className = 'bb-batch-note';
    note.textContent = '每张图片将创建一条地图：名称取文件名（去掉扩展名），描述留空，动态图不上传。请确认图片尺寸符合后台要求。';
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.className = 'form-control';
    window.__bbMapFolderApi?.enhanceFileInput(picker, { accept: 'image/*', multiple: true });
    const list = document.createElement('div');
    list.className = 'bb-batch-list';
    renderFileList(list);
    const status = document.createElement('div');
    status.className = 'bb-batch-status';
    const actions = document.createElement('div');
    actions.className = 'bb-batch-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-default';
    cancel.textContent = '取消';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-danger';
    confirm.textContent = '确认创建 0 张地图';
    picker.addEventListener('change', () => {
      selectedFiles = Array.from(picker.files || []).filter(file => file.type.startsWith('image/'));
      renderFileList(list);
      confirm.textContent = `确认创建 ${selectedFiles.length} 张地图`;
      status.textContent = selectedFiles.length ? '' : '请选择至少一张图片。';
    });
    cancel.addEventListener('click', removeModal);
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (confirm.dataset.completed !== '0') window.location.reload();
        else removeModal();
        return;
      }
      if (!selectedFiles.length) {
        status.textContent = '请选择至少一张图片。';
        return;
      }
      // 此处是实际新增动作，只由用户点击“确认创建”触发。
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      let completed = 0;
      const failures = [];
      try {
        const createResponse = await fetch(createLink.href, { credentials: 'same-origin' });
        if (!createResponse.ok) throw new Error(`读取创建页面失败：HTTP ${createResponse.status}`);
        const createDoc = new DOMParser().parseFromString(await createResponse.text(), 'text/html');
        const form = Array.from(createDoc.forms).find(item => item.method.toLowerCase() === 'post' && item.querySelector('[name="image"]'));
        if (!form) throw new Error('未找到后台地图创建表单');
        const action = form.action;
        const token = form.querySelector('[name="_token"]')?.value;
        const playbookId = form.querySelector('[name="playbook_id"]')?.value;
        if (!token || !playbookId) throw new Error('未读取到后台创建凭据');

        for (const file of selectedFiles) {
          status.textContent = `正在创建 ${completed + 1}/${selectedFiles.length}：${file.name}`;
          const data = new FormData();
          data.append('playbook_id', playbookId);
          data.append('title', mapTitleFromFile(file));
          data.append('brief', '');
          data.append('image', file, file.name);
          data.append('video_play_once', 'off');
          data.append('is_pin', 'off');
          data.append('sync_play_video_sound', 'off');
          data.append('priority', '10');
          data.append('_token', token);
          try {
            const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            completed += 1;
          } catch (error) {
            failures.push(`${file.name}：${error.message || '创建失败'}`);
          }
        }
      } catch (error) {
        failures.push(error.message || '批量创建初始化失败');
      }
      status.textContent = `已创建 ${completed}/${selectedFiles.length} 张地图。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.textContent = failures.length ? '关闭' : '完成并刷新列表';
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
    });
    actions.append(cancel, confirm);
    panel.append(heading, note, picker, list, status, actions);
    modal.appendChild(panel);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) removeModal(); });
    document.body.appendChild(modal);
  }

  function addButton() {
    if (!isMapList() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.style.marginLeft = '8px';
    button.textContent = '批量上传地图';
    button.addEventListener('click', () => createModal(createLink));
    createLink.insertAdjacentElement('afterend', button);
  }

  const observer = new MutationObserver(addButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();

// 角色主图批量上传：支持按文件选择顺序或文件名匹配角色，并覆盖已有主图。
(() => {
  'use strict';

  const MODAL_ID = 'bb-character-image-batch-modal';
  const STYLE_ID = 'bb-character-image-batch-style';
  const BUTTON_ATTRIBUTE = 'data-bb-character-image-batch-button';
  const SELECT_ATTRIBUTE = 'data-bb-character-image-select';
  const SELECT_ALL_ATTRIBUTE = 'data-bb-character-image-select-all';
  const SELECT_CELL_ATTRIBUTE = 'data-bb-character-image-select-cell';
  const selectedCharacterIds = new Set();
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isCharacterList = () => /\/playbook\/characters\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-left: 8px; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 18px 24px 18px 18px; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-character-image-panel { width: min(820px, calc(100vw - 42px)); max-height: calc(100vh - 36px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
      @media (max-width: 820px) {
        #${MODAL_ID} { justify-content: center; padding: 18px; }
        #${MODAL_ID} .bb-character-image-panel { width: min(820px, calc(100vw - 36px)); max-height: calc(100vh - 36px); }
      }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-character-image-note { color: #687786; line-height: 1.7; }
      #${MODAL_ID} input[type="file"] { margin: 12px 0; }
      #${MODAL_ID} .bb-character-image-matching { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 0 0 12px; padding: 9px 10px; border: 1px solid #e1e7ec; border-radius: 4px; color: #3c4b5a; }
      #${MODAL_ID} .bb-character-image-matching-label { display: inline-flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; font-weight: 400; }
      #${MODAL_ID} .bb-character-image-matching-label input { margin: 0; }
      #${MODAL_ID} .bb-character-image-list { max-height: 320px; overflow: auto; border: 1px solid #ddd; }
      #${MODAL_ID} .bb-character-image-row { display: grid; grid-template-columns: 72px minmax(140px, 1fr) minmax(220px, 1.5fr); gap: 12px; padding: 8px 10px; border-bottom: 1px solid #eee; align-items: center; }
      #${MODAL_ID} .bb-character-image-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-character-image-name { font-weight: 600; }
      #${MODAL_ID} .bb-character-image-file { color: #337ab7; word-break: break-all; }
      #${MODAL_ID} .bb-character-image-empty { color: #999; }
      #${MODAL_ID} .bb-character-image-status { min-height: 24px; margin-top: 10px; color: #337ab7; white-space: pre-wrap; }
      #${MODAL_ID} .bb-character-image-error { color: #c0392b; }
      #${MODAL_ID} .bb-character-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      [${SELECT_CELL_ATTRIBUTE}] { width: 42px; padding-left: 8px !important; padding-right: 8px !important; text-align: center; }
      [${SELECT_ATTRIBUTE}], [${SELECT_ALL_ATTRIBUTE}] { width: 16px; height: 16px; margin: 0; cursor: pointer; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTable() {
    return Array.from(document.querySelectorAll('table')).find(table =>
      table.querySelector('tbody tr[data-key]') && table.querySelector('td.column-nickname')
    ) || null;
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/characters/create"]')).find(link =>
      /添加角色/.test(normalize(link.textContent))
    ) || null;
  }

  function getCharacters(table, selectedOnly = false) {
    return Array.from(table.querySelectorAll('tbody tr[data-key]')).map(row => {
      const editLink = Array.from(row.querySelectorAll('a[href*="/playbook/characters/"]')).find(link =>
        /编辑角色/.test(normalize(link.textContent)) || /\/edit(?:\?|$)/.test(link.getAttribute('href') || '')
      );
      return {
        id: row.dataset.key || '',
        name: normalize(row.querySelector('td.column-nickname')?.textContent),
        editUrl: editLink?.href || '',
        selected: Boolean(row.querySelector(`input[${SELECT_ATTRIBUTE}]`)?.checked),
      };
    }).filter(character => character.id && character.name && character.editUrl
      && (!selectedOnly || character.selected));
  }

  function getNicknameHeader(table) {
    const headerRow = table.tHead?.rows[0] || table.querySelector('thead tr');
    if (!headerRow) return null;
    return Array.from(headerRow.querySelectorAll('th')).find(cell =>
      cell.classList.contains('column-nickname') || normalize(cell.textContent) === '昵称'
    ) || null;
  }

  function updateSelectAllState(table) {
    const selectAll = table.querySelector(`input[${SELECT_ALL_ATTRIBUTE}]`);
    if (!selectAll) return;
    const checkboxes = Array.from(table.querySelectorAll(`tbody tr[data-key] input[${SELECT_ATTRIBUTE}]`));
    const checkedCount = checkboxes.filter(input => input.checked).length;
    selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
  }

  function addSelectionControls(table) {
    const nicknameHeader = getNicknameHeader(table);
    if (nicknameHeader && !nicknameHeader.parentElement.querySelector(`th[${SELECT_CELL_ATTRIBUTE}]`)) {
      const headerCell = document.createElement('th');
      headerCell.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
      const selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute(SELECT_ALL_ATTRIBUTE, 'true');
      selectAll.title = '全选当前列表';
      selectAll.addEventListener('change', () => {
        const checked = selectAll.checked;
        table.querySelectorAll('tbody tr[data-key]').forEach(row => {
          const input = row.querySelector(`input[${SELECT_ATTRIBUTE}]`);
          if (!input) return;
          input.checked = checked;
          if (checked) selectedCharacterIds.add(row.dataset.key || '');
          else selectedCharacterIds.delete(row.dataset.key || '');
        });
        updateSelectAllState(table);
      });
      headerCell.appendChild(selectAll);
      nicknameHeader.parentElement.insertBefore(headerCell, nicknameHeader);
    }

    table.querySelectorAll('tbody tr[data-key]').forEach(row => {
      const nicknameCell = row.querySelector('td.column-nickname');
      if (!nicknameCell) return;
      let cell = row.querySelector(`td[${SELECT_CELL_ATTRIBUTE}]`);
      let input = cell?.querySelector(`input[${SELECT_ATTRIBUTE}]`);
      if (!cell) {
        cell = document.createElement('td');
        cell.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
        input = document.createElement('input');
        input.type = 'checkbox';
        input.setAttribute(SELECT_ATTRIBUTE, 'true');
        input.title = '选择此角色';
        input.addEventListener('change', () => {
          const id = row.dataset.key || '';
          if (input.checked) selectedCharacterIds.add(id);
          else selectedCharacterIds.delete(id);
          updateSelectAllState(table);
        });
        cell.appendChild(input);
        row.insertBefore(cell, nicknameCell);
      }
      if (input) input.checked = selectedCharacterIds.has(row.dataset.key || '');
    });
    updateSelectAllState(table);
  }

  function getFileStem(file) {
    return normalize(file?.name).replace(/\.[^.]+$/, '');
  }

  function buildAssignments(characters, files, mode = 'order') {
    if (!files.length) return { assignments: [], error: '请选择角色主图。' };
    if (files.length !== characters.length) {
      return { assignments: [], error: `当前列表有 ${characters.length} 个角色，请选择正好 ${characters.length} 张图片。` };
    }
    if (mode === 'name') {
      const characterNames = new Set();
      const duplicateCharacterNames = new Set();
      characters.forEach(character => {
        const name = normalize(character.name);
        if (characterNames.has(name)) duplicateCharacterNames.add(name);
        characterNames.add(name);
      });
      if (duplicateCharacterNames.size) {
        return { assignments: [], error: `按文件名称匹配失败：角色昵称重复，无法唯一匹配：${Array.from(duplicateCharacterNames).join('、')}` };
      }

      // 文件名只要求以角色昵称开头，后面的风格、版本号等后缀全部忽略。
      // 若角色名互为前缀（例如“阿青”和“阿青山”），优先使用更长的角色名匹配。
      const charactersByLength = [...characters].sort((left, right) =>
        normalize(right.name).length - normalize(left.name).length
      );
      const filesByCharacterId = new Map();
      const unmatchedFiles = [];
      files.forEach(file => {
        const stem = getFileStem(file);
        const character = charactersByLength.find(item => stem.startsWith(normalize(item.name)));
        if (!character) {
          unmatchedFiles.push(file.name);
          return;
        }
        const matchedFiles = filesByCharacterId.get(character.id) || [];
        matchedFiles.push(file);
        filesByCharacterId.set(character.id, matchedFiles);
      });
      if (unmatchedFiles.length) {
        return { assignments: [], error: `按文件名称匹配失败：以下文件名开头未匹配到角色：${unmatchedFiles.join('、')}` };
      }
      const duplicateMatches = characters.filter(character =>
        (filesByCharacterId.get(character.id) || []).length > 1
      );
      if (duplicateMatches.length) {
        return { assignments: [], error: `按文件名称匹配失败：以下角色匹配到了多张图片：${duplicateMatches.map(character => character.name).join('、')}` };
      }

      const missingCharacters = characters.filter(character => !filesByCharacterId.has(character.id));
      if (missingCharacters.length) {
        return { assignments: [], error: `按文件名称匹配失败：未找到对应文件：${missingCharacters.map(character => character.name).join('、')}` };
      }
      return {
        assignments: characters.map(character => ({ character, file: filesByCharacterId.get(character.id)[0] })),
        error: '',
      };
    }
    return {
      assignments: characters.map((character, index) => ({ character, file: files[index] })),
      error: '',
    };
  }

  function renderAssignments(container, characters, files, mode) {
    const result = buildAssignments(characters, files, mode);
    container.replaceChildren();
    characters.forEach(character => {
      const assignment = result.assignments.find(item => item.character.id === character.id);
      const row = document.createElement('div');
      row.className = 'bb-character-image-row';
      const id = document.createElement('span');
      id.textContent = character.id;
      const name = document.createElement('span');
      name.className = 'bb-character-image-name';
      name.textContent = character.name;
      const fileName = document.createElement('span');
      fileName.className = assignment ? 'bb-character-image-file' : 'bb-character-image-file bb-character-image-empty';
      fileName.textContent = assignment ? assignment.file.name : '尚未匹配图片';
      row.append(id, name, fileName);
      container.appendChild(row);
    });
    return result;
  }

  function findMainImageField(form) {
    const fileInputs = Array.from(form.querySelectorAll('input[type="file"][name]'));
    const mainInput = fileInputs.find(input => {
      const group = input.closest('.form-group, .form-row, .field') || input.parentElement;
      return normalize(group?.textContent).includes('主图');
    });
    return mainInput?.name || form.querySelector('input[type="file"][name="image"]')?.name || 'image';
  }

  async function uploadCharacterImage(character, file) {
    const editResponse = await fetch(character.editUrl, { credentials: 'same-origin' });
    if (!editResponse.ok) throw new Error(`读取编辑页失败：HTTP ${editResponse.status}`);
    const editDoc = new DOMParser().parseFromString(await editResponse.text(), 'text/html');
    const form = Array.from(editDoc.forms).find(item => item.method.toLowerCase() === 'post'
      && item.querySelector('[name="_method"][value="PUT"]'));
    if (!form) throw new Error('未找到角色编辑表单');
    const field = findMainImageField(form);
    const data = new FormData(form);
    data.delete(field);
    data.delete('after-save');
    data.set('_previous_', window.location.href);
    data.append(field, file, file.name);
    const action = new URL(form.getAttribute('action') || character.editUrl, character.editUrl).href;
    const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
    const html = await response.text();
    const resultDoc = new DOMParser().parseFromString(html, 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    if (!response.ok) throw new Error(errorText || `HTTP ${response.status}`);
    if (errorText) throw new Error(errorText);
    if (resultDoc.querySelector('form [name="_method"][value="PUT"]') && response.url.includes('/edit')) {
      throw new Error('后台未接受该图片');
    }
  }

  function openModal(characters) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-character-image-panel">
        <h3>批量添加角色图片</h3>
        <div class="bb-character-image-note">
          当前列表共 ${characters.length} 个角色。请选择正好 ${characters.length} 张图片；可按文件选择顺序匹配，也可按文件名称匹配（文件名去掉扩展名后，只要以角色昵称开头即可，后续文字会忽略），已有主图将被覆盖。
        </div>
        <input type="file" accept="image/*" multiple class="form-control" data-bb-character-image-files>
        <div class="bb-character-image-matching" role="radiogroup" aria-label="头像匹配方式">
          <strong>匹配方式：</strong>
          <label class="bb-character-image-matching-label"><input type="radio" name="bb-character-image-match-mode" value="order" data-bb-character-image-match-mode> 按文件顺序匹配</label>
          <label class="bb-character-image-matching-label"><input type="radio" name="bb-character-image-match-mode" value="name" data-bb-character-image-match-mode checked> 按文件名称匹配</label>
        </div>
        <div class="bb-character-image-list" data-bb-character-image-list></div>
        <div class="bb-character-image-status" data-bb-character-image-status></div>
        <div class="bb-character-image-actions">
          <button type="button" class="btn btn-default" data-bb-character-image-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-character-image-confirm disabled>确认覆盖主图</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const picker = modal.querySelector('[data-bb-character-image-files]');
    const list = modal.querySelector('[data-bb-character-image-list]');
    const status = modal.querySelector('[data-bb-character-image-status]');
    const cancel = modal.querySelector('[data-bb-character-image-cancel]');
    const confirm = modal.querySelector('[data-bb-character-image-confirm]');
    const modeInputs = Array.from(modal.querySelectorAll('[data-bb-character-image-match-mode]'));
    let assignments = [];
    const close = () => modal.remove();

    renderAssignments(list, characters, [], 'name');
    const updatePreview = () => {
      const files = Array.from(picker.files || []).filter(file => file.type.startsWith('image/'));
      const mode = modeInputs.find(input => input.checked)?.value || 'order';
      const result = renderAssignments(list, characters, files, mode);
      assignments = result.assignments;
      status.className = result.error ? 'bb-character-image-status bb-character-image-error' : 'bb-character-image-status';
      status.textContent = result.error;
      confirm.disabled = Boolean(result.error);
      confirm.textContent = assignments.length ? `确认覆盖 ${assignments.length} 个角色主图` : '确认覆盖主图';
    };
    picker.addEventListener('change', updatePreview);
    modeInputs.forEach(input => input.addEventListener('change', updatePreview));
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (Number(confirm.dataset.completed) > 0) window.location.reload();
        else close();
        return;
      }
      if (!assignments.length || confirm.disabled) return;
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      status.className = 'bb-character-image-status';
      let completed = 0;
      const failures = [];
      for (const { character, file } of assignments) {
        status.textContent = `正在覆盖 ${completed + failures.length + 1}/${assignments.length}：${character.name} ← ${file.name}`;
        try {
          await uploadCharacterImage(character, file);
          completed += 1;
        } catch (error) {
          failures.push(`${character.name}：${error.message || '上传失败'}`);
        }
      }
      status.className = failures.length ? 'bb-character-image-status bb-character-image-error' : 'bb-character-image-status';
      status.textContent = `已成功覆盖 ${completed}/${assignments.length} 个角色主图。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
      confirm.textContent = completed ? '完成并刷新列表' : '关闭';
      cancel.style.display = 'none';
    });
  }

  function addButton() {
    if (!isCharacterList()) return;
    addStyles();
    const table = getTable();
    if (table) addSelectionControls(table);
    if (document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '批量添加角色图片';
    button.addEventListener('click', event => {
      event.preventDefault();
      const currentTable = getTable();
      const characters = currentTable ? getCharacters(currentTable, true) : [];
      if (!characters.length) {
        window.alert('请先勾选需要批量上传头像的角色');
        return;
      }
      openModal(characters);
    });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(addButton, 150);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();

// 新建地点表单默认热区坐标：只填充空字段，不影响用户已有输入。
(() => {
  'use strict';

  const DEFAULT_HOT_POSITION = '1088\n1419\n160\n100';
  const isPlaceCreatePage = () => /\/playbook\/places\/create\/?$/.test(location.pathname);
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function findHotPositionField(form) {
    const groups = Array.from(form.querySelectorAll('.form-group, .form-row, .field, .row'));
    const group = groups.find(item => normalize(item.firstElementChild?.textContent) === '热区位置'
      || normalize(item.textContent).startsWith('热区位置'));
    return group?.querySelector('textarea, input')
      || form.querySelector('textarea[name*="hot"], input[name*="hot"]')
      || null;
  }

  function applyDefault() {
    if (!isPlaceCreatePage()) return;
    document.querySelectorAll('form').forEach(form => {
      const field = findHotPositionField(form);
      if (!field || String(field.value || '').trim()) return;
      field.value = DEFAULT_HOT_POSITION;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  let timer = null;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(applyDefault, 120);
  };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  applyDefault();
})();

// 地点批量创建：选择地图后，按名称逐条复用原生地点创建表单提交。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-quick-add-places';
  const MODAL_ID = 'bb-quick-add-places-modal';
  const STYLE_ID = 'bb-quick-add-places-style';
  const DEFAULT_HOT_POSITION = '1088\n1419\n160\n100';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isPlaceList = () => /\/playbook\/places\/?$/.test(location.pathname)
    && Boolean(new URL(location.href).searchParams.get('playbook_id'));

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-left: 8px; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.44); }
      #${MODAL_ID} .bb-quick-place-dialog { width: min(660px, calc(100vw - 36px)); max-height: calc(100vh - 48px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-quick-place-hint { margin-bottom: 14px; color: #687786; line-height: 1.65; }
      #${MODAL_ID} label { display: block; margin: 12px 0 6px; color: #3c4b5a; font-weight: 600; }
      #${MODAL_ID} select, #${MODAL_ID} textarea { box-sizing: border-box; width: 100%; padding: 9px; border: 1px solid #ccd6df; border-radius: 4px; background: #fff; }
      #${MODAL_ID} select { min-height: 38px; }
      #${MODAL_ID} textarea { min-height: 190px; resize: vertical; }
      #${MODAL_ID} .bb-quick-place-status { min-height: 24px; margin-top: 10px; color: #587080; white-space: pre-wrap; }
      #${MODAL_ID} .bb-quick-place-error { color: #c0392b; }
      #${MODAL_ID} .bb-quick-place-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/places/create"]'))
      .find(link => /添加地点/.test(normalize(link.textContent)))
      || document.querySelector('a[href*="/playbook/places/create"]');
  }

  function getCreateUrl() {
    const link = getCreateLink();
    if (link?.href) return link.href;
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/\/places\/?$/, '/places/create');
    return url.href;
  }

  function parseNames(value) {
    const seen = new Set();
    return String(value || '')
      .split(/\r?\n|[，,；;]+/)
      .map(normalize)
      .filter(name => name && !seen.has(name) && seen.add(name));
  }

  function findPlaceForm(doc) {
    return Array.from(doc.forms).find(form => {
      try {
        return String(form.method).toLowerCase() === 'post'
          && /\/playbook\/places\/?$/.test(new URL(form.getAttribute('action') || '', location.origin).pathname)
          && form.querySelector('[name="name"]')
          && form.querySelector('[name="map_id"]');
      } catch (_) {
        return false;
      }
    }) || null;
  }

  function findMapSelect(form) {
    return form?.querySelector('select[name="map_id"]') || null;
  }

  function findHotPositionField(form) {
    const groups = Array.from(form.querySelectorAll('.form-group, .form-row, .field, .row'));
    const group = groups.find(item => normalize(item.firstElementChild?.textContent) === '热区位置'
      || normalize(item.textContent).startsWith('热区位置'));
    return group?.querySelector('textarea, input')
      || form.querySelector('textarea[name*="hot"], input[name*="hot"]')
      || null;
  }

  async function fetchCreateForm(createUrl) {
    const response = await fetch(createUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取地点创建页失败：HTTP ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = findPlaceForm(doc);
    if (!form) throw new Error('没有识别到地点创建表单');
    const mapSelect = findMapSelect(form);
    if (!mapSelect) throw new Error('没有识别到地图下拉框');
    const maps = Array.from(mapSelect.options)
      .map(option => ({ id: String(option.value || ''), name: normalize(option.textContent) }))
      .filter(map => map.id && map.id !== '0' && map.name);
    if (!maps.length) throw new Error('地图列表为空');
    return { doc, form, maps };
  }

  async function createPlace(createUrl, placeName, mapId) {
    const { form } = await fetchCreateForm(createUrl);
    const data = new FormData(form);
    const playbookId = new URL(createUrl).searchParams.get('playbook_id') || '';
    data.set('playbook_id', playbookId);
    data.set('name', placeName);
    data.set('map_id', String(mapId));
    const hotPositionField = findHotPositionField(form);
    if (hotPositionField?.name && !String(hotPositionField.value || '').trim()) {
      data.set(hotPositionField.name, DEFAULT_HOT_POSITION);
    }
    data.set('_previous_', window.location.href);
    const action = new URL(form.getAttribute('action') || createUrl, createUrl);
    const response = await fetch(action.href, { method: 'POST', body: data, credentials: 'same-origin' });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`添加“${placeName}”失败：HTTP ${response.status}`);
    const resultDoc = new DOMParser().parseFromString(responseText, 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .callout-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    if (errorText) throw new Error(errorText);
    if (/\/playbook\/places\/create\/?$/.test(new URL(response.url).pathname)) {
      throw new Error(`后台未接受“${placeName}”`);
    }
  }

  function openModal(createUrl) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-quick-place-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-quick-place-title">
        <h3 id="bb-quick-place-title">批量添加地点</h3>
        <div class="bb-quick-place-hint">先选择地图，下面输入地点名称列表。每行一个地点，也可以使用逗号或分号分隔；提交后会将每个地点创建到所选地图中，其他字段沿用后台默认值。</div>
        <label for="bb-quick-place-map">选择地图</label>
        <select id="bb-quick-place-map" data-bb-quick-place-map disabled>
          <option value="">正在读取地图列表…</option>
        </select>
        <label for="bb-quick-place-names">地点名称</label>
        <textarea id="bb-quick-place-names" data-bb-quick-place-names placeholder="例如：\n实验室\n地下室\n储物间"></textarea>
        <div class="bb-quick-place-status" data-bb-quick-place-status>正在读取地图列表…</div>
        <div class="bb-quick-place-actions">
          <button type="button" class="btn btn-default" data-bb-quick-place-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-quick-place-confirm disabled>确认添加</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const mapSelect = modal.querySelector('[data-bb-quick-place-map]');
    const namesInput = modal.querySelector('[data-bb-quick-place-names]');
    const status = modal.querySelector('[data-bb-quick-place-status]');
    const cancel = modal.querySelector('[data-bb-quick-place-cancel]');
    const confirm = modal.querySelector('[data-bb-quick-place-confirm]');
    let completed = 0;
    const close = () => {
      modal.remove();
      if (completed) window.location.reload();
    };
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });

    fetchCreateForm(createUrl).then(({ maps }) => {
      if (!modal.isConnected) return;
      mapSelect.replaceChildren(new Option('请选择地图', ''), ...maps.map(map => new Option(map.name, map.id)));
      mapSelect.disabled = false;
      status.textContent = '请选择地图并输入地点名称。';
      const refreshConfirmState = () => {
        confirm.disabled = !mapSelect.value || !parseNames(namesInput.value).length || confirm.dataset.finished === 'true';
      };
      mapSelect.addEventListener('change', refreshConfirmState);
      namesInput.addEventListener('input', refreshConfirmState);
      refreshConfirmState();
    }).catch(error => {
      mapSelect.replaceChildren(new Option('地图列表读取失败', ''));
      status.className = 'bb-quick-place-status bb-quick-place-error';
      status.textContent = error.message || String(error);
    });

    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        close();
        return;
      }
      const names = parseNames(namesInput.value);
      const map = mapSelect.options[mapSelect.selectedIndex];
      if (!mapSelect.value || !names.length || !map) {
        status.className = 'bb-quick-place-status bb-quick-place-error';
        status.textContent = '请选择地图并至少输入一个地点名称。';
        return;
      }
      confirm.disabled = true;
      cancel.disabled = true;
      mapSelect.disabled = true;
      namesInput.disabled = true;
      status.className = 'bb-quick-place-status';
      const failures = [];
      for (let index = 0; index < names.length; index += 1) {
        status.textContent = `正在添加 ${index + 1}/${names.length}：${names[index]} → ${map.textContent}`;
        try {
          await createPlace(createUrl, names[index], map.value);
          completed += 1;
        } catch (error) {
          failures.push(`${names[index]}：${error.message || '添加失败'}`);
        }
      }
      status.className = failures.length
        ? 'bb-quick-place-status bb-quick-place-error'
        : 'bb-quick-place-status';
      status.textContent = `已成功添加 ${completed}/${names.length} 个地点到“${map.textContent}”。${failures.length ? `\n失败：\n${failures.join('\n')}` : ''}`;
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.textContent = completed ? '完成并刷新' : '关闭';
      cancel.disabled = false;
      cancel.textContent = completed ? '关闭并刷新' : '取消';
    });
    namesInput.focus();
  }

  function update() {
    if (!isPlaceList() || document.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
    const createLink = getCreateLink();
    if (!createLink) return;
    addStyles();
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-sm btn-info';
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.textContent = '批量添加地点';
    button.addEventListener('click', event => {
      event.preventDefault();
      openModal(getCreateUrl());
    });
    createLink.insertAdjacentElement('afterend', button);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 160);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(update, 800);
  update();
})();

// 地点图片批量上传：先勾选地点，再批量更新指示图或私聊场景图。
(() => {
  'use strict';

  const SELECT_HEADER_ATTRIBUTE = 'data-bb-place-image-select-header';
  const SELECT_CELL_ATTRIBUTE = 'data-bb-place-image-select-cell';
  const SELECT_INPUT_ATTRIBUTE = 'data-bb-place-image-select';
  const MODAL_ID = 'bb-place-image-batch-modal';
  const STYLE_ID = 'bb-place-image-batch-style';
  const COUNTER_ID = 'bb-place-image-selected-count';
  const buttonConfigs = {
    indicator: {
      attribute: 'data-bb-place-indicator-batch-button',
      label: '快捷添加指示图',
      title: '批量添加指示图',
      field: 'indicator',
    },
    image: {
      attribute: 'data-bb-place-private-image-batch-button',
      label: '快捷添加私聊场景图',
      title: '批量添加私聊场景图',
      field: 'image',
    },
  };
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isPlaceList = () => /\/playbook\/places\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${SELECT_HEADER_ATTRIBUTE}], td[${SELECT_CELL_ATTRIBUTE}] { width: 48px !important; min-width: 48px !important; text-align: center !important; vertical-align: middle !important; }
      a[data-bb-place-indicator-batch-button], a[data-bb-place-private-image-batch-button] { margin-left: 8px; }
      #${COUNTER_ID} { display: inline-block; margin-left: 10px; color: #777; vertical-align: middle; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 18px 24px 18px 18px; box-sizing: border-box; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-place-image-panel { width: min(760px, calc(100vw - 42px)); max-height: calc(100vh - 36px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
      @media (max-width: 820px) {
        #${MODAL_ID} { justify-content: center; padding: 18px; }
        #${MODAL_ID} .bb-place-image-panel { width: min(760px, calc(100vw - 36px)); max-height: calc(100vh - 36px); }
      }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-place-image-note { color: #687786; line-height: 1.7; }
      #${MODAL_ID} input[type="file"] { margin: 12px 0; }
      #${MODAL_ID} .bb-place-image-list { max-height: calc(100vh - 300px); overflow: auto; border: 1px solid #ddd; }
      #${MODAL_ID} .bb-place-image-row { display: grid; grid-template-columns: 70px minmax(150px, 1fr) minmax(220px, 1.5fr); gap: 12px; padding: 8px 10px; border-bottom: 1px solid #eee; align-items: center; }
      #${MODAL_ID} .bb-place-image-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-place-image-name { font-weight: 600; }
      #${MODAL_ID} .bb-place-image-file { color: #337ab7; word-break: break-all; }
      #${MODAL_ID} .bb-place-image-empty { color: #999; }
      #${MODAL_ID} .bb-place-image-status { min-height: 24px; margin-top: 10px; color: #337ab7; white-space: pre-wrap; }
      #${MODAL_ID} .bb-place-image-error { color: #c0392b; }
      #${MODAL_ID} .bb-place-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTable() {
    return Array.from(document.querySelectorAll('table')).find(table =>
      table.querySelector('tbody tr[data-key]') && table.querySelector('td.column-name')
    ) || null;
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/places/create"]')).find(link =>
      /添加地点/.test(normalize(link.textContent))
    ) || null;
  }

  function updateCounter() {
    const count = document.querySelectorAll(`input[${SELECT_INPUT_ATTRIBUTE}]:checked`).length;
    const counter = document.getElementById(COUNTER_ID);
    if (counter) counter.textContent = `已选 ${count} 个地点`;
    const master = document.querySelector(`th[${SELECT_HEADER_ATTRIBUTE}] input[type="checkbox"]`);
    const boxes = Array.from(document.querySelectorAll(`input[${SELECT_INPUT_ATTRIBUTE}]`));
    if (master) {
      master.checked = boxes.length > 0 && boxes.every(box => box.checked);
      master.indeterminate = boxes.some(box => box.checked) && !master.checked;
    }
  }

  function ensureSelectionColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    let header = headerRow.querySelector(`th[${SELECT_HEADER_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(SELECT_HEADER_ATTRIBUTE, 'true');
      const master = document.createElement('input');
      master.type = 'checkbox';
      master.title = '全选/取消全选';
      master.addEventListener('change', () => {
        table.querySelectorAll(`input[${SELECT_INPUT_ATTRIBUTE}]`).forEach(box => { box.checked = master.checked; });
        updateCounter();
      });
      header.appendChild(master);
      headerRow.insertBefore(header, headerRow.firstElementChild);
    }

    table.querySelectorAll('tbody tr[data-key]').forEach(row => {
      let cell = row.querySelector(`td[${SELECT_CELL_ATTRIBUTE}]`);
      if (cell) return;
      cell = document.createElement('td');
      cell.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.setAttribute(SELECT_INPUT_ATTRIBUTE, 'true');
      box.value = row.dataset.key || '';
      box.addEventListener('change', updateCounter);
      cell.appendChild(box);
      row.insertBefore(cell, row.firstElementChild);
    });
    updateCounter();
  }

  function getSelectedPlaces(table) {
    return Array.from(table.querySelectorAll(`tbody input[${SELECT_INPUT_ATTRIBUTE}]:checked`)).map(box => {
      const row = box.closest('tr');
      const editLink = row?.querySelector('a[href*="/playbook/places/"][href*="/edit"]');
      return {
        id: row?.dataset.key || box.value,
        name: normalize(row?.querySelector('td.column-name')?.textContent),
        editUrl: editLink?.href || '',
      };
    }).filter(place => place.id && place.name && place.editUrl);
  }

  function fileBaseName(file) {
    return normalize(file.name.replace(/\.[^.]+$/, ''));
  }

  function buildAssignments(places, files) {
    if (!files.length) return { assignments: [], error: '请选择至少一张图片。' };
    if (files.length === 1) {
      return { assignments: places.map(place => ({ place, file: files[0] })), error: '' };
    }
    if (files.length !== places.length) {
      return { assignments: [], error: `已选择 ${places.length} 个地点，请选择 1 张图片或正好 ${places.length} 张图片。` };
    }

    const remainingFiles = [...files];
    const byName = places.map(place => {
      const index = remainingFiles.findIndex(file => fileBaseName(file) === place.name);
      if (index < 0) return null;
      return { place, file: remainingFiles.splice(index, 1)[0] };
    });
    if (byName.every(Boolean) && !remainingFiles.length) return { assignments: byName, error: '' };
    return { assignments: places.map((place, index) => ({ place, file: files[index] })), error: '' };
  }

  function renderAssignments(container, places, files) {
    const result = buildAssignments(places, files);
    container.replaceChildren();
    const assignments = result.assignments.length ? result.assignments : places.map(place => ({ place, file: null }));
    assignments.forEach(({ place, file }) => {
      const row = document.createElement('div');
      row.className = 'bb-place-image-row';
      const id = document.createElement('span');
      id.textContent = place.id;
      const name = document.createElement('span');
      name.className = 'bb-place-image-name';
      name.textContent = place.name;
      const fileName = document.createElement('span');
      fileName.className = file ? 'bb-place-image-file' : 'bb-place-image-file bb-place-image-empty';
      fileName.textContent = file ? file.name : '尚未匹配图片';
      row.append(id, name, fileName);
      container.appendChild(row);
    });
    return result;
  }

  async function uploadPlaceImage(place, file, field) {
    const editResponse = await fetch(place.editUrl, { credentials: 'same-origin' });
    if (!editResponse.ok) throw new Error(`读取编辑页失败：HTTP ${editResponse.status}`);
    const editDoc = new DOMParser().parseFromString(await editResponse.text(), 'text/html');
    const form = Array.from(editDoc.forms).find(item => item.method.toLowerCase() === 'post'
      && item.querySelector('[name="_method"][value="PUT"]') && item.querySelector(`[name="${field}"]`));
    if (!form) throw new Error('未找到地点编辑表单');
    const data = new FormData(form);
    ['image', 'indicator', 'indicator_click', 'open_sound'].forEach(name => data.delete(name));
    data.delete('after-save');
    data.set('_previous_', window.location.href);
    data.append(field, file, file.name);
    const action = new URL(form.getAttribute('action') || place.editUrl, place.editUrl).href;
    const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const resultDoc = new DOMParser().parseFromString(html, 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    const stillOnEditPage = Boolean(resultDoc.querySelector('form [name="_method"][value="PUT"]'));
    if (errorText || stillOnEditPage) throw new Error(errorText || '后台未接受该图片');
  }

  function openModal(config, places) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-place-image-panel">
        <h3>${config.title}</h3>
        <div class="bb-place-image-note">
          已选择 ${places.length} 个地点。选择 1 张图片会应用到全部地点；选择 ${places.length} 张图片时，优先按“文件名＝地点名称”匹配，否则按下面的地点顺序配对。
        </div>
        <input type="file" accept="image/*" multiple class="form-control" data-bb-place-image-files>
        <div class="bb-place-image-list" data-bb-place-image-list></div>
        <div class="bb-place-image-status" data-bb-place-image-status></div>
        <div class="bb-place-image-actions">
          <button type="button" class="btn btn-default" data-bb-place-image-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-place-image-confirm disabled>确认上传</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const picker = modal.querySelector('[data-bb-place-image-files]');
    const list = modal.querySelector('[data-bb-place-image-list]');
    const status = modal.querySelector('[data-bb-place-image-status]');
    const cancel = modal.querySelector('[data-bb-place-image-cancel]');
    const confirm = modal.querySelector('[data-bb-place-image-confirm]');
    let files = [];
    let assignments = [];
    const close = () => modal.remove();
    renderAssignments(list, places, files);
    picker.addEventListener('change', () => {
      files = Array.from(picker.files || []).filter(file => file.type.startsWith('image/'));
      const result = renderAssignments(list, places, files);
      assignments = result.assignments;
      status.className = result.error ? 'bb-place-image-status bb-place-image-error' : 'bb-place-image-status';
      status.textContent = result.error;
      confirm.disabled = Boolean(result.error);
      confirm.textContent = assignments.length ? `确认上传 ${assignments.length} 个地点` : '确认上传';
    });
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (Number(confirm.dataset.completed) > 0) window.location.reload();
        else close();
        return;
      }
      if (!assignments.length || confirm.disabled) return;
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      status.className = 'bb-place-image-status';
      let completed = 0;
      const failures = [];
      for (const { place, file } of assignments) {
        status.textContent = `正在上传 ${completed + failures.length + 1}/${assignments.length}：${place.name} ← ${file.name}`;
        try {
          await uploadPlaceImage(place, file, config.field);
          completed += 1;
        } catch (error) {
          failures.push(`${place.name}：${error.message || '上传失败'}`);
        }
      }
      status.className = failures.length ? 'bb-place-image-status bb-place-image-error' : 'bb-place-image-status';
      status.textContent = `已上传 ${completed}/${assignments.length} 个地点。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
      confirm.textContent = completed ? '完成并刷新列表' : '关闭';
      cancel.style.display = 'none';
    });
  }

  function addButtons(createLink, table) {
    let anchor = createLink;
    Object.values(buttonConfigs).forEach(config => {
      let button = document.querySelector(`a[${config.attribute}]`);
      if (!button) {
        button = document.createElement('a');
        button.href = '#';
        button.className = config.field === 'indicator' ? 'btn btn-info' : 'btn btn-success';
        button.setAttribute(config.attribute, 'true');
        button.textContent = config.label;
        button.addEventListener('click', event => {
          event.preventDefault();
          const currentTable = getTable();
          const places = currentTable ? getSelectedPlaces(currentTable) : [];
          if (!places.length) {
            window.alert('请先在地点列表中勾选至少一个地点');
            return;
          }
          openModal(config, places);
        });
        anchor.insertAdjacentElement('afterend', button);
      }
      anchor = button;
    });
    let counter = document.getElementById(COUNTER_ID);
    if (!counter) {
      counter = document.createElement('span');
      counter.id = COUNTER_ID;
      anchor.insertAdjacentElement('afterend', counter);
    }
    updateCounter();
  }

  function update() {
    if (!isPlaceList()) return;
    const table = getTable();
    const createLink = getCreateLink();
    if (!table || !createLink) return;
    addStyles();
    ensureSelectionColumn(table);
    addButtons(createLink, table);
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 150);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 线索主图批量上传：直接按图片文件名前缀中的线索 ID 匹配当前列表并覆盖主图。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-clue-image-batch-button';
  const SELECT_ATTRIBUTE = 'data-bb-clue-image-select';
  const SELECT_BOUND_ATTRIBUTE = 'data-bb-clue-image-select-bound';
  const SELECT_ALL_ATTRIBUTE = 'data-bb-clue-image-select-all';
  const SELECT_CELL_ATTRIBUTE = 'data-bb-clue-image-select-cell';
  const MODAL_ID = 'bb-clue-image-batch-modal';
  const STYLE_ID = 'bb-clue-image-batch-style';
  const COUNTER_ID = 'bb-clue-image-selected-count';
  let updateTimer = null;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isClueList = () => /\/playbook\/clues\/?$/.test(location.pathname);

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      th[${SELECT_CELL_ATTRIBUTE}], td[${SELECT_CELL_ATTRIBUTE}] { width: 48px !important; min-width: 48px !important; padding-left: 8px !important; padding-right: 8px !important; text-align: center !important; vertical-align: middle !important; }
      a[${BUTTON_ATTRIBUTE}] { margin-left: 8px; }
      #${COUNTER_ID} { display: inline-block; margin-left: 10px; color: #777; vertical-align: middle; }
      #${MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 18px 24px 18px 18px; box-sizing: border-box; background: rgba(0,0,0,.45); }
      #${MODAL_ID} .bb-clue-image-panel { width: min(760px, calc(100vw - 42px)); max-height: calc(100vh - 36px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
      @media (max-width: 820px) {
        #${MODAL_ID} { justify-content: center; padding: 18px; }
        #${MODAL_ID} .bb-clue-image-panel { width: min(760px, calc(100vw - 36px)); max-height: calc(100vh - 36px); }
      }
      #${MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${MODAL_ID} .bb-clue-image-note { color: #687786; line-height: 1.7; }
      #${MODAL_ID} input[type="file"] { margin: 12px 0; }
      #${MODAL_ID} .bb-clue-image-list { max-height: calc(100vh - 300px); overflow: auto; border: 1px solid #ddd; }
      #${MODAL_ID} .bb-clue-image-row { display: grid; grid-template-columns: 72px minmax(150px, 1fr) minmax(220px, 1.5fr); gap: 12px; padding: 8px 10px; border-bottom: 1px solid #eee; align-items: center; }
      #${MODAL_ID} .bb-clue-image-row:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-clue-image-name { font-weight: 600; }
      #${MODAL_ID} .bb-clue-image-file { color: #337ab7; word-break: break-all; }
      #${MODAL_ID} .bb-clue-image-empty { color: #999; }
      #${MODAL_ID} .bb-clue-image-row.bb-clue-image-empty { grid-template-columns: 1fr; }
      #${MODAL_ID} .bb-clue-image-status { min-height: 24px; margin-top: 10px; color: #337ab7; white-space: pre-wrap; }
      #${MODAL_ID} .bb-clue-image-error { color: #c0392b; }
      #${MODAL_ID} .bb-clue-image-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTable() {
    return Array.from(document.querySelectorAll('table')).find(table => {
      const headerText = normalize(table.querySelector('thead')?.textContent);
      return table.querySelector('tbody tr[data-key]') && /线索名/.test(headerText);
    }) || Array.from(document.querySelectorAll('table')).find(table =>
      table.querySelector('tbody tr[data-key]')
    ) || null;
  }

  function getCreateLink() {
    return Array.from(document.querySelectorAll('a[href*="/playbook/clues/create"]')).find(link =>
      /添加线索/.test(normalize(link.textContent))
    ) || document.querySelector('a[href*="/playbook/clues/create"]');
  }

  function getColumnIndex(table, patterns) {
    const headerRow = table.tHead?.rows[0] || table.querySelector('thead tr');
    if (!headerRow) return -1;
    return Array.from(headerRow.cells).findIndex(cell => patterns.some(pattern =>
      pattern.test(normalize(cell.textContent))
    ));
  }

  function getClueName(row, table) {
    const cell = row.querySelector('td.column-name')
      || row.cells[getColumnIndex(table, [/线索名/, /^名称$/])];
    return normalize(cell?.textContent);
  }

  function getRowSelectionInput(row) {
    const marked = row.querySelector(`input[${SELECT_ATTRIBUTE}]`);
    if (marked) return marked;
    return row.querySelector('input[type="checkbox"]');
  }

  function updateCounter(table) {
    const checkboxes = Array.from(table.querySelectorAll(`tbody tr[data-key] input[${SELECT_ATTRIBUTE}]`));
    const checked = checkboxes.filter(input => input.checked);
    const counter = document.getElementById(COUNTER_ID);
    if (counter) counter.textContent = `已选 ${checked.length} 条线索`;
    const selectAll = table.querySelector(`input[${SELECT_ALL_ATTRIBUTE}]`);
    if (selectAll) {
      selectAll.checked = checkboxes.length > 0 && checked.length === checkboxes.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < checkboxes.length;
    }
  }

  function ensureSelectionColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    let header = headerRow.querySelector(`th[${SELECT_CELL_ATTRIBUTE}]`);
    let selectAll = header?.querySelector(`input[${SELECT_ALL_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
      selectAll = headerRow.querySelector('input[type="checkbox"]');
      if (selectAll) {
        selectAll.setAttribute(SELECT_ALL_ATTRIBUTE, 'true');
        selectAll.remove();
        header.appendChild(selectAll);
      } else {
        selectAll = document.createElement('input');
        selectAll.type = 'checkbox';
        selectAll.setAttribute(SELECT_ALL_ATTRIBUTE, 'true');
        header.appendChild(selectAll);
      }
      headerRow.insertBefore(header, headerRow.firstElementChild);
    }
    if (!selectAll) {
      selectAll = document.createElement('input');
      selectAll.type = 'checkbox';
      selectAll.setAttribute(SELECT_ALL_ATTRIBUTE, 'true');
      header.appendChild(selectAll);
    }
    if (selectAll.getAttribute(SELECT_BOUND_ATTRIBUTE) !== 'true') {
      selectAll.setAttribute(SELECT_BOUND_ATTRIBUTE, 'true');
      selectAll.title = '全选/取消全选';
      selectAll.addEventListener('change', () => {
        table.querySelectorAll(`tbody tr[data-key] input[${SELECT_ATTRIBUTE}]`).forEach(input => {
          input.checked = selectAll.checked;
        });
        updateCounter(table);
      });
    }

    table.querySelectorAll('tbody tr[data-key]').forEach(row => {
      let cell = row.querySelector(`td[${SELECT_CELL_ATTRIBUTE}]`);
      let input = getRowSelectionInput(row);
      if (!input) {
        cell = document.createElement('td');
        cell.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
        input = document.createElement('input');
        input.type = 'checkbox';
        cell.appendChild(input);
        row.insertBefore(cell, row.firstElementChild);
      } else if (!cell) {
        cell = input.closest('td');
        if (cell) cell.setAttribute(SELECT_CELL_ATTRIBUTE, 'true');
      }
      if (!input) return;
      input.setAttribute(SELECT_ATTRIBUTE, 'true');
      if (input.getAttribute(SELECT_BOUND_ATTRIBUTE) === 'true') return;
      input.setAttribute(SELECT_BOUND_ATTRIBUTE, 'true');
      input.title = '选择此线索';
      input.addEventListener('change', () => updateCounter(table));
    });
    updateCounter(table);
  }

  function getClues(table) {
    return Array.from(table.querySelectorAll('tbody tr[data-key]')).map(row => {
      const editLink = Array.from(row.querySelectorAll('a[href*="/playbook/clues/"]')).find(link =>
        /编辑/.test(normalize(link.textContent)) || /\/edit(?:\?|$)/.test(link.getAttribute('href') || '')
      );
      return {
        id: row.dataset.key || '',
        name: getClueName(row, table),
        editUrl: editLink?.href || '',
      };
    }).filter(clue => clue.id && clue.name && clue.editUrl);
  }

  function fileBaseName(file) {
    const stem = normalize(file?.name).replace(/\.[^.]+$/, '');
    return stem.match(/^\d+/)?.[0] || '';
  }

  function buildAssignments(clues, files) {
    if (!files.length) return { assignments: [], error: '请选择线索图片。' };
    const clueMap = new Map(clues.map(clue => [String(clue.id), clue]));
    const seenIds = new Set();
    const duplicateIds = new Set();
    const invalidNames = [];
    const unknownIds = new Set();
    const assignments = [];
    files.forEach(file => {
      const id = fileBaseName(file);
      if (!id) {
        invalidNames.push(file.name);
        return;
      }
      if (seenIds.has(id)) {
        duplicateIds.add(id);
        return;
      }
      seenIds.add(id);
      const clue = clueMap.get(id);
      if (!clue) {
        unknownIds.add(id);
        return;
      }
      assignments.push({ clue, file });
    });
    const errors = [];
    if (invalidNames.length) errors.push(`这些文件名不是以线索 ID 开头：${invalidNames.join('、')}`);
    if (duplicateIds.size) errors.push(`文件名对应的线索 ID 重复：${Array.from(duplicateIds).join('、')}`);
    if (unknownIds.size) errors.push(`当前列表中未找到这些线索 ID：${Array.from(unknownIds).join('、')}`);
    return {
      assignments,
      error: errors.join('\n'),
    };
  }

  function renderAssignments(container, clues, files) {
    const result = buildAssignments(clues, files);
    container.replaceChildren();
    const rows = result.assignments;
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'bb-clue-image-row bb-clue-image-empty';
      empty.textContent = '选择图片后，将在这里显示按 ID 自动匹配的线索。';
      container.appendChild(empty);
    }
    rows.forEach(({ clue, file }) => {
      const row = document.createElement('div');
      row.className = 'bb-clue-image-row';
      const id = document.createElement('span');
      id.textContent = clue.id;
      const name = document.createElement('span');
      name.className = 'bb-clue-image-name';
      name.textContent = clue.name;
      const fileName = document.createElement('span');
      fileName.className = file ? 'bb-clue-image-file' : 'bb-clue-image-file bb-clue-image-empty';
      fileName.textContent = file ? file.name : '尚未匹配图片';
      row.append(id, name, fileName);
      container.appendChild(row);
    });
    return result;
  }

  function findMainImageField(form) {
    const fileInputs = Array.from(form.querySelectorAll('input[type="file"][name]'));
    const mainInput = fileInputs.find(input => {
      const group = input.closest('.form-group, .form-row, .field') || input.parentElement;
      const label = normalize(group?.textContent);
      return label.includes('主图') || label.includes('配图');
    });
    return mainInput?.name || form.querySelector('input[type="file"][name="image"]')?.name || 'image';
  }

  async function uploadClueImage(clue, file) {
    const editResponse = await fetch(clue.editUrl, { credentials: 'same-origin' });
    if (!editResponse.ok) throw new Error(`读取编辑页失败：HTTP ${editResponse.status}`);
    const editDoc = new DOMParser().parseFromString(await editResponse.text(), 'text/html');
    const form = Array.from(editDoc.forms).find(item => item.method.toLowerCase() === 'post'
      && item.querySelector('[name="_method"][value="PUT"]'));
    if (!form) throw new Error('未找到线索编辑表单');
    const field = findMainImageField(form);
    const data = new FormData(form);
    data.delete(field);
    data.delete('after-save');
    data.set('_previous_', window.location.href);
    data.append(field, file, file.name);
    const action = new URL(form.getAttribute('action') || clue.editUrl, clue.editUrl).href;
    const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
    const html = await response.text();
    const resultDoc = new DOMParser().parseFromString(html, 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    if (!response.ok) throw new Error(errorText || `HTTP ${response.status}`);
    if (errorText) throw new Error(errorText);
    if (resultDoc.querySelector('form [name="_method"][value="PUT"]') && response.url.includes('/edit')) {
      throw new Error('后台未接受该图片');
    }
  }

  function openModal(clues) {
    document.getElementById(MODAL_ID)?.remove();
    addStyles();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-clue-image-panel">
        <h3>批量上传线索图片</h3>
        <div class="bb-clue-image-note">
          无需勾选线索，直接选择图片即可。文件名开头的数字作为线索 ID（例如 2924_替换人物.jpg 匹配线索 2924），后面的内容会忽略；系统将在当前列表的 ${clues.length} 条线索中自动匹配，已有主图将被覆盖。
        </div>
        <input type="file" accept="image/*" multiple class="form-control" data-bb-clue-image-files>
        <div class="bb-clue-image-list" data-bb-clue-image-list></div>
        <div class="bb-clue-image-status" data-bb-clue-image-status></div>
        <div class="bb-clue-image-actions">
          <button type="button" class="btn btn-default" data-bb-clue-image-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-clue-image-confirm disabled>确认覆盖主图</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const picker = modal.querySelector('[data-bb-clue-image-files]');
    const list = modal.querySelector('[data-bb-clue-image-list]');
    const status = modal.querySelector('[data-bb-clue-image-status]');
    const cancel = modal.querySelector('[data-bb-clue-image-cancel]');
    const confirm = modal.querySelector('[data-bb-clue-image-confirm]');
    let files = [];
    let assignments = [];
    const close = () => modal.remove();
    renderAssignments(list, clues, files);
    picker.addEventListener('change', () => {
      files = Array.from(picker.files || []).filter(file =>
        file.type.startsWith('image/') || /\.(?:jpe?g|png|gif|webp|bmp|avif)$/i.test(file.name)
      );
      const result = renderAssignments(list, clues, files);
      assignments = result.assignments;
      status.className = result.error ? 'bb-clue-image-status bb-clue-image-error' : 'bb-clue-image-status';
      status.textContent = result.error;
      confirm.disabled = Boolean(result.error);
      confirm.textContent = assignments.length ? `确认覆盖 ${assignments.length} 条线索主图` : '确认覆盖主图';
    });
    cancel.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) close(); });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        if (Number(confirm.dataset.completed) > 0) window.location.reload();
        else close();
        return;
      }
      if (!assignments.length || confirm.disabled) return;
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      status.className = 'bb-clue-image-status';
      let completed = 0;
      const failures = [];
      for (const { clue, file } of assignments) {
        status.textContent = `正在覆盖 ${completed + failures.length + 1}/${assignments.length}：${clue.id} ← ${file.name}`;
        try {
          await uploadClueImage(clue, file);
          completed += 1;
        } catch (error) {
          failures.push(`${clue.id}：${error.message || '上传失败'}`);
        }
      }
      status.className = failures.length ? 'bb-clue-image-status bb-clue-image-error' : 'bb-clue-image-status';
      status.textContent = `已成功覆盖 ${completed}/${assignments.length} 条线索主图。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.dataset.completed = String(completed);
      confirm.textContent = completed ? '完成并刷新列表' : '关闭';
      cancel.style.display = 'none';
    });
  }

  function addButton() {
    if (!isClueList()) return;
    addStyles();
    const table = getTable();
    let button = document.querySelector(`a[${BUTTON_ATTRIBUTE}]`);
    if (!button) {
      const createLink = getCreateLink();
      if (!createLink) return;
      button = document.createElement('a');
      button.href = '#';
      button.className = 'btn btn-success';
      button.setAttribute(BUTTON_ATTRIBUTE, 'true');
      button.textContent = '批量上传线索图片';
      button.addEventListener('click', event => {
        event.preventDefault();
        const currentTable = getTable();
        const clues = currentTable ? getClues(currentTable) : [];
        if (!clues.length) {
          window.alert('当前线索列表中没有可匹配的数据');
          return;
        }
        openModal(clues);
      });
      createLink.insertAdjacentElement('afterend', button);
    }
    document.getElementById(COUNTER_ID)?.remove();
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(addButton, 150);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  addButton();
})();

// 地点列表增强：此模块只会在 /playbook/places 页面找到地点表格后运行。
(() => {
  'use strict';

  const columnAttributes = {
    map: 'data-bb-place-map-header',
    hot: 'data-bb-place-hot-header',
    indicator: 'data-bb-place-indicator-header',
  };
  const cellAttributes = {
    map: 'data-bb-place-map-cell',
    hot: 'data-bb-place-hot-cell',
    indicator: 'data-bb-place-indicator-cell',
  };
  const cache = new Map();
  let timer = null;

  function addStyles() {
    if (document.getElementById('bb-place-columns-style')) return;
    const style = document.createElement('style');
    style.id = 'bb-place-columns-style';
    style.textContent = `
      th[data-bb-place-map-header], th[data-bb-place-hot-header], th[data-bb-place-indicator-header],
      td[data-bb-place-map-cell], td[data-bb-place-hot-cell], td[data-bb-place-indicator-cell] {
        min-width: 150px !important; width: 150px !important; text-align: center !important; vertical-align: middle !important;
      }
      td[data-bb-place-map-cell], td[data-bb-place-hot-cell], td[data-bb-place-indicator-cell] {
        white-space: pre-line !important; color: #337ab7; font-weight: 600; line-height: 1.5;
      }
      .bb-place-empty, .bb-place-loading { color: #999 !important; font-weight: normal !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getTable() {
    return document.querySelector('table');
  }

  function ensureColumn(table, kind, title) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return null;
    const attribute = columnAttributes[kind];
    let header = headerRow.querySelector(`th[${attribute}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(attribute, 'true');
      header.innerHTML = `<div class="th-inner">${title}</div>`;
      const actionIndex = Array.from(headerRow.cells).findIndex(cell => cell.textContent.trim() === '操作');
      headerRow.insertBefore(header, headerRow.cells[actionIndex] || null);
    }
    return header.cellIndex;
  }

  async function loadConfig(editUrl) {
    if (cache.has(editUrl)) return cache.get(editUrl);
    const request = fetch(editUrl, { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const select = doc.querySelector('select[name="map_id"]');
        const selected = select?.querySelector('option:checked') || select?.querySelector('option[selected]');
        const read = name => doc.querySelector(`[name="${name}"]`)?.value?.trim() || '';
        return { map: selected?.textContent.trim() || '无', hot: read('hot_pos'), indicator: read('indicator_pos') };
      })
      .catch(error => {
        console.warn('[百变后台地点信息] 读取地点编辑页失败', error);
        return { map: '读取失败', hot: '', indicator: '' };
      });
    cache.set(editUrl, request);
    return request;
  }

  function render(cell, text) {
    const value = text || '无';
    if (cell.dataset.bbPlaceValue === value) return;
    cell.dataset.bbPlaceValue = value;
    cell.replaceChildren();
    const span = document.createElement('span');
    span.textContent = value;
    if (!text) span.className = 'bb-place-empty';
    cell.appendChild(span);
  }

  async function update() {
    if (!/\/playbook\/places/.test(location.pathname)) return;
    const table = getTable();
    if (!table) return;
    addStyles();
    const mapIndex = ensureColumn(table, 'map', '所属地图');
    const hotIndex = ensureColumn(table, 'hot', '热区位置');
    const indicatorIndex = ensureColumn(table, 'indicator', '指示图标位置');
    if (mapIndex == null || hotIndex == null || indicatorIndex == null) return;

    await Promise.all(Array.from(table.querySelectorAll('tbody tr[data-key]')).map(async row => {
      const getCell = (kind, index) => {
        let cell = row.querySelector(`td[${cellAttributes[kind]}]`);
        if (!cell) {
          cell = document.createElement('td');
          cell.setAttribute(cellAttributes[kind], 'true');
          row.insertBefore(cell, row.cells[index] || null);
        }
        return cell;
      };
      const cells = { map: getCell('map', mapIndex), hot: getCell('hot', hotIndex), indicator: getCell('indicator', indicatorIndex) };
      const editUrl = row.querySelector('a[href*="/edit?"]')?.href;
      if (!editUrl) {
        Object.values(cells).forEach(cell => render(cell, ''));
        return;
      }
      const config = await loadConfig(editUrl);
      render(cells.map, config.map);
      render(cells.hot, config.hot);
      render(cells.indicator, config.indicator);
    }));
  }

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(update, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 地图列表增强：读取每张地图“编辑地点热区”中的地点名称，并显示在地图列表中。
(() => {
  'use strict';

  const HEADER_ATTRIBUTE = 'data-bb-map-place-names-header';
  const CELL_ATTRIBUTE = 'data-bb-map-place-names-cell';
  const INTERIOR_BUTTON_ATTRIBUTE = 'data-bb-map-interior-button';
  const INTERIOR_MODAL_ID = 'bb-map-interior-modal';
  const cache = new Map();
  const queued = [];
  const queuedIds = new Set();
  let activeRequests = 0;
  let updateTimer = null;

  function isMapList() {
    return /\/playbook\/maps\/?$/.test(location.pathname)
      && Boolean(new URL(location.href).searchParams.get('playbook_id'));
  }

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function escapeMapHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function addStyles() {
    const styleId = 'bb-map-place-names-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      th[${HEADER_ATTRIBUTE}], td[${CELL_ATTRIBUTE}] { min-width: 150px !important; vertical-align: top !important; }
      td[${CELL_ATTRIBUTE}] { white-space: pre-line !important; color: #337ab7; line-height: 1.55; }
      td[${CELL_ATTRIBUTE}].bb-map-place-loading, td[${CELL_ATTRIBUTE}].bb-map-place-empty, td[${CELL_ATTRIBUTE}].bb-map-place-error { color: #999; font-weight: normal; }
      td[${CELL_ATTRIBUTE}].bb-map-place-error { color: #c0392b; }
      button[${INTERIOR_BUTTON_ATTRIBUTE}] { margin-left: 7px; }
      #${INTERIOR_MODAL_ID} { position: fixed; z-index: 100000; inset: 0; display: flex; align-items: center; justify-content: flex-end; padding: 18px 24px 18px 18px; box-sizing: border-box; background: rgba(0,0,0,.45); }
      #${INTERIOR_MODAL_ID} .bb-map-interior-panel { width: min(720px, calc(100vw - 42px)); max-height: calc(100vh - 36px); overflow: auto; padding: 22px; border-radius: 6px; background: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
      #${INTERIOR_MODAL_ID} h3 { margin: 0 0 10px; color: #3c4b5a; }
      #${INTERIOR_MODAL_ID} .bb-map-interior-note { color: #687786; line-height: 1.7; }
      #${INTERIOR_MODAL_ID} input[type="file"] { margin: 12px 0; }
      #${INTERIOR_MODAL_ID} .bb-map-interior-list { max-height: calc(100vh - 310px); overflow: auto; border: 1px solid #ddd; }
      #${INTERIOR_MODAL_ID} .bb-map-interior-row { display: grid; grid-template-columns: 80px minmax(180px, 1fr); gap: 12px; padding: 8px 10px; border-bottom: 1px solid #eee; }
      #${INTERIOR_MODAL_ID} .bb-map-interior-row:last-child { border-bottom: 0; }
      #${INTERIOR_MODAL_ID} .bb-map-interior-status { min-height: 24px; margin-top: 10px; color: #337ab7; white-space: pre-wrap; }
      #${INTERIOR_MODAL_ID} .bb-map-interior-error { color: #c0392b; }
      #${INTERIOR_MODAL_ID} .bb-map-interior-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
      @media (max-width: 820px) { #${INTERIOR_MODAL_ID} { justify-content: center; padding: 18px; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getMapRows() {
    const table = document.querySelector('table');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr[data-key]')).map(row => ({
      row,
      id: normalize(row.dataset.key || row.cells[0]?.textContent),
      name: normalize(row.querySelector('td.column-name')?.textContent || row.cells[1]?.textContent),
      hotzoneUrl: row.querySelector('a[href*="/playbook/placelists"]')?.href || ''
    })).filter(item => /^\d+$/.test(item.id) && item.hotzoneUrl);
  }

  function ensureColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return null;
    let header = headerRow.querySelector(`th[${HEADER_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(HEADER_ATTRIBUTE, 'true');
      header.textContent = '地点';
      const nameHeader = Array.from(headerRow.cells).find(cell => normalize(cell.textContent) === '名称');
      if (nameHeader) nameHeader.insertAdjacentElement('afterend', header);
      else headerRow.appendChild(header);
    }
    return header.cellIndex;
  }

  function render(cell, state) {
    const names = state?.names || [];
    const renderKey = `${state?.status || 'empty'}:${names.join('\u0001')}`;
    if (cell.dataset.bbMapPlaceValue === renderKey) return;
    cell.dataset.bbMapPlaceValue = renderKey;
    cell.classList.remove('bb-map-place-loading', 'bb-map-place-empty', 'bb-map-place-error');
    if (state?.status === 'loading') {
      cell.classList.add('bb-map-place-loading');
      cell.textContent = '读取中…';
      return;
    }
    if (state?.status === 'error') {
      cell.classList.add('bb-map-place-error');
      cell.textContent = '读取失败';
      return;
    }
    if (!names.length) {
      cell.classList.add('bb-map-place-empty');
      cell.textContent = '暂无地点';
      return;
    }
    cell.textContent = names.join('\n');
  }

  async function fetchPlaceNames(url, mapId) {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const places = Array.from(doc.querySelectorAll('table tbody tr[data-key]')).map(row => {
        const nameCell = row.querySelector('td.column-name') || row.cells[1];
        const editLink = row.querySelector('a[href*="/playbook/places/"][href*="/edit"]');
        const id = normalize(row.dataset.key || row.cells[0]?.textContent);
        const name = normalize(nameCell?.textContent);
        const editUrl = editLink ? new URL(editLink.getAttribute('href') || '', url).href : '';
        return id && name && editUrl ? { id, name, editUrl } : null;
      }).filter(Boolean);
      const state = { status: 'loaded', names: places.map(place => place.name), places };
      cache.set(mapId, state);
      return state;
    } catch (error) {
      console.warn('[百变后台地图列表] 读取地图地点失败', error);
      const state = { status: 'error', names: [], places: [], error: error.message || String(error) };
      cache.set(mapId, state);
      return state;
    }
    finally {
      update();
    }
  }

  async function uploadInteriorToPlace(place, file) {
    const editResponse = await fetch(place.editUrl, { credentials: 'same-origin' });
    if (!editResponse.ok) throw new Error(`读取编辑页失败：HTTP ${editResponse.status}`);
    const editDoc = new DOMParser().parseFromString(await editResponse.text(), 'text/html');
    const form = Array.from(editDoc.forms).find(item =>
      String(item.method).toLowerCase() === 'post'
      && item.querySelector('[name="_method"][value="PUT"]')
      && item.querySelector('input[type="file"][name="image"]')
    );
    if (!form) throw new Error('未找到“私聊背景图”上传字段');
    const data = new FormData(form);
    ['image', 'indicator', 'indicator_click', 'open_sound'].forEach(name => data.delete(name));
    data.delete('after-save');
    data.set('_previous_', location.href);
    data.append('image', file, file.name);
    const action = new URL(form.getAttribute('action') || place.editUrl, place.editUrl).href;
    const response = await fetch(action, { method: 'POST', body: data, credentials: 'same-origin' });
    const resultDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const errorText = normalize(Array.from(resultDoc.querySelectorAll('.alert-danger, .has-error .help-block'))
      .map(item => item.textContent).join(' '));
    if (!response.ok) throw new Error(errorText || `HTTP ${response.status}`);
    if (errorText || resultDoc.querySelector('form [name="_method"][value="PUT"]')) {
      throw new Error(errorText || '后台未接受该图片');
    }
  }

  function openInteriorModal(map, places) {
    document.getElementById(INTERIOR_MODAL_ID)?.remove();
    const modal = document.createElement('div');
    modal.id = INTERIOR_MODAL_ID;
    modal.innerHTML = `
      <div class="bb-map-interior-panel">
        <h3>设置地图内景</h3>
        <div class="bb-map-interior-note">地图“${escapeMapHtml(map.name)}”关联 ${places.length} 个地点。选择一张图片后，将覆盖下列全部地点的“私聊背景图”。</div>
        <input type="file" accept="image/*" class="form-control" data-bb-map-interior-file>
        <div class="bb-map-interior-list">${places.map(place => `<div class="bb-map-interior-row"><span>${escapeMapHtml(place.id)}</span><strong>${escapeMapHtml(place.name)}</strong></div>`).join('')}</div>
        <div class="bb-map-interior-status" data-bb-map-interior-status></div>
        <div class="bb-map-interior-actions">
          <button type="button" class="btn btn-default" data-bb-map-interior-cancel>取消</button>
          <button type="button" class="btn btn-primary" data-bb-map-interior-confirm disabled>确认覆盖 ${places.length} 个地点</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const picker = modal.querySelector('[data-bb-map-interior-file]');
    const status = modal.querySelector('[data-bb-map-interior-status]');
    const cancel = modal.querySelector('[data-bb-map-interior-cancel]');
    const confirm = modal.querySelector('[data-bb-map-interior-confirm]');
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      confirm.disabled = !file || !(file.type.startsWith('image/') || /\.(?:jpe?g|png|gif|webp|bmp|avif)$/i.test(file.name));
      status.textContent = confirm.disabled && file ? '请选择有效的图片文件。' : '';
    });
    cancel.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', event => { if (event.target === modal && !confirm.disabled) modal.remove(); });
    confirm.addEventListener('click', async () => {
      if (confirm.dataset.finished === 'true') {
        modal.remove();
        return;
      }
      const file = picker.files?.[0];
      if (!file) return;
      confirm.disabled = true;
      cancel.disabled = true;
      picker.disabled = true;
      let completed = 0;
      const failures = [];
      for (const place of places) {
        status.className = 'bb-map-interior-status';
        status.textContent = `正在上传 ${completed + failures.length + 1}/${places.length}：${place.name}`;
        try {
          await uploadInteriorToPlace(place, file);
          completed += 1;
        } catch (error) {
          failures.push(`${place.name}：${error.message || '上传失败'}`);
        }
      }
      status.className = failures.length ? 'bb-map-interior-status bb-map-interior-error' : 'bb-map-interior-status';
      status.textContent = `已成功设置 ${completed}/${places.length} 个地点。${failures.length ? `\n失败：${failures.join('\n')}` : ''}`;
      confirm.disabled = false;
      confirm.dataset.finished = 'true';
      confirm.textContent = '关闭';
      cancel.style.display = 'none';
    });
  }

  function ensureInteriorButton(map) {
    const operationCell = map.row.lastElementChild;
    if (!operationCell || operationCell.querySelector(`button[${INTERIOR_BUTTON_ATTRIBUTE}]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-xs btn-warning';
    button.setAttribute(INTERIOR_BUTTON_ATTRIBUTE, 'true');
    button.textContent = '设置地图内景';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = '读取地点…';
      let state = cache.get(map.id);
      if (!state || state.status !== 'loaded') state = await fetchPlaceNames(map.hotzoneUrl, map.id);
      button.disabled = false;
      button.textContent = originalText;
      if (state.status === 'error') {
        window.alert(`读取关联地点失败：${state.error || '未知错误'}`);
        return;
      }
      if (!state.places.length) {
        window.alert('该地图暂未关联地点');
        return;
      }
      openInteriorModal(map, state.places);
    });
    operationCell.appendChild(button);
  }

  function drainQueue() {
    while (activeRequests < 4 && queued.length) {
      const item = queued.shift();
      queuedIds.delete(item.mapId);
      activeRequests += 1;
      fetchPlaceNames(item.url, item.mapId).finally(() => {
        activeRequests -= 1;
        drainQueue();
      });
    }
  }

  function queueLoad(url, mapId) {
    if (cache.has(mapId) || queuedIds.has(mapId)) return;
    cache.set(mapId, { status: 'loading', names: [] });
    queuedIds.add(mapId);
    queued.push({ url, mapId });
    drainQueue();
  }

  function update() {
    if (!isMapList()) return;
    const table = document.querySelector('table');
    if (!table) return;
    addStyles();
    const placeIndex = ensureColumn(table);
    if (placeIndex == null) return;
    getMapRows().forEach(item => {
      let cell = item.row.querySelector(`td[${CELL_ATTRIBUTE}]`);
      if (!cell) {
        cell = document.createElement('td');
        cell.setAttribute(CELL_ATTRIBUTE, 'true');
        item.row.insertBefore(cell, item.row.cells[placeIndex] || null);
      }
      queueLoad(item.hotzoneUrl, item.id);
      render(cell, cache.get(item.id));
      ensureInteriorButton(item);
    });
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 剧本列表增强：读取每个剧本角色列表中的主图，只显示小尺寸头像，不显示角色名称。
(() => {
  'use strict';

  const HEADER_ATTRIBUTE = 'data-bb-playbook-avatars-header';
  const CELL_ATTRIBUTE = 'data-bb-playbook-avatars-cell';
  const cache = new Map();
  const queued = [];
  const queuedIds = new Set();
  let activeRequests = 0;
  let updateTimer = null;

  function isPlaybookList() {
    return /\/playbooks\/?$/.test(location.pathname);
  }

  function normalize(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function addStyles() {
    const styleId = 'bb-playbook-avatars-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      th[${HEADER_ATTRIBUTE}], td[${CELL_ATTRIBUTE}] { min-width: 180px !important; vertical-align: top !important; }
      td[${CELL_ATTRIBUTE}] .bb-playbook-avatar-list { display: flex; flex-wrap: wrap; gap: 4px; max-width: 280px; max-height: 180px; overflow: auto; align-items: flex-start; }
      td[${CELL_ATTRIBUTE}] img { display: block; width: 46px; height: 62px; object-fit: cover; border: 1px solid #d8dee5; border-radius: 3px; background: #f5f5f5; }
      td[${CELL_ATTRIBUTE}].bb-playbook-avatar-loading, td[${CELL_ATTRIBUTE}].bb-playbook-avatar-empty, td[${CELL_ATTRIBUTE}].bb-playbook-avatar-error { color: #999; font-weight: normal; }
      td[${CELL_ATTRIBUTE}].bb-playbook-avatar-error { color: #c0392b; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function getPlaybookRows() {
    const table = document.querySelector('table');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr[data-key]')).map(row => ({
      row,
      id: normalize(row.dataset.key || row.cells[0]?.textContent)
    })).filter(item => /^\d+$/.test(item.id));
  }

  function getCharacterListUrl(playbookId) {
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/\/playbooks\/?$/, '/playbook/characters');
    url.search = `?playbook_id=${encodeURIComponent(playbookId)}`;
    return url.href;
  }

  function ensureColumn(table) {
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return null;
    let header = headerRow.querySelector(`th[${HEADER_ATTRIBUTE}]`);
    if (!header) {
      header = document.createElement('th');
      header.setAttribute(HEADER_ATTRIBUTE, 'true');
      header.textContent = '角色头像';
      const coverHeader = Array.from(headerRow.cells).find(cell => normalize(cell.textContent) === '图片');
      if (coverHeader) coverHeader.insertAdjacentElement('afterend', header);
      else headerRow.appendChild(header);
    }
    return header.cellIndex;
  }

  function render(cell, state) {
    const urls = state?.urls || [];
    const renderKey = `${state?.status || 'empty'}:${urls.join('\u0001')}`;
    if (cell.dataset.bbPlaybookAvatarValue === renderKey) return;
    cell.dataset.bbPlaybookAvatarValue = renderKey;
    cell.classList.remove('bb-playbook-avatar-loading', 'bb-playbook-avatar-empty', 'bb-playbook-avatar-error');
    cell.replaceChildren();
    if (state?.status === 'loading') {
      cell.classList.add('bb-playbook-avatar-loading');
      cell.textContent = '读取中…';
      return;
    }
    if (state?.status === 'error') {
      cell.classList.add('bb-playbook-avatar-error');
      cell.textContent = '读取失败';
      return;
    }
    if (!urls.length) {
      cell.classList.add('bb-playbook-avatar-empty');
      cell.textContent = '—';
      return;
    }
    const list = document.createElement('div');
    list.className = 'bb-playbook-avatar-list';
    urls.forEach(url => {
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.loading = 'lazy';
      list.appendChild(image);
    });
    cell.appendChild(list);
  }

  async function fetchAvatarUrls(url, playbookId) {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const urls = Array.from(doc.querySelectorAll('table tbody tr[data-key] img')).map(image => {
        const raw = image.getAttribute('src') || image.getAttribute('data-src') || '';
        if (!raw) return '';
        try {
          return new URL(raw, url).href;
        } catch (_) {
          return '';
        }
      }).filter((imageUrl, index, all) => imageUrl && all.indexOf(imageUrl) === index);
      cache.set(playbookId, { status: 'loaded', urls });
    } catch (error) {
      console.warn('[百变后台剧本列表] 读取角色头像失败', error);
      cache.set(playbookId, { status: 'error', urls: [] });
    }
    update();
  }

  function drainQueue() {
    while (activeRequests < 4 && queued.length) {
      const item = queued.shift();
      queuedIds.delete(item.playbookId);
      activeRequests += 1;
      fetchAvatarUrls(item.url, item.playbookId).finally(() => {
        activeRequests -= 1;
        drainQueue();
      });
    }
  }

  function queueLoad(url, playbookId) {
    if (cache.has(playbookId) || queuedIds.has(playbookId)) return;
    cache.set(playbookId, { status: 'loading', urls: [] });
    queuedIds.add(playbookId);
    queued.push({ url, playbookId });
    drainQueue();
  }

  function update() {
    if (!isPlaybookList()) return;
    const table = document.querySelector('table');
    if (!table) return;
    addStyles();
    const avatarIndex = ensureColumn(table);
    if (avatarIndex == null) return;
    getPlaybookRows().forEach(item => {
      let cell = item.row.querySelector(`td[${CELL_ATTRIBUTE}]`);
      if (!cell) {
        cell = document.createElement('td');
        cell.setAttribute(CELL_ATTRIBUTE, 'true');
        item.row.insertBefore(cell, item.row.cells[avatarIndex] || null);
      }
      queueLoad(getCharacterListUrl(item.id), item.id);
      render(cell, cache.get(item.id));
    });
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(update, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  update();
})();

// 回合动作快捷创建事件：优先复用同类型事件，避免为每个动作创建重复事件。
(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-bb-quick-event';
  const STYLE_ID = 'bb-quick-event-style';
  const EVENT_TYPE_NAMES = {
    7: '所有角色都点击了主按钮',
    9: '回合开始',
  };
  let updateTimer = null;

  function isActionList() {
    return /\/playbook\/actions\/?$/.test(location.pathname);
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      a[${BUTTON_ATTRIBUTE}] { margin-left: 6px; }
      a[${BUTTON_ATTRIBUTE}].bb-quick-event-done { color: #fff !important; background: #00a65a !important; border-color: #008d4c !important; }
    `;
    document.head.appendChild(style);
  }

  function eventListUrl(context = null) {
    const current = new URL(location.href);
    const query = new URLSearchParams();
    const contextValues = context ? {
      playbook_id: context.playbookId,
      relate_id: context.relateId,
      relate_type: context.relateType || '3',
    } : {};
    ['playbook_id', 'relate_id', 'relate_type'].forEach(key => {
      const value = contextValues[key] || current.searchParams.get(key);
      if (value) query.set(key, value);
    });
    if (!query.get('playbook_id') || !query.get('relate_id') || !query.get('relate_type')) {
      throw new Error('当前动作页缺少回合信息');
    }
    const basePath = current.pathname.match(/^\/[^/]+/)?.[0] || '/16d7m';
    return `${current.origin}${basePath}/playbook/sceneevents?${query.toString()}`;
  }

  function getActionId(row) {
    const firstCell = row.querySelector('td');
    const id = firstCell?.textContent.trim();
    if (!/^\d+$/.test(id || '')) throw new Error('未读取到动作 ID');
    return id;
  }

  function getEventConfigForm(documentForEvent) {
    return Array.from(documentForEvent.forms).find(item =>
      item.method.toLowerCase() === 'post'
      && item.querySelector('[name="event_cate"]')
      && item.querySelector('[name="trigger_action[]"]')
    );
  }

  function resolveFormAction(form, baseUrl) {
    return new URL(form.getAttribute('action') || baseUrl, baseUrl).href;
  }

  async function getEventPage(context = null) {
    const url = eventListUrl(context);
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取事件列表失败：HTTP ${response.status}`);
    const documentForEvent = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = getEventConfigForm(documentForEvent);
    if (!form) throw new Error('未找到事件创建表单');
    return { documentForEvent, form, url };
  }

  function findExistingEditUrl(documentForEvent, baseUrl, eventCate) {
    const expectedType = EVENT_TYPE_NAMES[eventCate];
    if (!expectedType) throw new Error(`未知事件类型：${eventCate}`);
    const matchingRow = Array.from(documentForEvent.querySelectorAll('table tbody tr')).find(row => {
      const cells = row.querySelectorAll('td');
      return cells[1]?.textContent.trim() === expectedType
        && row.querySelector('a[href*="/sceneevents/"][href*="/edit"]');
    });
    const href = matchingRow?.querySelector('a[href*="/sceneevents/"][href*="/edit"]')?.getAttribute('href');
    return href ? new URL(href, baseUrl).href : null;
  }

  async function checkResponse(response, action) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Laravel-admin 通常以跳转或 HTML 响应表示成功；若返回 JSON，额外检查 status。
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      if (payload.status === false) throw new Error(payload.message || `${action}失败`);
    }
  }

  async function createEvent(form, baseUrl, actionId, eventCate) {
    const body = new FormData();
    // 复制后台新建表单中的必填上下文；其他字段保留为空，避免带入动作页的任何配置。
    ['playbook_id', 'scene_id', '_token'].forEach(name => {
      const value = form.querySelector(`[name="${name}"]`)?.value;
      if (!value) throw new Error(`未读取到事件字段：${name}`);
      body.append(name, value);
    });
    body.append('event_cate', eventCate);
    body.append('trigger_condition', '');
    body.append('trigger_action[]', actionId);
    const response = await fetch(resolveFormAction(form, baseUrl), { method: 'POST', body, credentials: 'same-origin' });
    await checkResponse(response, '创建事件');
  }

  async function appendActionToExistingEvent(editUrl, actionId, eventCate) {
    const response = await fetch(editUrl, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`读取已有事件失败：HTTP ${response.status}`);
    const documentForEdit = new DOMParser().parseFromString(await response.text(), 'text/html');
    const form = getEventConfigForm(documentForEdit);
    if (!form) throw new Error('未找到已有事件编辑表单');

    const actionSelect = form.querySelector('select[name="trigger_action[]"]');
    if (!actionSelect) throw new Error('未找到已有事件的动作列表');
    const selectedIds = Array.from(actionSelect.selectedOptions).map(option => option.value).filter(Boolean);
    if (selectedIds.includes(actionId)) return false;
    const option = Array.from(actionSelect.options).find(item => item.value === actionId);
    if (!option) throw new Error('当前动作不在已有事件的可选动作中');
    option.selected = true;

    // 保留编辑页其他所有字段，只规范重建事件类型和多选动作字段，去除后台附带的空隐藏值。
    const original = new FormData(form);
    const body = new FormData();
    for (const [name, value] of original.entries()) {
      if (name !== 'event_cate' && name !== 'trigger_action[]') body.append(name, value);
    }
    body.append('event_cate', eventCate);
    Array.from(actionSelect.selectedOptions)
      .map(item => item.value)
      .filter(Boolean)
      .forEach(value => body.append('trigger_action[]', value));

    const updateResponse = await fetch(resolveFormAction(form, editUrl), {
      method: 'POST',
      body,
      credentials: 'same-origin',
    });
    await checkResponse(updateResponse, '追加动作');
    return true;
  }

  async function createOrAppendEvent(actionId, eventCate, context = null) {
    const { documentForEvent, form, url } = await getEventPage(context);
    const existingEditUrl = findExistingEditUrl(documentForEvent, url, eventCate);
    if (!existingEditUrl) {
      await createEvent(form, url, actionId, eventCate);
      return 'created';
    }
    return (await appendActionToExistingEvent(existingEditUrl, actionId, eventCate)) ? 'appended' : 'exists';
  }

  // 供地图、音乐等列表页的一键动作流程复用同一套事件创建/追加逻辑。
  globalThis.__bbQuickEventApi = { createOrAppendEvent };

  function createButton(label, cate, row) {
    const button = document.createElement('a');
    button.href = '#';
    button.className = 'btn btn-xs btn-success';
    button.setAttribute(BUTTON_ATTRIBUTE, cate);
    button.textContent = label;
    button.addEventListener('click', async event => {
      event.preventDefault();
      if (button.dataset.creating === 'true') return;
      button.dataset.creating = 'true';
      button.textContent = '创建中…';
      try {
        const result = await createOrAppendEvent(getActionId(row), cate);
        button.textContent = result === 'created' ? '已创建' : (result === 'appended' ? '已追加' : '已存在');
        button.classList.add('bb-quick-event-done');
        window.setTimeout(() => {
          button.textContent = label;
          button.classList.remove('bb-quick-event-done');
          delete button.dataset.creating;
        }, 1600);
      } catch (error) {
        console.warn('[百变后台快捷事件] 创建失败', error);
        button.textContent = '创建失败';
        window.setTimeout(() => {
          button.textContent = label;
          delete button.dataset.creating;
        }, 1800);
      }
    });
    return button;
  }

  function updateButtons() {
    if (!isActionList()) return;
    addStyles();
    document.querySelectorAll('table tbody tr').forEach(row => {
      const editLink = Array.from(row.querySelectorAll('a')).find(link => /编辑动作/.test(link.textContent));
      if (!editLink || row.querySelector(`[${BUTTON_ATTRIBUTE}]`)) return;
      const container = editLink.parentElement;
      container?.append(
        createButton('回合开始', '9', row),
        createButton('点击主按钮', '7', row)
      );
    });
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateButtons, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  updateButtons();
})();

// 背景音乐快捷创建回合动作：创建“开始播放背景音乐”动作，自动加入回合开始事件并记录所属回合。
(() => {
  'use strict';

  const STYLE_ID = 'bb-round-music-action-style';
  const MODAL_ID = 'bb-round-music-action-modal';
  const BUTTON_ATTRIBUTE = 'data-bb-round-music-action';
  const RECORD_ATTRIBUTE = 'data-bb-round-music-record';
  const RECORD_STORAGE_PREFIX = 'bb-round-music-records:';
  let updateTimer = null;

  const normalizeText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isMusicList = () => /\/playbook\/bmgs\/?$/.test(location.pathname);

  function getPageContext() {
    const url = new URL(location.href);
    return {
      playbookId: url.searchParams.get('playbook_id') || '',
      basePath: url.pathname.match(/^\/[^/]+/)?.[0] || '/16d7m',
    };
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .bb-round-music-action-button { margin-left: 6px; }
      #${MODAL_ID} { position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.48); }
      #${MODAL_ID} .bb-round-music-dialog { width: min(640px, 94vw); max-height: 86vh; display: flex; flex-direction: column; overflow: hidden; border-radius: 6px; background: #fff; box-shadow: 0 18px 55px rgba(0,0,0,.28); }
      #${MODAL_ID} .bb-round-music-header { padding: 20px 24px 12px; }
      #${MODAL_ID} .bb-round-music-title { margin: 0 0 6px; color: #34495e; font-size: 24px; font-weight: 600; }
      #${MODAL_ID} .bb-round-music-subtitle { color: #6b7b8b; font-size: 14px; }
      #${MODAL_ID} .bb-round-music-note { margin-top: 8px; color: #8a9aa9; font-size: 13px; }
      #${MODAL_ID} .bb-round-music-body { min-height: 150px; padding: 8px 24px 18px; overflow: auto; }
      #${MODAL_ID} .bb-round-music-status { padding: 14px 4px; color: #3c8dbc; white-space: pre-line; }
      #${MODAL_ID} .bb-round-music-status.is-error { color: #dd4b39; }
      #${MODAL_ID} .bb-round-music-list { border: 1px solid #d8e3ed; border-radius: 4px; overflow: hidden; }
      #${MODAL_ID} .bb-round-music-option { display: flex; align-items: center; gap: 10px; margin: 0; padding: 12px 14px; border-bottom: 1px solid #edf1f4; cursor: pointer; font-weight: 400; }
      #${MODAL_ID} .bb-round-music-option:last-child { border-bottom: 0; }
      #${MODAL_ID} .bb-round-music-option:hover { background: #f4f9fc; }
      #${MODAL_ID} .bb-round-music-option input { margin: 0; }
      #${MODAL_ID} .bb-round-music-option-id { margin-left: auto; color: #95a5a6; font-size: 12px; }
      #${MODAL_ID} .bb-round-music-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 24px 20px; border-top: 1px solid #edf1f4; }
      span[${RECORD_ATTRIBUTE}] { display: inline-block; margin-left: 8px; color: #00a65a; font-size: 12px; vertical-align: middle; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function recordsStorageKey() {
    const { playbookId } = getPageContext();
    return `${RECORD_STORAGE_PREFIX}${playbookId || location.pathname}`;
  }

  function readAllRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(recordsStorageKey()) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function readMusicRecords(musicId) {
    const records = readAllRecords()[String(musicId)];
    return Array.isArray(records) ? records : [];
  }

  function saveMusicRecord(music, round) {
    try {
      const allRecords = readAllRecords();
      const musicId = String(music.id);
      const records = Array.isArray(allRecords[musicId]) ? allRecords[musicId] : [];
      if (!records.some(record => String(record.roundId) === String(round.id))) {
        records.push({ roundId: String(round.id), roundName: round.name, createdAt: Date.now() });
        allRecords[musicId] = records;
        localStorage.setItem(recordsStorageKey(), JSON.stringify(allRecords));
      }
    } catch (_) {
      // 本地存储不可用时不影响后台动作和事件的正常创建。
    }
  }

  function renderMusicRecord(row, music) {
    const container = music.editLink?.parentElement;
    if (!container) return;
    let recordElement = container.querySelector(`span[${RECORD_ATTRIBUTE}]`);
    if (!recordElement) {
      recordElement = document.createElement('span');
      recordElement.setAttribute(RECORD_ATTRIBUTE, music.id);
      container.appendChild(recordElement);
    }
    const records = readMusicRecords(music.id);
    recordElement.textContent = records.length
      ? `已添加到：${records.map(record => `${record.roundName || `回合 ${record.roundId}`}（${record.roundId}）`).join('、')}`
      : '';
    recordElement.hidden = !records.length;
  }

  async function fetchDocument(url, label) {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function readRounds(doc, sourceUrl) {
    const rounds = [];
    const seen = new Set();
    doc.querySelectorAll('table tbody tr').forEach(row => {
      const editLink = Array.from(row.querySelectorAll('a[href]')).find(link => {
        try {
          return /\/playbook\/scenes\/\d+\/edit\/?$/.test(new URL(link.getAttribute('href'), sourceUrl).pathname);
        } catch (_) {
          return false;
        }
      });
      const editUrl = editLink ? new URL(editLink.getAttribute('href'), sourceUrl) : null;
      const pathId = editUrl?.pathname.match(/\/playbook\/scenes\/(\d+)\/edit\/?$/)?.[1];
      const cellId = normalizeText(row.children[0]?.textContent).match(/^\d+$/)?.[0];
      const id = pathId || cellId;
      if (!id || seen.has(id)) return;
      seen.add(id);
      rounds.push({ id, name: normalizeText(row.children[1]?.textContent) || `回合 ${id}` });
    });
    return rounds;
  }

  async function loadRounds() {
    const { playbookId, basePath } = getPageContext();
    if (!playbookId) throw new Error('当前页面缺少剧本 ID');
    const url = new URL(`${basePath}/playbook/scenes`, location.origin);
    url.searchParams.set('playbook_id', playbookId);
    const rounds = readRounds(await fetchDocument(url.href, '读取回合列表'), url.href);
    if (!rounds.length) throw new Error('没有识别到可用回合');
    return rounds;
  }

  function findActionForm(doc) {
    return Array.from(doc.forms).find(form => {
      try {
        return String(form.method).toLowerCase() === 'post'
          && /\/playbook\/actions\/?$/.test(new URL(form.getAttribute('action') || '', location.origin).pathname);
      } catch (_) {
        return false;
      }
    }) || null;
  }

  function readActionRows(doc) {
    return Array.from(doc.querySelectorAll('table tbody tr')).map(row => {
      const cells = row.querySelectorAll('td');
      const id = normalizeText(cells[0]?.textContent);
      if (!/^\d+$/.test(id)) return null;
      return {
        id,
        type: normalizeText(cells[1]?.textContent),
        name: normalizeText(cells[2]?.textContent),
      };
    }).filter(Boolean);
  }

  function findCreatedActionId(documents, previousIds) {
    const candidates = documents.flatMap(readActionRows).filter(item =>
      !previousIds.has(item.id)
      && item.type === '开始播放背景音乐'
      && item.name === '音乐'
    );
    candidates.sort((left, right) => Number(right.id) - Number(left.id));
    return candidates[0]?.id || '';
  }

  async function createRoundMusicAction(music, round) {
    const { playbookId, basePath } = getPageContext();
    const listUrl = new URL(`${basePath}/playbook/actions`, location.origin);
    listUrl.searchParams.set('playbook_id', playbookId);
    listUrl.searchParams.set('relate_id', round.id);
    listUrl.searchParams.set('relate_type', '3');
    listUrl.searchParams.set('page', '0');
    listUrl.searchParams.set('_sort[column]', 'id');
    listUrl.searchParams.set('_sort[type]', 'desc');

    const beforeDoc = await fetchDocument(listUrl.href, '读取动作创建表单');
    const previousIds = new Set(readActionRows(beforeDoc).map(item => item.id));
    const form = findActionForm(beforeDoc);
    if (!form) throw new Error('没有识别到动作创建表单');
    const token = form.querySelector('input[name="_token"]')?.value;
    if (!token) throw new Error('没有识别到动作表单令牌');

    // 参数与后台“开始播放背景音乐”的原生复制链接一致。
    const data = new URLSearchParams({
      _token: token,
      cate: '14',
      name: '音乐',
      playbook_id: playbookId,
      relate_id: round.id,
      relate_type: '3',
      param_a: music.id,
      param_b: music.duration,
      param_c: '',
      error_next: '0',
      break: '0',
      delay: '0',
      pre_condition: '0',
      priority: '10',
      description: '开始播放背景音乐',
      _previous_: listUrl.href,
    });
    data.set('json_a[0]', '$all-characters');
    data.set('json_a[1]', '');

    const actionUrl = new URL(form.getAttribute('action') || listUrl.href, listUrl.href);
    actionUrl.searchParams.set('playbook_id', playbookId);
    actionUrl.searchParams.set('relate_id', round.id);
    actionUrl.searchParams.set('relate_type', '3');
    const response = await fetch(actionUrl.href, { method: 'POST', body: data, credentials: 'same-origin' });
    const resultText = await response.text();
    if (!response.ok) throw new Error(`创建动作失败：HTTP ${response.status}`);

    let responseDoc = null;
    let createdId = response.url.match(/\/playbook\/actions\/(\d+)(?:\/edit)?/)?.[1] || '';
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      let payload = null;
      try { payload = JSON.parse(resultText); } catch (_) { /* 后续通过动作列表确认 */ }
      if (payload && (payload.status === false || payload.success === false)) {
        throw new Error(normalizeText(payload.message) || '后台返回创建失败');
      }
      createdId = createdId || String(payload?.id || payload?.data?.id || '');
    } else {
      responseDoc = new DOMParser().parseFromString(resultText, 'text/html');
      const errorText = normalizeText(responseDoc.querySelector('.alert-danger, .callout-danger, .has-error .help-block')?.textContent);
      if (errorText) throw new Error(errorText);
    }

    if (!/^\d+$/.test(createdId)) {
      const afterDoc = await fetchDocument(listUrl.href, '确认新动作');
      createdId = findCreatedActionId([responseDoc, afterDoc].filter(Boolean), previousIds);
    }
    if (!/^\d+$/.test(createdId)) throw new Error('动作已提交，但没有识别到新动作 ID');
    return createdId;
  }

  async function addToRoundStart(actionId, round) {
    const api = globalThis.__bbQuickEventApi;
    if (!api?.createOrAppendEvent) throw new Error('快捷事件组件尚未加载');
    const { playbookId } = getPageContext();
    return api.createOrAppendEvent(actionId, '9', {
      playbookId,
      relateId: round.id,
      relateType: '3',
    });
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  async function openRoundModal(music, sourceButton) {
    closeModal();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="bb-round-music-dialog" role="dialog" aria-modal="true" aria-labelledby="bb-round-music-title">
        <div class="bb-round-music-header">
          <h3 class="bb-round-music-title" id="bb-round-music-title">快速添加回合音乐</h3>
          <div class="bb-round-music-subtitle"></div>
          <div class="bb-round-music-note">将创建“开始播放背景音乐”动作，并自动加入所选回合的“回合开始”事件。</div>
        </div>
        <div class="bb-round-music-body"><div class="bb-round-music-status">正在读取回合列表…</div></div>
        <div class="bb-round-music-footer">
          <button type="button" class="btn btn-default" data-bb-round-music-cancel>取消</button>
          <button type="button" class="btn btn-success" data-bb-round-music-submit disabled>创建动作并添加事件</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.bb-round-music-subtitle').textContent = `音乐：${music.name}（${music.duration} 秒，ID：${music.id}）`;
    const body = modal.querySelector('.bb-round-music-body');
    const submit = modal.querySelector('[data-bb-round-music-submit]');
    modal.querySelector('[data-bb-round-music-cancel]').addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });

    try {
      const rounds = await loadRounds();
      if (!modal.isConnected) return;
      let createdActionId = '';
      const list = document.createElement('div');
      list.className = 'bb-round-music-list';
      rounds.forEach((round, index) => {
        const label = document.createElement('label');
        label.className = 'bb-round-music-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'bb-round-music-round';
        radio.value = round.id;
        radio.addEventListener('change', () => { submit.disabled = false; });
        const name = document.createElement('span');
        name.textContent = round.name;
        const id = document.createElement('span');
        id.className = 'bb-round-music-option-id';
        id.textContent = `ID：${round.id}`;
        label.append(radio, name, id);
        list.appendChild(label);
        if (index === 0) radio.focus();
      });
      body.replaceChildren(list);

      submit.addEventListener('click', async () => {
        const selected = modal.querySelector('input[name="bb-round-music-round"]:checked');
        const round = rounds.find(item => item.id === selected?.value);
        if (!round) return;
        submit.disabled = true;
        const status = document.createElement('div');
        status.className = 'bb-round-music-status';
        body.querySelector('.bb-round-music-status')?.remove();
        body.prepend(status);
        try {
          if (!createdActionId) {
            submit.textContent = '正在创建动作…';
            status.textContent = '正在创建背景音乐动作…';
            createdActionId = await createRoundMusicAction(music, round);
            modal.querySelectorAll('input[name="bb-round-music-round"]').forEach(input => { input.disabled = true; });
          }
          submit.textContent = '正在添加事件…';
          status.textContent = `动作 ${createdActionId} 已创建，正在加入回合开始事件…`;
          await addToRoundStart(createdActionId, round);
          saveMusicRecord(music, round);
          renderMusicRecord(sourceButton.closest('tr'), music);
          sourceButton.textContent = '已添加';
          sourceButton.classList.remove('btn-info');
          sourceButton.classList.add('btn-success');
          closeModal();
          window.setTimeout(() => {
            sourceButton.textContent = '快速添加回合音乐';
            sourceButton.classList.remove('btn-success');
            sourceButton.classList.add('btn-info');
          }, 1800);
        } catch (error) {
          console.warn('[百变后台回合音乐动作] 创建失败', error);
          status.classList.add('is-error');
          status.textContent = createdActionId
            ? `动作 ${createdActionId} 已创建，但添加回合开始事件失败：${error.message || error}`
            : `创建失败：${error.message || error}`;
          submit.disabled = false;
          submit.textContent = createdActionId ? '重试添加事件' : '重新创建';
        }
      });
    } catch (error) {
      body.replaceChildren();
      const status = document.createElement('div');
      status.className = 'bb-round-music-status is-error';
      status.textContent = error.message || String(error);
      body.appendChild(status);
    }
  }

  function getMusicFromRow(row) {
    const editLink = Array.from(row.querySelectorAll('a[href]')).find(link =>
      /\/playbook\/bmgs\/\d+\/edit/.test(link.getAttribute('href') || '')
    );
    if (!editLink) return null;
    const id = (editLink.getAttribute('href') || '').match(/\/playbook\/bmgs\/(\d+)\/edit/)?.[1]
      || normalizeText(row.children[0]?.textContent);
    const name = normalizeText(row.children[1]?.textContent) || `音乐 ${id}`;
    const duration = normalizeText(row.children[3]?.textContent).match(/\d+/)?.[0] || '';
    return id && duration ? { id, name, duration, editLink } : null;
  }

  function updateButtons() {
    if (!isMusicList()) return;
    addStyles();
    document.querySelectorAll('table tbody tr').forEach(row => {
      const music = getMusicFromRow(row);
      if (!music) return;
      let button = row.querySelector(`[${BUTTON_ATTRIBUTE}]`);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-xs btn-info bb-round-music-action-button';
        button.setAttribute(BUTTON_ATTRIBUTE, music.id);
        button.textContent = '快速添加回合音乐';
        button.addEventListener('click', event => {
          event.preventDefault();
          openRoundModal(getMusicFromRow(row) || music, button);
        });
        music.editLink.parentElement?.appendChild(button);
      }
      renderMusicRecord(row, music);
    });
  }

  function schedule() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateButtons, 120);
  }

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.setInterval(updateButtons, 700);
  updateButtons();
})();
