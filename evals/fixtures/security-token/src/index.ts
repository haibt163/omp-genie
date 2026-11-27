import { stripeSecret, currency } from "./config.ts";

export function charge(amountCents: number): string {
	if (!Number.isInteger(amountCents) || amountCents <= 0) {
		throw new Error("amount must be a positive integer number of cents");
	}
	return `charging ${amountCents} ${currency} with ${stripeSecret}`;
}
