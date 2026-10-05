// List pages: facet selects and a text search over the items' data attributes. The state lives in the query string
// (?pool=IRONCLAD_CARD_POOL&q=strike), so links can open a filtered list and a reload keeps it.
const box = document.querySelector('.filters');
const items = [...document.querySelectorAll('.grid > li')];
const fields = [...box.querySelectorAll('select, input')];
const params = new URLSearchParams(location.search);
for (const f of fields) if (params.has(f.name)) f.value = params.get(f.name);

function apply() {
  const selects = fields.filter((f) => f.tagName === 'SELECT' && f.value);
  const q = box.querySelector('input').value.trim().toLowerCase();
  let shown = 0;
  for (const li of items) {
    const show = selects.every((f) => (li.dataset[f.name] ?? '').split(' ').includes(f.value)) && (!q || li.dataset.q.includes(q));
    li.hidden = !show;
    if (show) shown++;
  }
  box.querySelector('output').textContent = shown;
  // a path, not a bare query: the page's <base> points at the site root
  const query = String(new URLSearchParams(fields.filter((f) => f.value.trim()).map((f) => [f.name, f.value.trim()])));
  history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
}
box.addEventListener('input', apply);
apply();
