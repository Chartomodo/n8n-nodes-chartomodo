import type { IDataObject } from 'n8n-workflow';

/** Bytes of the JSON the API will receive (its body cap is in bytes). */
export function jsonBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/** `fields` = comma-separated column names; empty = send the item as-is. A listed column the item lacks is sent as null. */
export function pickFields(json: IDataObject, fields: string): IDataObject {
	const names = fields
		.split(',')
		.map((f) => f.trim())
		.filter(Boolean);
	if (names.length === 0) return json;
	const out: IDataObject = {};
	for (const name of names) out[name] = json[name] ?? null;
	return out;
}

/**
 * Splits rows into in-order chunks whose `{"rows":[…]}` body stays under
 * `maxBytes`. A single row over the budget goes alone; the API rejects it with
 * a clear 413 rather than this looping forever.
 */
export function chunkRows(rows: IDataObject[], maxBytes: number): IDataObject[][] {
	const chunks: IDataObject[][] = [];
	let current: IDataObject[] = [];
	let size = jsonBytes({ rows: [] });
	for (const row of rows) {
		const rowSize = jsonBytes(row) + 1; // + comma
		if (current.length > 0 && size + rowSize > maxBytes) {
			chunks.push(current);
			current = [];
			size = jsonBytes({ rows: [] });
		}
		current.push(row);
		size += rowSize;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}
