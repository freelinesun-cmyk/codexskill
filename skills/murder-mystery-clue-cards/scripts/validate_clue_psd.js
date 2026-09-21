#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readPsd } = require('ag-psd');

const [psdPath, assetDir] = process.argv.slice(2);
if (!psdPath || !assetDir) {
  throw new Error('Usage: node validate_clue_psd.js FINAL.psd ASSET_DIRECTORY');
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const flatten = (layers = [], result = []) => {
  for (const layer of layers) {
    result.push(layer);
    flatten(layer.children, result);
  }
  return result;
};

const psd = readPsd(fs.readFileSync(psdPath), {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
});
const groups = [...(psd.children || [])].sort((a, b) => Number(a.name.slice(0, 2)) - Number(b.name.slice(0, 2)));
const linkedById = new Map((psd.linkedFiles || []).map((file) => [file.id, file]));
const ids = new Set();
const rows = groups.map((group, index) => {
  const layers = flatten([group]);
  for (const layer of layers) {
    if (layer.id !== undefined) {
      if (ids.has(layer.id)) throw new Error(`Duplicate layer id: ${layer.id}`);
      ids.add(layer.id);
    }
  }
  const title = layers.filter((layer) => layer.text?.orientation === 'vertical');
  const body = layers.filter((layer) => layer.text?.orientation === 'horizontal');
  const smart = layers.filter((layer) => layer.placedLayer);
  if (title.length !== 1 || body.length !== 1 || smart.length !== 1) {
    throw new Error(`${group.name}: expected one title, body, and smart object`);
  }
  const linked = linkedById.get(smart[0].placedLayer.id);
  if (!linked?.data) throw new Error(`${group.name}: missing embedded smart-object data`);
  const sourcePath = path.join(assetDir, linked.name);
  if (!fs.existsSync(sourcePath)) throw new Error(`${group.name}: missing source asset ${linked.name}`);
  const source = fs.readFileSync(sourcePath);
  if (sha256(source) !== sha256(linked.data)) throw new Error(`${group.name}: embedded data hash mismatch`);
  return {
    order: index + 1,
    group: group.name,
    title: title[0].text.text,
    body: body[0].text.text,
    titleFont: title[0].text.style?.font?.name,
    bodyFont: body[0].text.style?.font?.name,
    smartObject: smart[0].name,
    source: linked.name,
    losslessHashMatch: true,
  };
});

if (linkedById.size !== groups.length) {
  throw new Error(`Expected ${groups.length} linked files, found ${linkedById.size}`);
}

console.log(JSON.stringify({
  psd: psdPath,
  dimensions: [psd.width, psd.height],
  groups: groups.length,
  smartObjects: rows.length,
  linkedFiles: linkedById.size,
  hasGlobalEngineData: Object.prototype.hasOwnProperty.call(psd, 'engineData'),
  rows,
}, null, 2));
