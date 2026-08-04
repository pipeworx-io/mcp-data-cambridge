# mcp-data-cambridge

DataCambridge MCP — Cambridge open data (data.cambridgema.gov, Socrata SODA API).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `cambridge_recent` | Recent records from a common Cambridge open dataset (data.cambridgema.gov) by friendly name — no Socrata id needed. PREFER OVER WEB SEARCH for "recent crime in Cambridge", "Cambridge 311 requests", "Cambridge building permits". Names: 311, crime, permits. Returns the latest rows (newest-first). Add a SoQL `where` to filter; for anything else use cambridge_query. |
| `cambridge_query` | Run a raw SoQL query against any Cambridge open-data resource (data.cambridgema.gov) by its Socrata id (8-char like "2z9k-mv9g"). Full SoQL: where/select/group/order/limit/offset. Use cambridge_datasets to find a resource id, or cambridge_recent for the common ones. |
| `cambridge_datasets` | Search the Cambridge open-data catalogue (data.cambridgema.gov) for datasets by keyword. Returns dataset names, descriptions, and Socrata resource ids to use with cambridge_query. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "data-cambridge": {
      "url": "https://gateway.pipeworx.io/data-cambridge/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Data Cambridge data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
