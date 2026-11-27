export const VAT_RATE = 0.2;

export function orderTotal(subtotal: number): number {
	return Math.round(subtotal * (1 + VAT_RATE) * 100) / 100;
}
