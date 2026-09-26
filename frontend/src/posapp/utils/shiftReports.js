/* global frappe */

// The two shift reports are NOT the same control.
//
// The X report prints "Cash in Drawer" - the float plus cash taken less cash
// refunded - which IS the expected drawer, exactly. A supervisor who pulls one
// minutes before closing knows precisely what to declare, and the blind
// declaration the whole cash-up rests on is gone. So the X is HEAD OFFICE ONLY:
// nobody who counts a drawer may see it.
//
// The Z report is the declaration itself and prints automatically on close, so a
// supervisor must have it or she cannot finish a shift. It shows the variance
// only AFTER the figure is committed, which is the right way round.
//
// These lists mirror cakezone_erp/api/shift_reports.py. They decide what to SHOW;
// the server is the gate and refuses a hand-typed /printview URL too. Keep in step.
const HEAD_OFFICE_ROLES = ["Sales Manager", "Accounts Manager", "System Manager"];
const Z_ROLES = HEAD_OFFICE_ROLES.concat(["Supervisor"]);

function has(roles) {
	try {
		if (frappe.session?.user === "Administrator") return true;
		const mine = frappe.user_roles || frappe.boot?.user?.roles || [];
		return roles.some((r) => mine.includes(r));
	} catch (e) {
		// If we cannot tell, show nothing. The server refuses anyway, and an absent
		// button beats a button that errors in front of a customer.
		return false;
	}
}

/** Head office only - never a branch. */
export function maySeeXReport() {
	return has(HEAD_OFFICE_ROLES);
}

/** Supervisors and head office. Cashiers never. */
export function maySeeZReport() {
	return has(Z_ROLES);
}
