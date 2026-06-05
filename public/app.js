let supplierProducts = [];
let originalXml = '';
let stonexProducts = [];
let comparisonRows = [];
let stoneXDataMode = 'none';

const $ = id => document.getElementById(id);
const logEl = $('log');

function passwordHeaders() {
  const value = $('password').value.trim();
  return value ? { 'x-app-password': value } : {};
}

function log(msg) {
  logEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + logEl.textContent;
}

async function apiJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...passwordHeaders() },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    let payload = {};
    try { payload = await res.json(); } catch (_) {}
    throw new Error(payload.error || payload.hint || res.statusText);
  }
  return res.json();
}

$('parseSupplier').addEventListener('click', async () => {
  try {
    const fd = new FormData();
    const file = $('supplierFile').files[0];
    if (file) fd.append('feed', file);
    const res = await fetch('/api/parse-supplier', { method: 'POST', headers: passwordHeaders(), body: fd });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    supplierProducts = data.products;
    originalXml = data.xml;
    $('supplierCount').textContent = data.count;
    log(`Supplier XML načteno: ${data.count} produktů.`);
  } catch (e) { log(`CHYBA supplier: ${e.message}`); }
});

$('fetchStoneX').addEventListener('click', async () => {
  try {
    $('fetchStoneX').disabled = true;
    stoneXDataMode = 'loading';
    $('stonexCountLabel').textContent = 'StoneX live produktů';
    $('stonexCount').textContent = '…';
    log('Stahuji StoneX katalog a detaily produktů...');
    const allowFallback = Boolean($('allowFallback') && $('allowFallback').checked);
    const data = await apiJson('/api/fetch-stonex', {
      catalogUrl: $('stonexUrl').value.trim(),
      maxDetails: Number($('maxDetails').value || 30),
      allowSeedFallback: allowFallback
    });
    stonexProducts = data.products || [];
    stoneXDataMode = data.fallbackUsed ? 'fallback' : 'live';
    $('stonexCount').textContent = data.count || 0;
    $('stonexCountLabel').textContent = data.fallbackUsed ? 'TEST fallback produktů' : 'StoneX live produktů';
    if (data.fallbackUsed) {
      log(`POZOR: Použit testovací fallback (${data.count} položek). Nejde o live StoneX katalog. Důvod: ${data.warning || 'neuvedeno'}`);
    } else {
      log(`StoneX LIVE načteno: ${data.count} produktů.`);
    }
  } catch (e) {
    stoneXDataMode = 'error';
    stonexProducts = [];
    $('stonexCount').textContent = '0';
    $('stonexCountLabel').textContent = 'StoneX live produktů';
    log(`CHYBA StoneX LIVE: ${e.message}`);
    log('Fallback je vypnutý. Zaškrtni ho pouze pro test workflow, ne pro ostrý export.');
  }
  finally { $('fetchStoneX').disabled = false; }
});

$('compareBtn').addEventListener('click', async () => {
  try {
    if (!supplierProducts.length || !stonexProducts.length) throw new Error('Nejdřív načti supplier XML i StoneX live data.');
    if (stoneXDataMode === 'fallback') throw new Error('Nelze porovnat pro ostrý export: používáš testovací fallback, ne live StoneX data.');
    const data = await apiJson('/api/compare', {
      supplierRows: supplierProducts,
      stonexRows: stonexProducts,
      options: {
        eurCzk: Number($('eurCzk').value),
        marginCoin: Number($('marginCoin').value),
        marginBarSmall: Number($('marginBarSmall').value),
        marginBarMid: Number($('marginBarMid').value),
        marginBarLarge: Number($('marginBarLarge').value)
      }
    });
    comparisonRows = data.rows;
    renderRows();
    log(`Porovnání hotovo: ${comparisonRows.filter(r => r.matched).length} spárováno.`);
  } catch (e) { log(`CHYBA porovnání: ${e.message}`); }
});

function renderRows() {
  const tbody = $('rows');
  tbody.innerHTML = '';
  if (!comparisonRows.length) {
    tbody.innerHTML = '<tr><td colspan="14" class="empty">Žádná data.</td></tr>';
    return;
  }
  comparisonRows.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" ${r.apply ? 'checked' : ''} data-k="apply" data-i="${i}"></td>
      <td class="${r.matched ? 'ok' : 'bad'}">${esc(r.code || '—')}</td>
      <td><a href="${esc(r.stonexUrl)}" target="_blank">${esc(r.stonexName || '')}</a></td>
      <td>${esc(r.supplierName || '')}</td>
      <td>${fmt(r.priceEur)}</td>
      <td>${fmt(r.stonexCzk)}</td>
      <td>${fmt(r.supplierPurchasePrice)}</td>
      <td><input type="number" step="0.01" value="${r.newPurchasePrice ?? ''}" data-k="newPurchasePrice" data-i="${i}"></td>
      <td>${fmt(r.supplierPrice)}</td>
      <td><input type="number" step="1" value="${r.newPrice ?? ''}" data-k="newPrice" data-i="${i}"></td>
      <td class="flexi">${r.newPrice != null ? fmt(Math.round(Number(r.newPrice) * 0.91)) : '—'}</td>
      <td>${fmt(r.availability)}</td>
      <td><input type="text" value="${escAttr(r.newManufacturer || '')}" data-k="newManufacturer" data-i="${i}"></td>
      <td><input type="text" value="${escAttr(r.newName || '')}" data-k="newName" data-i="${i}" style="min-width:280px"></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', e => {
      const i = Number(e.target.dataset.i);
      const k = e.target.dataset.k;
      if (k === 'apply') comparisonRows[i][k] = e.target.checked;
      else if (e.target.type === 'number') comparisonRows[i][k] = e.target.value === '' ? null : Number(e.target.value);
      else comparisonRows[i][k] = e.target.value;
      // Živý přepočet flexi buňky (−9 %) při změně Nového PRICE.
      if (k === 'newPrice') {
        const cell = e.target.closest('tr').querySelector('.flexi');
        const np = comparisonRows[i].newPrice;
        if (cell) cell.textContent = (np != null) ? fmt(Math.round(Number(np) * 0.91)) : '—';
      }
      updateStats();
    });
  });
  updateStats();
}

function updateStats() {
  $('matchedCount').textContent = comparisonRows.filter(r => r.matched).length;
  $('appliedCount').textContent = comparisonRows.filter(r => r.apply).length;
}

$('selectAll').addEventListener('click', () => { comparisonRows.forEach(r => { if (r.matched) r.apply = true; }); renderRows(); });
$('selectNone').addEventListener('click', () => { comparisonRows.forEach(r => r.apply = false); renderRows(); });

$('downloadXml').addEventListener('click', async () => {
  try {
    if (stoneXDataMode === 'fallback') throw new Error('Export z fallback dat je zakázaný. Načti live StoneX data.');
    if (!originalXml || !comparisonRows.length) throw new Error('Chybí původní XML nebo porovnání.');
    const res = await fetch('/api/generate-feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...passwordHeaders() },
      body: JSON.stringify({ originalXml, updates: comparisonRows })
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'productsSupplier-updated.xml';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log('XML vygenerováno a staženo.');
  } catch (e) { log(`CHYBA export: ${e.message}`); }
});

function fmt(v) { return v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toLocaleString('cs-CZ', { maximumFractionDigits: 2 }); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }
function escAttr(s) { return esc(s).replace(/`/g, '&#096;'); }
