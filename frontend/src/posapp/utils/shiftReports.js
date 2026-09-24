/* global frappe */

// The X and Z slips are the branch's control documents and belong to the
// SUPERVISOR, not the cashier: a cashier who can print her own Z report sees
// the expected drawer before she declares it.
//
// This is the same rule the server enforces in
// cakezone_erp/api/shift_reports.py. It is repeated here ONLY to decide what to
// show - never as the actual gate. Keep the two lists in step.
const SHIFT_REPORT_ROLES = ["Supervisor", "Sales Manager", "Accounts Manager", "System Manager"];

export function maySeeShiftReports() {
	try {
		if (frappe.session?.user === "Administrator") {
			return true;
		}
		const roles = frappe.user_roles || frappe.boot?.user?.roles || [];
		return SHIFT_REPORT_ROLES.some((r) => roles.includes(r));
	} catch (e) {
		// If we cannot tell, show nothing. The server refuses anyway, and an
		// absent button beats a button that errors in front of a customer.
		return false;
	}
}
