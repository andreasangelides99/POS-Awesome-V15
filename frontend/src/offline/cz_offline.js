/* global frappe, __ */
// Cake Zone offline till (the owner, 10 Nov 2026): sign in, open a shift and trade with the
// internet down, then sync by itself when it returns. Server half: cakezone_erp/api/offline_till.py.
//
// Everything here is OFF unless the site's boot says cz_offline_till (site_config), so this
// bundle behaves exactly as before anywhere the flag is not set.
//
// What the PC keeps, in localStorage (a Clear Cache keeps every cz_offline_* key):
//   cz_offline_people      person -> their key for this PC, and a PBKDF2 hash of their password
//   cz_offline_profile:<till>   the till's profile bundle, saved at every online opening
//   cz_offline_openings    shifts opened offline that the server has not seen yet
//   cz_offline_shift_map   offline shift id -> the real shift's name, once synced
// and in sessionStorage the person signed in offline (cz_offline_actor).
import { getOpeningStorage, setOpeningStorage, memory } from "./cache.js";

const PEOPLE = "cz_offline_people";
const OPENINGS = "cz_offline_openings";
const SHIFT_MAP = "cz_offline_shift_map";
const CLOSINGS = "cz_offline_closings";
const ACTOR = "cz_offline_actor";
const PROFILE = (name) => `cz_offline_profile:${name}`;
const ITERATIONS = 150000;

export function offlineTillOn() {
	return !!(typeof frappe !== "undefined" && frappe.boot && frappe.boot.cz_offline_till);
}

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

function device() {
	return read("cz_till_device", null) || {};
}

export function boundTill() {
	return device().pos_profile || null;
}

// ---- the password check the PC can do on its own -------------------------------------------

function toB64(bytes) {
	return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromB64(text) {
	return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function derive(password, salt, iterations) {
	const material = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt: fromB64(salt), iterations, hash: "SHA-256" },
		material,
		256,
	);
	return toB64(bits);
}

export function people() {
	return read(PEOPLE, {});
}

export function peopleForTill(till) {
	return Object.values(people())
		.filter((p) => p.pos_profile === till)
		.sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
}

export function isEnrolled(user) {
	const p = people()[user];
	return !!(p && boundTill() && p.pos_profile === boundTill());
}

// Online, once per person per PC: the server checks the password and issues a key.
export async function enroll(password) {
	const device_id = device().device_id;
	if (!device_id) {
		throw new Error(__("This PC is not set up as a till yet. A supervisor sets it up at /till-setup."));
	}
	const r = await frappe.call({
		method: "cakezone_erp.api.offline_till.enroll",
		args: { device_id, password },
	});
	const k = r && r.message;
	if (!k || !k.key_id) throw new Error(__("The server did not issue a key."));
	const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
	const verifier = await derive(password, salt, ITERATIONS);
	const all = people();
	all[k.user] = {
		user: k.user,
		full_name: k.full_name,
		roles: k.roles,
		pos_profile: k.pos_profile,
		key_id: k.key_id,
		secret: k.secret,
		salt,
		iterations: ITERATIONS,
		verifier,
		enrolled_on: new Date().toISOString(),
	};
	write(PEOPLE, all);
	return all[k.user];
}

// Offline: the password is checked against the PC's own copy. Nothing leaves the PC.
export async function verify(user, password) {
	const p = people()[user];
	if (!p || !password) return null;
	const v = await derive(password, p.salt, p.iterations || ITERATIONS);
	return v === p.verifier ? p : null;
}

// ---- who is selling, while signed in offline -----------------------------------------------

export function actor() {
	try {
		return JSON.parse(sessionStorage.getItem(ACTOR) || "null");
	} catch (e) {
		return null;
	}
}

// The page was loaded from the PC's copy, so frappe.session still names whoever loaded it
// last. Point it at the person who signed in, so the till treats them as the user: their
// roles decide refunds and reports, and their name goes on the shift and the sales.
export function applyActor() {
	const a = actor();
	if (!a || typeof frappe === "undefined") return;
	frappe.session.user = a.user;
	frappe.session.user_fullname = a.full_name;
	frappe.user_roles = a.roles || [];
	if (frappe.boot && frappe.boot.user) {
		frappe.boot.user.roles = a.roles || [];
		frappe.boot.user.name = a.user;
	}
}

export function setActor(person) {
	sessionStorage.setItem(
		ACTOR,
		JSON.stringify({ user: person.user, full_name: person.full_name, roles: person.roles || [] }),
	);
	applyActor();
}

export function clearActor() {
	sessionStorage.removeItem(ACTOR);
}

// ---- the till's profile, kept so a shift can open with no server ---------------------------

export function rememberProfile(data) {
	if (!offlineTillOn() || !data || !data.pos_profile || !data.pos_profile.name) return;
	try {
		const { pos_opening_shift, ...bundle } = JSON.parse(JSON.stringify(data));
		write(PROFILE(data.pos_profile.name), bundle);
	} catch (e) {
		console.warn("Could not keep the till's profile for offline use", e);
	}
}

export function profileBundle(name) {
	return read(PROFILE(name), null);
}

// What to do after an offline sign-in, given what the PC already holds.
//   { resume: data }   this person's shift is open on this till: carry on
//   { blocked: text }  someone else's shift is open on this till
//   { open: true }     no shift open: open one
export function afterSignIn() {
	const a = actor();
	const cur = getOpeningStorage();
	const shift = cur && cur.pos_opening_shift;
	if (shift && shift.name && shift.status !== "Closed") {
		if (shift.user === a.user) return { resume: cur };
		const who = (people()[shift.user] || {}).full_name || shift.user;
		return {
			blocked: __(
				"{0}'s shift is still open on this till. {0} signs in to carry on selling; the shift is closed once the internet is back.",
				[who],
			),
		};
	}
	return { open: true };
}

export function openOffline({ pos_profile, company, balance_details }) {
	const a = actor();
	if (!a) throw new Error(__("Sign in first."));
	const bundle = profileBundle(pos_profile);
	if (!bundle) {
		throw new Error(
			__("{0} has never been opened online on this PC, so it cannot open offline yet.", [pos_profile]),
		);
	}
	const client_id = "OFF-" + crypto.randomUUID();
	const now = frappe.datetime.now_datetime();
	const balances = JSON.parse(JSON.stringify(balance_details || []));
	const queue = read(OPENINGS, []);
	queue.push({ client_id, user: a.user, pos_profile, company, period_start_date: now, balance_details: balances });
	write(OPENINGS, queue);
	const data = JSON.parse(JSON.stringify(bundle));
	data.pos_opening_shift = {
		doctype: "POS Opening Shift",
		name: client_id,
		user: a.user,
		pos_profile,
		company,
		period_start_date: now,
		posting_date: now.slice(0, 10),
		status: "Open",
		docstatus: 1,
		balance_details: balances,
		cz_offline: 1,
	};
	return data;
}

export function pendingOpeningCount() {
	return read(OPENINGS, []).length;
}

export function realShift(name) {
	if (name && String(name).startsWith("OFF-")) return read(SHIFT_MAP, {})[name] || null;
	return name;
}

// ---- stock: warn, never refuse, while offline (the owner, 10 Nov 2026) ---------------------

export function sellPastStock() {
	if (!offlineTillOn()) return false;
	const offline = !navigator.onLine || window.serverOnline === false;
	return offline;
}

// ---- sending the queue with the right person's key -----------------------------------------

function serverText(body) {
	try {
		if (body && body._server_messages) {
			return JSON.parse(body._server_messages)
				.map((m) => {
					try {
						return JSON.parse(m).message || "";
					} catch (e) {
						return String(m);
					}
				})
				.join(" ")
				.replace(/<[^>]*>/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}
		if (body && body.exception) return String(body.exception);
	} catch (e) {
		/* fall through */
	}
	return "";
}

export async function keyCall(person, method, args) {
	const res = await fetch(`/api/method/${method}`, {
		method: "POST",
		credentials: "omit",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			Authorization: `cztill ${person.key_id}:${person.secret}`,
		},
		body: JSON.stringify(args),
	});
	let body = null;
	try {
		body = await res.json();
	} catch (e) {
		body = null;
	}
	if (!res.ok) {
		const err = new Error(serverText(body) || `The server answered ${res.status}.`);
		err.status = res.status;
		err.body = body;
		throw err;
	}
	return body;
}

export function personFor(user) {
	return (user && people()[user]) || null;
}

// Openings first: a sale cannot reach the server before its shift does.
export async function syncOfflineOpenings() {
	const queue = read(OPENINGS, []);
	const result = { synced: 0, pending: 0, conflicts: [], errors: [] };
	if (!queue.length) return result;
	const map = read(SHIFT_MAP, {});
	const left = [];
	for (const o of queue) {
		const person = personFor(o.user);
		if (!person) {
			left.push(o);
			result.errors.push(__("No offline key on this PC for {0}.", [o.user]));
			continue;
		}
		try {
			const r = await keyCall(person, "cakezone_erp.api.offline_till.sync_opening", {
				client_id: o.client_id,
				pos_profile: o.pos_profile,
				company: o.company,
				period_start_date: o.period_start_date,
				balance_details: JSON.stringify(o.balance_details || []),
			});
			const m = r.message;
			map[o.client_id] = m.pos_opening_shift.name;
			write(SHIFT_MAP, map);
			const cur = getOpeningStorage();
			if (cur && cur.pos_opening_shift && cur.pos_opening_shift.name === o.client_id) {
				setOpeningStorage({ ...cur, pos_opening_shift: m.pos_opening_shift });
			}
			if (m.conflict) result.conflicts.push(m.conflict);
			result.synced += 1;
		} catch (e) {
			left.push(o);
			result.errors.push(e.message);
		}
	}
	write(OPENINGS, left);
	result.pending = left.length;
	return result;
}

// ---- closing a shift offline (step 2, 10 Nov 2026) ----------------------------------------

const DENOMINATIONS = ["custom_n_r200", "custom_n_r100", "custom_n_r50", "custom_n_r20", "custom_n_r10",
	"custom_n_r5", "custom_n_r2", "custom_n_r1", "custom_n_c50", "custom_n_c20", "custom_n_c10"];

// What the closing window needs, built on the PC. The expected figures are not known here and
// are hidden from the branch anyway (hide_expected_amount); the server works them out from the
// synced sales when the close arrives.
export function offlineClosingData(profile, shift) {
	const modes = [];
	const add = (m) => m && !modes.includes(m) && modes.push(m);
	(profile && profile.payments ? profile.payments : []).forEach((p) => add(p.mode_of_payment));
	(shift && shift.balance_details ? shift.balance_details : []).forEach((b) => add(b.mode_of_payment));
	const opening = {};
	(shift && shift.balance_details ? shift.balance_details : []).forEach((b) => (opening[b.mode_of_payment] = b.amount));
	const rows = modes.map((m) => ({ mode_of_payment: m, opening_amount: opening[m] || 0, expected_amount: 0, closing_amount: 0 }));
	return {
		doctype: "POS Closing Shift",
		pos_opening_shift: shift.name,
		pos_profile: profile.name,
		user: shift.user,
		period_start_date: shift.period_start_date,
		payment_reconciliation: rows,
		cz_offline: 1,
	};
}

export function closeOffline(data) {
	const a = actor();
	const counted_by = (a && a.user) || frappe.session.user;
	const denominations = {};
	DENOMINATIONS.forEach((k) => {
		if (data[k] !== undefined && data[k] !== null && data[k] !== "") denominations[k] = parseFloat(data[k]) || 0;
	});
	const closing_amounts = {};
	(data.payment_reconciliation || []).forEach((r) => (closing_amounts[r.mode_of_payment] = parseFloat(r.closing_amount) || 0));
	const queue = read(CLOSINGS, []);
	queue.push({
		client_id: "OFFC-" + crypto.randomUUID(),
		opening_shift: data.pos_opening_shift,
		counted_by,
		period_end_date: frappe.datetime.now_datetime(),
		denominations,
		closing_amounts,
	});
	write(CLOSINGS, queue);
}

export function pendingClosingCount() {
	return read(CLOSINGS, []).length;
}

// Closes last: only once every sale of that shift has left the PC, so ERP's expected figures
// include them all. A shift still unsynced, or refused for a reason worth retrying, waits.
export async function syncOfflineClosings() {
	const queue = read(CLOSINGS, []);
	const result = { synced: 0, pending: 0, conflicts: [], errors: [] };
	if (!queue.length) return result;
	const map = read(SHIFT_MAP, {});
	const left = [];
	for (const c of queue) {
		const real = String(c.opening_shift).startsWith("OFF-") ? map[c.opening_shift] : c.opening_shift;
		const salesWaiting = (memory.offline_invoices || []).some((e) => {
			const s = e && e.invoice && e.invoice.posa_pos_opening_shift;
			return s === c.opening_shift || (real && s === real);
		});
		const person = personFor(c.counted_by);
		if (salesWaiting || !real || !person) {
			if (!person) result.errors.push(__("No offline key on this PC for {0}.", [c.counted_by]));
			left.push(c);
			continue;
		}
		try {
			const r = await keyCall(person, "cakezone_erp.api.offline_till.sync_closing", {
				client_id: c.client_id,
				opening_shift: real,
				period_end_date: c.period_end_date,
				denominations: JSON.stringify(c.denominations || {}),
				closing_amounts: JSON.stringify(c.closing_amounts || {}),
			});
			if (r.message && r.message.conflict) result.conflicts.push(r.message.conflict);
			result.synced += 1;
		} catch (e) {
			left.push(c);
			result.errors.push(e.message);
		}
	}
	write(CLOSINGS, left);
	result.pending = left.length;
	return result;
}
