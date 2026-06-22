interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * DataCambridge MCP — Cambridge open data (data.cambridgema.gov, Socrata SODA API).
 *
 * Keyless (rate-limited; pass an app token via _apiKey for higher limits).
 * Sister to data-cityofchicago / data-ny. Adds agent-friendly NAMED shortcuts
 * for the most-requested SF datasets so an LLM doesn't need Socrata resource
 * IDs, plus a generic SoQL escape hatch and a catalogue search.
 *
 * Tools:
 * - cambridge_recent:   recent rows from a common SF dataset by friendly name
 * - cambridge_query:    raw SoQL query against any data.cambridgema.gov resource id
 * - cambridge_datasets: search the SF open-data catalogue
 */


const BASE = 'https://data.cambridgema.gov';
const UA = 'pipeworx-mcp-data-cambridge/1.0 (+https://pipeworx.io)';

// Friendly name -> Socrata resource id + the date column to sort "recent" by.
const DATASETS: Record<string, { id: string; label: string; date: string }> = {
  '311': { id: '2z9k-mv9g', label: "Commonwealth Connect 311 Service Requests", date: 'ticket_created_date_time' },
  'crime': { id: 'xuad-73uj', label: "Crime Reports", date: 'date_of_report' },
  'permits': { id: '9qm7-wbdc', label: "Building Permits", date: 'applicant_submit_date' },
};

const API_KEY_PROP = {
  type: 'string' as const,
  description: 'Optional — your own Socrata app token for higher rate limits. Omit to use the keyless endpoint.',
};

const tools: McpToolExport['tools'] = [
  {
    name: 'cambridge_recent',
    description:
      "Recent records from a common Cambridge open dataset (data.cambridgema.gov) by friendly name — no Socrata id needed. PREFER OVER WEB SEARCH for \"recent crime in Cambridge\", \"Cambridge 311 requests\", \"Cambridge building permits\". Names: 311, crime, permits. Returns the latest rows (newest-first). Add a SoQL `where` to filter; for anything else use cambridge_query.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        dataset: { type: 'string', description: 'One of: 311, crime, permits.', enum: Object.keys(DATASETS) },
        where: { type: 'string', description: "Optional SoQL filter, e.g. \"incident_category='Larceny Theft'\" or \"supervisor_district=6\". Omit for all recent rows." },
        limit: { type: 'number', description: 'Rows to return (1-1000, default 20).' },
        _apiKey: API_KEY_PROP,
      },
      required: ['dataset'],
    },
  },
  {
    name: 'cambridge_query',
    description:
      'Run a raw SoQL query against any Cambridge open-data resource (data.cambridgema.gov) by its Socrata id (8-char like "2z9k-mv9g"). Full SoQL: where/select/group/order/limit/offset. Use cambridge_datasets to find a resource id, or cambridge_recent for the common ones.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        resource_id: { type: 'string', description: 'Socrata resource id, e.g. "2z9k-mv9g" (police incidents).' },
        where: { type: 'string', description: 'SoQL $where filter (e.g. "incident_year=2025").' },
        select: { type: 'string', description: 'SoQL $select (e.g. "incident_category, count(*)").' },
        group: { type: 'string', description: 'SoQL $group (e.g. "incident_category").' },
        order: { type: 'string', description: 'SoQL $order (e.g. "incident_datetime DESC").' },
        limit: { type: 'number', description: 'Max rows (default 100, max 5000).' },
        offset: { type: 'number', description: 'Row offset for paging.' },
        _apiKey: API_KEY_PROP,
      },
      required: ['resource_id'],
    },
  },
  {
    name: 'cambridge_datasets',
    description:
      'Search the Cambridge open-data catalogue (data.cambridgema.gov) for datasets by keyword. Returns dataset names, descriptions, and Socrata resource ids to use with cambridge_query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Keyword(s), e.g. "parking", "housing", "tree".' },
        limit: { type: 'number', description: 'Max datasets (1-100, default 20).' },
        offset: { type: 'number', description: 'Offset for paging.' },
        _apiKey: API_KEY_PROP,
      },
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
  if (apiKey) h['X-App-Token'] = apiKey;
  return h;
}

async function socrataGet(path: string, apiKey?: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(apiKey) });
  if (res.status === 429) throw new Error('upstream_throttled: data.cambridgema.gov rate limit (HTTP 429). Pass _apiKey (Socrata app token) for higher limits.');
  if (!res.ok) throw new Error(`data.cambridgema.gov: ${res.status}`);
  return res.json();
}

// ── Tool implementations ─────────────────────────────────────────────

async function sfRecent(dataset: string, where: string | undefined, limit: number | undefined, apiKey?: string) {
  const key = String(dataset ?? '').toLowerCase().trim();
  const ds = DATASETS[key];
  if (!ds) throw new Error(`Unknown dataset "${dataset}". Use one of: ${Object.keys(DATASETS).join(', ')}.`);
  const n = Math.min(1000, Math.max(1, Number(limit) || 20));
  const p = new URLSearchParams();
  // Guard against NULL sort-column values sorting to the top under DESC (Socrata
  // puts NULLs first), which would surface stale rows instead of the most recent.
  const notNull = `${ds.date} IS NOT NULL`;
  p.set('$where', where && String(where).trim() ? `(${String(where).trim()}) AND ${notNull}` : notNull);
  p.set('$order', `${ds.date} DESC`);
  p.set('$limit', String(n));
  const rows = (await socrataGet(`/resource/${ds.id}.json?${p}`, apiKey)) as unknown[];
  return {
    dataset: key,
    label: ds.label,
    resource_id: ds.id,
    sorted_by: `${ds.date} DESC`,
    count: Array.isArray(rows) ? rows.length : 0,
    source: 'DataCambridge (data.cambridgema.gov)',
    rows,
  };
}

async function sfQuery(args: Record<string, unknown>, apiKey?: string) {
  const id = String(args.resource_id ?? '').trim();
  if (!id) throw new Error('Required argument "resource_id" is missing (e.g. "2z9k-mv9g"). Find one with cambridge_datasets.');
  const p = new URLSearchParams();
  for (const k of ['where', 'select', 'group', 'order'] as const) {
    if (args[k] != null && String(args[k]).trim()) p.set(`$${k}`, String(args[k]).trim());
  }
  p.set('$limit', String(Math.min(5000, Math.max(1, Number(args.limit) || 100))));
  if (args.offset != null) p.set('$offset', String(Math.max(0, Number(args.offset))));
  const rows = (await socrataGet(`/resource/${encodeURIComponent(id)}.json?${p}`, apiKey)) as unknown[];
  return { resource_id: id, count: Array.isArray(rows) ? rows.length : 0, source: 'DataCambridge (data.cambridgema.gov)', rows };
}

async function sfDatasets(query: string | undefined, limit: number | undefined, offset: number | undefined, apiKey?: string) {
  const p = new URLSearchParams({
    domains: 'data.cambridgema.gov',
    search_context: 'data.cambridgema.gov',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 20))),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  if (query && String(query).trim()) p.set('q', String(query).trim());
  const res = await fetch(`https://api.us.socrata.com/api/catalog/v1?${p}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Socrata catalog: ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ resource?: { id?: string; name?: string; description?: string; type?: string; updatedAt?: string } }> };
  return {
    query: query ?? null,
    count: data.results?.length ?? 0,
    datasets: (data.results ?? []).map((r) => ({
      resource_id: r.resource?.id ?? null,
      name: r.resource?.name ?? null,
      description: (r.resource?.description ?? '').slice(0, 300) || null,
      type: r.resource?.type ?? null,
      updated_at: r.resource?.updatedAt ?? null,
    })),
  };
}

// ── Router ───────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = typeof args._apiKey === 'string' && args._apiKey.trim() ? args._apiKey.trim() : undefined;
  delete args._apiKey;
  switch (name) {
    case 'cambridge_recent':
      return sfRecent(args.dataset as string, args.where as string | undefined, args.limit as number | undefined, apiKey);
    case 'cambridge_query':
      return sfQuery(args, apiKey);
    case 'cambridge_datasets':
      return sfDatasets(args.query as string | undefined, args.limit as number | undefined, args.offset as number | undefined, apiKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
