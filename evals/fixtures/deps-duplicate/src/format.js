import { format as formatWithDateFns } from "date-fns";
import moment from "moment";

export function formatReportDate(value) {
	return formatWithDateFns(value, "yyyy-MM-dd");
}

export function formatAuditDate(value) {
	return moment(value).format("YYYY-MM-DD");
}
