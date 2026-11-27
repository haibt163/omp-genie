export function dedupeEvents(events) {
	const result = [];
	for (const event of events) {
		const seen = result.some(existing => existing.id === event.id);
		if (!seen) result.push(event);
	}
	return result;
}
