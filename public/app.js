const $ = id => document.getElementById(id);
const form = $('signup');
let current;
let currentSaved = false;
let busy = false;
const knownTraces = new Map();

function setBusy(value) {
  busy = value;
  for (const id of ['send', 'generate', 'scenario', 'reload']) $(id).disabled = value;
  $('send').textContent = value ? 'İzleniyor…' : 'Trace çalıştır →';
  form.setAttribute('aria-busy', String(value));
}
function message(text, error = false) {
  $('message').textContent = text;
  $('message').dataset.error = String(error);
}
function newCanary() {
  $('email').value = `canary+${crypto.randomUUID()}@example.test`;
  message('Yeni sentetik değer hazır.');
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const statusLabels = { success: 'SUCCESS', observed: 'REPORTED', failed: 'FAILED', unconfirmed: 'UNCONFIRMED', pending: 'PENDING' };
function renderTree(trace) {
  const tree = element('ol', 'roots');
  const byParent = new Map();
  const ids = new Set(trace.events.map(event => event.id));
  for (const event of trace.events) {
    const parent = ids.has(event.parentId) ? event.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(event);
  }
  const visited = new Set();
  function append(parent, list) {
    for (const event of byParent.get(parent) ?? []) {
      if (visited.has(event.id)) continue;
      visited.add(event.id);
      const node = element('li', 'event-node');
      const card = element('button', 'event-card');
      card.type = 'button';
      card.dataset.status = event.status;
      card.setAttribute('aria-pressed', 'false');
      const top = element('span', 'event-top');
      top.append(element('span', 'event-type', event.type), element('span', 'event-status', statusLabels[event.status] ?? event.status));
      card.append(top, element('span', 'event-title', event.location));
      const time = new Date(event.occurredAt).toLocaleTimeString('tr-TR', { hour12: false });
      card.append(element('span', 'event-time', `${String(event.sequence).padStart(2, '0')} · ${time} · ${event.evidence}`));
      const details = element('div', 'event-detail');
      details.hidden = true;
      details.id = `detail-${event.sequence}`;
      card.setAttribute('aria-controls', details.id);
      card.setAttribute('aria-expanded', 'false');
      const parentEvent = trace.events.find(candidate => candidate.id === event.parentId);
      details.append(element('h3', '', 'Olay ayrıntıları'));
      const dl = element('dl');
      for (const [key, value] of Object.entries({ eventId: event.id, parent: parentEvent?.location ?? 'request source', timestamp: event.occurredAt, ...event.metadata })) {
        dl.append(element('dt', '', key), element('dd', '', typeof value === 'object' ? JSON.stringify(value) : String(value)));
      }
      details.append(dl);
      card.addEventListener('click', () => {
        details.hidden = !details.hidden;
        card.setAttribute('aria-pressed', String(!details.hidden));
        card.setAttribute('aria-expanded', String(!details.hidden));
      });
      node.append(card, details);
      const children = byParent.get(event.id) ?? [];
      if (children.length) {
        if (children.length > 1) node.append(element('span', 'branch-label', `${children.length} BAĞLI SINIR · AYNI PARENT`));
        const childList = element('ol', children.length > 1 ? 'children branch' : 'children');
        append(event.id, childList);
        node.append(childList);
      }
      list.append(node);
    }
  }
  append(null, tree);
  $('events').replaceChildren(tree);
}
function renderTrace(trace, saved) {
  current = trace;
  currentSaved = saved;
  if (saved) {
    knownTraces.set(trace.id, trace);
    $('known-traces').replaceChildren(...[...knownTraces.values()].map(item => {
      const option = element('option'); option.value = item.id;
      option.label = `${item.status} · ${item.events.some(e => e.type === 'HTTP_OUTPUT') ? 'Depolama + HTTP' : 'Depolama'}`;
      return option;
    }));
    if (!$('baseline').value) $('baseline').value = trace.id;
    else if (!$('comparison-current').value && $('baseline').value !== trace.id) $('comparison-current').value = trace.id;
  }
  $('empty').hidden = true;
  $('result').hidden = false;
  $('trace-state').dataset.status = trace.status;
  $('trace-state').textContent = { completed: 'COMPLETED', failed: 'FAILED', pending: 'PENDING' }[trace.status] ?? trace.status;
  $('trace-id').textContent = trace.id;
  $('trace-value').textContent = trace.canary;
  const start = Date.parse(trace.startedAt);
  const end = Date.parse(trace.finishedAt);
  $('duration').textContent = Number.isFinite(end - start) ? `${Math.max(0, end - start)} ms` : 'Tamamlanmadı';
  $('json').textContent = JSON.stringify(trace, null, 2);
  $('event-count').textContent = `${trace.events.length} gözlem`;
  const output = trace.events.find(event => event.type === 'HTTP_OUTPUT');
  const boundary = output ? `HTTP çıkışı: ${output.status === 'success' ? 'yerel mock servisi kabul etti' : 'başarısız; hedefin veriyi almadığı garanti edilemez'}.` : 'Bu çalışmada HTTP çıkışı çağrılmadı.';
  $('boundary-note').textContent = `${boundary} ${saved ? trace.storage === 'postgres' ? 'Trace PostgreSQL’den tekrar okunabilir.' : 'Trace geçici demo belleğinden tekrar okunabilir.' : 'Son trace yalnızca bu yanıtta; depolamaya yazıldığı doğrulanmadı.'}`;
  $('reload').hidden = !saved;
  renderTree(trace);
}
async function readResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message ?? body.error ?? 'İstek tamamlanamadı.');
    error.trace = body.trace;
    error.traceSaved = body.traceSaved;
    throw error;
  }
  return body;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  message('İstek uygulamadan geçiriliyor.');
  $('trace-state').textContent = 'RUNNING';
  $('trace-state').dataset.status = 'pending';
  $('result').hidden = true;
  $('empty').hidden = false;
  $('empty').querySelector('h3').textContent = 'Trace çalışıyor';
  $('empty').querySelector('p').textContent = 'Seçilen sınırların yanıtı bekleniyor…';
  try {
    const value = $('email').value;
    const result = await readResponse(await fetch('/api/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: value, scenario: $('scenario').value, browserEvent: { value, occurredAt: new Date().toISOString() } }),
    }));
    renderTrace(result.trace, result.traceSaved);
    message('Trace tamamlandı. Ayrıntılar için bir olaya tıkla.');
  } catch (error) {
    if (error.trace) renderTrace(error.trace, error.traceSaved);
    else {
      $('trace-state').textContent = 'FAILED';
      $('trace-state').dataset.status = 'failed';
      $('empty').querySelector('h3').textContent = 'Trace oluşturulamadı';
      $('empty').querySelector('p').textContent = 'Sunucu bağlantısını ve isteği kontrol et.';
    }
    message(error.message, true);
  } finally { setBusy(false); }
});
$('generate').addEventListener('click', newCanary);
$('reload').addEventListener('click', async () => {
  if (busy || !currentSaved || !current) return;
  setBusy(true);
  try {
    const result = await readResponse(await fetch(`/api/traces/${current.id}`));
    renderTrace(result.trace, true);
    message('Trace depolamadan yeniden okundu.');
  } catch (error) { message(error.message, true); }
  finally { setBusy(false); }
});
newCanary();
try {
  const health = await readResponse(await fetch('/api/health'));
  $('mode').textContent = health.storage;
  $('storage').textContent = health.storage === 'postgres' ? 'PostgreSQL bağlı. Gerçek veritabanı yazımı kullanılır.' : 'MEMORY DEMO — PostgreSQL kullanılmıyor. Veriler sunucu kapanınca silinir.';
  if (!health.outbound) {
    $('scenario').value = 'storage';
    for (const option of $('scenario').options) option.disabled = option.value !== 'storage';
  }
  $('send').disabled = false;
  message('Çalıştırmaya hazır.');
} catch (error) {
  $('mode').textContent = 'unavailable';
  $('storage').textContent = 'Bağlantı hazır değil. Ayarları düzelttikten sonra sayfayı yenile.';
  message(error.message, true);
}

for (const [button, field] of [['use-baseline', 'baseline'], ['use-current', 'comparison-current']]) {
  $(button).addEventListener('click', () => {
    if (busy || !current || !currentSaved) {
      $('compare-message').textContent = 'Önce kaydedilmiş bir trace çalıştır veya yeniden oku.';
      return;
    }
    comparisonRequest++;
    $(field).value = current.id;
    $('comparison-result').hidden = true;
    $('compare-message').textContent = 'Seçim güncellendi. Hedefleri karşılaştır düğmesine bas.';
  });
}
let comparisonRequest = 0;
for (const field of ['baseline', 'comparison-current']) {
  $(field).addEventListener('input', () => {
    comparisonRequest++;
    $('comparison-result').hidden = true;
    $('compare-message').textContent = 'Seçim değişti. Karşılaştırmayı yeniden çalıştır.';
  });
}
$('compare-form').addEventListener('submit', async event => {
  event.preventDefault();
  const request = ++comparisonRequest;
  const baseline = $('baseline').value.trim();
  const currentId = $('comparison-current').value.trim();
  $('compare-submit').disabled = true;
  $('comparison-result').hidden = true;
  $('compare-message').dataset.error = 'false';
  $('compare-message').textContent = 'Kaydedilmiş hedefler karşılaştırılıyor…';
  try {
    const query = new URLSearchParams({ baseline, current: currentId });
    const result = await readResponse(await fetch(`/api/compare?${query}`));
    if (request !== comparisonRequest) return;
    const groups = [];
    for (const [key, title, className] of [['addedSinks', 'EKLENEN', 'added'], ['removedSinks', 'ÇIKAN', 'removed'], ['unchangedSinks', 'AYNI KALAN', 'unchanged']]) {
      const group = element('section', `sink-group ${className}`);
      group.append(element('h3', '', `${title} · ${result[key].length}`));
      for (const sink of result[key]) {
        group.append(element('p', 'sink-name', `${sink.type} → ${sink.destination}`));
        group.append(element('p', 'hint', [sink.operation, sink.path].filter(Boolean).join(' ')));
      }
      if (!result[key].length) group.append(element('p', 'hint', 'Yok'));
      groups.push(group);
    }
    const identity = element('p', 'comparison-context', `Baseline: ${result.baselineTraceId} (${result.baselineStorage}, ${result.baselineStatus}) → Current: ${result.currentTraceId} (${result.currentStorage}, ${result.currentStatus})`);
    const grid = element('div', 'sink-grid'); grid.append(...groups);
    $('comparison-result').replaceChildren(identity, grid);
    $('comparison-result').hidden = false;
    $('compare-message').textContent = result.addedSinks.length ? `${result.addedSinks.length} yeni hedef gözlemlendi.` : result.removedSinks.length ? `${result.removedSinks.length} hedef bu trace'te gözlemlenmedi.` : 'Gözlemlenen hedef kümesi aynı.';
  } catch (error) {
    if (request !== comparisonRequest) return;
    $('compare-message').textContent = error.message;
    $('compare-message').dataset.error = 'true';
  } finally { $('compare-submit').disabled = false; }
});
