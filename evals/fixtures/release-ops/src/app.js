export function balance(entries) {
	return entries.reduce((total, entry) => total + entry.amount, 0);
}
