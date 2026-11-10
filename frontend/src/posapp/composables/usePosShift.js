import { ref, getCurrentInstance } from "vue";
import {
    initPromise,
    checkDbHealth,
    getOpeningStorage,
    setOpeningStorage,
    clearOpeningStorage,
    setTaxTemplate,
    offlineTillOn,
    rememberProfile,
    clearActor,
    actor,
    pendingOpeningCount,
    syncOfflineOpenings,
    isOffline,
    offlineClosingData,
    closeOffline,
} from "../../offline/index.js";
import { silentPrint } from "../plugins/print.js";
import { cachePrintTemplateAndTerms } from "../../utils/pos_profile.js";
import { maySeeZReport } from "../utils/shiftReports.js";

// Not an error - just "this user does not get a Z report".
class SkipZReport extends Error {}

export function usePosShift(openDialog) {
    const { proxy } = getCurrentInstance();
    const eventBus = proxy?.eventBus;

    const pos_profile = ref(null);
    const pos_opening_shift = ref(null);

    // Cake Zone offline till: a call that never reached the server, as opposed to a refusal.
    function unreachable(err) {
        return !navigator.onLine || window.serverOnline === false || !err || err.status === 0;
    }

    async function check_opening_entry(czRetried = false) {
        await initPromise;
        await checkDbHealth();
        return frappe
            .call("posawesome.posawesome.api.shifts.check_opening_shift", {
                user: frappe.session.user,
            })
            .then((r) => {
                if (r.message && offlineTillOn()) {
                    // A real session answered: nobody is signed in offline any more, and
                    // this till's profile is kept for the next outage.
                    clearActor();
                    rememberProfile(r.message);
                    eventBus?.emit("cz_offer_enrol");
                }
                if (r.message) {
                    // Cake Zone (10 Nov 2026): save THIS till's receipt layout for offline use
                    // on every online resume. The only other place that saved it is skipped
                    // whenever the till learns its profile early, and a till with nothing saved
                    // printed POS Awesome's own slip offline.
                    cachePrintTemplateAndTerms(r.message.pos_profile).catch(() => {});
                    pos_profile.value = r.message.pos_profile;
                    pos_opening_shift.value = r.message.pos_opening_shift;
                    if (pos_profile.value.taxes_and_charges) {
                        frappe.call({
                            method: "frappe.client.get",
                            args: {
                                doctype: "Sales Taxes and Charges Template",
                                name: pos_profile.value.taxes_and_charges,
                            },
                            callback: (res) => {
                                if (res.message) {
                                    setTaxTemplate(
                                        pos_profile.value.taxes_and_charges,
                                        res.message,
                                    );
                                }
                            },
                        });
                    }
                    eventBus?.emit("register_pos_profile", r.message);
                    eventBus?.emit("set_company", r.message.company);
                    try {
                        frappe.realtime.emit("pos_profile_registered");
                    } catch (e) {
                        console.warn("Realtime emit failed", e);
                    }
                    console.info("LoadPosProfile");
                    // Cake Zone, 28 Oct 2026: POS Awesome resumes an open shift whatever day it
                    // opened, so yesterday's forgotten shift would quietly take today's sales and
                    // one count would have to cover two days. The server marks such a shift
                    // (cz_stale_since); refuse to sell on it (Pay.vue) and open the count now.
                    // The late close is dated to its own day, so today's shift opens straight after.
                    window.cz_stale_shift = r.message.cz_stale_since || null;
                    window.cz_shift_block = null;
                    // Cake Zone, 28 Oct 2026: the same resume ignores WHICH till too. An area
                    // manager with a shift open at one branch, signing in on a PC set up as a
                    // till at another, would sell against the first branch's stock. Refuse:
                    // the shift must be counted and closed at its own drawer.
                    let here = null;
                    try {
                        here = (JSON.parse(localStorage.getItem("cz_till_device") || "null") || {}).pos_profile || null;
                    } catch (e) {
                        here = null;
                    }
                    const shiftTill = r.message.pos_profile && r.message.pos_profile.name;
                    if (here && shiftTill && here !== shiftTill) {
                        window.cz_shift_block = `You still have a shift open on ${shiftTill}, and this PC is ${here}. Go to ${shiftTill}, count the drawer and close the shift there, then sign in here.`;
                        window.cz_shift_block_close = false;
                    } else if (window.cz_stale_shift) {
                        window.cz_shift_block = `This till is still on the shift from ${window.cz_stale_shift}. Close that shift first, then open today's.`;
                        window.cz_shift_block_close = true;
                    }
                    if (window.cz_shift_block) {
                        eventBus?.emit("show_message", {
                            title: window.cz_shift_block_close
                                ? `This till's shift from ${window.cz_stale_shift} was never closed. Count the drawer and close it now, then open today's shift.`
                                : window.cz_shift_block,
                            color: "error",
                        });
                        if (window.cz_shift_block_close) setTimeout(() => get_closing_data(), 1500);
                    }
                    try {
                        setOpeningStorage(r.message);
                    } catch (e) {
                        console.error("Failed to cache opening data", e);
                    }
                } else {
                    if (offlineTillOn() && !czRetried && pendingOpeningCount()) {
                        // A shift opened offline has not reached the server yet. Send it
                        // first, or this would offer to open a second shift.
                        return syncOfflineOpenings().then(() => check_opening_entry(true));
                    }
                    window.cz_stale_shift = null;
                    window.cz_shift_block = null;
                    const data = getOpeningStorage();
                    if (data) {
                        pos_profile.value = data.pos_profile;
                        pos_opening_shift.value = data.pos_opening_shift;
                        eventBus?.emit("register_pos_profile", data);
                        eventBus?.emit("set_company", data.company);
                        try {
                            frappe.realtime.emit("pos_profile_registered");
                        } catch (e) {
                            console.warn("Realtime emit failed", e);
                        }
                        console.info("LoadPosProfile (cached)");
                        return;
                    }
                    openDialog && openDialog();
                }
            })
            .catch((err) => {
                if (offlineTillOn() && unreachable(err)) {
                    // No server: the till's own sign-in decides who sells (Pos.vue).
                    eventBus?.emit("cz_offline_start");
                    return;
                }
                const data = getOpeningStorage();
                if (data) {
                    pos_profile.value = data.pos_profile;
                    pos_opening_shift.value = data.pos_opening_shift;
                    eventBus?.emit("register_pos_profile", data);
                    eventBus?.emit("set_company", data.company);
                    try {
                        frappe.realtime.emit("pos_profile_registered");
                    } catch (e) {
                        console.warn("Realtime emit failed", e);
                    }
                    console.info("LoadPosProfile (cached)");
                    return;
                }
                openDialog && openDialog();
            });
    }

    function get_closing_data() {
        if (offlineTillOn() && isOffline()) {
            // Step 2 (10 Nov 2026): count and close on the PC. The close goes to ERP after
            // this shift's sales, and ERP works out the expected figures then.
            const cur = getOpeningStorage() || {};
            const shift = (pos_opening_shift.value && pos_opening_shift.value.name) ? pos_opening_shift.value : cur.pos_opening_shift;
            const profile = (pos_profile.value && pos_profile.value.name) ? pos_profile.value : cur.pos_profile;
            if (!shift || !profile) {
                eventBus?.emit("show_message", { title: __("No open shift on this till."), color: "error" });
                return Promise.resolve();
            }
            eventBus?.emit("open_ClosingDialog", offlineClosingData(profile, shift));
            return Promise.resolve();
        }
        return frappe
            .call(
                "posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.make_closing_shift_from_opening",
                { opening_shift: pos_opening_shift.value },
            )
            .then((r) => {
                if (r.message) {
                    eventBus?.emit("open_ClosingDialog", r.message);
                }
            });
    }

    function submit_closing_pos(data) {
        if (data && data.cz_offline) {
            closeOffline(data);
            pos_opening_shift.value = null;
            pos_profile.value = null;
            clearOpeningStorage();
            clearActor();
            eventBus?.emit("show_message", {
                title: __("Shift closed offline. It goes to ERP after its sales; the supervisor prints the Z report then."),
                color: "warning",
            });
            check_opening_entry();
            return;
        }
        frappe
            .call(
                "posawesome.posawesome.doctype.pos_closing_shift.pos_closing_shift.submit_closing_shift",
                { closing_shift: data },
            )
            .then((r) => {
                if (r.message) {
                    // Print the Z report before the profile is cleared - the format is
                    // whatever the POS Closing Shift doctype defaults to, so the name is
                    // not hard-coded here. r.message is the closing shift's name.
                    //
                    // Cashiers may not pull a Z report (the server refuses it too), so
                    // do not even ask for it - otherwise closing a till would end with
                    // a permission error page in the cashier's face. The shift still
                    // closes; the supervisor prints the Z afterwards.
                    const silent = !!pos_profile.value?.posa_silent_print;
                    try {
                        if (!maySeeZReport()) {
                            throw new SkipZReport();
                        }
                        const url =
                            frappe.urllib.get_base_url() +
                            "/printview?doctype=" +
                            encodeURIComponent("POS Closing Shift") +
                            "&name=" +
                            encodeURIComponent(r.message) +
                            "&trigger_print=1&no_letterhead=1";
                        if (silent) {
                            silentPrint(url);
                        } else {
                            window.open(url, "_blank");
                        }
                    } catch (e) {
                        if (!(e instanceof SkipZReport)) {
                            console.error("Could not open the Z report", e);
                        }
                    }
                    pos_opening_shift.value = null;
                    pos_profile.value = null;
                    clearOpeningStorage();
                    eventBus?.emit("show_message", {
                        title: `POS Shift Closed`,
                        color: "success",
                    });
                    check_opening_entry();
                }
            });
    }

    return { pos_profile, pos_opening_shift, check_opening_entry, get_closing_data, submit_closing_pos };
}
