export function exportReport(report) {
	return JSON.stringify({ id: report.id, rows: report.rows });
}
