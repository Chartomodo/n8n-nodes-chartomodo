# n8n-nodes-chartomodo

An [n8n](https://n8n.io/) community node for [ChartOmodo](https://chartomodo.com). It writes n8n items into a ChartOmodo dataset, and the charts built on that dataset (including the ones embedded in Notion) show the new rows. It also reads charts back: title, embed URL, and the plotted values.

## Installation

In n8n, open **Settings → Community Nodes → Install** and enter `n8n-nodes-chartomodo`. The n8n [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) covers the details.

Once installed, the node type is `n8n-nodes-chartomodo.chartOmodo`.

## Credentials

1. In ChartOmodo, go to **Settings → API** and create a token. API tokens need the Pro plan or higher.
2. In n8n, create a **ChartOmodo API** credential and paste the token.
3. Leave **Base URL** at `https://chartomodo.com`. It is the host only, without `/api/v1`.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Dataset | Create | Creates a dataset from the input items. |
| Dataset | Replace Rows | Replaces every row in the dataset with the input items, in one atomic request. |
| Dataset | Append Rows | Adds the input items as new rows. Large inputs are split into several requests. |
| Dataset | Get Many | Lists up to 500 datasets, newest first. |
| Chart | Get | Returns a chart's title, type and embed URL. The embed URL is null for a private chart that has no embed link yet. |
| Chart | Get Data | Returns a chart's categories and series values. |
| Chart | Get Many | Lists up to 500 charts. |

Dataset writes send all input items in one write, not one request per item: ten items into Append Rows is one append of ten rows. **Fields to Send** takes a comma-separated list such as `date, revenue` to send only those fields; leave it empty to send every field.

Chart Get and Get Data run once per input item. Both Get Many operations run once per execution, whatever the number of input items, and return at most 500 results with no pagination.

## Data rules

- Each item must be flat. Values can be text, numbers, true/false or empty. Flatten nested objects and arrays with a Set or Code node first.
- Send dates as ISO strings, for example `2026-01-31`.
- One request is at most 5 MB. A dataset holds at most 50,000 rows and 100 columns.
- The API allows 60 requests per minute per token. On a 429 or 503 answer, the node waits for the `Retry-After` time (5 seconds if absent, capped at 30) and retries, up to 3 times per request. It does not retry when the API is disabled or in maintenance.

## Retries and duplicates

- **Retry On Fail** (the node setting) is safe for Replace Rows and Append Rows. Each write carries an idempotency key, so the API ignores a retried request it already applied.
- **Retry** on a past execution in the Executions list starts a new execution with new keys. Append Rows appends the rows again.
- **Create** has no idempotency key. If the response is lost and Retry On Fail sends the request again, you can end up with two datasets.
- **Partial append failure.** When a large append is split and a later request fails, the earlier requests stay committed. The error description says how many rows were appended. With **Continue On Fail**, the output item has `error`, `code` and `appendedRows`. Retry On Fail skips the rows already appended; running the workflow again appends them again.

## Use as an AI Agent tool

The node can sit in the Tool slot of an n8n AI Agent, for example so the agent can read a chart with Get Data. On self-hosted n8n, community nodes are only offered as tools when the instance runs with:

```
N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

## Example workflows

Import these from [`examples/`](examples/) with **Import from File** in the workflow menu. Each expects a credential named `ChartOmodo account`: after import, select your credential in the ChartOmodo node, then pick a dataset or chart from the list.

- [`replace-rows.json`](examples/replace-rows.json): Manual Trigger, a Code node that returns three rows (`date`, `revenue`), then Replace Rows. Swap the Code node for your real source, such as a Google Sheets read on a Schedule Trigger.
- [`append-rows-in-loop.json`](examples/append-rows-in-loop.json): a Code node returns four rows, Loop Over Items passes them on two at a time, and Append Rows adds each batch. Each pass through the loop is a separate append, so both batches land in the dataset.
- [`ai-agent-chart-tool.json`](examples/ai-agent-chart-tool.json): a Chat Trigger feeds an AI Agent that has ChartOmodo (Chart → Get Data) as a tool, so it can answer questions about a chart's numbers. Add a chat model to the agent before running it.

## Compatibility

Tested with n8n 2.41.6.

## Links

- API reference: https://chartomodo.com/developers/api
- Support: support@chartomodo.com

## License

MIT
