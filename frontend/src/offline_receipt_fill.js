// Cake Zone (10 Nov 2026): an offline sale is built in the browser and lacks what the server
// writes onto an invoice when it saves one - a number, the paid amount, the change and the VAT
// rows. The receipt layout prints all four, so offline it printed "Change NaN", a blank Sale#
// and no VAT line. Fill them here, the way the server would, so the offline slip matches.
// No imports: kept plain so it can be tested on its own.

function num(v) {
	const x = typeof v === "number" ? v : parseFloat(v);
	return Number.isFinite(x) ? x : 0;
}

function cents(v) {
	return Math.round(v * 100) / 100;
}

function stamp(doc, now) {
	const d = String(doc.posting_date || "");
	const t = String(doc.posting_time || "");
	const dd = d.length >= 10 ? d.slice(8, 10) + d.slice(5, 7) : "";
	const tt = t.replace(/[^0-9]/g, "").slice(0, 6);
	if (dd && tt.length === 6) return `${dd}-${tt}`;
	const p = (n) => String(n).padStart(2, "0");
	return `${p(now.getDate())}${p(now.getMonth() + 1)}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export default function fillOfflineReceipt(doc, taxTemplate, now = new Date()) {
	if (!doc) return doc;
	// An offline sale carries no posting_time, and the layout's `|string` filter CRASHES on a
	// missing value in nunjucks - which threw the whole slip back to POS Awesome's own layout.
	// That was the "entirely different" offline receipt (owner, 10 Nov 2026).
	const p = (n) => String(n).padStart(2, "0");
	if (!doc.posting_date) doc.posting_date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
	if (!doc.posting_time) doc.posting_time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
	for (const f of ["pos_profile", "owner", "customer", "company"]) if (doc[f] == null) doc[f] = "";
	for (const it of doc.items || []) {
		if (it.item_code == null) it.item_code = "";
		if (it.item_name == null) it.item_name = it.item_code;
	}
	for (const pay of doc.payments || []) if (pay.mode_of_payment == null) pay.mode_of_payment = "";
	const due = num(doc.rounded_total) || num(doc.grand_total);
	const paid = (doc.payments || []).reduce((s, p) => s + num(p.amount), 0);
	if (!(num(doc.paid_amount) > 0)) doc.paid_amount = cents(paid);
	if (!(num(doc.change_amount) > 0)) doc.change_amount = cents(Math.max(0, paid - due));
	// The real number arrives when the sale reaches ERP; until then the slip says so.
	if (!doc.name) doc.name = `OFFLINE-${stamp(doc, now)}`;
	const hasVat = (doc.taxes || []).some((t) => num(t.tax_amount));
	if (!hasVat && due && taxTemplate && Array.isArray(taxTemplate.taxes)) {
		doc.taxes = taxTemplate.taxes
			.filter((t) => num(t.rate))
			.map((t) => ({
				description: t.description,
				rate: t.rate,
				tax_amount: cents(
					t.included_in_print_rate ? (due * num(t.rate)) / (100 + num(t.rate)) : (due * num(t.rate)) / 100,
				),
			}));
	}
	return doc;
}
