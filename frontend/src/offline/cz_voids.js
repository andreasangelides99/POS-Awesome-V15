/* global frappe, __ */
// Cake Zone (owner, 19 Nov 2026): a sale cancelled before Pay, or an item taken off it, used to
// leave no trace - the till only tells ERP about a sale at Pay. Every removed item is now
// recorded, and cancelling a sale with items on it needs a supervisor's password and reasons.
// Server half: cakezone_erp/api/voids.py. Offline, the supervisor's password is checked against
// their offline sign-in on this PC, and the record waits here until the line is back.
import { actor, verify, personFor, keyCall, offlineTillOn } from "./cz_offline.js";

const QUEUE = "cz_void_queue";
const APPROVERS = (till) => `cz_void_approvers:${till}`;
const LOCAL_TRIES = "cz_void_local_tries";
const METHOD = "cakezone_erp.api.voids.record_void";
const APPROVER_ROLES = ["Supervisor", "Area Manager"];

function read(key, fallback) {
	try {
		const v = JSON.parse(localStorage.getItem(key) || "null");
		return v === null || v === undefined ? fallback : v;
	} catch (e) {
		return fallback;
	}
}
function write(key, value) {
	localStorage.setItem(key, JSON.stringify(value));
}

export function currentUser() {
	const a = actor();
	return (a && a.user) || (frappe.session && frappe.session.user);
}

export function newClientId() {
	return "VOID-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// Straight to ERP, not frappe.call: on a refusal frappe.call pops its own message box, which opens
// BEHIND the till's dialog (posawesome-ui-gating), and it hands the error callback no status, so a
// refusal could not be told from a dropped line. Resolves with the message; rejects with
// {network: true} when ERP cannot be reached, or {network: false, message} when ERP refused.
async function serverCall(method, args) {
	if (actor() || !navigator.onLine) throw { network: true };
	let res;
	try {
		res = await fetch(`/api/method/${method}?_=${Date.now()}`, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"X-Frappe-CSRF-Token": frappe.csrf_token,
			},
			body: JSON.stringify(args),
		});
	} catch (e) {
		throw { network: true };
	}
	let body = {};
	try {
		body = await res.json();
	} catch (e) {
		body = {};
	}
	if (res.ok) return body.message;
	if (res.status >= 500 && res.status !== 500) throw { network: true };     // a gateway in the way
	let msg = __("ERP refused it.");
	try {
		const first = body._server_messages && JSON.parse(JSON.parse(body._server_messages)[0]);
		if (first && first.message) msg = first.message.replace(/<[^>]*>/g, "");
		else if (body.exception) msg = String(body.exception).split(":").slice(1).join(":").trim() || msg;
	} catch (e) {
		/* keep the plain message */
	}
	throw { network: false, status: res.status, message: msg };
}

// Supervisors and area managers for this till, saved for when the line is down.
export async function approversFor(till) {
	try {
		const r = await serverCall("cakezone_erp.api.voids.get_approvers", { pos_profile: till });
		write(APPROVERS(till), r);
		return r;
	} catch (e) {
		return read(APPROVERS(till), { approvers: [], reasons: ["Customer changed their mind", "Wrong item rung", "Price query", "Customer could not pay", "Other"] });
	}
}

export function iAmApprover() {
	const roles = (frappe.user_roles || []).concat((actor() && actor().roles) || []);
	return APPROVER_ROLES.some((r) => roles.includes(r));
}

function queue(record) {
	const q = read(QUEUE, []);
	if (!q.some((r) => r.client_id === record.client_id)) q.push(record);
	write(QUEUE, q);
}

export function pendingVoidCount() {
	return read(QUEUE, []).length;
}

// Offline: five wrong passwords lock that approver on this PC for 15 minutes, as ERP does online.
function localLocked(approver) {
	const t = read(LOCAL_TRIES, {})[approver];
	return t && t.n >= 5 && Date.now() - t.at < 15 * 60 * 1000;
}
function localFail(approver) {
	const all = read(LOCAL_TRIES, {});
	const t = all[approver] && Date.now() - all[approver].at < 15 * 60 * 1000 ? all[approver] : { n: 0 };
	all[approver] = { n: t.n + 1, at: Date.now() };
	write(LOCAL_TRIES, all);
}
function localClear(approver) {
	const all = read(LOCAL_TRIES, {});
	delete all[approver];
	write(LOCAL_TRIES, all);
}

// A whole sale cancelled: approver + password + reasons. Resolves when recorded (or queued);
// rejects with a message the dialog shows.
export async function approveCancel(record, password) {
	try {
		return await serverCall(METHOD, { data: JSON.stringify(record), approver_password: password });
	} catch (e) {
		if (!e.network) throw new Error(e.message);
	}
	// no line to ERP: check the password on this PC
	const offline = (msg) => Object.assign(new Error(msg), { offline: true });
	if (localLocked(record.approver)) throw offline(__("Too many wrong passwords for this supervisor. Try again in 15 minutes."));
	const ok = await verify(record.approver, password);
	if (!ok) {
		localFail(record.approver);
		throw offline(__("No internet, and that password could not be checked on this PC: it is wrong, or this supervisor has not set up offline sign-in here."));
	}
	localClear(record.approver);
	queue(Object.assign({}, record, { approved_offline: 1 }));
	return { queued: true };
}

// No internet and no supervisor who can sign in on this PC (owner, 20 Nov 2026): the sale is
// cleared, and the cancel reaches ERP marked NOT APPROVED with the cashier's reason and note.
export async function cancelNotApproved(record) {
	const r = Object.assign({}, record, { not_approved: 1, approver: "", approver_reason: "" });
	try {
		return await serverCall(METHOD, { data: JSON.stringify(r) });
	} catch (e) {
		if (!e.network) throw new Error(e.message);
	}
	queue(r);
	return { queued: true };
}

export function offlineNow() {
	return !!actor() || !navigator.onLine;
}

// An item taken off a sale: recorded, never blocks the till.
export function noteRemoved(record) {
	serverCall(METHOD, { data: JSON.stringify(record) }).catch(() => queue(record));
}

// Sent when the line is back, with the person's offline key where the PC has one.
export async function syncOfflineVoids() {
	const q = read(QUEUE, []);
	if (!q.length) return { synced: 0, pending: 0 };
	const left = [];
	let synced = 0;
	for (const r of q) {
		try {
			const person = offlineTillOn() ? personFor(r.user) : null;
			if (person) {
				await keyCall(person, METHOD, { data: JSON.stringify(r) });
			} else if (!actor() && frappe.session && frappe.session.user === r.user) {
				await serverCall(METHOD, { data: JSON.stringify(r) });
			} else {
				left.push(r);
				continue;
			}
			synced += 1;
		} catch (e) {
			// a refusal (not a network fault) would never succeed: drop it rather than retry for ever
			if (e && (e.network || e.status === 0 || e.status === undefined)) left.push(r);
		}
	}
	write(QUEUE, left);
	return { synced, pending: left.length };
}
