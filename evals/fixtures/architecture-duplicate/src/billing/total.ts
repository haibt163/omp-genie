export const TAX_RATE = 0.21;

export function invoiceTotal(subtotal: number): number {
	return Math.round(subtotal * (1 + TAX_RATE) * 100) / 100;
}
