function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}必须是非负安全整数`);
  }
}

function toChineseNumeral(value) {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 9) return digits[value];
  if (value === 10) return '十';
  if (value < 20) return `十${digits[value - 10]}`;
  if (value < 100) {
    const ones = value % 10;
    return `${digits[Math.floor(value / 10)]}十${digits[ones]}`;
  }
  return String(value);
}

function cleanDescription(value) {
  return String(value)
    .replace(/[\u00a0\u202f]/g, ' ')
    .trim()
    .replace(/^\s*\d+\s*[.．、)）]\s*/, '')
    .trim();
}

export function normalizeClues(sourceValues, options) {
  if (!Array.isArray(sourceValues) || sourceValues.length < 2) {
    throw new Error('源表没有可整理的线索数据');
  }

  const {
    startInvestigationPointId,
    clueSkill1Id,
    clueSkill2Id,
  } = options ?? {};

  requireInteger(startInvestigationPointId, '调查点起始 ID');
  requireInteger(clueSkill1Id, '线索技能-1 ID');
  requireInteger(clueSkill2Id, '线索技能-2 ID');

  const groups = [];
  let currentGroup = null;
  let sceneNumber = 0;

  for (const row of sourceValues.slice(1)) {
    const rawValue = Array.isArray(row) ? row[0] : null;
    const value = rawValue == null ? '' : String(rawValue).trim();

    if (!value) {
      if (groups.length > 0) sceneNumber = 0;
      currentGroup = null;
      continue;
    }

    const groupMatch = value.match(/^[【\[](.+?)[】\]]$/);
    if (groupMatch) {
      sceneNumber += 1;
      const groupIndex = groups.length;
      currentGroup = {
        name: groupMatch[1].trim(),
        sceneNumber,
        groupIndex,
        investigationPointId: startInvestigationPointId + groupIndex,
        clues: [],
      };
      groups.push(currentGroup);
      continue;
    }

    if (!currentGroup) {
      throw new Error(`发现未归入线索包的内容：${value}`);
    }

    currentGroup.clues.push(cleanDescription(value));
  }

  if (groups.length === 0) {
    throw new Error('未识别到【线索包】标题');
  }

  const outputRows = [[
    '线索包名字',
    '线索名',
    '描述',
    '调查点id',
    '线索技能-1',
    '线索技能-2',
  ]];
  const groupStartRows = [];

  for (const group of groups) {
    if (group.clues.length === 0) {
      throw new Error(`线索包“${group.name}”没有线索内容`);
    }

    group.firstDataIndex = outputRows.length;
    const sceneLabel = `场景${toChineseNumeral(group.sceneNumber)}、${group.name}`;

    group.clues.forEach((description, clueIndex) => {
      const clueName = group.clues.length === 1
        ? group.name
        : `${group.name}${clueIndex + 1}`;
      const isNameOnly = description.replace(/\s/g, '') === clueName.replace(/\s/g, '');

      if (clueIndex === 0) groupStartRows.push(outputRows.length + 1);
      outputRows.push([
        clueIndex === 0 ? sceneLabel : null,
        clueName,
        isNameOnly ? null : description,
        group.investigationPointId,
        clueSkill1Id,
        clueSkill2Id,
      ]);
    });

    group.lastDataIndex = outputRows.length - 1;
  }

  for (const group of groups) {
    const expectedId = startInvestigationPointId + group.groupIndex;
    const groupRows = outputRows.slice(group.firstDataIndex, group.lastDataIndex + 1);
    if (groupRows.some(row => row[3] !== expectedId)) {
      throw new Error(`线索包“${group.name}”的调查点 ID 写入错误`);
    }
  }

  const distinctIds = [...new Set(outputRows.slice(1).map(row => row[3]))];
  const expectedIds = groups.map((_, index) => startInvestigationPointId + index);
  if (JSON.stringify(distinctIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`调查点 ID 不连续：实际 ${distinctIds.join(', ')}；预期 ${expectedIds.join(', ')}`);
  }

  return {
    outputRows,
    groupStartRows,
    helperRows: groups.map(group => [group.name]),
    groups: groups.map(group => ({
      name: group.name,
      sceneNumber: group.sceneNumber,
      investigationPointId: group.investigationPointId,
      clueCount: group.clues.length,
    })),
    firstInvestigationPointId: expectedIds[0],
    lastInvestigationPointId: expectedIds.at(-1),
  };
}

// Run this against the values read back from the exported workbook.  Keeping
// this check separate from normalizeClues catches accidental template
// fill-down/copy operations that can overwrite one package's ID (for example
// 9947, 9947, 9949) after the matrix was generated correctly.
export function verifyNormalizedRows(values, options) {
  if (!Array.isArray(values) || values.length < 2) {
    throw new Error('导出表没有可校验的数据');
  }
  const { startInvestigationPointId, clueSkill1Id, clueSkill2Id } = options ?? {};
  requireInteger(startInvestigationPointId, '调查点起始 ID');
  requireInteger(clueSkill1Id, '线索技能-1 ID');
  requireInteger(clueSkill2Id, '线索技能-2 ID');

  const expectedHeader = ['线索包名字', '线索名', '描述', '调查点id', '线索技能-1', '线索技能-2'];
  const header = values[0]?.slice(0, 6);
  if (JSON.stringify(header) !== JSON.stringify(expectedHeader)) {
    throw new Error(`导出表头不符合规范：${JSON.stringify(header)}`);
  }

  const dataRows = values.slice(1).filter(row => Array.isArray(row) && row.some(cell => cell !== null && cell !== ''));
  const groupStartRows = dataRows.filter(row => row[0] !== null && row[0] !== '').length;
  if (groupStartRows === 0) throw new Error('导出表没有识别到线索包起点');

  const ids = dataRows.map(row => row[3]);
  const distinctIds = [...new Set(ids)];
  const expectedIds = Array.from({ length: groupStartRows }, (_, index) => startInvestigationPointId + index);
  if (JSON.stringify(distinctIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`导出后调查点 ID 不连续：实际 ${distinctIds.join(', ')}；预期 ${expectedIds.join(', ')}`);
  }
  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i];
    if (!Number.isSafeInteger(row[3]) || row[3] !== ids[i]) {
      throw new Error(`第 ${i + 2} 行调查点 ID 不是整数：${row[3]}`);
    }
    if (row[4] !== clueSkill1Id || row[5] !== clueSkill2Id) {
      throw new Error(`第 ${i + 2} 行线索技能 ID 不匹配`);
    }
    if (i > 0 && row[0] !== null && row[0] !== '' && ids[i] !== ids[i - 1] + 1) {
      throw new Error(`第 ${i + 2} 行线索包 ID 跳号：${ids[i - 1]} → ${ids[i]}`);
    }
  }
  return { rowCount: dataRows.length, groupCount: groupStartRows, distinctIds };
}
